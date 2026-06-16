import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, Search, Bell, User, LogOut, Wifi, WifiOff, Loader } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

interface HeaderProps {
  onSearchClick: () => void;
}

const Header = ({ onSearchClick }: HeaderProps) => {
  const navigate = useNavigate();
  const { username, logout, wsStatus, subscribedSymbols } = useAppStore();
  const [showMenu, setShowMenu] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const statusInfo = (() => {
    switch (wsStatus) {
      case 'connected':
        return { icon: Wifi, color: 'text-up', label: '已连接', spin: false };
      case 'connecting':
        return { icon: Loader, color: 'text-cyan-400', label: '连接中', spin: true };
      case 'reconnecting':
        return { icon: Loader, color: 'text-amber-400', label: '重连中', spin: true };
      default:
        return { icon: WifiOff, color: 'text-down', label: '未连接', spin: false };
    }
  })();

  const StatusIcon = statusInfo.icon;

  return (
    <header className="h-16 glass border-b border-night-600/50 fixed top-0 left-0 right-0 z-50">
      <div className="h-full px-6 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 to-up flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gradient leading-tight">Tq 行情中心</h1>
            <p className="text-xs text-gray-500">实时行情 · 专业分析</p>
          </div>
        </div>

        {/* 搜索 */}
        <div className="flex-1 max-w-lg mx-8">
          <button
            onClick={onSearchClick}
            className="w-full px-4 py-2 bg-night-800/50 border border-night-600/50 rounded-lg text-left text-gray-400 text-sm hover:border-cyan-400/30 transition-colors flex items-center gap-2"
          >
            <Search className="w-4 h-4" />
            <span>搜索股票 / 期货合约...</span>
            <span className="ml-auto text-xs text-gray-600 bg-night-700 px-2 py-0.5 rounded">
              Ctrl + K
            </span>
          </button>
        </div>

        {/* 右侧 */}
        <div className="flex items-center gap-4">
          {/* 连接状态 */}
          <div className="flex items-center gap-2 text-sm">
            <StatusIcon
              className={`w-4 h-4 ${statusInfo.color} ${statusInfo.spin ? 'animate-spin' : ''}`}
            />
            <span className="text-gray-400 hidden sm:inline">{statusInfo.label}</span>
            <span className="text-xs text-gray-500 hidden sm:inline">
              ({subscribedSymbols.length} 只)
            </span>
          </div>

          {/* 通知 */}
          <button className="relative p-2 text-gray-400 hover:text-white transition-colors">
            <Bell className="w-5 h-5" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-down rounded-full" />
          </button>

          {/* 用户 */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-night-700/50 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-up flex items-center justify-center">
                <User className="w-4 h-4 text-white" />
              </div>
              <span className="text-sm text-gray-300 hidden sm:inline max-w-[100px] truncate">
                {username || '用户'}
              </span>
            </button>

            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-48 glass rounded-lg shadow-xl overflow-hidden z-50">
                  <div className="p-3 border-b border-night-600/50">
                    <p className="text-sm text-white font-medium">{username}</p>
                    <p className="text-xs text-gray-500">已登录</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full px-4 py-2.5 text-left text-sm text-gray-300 hover:bg-night-700/50 flex items-center gap-2 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    退出登录
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
