import type { MotionSetting, OpenItemsIn } from '../../../shared/ipc';
import { Modal } from '../chrome/Modal';

export interface SettingsDialogProps {
  theme: 'dark' | 'light';
  openItemsIn: OpenItemsIn;
  motion: MotionSetting;
  /** True while Windows has animations off. */
  systemReducedMotion: boolean;
  version: string | undefined;
  onTheme(theme: 'dark' | 'light'): void;
  onOpenItemsIn(value: OpenItemsIn): void;
  onMotion(value: MotionSetting): void;
  onSignOut(): void;
  /** The signed-in login, or null when signed out. */
  login: string | null;
  onClose(): void;
}

/** Application settings, in a dialog over the workspace. Each choice saves as it is made. */
export function SettingsDialog({
  theme,
  openItemsIn,
  motion,
  systemReducedMotion,
  version,
  onTheme,
  onOpenItemsIn,
  onMotion,
  onSignOut,
  login,
  onClose
}: SettingsDialogProps) {
  return (
    <Modal title="Settings" subtitle={version ? `Orbit ${version}` : undefined} onClose={onClose}>
      <div className="settings-dialog">
        <section className="settings-section" aria-labelledby="settings-appearance">
          <h3 id="settings-appearance">Appearance</h3>
          <div className="settings-choice" role="radiogroup" aria-label="Theme">
            {(['dark', 'light'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={theme === value}
                className={theme === value ? 'active' : ''}
                onClick={() => onTheme(value)}
              >
                {value === 'dark' ? 'Dark' : 'Light'}
              </button>
            ))}
          </div>
        </section>
        <section className="settings-section" aria-labelledby="settings-open">
          <h3 id="settings-open">When something is already open</h3>
          <p>
            With nothing open, a single click opens an issue or pull request full screen. Choose where the
            next one opens once something is open. Double-click always opens full screen.
          </p>
          <div className="settings-choice" role="radiogroup" aria-label="Open items in">
            {(
              [
                ['side', 'Side panel'],
                ['full', 'Full screen']
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={openItemsIn === value}
                className={openItemsIn === value ? 'active' : ''}
                onClick={() => onOpenItemsIn(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
        <section className="settings-section" aria-labelledby="settings-motion">
          <h3 id="settings-motion">Animations</h3>
          <p>
            {systemReducedMotion
              ? 'Windows has animations turned off, so panels fade instead of sliding. Always animate shows the slides anyway.'
              : 'Panels slide and grow when they open, close and expand. Windows has animations on, so these follow it.'}
          </p>
          <div className="settings-choice" role="radiogroup" aria-label="Animations">
            {(
              [
                ['system', 'Match Windows'],
                ['always', 'Always animate']
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={motion === value}
                className={motion === value ? 'active' : ''}
                onClick={() => onMotion(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
        {login !== null && (
          <section className="settings-section" aria-labelledby="settings-account">
            <h3 id="settings-account">Account</h3>
            <p>Signed in as @{login}</p>
            <div className="settings-actions">
              <button type="button" className="secondary-action" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
