import { useState } from 'react';
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
                    onClick={() => onTypography({ interfaceFont: 'inter', interfaceFontSize: 18 })}
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
