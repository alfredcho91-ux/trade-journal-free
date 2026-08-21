import { Suspense, lazy, type ReactNode } from 'react';
import { BarChart3, BookOpen, Languages } from 'lucide-react';

import { MARKET_COINS } from './constants/market';
import { BrowserRouter, Navigate } from './router';
import { useLocation, useNavigate } from './router-context';
import {
  useLanguage,
  useSelectedCoin,
  useSetLanguage,
  useSetSelectedCoin,
} from './store/useStore';

const JournalPage = lazy(() => import('./pages/JournalPage'));
const TradeAnalysisPage = lazy(() => import('./pages/TradeAnalysisPage'));

const routeFallback = (
  <div className="flex min-h-64 items-center justify-center text-sm text-dark-400">
    Loading...
  </div>
);

function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const language = useLanguage();
  const selectedCoin = useSelectedCoin();
  const setLanguage = useSetLanguage();
  const setSelectedCoin = useSetSelectedCoin();
  const isKo = language === 'ko';

  const tabs = [
    { path: '/journal', label: isKo ? '매매일지' : 'Journal', icon: BookOpen },
    { path: '/trade-analysis', label: isKo ? '매매분석' : 'Trade Analysis', icon: BarChart3 },
  ];

  return (
    <div className="min-h-screen bg-dark-900 text-dark-100">
      <header className="sticky top-0 z-40 border-b border-dark-700 bg-dark-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
          <button
            type="button"
            onClick={() => navigate('/journal')}
            className="mr-2 text-left"
            aria-label={isKo ? '매매일지 홈' : 'Journal home'}
          >
            <div className="text-base font-bold text-white">Trade Journal</div>
            <div className="text-[10px] text-dark-500">Read-only analytics</div>
          </button>

          <nav className="flex h-10 items-stretch border border-dark-700" aria-label="Primary">
            {tabs.map(({ path, label, icon: Icon }) => {
              const active = pathname === path;
              return (
                <button
                  key={path}
                  type="button"
                  onClick={() => navigate(path)}
                  className={`flex min-w-28 items-center justify-center gap-2 px-4 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-primary-500 text-white'
                      : 'bg-dark-900 text-dark-300 hover:bg-dark-800 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <div className="flex h-9 border border-dark-700" aria-label={isKo ? '분석 코인' : 'Analysis coin'}>
              {MARKET_COINS.map((coin) => (
                <button
                  key={coin}
                  type="button"
                  onClick={() => setSelectedCoin(coin)}
                  className={`w-12 text-xs font-semibold transition-colors ${
                    selectedCoin === coin
                      ? 'bg-dark-200 text-dark-950'
                      : 'bg-dark-900 text-dark-400 hover:text-white'
                  }`}
                >
                  {coin}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setLanguage(isKo ? 'en' : 'ko')}
              className="flex h-9 w-9 items-center justify-center border border-dark-700 bg-dark-900 text-dark-300 hover:text-white"
              title={isKo ? 'English' : '한국어'}
              aria-label={isKo ? 'Switch to English' : '한국어로 전환'}
            >
              <Languages className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] px-4 py-5 lg:px-6">{children}</main>
    </div>
  );
}

function Routes() {
  const { pathname } = useLocation();

  if (pathname === '/') return <Navigate to="/journal" replace />;

  const page =
    pathname === '/journal' ? (
      <JournalPage />
    ) : pathname === '/trade-analysis' ? (
      <TradeAnalysisPage />
    ) : (
      <Navigate to="/journal" replace />
    );

  return <Shell>{page}</Shell>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={routeFallback}>
        <Routes />
      </Suspense>
    </BrowserRouter>
  );
}
