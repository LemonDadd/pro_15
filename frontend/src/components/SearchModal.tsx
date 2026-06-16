import { useState, useEffect, useRef } from 'react';
import { Search, X, Plus, Check, Loader } from 'lucide-react';
import { apiService } from '../services/apiService';
import type { SymbolInfo } from '../types';
import { useAppStore } from '../store/useAppStore';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SearchModal = ({ isOpen, onClose }: SearchModalProps) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SymbolInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { subscribe, subscribedSymbols } = useAppStore();

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setResults([]);
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

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await apiService.querySymbols({
          ins_class: null,
          exchange_id: null,
          expired: false,
        });
        const filtered = data.filter(
          (s) =>
            s.symbol.toLowerCase().includes(query.toLowerCase()) ||
            (s.instrument_name || '').toLowerCase().includes(query.toLowerCase())
        );
        setResults(filtered.slice(0, 30));
      } catch (error) {
        console.error('Search error:', error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const handleSubscribe = async (symbol: string) => {
    setSubscribing(symbol);
    try {
      await subscribe([symbol]);
    } catch (error) {
      console.error('Subscribe error:', error);
    } finally {
      setSubscribing(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 搜索框 */}
      <div className="relative w-full max-w-2xl mx-4 glass rounded-2xl shadow-2xl overflow-hidden">
        {/* 搜索输入 */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-night-600/50">
          <Search className="w-5 h-5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入股票代码或名称搜索..."
            className="flex-1 bg-transparent text-white placeholder-gray-500 outline-none text-lg"
          />
          {loading && <Loader className="w-5 h-5 text-cyan-400 animate-spin" />}
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 搜索结果 */}
        <div className="max-h-[50vh] overflow-y-auto">
          {results.length === 0 && !loading && query.trim() && (
            <div className="py-12 text-center text-gray-500">
              未找到相关合约
            </div>
          )}

          {results.length === 0 && !loading && !query.trim() && (
            <div className="py-8 px-5">
              <p className="text-sm text-gray-500 mb-3">快捷选择</p>
              <div className="flex flex-wrap gap-2">
                {['SSE.600000', 'SSE.600519', 'SZSE.000001', 'SZSE.300750'].map(
                  (s) => (
                    <button
                      key={s}
                      onClick={() => setQuery(s)}
                      className="px-3 py-1.5 text-sm bg-night-700/50 rounded-lg text-gray-300 hover:bg-night-600/50 transition-colors"
                    >
                      {s}
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {results.map((item) => {
            const isSubscribed = subscribedSymbols.includes(item.symbol);
            const isSubscribing = subscribing === item.symbol;

            return (
              <div
                key={item.symbol}
                className="flex items-center justify-between px-5 py-3 hover:bg-night-700/30 transition-colors border-b border-night-700/30 last:border-b-0"
              >
                <div>
                  <p className="font-mono font-medium text-white">
                    {item.symbol}
                  </p>
                  <p className="text-sm text-gray-500">
                    {item.instrument_name || '--'}
                    {item.exchange_id && (
                      <span className="ml-2 text-xs text-gray-600">
                        {item.exchange_id}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => handleSubscribe(item.symbol)}
                  disabled={isSubscribed || isSubscribing}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    isSubscribed
                      ? 'bg-up/10 text-up cursor-default'
                      : isSubscribing
                      ? 'bg-night-600 text-gray-400 cursor-wait'
                      : 'bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20'
                  }`}
                >
                  {isSubscribed ? (
                    <span className="flex items-center gap-1">
                      <Check className="w-4 h-4" />
                      已订阅
                    </span>
                  ) : isSubscribing ? (
                    <span className="flex items-center gap-1">
                      <Loader className="w-4 h-4 animate-spin" />
                      订阅中
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Plus className="w-4 h-4" />
                      订阅
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* 底部提示 */}
        <div className="px-5 py-2 border-t border-night-600/50 flex items-center justify-between text-xs text-gray-500">
          <span>按 ESC 关闭</span>
          <span>最多显示 30 条结果</span>
        </div>
      </div>
    </div>
  );
};

export default SearchModal;
