import asyncio
import json
import logging
import queue
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

import pandas
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import (
    API_KEY,
    MAX_SUBSCRIBE_PER_REQUEST,
    STARTUP_TIMEOUT,
    validate_auth,
)
from app.models import (
    HealthResponse,
    KlineData,
    KlineResponse,
    QuerySymbolsRequest,
    QuoteData,
    SubscribeRequest,
    SubscribeResponse,
    SymbolInfo,
    TickData,
    TickResponse,
    UnsubscribeResponse,
)
from app.tq_market import TqMarketEngine

logger = logging.getLogger(__name__)

engine = TqMarketEngine()


# ---------- API Key 鉴权中间件 ----------


class ApiKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not API_KEY:
            return await call_next(request)

        # 健康检查、文档页跳过鉴权
        path = request.url.path
        if path in ("/api/health", "/docs", "/openapi.json", "/redoc", "/docs/", "/redoc/"):
            return await call_next(request)
        if path.startswith("/docs") or path.startswith("/openapi") or path.startswith("/redoc"):
            return await call_next(request)

        provided_key = request.headers.get("X-API-Key", "")
        if provided_key != API_KEY:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or missing X-API-Key",
            )

        return await call_next(request)


# ---------- 生命周期 ----------


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动前校验
    auth_err = validate_auth()
    if auth_err:
        logger.error("Refusing to start: %s", auth_err)
        # 不中断启动，但引擎会一直处于未就绪状态，health 返回 503
    else:
        engine.start()
        ready = await asyncio.to_thread(engine.wait_until_ready, timeout=STARTUP_TIMEOUT)
        if ready:
            logger.info("TqMarketEngine is ready")
        else:
            last_err = engine.last_error or "connect_timeout"
            logger.warning("TqMarketEngine startup failed: %s", last_err)
    yield
    engine.stop()


# ---------- FastAPI 应用 ----------


app = FastAPI(
    title="TqSdk 实时行情后端系统",
    description="基于 TqSdk 的股票/期货实时行情获取系统，支持 REST API 和 WebSocket 实时推送。",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(ApiKeyMiddleware)


# ---------- 健康检查 ----------


@app.get(
    "/api/health",
    response_model=HealthResponse,
    summary="健康检查",
    description="返回引擎状态、错误信息、已订阅合约列表和最后更新时间。",
)
async def health_check():
    ready = engine.is_ready
    last_err = engine.last_error
    last_update_ts = engine.last_update_at
    last_update_at = None
    if last_update_ts:
        last_update_at = datetime.fromtimestamp(last_update_ts).isoformat()

    if ready:
        status_str = "ok"
        err_val = None
    elif last_err in ("auth_missing", "auth_failed"):
        status_str = "unavailable"
        err_val = last_err
    elif last_err == "connect_timeout":
        status_str = "degraded"
        err_val = "connect_timeout"
    else:
        status_str = "unavailable"
        err_val = None

    return {
        "status": status_str,
        "engine_ready": ready,
        "error": err_val,
        "subscribed_symbols": engine.get_subscribed_symbols(),
        "last_update_at": last_update_at,
    }


# ---------- 订阅管理 ----------


@app.post(
    "/api/subscribe",
    response_model=SubscribeResponse,
    summary="订阅行情",
    description="订阅一个或多个合约的实时行情。单次最多订阅 50 只。",
)
async def subscribe_symbols(req: SubscribeRequest):
    if len(req.symbols) > MAX_SUBSCRIBE_PER_REQUEST:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Too many symbols: max {MAX_SUBSCRIBE_PER_REQUEST} per request",
        )
    if not req.symbols:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="symbols list is empty")

    if not engine.is_ready:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TqMarketEngine is not ready",
        )

    try:
        subscribed, already = engine.subscribe_quote(req.symbols)
    except (RuntimeError, TimeoutError) as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))

    return SubscribeResponse(subscribed=subscribed, already_subscribed=already)


@app.delete(
    "/api/unsubscribe/{symbol}",
    response_model=UnsubscribeResponse,
    summary="取消单个订阅",
    description="取消指定合约的行情订阅。",
)
async def unsubscribe_symbol(symbol: str):
    if not engine.is_ready:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TqMarketEngine is not ready",
        )
    try:
        unsubscribed, not_subscribed = engine.unsubscribe_quote([symbol])
    except (RuntimeError, TimeoutError) as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))
    return UnsubscribeResponse(unsubscribed=unsubscribed, not_subscribed=not_subscribed)


