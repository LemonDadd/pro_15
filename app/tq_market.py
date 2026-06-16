import json
import logging
import os
import queue
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import pandas
from tqsdk import TqApi, TqAuth

from app.config import (
    DEFAULT_STOCK_SYMBOLS,
    MAX_TOTAL_SUBSCRIPTIONS,
    MAX_WS_QUEUE_SIZE,
    PERSIST_SUBSCRIPTIONS,
    STARTUP_TIMEOUT,
    SUBSCRIPTIONS_FILE,
    UPDATE_LOOP_DEADLINE,
)
from app.models import QuoteData, SymbolInfo

logger = logging.getLogger(__name__)


@dataclass
class Command:
    action: str
    params: dict = field(default_factory=dict)
    _event: threading.Event = field(default_factory=threading.Event, init=False)
    _result: Any = field(default=None, init=False)
    _error: Optional[str] = field(default=None, init=False)

    def set_result(self, result: Any):
        self._result = result
        self._event.set()

    def set_error(self, error: str):
        self._error = error
        self._event.set()

    def wait(self, timeout: Optional[float] = None) -> bool:
        return self._event.wait(timeout=timeout)

    @property
    def result(self) -> Any:
        return self._result

    @property
    def error(self) -> Optional[str]:
        return self._error


class TqMarketEngine:
    def __init__(self, username: str, password: str):
        self._username = username
        self._password = password
        self._api: Optional[TqApi] = None
        self._quotes: dict[str, object] = {}
        self._klines: dict[str, pandas.DataFrame] = {}
        self._ticks: dict[str, pandas.DataFrame] = {}
        self._subscribed_symbols: set[str] = set()
        self._cmd_queue: "queue.Queue[Command]" = queue.Queue()
        self._ws_queues: list[queue.Queue] = []
        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._startup_event = threading.Event()
        self._last_error: Optional[str] = None
        self._last_update_at: Optional[float] = None
        self._consecutive_errors = 0

    @property
    def is_ready(self) -> bool:
        return self._api is not None and self._running and self._last_error is None

    @property
    def last_error(self) -> Optional[str]:
        return self._last_error

    @property
    def last_update_at(self) -> Optional[float]:
        return self._last_update_at

    @property
    def username(self) -> str:
        return self._username

    def wait_until_ready(self, timeout: Optional[float] = None) -> bool:
        if timeout is None:
            timeout = STARTUP_TIMEOUT
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.is_ready:
                return True
            if self._last_error in ("auth_failed", "auth_missing"):
                return False
            remaining = deadline - time.time()
            if remaining <= 0:
                break
            self._startup_event.wait(timeout=min(remaining, 1.0))
        return self.is_ready

    def start(self):
        if self._running:
            return
        self._running = True
        self._startup_event.clear()
        self._last_error = None
        self._consecutive_errors = 0
        self._load_persisted_subscriptions()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        logger.info("TqMarketEngine starting for user: %s", self._username)

    def stop(self):
        self._save_persisted_subscriptions()
        self._running = False
        self._startup_event.set()
        if self._api is not None:
            try:
                self._api.close()
            except Exception as e:
                logger.warning("Error closing TqApi: %s", e)
            self._api = None
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None
        self._last_error = None
        logger.info("TqMarketEngine stopped")

    def _submit(self, action: str, params: Optional[dict] = None, timeout: float = 30.0) -> Any:
        if not self._running:
            raise RuntimeError("TqMarketEngine is not running")
        cmd = Command(action=action, params=params or {})
        self._cmd_queue.put(cmd)
        ok = cmd.wait(timeout=timeout)
        if not ok:
            raise TimeoutError(f"Command '{action}' timed out")
        if cmd.error:
            raise RuntimeError(cmd.error)
        return cmd.result

    def subscribe_quote(self, symbols: list[str]) -> tuple[list[str], list[str]]:
        return self._submit("subscribe", {"symbols": symbols})

    def unsubscribe_quote(self, symbols: list[str]) -> tuple[list[str], list[str]]:
        return self._submit("unsubscribe", {"symbols": symbols})

    def get_quote(self, symbol: str) -> Optional[QuoteData]:
        return self._submit("get_quote", {"symbol": symbol})

    def get_all_quotes(self) -> list[QuoteData]:
        return self._submit("get_all_quotes")

    def get_klines(
        self, symbol: str, duration_seconds: int = 60, data_length: int = 200
    ) -> Optional[pandas.DataFrame]:
        return self._submit(
            "get_klines",
            {"symbol": symbol, "duration_seconds": duration_seconds, "data_length": data_length},
        )

    def get_ticks(self, symbol: str, data_length: int = 200) -> Optional[pandas.DataFrame]:
        return self._submit(
            "get_ticks",
            {"symbol": symbol, "data_length": data_length},
        )

    def query_quotes(
        self,
        exchange_id: Optional[str] = None,
        product_id: Optional[str] = None,
        ins_class: Optional[str] = None,
        expired: bool = False,
    ) -> list[SymbolInfo]:
        return self._submit(
            "query_quotes",
            {
                "exchange_id": exchange_id,
                "product_id": product_id,
                "ins_class": ins_class,
                "expired": expired,
            },
        )

    def get_subscribed_symbols(self) -> list[str]:
        with self._lock:
            return list(self._subscribed_symbols)

    def register_ws_queue(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=MAX_WS_QUEUE_SIZE)
        self._ws_queues.append(q)
        return q

    def unregister_ws_queue(self, q: queue.Queue):
        if q in self._ws_queues:
            self._ws_queues.remove(q)

    def _run_loop(self):
        while self._running:
            try:
                self._connect_and_run()
            except Exception as e:
                err_str = str(e).lower()
                if "认证" in str(e) or "权限" in str(e) or "403" in str(e) or "密码" in str(e) or "auth" in err_str:
                    self._last_error = "auth_failed"
                    self._startup_event.set()
                    logger.error("TqApi auth failed: %s", e)
                    return
                self._consecutive_errors += 1
                self._last_error = "connect_timeout" if self._consecutive_errors >= 3 else None
                logger.error("TqApi loop error (consecutive=%d): %s", self._consecutive_errors, e)
                if self._running:
                    delay = min(2 ** self._consecutive_errors, 30)
                    logger.info("Reconnecting in %ds...", delay)
                    time.sleep(delay)
            finally:
                if self._api is not None:
                    try:
                        self._api.close()
                    except Exception:
                        pass
                    self._api = None

    def _connect_and_run(self):
        if not self._username or not self._password:
            self._last_error = "auth_missing"
            self._startup_event.set()
            logger.error("Auth credentials missing")
            time.sleep(5)
            return

        auth = TqAuth(self._username, self._password)
        try:
            self._api = TqApi(auth=auth)
        except Exception as e:
            self._last_error = "auth_failed"
            self._startup_event.set()
            logger.error("TqApi auth/connect failed: %s", e)
            raise

        try:
            symbols_to_subscribe = list(self._subscribed_symbols) if self._subscribed_symbols else []
            if not symbols_to_subscribe:
                symbols_to_subscribe = list(DEFAULT_STOCK_SYMBOLS)

            for symbol in symbols_to_subscribe:
                try:
                    q = self._api.get_quote(symbol)
                    self._quotes[symbol] = q
                    self._subscribed_symbols.add(symbol)
                except Exception as e:
                    logger.warning("Failed to subscribe %s: %s", symbol, e)

            if symbols_to_subscribe:
                logger.info("Restored %d subscriptions", len(self._subscribed_symbols))

            self._api.wait_update(deadline=time.time() + 5)

            self._last_error = None
            self._consecutive_errors = 0
            self._startup_event.set()
            logger.info("TqApi connected, subscriptions: %d", len(self._subscribed_symbols))

            while self._running:
                self._process_pending_commands()
                deadline_ts = time.time() + UPDATE_LOOP_DEADLINE
                updated = self._api.wait_update(deadline=deadline_ts)
                if updated:
                    self._last_update_at = time.time()
                    self._on_update()
        finally:
            try:
                self._api.close()
            except Exception:
                pass
            self._api = None

    def _process_pending_commands(self):
        processed = 0
        while processed < 20:
            try:
                cmd = self._cmd_queue.get_nowait()
            except queue.Empty:
                break
            try:
                self._handle_command(cmd)
            except Exception as e:
                logger.error("Command '%s' failed: %s", cmd.action, e)
                cmd.set_error(str(e))
            processed += 1

    def _handle_command(self, cmd: Command):
        if self._api is None:
            cmd.set_error("api_not_ready")
            return

        action = cmd.action
        params = cmd.params

        if action == "subscribe":
            result = self._cmd_subscribe(params.get("symbols", []))
            cmd.set_result(result)

        elif action == "unsubscribe":
            result = self._cmd_unsubscribe(params.get("symbols", []))
            cmd.set_result(result)

        elif action == "get_quote":
            result = self._extract_quote(params.get("symbol", ""))
            cmd.set_result(result)

        elif action == "get_all_quotes":
            result = []
            for s in list(self._quotes.keys()):
                q = self._extract_quote(s)
                if q:
                    result.append(q)
            cmd.set_result(result)

        elif action == "get_klines":
            symbol = params.get("symbol", "")
            duration = params.get("duration_seconds", 60)
            data_length = params.get("data_length", 200)
            key = f"{symbol}_{duration}_{data_length}"
            if key not in self._klines:
                df = self._api.get_kline_serial(symbol, duration, data_length=data_length)
                self._klines[key] = df
            cmd.set_result(self._klines[key])

        elif action == "get_ticks":
            symbol = params.get("symbol", "")
            data_length = params.get("data_length", 200)
            key = f"{symbol}_{data_length}"
            if key not in self._ticks:
                df = self._api.get_tick_serial(symbol, data_length=data_length)
                self._ticks[key] = df
            cmd.set_result(self._ticks[key])

        elif action == "query_quotes":
            exchange_id = params.get("exchange_id")
            product_id = params.get("product_id")
            ins_class = params.get("ins_class")
            expired = params.get("expired", False)
            try:
                symbols = self._api.query_quotes(
                    ins_class=ins_class,
                    exchange_id=exchange_id,
                    product_id=product_id,
                    expired=expired,
                )
                symbol_list = list(symbols)[:50]
                if symbol_list:
                    try:
                        info_df = self._api.query_symbol_info(symbol_list)
                        infos: list[SymbolInfo] = []
                        for s in symbol_list:
                            row = None
                            if not info_df.empty and s in info_df.index:
                                row = info_df.loc[s]
                            infos.append(
                                SymbolInfo(
                                    symbol=s,
                                    instrument_name=row.get("instrument_name") if row is not None else None,
                                    ins_class=row.get("ins_class") if row is not None else None,
                                    exchange_id=row.get("exchange_id") if row is not None else None,
                                    price_tick=self._safe_float(row.get("price_tick")) if row is not None else None,
                                    volume_multiple=self._safe_float(row.get("volume_multiple")) if row is not None else None,
                                )
                            )
                        cmd.set_result(infos)
                        return
                    except Exception as e:
                        logger.warning("query_symbol_info failed, falling back: %s", e)
                cmd.set_result([SymbolInfo(symbol=s) for s in symbol_list])
            except Exception as e:
                cmd.set_error(f"query_failed: {e}")

        else:
            cmd.set_error(f"unknown_action: {action}")

    def _cmd_subscribe(self, symbols: list[str]) -> tuple[list[str], list[str]]:
        subscribed = []
        already = []
        for s in symbols:
            if s in self._quotes:
                already.append(s)
                continue
            if len(self._subscribed_symbols) >= MAX_TOTAL_SUBSCRIPTIONS:
                logger.warning("Max subscriptions reached (%d)", MAX_TOTAL_SUBSCRIPTIONS)
                break
            try:
                q = self._api.get_quote(s)
                self._quotes[s] = q
                self._subscribed_symbols.add(s)
                subscribed.append(s)
                logger.info("Subscribed: %s", s)
            except Exception as e:
                logger.error("Subscribe failed for %s: %s", s, e)
        if subscribed:
            self._save_persisted_subscriptions()
        return subscribed, already

    def _cmd_unsubscribe(self, symbols: list[str]) -> tuple[list[str], list[str]]:
        unsubscribed = []
        not_subscribed = []
        for s in symbols:
            if s in self._quotes:
                del self._quotes[s]
                self._subscribed_symbols.discard(s)
                unsubscribed.append(s)
                logger.info("Unsubscribed: %s", s)
                keys_to_del = [k for k in self._klines if k.startswith(f"{s}_")]
                for k in keys_to_del:
                    del self._klines[k]
                keys_to_del = [k for k in self._ticks if k.startswith(f"{s}_")]
                for k in keys_to_del:
                    del self._ticks[k]
            else:
                not_subscribed.append(s)
        if unsubscribed:
            self._save_persisted_subscriptions()
        return unsubscribed, not_subscribed

    def _on_update(self):
        changed_symbols = []
        for symbol, quote in self._quotes.items():
            if self._api.is_changing(quote, ["last_price", "ask_price1", "bid_price1", "datetime"]):
                changed_symbols.append(symbol)

        if not changed_symbols:
            return

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

    def _extract_quote(self, symbol: str) -> Optional[QuoteData]:
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
                ask_price2=self._safe_float(getattr(quote, "ask_price2", None)),
                ask_price3=self._safe_float(getattr(quote, "ask_price3", None)),
                ask_price4=self._safe_float(getattr(quote, "ask_price4", None)),
                ask_price5=self._safe_float(getattr(quote, "ask_price5", None)),
                ask_volume1=self._safe_int(getattr(quote, "ask_volume1", None)),
                ask_volume2=self._safe_int(getattr(quote, "ask_volume2", None)),
                ask_volume3=self._safe_int(getattr(quote, "ask_volume3", None)),
                ask_volume4=self._safe_int(getattr(quote, "ask_volume4", None)),
                ask_volume5=self._safe_int(getattr(quote, "ask_volume5", None)),
                bid_price1=self._safe_float(getattr(quote, "bid_price1", None)),
                bid_price2=self._safe_float(getattr(quote, "bid_price2", None)),
                bid_price3=self._safe_float(getattr(quote, "bid_price3", None)),
                bid_price4=self._safe_float(getattr(quote, "bid_price4", None)),
                bid_price5=self._safe_float(getattr(quote, "bid_price5", None)),
                bid_volume1=self._safe_int(getattr(quote, "bid_volume1", None)),
                bid_volume2=self._safe_int(getattr(quote, "bid_volume2", None)),
                bid_volume3=self._safe_int(getattr(quote, "bid_volume3", None)),
                bid_volume4=self._safe_int(getattr(quote, "bid_volume4", None)),
                bid_volume5=self._safe_int(getattr(quote, "bid_volume5", None)),
                open=self._safe_float(getattr(quote, "open", None)),
                high=self._safe_float(getattr(quote, "highest", None)),
                low=self._safe_float(getattr(quote, "lowest", None)),
                close=self._safe_float(getattr(quote, "close", None)),
                average=self._safe_float(getattr(quote, "average", None)),
                volume=self._safe_float(getattr(quote, "volume", None)),
                amount=self._safe_float(getattr(quote, "amount", None)),
                open_interest=self._safe_float(getattr(quote, "open_interest", None)),
                price_tick=self._safe_float(getattr(quote, "price_tick", None)),
                volume_multiple=self._safe_float(getattr(quote, "volume_multiple", None)),
                highest=self._safe_float(getattr(quote, "highest", None)),
                lowest=self._safe_float(getattr(quote, "lowest", None)),
                expired=getattr(quote, "expired", None),
            )
        except Exception as e:
            logger.error("Extract quote failed for %s: %s", symbol, e)
            return None

    def _load_persisted_subscriptions(self):
        if not PERSIST_SUBSCRIPTIONS:
            return
        try:
            if os.path.exists(SUBSCRIPTIONS_FILE):
                with open(SUBSCRIPTIONS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                symbols = data.get("symbols", [])
                if isinstance(symbols, list):
                    for s in symbols:
                        if isinstance(s, str):
                            self._subscribed_symbols.add(s)
                if self._subscribed_symbols:
                    logger.info("Loaded %d persisted subscriptions", len(self._subscribed_symbols))
        except Exception as e:
            logger.warning("Failed to load persisted subscriptions: %s", e)

    def _save_persisted_subscriptions(self):
        if not PERSIST_SUBSCRIPTIONS:
            return
        try:
            data = {"symbols": sorted(self._subscribed_symbols), "saved_at": time.time()}
            tmp_path = SUBSCRIPTIONS_FILE + ".tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, SUBSCRIPTIONS_FILE)
        except Exception as e:
            logger.warning("Failed to save persisted subscriptions: %s", e)

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
