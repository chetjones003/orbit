import { useState } from 'react';
import type { MotionSetting, OpenItemsIn } from '../../../shared/ipc';
import type { ColorScheme, CustomTheme, PaletteId } from '../../../shared/themes';
import { Modal } from '../chrome/Modal';
import { ThemePicker } from './ThemePicker';

type SectionId = 'general' | 'appearance' | 'account' | 'about';

/** The left navigation. Groups are separated by their headings, as in the rest of the app's settings. */
const GROUPS: { heading?: string; items: { id: SectionId; label: string }[] }[] = [
  {
    items: [
      { id: 'general', label: 'General' },
      { id: 'appearance', label: 'Appearance' }
    ]
  },
  { heading: 'Connections', items: [{ id: 'account', label: 'Account' }] },
  { heading: 'Maintenance', items: [{ id: 'about', label: 'About & updates' }] }
];

export interface SettingsDialogProps {
  colorScheme: ColorScheme;
  palette: PaletteId;
  customThemes: CustomTheme[];
  systemPrefersDark: boolean;
  openItemsIn: OpenItemsIn;
  motion: MotionSetting;
  /** True while Windows has animations off. */
  systemReducedMotion: boolean;
  version: string | undefined;
  /** The signed-in login, or null when signed out. */
  login: string | null;
  onColorScheme(value: ColorScheme): void;
  onPalette(value: PaletteId): void;
  onSaveCustomTheme(theme: CustomTheme): void;
  onDeleteCustomTheme(id: string): void;
  onOpenItemsIn(value: OpenItemsIn): void;
  onMotion(value: MotionSetting): void;
  onCheckUpdates(): void;
  onSignOut(): void;
  onClose(): void;
}

/** Application settings: a left list of sections, and the chosen section on the right. Each choice saves as it is made. */
export function SettingsDialog({
  colorScheme,
  palette,
  customThemes,
  systemPrefersDark,
  openItemsIn,
  motion,
  systemReducedMotion,
  version,
  login,
  onColorScheme,
  onPalette,
  onSaveCustomTheme,
  onDeleteCustomTheme,
  onOpenItemsIn,
  onMotion,
  onCheckUpdates,
  onSignOut,
  onClose
}: SettingsDialogProps) {
  const [section, setSection] = useState<SectionId>('general');

  return (
    <Modal
      title="Settings"
      subtitle={version ? `Orbit ${version}` : undefined}
      onClose={onClose}
      className="settings-modal"
    >
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {GROUPS.map((group, index) => (
            <div className="settings-nav-group" key={group.heading ?? index}>
              {group.heading && <p className="settings-nav-heading">{group.heading}</p>}
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-item ${section === item.id ? 'active' : ''}`}
                  aria-current={section === item.id ? 'page' : undefined}
                  onClick={() => setSection(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="settings-pane">
          {section === 'general' && (
            <div className="settings-dialog">
              <section className="settings-section" aria-labelledby="settings-open">
                <h3 id="settings-open">When something is already open</h3>
                <p>
                  With nothing open, a single click opens an issue or pull request full screen. Choose where
                  the next one opens once something is open. Double-click always opens full screen.
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
            </div>
          )}

          {section === 'appearance' && (
            <div className="settings-dialog">
              <section className="settings-section" aria-labelledby="settings-appearance">
                <h3 id="settings-appearance">Color scheme and themes</h3>
                <ThemePicker
                  colorScheme={colorScheme}
                  palette={palette}
                  customThemes={customThemes}
                  systemPrefersDark={systemPrefersDark}
                  onColorScheme={onColorScheme}
                  onPalette={onPalette}
                  onSaveCustomTheme={onSaveCustomTheme}
                  onDeleteCustomTheme={onDeleteCustomTheme}
                />
              </section>
            </div>
          )}

          {section === 'account' && (
            <div className="settings-dialog">
              <section className="settings-section" aria-labelledby="settings-account">
                <h3 id="settings-account">Account</h3>
                {login === null ? (
                  <p>Not signed in.</p>
                ) : (
                  <>
                    <p>Signed in as @{login}</p>
                    <div className="settings-actions">
                      <button type="button" className="secondary-action" onClick={onSignOut}>
                        Sign out
                      </button>
                    </div>
                  </>
                )}
              </section>
            </div>
          )}

          {section === 'about' && (
            <div className="settings-dialog">
              <section className="settings-section" aria-labelledby="settings-about">
                <h3 id="settings-about">Orbit{version ? ` ${version}` : ''}</h3>
                <p>Check whether a newer version of Orbit is available, and read what changed.</p>
                <div className="settings-actions">
                  <button type="button" className="secondary-action" onClick={onCheckUpdates}>
                    Check for updates
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
