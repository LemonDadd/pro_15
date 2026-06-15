import asyncio
import json
import logging
import queue
import threading
import time
from typing import Optional

import pandas
from tqsdk import TqApi, TqAuth

from app.config import TQ_AUTH_PASSWORD, TQ_AUTH_USER, UPDATE_LOOP_DEADLINE
from app.models import QuoteData

logger = logging.getLogger(__name__)


class TqMarketEngine:
    def __init__(self):
        self._api: Optional[TqApi] = None
        self._quotes: dict[str, object] = {}
        self._klines: dict[str, pandas.DataFrame] = {}
        self._ticks: dict[str, pandas.DataFrame] = {}
        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._ws_queues: list[queue.Queue] = []
        self._subscribed_symbols: set[str] = set()
        self._startup_event = threading.Event()

    @property
    def api(self) -> TqApi:
        if self._api is None:
            raise RuntimeError("TqMarketEngine not started")
        return self._api

    @property
    def is_ready(self) -> bool:
        return self._api is not None and self._running

    def wait_until_ready(self, timeout: float = 10.0) -> bool:
        return self._startup_event.wait(timeout=timeout)

    def start(self):
        if self._running:
            return
        self._running = True
        self._startup_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        logger.info("TqMarketEngine starting...")

    def stop(self):
        self._running = False
        self._startup_event.clear()
        if self._api is not None:
            try:
                self._api.close()
            except Exception:
                pass
            self._api = None
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None
        logger.info("TqMarketEngine stopped")

    def _run_loop(self):
        auth = None
        if TQ_AUTH_USER and TQ_AUTH_PASSWORD:
            auth = TqAuth(TQ_AUTH_USER, TQ_AUTH_PASSWORD)
        try:
            self._api = TqApi(auth=auth)
            self._startup_event.set()
            logger.info("TqApi connected successfully")
        except Exception as e:
            logger.error("Failed to create TqApi: %s", e)
            self._running = False
            self._startup_event.set()
            return

        try:
            while self._running:
                deadline_ts = time.time() + UPDATE_LOOP_DEADLINE
                updated = self._api.wait_update(deadline=deadline_ts)
                if updated:
                    self._on_update()
        except Exception as e:
            logger.error("TqApi loop error: %s", e)
        finally:
            try:
                self._api.close()
            except Exception:
                pass
            self._api = None
            self._running = False
            self._startup_event.clear()

    def _on_update(self):
        changed_symbols = []
        with self._lock:
            for symbol, quote in self._quotes.items():
                if self._api.is_changing(quote, ["last_price", "ask_price1", "bid_price1", "datetime"]):
                    changed_symbols.append(symbol)

        if changed_symbols:
            for symbol in changed_symbols:
                quote_data = self._extract_quote(symbol)
                if quote_data is None:
                    continue
                msg = json.dumps(
                    {"type": "quote_update", "data": quote_data.model_dump()},
                    ensure_ascii=False,
                )
                for q in self._ws_queues:
                    try:
                        q.put_nowait(msg)
                    except queue.Full:
                        try:
                            q.get_nowait()
                            q.put_nowait(msg)
                        except Exception:
                            pass

    def subscribe_quote(self, symbols: list[str]) -> tuple[list[str], list[str]]:
        subscribed = []
        already = []
        with self._lock:
            for s in symbols:
                if s in self._quotes:
                    already.append(s)
                else:
                    try:
                        if not self.is_ready:
                            logger.warning("TqApi not ready, cannot subscribe %s", s)
                            continue
                        q = self.api.get_quote(s)
                        self._quotes[s] = q
                        self._subscribed_symbols.add(s)
                        subscribed.append(s)
                        logger.info("Subscribed quote: %s", s)
                    except Exception as e:
                        logger.error("Subscribe quote failed for %s: %s", s, e)
        return subscribed, already

    def unsubscribe_quote(self, symbols: list[str]) -> tuple[list[str], list[str]]:
        unsubscribed = []
        not_subscribed = []
        with self._lock:
            for s in symbols:
                if s in self._quotes:
                    del self._quotes[s]
                    self._subscribed_symbols.discard(s)
                    unsubscribed.append(s)
                    logger.info("Unsubscribed quote: %s", s)
                else:
                    not_subscribed.append(s)
        return unsubscribed, not_subscribed

    def get_quote(self, symbol: str) -> Optional[QuoteData]:
        with self._lock:
            if symbol not in self._quotes:
                return None
        return self._extract_quote(symbol)

    def get_all_quotes(self) -> list[QuoteData]:
        result = []
        with self._lock:
            symbols = list(self._quotes.keys())
        for s in symbols:
            q = self._extract_quote(s)
            if q:
                result.append(q)
        return result

    def _extract_quote(self, symbol: str) -> Optional[QuoteData]:
        with self._lock:
            quote = self._quotes.get(symbol)
        if quote is None:
            return None
        try:
            return QuoteData(
                symbol=symbol,
                datetime=getattr(quote, "datetime", None),
                instrument_name=getattr(quote, "instrument_name", None),
                last_price=self._safe_float(getattr(quote, "last_price", None)),
                ask_price1=self._safe_float(getattr(quote, "ask_price1", None)),
                ask_volume1=self._safe_int(getattr(quote, "ask_volume1", None)),
                bid_price1=self._safe_float(getattr(quote, "bid_price1", None)),
                bid_volume1=self._safe_int(getattr(quote, "bid_volume1", None)),
                open=self._safe_float(getattr(quote, "open", None)),
                high=self._safe_float(getattr(quote, "highest", None)),
                low=self._safe_float(getattr(quote, "lowest", None)),
                close=self._safe_float(getattr(quote, "close", None)),
                average=self._safe_float(getattr(quote, "average", None)),
                volume=self._safe_float(getattr(quote, "volume", None)),
                amount=self._safe_float(getattr(quote, "amount", None)),
                open_interest=self._safe_float(getattr(quote, "open_interest", None)),
                price_tick=self._safe_float(getattr(quote, "price_tick", None)),
                volume_multiple=self._safe_float(
                    getattr(quote, "volume_multiple", None)
                ),
                highest=self._safe_float(getattr(quote, "highest", None)),
                lowest=self._safe_float(getattr(quote, "lowest", None)),
                expired=getattr(quote, "expired", None),
            )
        except Exception as e:
            logger.error("Extract quote failed for %s: %s", symbol, e)
            return None

    def get_klines(
        self, symbol: str, duration_seconds: int = 60, data_length: int = 200
    ) -> Optional[pandas.DataFrame]:
        key = f"{symbol}_{duration_seconds}_{data_length}"
        with self._lock:
            if key not in self._klines:
                try:
                    if not self.is_ready:
                        return None
                    df = self.api.get_kline_serial(
                        symbol, duration_seconds, data_length=data_length
                    )
                    self._klines[key] = df
                except Exception as e:
                    logger.error("Get klines failed for %s: %s", symbol, e)
                    return None
            return self._klines[key]

    def get_ticks(self, symbol: str, data_length: int = 200) -> Optional[pandas.DataFrame]:
        key = f"{symbol}_{data_length}"
        with self._lock:
            if key not in self._ticks:
                try:
                    if not self.is_ready:
                        return None
                    df = self.api.get_tick_serial(symbol, data_length=data_length)
                    self._ticks[key] = df
                except Exception as e:
                    logger.error("Get ticks failed for %s: %s", symbol, e)
                    return None
            return self._ticks[key]

    def query_quotes(
        self,
        exchange_id: Optional[str] = None,
        product_id: Optional[str] = None,
        ins_class: Optional[str] = None,
        expired: bool = False,
    ) -> list[str]:
        try:
            if not self.is_ready:
                return []
            result = self.api.query_quotes(
                ins_class=ins_class,
                exchange_id=exchange_id,
                product_id=product_id,
                expired=expired,
            )
            return list(result)
        except Exception as e:
            logger.error("Query quotes failed: %s", e)
            return []

    def get_subscribed_symbols(self) -> list[str]:
        with self._lock:
            return list(self._subscribed_symbols)

    def register_ws_queue(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=100)
        self._ws_queues.append(q)
        return q

    def unregister_ws_queue(self, q: queue.Queue):
        if q in self._ws_queues:
            self._ws_queues.remove(q)

    @staticmethod
    def _safe_float(val) -> Optional[float]:
        if val is None:
            return None
        try:
            f = float(val)
            return f if f == f else None
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _safe_int(val) -> Optional[int]:
        if val is None:
            return None
        try:
            f = float(val)
            return int(f) if f == f else None
        except (TypeError, ValueError):
            return None
