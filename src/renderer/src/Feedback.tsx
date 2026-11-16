import { describeConnection, type ConnectionStatus } from '../../shared/connection';
import { useEffect, useRef, useState } from 'react';

interface ConnectionBannerProps {
  status: ConnectionStatus;
  onRefresh: () => void;
  /** True while a cooldown or rate limit forbids a manual refresh. */
  refreshBlocked: boolean;
  /** Epoch ms used for relative times. Pass the app clock so the banner ticks. */
  now?: number;
}

/** Persistent status for stale, offline, or rate-limited data. Loaded data stays visible beneath it. */
export function ConnectionBanner({
  status,
  onRefresh,
  refreshBlocked,
  now = Date.now()
}: ConnectionBannerProps) {
  const message = describeConnection(status, now);
  if (!message) return null;
  return (
    <div className={`connection-banner ${message.tone}`} role="status" aria-live="polite">
      <span>{message.text}</span>
      <button className="secondary-action" onClick={onRefresh} disabled={refreshBlocked}>
        Refresh now
      </button>
    </div>
  );
}

interface InlineErrorProps {
  message: string;
  onRetry?: () => void;
  onCopyDiagnostics?: () => void;
}

/** A failure shown where it happened, with recovery actions. */
export function InlineError({ message, onRetry, onCopyDiagnostics }: InlineErrorProps) {
  return (
    <div className="inline-error" role="alert">
      <p>{message}</p>
      <div className="inline-error-actions">
        {onRetry && (
          <button className="secondary-action" onClick={onRetry}>
            Try again
          </button>
        )}
        {onCopyDiagnostics && (
          <button className="text-action" onClick={onCopyDiagnostics}>
            Copy diagnostics
          </button>
        )}
      </div>
    </div>
  );
}

interface ToastProps {
  message: string;
  tone?: 'success' | 'error' | 'info';
  onDismiss: () => void;
}

/** A brief, non-blocking confirmation. Motion is disabled by the reduced-motion CSS rule. */
export function Toast({ message, tone = 'info', onDismiss }: ToastProps) {
  const [exiting, setExiting] = useState(false);
  const dismissed = useRef(false);
  const dismiss = (): void => {
    if (dismissed.current) return;
    dismissed.current = true;
    setExiting(true);
    window.setTimeout(onDismiss, 180);
  };
  useEffect(() => {
    const timer = window.setTimeout(dismiss, 6000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className={`alert alert-${tone} action-toast${exiting ? ' is-exiting' : ''}`} role="status" aria-live="polite">
      <span>{message}</span>
      <button className="btn btn-ghost btn-sm" onClick={dismiss} aria-label="Dismiss">✕</button>
    </div>
  );
}
