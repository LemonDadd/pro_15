import os
from typing import Optional

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


def _get_bool(name: str, default: bool = False) -> bool:
    val = os.getenv(name, "").strip().lower()
    return val in ("1", "true", "yes", "on")


def _get_int(name: str, default: int = 0) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (ValueError, TypeError):
        return default


TQ_AUTH_USER = os.getenv("TQ_AUTH_USER", "").strip()
TQ_AUTH_PASSWORD = os.getenv("TQ_AUTH_PASSWORD", "").strip()

HOST = os.getenv("HOST", "0.0.0.0")
PORT = _get_int("PORT", 8000)

UPDATE_LOOP_DEADLINE = float(os.getenv("UPDATE_LOOP_DEADLINE", "5"))
STARTUP_TIMEOUT = float(os.getenv("STARTUP_TIMEOUT", "60"))

DEFAULT_STOCK_SYMBOLS_STR = os.getenv(
    "DEFAULT_STOCK_SYMBOLS", "SSE.600000,SSE.600519,SZSE.000001"
).strip()
DEFAULT_STOCK_SYMBOLS: list[str] = [
    s.strip() for s in DEFAULT_STOCK_SYMBOLS_STR.split(",") if s.strip()
]

MAX_SUBSCRIBE_PER_REQUEST = _get_int("MAX_SUBSCRIBE_PER_REQUEST", 50)
MAX_TOTAL_SUBSCRIPTIONS = _get_int("MAX_TOTAL_SUBSCRIPTIONS", 500)

PERSIST_SUBSCRIPTIONS = _get_bool("PERSIST_SUBSCRIPTIONS", False)
SUBSCRIPTIONS_FILE = os.getenv("SUBSCRIPTIONS_FILE", "./subscriptions.json")

API_KEY = os.getenv("API_KEY", "").strip()

MAX_WS_QUEUE_SIZE = _get_int("MAX_WS_QUEUE_SIZE", 100)


def validate_auth() -> Optional[str]:
    """校验鉴权配置，返回错误信息（None 表示通过）。"""
    if not TQ_AUTH_USER:
        return "auth_missing"
    if not TQ_AUTH_PASSWORD:
        return "auth_missing"
    return None
