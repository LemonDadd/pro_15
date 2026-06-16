export interface QuoteData {
  symbol: string;
  datetime: string | null;
  instrument_name: string | null;
  last_price: number | null;
  ask_price1: number | null;
  ask_volume1: number | null;
  bid_price1: number | null;
  bid_volume1: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  average: number | null;
  volume: number | null;
  amount: number | null;
  open_interest: number | null;
  price_tick: number | null;
  volume_multiple: number | null;
  highest: number | null;
  lowest: number | null;
  expired: boolean | null;
}

export interface KlineData {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  open_oi: number | null;
  close_oi: number | null;
}

export interface KlineResponse {
  symbol: string;
  duration_seconds: number;
  data: KlineData[];
}

export interface TickData {
  datetime: string;
  last_price: number | null;
  ask_price1: number | null;
  bid_price1: number | null;
  highest: number | null;
  lowest: number | null;
  volume: number | null;
  amount: number | null;
  open_interest: number | null;
}

export interface TickResponse {
  symbol: string;
  data_length: number;
  data: TickData[];
}

export interface SymbolInfo {
  symbol: string;
  instrument_name: string | null;
  ins_class: string | null;
  exchange_id: string | null;
  price_tick: number | null;
  volume_multiple: number | null;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'unavailable';
  engine_ready: boolean;
  error: 'auth_missing' | 'auth_failed' | 'connect_timeout' | null;
  subscribed_symbols: string[];
  last_update_at: string | null;
}

export interface SubscribeRequest {
  symbols: string[];
}

export interface SubscribeResponse {
  subscribed: string[];
  already_subscribed: string[];
}

export interface UnsubscribeResponse {
  unsubscribed: string[];
  not_subscribed: string[];
}

export interface QuerySymbolsRequest {
  exchange_id?: string | null;
  product_id?: string | null;
  ins_class?: string | null;
  expired?: boolean;
}

export type WsMessageType =
  | 'quote_update'
  | 'subscribe_result'
  | 'unsubscribe_result'
  | 'ping'
  | 'pong'
  | 'error';

export interface WsMessage {
  type: WsMessageType;
  data?: QuoteData;
  subscribed?: string[];
  already_subscribed?: string[];
  unsubscribed?: string[];
  not_subscribed?: string[];
  message?: string;
}

export type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
