import { useState } from 'react';
import { Switch } from '@ui-sdk/react/switch';
import { ChoiceGroup } from './ChoiceGroup';
import { PercentSlider } from './PercentSlider';
import type {
  InterfaceFont,
  InterfaceFontSize,
  MotionSetting,
  MonospaceFont,
  MonospaceFontSize,
  OpenItemsIn
} from '../../../shared/ipc';
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
  interfaceFont: InterfaceFont;
  interfaceFontSize: InterfaceFontSize;
  monospaceFont: MonospaceFont;
  monospaceFontSize: MonospaceFontSize;
  wordWrap: boolean;
  /** 0 to 200. 100 is the theme as designed. */
  contrast: number;
  /** 0 to 100. 100 keeps menus, dialogs and the composer solid. */
  glassOpacity: number;
  onInterface(update: { contrast?: number; glassOpacity?: number }): void;
  closeToTray: boolean;
  desktopNotifications: boolean;
  pollMinutes: number;
  startAtLogin: boolean;
  onGeneral(update: {
    closeToTray?: boolean;
    desktopNotifications?: boolean;
    pollMinutes?: number;
    startAtLogin?: boolean;
  }): void;
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
  onTypography(update: {
    interfaceFont?: InterfaceFont;
    interfaceFontSize?: InterfaceFontSize;
    monospaceFont?: MonospaceFont;
    monospaceFontSize?: MonospaceFontSize;
    wordWrap?: boolean;
  }): void;
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
  interfaceFont,
  interfaceFontSize,
  monospaceFont,
  monospaceFontSize,
  wordWrap,
  contrast,
  closeToTray,
  desktopNotifications,
  pollMinutes,
  startAtLogin,
  onGeneral,
  glassOpacity,
  onInterface,
  systemReducedMotion,
  version,
  login,
  onColorScheme,
  onPalette,
  onSaveCustomTheme,
  onDeleteCustomTheme,
  onOpenItemsIn,
  onMotion,
  onTypography,
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
                <ChoiceGroup
                  label="Open items in"
                  value={openItemsIn}
                  options={[
                    ['side', 'Side panel'],
                    ['full', 'Full screen']
                  ]}
                  onChange={onOpenItemsIn}
                />
              </section>
              <section className="settings-section" aria-labelledby="settings-motion">
                <h3 id="settings-motion">Animations</h3>
                <p>
                  {systemReducedMotion
                    ? 'Windows has animations turned off, so panels fade instead of sliding. Always animate shows the slides anyway.'
                    : 'Panels slide and grow when they open, close and expand. Windows has animations on, so these follow it.'}
                </p>
                <ChoiceGroup
                  label="Animations"
                  value={motion}
                  options={[
                    ['system', 'Match Windows'],
                    ['always', 'Always animate']
                  ]}
                  onChange={onMotion}
                />
              </section>
              <section className="settings-section" aria-labelledby="settings-windows">
                <h3 id="settings-windows">Window and notifications</h3>
                <div className="settings-switch-row">
                  <div className="typography-label">
                    <strong id="settings-close-to-tray">Keep running in the tray when closed</strong>
                    <p>
                      Closing the window hides Orbit to the tray, so it keeps watching for activity. Quit from
                      the tray.
                    </p>
                  </div>
                  <Switch
                    checked={closeToTray}
                    onCheckedChange={(checked) => onGeneral({ closeToTray: checked })}
                    aria-labelledby="settings-close-to-tray"
                  >
                    <span className="settings-switch-track" aria-hidden="true" />
                  </Switch>
                </div>
                <div className="settings-switch-row">
                  <div className="typography-label">
                    <strong id="settings-desktop-notifications">Desktop notifications</strong>
                    <p>
                      Show a Windows notification for new GitHub activity while Orbit is hidden or in the
                      background.
                    </p>
                  </div>
                  <Switch
                    checked={desktopNotifications}
                    onCheckedChange={(checked) => onGeneral({ desktopNotifications: checked })}
                    aria-labelledby="settings-desktop-notifications"
                  >
                    <span className="settings-switch-track" aria-hidden="true" />
                  </Switch>
                </div>
                <div className="settings-switch-row">
                  <div className="typography-label">
                    <strong id="settings-start-at-login">Start Orbit when I sign in to Windows</strong>
                    <p>
                      Orbit opens in the tray, so it is watching for activity from the moment you sign in.
                    </p>
                  </div>
                  <Switch
                    checked={startAtLogin}
                    onCheckedChange={(checked) => onGeneral({ startAtLogin: checked })}
                    aria-labelledby="settings-start-at-login"
                  >
                    <span className="settings-switch-track" aria-hidden="true" />
                  </Switch>
                </div>
                <div className="settings-field-row">
                  <div className="typography-label">
                    <strong id="settings-poll-label">Check GitHub every</strong>
                    <p>
                      How often Orbit looks for new activity. Shorter times show changes sooner and use more
                      of your GitHub limit.
                    </p>
                  </div>
                  <ChoiceGroup
                    label="Check GitHub every"
                    value={String(pollMinutes)}
                    options={[
                      ['1', '1 minute'],
                      ['2', '2 minutes'],
                      ['5', '5 minutes'],
                      ['10', '10 minutes'],
                      ['15', '15 minutes']
                    ]}
                    onChange={(value) => onGeneral({ pollMinutes: Number(value) })}
                  />
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
              <section className="settings-section" aria-labelledby="settings-interface">
                <h3 id="settings-interface">Interface</h3>
                <PercentSlider
                  label="Contrast"
                  description="Adjust the contrast of colors and borders across the interface."
                  value={contrast}
                  max={200}
                  defaultValue={100}
                  onCommit={(next) => onInterface({ contrast: next })}
                />
                <PercentSlider
                  label="Glass opacity"
                  description="Higher values make menus, dialogs, and the composer more solid."
                  value={glassOpacity}
                  defaultValue={100}
                  onCommit={(next) => onInterface({ glassOpacity: next })}
                />
              </section>
              <section className="settings-section typography-settings" aria-labelledby="settings-typography">
                <h3 id="settings-typography">Typography</h3>
                <div className="typography-row">
                  <div className="typography-label">
                    <strong>Interface font</strong>
                    <p>Everything outside code blocks and the terminal.</p>
                  </div>
                  <select
                    aria-label="Interface font"
                    value={interfaceFont}
                    onChange={(event) => onTypography({ interfaceFont: event.target.value as InterfaceFont })}
                  >
                    <option value="inter">Inter Variable</option>
                    <option value="system">System UI</option>
                    <option value="segoe">Segoe UI</option>
                    <option value="arial">Arial</option>
                  </select>
                  <select
                    aria-label="Interface font size"
                    value={interfaceFontSize}
                    onChange={(event) =>
                      onTypography({ interfaceFontSize: Number(event.target.value) as InterfaceFontSize })
                    }
                  >
                    {[12, 13, 14, 15, 16, 18].map((size) => (
                      <option key={size} value={size}>
                        {size} px
                      </option>
                    ))}
                  </select>
                  <button
                    className="typography-reset"
                    type="button"
                    aria-label="Reset interface typography"
                    title="Reset interface typography"
                    onClick={() => onTypography({ interfaceFont: 'inter', interfaceFontSize: 14 })}
                  >
                    ↶
                  </button>
                </div>
                <div
                  className="typography-preview"
                  style={{ fontFamily: 'var(--ui-font-family)', fontSize: 'var(--ui-font-size)' }}
                >
                  Use <span className="preview-design">Frontend Design</span> to fix the flaky test in{' '}
                  <span className="preview-file">surface.test.ts</span> and align the header with{' '}
                  <span className="preview-file">SettingsPanels.tsx</span> before shipping.
                </div>
                <div className="typography-row">
                  <div className="typography-label">
                    <strong>Monospace font</strong>
                    <p>Code blocks, diffs, file previews, and the terminal.</p>
                  </div>
                  <select
                    aria-label="Monospace font"
                    value={monospaceFont}
                    onChange={(event) => onTypography({ monospaceFont: event.target.value as MonospaceFont })}
                  >
                    <option value="code-new-roman">Code New Roman</option>
                    <option value="cascadia">Cascadia Code</option>
                    <option value="consolas">Consolas</option>
                    <option value="courier">Courier New</option>
                  </select>
                  <select
                    aria-label="Monospace font size"
                    value={monospaceFontSize}
                    onChange={(event) =>
                      onTypography({ monospaceFontSize: Number(event.target.value) as MonospaceFontSize })
                    }
                  >
                    {[11, 12, 13, 14, 15].map((size) => (
                      <option key={size} value={size}>
                        {size} px
                      </option>
                    ))}
                  </select>
                  <button
                    className="typography-reset"
                    type="button"
                    aria-label="Reset monospace typography"
                    title="Reset monospace typography"
                    onClick={() => onTypography({ monospaceFont: 'code-new-roman', monospaceFontSize: 13 })}
                  >
                    ↶
                  </button>
                </div>
                <div className="typography-editor-preview">
                  <div className="typography-preview-file">src/formatUser.ts</div>
                  <pre style={{ fontFamily: 'var(--mono-font-family)', fontSize: 'var(--mono-font-size)' }}>
                    <code>
                      <span className="preview-line-number">1</span>{' '}
                      <span className="preview-keyword">export function</span>{' '}
                      <span className="preview-function">formatUser</span>(user: User) {'{'}
                      {'\n'}
                      <span className="preview-line-number">2</span>
                      {'  '}
                      <span className="preview-delete">- return user.name.toUpperCase();</span>
                      {'\n'}
                      <span className="preview-line-number">2</span>
                      {'  '}
                      <span className="preview-insert">
                        + return `${'{'}user.name{'}'} &lt;${'{'}user.email{'}'}&gt;`;
                      </span>
                      {'\n'}
                      <span className="preview-line-number">3</span> {'}'}
                    </code>
                  </pre>
                </div>
                <pre
                  className="typography-terminal-preview"
                  style={{ fontFamily: 'var(--mono-font-family)', fontSize: 'var(--mono-font-size)' }}
                >
                  <code>
                    <span className="terminal-prompt">➜ orbit git:(main) ✗</span> npm run dev
                    {'\n\n'}
                    <span className="terminal-ready">VITE v8.3.8</span> ready in 1.24s
                    {'\n\n'}➜ Local: <span className="terminal-link">http://localhost:5173/</span>
                    {'\n'}➜ Network: <span className="terminal-link">http://192.168.1.24:5173/</span>
                    {'\n\n'}✓ 85 passed △ 2 warnings × 0 failed
                    {'\n\n'}
                    <span className="terminal-badge">READY</span> watching for changes
                  </code>
                </pre>
                <div className="typography-wrap-row">
                  <div className="typography-label">
                    <strong>Word wrap</strong>
                    <p>Wrap long lines in code previews, diffs, and file previews.</p>
                  </div>
                  <input
                    type="checkbox"
                    aria-label="Word wrap in code previews"
                    checked={wordWrap}
                    onChange={(event) => onTypography({ wordWrap: event.target.checked })}
                  />
                </div>
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
