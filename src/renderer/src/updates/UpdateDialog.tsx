import { useState } from 'react';
import type { UpdateStatus } from '../../../shared/updates';
import { Modal } from '../chrome/Modal';
import { plainReleaseNotes } from './release-notes';

export interface UpdateDialogProps {
  status: UpdateStatus;
  /** The version this build runs. */
  currentVersion: string | undefined;
  onClose: () => void;
  /** Looks for a newer release now. */
  onCheck: () => void;
  /** Downloads the offered release. Only the user's press on "Download and install" calls this. */
  onDownload: () => void;
  /** Resolves once main has accepted the restart. The app quits or relaunches after this. */
  onInstall: () => Promise<void>;
  /** Read at the moment of restart, so drafts typed after the dialog opened are still caught. */
  hasUnsavedDrafts: () => boolean;
}

const TITLES: Record<UpdateStatus['kind'], string> = {
  idle: 'Check for updates',
  checking: 'Checking for updates',
  'up-to-date': 'Orbit is up to date',
  available: 'Update available',
  downloading: 'Downloading update',
  ready: 'Ready to install',
  error: 'Update failed'
};

/**
 * Update status in a dialog over the workspace. Nothing downloads until the user chooses to, and nothing
 * restarts until the user confirms. A restart warns first when unsent comment or editor text would be lost.
 */
export function UpdateDialog({
  status,
  currentVersion,
  onClose,
  onCheck,
  onDownload,
  onInstall,
  hasUnsavedDrafts
}: UpdateDialogProps) {
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const subtitle = currentVersion ? `You have Orbit ${currentVersion}` : undefined;

  const install = async (): Promise<void> => {
    setConfirming(false);
    setFailed(false);
    try {
      await onInstall();
    } catch {
      setFailed(true);
    }
  };
  const restart = (): void => {
    if (hasUnsavedDrafts()) setConfirming(true);
    else void install();
  };

  return (
    <Modal title={TITLES[status.kind]} subtitle={subtitle} onClose={onClose}>
      <div className="update-dialog">
        {status.kind === 'idle' && (
          <>
            <p>Look on GitHub for a newer release of Orbit.</p>
            <div className="update-actions">
              <button type="button" className="primary-action" onClick={onCheck}>
                Check now
              </button>
            </div>
          </>
        )}

        {status.kind === 'checking' && <p role="status">Looking on GitHub for a newer release…</p>}

        {status.kind === 'up-to-date' && (
          <>
            <p role="status">You have the newest release.</p>
            <div className="update-actions">
              <button type="button" className="secondary-action" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}

        {status.kind === 'available' && (
          <>
            <p>
              Orbit <strong>{status.version}</strong> is available. Downloading it takes a moment, and Orbit
              restarts only when you confirm.
            </p>
            {status.releaseNotes && (
              <pre className="update-notes">{plainReleaseNotes(status.releaseNotes)}</pre>
            )}
            <div className="update-actions">
              <button type="button" className="secondary-action" onClick={onClose}>
                Not now
              </button>
              <button type="button" className="primary-action" onClick={onDownload}>
                Download and install
              </button>
            </div>
          </>
        )}

        {status.kind === 'downloading' && (
          <>
            <p role="status">
              Downloading Orbit <strong>{status.version}</strong>… {Math.round(status.percent)}%
            </p>
            <div
              className="update-progress"
              role="progressbar"
              aria-label={`Downloading Orbit ${status.version}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(status.percent)}
            >
              <span style={{ width: `${Math.min(100, Math.max(0, status.percent))}%` }} />
            </div>
            <div className="update-actions">
              <button type="button" className="secondary-action" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}

        {status.kind === 'ready' && (
          <>
            <p>
              Orbit <strong>{status.version}</strong> is downloaded and checked. Restart Orbit to finish
              updating.
            </p>
            {status.releaseNotes && (
              <pre className="update-notes">{plainReleaseNotes(status.releaseNotes)}</pre>
            )}
            {failed && <p role="alert">The update could not be started. Try again later.</p>}
            {confirming ? (
              <div role="alertdialog" aria-label="Restart to update" className="update-confirm">
                <p>You have unsent comments or edits. Restarting now will discard them.</p>
                <div className="update-actions">
                  <button type="button" className="secondary-action" onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                  <button type="button" className="secondary-action" onClick={() => void install()}>
                    Restart anyway
                  </button>
                </div>
              </div>
            ) : (
              <div className="update-actions">
                <button type="button" className="secondary-action" onClick={onClose}>
                  Later
                </button>
                <button type="button" className="primary-action" onClick={restart}>
                  Restart to update
                </button>
              </div>
            )}
          </>
        )}

        {status.kind === 'error' && (
          <>
            <p role="alert">{status.message}</p>
            <div className="update-actions">
              <button type="button" className="secondary-action" onClick={onClose}>
                Close
              </button>
              <button type="button" className="primary-action" onClick={onCheck}>
                Try again
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
