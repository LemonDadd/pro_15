from typing import Optional

from pydantic import BaseModel


class QuoteData(BaseModel):
    symbol: str
    datetime: Optional[str] = None
    instrument_name: Optional[str] = None
    last_price: Optional[float] = None
    ask_price1: Optional[float] = None
    ask_volume1: Optional[int] = None
    bid_price1: Optional[float] = None
    bid_volume1: Optional[int] = None
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


class SubscribeRequest(BaseModel):
    symbols: list[str]


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
    exchange_id: Optional[str] = None
    product_id: Optional[str] = None
    ins_class: Optional[str] = None
    expired: bool = False