@app.delete(
    "/api/unsubscribe",
    response_model=UnsubscribeResponse,
    summary="批量取消订阅",
    description="取消多个合约的行情订阅，多个代码用逗号分隔。",
)
async def unsubscribe_symbols(symbols: str = ""):
    symbol_list = [s.strip() for s in symbols.split(",") if s.strip()]
    if not symbol_list:
        return UnsubscribeResponse(unsubscribed=[], not_subscribed=[])
    if len(symbol_list) > MAX_SUBSCRIBE_PER_REQUEST:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Too many symbols: max {MAX_SUBSCRIBE_PER_REQUEST} per request",
        )
    if not engine.is_ready:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TqMarketEngine is not ready",
        )
    try:
        unsubscribed, not_subscribed = engine.unsubscribe_quote(symbol_list)
    except (RuntimeError, TimeoutError) as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))
    return UnsubscribeResponse(unsubscribed=unsubscribed, not_subscribed=not_subscribed)


# ---------- 行情查询 ----------


@app.get(
    "/api/quote/{symbol}",
    response_model=Optional[QuoteData],
    summary="获取单个合约行情",
    description="获取指定合约的最新行情快照。需先通过 subscribe 订阅。",
)
async def get_quote(symbol: str):
    if not engine.is_ready:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TqMarketEngine is not ready",
        )
    try:
        quote = engine.get_quote(symbol)
    except (RuntimeError, TimeoutError) as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))
    if quote is None:
        return None
    return quote


@app.get(
    "/api/quotes",
    response_model=list[QuoteData],
    summary="获取所有已订阅行情",
    description="获取所有已订阅合约的最新行情快照。",
)
async def get_all_quotes():
    if not engine.is_ready:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TqMarketEngine is not ready",
        )
    try:
        return engine.get_all_quotes()
    except (RuntimeError, TimeoutError) as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))


@app.get(
    "/api/klines/{symbol}",
    response_model=Optional[KlineResponse],
    summary="获取 K 线数据",
    description="获取指定合约的 K 线序列。duration_seconds 单位为秒，data_length 最多 10000。",
)
async def get_klines(
    symbol: str,
    duration_seconds: int = 60,
    data_length: int = 200,
):
    if not engine.is_ready:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TqMarketEngine is not ready",
        )
    if data_length > 10000:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="data_length must be <= 10000",
        )
    try:
        df = engine.get_klines(symbol, duration_seconds, data_length)
    except (RuntimeError, TimeoutError) as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))
    if df is None:
        return None

    rows = []
    for _, row in df.iterrows():
        rows.append(
            KlineData(
                datetime=str(row.get("datetime", "")),
                open=_safe_float(row.get("open")),
                high=_safe_float(row.get("high")),
                low=_safe_float(row.get("low")),
                close=_safe_float(row.get("close")),
                volume=_safe_float(row.get("volume")),
                open_oi=_safe_float(row.get("open_oi")),
                close_oi=_safe_float(row.get("close_oi")),
            )
        )

    return KlineResponse(
        symbol=symbol,
        duration_seconds=duration_seconds,
        data=rows,
    )


@app.get(
    "/api/ticks/{symbol}",
    response_model=Optional[TickResponse],
    summary="获取 Tick 行情",
    description="获取指定合约的逐笔成交 Tick 序列。data_length 最多 10000。",
)
async def get_ticks(
    symbol: str,
    data_length: int = 200,
):
    if not engine.is_ready:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TqMarketEngine is not ready",
        )
    if data_length > 10000:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="data_length must be <= 10000",
        )
    try:
        df = engine.get_ticks(symbol, data_length)
    except (RuntimeError, TimeoutError) as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))
    if df is None:
        return None

    rows = []
    for _, row in df.iterrows():
        rows.append(
            TickData(
                datetime=str(row.get("datetime", "")),
                last_price=_safe_float(row.get("last_price")),
                ask_price1=_safe_float(row.get("ask_price1")),
                bid_price1=_safe_float(row.get("bid_price1")),
                highest=_safe_float(row.get("highest")),
                lowest=_safe_float(row.get("lowest")),
                volume=_safe_float(row.get("volume")),
                amount=_safe_float(row.get("amount")),
                open_interest=_safe_float(row.get("open_interest")),
            )
        )

    return TickResponse(
        symbol=symbol,
        data_length=data_length,
        data=rows,
    )


