import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Plus, Check, Loader } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { apiService } from '../services/apiService';
import type { SymbolInfo } from '../types';

const QUICK_STOCKS = [
  { symbol: 'SSE.600000', name: '浦发银行' },
  { symbol: 'SSE.600519', name: '贵州茅台' },
  { symbol: 'SZSE.000001', name: '平安银行' },
  { symbol: 'SZSE.300750', name: '宁德时代' },
  { symbol: 'SSE.601318', name: '中国平安' },
  { symbol: 'SZSE.000858', name: '五粮液' },
  { symbol: 'SSE.600036', name: '招商银行' },
  { symbol: 'SSE.601012', name: '隆基绿能' },
];

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SearchModal = ({ isOpen, onClose }: SearchModalProps) => {
  const [inputValue, setInputValue] = useState('');
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [searchResults, setSearchResults] = useState<SymbolInfo[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { subscribe, subscribedSymbols } = useAppStore();

  const doSearch = useCallback(async (value: string) => {
    const match = value.match(/^(SSE|SZSE|DCE|SHFE|CZCE|INE|GFEX)\./i);
    if (!match) {
      setSearchResults([]);
      return;
    }
    const exchangeId = match[1].toUpperCase();
    setSearching(true);
    try {
      const results = await apiService.querySymbols({ exchange_id: exchangeId });
      const filtered = results.filter(
        (r) => r.symbol.toLowerCase().startsWith(value.toLowerCase())
      );
      setSearchResults(filtered.slice(0, 50));
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    const trimmed = inputValue.trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }
    searchTimerRef.current = setTimeout(() => {
      doSearch(trimmed);
    }, 300);
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, [inputValue, doSearch]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setInputValue('');
      setError('');
      setSearchResults([]);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSubscribe = async (symbol: string) => {
    const trimmed = symbol.trim().toUpperCase();
    if (!trimmed) return;

    if (subscribedSymbols.includes(trimmed)) return;

    setSubscribing(trimmed);
    setError('');
    try {
      await subscribe([trimmed]);
    } catch (err) {
      console.error('Subscribe error:', err);
      setError('订阅失败，请检查合约代码');
    } finally {
      setSubscribing(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSubscribe(inputValue);
  };

  const handleQuickAdd = (symbol: string) => {
    handleSubscribe(symbol);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-2xl mx-4 glass rounded-2xl shadow-2xl overflow-hidden">
        <form onSubmit={handleSubmit}>
          <div className="flex items-center gap-3 px-5 py-4 border-b border-night-600/50">
            <Search className="w-5 h-5 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="输入合约代码订阅，如 SSE.600000"
              className="flex-1 bg-transparent text-white placeholder-gray-500 outline-none text-lg"
            />
            {subscribing && (
              <Loader className="w-5 h-5 text-cyan-400 animate-spin" />
            )}
            <button
              type="submit"
              disabled={
                !inputValue.trim() ||
                subscribedSymbols.includes(inputValue.trim().toUpperCase()) ||
                !!subscribing
              }
              className="px-4 py-1.5 bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Plus className="w-4 h-4" />
              订阅
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </form>

        {error && (
          <div className="px-5 py-2 text-sm text-down bg-down/10">
            {error}
          </div>
        )}

        <div className="px-5 py-4">
          <p className="text-sm text-gray-500 mb-3">快捷订阅</p>
          <div className="grid grid-cols-2 gap-2">
            {QUICK_STOCKS.map((stock) => {
              const isSubscribed = subscribedSymbols.includes(stock.symbol);
              const isSubscribing = subscribing === stock.symbol;

              return (
                <div
                  key={stock.symbol}
                  className="flex items-center justify-between p-3 rounded-lg bg-night-700/30 hover:bg-night-700/50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm text-white truncate">
                      {stock.symbol}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {stock.name}
                    </p>
                  </div>
                  <button
                    onClick={() => handleQuickAdd(stock.symbol)}
                    disabled={isSubscribed || isSubscribing}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex-shrink-0 ml-2 ${
                      isSubscribed
                        ? 'bg-up/10 text-up cursor-default'
                        : isSubscribing
                        ? 'bg-night-600 text-gray-400 cursor-wait'
                        : 'bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20'
                    }`}
                  >
                    {isSubscribed ? (
                      <span className="flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        已订阅
                      </span>
                    ) : isSubscribing ? (
                      <span className="flex items-center gap-1">
                        <Loader className="w-3 h-3 animate-spin" />
                        订阅中
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Plus className="w-3 h-3" />
                        订阅
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {(searching || searchResults.length > 0) && (
          <div className="px-5 py-4 border-t border-night-600/50">
            <p className="text-sm text-gray-500 mb-3">
              {searching ? '搜索中...' : '搜索结果'}
            </p>
            {searching && (
              <div className="flex items-center justify-center py-4">
                <Loader className="w-5 h-5 text-cyan-400 animate-spin" />
              </div>
            )}
            {!searching && searchResults.length > 0 && (
              <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                {searchResults.map((item) => {
                  const isSubscribed = subscribedSymbols.includes(item.symbol);
                  const isSubscribing = subscribing === item.symbol;
                  return (
                    <div
                      key={item.symbol}
                      className="flex items-center justify-between p-3 rounded-lg bg-night-700/30 hover:bg-night-700/50 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-sm text-white truncate">
                          {item.symbol}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {item.instrument_name || '-'}
                        </p>
                      </div>
                      <button
                        onClick={() => handleSubscribe(item.symbol)}
                        disabled={isSubscribed || isSubscribing}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex-shrink-0 ml-2 ${
                          isSubscribed
                            ? 'bg-up/10 text-up cursor-default'
                            : isSubscribing
                            ? 'bg-night-600 text-gray-400 cursor-wait'
                            : 'bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20'
                        }`}
                      >
                        {isSubscribed ? (
                          <span className="flex items-center gap-1">
                            <Check className="w-3 h-3" />
                            已订阅
                          </span>
                        ) : isSubscribing ? (
                          <span className="flex items-center gap-1">
                            <Loader className="w-3 h-3 animate-spin" />
                            订阅中
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <Plus className="w-3 h-3" />
                            订阅
                          </span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="px-5 py-2 border-t border-night-600/50 flex items-center justify-between text-xs text-gray-500">
          <span>输入完整合约代码后点击订阅或按 Enter</span>
          <span>按 ESC 关闭</span>
        </div>
      </div>
    </div>
  );
};

export default SearchModal;
