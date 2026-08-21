import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export default class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md border border-rose-500/30 bg-dark-900 p-6">
          <AlertTriangle className="h-7 w-7 text-rose-400" />
          <h1 className="mt-4 text-xl font-semibold text-white">화면을 불러오지 못했습니다</h1>
          <p className="mt-2 text-sm text-dark-300">
            페이지 상태를 초기화하려면 다시 불러오세요.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-primary mt-5 inline-flex items-center gap-2 px-4 py-2"
          >
            <RefreshCw className="h-4 w-4" />
            다시 불러오기
          </button>
        </div>
      </main>
    );
  }
}
