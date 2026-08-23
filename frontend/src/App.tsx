import { Suspense, lazy, useState, type ReactNode } from 'react';
import { BarChart3, BookOpen, GitCompareArrows, Languages, Mail, Power, ShieldAlert } from 'lucide-react';

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
const RiskLabPage = lazy(() => import('./pages/RiskLabPage'));
const HoldReentryPage = lazy(() => import('./pages/HoldReentryPage'));
const feedbackEmail = import.meta.env.VITE_FEEDBACK_EMAIL?.trim();

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
  const [isShuttingDown, setIsShuttingDown] = useState(false);

  const shutdownDesktop = async () => {
    if (isShuttingDown || !window.confirm(isKo ? 'Trade Journal을 종료할까요?' : 'Close Trade Journal?')) return;
    setIsShuttingDown(true);
    try {
      await fetch('/api/desktop/shutdown', { method: 'POST' });
    } finally {
      setTimeout(() => setIsShuttingDown(false), 1500);
    }
  };

  const tabs = [
    { path: '/journal', label: isKo ? '매매일지' : 'Journal', icon: BookOpen },
    { path: '/trade-analysis', label: isKo ? '매매분석' : 'Trade Analysis', icon: BarChart3 },
    { path: '/hold-reentry', label: isKo ? '홀딩 / 재진입' : 'Hold / Re-entry', icon: GitCompareArrows },
    { path: '/risk-lab', label: 'Risk Lab', icon: ShieldAlert },
  ];

  const navigation = (vertical = false) => (
    <nav className={vertical ? 'flex flex-col gap-1' : 'flex h-10 items-stretch border border-dark-700'} aria-label="Primary">
      {tabs.map(({ path, label, icon: Icon }) => {
        const active = pathname === path;
        return (
          <button
            key={path}
            type="button"
            onClick={() => navigate(path)}
            className={vertical
              ? `flex min-h-10 items-center gap-2 border-l-2 px-3 text-sm font-medium transition-colors ${active ? 'border-primary-400 bg-primary-500/15 text-primary-200' : 'border-transparent text-dark-400 hover:bg-dark-800 hover:text-white'}`
              : `flex min-w-28 items-center justify-center gap-2 px-4 text-sm font-medium transition-colors ${active ? 'bg-primary-500 text-white' : 'bg-dark-900 text-dark-300 hover:bg-dark-800 hover:text-white'}`
            }
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </nav>
  );

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

          <div className="ml-auto flex items-center gap-2">
            {pathname !== '/journal' && <div className="flex h-9 border border-dark-700" aria-label={isKo ? '분석 코인' : 'Analysis coin'}>
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
            </div>}
            <button
              type="button"
              onClick={() => setLanguage(isKo ? 'en' : 'ko')}
              className="flex h-9 w-9 items-center justify-center border border-dark-700 bg-dark-900 text-dark-300 hover:text-white"
              title={isKo ? 'English' : '한국어'}
              aria-label={isKo ? 'Switch to English' : '한국어로 전환'}
            >
              <Languages className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={shutdownDesktop}
              disabled={isShuttingDown}
              className="flex h-9 w-9 items-center justify-center border border-dark-700 bg-dark-900 text-dark-300 hover:border-bear/60 hover:text-bear disabled:cursor-wait disabled:opacity-60"
              title={isKo ? '프로그램 종료' : 'Close application'}
              aria-label={isKo ? '프로그램 종료' : 'Close application'}
            >
              <Power className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <div className="border-b border-dark-800 bg-dark-950 lg:hidden">{navigation()}</div>
      <div className="mx-auto flex max-w-[1680px]">
        <aside className="sticky top-[69px] hidden h-[calc(100vh-69px)] w-48 shrink-0 border-r border-dark-800 bg-dark-950/60 py-5 lg:block">
          {navigation(true)}
        </aside>
        <main className="min-w-0 flex-1 px-4 py-5 lg:px-6">{children}</main>
        <aside className="sticky top-[69px] hidden h-[calc(100vh-69px)] w-60 shrink-0 border-l border-dark-800 px-4 py-5 xl:block" aria-label={isKo ? '피드백' : 'Feedback'}>
          <section className="border border-dark-700 bg-dark-900/30 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-dark-100"><Mail className="h-4 w-4 text-primary-300" />{isKo ? '피드백' : 'Feedback'}</div>
            {feedbackEmail ? (
              <a href={`mailto:${feedbackEmail}`} className="mt-3 block break-all text-xs text-primary-200 hover:text-primary-100">{feedbackEmail}</a>
            ) : (
              <div className="mt-3 text-xs text-dark-500">{isKo ? '연락처 준비 중' : 'Contact coming soon'}</div>
            )}
          </section>
        </aside>
      </div>
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
    ) : pathname === '/risk-lab' ? (
      <RiskLabPage />
    ) : pathname === '/hold-reentry' ? (
      <HoldReentryPage />
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
