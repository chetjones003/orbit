import { useState } from 'react';
import type { UpdateStatus } from '../../../shared/updates';

interface UpdateBannerProps {
  status: UpdateStatus;
  onCheck: () => void;
  /** Resolves once main has accepted the install request. The app quits or relaunches after this. */
  onInstall: () => Promise<void>;
  /** Read at the moment of restart, so drafts typed after the banner appeared are still caught. */
  hasUnsavedDrafts: () => boolean;
}

/**
 * Update status in the workspace. A restart is never automatic: the user confirms it, and a warning comes
 * first when unsent comment or editor text would be lost.
 */
export function UpdateBanner({ status, onCheck, onInstall, hasUnsavedDrafts }: UpdateBannerProps) {
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);

  if (status.kind === 'idle' || status.kind === 'up-to-date' || status.kind === 'checking') return null;

  const restart = (): void => {
    if (hasUnsavedDrafts()) {
      setConfirming(true);
      return;
    }
    void install();
  };

  const install = async (): Promise<void> => {
    setConfirming(false);
    try {
      await onInstall();
    } catch {
      setFailed(true);
    }
  };

  if (status.kind === 'downloading') {
    return (
      <div className="connection-banner info" role="status" aria-live="polite">
        <span>
          Downloading Orbit {status.version} in the background… {Math.round(status.percent)}%
        </span>
      </div>
    );
  }

  if (status.kind === 'mac-opened') {
    return (
      <div className="connection-banner info" role="status" aria-live="polite">
        <span>
          Orbit {status.version} downloaded and opened. Drag Orbit into Applications to finish updating.
        </span>
      </div>
    );
  }

  if (status.kind === 'error') {
    return (
      <div className="connection-banner warning" role="alert">
        <span>{status.message}</span>
        <button className="secondary-action" onClick={onCheck}>
          Try again
        </button>
      </div>
    );
  }

  // status.kind === 'ready'
  return (
    <div className="connection-banner info" role="status" aria-live="polite">
      <div>
        <span>Orbit {status.version} is ready to install.</span>
        {status.releaseNotes && <p className="release-notes">{status.releaseNotes}</p>}
        {failed && <span>The update could not be started. Try again later.</span>}
        {confirming && (
          <div role="alertdialog" aria-label="Restart to update" className="confirm-restart">
            <p>You have unsent comments or edits. Restarting now will discard them.</p>
            <button className="secondary-action" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button className="secondary-action" onClick={() => void install()}>
              Restart anyway
            </button>
          </div>
        )}
      </div>
      {!confirming && (
        <button className="secondary-action" onClick={restart}>
          Restart to update
        </button>
      )}
    </div>
  );
}
