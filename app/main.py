import asyncio
import base64
import json
import logging
import os
import queue
import threading
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

import pandas
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.config import (
    API_KEY,
    MAX_SUBSCRIBE_PER_REQUEST,
    STARTUP_TIMEOUT,
)
from app.models import (
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

_engine_lock = threading.Lock()
_engine: Optional[TqMarketEngine] = None
_engine_credentials: Optional[tuple[str, str]] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    success: bool
    token: Optional[str] = None
    error: Optional[str] = None


class AuthStatusResponse(BaseModel):
    authenticated: bool
    engine_ready: bool
    error: Optional[str] = None
    username: Optional[str] = None


def _get_engine() -> Optional[TqMarketEngine]:
    global _engine
    return _engine


def _make_token(username: str, password: str) -> str:
    payload = json.dumps({"username": username, "password": password})
    return base64.b64encode(payload.encode()).decode()


def _parse_token(token: str) -> Optional[tuple[str, str]]:
    try:
        payload = base64.b64decode(token).decode()
        data = json.loads(payload)
        u = data.get("username", "")
        p = data.get("password", "")
        if u and p:
            return (u, p)
    except Exception:
        pass
    return None


def _extract_creds(request: Request) -> Optional[tuple[str, str]]:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
        creds = _parse_token(token)
        if creds:
            return creds

    tq_user = request.headers.get("X-TQ-User")
    tq_pass = request.headers.get("X-TQ-Password")
    if tq_user and tq_pass:
        from urllib.parse import unquote
        return (unquote(tq_user), unquote(tq_pass))

    return None


def _get_or_create_engine(username: str, password: str) -> TqMarketEngine:
    global _engine, _engine_credentials

    with _engine_lock:
        if _engine is not None and _engine_credentials == (username, password):
            return _engine

        if _engine is not None:
            try:
                _engine.stop()
            except Exception as e:
                logger.warning("Error stopping old engine: %s", e)
            _engine = None
            _engine_credentials = None

        _engine = TqMarketEngine(username, password)
        _engine_credentials = (username, password)
        _engine.start()
        logger.info("Created and started engine for user: %s", username)
        return _engine


def _require_engine(request: Request) -> TqMarketEngine:
    creds = _extract_creds(request)
    if not creds:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing credentials")

    username, password = creds
    engine = _get_or_create_engine(username, password)
    return engine


def _cleanup_engine():
    global _engine, _engine_credentials
    with _engine_lock:
        if _engine is not None:
            try:
                _engine.stop()
            except Exception as e:
                logger.warning("Error stopping engine: %s", e)
            _engine = None
            _engine_credentials = None


# ---------- 生命周期 ----------

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("TqSdk Market Server starting (no pre-start engine)")
    yield
    global _engine
    if _engine:
        _engine.stop()
        _engine = None


# ---------- FastAPI 应用 ----------

app = FastAPI(
    title="TqSdk 实时行情后端系统",
    description="基于 TqSdk 的股票/期货实时行情获取系统",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- 登录 ----------

@app.post("/api/auth/login", response_model=LoginResponse, summary="登录验证")
async def login(req: LoginRequest):
    if not req.username.strip() or not req.password.strip():
        return LoginResponse(success=False, error="请输入账号和密码")

    try:
        engine = _get_or_create_engine(req.username.strip(), req.password.strip())

        for i in range(6):
            ready = await asyncio.to_thread(engine.wait_until_ready, timeout=10.0)

            err = engine.last_error
            if err == "auth_failed":
                _cleanup_engine()
                return LoginResponse(success=False, error="账号或密码错误")
            elif err == "auth_missing":
                _cleanup_engine()
                return LoginResponse(success=False, error="凭证缺失")

            if ready and err is None:
                token = _make_token(req.username.strip(), req.password.strip())
                logger.info("Login success for user: %s", req.username)
                return LoginResponse(success=True, token=token)

            logger.info("Login attempt %d: engine not ready yet, error=%s", i + 1, err)

        if engine.is_ready and engine.last_error is None:
            token = _make_token(req.username.strip(), req.password.strip())
            return LoginResponse(success=True, token=token)

        err = engine.last_error
        if err == "auth_failed":
            _cleanup_engine()
            return LoginResponse(success=False, error="账号或密码错误")
        elif err == "auth_missing":
            _cleanup_engine()
            return LoginResponse(success=False, error="凭证缺失")
        else:
            _cleanup_engine()
            return LoginResponse(success=False, error=err or "引擎连接超时，请稍后重试")
    except Exception as e:
        logger.error("Login exception: %s", e)
        return LoginResponse(success=False, error=f"登录失败: {str(e)}")


@app.get("/api/auth/status", response_model=AuthStatusResponse, summary="认证状态")
async def auth_status(request: Request):
    creds = _extract_creds(request)
    if not creds:
        return AuthStatusResponse(authenticated=False, engine_ready=False, error="not_logged_in")

    username, password = creds
    engine = _get_or_create_engine(username, password)
    return AuthStatusResponse(
        authenticated=True,
        engine_ready=engine.is_ready,
        error=engine.last_error,
        username=username,
    )


# ---------- 健康检查 ----------

@app.get("/api/health", summary="健康检查")
async def health_check(request: Request):
    creds = _extract_creds(request)
    if not creds:
        return {
            "status": "unavailable",
            "engine_ready": False,
            "error": "auth_missing",
            "subscribed_symbols": [],
            "last_update_at": None,
        }

    engine = _get_or_create_engine(*creds)
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
        status_str = "starting"
        err_val = None

    return {
        "status": status_str,
        "engine_ready": ready,
        "error": err_val,
        "subscribed_symbols": engine.get_subscribed_symbols(),
        "last_update_at": last_update_at,
    }


# ---------- 订阅管理 ----------

@app.post("/api/subscribe", response_model=SubscribeResponse, summary="订阅行情")
async def subscribe_symbols(req: SubscribeRequest, request: Request):
    engine = _require_engine(request)
    if len(req.symbols) > MAX_SUBSCRIBE_PER_REQUEST:
        raise HTTPException(status_code=400, detail=f"max {MAX_SUBSCRIBE_PER_REQUEST} symbols")
    if not req.symbols:
        raise HTTPException(status_code=400, detail="symbols list is empty")
    try:
        subscribed, already = engine.subscribe_quote(req.symbols)
    except (RuntimeError, TimeoutError) as e:
        raise HTTPException(status_code=503, detail=str(e))
    return SubscribeResponse(subscribed=subscribed, already_subscribed=already)


@app.delete("/api/unsubscribe/{symbol}", response_model=UnsubscribeResponse, summary="取消订阅")
async def unsubscribe_symbol(symbol: str, request: Request):
    engine = _require_engine(request)
    try:
        unsubscribed, not_subscribed = engine.unsubscribe_quote([symbol])
    except (RuntimeError, TimeoutError) as e:
        raise HTTPException(status_code=503, detail=str(e))
    return UnsubscribeResponse(unsubscribed=unsubscribed, not_subscribed=not_subscribed)


@app.delete("/api/unsubscribe", response_model=UnsubscribeResponse, summary="批量取消订阅")
async def unsubscribe_symbols(symbols: str = "", request: Request = None):
    engine = _require_engine(request)
    symbol_list = [s.strip() for s in symbols.split(",") if s.strip()]
    if not symbol_list:
        return UnsubscribeResponse(unsubscribed=[], not_subscribed=[])
    try:
        unsubscribed, not_subscribed = engine.unsubscribe_quote(symbol_list)
    except (RuntimeError, TimeoutError) as e:
        raise HTTPException(status_code=503, detail=str(e))
    return UnsubscribeResponse(unsubscribed=unsubscribed, not_subscribed=not_subscribed)


# ---------- 行情查询 ----------

@app.get("/api/quote/{symbol}", summary="获取单个行情")
async def get_quote(symbol: str, request: Request):
    engine = _require_engine(request)
    try:
        quote = engine.get_quote(symbol)
    except (RuntimeError, TimeoutError) as e:
        raise HTTPException(status_code=503, detail=str(e))
    return quote


@app.get("/api/quotes", summary="获取所有行情")
async def get_all_quotes(request: Request):
    engine = _require_engine(request)
    try:
        return engine.get_all_quotes()
    except (RuntimeError, TimeoutError) as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.get("/api/klines/{symbol}", summary="获取K线")
async def get_klines(symbol: str, duration_seconds: int = 60, data_length: int = 200, request: Request = None):
    engine = _require_engine(request)
    try:
        df = engine.get_klines(symbol, duration_seconds, data_length)
    except (RuntimeError, TimeoutError) as e:
        raise HTTPException(status_code=503, detail=str(e))
    if df is None:
        return None
    rows = []
    for _, row in df.iterrows():
        rows.append(KlineData(
            datetime=str(row.get("datetime", "")),
            open=_safe_float(row.get("open")),
            high=_safe_float(row.get("high")),
            low=_safe_float(row.get("low")),
            close=_safe_float(row.get("close")),
            volume=_safe_float(row.get("volume")),
            open_oi=_safe_float(row.get("open_oi")),
            close_oi=_safe_float(row.get("close_oi")),
        ))
    return KlineResponse(symbol=symbol, duration_seconds=duration_seconds, data=rows)


@app.get("/api/ticks/{symbol}", summary="获取Tick")
async def get_ticks(symbol: str, data_length: int = 200, request: Request = None):
    engine = _require_engine(request)
    try:
        df = engine.get_ticks(symbol, data_length)
    except (RuntimeError, TimeoutError) as e:
        raise HTTPException(status_code=503, detail=str(e))
    if df is None:
        return None
    rows = []
    for _, row in df.iterrows():
        rows.append(TickData(
            datetime=str(row.get("datetime", "")),
            last_price=_safe_float(row.get("last_price")),
            ask_price1=_safe_float(row.get("ask_price1")),
            bid_price1=_safe_float(row.get("bid_price1")),
            highest=_safe_float(row.get("highest")),
            lowest=_safe_float(row.get("lowest")),
            volume=_safe_float(row.get("volume")),
            amount=_safe_float(row.get("amount")),
            open_interest=_safe_float(row.get("open_interest")),
        ))
    return TickResponse(symbol=symbol, data_length=data_length, data=rows)


# ---------- 合约查询 ----------

@app.get("/api/symbols", summary="已订阅合约")
async def list_subscribed_symbols(request: Request):
    engine = _require_engine(request)
    return {"symbols": engine.get_subscribed_symbols()}


@app.post("/api/query_symbols", response_model=list[SymbolInfo], summary="查询合约")
async def query_symbols(req: QuerySymbolsRequest, request: Request):
    engine = _require_engine(request)
    try:
        return engine.query_quotes(
            exchange_id=req.exchange_id,
            product_id=req.product_id,
            ins_class=req.ins_class,
            expired=req.expired,
        )
    except (RuntimeError, TimeoutError) as e:
        raise HTTPException(status_code=503, detail=str(e))


# ---------- WebSocket ----------

@app.websocket("/ws/quotes")
async def websocket_quotes(websocket: WebSocket):
    token = websocket.query_params.get("token", "")
    creds = _parse_token(token) if token else None

    if not creds:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Missing auth token")
        return

    username, password = creds
    engine = _get_or_create_engine(username, password)

    await websocket.accept()
    q: queue.Queue = engine.register_ws_queue()
    try:
        send_task = asyncio.create_task(_ws_sender(websocket, q))
        recv_task = asyncio.create_task(_ws_receiver(websocket, engine))
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


async def _ws_receiver(websocket: WebSocket, engine: TqMarketEngine):
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                msg_type = msg.get("type", "")

                if msg_type == "subscribe":
                    symbols = msg.get("symbols", [])
                    if not engine.is_ready:
                        await websocket.send_text(json.dumps({"type": "error", "message": "engine not ready"}))
                        continue
                    try:
                        subscribed, already = engine.subscribe_quote(symbols)
                        await websocket.send_text(json.dumps({
                            "type": "subscribe_result",
                            "subscribed": subscribed,
                            "already_subscribed": already,
                        }))
                    except Exception as e:
                        await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))

                elif msg_type == "unsubscribe":
                    symbols = msg.get("symbols", [])
                    try:
                        unsubscribed, not_subscribed = engine.unsubscribe_quote(symbols)
                        await websocket.send_text(json.dumps({
                            "type": "unsubscribe_result",
                            "unsubscribed": unsubscribed,
                            "not_subscribed": not_subscribed,
                        }))
                    except Exception as e:
                        await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))

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


# ---------- 静态文件服务（前端） ----------

_frontend_dist = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist")

if os.path.isdir(_frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(_frontend_dist, "assets")), name="static_assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        file_path = os.path.join(_frontend_dist, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(_frontend_dist, "index.html"))


def _safe_float(val) -> Optional[float]:
    if val is None:
        return None
    try:
        f = float(val)
        return f if f == f else None
    except (TypeError, ValueError):
        return None
