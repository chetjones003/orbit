import { useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@ui-sdk/react/dialog';
import { Switch, SwitchThumb } from '@ui-sdk/react/switch';
import { ChoiceGroup } from './ChoiceGroup';
import { PercentSlider } from './PercentSlider';
import type {
  InterfaceFont,
  InterfaceFontSize,
  MotionSetting,
  MonospaceFont,
  MonospaceFontSize,
  OpenItemsIn,
  HoverCardSpeed
} from '../../../shared/ipc';
import type { ColorScheme, CustomTheme, PaletteId } from '../../../shared/themes';
import { Icon, type IconName } from '../icons';
import { ThemePicker } from './ThemePicker';

type SectionId = 'general' | 'appearance' | 'account' | 'about';

/** The left navigation. Groups are separated by their headings, as in the rest of the app's settings. */
const GROUPS: { heading?: string; items: { id: SectionId; label: string; icon: IconName }[] }[] = [
  {
    items: [
      { id: 'general', label: 'General', icon: 'sliders' },
      { id: 'appearance', label: 'Appearance', icon: 'palette' }
    ]
  },
  { heading: 'Connections', items: [{ id: 'account', label: 'Account', icon: 'user' }] },
  { heading: 'Maintenance', items: [{ id: 'about', label: 'About & updates', icon: 'info' }] }
];

export interface SettingsDialogProps {
  colorScheme: ColorScheme;
  palette: PaletteId;
  customThemes: CustomTheme[];
  systemPrefersDark: boolean;
  openItemsIn: OpenItemsIn;
  /** How soon item cards open on hover. */
  hoverCards?: HoverCardSpeed;
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
  onHoverCards?(value: HoverCardSpeed): void;
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
  hoverCards = 'normal',
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
  onHoverCards,
  onMotion,
  onTypography,
  onCheckUpdates,
  onSignOut,
  onClose
}: SettingsDialogProps) {
  const [section, setSection] = useState<SectionId>('general');
  const current = GROUPS.flatMap((group) => group.items).find((item) => item.id === section)!;

  return (
    <Dialog defaultOpen modal onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogBackdrop className="modal-backdrop settings-backdrop" />
      <DialogContent container={document.body} className="settings-sheet">
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
                  <Icon name={item.icon} size={16} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
          {version && <p className="settings-nav-version">Orbit {version}</p>}
        </nav>

        <div className="settings-main">
          <header className="settings-head">
            <ol className="settings-breadcrumb" aria-label="Settings breadcrumb">
              <li>
                <DialogTitle>Settings</DialogTitle>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page">{current.label}</li>
            </ol>
            {version && <DialogDescription className="sr-only">Orbit {version}</DialogDescription>}
            <DialogClose aria-label="Close" className="icon-button settings-close">
              <Icon name="close" size={16} />
            </DialogClose>
          </header>

          <div className="settings-scroll">
            <div className="settings-content">
              {section === 'general' && (
                <>
                  <SettingsSection id="settings-open" title="Opening items">
                    <div className="settings-field-row">
                      <div className="typography-label">
                        <strong>When something is already open</strong>
                        <p>
                          With nothing open, a single click opens an issue or pull request full screen. Choose
                          where the next one opens once something is open. Double-click always opens full
                          screen.
                        </p>
                      </div>
                      <ChoiceGroup
                        label="Open items in"
                        value={openItemsIn}
                        options={[
                          ['side', 'Side panel'],
                          ['full', 'Full screen']
                        ]}
                        onChange={onOpenItemsIn}
                      />
                    </div>
                    <div className="settings-field-row">
                      <div className="typography-label">
                        <strong>Hover cards</strong>
                        <p>
                          Resting the pointer on an issue or pull request shows a card with its state, labels,
                          project fields, checks and a short preview. Choose how soon it opens, or turn it
                          off.
                        </p>
                      </div>
                      <ChoiceGroup
                        label="Hover cards"
                        value={hoverCards}
                        options={[
                          ['quick', 'Quick'],
                          ['normal', 'Normal'],
                          ['slow', 'Slow'],
                          ['off', 'Off']
                        ]}
                        onChange={(value) => onHoverCards?.(value)}
                      />
                    </div>
                    <div className="settings-field-row">
                      <div className="typography-label">
                        <strong>Animations</strong>
                        <p>
                          {systemReducedMotion
                            ? 'Windows has animations turned off, so panels fade instead of sliding. Always animate shows the slides anyway.'
                            : 'Panels slide and grow when they open, close and expand. Windows has animations on, so these follow it.'}
                        </p>
                      </div>
                      <ChoiceGroup
                        label="Animations"
                        value={motion}
                        options={[
                          ['system', 'Match Windows'],
                          ['always', 'Always animate']
                        ]}
                        onChange={onMotion}
                      />
                    </div>
                  </SettingsSection>
                  <SettingsSection id="settings-windows" title="Window and notifications">
                    <div className="settings-switch-row">
                      <div className="typography-label">
                        <strong id="settings-close-to-tray">Keep running in the tray when closed</strong>
                        <p>
                          Closing the window hides Orbit to the tray, so it keeps watching for activity. Quit
                          from the tray.
                        </p>
                      </div>
                      <Switch
                        checked={closeToTray}
                        onCheckedChange={(checked) => onGeneral({ closeToTray: checked })}
                        aria-labelledby="settings-close-to-tray"
                      >
                        <SwitchThumb />
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
                        <SwitchThumb />
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
                        <SwitchThumb />
                      </Switch>
                    </div>
                    <div className="settings-field-row">
                      <div className="typography-label">
                        <strong id="settings-poll-label">Check GitHub every</strong>
                        <p>
                          How often Orbit looks for new activity. Shorter times show changes sooner and use
                          more of your GitHub limit.
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
                  </SettingsSection>
                </>
              )}

              {section === 'appearance' && (
                <>
                  <SettingsSection id="settings-appearance" title="Color scheme and themes" plain>
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
                  </SettingsSection>
                  <SettingsSection id="settings-interface" title="Interface">
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
                  </SettingsSection>
                  <SettingsSection
                    id="settings-typography"
                    title="Typography"
                    className="typography-settings"
                  >
                    <div className="typography-row">
                      <div className="typography-label">
                        <strong>Interface font</strong>
                        <p>Everything outside code blocks and the terminal.</p>
                      </div>
                      <select
                        aria-label="Interface font"
                        value={interfaceFont}
                        onChange={(event) =>
                          onTypography({ interfaceFont: event.target.value as InterfaceFont })
                        }
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
                        <Icon name="reset" size={14} />
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
                        onChange={(event) =>
                          onTypography({ monospaceFont: event.target.value as MonospaceFont })
                        }
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
                        onClick={() =>
                          onTypography({ monospaceFont: 'code-new-roman', monospaceFontSize: 13 })
                        }
                      >
                        <Icon name="reset" size={14} />
                      </button>
                    </div>
                    <div className="typography-editor-preview">
                      <div className="typography-preview-file">src/formatUser.ts</div>
                      <pre
                        style={{ fontFamily: 'var(--mono-font-family)', fontSize: 'var(--mono-font-size)' }}
                      >
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
                  </SettingsSection>
                </>
              )}

              {section === 'account' && (
                <SettingsSection id="settings-account" title="Account">
                  <div className="settings-field-row">
                    <div className="typography-label">
                      <strong>GitHub</strong>
                      <p>{login === null ? 'Not signed in.' : `Signed in as @${login}`}</p>
                    </div>
                    {login !== null && (
                      <button type="button" className="secondary-action" onClick={onSignOut}>
                        Sign out
                      </button>
                    )}
                  </div>
                </SettingsSection>
              )}

              {section === 'about' && (
                <SettingsSection id="settings-about" title={`Orbit${version ? ` ${version}` : ''}`}>
                  <div className="settings-field-row">
                    <div className="typography-label">
                      <strong>Updates</strong>
                      <p>Check whether a newer version of Orbit is available, and read what changed.</p>
                    </div>
                    <button type="button" className="secondary-action" onClick={onCheckUpdates}>
                      Check for updates
                    </button>
                  </div>
                </SettingsSection>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A titled group of settings rows. Grouped sections sit in a card with dividers, as in T3 Code; plain ones do not. */
function SettingsSection({
  id,
  title,
  plain = false,
  className,
  children
}: {
  id: string;
  title: string;
  plain?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`settings-section ${className ?? ''}`} aria-labelledby={id}>
      <h2 id={id} className="settings-section-title">
        {title}
      </h2>
      <div className={plain ? 'settings-plain' : 'settings-card'}>{children}</div>
    </section>
  );
}
