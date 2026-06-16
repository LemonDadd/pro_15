from typing import Optional, Literal, Union

from pydantic import BaseModel, Field


class QuoteData(BaseModel):
    symbol: str
    datetime: Optional[str] = None
    instrument_name: Optional[str] = None
    last_price: Optional[float] = None
    ask_price1: Optional[float] = None
    ask_price2: Optional[float] = None
    ask_price3: Optional[float] = None
    ask_price4: Optional[float] = None
    ask_price5: Optional[float] = None
    ask_volume1: Optional[int] = None
    ask_volume2: Optional[int] = None
    ask_volume3: Optional[int] = None
    ask_volume4: Optional[int] = None
    ask_volume5: Optional[int] = None
    bid_price1: Optional[float] = None
    bid_price2: Optional[float] = None
    bid_price3: Optional[float] = None
    bid_price4: Optional[float] = None
    bid_price5: Optional[float] = None
    bid_volume1: Optional[int] = None
    bid_volume2: Optional[int] = None
    bid_volume3: Optional[int] = None
    bid_volume4: Optional[int] = None
    bid_volume5: Optional[int] = None
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    close: Optional[float] = None
    average: Optional[float] = None
    volume: Optional[float] = None
    amount: Optional[float] = None
    open_interest: Optional[float] = None
    price_tick: Optional[float] = None
    volume_multiple: Optional[float] = None
    highest: Optional[float] = None
    lowest: Optional[float] = None
    expired: Optional[bool] = None


class KlineData(BaseModel):
    datetime: Optional[str] = None
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    close: Optional[float] = None
    volume: Optional[float] = None
    open_oi: Optional[float] = None
    close_oi: Optional[float] = None


class KlineResponse(BaseModel):
    symbol: str
    duration_seconds: int
    data: list[KlineData]


class TickData(BaseModel):
    datetime: Optional[str] = None
    last_price: Optional[float] = None
    ask_price1: Optional[float] = None
    bid_price1: Optional[float] = None
    highest: Optional[float] = None
    lowest: Optional[float] = None
    volume: Optional[float] = None
    amount: Optional[float] = None
    open_interest: Optional[float] = None


class TickResponse(BaseModel):
    symbol: str
    data_length: int
    data: list[TickData]


class SubscribeRequest(BaseModel):
    symbols: list[str] = Field(..., description="要订阅的合约代码列表，单次最多 50 只")


class SubscribeResponse(BaseModel):
    subscribed: list[str]
    already_subscribed: list[str]


class UnsubscribeResponse(BaseModel):
    unsubscribed: list[str]
    not_subscribed: list[str]


class SymbolInfo(BaseModel):
    symbol: str
    instrument_name: Optional[str] = None
    ins_class: Optional[str] = None
    exchange_id: Optional[str] = None
    price_tick: Optional[float] = None
    volume_multiple: Optional[float] = None


class QuerySymbolsRequest(BaseModel):
    exchange_id: Optional[str] = Field(None, description="交易所代码，例如 SSE、SZSE、SHFE 等")
    product_id: Optional[str] = Field(None, description="品种代码，例如 600000、rb 等")
    ins_class: Optional[str] = Field(None, description="合约类型，例如 STOCK（股票）、FUTURE（期货）等")
    expired: bool = Field(False, description="是否包含已过期合约")


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded", "unavailable"]
    engine_ready: bool
    error: Optional[Literal["auth_missing", "auth_failed", "connect_timeout"]]
    subscribed_symbols: list[str]
    last_update_at: Optional[str] = None
