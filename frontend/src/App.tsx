import { Suspense, lazy, useState, type ReactNode } from 'react';
import { BarChart3, BookOpen, ExternalLink, GitCompareArrows, Languages, MessageSquare, Power, Search, ShieldAlert } from 'lucide-react';

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
const TradeExplorerPage = lazy(() => import('./pages/TradeExplorerPage'));
const HoldReentryPage = lazy(() => import('./pages/HoldReentryPage'));
const feedbackFormUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSdGlwCDcOiTTchsy_MVX33V9ZUXdQK_VA94U7cC2aVARfeV1Q/viewform?usp=publish-editor';

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
  const [shutdownNotice, setShutdownNotice] = useState<string | null>(null);

  const shutdownDesktop = async () => {
    if (isShuttingDown || !window.confirm(isKo ? 'Trade Journal을 종료할까요?' : 'Close Trade Journal?')) return;
    setIsShuttingDown(true);
    setShutdownNotice(null);
    try {
      const response = await fetch('/api/desktop/shutdown', { method: 'POST' });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { detail?: string } | null;
        if (response.status === 409 || body?.detail === 'Desktop shutdown is unavailable') {
          setShutdownNotice(isKo
            ? '개발 서버에서는 종료할 수 없습니다. 실행한 터미널에서 Ctrl+C로 종료하세요.'
            : 'The development server must be stopped with Ctrl+C in its terminal.');
          return;
        }
        throw new Error(body?.detail ?? `Request failed (${response.status})`);
      }

      setShutdownNotice(isKo
        ? 'Trade Journal 서버를 종료했습니다. 이 브라우저 탭은 직접 닫아주세요.'
        : 'Trade Journal has stopped. You can close this browser tab.');
      window.setTimeout(() => window.close(), 350);
    } catch {
      setShutdownNotice(isKo
        ? '종료 요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.'
        : 'The close request could not be completed. Please try again.');
    } finally {
      setTimeout(() => setIsShuttingDown(false), 1500);
    }
  };

  const tabs = [
    { path: '/journal', label: isKo ? '매매일지' : 'Journal', icon: BookOpen },
    { path: '/trade-analysis', label: isKo ? '매매분석' : 'Trade Analysis', icon: BarChart3 },
    { path: '/hold-reentry', label: isKo ? '홀딩 / 재진입' : 'Hold / Re-entry', icon: GitCompareArrows },
    { path: '/risk-lab', label: 'Risk Lab', icon: ShieldAlert },
    { path: '/trade-explorer', label: isKo ? '거래 탐색' : 'Trade Explorer', icon: Search },
  ];

  const navigation = (vertical = false) => (
    <nav className={vertical ? 'flex flex-col gap-1' : 'grid h-10 grid-cols-5 border border-dark-700'} aria-label="Primary">
      {tabs.map(({ path, label, icon: Icon }) => {
        const active = pathname === path;
        return (
          <button
            key={path}
            type="button"
            onClick={() => navigate(path)}
            className={vertical
              ? `flex min-h-10 items-center gap-2 border-l-2 px-3 text-sm font-medium transition-colors ${active ? 'border-primary-400 bg-primary-500/15 text-primary-200' : 'border-transparent text-dark-400 hover:bg-dark-800 hover:text-white'}`
              : `flex min-w-0 items-center justify-center gap-1 px-1 text-[11px] font-medium transition-colors ${active ? 'bg-primary-500 text-white' : 'bg-dark-900 text-dark-300 hover:bg-dark-800 hover:text-white'}`
            }
          >
            <Icon className={`${vertical ? 'h-4 w-4' : 'h-3.5 w-3.5'} shrink-0`} aria-hidden="true" />
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen overflow-x-hidden bg-dark-900 text-dark-100">
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
          {shutdownNotice && (
            <div className="basis-full text-right text-xs text-dark-400" role="status">
              {shutdownNotice}
            </div>
          )}
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
            <div className="flex items-center gap-2 text-sm font-medium text-dark-100"><MessageSquare className="h-4 w-4 text-primary-300" />{isKo ? '피드백' : 'Feedback'}</div>
            <p className="mt-2 text-xs leading-5 text-dark-500">{isKo ? '오류, 개선 의견, 지원 거래소를 알려주세요.' : 'Share bugs, ideas, or exchange requests.'}</p>
            <a href={feedbackFormUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary-200 hover:text-primary-100">
              {isKo ? '피드백 보내기' : 'Send feedback'}<ExternalLink className="h-3.5 w-3.5" />
            </a>
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
    ) : pathname === '/trade-explorer' ? (
      <TradeExplorerPage />
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
