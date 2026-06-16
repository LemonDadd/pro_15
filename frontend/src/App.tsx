import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import StockDetailPage from './pages/StockDetailPage';
import { useAppStore } from './store/useAppStore';
import { apiService } from './services/apiService';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useAppStore();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

const AppRoutes = () => {
  const { isAuthenticated, token, connectWs, wsStatus, engineReady, setEngineReady, setEngineError, fetchQuotes } = useAppStore();
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isAuthenticated && token && wsStatus === 'disconnected') {
      connectWs();
    }
  }, [isAuthenticated, token, wsStatus, connectWs]);

  useEffect(() => {
    if (!isAuthenticated || !token) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    const checkEngine = async () => {
      try {
        const health = await apiService.getHealth();
        if (health.engine_ready) {
          setEngineReady(true);
          setEngineError(null);
          fetchQuotes().catch(() => {});
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        } else {
          setEngineReady(false);
          setEngineError(health.error || null);
        }
      } catch (e) {
        console.error('Check engine error:', e);
        setEngineReady(false);
      }
    };

    checkEngine();
    pollTimerRef.current = setInterval(checkEngine, 3000);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [isAuthenticated, token, setEngineReady, setEngineError, fetchQuotes]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/stock/:symbol"
        element={
          <ProtectedRoute>
            <StockDetailPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
