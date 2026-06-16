import { useState, useEffect, useCallback } from 'react';
import Header from '../components/Header';
import QuoteList from '../components/QuoteList';
import SearchModal from '../components/SearchModal';
import { useAppStore } from '../store/useAppStore';
import { Activity, TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';

const DashboardPage = () => {
  const [searchOpen, setSearchOpen] = useState(false);
  const { fetchQuotes, wsStatus, quotes, subscribedSymbols } = useAppStore();

  const stableFetchQuotes = useCallback(() => {
    fetchQuotes();
  }, [fetchQuotes]);

  useEffect(() => {
    stableFetchQuotes();
  }, [stableFetchQuotes]);

  useEffect(() => {
    if (wsStatus === 'connected') return;

    const timer = setInterval(stableFetchQuotes, 10000);
    return () => clearInterval(timer);
  }, [wsStatus, stableFetchQuotes]);

  const stats = (() => {
    let up = 0;
    let down = 0;
    let totalVolume = 0;
    let totalAmount = 0;

    subscribedSymbols.forEach((s) => {
      const q = quotes[s];
      if (q) {
        if (q.last_price != null && q.open != null) {
          if (q.last_price > q.open) up++;
          else if (q.last_price < q.open) down++;
        }
        if (q.volume) totalVolume += q.volume;
        if (q.amount) totalAmount += q.amount;
      }
    });

    return { up, down, totalVolume, totalAmount };
  })();

  const formatNumber = (num: number, unit: string = '') => {
    if (num >= 100000000) return (num / 100000000).toFixed(2) + '亿' + unit;
    if (num >= 10000) return (num / 10000).toFixed(2) + '万' + unit;
    return num.toFixed(2) + unit;
  };

  return (
    <div className="min-h-screen bg-night-950">
      <Header onSearchClick={() => setSearchOpen(true)} />

      <main className="pt-20 pb-8 px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="glass rounded-xl p-4 card-hover">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">已订阅</span>
              <div className="w-8 h-8 rounded-lg bg-cyan-400/10 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-cyan-400" />
              </div>
            </div>
            <p className="text-2xl font-bold text-white font-mono">
              {subscribedSymbols.length}
              <span className="text-sm font-normal text-gray-500 ml-1">只</span>
            </p>
          </div>

          <div className="glass rounded-xl p-4 card-hover">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">上涨</span>
              <div className="w-8 h-8 rounded-lg bg-up/10 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-up" />
              </div>
            </div>
            <p className="text-2xl font-bold text-up font-mono">
              {stats.up}
              <span className="text-sm font-normal text-gray-500 ml-1">只</span>
            </p>
          </div>

          <div className="glass rounded-xl p-4 card-hover">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">下跌</span>
              <div className="w-8 h-8 rounded-lg bg-down/10 flex items-center justify-center">
                <TrendingDown className="w-4 h-4 text-down" />
              </div>
            </div>
            <p className="text-2xl font-bold text-down font-mono">
              {stats.down}
              <span className="text-sm font-normal text-gray-500 ml-1">只</span>
            </p>
          </div>

          <div className="glass rounded-xl p-4 card-hover">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">总成交量</span>
              <div className="w-8 h-8 rounded-lg bg-amber-400/10 flex items-center justify-center">
                <Activity className="w-4 h-4 text-amber-400" />
              </div>
            </div>
            <p className="text-2xl font-bold text-white font-mono text-sm md:text-base">
              {formatNumber(stats.totalVolume)}
            </p>
          </div>
        </div>

        {wsStatus !== 'connected' && (
          <div className="mb-4 p-3 glass-light rounded-lg flex items-center gap-2 text-sm">
            {wsStatus === 'connecting' && (
              <>
                <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                <span className="text-cyan-400">正在连接行情服务器...</span>
              </>
            )}
            {wsStatus === 'reconnecting' && (
              <>
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-amber-400">连接中断，正在重连...</span>
              </>
            )}
            {wsStatus === 'disconnected' && (
              <>
                <div className="w-2 h-2 rounded-full bg-down" />
                <span className="text-down">行情服务未连接</span>
              </>
            )}
          </div>
        )}

        <QuoteList />
      </main>

      <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
};

export default DashboardPage;
