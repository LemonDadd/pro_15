import axios from 'axios';
import type {
  HealthResponse,
  QuoteData,
  KlineResponse,
  TickResponse,
  SymbolInfo,
  SubscribeRequest,
  SubscribeResponse,
  UnsubscribeResponse,
  QuerySymbolsRequest,
} from '../types';

const baseURL = '/api';

const api = axios.create({
  baseURL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('tq_auth_token');
  if (token) {
    try {
      const { username, password } = JSON.parse(token);
      if (username && password) {
        // 将认证信息编码在自定义头中，后端可以通过中间件读取
        config.headers['X-TQ-User'] = encodeURIComponent(username);
      }
    } catch {
      // ignore
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('tq_auth_token');
    }
    return Promise.reject(error);
  }
);

export const apiService = {
  async getHealth(): Promise<HealthResponse> {
    const { data } = await api.get<HealthResponse>('/health');
    return data;
  },

  async subscribe(symbols: string[]): Promise<SubscribeResponse> {
    const { data } = await api.post<SubscribeResponse>('/subscribe', {
      symbols,
    } as SubscribeRequest);
    return data;
  },

  async unsubscribe(symbols: string[]): Promise<UnsubscribeResponse> {
    const { data } = await api.delete<UnsubscribeResponse>('/unsubscribe', {
      params: { symbols: symbols.join(',') },
    });
    return data;
  },

  async getQuote(symbol: string): Promise<QuoteData | null> {
    const { data } = await api.get<QuoteData | null>(`/quote/${symbol}`);
    return data;
  },

  async getAllQuotes(): Promise<QuoteData[]> {
    const { data } = await api.get<QuoteData[]>('/quotes');
    return data;
  },

  async getKlines(
    symbol: string,
    duration_seconds: number = 60,
    data_length: number = 200
  ): Promise<KlineResponse | null> {
    const { data } = await api.get<KlineResponse | null>(`/klines/${symbol}`, {
      params: { duration_seconds, data_length },
    });
    return data;
  },

  async getTicks(
    symbol: string,
    data_length: number = 200
  ): Promise<TickResponse | null> {
    const { data } = await api.get<TickResponse | null>(`/ticks/${symbol}`, {
      params: { data_length },
    });
    return data;
  },

  async getSubscribedSymbols(): Promise<{ symbols: string[] }> {
    const { data } = await api.get<{ symbols: string[] }>('/symbols');
    return data;
  },

  async querySymbols(req: QuerySymbolsRequest): Promise<SymbolInfo[]> {
    const { data } = await api.post<SymbolInfo[]>('/query_symbols', req);
    return data;
  },
};

export default api;
