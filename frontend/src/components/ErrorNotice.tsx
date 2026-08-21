import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorNoticeProps {
  title: string;
  message: string;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
}

export default function ErrorNotice({
  title,
  message,
  actionLabel,
  actionDisabled = false,
  onAction,
}: ErrorNoticeProps) {
  return (
    <div role="alert" className="card border border-rose-500/30 bg-rose-500/10 p-5">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
        <div className="min-w-0">
          <h3 className="font-semibold text-rose-300">{title}</h3>
          <p className="mt-1 text-sm text-rose-200">{message}</p>
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              disabled={actionDisabled}
              className="mt-3 inline-flex items-center gap-1.5 border border-rose-400/30 px-2.5 py-1.5 text-xs text-rose-200 hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${actionDisabled ? 'animate-spin' : ''}`} />
              {actionLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
