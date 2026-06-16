import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { QuoteData, WsStatus } from '../types';
import { apiService } from '../services/apiService';
import { wsService } from '../services/wsService';

interface AppState {
  // Auth
  isAuthenticated: boolean;
  username: string | null;

  // Quotes
  quotes: Record<string, QuoteData>;
  subscribedSymbols: string[];

  // WS status
  wsStatus: WsStatus;

  // Current
  currentSymbol: string | null;

  // Auth actions
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;

  // Quote actions
  fetchQuotes: () => Promise<void>;
  subscribe: (symbols: string[]) => Promise<void>;
  unsubscribe: (symbols: string[]) => Promise<void>;
  updateQuote: (quote: QuoteData) => void;

  // Current
  setCurrentSymbol: (symbol: string) => void;

  // WS
  connectWs: () => void;
  disconnectWs: () => void;
  setWsStatus: (status: WsStatus) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      username: null,
      quotes: {},
      subscribedSymbols: [],
      wsStatus: 'disconnected',
      currentSymbol: null,

      login: async (username: string, password: string): Promise<boolean> => {
        try {
          // 保存认证信息到 localStorage（模拟登录）
          localStorage.setItem(
            'tq_auth_token',
            JSON.stringify({ username, password })
          );

          // 通过健康检查验证引擎是否可用
          const health = await apiService.getHealth();

          if (health.status === 'unavailable' && health.error === 'auth_missing') {
            // 后端未配置鉴权，前端登录成功但需要等后端
            set({ isAuthenticated: true, username });
            return true;
          }

          if (health.engine_ready) {
            set({ isAuthenticated: true, username });
            // 连接 WebSocket
            get().connectWs();
            // 获取已订阅列表
            await get().fetchQuotes();
            return true;
          }

          // 引擎还没准备好，也算登录成功，让用户进入页面看加载状态
          set({ isAuthenticated: true, username });
          get().connectWs();
          return true;
        } catch (error) {
          console.error('Login error:', error);
          // 即使请求失败，也让用户进入（后端可能还没启动）
          set({ isAuthenticated: true, username });
          get().connectWs();
          return true;
        }
      },

      logout: () => {
        localStorage.removeItem('tq_auth_token');
        get().disconnectWs();
        set({
          isAuthenticated: false,
          username: null,
          quotes: {},
          subscribedSymbols: [],
          currentSymbol: null,
        });
      },

      fetchQuotes: async () => {
        try {
          const quotes = await apiService.getAllQuotes();
          const quoteMap: Record<string, QuoteData> = {};
          quotes.forEach((q) => {
            quoteMap[q.symbol] = q;
          });
          const symbols = quotes.map((q) => q.symbol);
          set({ quotes: quoteMap, subscribedSymbols: symbols });
        } catch (error) {
          console.error('Fetch quotes error:', error);
        }
      },

      subscribe: async (symbols: string[]) => {
        try {
          const result = await apiService.subscribe(symbols);
          const allSymbols = [...new Set([...get().subscribedSymbols, ...result.subscribed, ...result.already_subscribed])];
          set({ subscribedSymbols: allSymbols });
          // WS 也发送订阅
          wsService.subscribe(symbols);
          // 重新获取行情
          await get().fetchQuotes();
        } catch (error) {
          console.error('Subscribe error:', error);
          throw error;
        }
      },

      unsubscribe: async (symbols: string[]) => {
        try {
          const result = await apiService.unsubscribe(symbols);
          const remaining = get().subscribedSymbols.filter(
            (s) => !result.unsubscribed.includes(s)
          );
          const newQuotes = { ...get().quotes };
          result.unsubscribed.forEach((s) => {
            delete newQuotes[s];
          });
          set({ subscribedSymbols: remaining, quotes: newQuotes });
          // WS 也取消订阅
          wsService.unsubscribe(symbols);
        } catch (error) {
          console.error('Unsubscribe error:', error);
          throw error;
        }
      },

      updateQuote: (quote: QuoteData) => {
        set((state) => ({
          quotes: {
            ...state.quotes,
            [quote.symbol]: quote,
          },
        }));
      },

      setCurrentSymbol: (symbol: string) => {
        set({ currentSymbol: symbol });
      },

      connectWs: () => {
        wsService.connect();
        wsService.onStatus((status) => {
          set({ wsStatus: status });
        });
        wsService.onMessage((message) => {
          if (message.type === 'quote_update' && message.data) {
            get().updateQuote(message.data);
          }
        });
      },

      disconnectWs: () => {
        wsService.disconnect();
      },

      setWsStatus: (status: WsStatus) => {
        set({ wsStatus: status });
      },
    }),
    {
      name: 'tq-market-storage',
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        username: state.username,
        currentSymbol: state.currentSymbol,
      }),
    }
  )
);

export default useAppStore;
