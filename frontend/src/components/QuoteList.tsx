import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import type { QuoteData } from '../types';
import { useAppStore } from '../store/useAppStore';

interface QuoteRowProps {
  quote: QuoteData;
  isActive: boolean;
  onClick: () => void;
}

const QuoteRow = ({ quote, isActive, onClick }: QuoteRowProps) => {
  const changeAmount = useMemo(() => {
    if (quote.last_price == null || quote.open == null) return null;
    return quote.last_price - quote.open;
  }, [quote.last_price, quote.open]);

  const changePercent = useMemo(() => {
    if (changeAmount == null || !quote.open || quote.open === 0) return null;
    return (changeAmount / quote.open) * 100;
  }, [changeAmount, quote.open]);

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

  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer transition-colors hover:bg-night-700/30 ${
        isActive ? 'bg-cyan-500/10' : ''
      }`}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              isUp ? 'bg-up/10' : 'bg-down/10'
            }`}
          >
            {isUp ? (
              <TrendingUp className="w-4 h-4 text-up" />
            ) : (
              <TrendingDown className="w-4 h-4 text-down" />
            )}
          </div>
          <div>
            <p className="font-mono font-medium text-white">{quote.symbol}</p>
            <p className="text-xs text-gray-500">{quote.instrument_name || '--'}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <span
          className={`font-mono text-lg font-semibold ${
            isUp ? 'text-up' : 'text-down'
          }`}
        >
          {formatNumber(quote.last_price)}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <span
          className={`font-mono text-sm ${isUp ? 'text-up' : 'text-down'}`}
        >
          {changeAmount != null
            ? (isUp ? '+' : '') + changeAmount.toFixed(2)
            : '--'}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <span
          className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-medium ${
            isUp ? 'bg-up/10 text-up' : 'bg-down/10 text-down'
          }`}
        >
          {isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {changePercent != null ? changePercent.toFixed(2) + '%' : '--'}
        </span>
      </td>
      <td className="px-4 py-3 text-right text-gray-400 font-mono text-sm">
        {formatNumber(quote.ask_price1)}
      </td>
      <td className="px-4 py-3 text-right text-gray-400 font-mono text-sm">
        {formatNumber(quote.bid_price1)}
      </td>
      <td className="px-4 py-3 text-right text-gray-400 font-mono text-sm">
        {formatVolume(quote.volume)}
      </td>
      <td className="px-4 py-3 text-right text-gray-400 font-mono text-sm">
        {formatVolume(quote.amount)}
      </td>
    </tr>
  );
};

const QuoteList = () => {
  const navigate = useNavigate();
  const { quotes, subscribedSymbols, currentSymbol, setCurrentSymbol } = useAppStore();

  const quoteList = useMemo(() => {
    return subscribedSymbols
      .map((s) => quotes[s])
      .filter(Boolean)
      .sort((a, b) => {
        const aChange =
          a.last_price && a.open ? a.last_price - a.open : 0;
        const bChange =
          b.last_price && b.open ? b.last_price - b.open : 0;
        return bChange - aChange;
      });
  }, [quotes, subscribedSymbols]);

  const stats = useMemo(() => {
    let up = 0;
    let down = 0;
    let flat = 0;
    quoteList.forEach((q) => {
      if (q.last_price != null && q.open != null) {
        const change = q.last_price - q.open;
        if (change > 0) up++;
        else if (change < 0) down++;
        else flat++;
      }
    });
    return { up, down, flat, total: quoteList.length };
  }, [quoteList]);

  const handleClick = (symbol: string) => {
    setCurrentSymbol(symbol);
    navigate(`/stock/${symbol}`);
  };

  if (quoteList.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-500">
        <Activity className="w-12 h-12 mb-4 opacity-30" />
        <p>暂无订阅的股票</p>
        <p className="text-sm mt-1">点击上方搜索框添加股票</p>
      </div>
    );
  }

  return (
    <div>
      {/* 统计栏 */}
      <div className="flex items-center gap-4 mb-4 px-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-400">共</span>
          <span className="font-semibold text-white">{stats.total}</span>
          <span className="text-gray-400">只</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-up" />
          <span className="text-xs text-gray-400">涨 {stats.up}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-down" />
          <span className="text-xs text-gray-400">跌 {stats.down}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-gray-500" />
          <span className="text-xs text-gray-400">平 {stats.flat}</span>
        </div>
      </div>

      {/* 表格 */}
      <div className="glass rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-night-600/50 bg-night-800/30">
                <th className="px-4 py-3 text-left text-gray-400 font-medium">合约</th>
                <th className="px-4 py-3 text-right text-gray-400 font-medium">最新价</th>
                <th className="px-4 py-3 text-right text-gray-400 font-medium">涨跌额</th>
                <th className="px-4 py-3 text-right text-gray-400 font-medium">涨跌幅</th>
                <th className="px-4 py-3 text-right text-gray-400 font-medium">卖一价</th>
                <th className="px-4 py-3 text-right text-gray-400 font-medium">买一价</th>
                <th className="px-4 py-3 text-right text-gray-400 font-medium">成交量</th>
                <th className="px-4 py-3 text-right text-gray-400 font-medium">成交额</th>
              </tr>
            </thead>
            <tbody>
              {quoteList.map((quote) => (
                <QuoteRow
                  key={quote.symbol}
                  quote={quote}
                  isActive={currentSymbol === quote.symbol}
                  onClick={() => handleClick(quote.symbol)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default QuoteList;
