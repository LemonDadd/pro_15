import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { QuoteData, WsStatus } from '../types';
import { apiService } from '../services/apiService';
import { wsService } from '../services/wsService';

interface LoginResult {
  success: boolean;
  error?: string;
  engineStarting?: boolean;
}

interface AppState {
  isAuthenticated: boolean;
  username: string | null;
  token: string | null;
  quotes: Record<string, QuoteData>;
  subscribedSymbols: string[];
  wsStatus: WsStatus;
  currentSymbol: string | null;
  engineReady: boolean;
  engineError: string | null;

  login: (username: string, password: string) => Promise<LoginResult>;
  logout: () => void;
  fetchQuotes: () => Promise<void>;
  subscribe: (symbols: string[]) => Promise<void>;
  unsubscribe: (symbols: string[]) => Promise<void>;
  updateQuote: (quote: QuoteData) => void;
  setCurrentSymbol: (symbol: string) => void;
  setEngineReady: (ready: boolean) => void;
  setEngineError: (error: string | null) => void;
  connectWs: () => void;
  disconnectWs: () => void;
  checkAuthStatus: () => Promise<void>;
}

let wsUnsubMessage: (() => void) | null = null;
let wsUnsubStatus: (() => void) | null = null;

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      username: null,
      token: null,
      quotes: {},
      subscribedSymbols: [],
      wsStatus: 'disconnected',
      currentSymbol: null,
      engineReady: false,
      engineError: null,

      login: async (username: string, password: string): Promise<LoginResult> => {
        try {
          const result = await apiService.login(username, password);

          if (!result.success) {
            localStorage.removeItem('tq_auth_token');
            return { success: false, error: result.error || '账号或密码错误' };
          }

          const token = result.token;
          if (!token) {
            return { success: false, error: '登录失败，未获取到 token' };
          }

          set({
            isAuthenticated: true,
            username,
            token,
            engineReady: false,
            engineError: result.error || null,
          });

          get().connectWs();

          let engineStarting = false;
          try {
            const health = await apiService.getHealth();
            set({
              engineReady: health.engine_ready,
              engineError: health.error,
            });
            if (!health.engine_ready) {
              engineStarting = true;
            }
            await get().fetchQuotes();
          } catch {
            engineStarting = true;
          }

          if (result.error) {
            engineStarting = true;
          }

          return { success: true, engineStarting };
        } catch (error: any) {
          localStorage.removeItem('tq_auth_token');
          const msg = error?.response?.data?.detail || error?.response?.data?.error || error?.message;
          return { success: false, error: msg || '登录失败，请稍后重试' };
        }
      },

      logout: () => {
        localStorage.removeItem('tq_auth_token');
        get().disconnectWs();
        set({
          isAuthenticated: false,
          username: null,
          token: null,
          quotes: {},
          subscribedSymbols: [],
          currentSymbol: null,
          engineReady: false,
          engineError: null,
        });
      },

      checkAuthStatus: async () => {
        try {
          const status = await apiService.getAuthStatus();
          set({
            engineReady: status.engine_ready,
            engineError: status.error || null,
          });
        } catch (error) {
          console.error('Check auth status error:', error);
        }
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
          const allSymbols = [
            ...new Set([
              ...get().subscribedSymbols,
              ...result.subscribed,
              ...result.already_subscribed,
            ]),
          ];
          set({ subscribedSymbols: allSymbols });
          wsService.subscribe(symbols);
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

      setEngineReady: (ready: boolean) => {
        set({ engineReady: ready });
      },

      setEngineError: (error: string | null) => {
        set({ engineError: error });
      },

      connectWs: () => {
        const token = get().token;
        if (!token) {
          console.error('No token available for WebSocket connection');
          return;
        }

        if (wsUnsubMessage) {
          wsUnsubMessage();
        }
        if (wsUnsubStatus) {
          wsUnsubStatus();
        }

        wsService.connect(token);

        wsUnsubStatus = wsService.onStatus((status) => {
          set({ wsStatus: status });
          if (status === 'connected') {
            const symbols = get().subscribedSymbols;
            if (symbols.length > 0) {
              wsService.subscribe(symbols);
            }
          }
        });

        wsUnsubMessage = wsService.onMessage((message) => {
          if (message.type === 'quote_update' && message.data) {
            get().updateQuote(message.data);
          }
          if (message.type === 'subscribe_result') {
            const newSymbols = [
              ...(message.subscribed || []),
              ...(message.already_subscribed || []),
            ];
            if (newSymbols.length > 0) {
              const allSymbols = [
                ...new Set([...get().subscribedSymbols, ...newSymbols]),
              ];
              set({ subscribedSymbols: allSymbols });
            }
          }
        });
      },

      disconnectWs: () => {
        if (wsUnsubMessage) {
          wsUnsubMessage();
          wsUnsubMessage = null;
        }
        if (wsUnsubStatus) {
          wsUnsubStatus();
          wsUnsubStatus = null;
        }
        wsService.disconnect();
      },
    }),
    {
      name: 'tq-market-storage',
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        username: state.username,
        token: state.token,
        currentSymbol: state.currentSymbol,
      }),
    }
  )
);

export default useAppStore;