# ---------- 合约查询 ----------


@app.get(
    "/api/symbols",
    summary="列出已订阅合约",
    description="返回当前已订阅的所有合约代码。",
)
async def list_subscribed_symbols():
    return {"symbols": engine.get_subscribed_symbols()}


@app.post(
    "/api/query_symbols",
    response_model=list[SymbolInfo],
    summary="查询合约列表",
    description="根据交易所、品种、合约类型等条件查询合约。最多返回 50 条。",
)
async def query_symbols(req: QuerySymbolsRequest):
    if not engine.is_ready:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TqMarketEngine is not ready",
        )
    try:
        return engine.query_quotes(
            exchange_id=req.exchange_id,
            product_id=req.product_id,
            ins_class=req.ins_class,
            expired=req.expired,
        )
    except (RuntimeError, TimeoutError) as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))


# ---------- WebSocket ----------


@app.websocket("/ws/quotes")
async def websocket_quotes(websocket: WebSocket):
    # WebSocket 鉴权
    if API_KEY:
        provided_key = websocket.headers.get("X-API-Key", "")
        if provided_key != API_KEY:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid API key")
            return

    await websocket.accept()
    q: queue.Queue = engine.register_ws_queue()
    try:
        send_task = asyncio.create_task(_ws_sender(websocket, q))
        recv_task = asyncio.create_task(_ws_receiver(websocket))
        done, pending = await asyncio.wait(
            [send_task, recv_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("WebSocket error: %s", e)
    finally:
        engine.unregister_ws_queue(q)


async def _ws_sender(websocket: WebSocket, q: queue.Queue):
    loop = asyncio.get_event_loop()
    try:
        while True:
            try:
                msg = await asyncio.wait_for(
                    loop.run_in_executor(None, q.get, True, 0.5),
                    timeout=30,
                )
                await websocket.send_text(msg)
            except asyncio.TimeoutError:
                try:
                    await websocket.send_text(json.dumps({"type": "ping"}))
                except Exception:
                    return
    except WebSocketDisconnect:
        pass
    except Exception:
        pass


async def _ws_receiver(websocket: WebSocket):
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                msg_type = msg.get("type", "")

                if msg_type == "subscribe":
                    symbols = msg.get("symbols", [])
                    if len(symbols) > MAX_SUBSCRIBE_PER_REQUEST:
                        await websocket.send_text(
                            json.dumps(
                                {
                                    "type": "error",
                                    "message": f"max {MAX_SUBSCRIBE_PER_REQUEST} symbols per request",
                                }
                            )
                        )
                        continue
                    if not engine.is_ready:
                        await websocket.send_text(
                            json.dumps({"type": "error", "message": "engine not ready"})
                        )
                        continue
                    try:
                        subscribed, already = engine.subscribe_quote(symbols)
                        await websocket.send_text(
                            json.dumps(
                                {
                                    "type": "subscribe_result",
                                    "subscribed": subscribed,
                                    "already_subscribed": already,
                                }
                            )
                        )
                    except Exception as e:
                        await websocket.send_text(
                            json.dumps({"type": "error", "message": str(e)})
                        )

                elif msg_type == "unsubscribe":
                    symbols = msg.get("symbols", [])
                    if not engine.is_ready:
                        await websocket.send_text(
                            json.dumps({"type": "error", "message": "engine not ready"})
                        )
                        continue
                    try:
                        unsubscribed, not_subscribed = engine.unsubscribe_quote(symbols)
                        await websocket.send_text(
                            json.dumps(
                                {
                                    "type": "unsubscribe_result",
                                    "unsubscribed": unsubscribed,
                                    "not_subscribed": not_subscribed,
                                }
                            )
                        )
                    except Exception as e:
                        await websocket.send_text(
                            json.dumps({"type": "error", "message": str(e)})
                        )

                elif msg_type == "pong":
                    pass

                elif msg_type == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))

            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    except Exception:
        pass


# ---------- 工具函数 ----------


def _safe_float(val) -> Optional[float]:
    if val is None:
        return None
    try:
        f = float(val)
        return f if f == f else None
    except (TypeError, ValueError):
        return None
