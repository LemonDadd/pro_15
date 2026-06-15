import asyncio
import json
import logging
import queue
from contextlib import asynccontextmanager
from typing import Optional

import pandas
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.models import (
    KlineData,
    KlineResponse,
    QuerySymbolsRequest,
    QuoteData,
    SubscribeRequest,
    SubscribeResponse,
    SymbolInfo,
    UnsubscribeResponse,
)
from app.tq_market import TqMarketEngine

logger = logging.getLogger(__name__)

engine = TqMarketEngine()


@asynccontextmanager
async def lifespan(app: FastAPI):
    engine.start()
    ready = await asyncio.to_thread(engine.wait_until_ready, timeout=15.0)
    if ready:
        logger.info("TqMarketEngine is ready")
    else:
        logger.warning("TqMarketEngine startup timed out")
    yield
    engine.stop()


app = FastAPI(
    title="TqSdk 实时行情后端系统",
    description="基于 TqSdk 的股票/期货实时行情获取系统，支持 REST API 和 WebSocket 推送",
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


@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "engine_ready": engine.is_ready,
        "subscribed_symbols": engine.get_subscribed_symbols(),
    }


@app.post("/api/subscribe", response_model=SubscribeResponse)
async def subscribe_symbols(req: SubscribeRequest):
    subscribed, already = engine.subscribe_quote(req.symbols)
    return SubscribeResponse(subscribed=subscribed, already_subscribed=already)


@app.delete("/api/unsubscribe/{symbol}", response_model=UnsubscribeResponse)
async def unsubscribe_symbol(symbol: str):
    unsubscribed, not_subscribed = engine.unsubscribe_quote([symbol])
    return UnsubscribeResponse(unsubscribed=unsubscribed, not_subscribed=not_subscribed)


@app.delete("/api/unsubscribe", response_model=UnsubscribeResponse)
async def unsubscribe_symbols(symbols: str = ""):
    symbol_list = [s.strip() for s in symbols.split(",") if s.strip()]
    if not symbol_list:
        return UnsubscribeResponse(unsubscribed=[], not_subscribed=[])
    unsubscribed, not_subscribed = engine.unsubscribe_quote(symbol_list)
    return UnsubscribeResponse(unsubscribed=unsubscribed, not_subscribed=not_subscribed)


@app.get("/api/quote/{symbol}", response_model=Optional[QuoteData])
async def get_quote(symbol: str):
    quote = engine.get_quote(symbol)
    if quote is None:
        return None
    return quote


@app.get("/api/quotes", response_model=list[QuoteData])
async def get_all_quotes():
    return engine.get_all_quotes()


@app.get("/api/klines/{symbol}", response_model=Optional[KlineResponse])
async def get_klines(
    symbol: str,
    duration_seconds: int = 60,
    data_length: int = 200,
):
    df = engine.get_klines(symbol, duration_seconds, data_length)
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


@app.get("/api/symbols")
async def list_subscribed_symbols():
    return {"symbols": engine.get_subscribed_symbols()}


@app.post("/api/query_symbols", response_model=list[SymbolInfo])
async def query_symbols(req: QuerySymbolsRequest):
    symbols = engine.query_quotes(
        exchange_id=req.exchange_id,
        product_id=req.product_id,
        ins_class=req.ins_class,
        expired=req.expired,
    )
    result = []
    for s in symbols[:50]:
        result.append(
            SymbolInfo(
                symbol=s,
            )
        )
    return result


@app.websocket("/ws/quotes")
async def websocket_quotes(websocket: WebSocket):
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

                elif msg_type == "unsubscribe":
                    symbols = msg.get("symbols", [])
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

                elif msg_type == "pong":
                    pass

            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    except Exception:
        pass


def _safe_float(val) -> Optional[float]:
    if val is None:
        return None
    try:
        f = float(val)
        return f if f == f else None
    except (TypeError, ValueError):
        return None
