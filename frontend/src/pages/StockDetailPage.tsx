import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart3, DollarSign, Hash } from 'lucide-react';
import Header from '../components/Header';
import SearchModal from '../components/SearchModal';
import KlineChart from '../components/KlineChart';
import { useAppStore } from '../store/useAppStore';
import { apiService } from '../services/apiService';
import type { KlineData, TickData } from '../types';

const KLINE_PERIODS = [
  { label: '1分', value: 60 },
  { label: '5分', value: 300 },
  { label: '15分', value: 900 },
  { label: '30分', value: 1800 },
  { label: '1小时', value: 3600 },
  { label: '日线', value: 86400 },
];

type TabType = 'kline' | 'ticks';

const StockDetailPage = () => {
  const { symbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();
  const { quotes, setCurrentSymbol, wsStatus, subscribe, subscribedSymbols } = useAppStore();

  const [searchOpen, setSearchOpen] = useState(false);
  const [period, setPeriod] = useState(3600);
  const [klineData, setKlineData] = useState<KlineData[]>([]);
  const [klineLoading, setKlineLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('kline');
  const [tickData, setTickData] = useState<TickData[]>([]);
  const [tickLoading, setTickLoading] = useState(false);

  const quote = symbol ? quotes[symbol] : null;
  const isSubscribed = symbol ? subscribedSymbols.includes(symbol) : false;

  useEffect(() => {
    if (symbol) {
      setCurrentSymbol(symbol);
      if (!isSubscribed && wsStatus === 'connected') {
        subscribe([symbol]).catch(() => {});
      }
    }
  }, [symbol, setCurrentSymbol, isSubscribed, wsStatus, subscribe]);

  useEffect(() => {
    if (!symbol) return;

    const fetchKlines = async () => {
      setKlineLoading(true);
      try {
        const resp = await apiService.getKlines(symbol, period, 200);
        if (resp) {
          setKlineData(resp.data);
        }
      } catch (error) {
        console.error('Fetch kline error:', error);
      } finally {
        setKlineLoading(false);
      }
    };

    fetchKlines();
  }, [symbol, period]);

  useEffect(() => {
    if (!symbol || activeTab !== 'ticks') return;

    const fetchTicks = async () => {
      setTickLoading(true);
      try {
        const resp = await apiService.getTicks(symbol, 200);
        if (resp) {
          setTickData(resp.data);
        }
      } catch (error) {
        console.error('Fetch ticks error:', error);
      } finally {
        setTickLoading(false);
      }
    };

    fetchTicks();
  }, [symbol, activeTab]);

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
    if (num == null || isNaN(num as number)) return '--';
    return (num as number).toFixed(decimals);
  };

  const formatVolume = (num: number | null | undefined) => {
    if (num == null || isNaN(num as number)) return '--';
    const n = num as number;
    if (n >= 100000000) return (n / 100000000).toFixed(2) + '亿';
    if (n >= 10000) return (n / 10000).toFixed(2) + '万';
    return n.toString();
  };

  const orderBook = useMemo(() => {
    if (!quote) return null;

    const asks = [
      { price: quote.ask_price1, volume: quote.ask_volume1, label: '卖1' },
    ];

    const bids = [
      { price: quote.bid_price1, volume: quote.bid_volume1, label: '买1' },
    ];

    const allVolumes = [...asks, ...bids]
      .map((item) => item.volume || 0)
      .filter((v) => v > 0);
    const maxVolume = allVolumes.length > 0 ? Math.max(...allVolumes) : 1;

    return { asks, bids, maxVolume };
  }, [quote]);

  return (
    <div className="min-h-screen bg-night-950">
      <Header onSearchClick={() => setSearchOpen(true)} />

      <main className="pt-20 pb-8 px-6">
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
              <p
                className={`text-2xl font-bold font-mono ${
                  isUp ? 'text-up' : 'text-down'
                }`}
              >
                {formatNumber(quote.last_price)}
              </p>
              <div className="flex items-center gap-2 justify-end">
                <span
                  className={`text-sm font-mono ${isUp ? 'text-up' : 'text-down'}`}
                >
                  {changeAmount != null
                    ? (isUp ? '+' : '') + changeAmount.toFixed(2)
                    : '--'}
                </span>
                <span
                  className={`text-sm px-1.5 py-0.5 rounded ${
                    isUp ? 'bg-up/10 text-up' : 'bg-down/10 text-down'
                  }`}
                >
                  {changePercent != null
                    ? (isUp ? '+' : '') + changePercent.toFixed(2) + '%'
                    : '--'}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="lg:col-span-3">
            <div className="glass rounded-xl p-4 mb-4">
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
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setActiveTab('kline')}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      activeTab === 'kline'
                        ? 'bg-cyan-400/20 text-cyan-400'
                        : 'text-gray-400 hover:text-white hover:bg-night-700/50'
                    }`}
                  >
                    K线
                  </button>
                  <button
                    onClick={() => setActiveTab('ticks')}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      activeTab === 'ticks'
                        ? 'bg-cyan-400/20 text-cyan-400'
                        : 'text-gray-400 hover:text-white hover:bg-night-700/50'
                    }`}
                  >
                    Tick
                  </button>
                </div>
              </div>

              {activeTab === 'kline' && (
                <div className="relative">
                  {klineLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-night-900/50 z-10 rounded-lg">
                      <div className="flex items-center gap-2 text-cyan-400">
                        <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                        加载中...
                      </div>
                    </div>
                  )}
                  <KlineChart data={klineData} height={480} />
                </div>
              )}

              {activeTab === 'ticks' && (
                <div>
                  {tickLoading ? (
                    <div className="flex items-center justify-center h-48 text-cyan-400">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                        加载中...
                      </div>
                    </div>
                  ) : tickData.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-gray-500">
                      暂无 Tick 数据
                    </div>
                  ) : (
                    <div className="max-h-[480px] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-night-800">
                          <tr className="border-b border-night-600/50">
                            <th className="px-3 py-2 text-left text-gray-400 font-medium">
                              时间
                            </th>
                            <th className="px-3 py-2 text-right text-gray-400 font-medium">
                              最新价
                            </th>
                            <th className="px-3 py-2 text-right text-gray-400 font-medium">
                              买一价
                            </th>
                            <th className="px-3 py-2 text-right text-gray-400 font-medium">
                              卖一价
                            </th>
                            <th className="px-3 py-2 text-right text-gray-400 font-medium">
                              成交量
                            </th>
                            <th className="px-3 py-2 text-right text-gray-400 font-medium">
                              成交额
                            </th>
                            <th className="px-3 py-2 text-right text-gray-400 font-medium">
                              持仓量
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {tickData.map((tick, i) => (
                            <tr
                              key={i}
                              className="border-b border-night-700/30 hover:bg-night-700/20 transition-colors"
                            >
                              <td className="px-3 py-2 text-gray-400 font-mono text-xs">
                                {tick.datetime}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-white">
                                {formatNumber(tick.last_price)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-up">
                                {formatNumber(tick.bid_price1)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-down">
                                {formatNumber(tick.ask_price1)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-gray-300">
                                {tick.volume != null ? tick.volume.toLocaleString() : '--'}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-gray-300">
                                {formatVolume(tick.amount)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-gray-300">
                                {tick.open_interest != null
                                  ? tick.open_interest.toLocaleString()
                                  : '--'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

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
                  <p className="font-mono text-white">
                    {formatVolume(quote?.volume)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">成交额</p>
                  <p className="font-mono text-white">
                    {formatVolume(quote?.amount)}元
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">持仓量</p>
                  <p className="font-mono text-white">
                    {formatVolume(quote?.open_interest)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">均价</p>
                  <p className="font-mono text-white">
                    {formatNumber(quote?.average)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="glass rounded-xl p-4 mb-4">
              <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                一档盘口
              </h3>

              {orderBook && (
                <div className="space-y-1">
                  {orderBook.asks.map((ask, i) => (
                    <div
                      key={`ask-${i}`}
                      className="flex items-center justify-between text-sm relative"
                    >
                      <span className="text-gray-500 text-xs w-8">{ask.label}</span>
                      <span className="font-mono text-down">
                        {ask.price != null ? ask.price.toFixed(2) : '--'}
                      </span>
                      <span className="font-mono text-gray-400 text-xs">
                        {ask.volume != null ? ask.volume.toLocaleString() : '--'}
                      </span>
                      <div
                        className="absolute right-0 top-0 bottom-0 bg-down/10"
                        style={{
                          width: `${
                            ask.volume
                              ? Math.min((ask.volume / orderBook.maxVolume) * 100, 100)
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  ))}

                  <div className="py-2 my-2 border-y border-night-600/50 flex items-center justify-between">
                    <span className="text-xs text-gray-500">最新</span>
                    <span
                      className={`font-mono font-bold ${
                        isUp ? 'text-up' : 'text-down'
                      }`}
                    >
                      {formatNumber(quote?.last_price)}
                    </span>
                  </div>

                  {orderBook.bids.map((bid, i) => (
                    <div
                      key={`bid-${i}`}
                      className="flex items-center justify-between text-sm relative"
                    >
                      <span className="text-gray-500 text-xs w-8">{bid.label}</span>
                      <span className="font-mono text-up">
                        {bid.price != null ? bid.price.toFixed(2) : '--'}
                      </span>
                      <span className="font-mono text-gray-400 text-xs">
                        {bid.volume != null ? bid.volume.toLocaleString() : '--'}
                      </span>
                      <div
                        className="absolute right-0 top-0 bottom-0 bg-up/10"
                        style={{
                          width: `${
                            bid.volume
                              ? Math.min((bid.volume / orderBook.maxVolume) * 100, 100)
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

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
                  <span className="text-white">
                    {quote?.instrument_name || '--'}
                  </span>
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
