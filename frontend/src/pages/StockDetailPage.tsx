import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart3, Clock, DollarSign, Hash } from 'lucide-react';
import Header from '../components/Header';
import SearchModal from '../components/SearchModal';
import KlineChart from '../components/KlineChart';
import { useAppStore } from '../store/useAppStore';
import { apiService } from '../services/apiService';
import type { KlineData } from '../types';

const KLINE_PERIODS = [
  { label: '1分', value: 60 },
  { label: '5分', value: 300 },
  { label: '15分', value: 900 },
  { label: '30分', value: 1800 },
  { label: '1小时', value: 3600 },
  { label: '日线', value: 86400 },
];

const StockDetailPage = () => {
  const { symbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();
  const { quotes, setCurrentSymbol, wsStatus, subscribe, subscribedSymbols } = useAppStore();

  const [searchOpen, setSearchOpen] = useState(false);
  const [period, setPeriod] = useState(3600);
  const [klineData, setKlineData] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState(false);

  const quote = symbol ? quotes[symbol] : null;
  const isSubscribed = symbol ? subscribedSymbols.includes(symbol) : false;

  useEffect(() => {
    if (symbol) {
      setCurrentSymbol(symbol);
      // 如果未订阅，自动订阅
      if (!isSubscribed && wsStatus === 'connected') {
        subscribe([symbol]).catch(() => {});
      }
    }
  }, [symbol, setCurrentSymbol, isSubscribed, wsStatus, subscribe]);

  useEffect(() => {
    if (!symbol) return;

    const fetchKlines = async () => {
      setLoading(true);
      try {
        const resp = await apiService.getKlines(symbol, period, 200);
        if (resp) {
          setKlineData(resp.data);
        }
      } catch (error) {
        console.error('Fetch kline error:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchKlines();
  }, [symbol, period]);

  const changeAmount = useMemo(() => {
    if (!quote || quote.last_price == null || quote.open == null) return null;
    return quote.last_price - quote.open;
  }, [quote]);

  const changePercent = useMemo(() => {
    if (changeAmount == null || !quote?.open || quote.open === 0) return null;
    return (changeAmount / quote.open) * 100;
  }, [changeAmount, quote?.open]);

  const isUp = changeAmount != null && changeAmount >= 0;

  const formatNumber = (num: number | null | undefined, decimals: number = 2) => {
    if (num == null || isNaN(num)) return '--';
    return num.toFixed(decimals);
  };

  const formatVolume = (num: number | null | undefined) => {
    if (num == null || isNaN(num)) return '--';
    if (num >= 100000000) return (num / 100000000).toFixed(2) + '亿';
    if (num >= 10000) return (num / 10000).toFixed(2) + '万';
    return num.toString();
  };

  // 模拟盘口数据
  const orderBook = useMemo(() => {
    if (!quote) return null;
    const price = quote.last_price || 10;
    const tick = quote.price_tick || 0.01;
    const asks = [];
    const bids = [];
    for (let i = 5; i >= 1; i--) {
      asks.push({
        price: price + tick * i,
        volume: Math.floor(Math.random() * 10000) + 1000,
      });
    }
    for (let i = 1; i <= 5; i++) {
      bids.push({
        price: price - tick * i,
        volume: Math.floor(Math.random() * 10000) + 1000,
      });
    }
    return { asks, bids };
  }, [quote]);

  return (
    <div className="min-h-screen bg-night-950">
      <Header onSearchClick={() => setSearchOpen(true)} />

      <main className="pt-20 pb-8 px-6">
        {/* 返回按钮和标题 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-lg hover:bg-night-700/50 text-gray-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h2 className="text-xl font-bold text-white font-mono">
                {symbol || '--'}
              </h2>
              <p className="text-sm text-gray-500">
                {quote?.instrument_name || '加载中...'}
              </p>
            </div>
          </div>

          {quote && (
            <div className="text-right">
              <p className={`text-2xl font-bold font-mono ${isUp ? 'text-up' : 'text-down'}`}>
                {formatNumber(quote.last_price)}
              </p>
              <div className="flex items-center gap-2 justify-end">
                <span className={`text-sm font-mono ${isUp ? 'text-up' : 'text-down'}`}>
                  {changeAmount != null ? (isUp ? '+' : '') + changeAmount.toFixed(2) : '--'}
                </span>
                <span
                  className={`text-sm px-1.5 py-0.5 rounded ${
                    isUp ? 'bg-up/10 text-up' : 'bg-down/10 text-down'
                  }`}
                >
                  {changePercent != null ? (isUp ? '+' : '') + changePercent.toFixed(2) + '%' : '--'}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* K线图区域 */}
          <div className="lg:col-span-3">
            {/* K线图卡片 */}
            <div className="glass rounded-xl p-4 mb-4">
              {/* 周期切换 */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-1">
                  {KLINE_PERIODS.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => setPeriod(p.value)}
                      className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                        period === p.value
                          ? 'bg-cyan-400/20 text-cyan-400'
                          : 'text-gray-400 hover:text-white hover:bg-night-700/50'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Clock className="w-3 h-3" />
                  {klineData.length} 根K线
                </div>
              </div>

              {/* K线图 */}
              <div className="relative">
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-night-900/50 z-10 rounded-lg">
                    <div className="flex items-center gap-2 text-cyan-400">
                      <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                      加载中...
                    </div>
                  </div>
                )}
                <KlineChart data={klineData} height={480} />
              </div>
            </div>

            {/* 基本信息卡片 */}
            <div className="glass rounded-xl p-4">
              <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                交易信息
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-gray-500 mb-1">今开</p>
                  <p className="font-mono text-white">{formatNumber(quote?.open)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">最高</p>
                  <p className="font-mono text-up">{formatNumber(quote?.high)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">最低</p>
                  <p className="font-mono text-down">{formatNumber(quote?.low)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">昨收</p>
                  <p className="font-mono text-white">{formatNumber(quote?.close)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">成交量</p>
                  <p className="font-mono text-white">{formatVolume(quote?.volume)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">成交额</p>
                  <p className="font-mono text-white">{formatVolume(quote?.amount)}元</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">持仓量</p>
                  <p className="font-mono text-white">{formatVolume(quote?.open_interest)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">均价</p>
                  <p className="font-mono text-white">{formatNumber(quote?.average)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* 盘口信息 */}
          <div className="lg:col-span-1">
            <div className="glass rounded-xl p-4 mb-4">
              <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                五档盘口
              </h3>

              {orderBook && (
                <div className="space-y-1">
                  {/* 卖盘 */}
                  {orderBook.asks.map((ask, i) => (
                    <div key={`ask-${i}`} className="flex items-center justify-between text-sm relative">
                      <span className="text-gray-500 text-xs w-8">卖{5 - i}</span>
                      <span className="font-mono text-down">{ask.price.toFixed(2)}</span>
                      <span className="font-mono text-gray-400 text-xs">
                        {ask.volume.toLocaleString()}
                      </span>
                      <div
                        className="absolute right-0 top-0 bottom-0 bg-down/10"
                        style={{ width: `${Math.min((ask.volume / 10000) * 100, 100)}%` }}
                      />
                    </div>
                  ))}

                  {/* 当前价分隔 */}
                  <div className="py-2 my-2 border-y border-night-600/50 flex items-center justify-between">
                    <span className="text-xs text-gray-500">最新</span>
                    <span className={`font-mono font-bold ${isUp ? 'text-up' : 'text-down'}`}>
                      {formatNumber(quote?.last_price)}
                    </span>
                  </div>

                  {/* 买盘 */}
                  {orderBook.bids.map((bid, i) => (
                    <div key={`bid-${i}`} className="flex items-center justify-between text-sm relative">
                      <span className="text-gray-500 text-xs w-8">买{i + 1}</span>
                      <span className="font-mono text-up">{bid.price.toFixed(2)}</span>
                      <span className="font-mono text-gray-400 text-xs">
                        {bid.volume.toLocaleString()}
                      </span>
                      <div
                        className="absolute right-0 top-0 bottom-0 bg-up/10"
                        style={{ width: `${Math.min((bid.volume / 10000) * 100, 100)}%` }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 合约信息 */}
            <div className="glass rounded-xl p-4">
              <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                <Hash className="w-4 h-4" />
                合约信息
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">合约代码</span>
                  <span className="font-mono text-white">{symbol || '--'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">合约名称</span>
                  <span className="text-white">{quote?.instrument_name || '--'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">最小变动</span>
                  <span className="font-mono text-white">
                    {quote?.price_tick ? quote.price_tick + ' 元' : '--'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">合约乘数</span>
                  <span className="font-mono text-white">
                    {quote?.volume_multiple || '--'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">连接状态</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      wsStatus === 'connected'
                        ? 'bg-up/10 text-up'
                        : wsStatus === 'connecting' || wsStatus === 'reconnecting'
                        ? 'bg-amber-400/10 text-amber-400'
                        : 'bg-down/10 text-down'
                    }`}
                  >
                    {wsStatus === 'connected'
                      ? '正常'
                      : wsStatus === 'connecting'
                      ? '连接中'
                      : wsStatus === 'reconnecting'
                      ? '重连中'
                      : '断开'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
};

export default StockDetailPage;
