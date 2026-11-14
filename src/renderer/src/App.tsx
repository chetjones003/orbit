import { useEffect, useState } from 'react';
import type { AppInfo } from '../../shared/ipc';
import type { AuthStatus } from '../../shared/auth';

const GITHUB_BUTTON = 'Sign in with GitHub';

/**
 * Start shell: signed-out start screen, device-flow sign-in, and the signed-in
 * identity indicator. The renderer only ever receives AuthStatus, never tokens.
 */
export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // A pushed status is newer than the initial read, so it wins over the read.
    let pushed = false;
    const unsubscribe = window.orbit.auth.onStatusChanged((next) => {
      pushed = true;
      if (!cancelled) setStatus(next);
    });
    void Promise.all([window.orbit.app.getInfo(), window.orbit.auth.getStatus()]).then(
      ([nextInfo, nextStatus]) => {
        if (cancelled) return;
        setInfo(nextInfo);
        if (!pushed) setStatus(nextStatus);
        document.documentElement.dataset.orbitReady = 'true';
      }
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const run = (action: () => Promise<AuthStatus>): void => {
    setActionError(null);
    void action().then(setStatus, () => setActionError('That action failed. Try again.'));
  };

  const signOut = (): void => {
    if (!window.confirm('Sign out of Orbit? The saved sign-in will be removed from this computer.')) return;
    run(() => window.orbit.auth.signOut());
  };

  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4 bg-base-200 p-6">
      <h1 className="text-3xl font-bold">Orbit</h1>
      <p className="text-base-content/70">
        {info ? `${info.name} ${info.version} on ${info.platform}` : 'Starting…'}
      </p>

      {status && (
        <AuthPanel
          status={status}
          onStartSignIn={() => run(() => window.orbit.auth.startSignIn())}
          onCancel={() => run(() => window.orbit.auth.cancelSignIn())}
          onSignOut={signOut}
        />
      )}

      {actionError && (
        <p role="alert" className="text-error">
          {actionError}
        </p>
      )}
    </main>
  );
}

interface AuthPanelProps {
  status: AuthStatus;
  onStartSignIn: () => void;
  onCancel: () => void;
  onSignOut: () => void;
}

function AuthPanel({ status, onStartSignIn, onCancel, onSignOut }: AuthPanelProps) {
  switch (status.kind) {
    case 'signed-out':
      return (
        <section className="flex flex-col items-center gap-3">
          {status.notice && (
            <p role="status" className="text-base-content/80">
              {status.notice}
            </p>
          )}
          <button type="button" className="btn btn-primary" onClick={onStartSignIn}>
            {GITHUB_BUTTON}
          </button>
        </section>
      );

    case 'device-pending':
      return (
        <section className="flex flex-col items-center gap-3">
          <p>Enter this code on GitHub to finish signing in:</p>
          <p className="font-mono text-3xl font-bold tracking-widest">{status.userCode}</p>
          <p className="text-sm text-base-content/70">
            Code expires at {new Date(status.expiresAt).toLocaleTimeString()}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => void navigator.clipboard.writeText(status.userCode)}
            >
              Copy code
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => void window.orbit.app.openExternal(status.verificationUri)}
            >
              Open GitHub in browser
            </button>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </section>
      );

    case 'signed-in':
      return (
        <section className="flex flex-col items-center gap-3">
          <p className="font-medium">{`Signed in as @${status.login}`}</p>
          {status.notice && (
            <p role="status" className="text-warning">
              {status.notice}
            </p>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onSignOut}>
            Sign out
          </button>
        </section>
      );

    case 'reauth-required':
      return (
        <section className="flex flex-col items-center gap-3">
          <p role="status" className="text-warning">
            {status.notice}
          </p>
          <button type="button" className="btn btn-primary" onClick={onStartSignIn}>
            {GITHUB_BUTTON}
          </button>
        </section>
      );
  }
}
