import { BUILT_IN_THEME_COLORS, GENERATED_THEME_BASE, THEME_COLOR_ROLES } from './theme-builtins';
import {
  colorToHex,
  contrastRatio,
  flattenOver,
  hexToRgb,
  isDarkColor,
  mixRgb,
  mutedText,
  oklchToHex,
  oklchToRgb,
  parseColor,
  readableColorOn,
  readableForeground,
  readableText,
  rgbToOklch,
  solveLightness,
  toHex,
  type Oklch,
  type Rgb
} from './theme-color';

export { THEME_COLOR_ROLES };

/** Light, dark, or follow Windows. */
export const COLOR_SCHEMES = ['system', 'light', 'dark'] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];
export type Appearance = 'light' | 'dark';

/** The built-in palettes, T3 Code's own. Each has a light and a dark variant; the colour scheme picks which shows. */
export const PALETTES = [
  { id: 'orbit', name: 'Orbit' },
  { id: 'ocean', name: 'Ocean' },
  { id: 'ember', name: 'Ember' },
  { id: 'iris', name: 'Iris' },
  { id: 'grove', name: 'Grove' }
] as const;
export type BuiltInPaletteId = (typeof PALETTES)[number]['id'];

/** A custom theme's id always starts with 'custom-'. */
export type CustomThemeId = `custom-${string}`;
export type PaletteId = BuiltInPaletteId | CustomThemeId;

export const MAX_CUSTOM_THEMES = 12;
export const CUSTOM_THEME_NAME_LENGTH = 40;

/** One colour role of T3 Code's theme model, such as canvas, sidebar or messageAction. */
export type ThemeColorRole = (typeof THEME_COLOR_ROLES)[number];
/** Every role of one variant, each a six-digit hex colour. */
export type ThemeColors = Record<ThemeColorRole, string>;

export interface CustomTheme {
  id: CustomThemeId;
  name: string;
  dark: ThemeColors;
  light: ThemeColors;
}

export function isColorScheme(value: unknown): value is ColorScheme {
  return typeof value === 'string' && (COLOR_SCHEMES as readonly string[]).includes(value);
}

export function isBuiltInPalette(value: unknown): value is BuiltInPaletteId {
  return typeof value === 'string' && PALETTES.some((palette) => palette.id === value);
}

const CUSTOM_ID = /^custom-[a-z0-9-]{1,40}$/;

export function isCustomThemeId(value: unknown): value is CustomThemeId {
  return typeof value === 'string' && CUSTOM_ID.test(value);
}

/** Whether a palette id names a built-in palette, or a custom theme that exists in these settings. */
export function paletteExists(value: unknown, customThemes: readonly CustomTheme[]): value is PaletteId {
  return (
    isBuiltInPalette(value) || (isCustomThemeId(value) && customThemes.some((theme) => theme.id === value))
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

/** A built-in palette's colours for one appearance. */
export function builtInThemeColors(id: BuiltInPaletteId, appearance: Appearance): ThemeColors {
  return { ...BUILT_IN_THEME_COLORS[id][appearance] };
}

/** The colours that show for a palette, falling back to Orbit's own when a custom theme is gone. */
export function themeColorsFor(
  palette: PaletteId,
  customThemes: readonly CustomTheme[],
  appearance: Appearance
): ThemeColors {
  const custom = customThemes.find((theme) => theme.id === palette);
  if (custom) return custom[appearance];
  return builtInThemeColors(isBuiltInPalette(palette) ? palette : 'orbit', appearance);
}

// ---- Generated themes, as T3 Code's createVividThemeColors ----

const STATUS_COLORS = {
  light: { error: '#fb2c36', errorForeground: '#c10007', warning: '#fe9a00', warningForeground: '#bb4d00' },
  dark: { error: '#fb414a', errorForeground: '#ff6467', warning: '#fe9a00', warningForeground: '#ffb900' }
} as const;

function statusColors(canvas: Rgb) {
  const appearance: Appearance = isDarkColor(canvas) ? 'dark' : 'light';
  const standard = STATUS_COLORS[appearance];
  const surfaceMix = appearance === 'dark' ? 0.16 : 0.08;
  const surfaceOf = (value: string) => mixRgb(canvas, hexToRgb(value), surfaceMix);
  const readableOn = (foreground: string, surface: Rgb) =>
    oklchToHex(
      solveLightness(
        rgbToOklch(hexToRgb(foreground)),
        [surface],
        4.6,
        appearance === 'dark' ? 'lighter' : 'darker'
      )
    );
  const errorSurface = surfaceOf(standard.error);
  const warningSurface = surfaceOf(standard.warning);
  return {
    error: standard.error,
    errorForeground: readableOn(standard.errorForeground, errorSurface),
    errorSurface: toHex(errorSurface),
    warning: standard.warning,
    warningForeground: readableOn(standard.warningForeground, warningSurface),
    warningSurface: toHex(warningSurface)
  };
}

/** A whole theme from a background and an accent colour, the way T3 Code builds one. */
export function generateThemeColors(
  appearance: Appearance,
  background: string,
  accentColor: string
): ThemeColors {
  const canvasRgb =
    parseColor(background) ?? (appearance === 'dark' ? { r: 24, g: 15, b: 27 } : { r: 250, g: 245, b: 250 });
  const accentRgb = parseColor(accentColor) ?? { r: 168, g: 67, b: 112 };
  const canvas = rgbToOklch(canvasRgb);
  const accent = rgbToOklch(accentRgb);
  const dark = isDarkColor(canvasRgb);
  const hue = accent.C < 0.02 ? canvas.h : accent.h;
  const tintC = Math.min(0.045, Math.max(0.008, accent.C * 0.22));
  const step = dark ? 1 : -1;
  const surfaceAt = (deltaL: number, chroma = tintC): Oklch => ({
    L: Math.min(0.98, Math.max(0.05, canvas.L + step * deltaL)),
    C: chroma,
    h: hue
  });
  const hex = (color: Oklch) => oklchToHex(color);

  const textBase: Oklch = { L: dark ? 0.95 : 0.2, C: Math.min(0.035, accent.C * 0.25), h: hue };
  const textRgb = oklchToRgb(solveLightness(textBase, [canvasRgb], 7, dark ? 'lighter' : 'darker'));
  const textMutedRgb = mutedText(canvasRgb, textRgb);

  const action: Oklch = {
    L: Math.min(0.85, Math.max(0.35, accent.L + (dark ? 0.06 : -0.02))),
    C: Math.max(accent.C * 0.9, 0.06),
    h: (hue + 50) % 360
  };
  const actionRgb = oklchToRgb(action);

  const sidebar = surfaceAt(0.045, tintC * 1.4);
  const sidebarRgb = oklchToRgb(sidebar);
  const surfaceRaisedRgb = oklchToRgb(surfaceAt(0.05));
  const secondary = surfaceAt(dark ? 0.1 : 0.06, Math.min(0.09, accent.C * 0.5));
  const muted = surfaceAt(dark ? 0.06 : 0.04, Math.min(0.06, accent.C * 0.35));
  const accentSurface = surfaceAt(dark ? 0.13 : 0.08, Math.min(0.11, accent.C * 0.55));
  const messageSurface = surfaceAt(dark ? 0.16 : 0.1, Math.min(0.13, accent.C * 0.6));
  const updateSurface = surfaceAt(dark ? 0.14 : 0.09, Math.min(0.12, accent.C * 0.55));

  const foregroundOn = (surface: Oklch): string =>
    hex(solveLightness(textBase, [oklchToRgb(surface)], 4.6, dark ? 'lighter' : 'darker'));
  const searchMatch = oklchToRgb(surfaceAt(0.22, Math.min(0.12, accent.C)));
  const searchMatchActive = oklchToRgb(surfaceAt(0.4, Math.min(0.18, accent.C)));
  const text = toHex(textRgb);
  const textMuted = toHex(textMutedRgb);

  return {
    ...GENERATED_THEME_BASE[appearance],
    ...statusColors(canvasRgb),
    canvas: toHex(canvasRgb),
    chrome: toHex(canvasRgb),
    toolbar: toHex(canvasRgb),
    toolbarForeground: text,
    toolbarBorder: hex(surfaceAt(dark ? 0.14 : 0.1, Math.min(0.08, accent.C * 0.4))),
    toolbarControl: hex(surfaceAt(dark ? 0.09 : 0.05, tintC * 1.3)),
    toolbarControlForeground: text,
    toolbarControlHover: hex(surfaceAt(dark ? 0.14 : 0.09, tintC * 1.6)),
    surface: hex(surfaceAt(0.015)),
    surfaceRaised: toHex(surfaceRaisedRgb),
    surfaceOverlay: hex(surfaceAt(0.075)),
    text,
    textMuted,
    border: hex(surfaceAt(dark ? 0.16 : 0.12, Math.min(0.07, accent.C * 0.35))),
    input: hex(surfaceAt(dark ? 0.21 : 0.16, Math.min(0.08, accent.C * 0.4))),
    focus: toHex(accentRgb),
    accent: toHex(accentRgb),
    accentForeground: toHex(readableForeground(accentRgb)),
    secondary: hex(secondary),
    secondaryForeground: foregroundOn(secondary),
    muted: hex(muted),
    mutedForeground: toHex(readableText(oklchToRgb(muted), textRgb, 1, 4.6)),
    placeholder: toHex(readableText(surfaceRaisedRgb, textRgb, 1, 4.6)),
    secondaryLabel: textMuted,
    iconMuted: textMuted,
    update: toHex(accentRgb),
    updateForeground: foregroundOn(updateSurface),
    updateSurface: hex(updateSurface),
    accentSurface: hex(accentSurface),
    accentSurfaceForeground: foregroundOn(accentSurface),
    messageSurface: hex(messageSurface),
    messageForeground: foregroundOn(messageSurface),
    messageAction: toHex(actionRgb),
    messageActionForeground: toHex(readableForeground(actionRgb)),
    messageActionHover: hex({ ...action, L: action.L + (dark ? 0.06 : -0.06) }),
    codeBackground: hex(surfaceAt(0.035, tintC * 0.8)),
    codeForeground: text,
    searchMatchBackground: toHex(searchMatch),
    searchMatchForeground: toHex(readableForeground(searchMatch)),
    searchMatchActiveBackground: toHex(searchMatchActive),
    searchMatchActiveForeground: toHex(readableForeground(searchMatchActive)),
    sidebar: hex(sidebar),
    sidebarForeground: foregroundOn(sidebar),
    sidebarMutedForeground: toHex(mutedText(sidebarRgb, textRgb)),
    sidebarControlSurface: hex(surfaceAt(dark ? 0.1 : 0.07, tintC * 1.5)),
    sidebarRowHover: hex(surfaceAt(dark ? 0.08 : 0.06, Math.min(0.08, accent.C * 0.45))),
    sidebarRowActive: hex(surfaceAt(dark ? 0.12 : 0.09, Math.min(0.1, accent.C * 0.55))),
    sidebarRowSelected: hex(surfaceAt(dark ? 0.14 : 0.1, Math.min(0.11, accent.C * 0.6))),
    sidebarBorder: hex(surfaceAt(dark ? 0.17 : 0.12, Math.min(0.08, accent.C * 0.4))),
    terminalBackground: toHex(canvasRgb),
    terminalForeground: text,
    terminalCursor: toHex(accentRgb),
    terminalSelection: hex(surfaceAt(dark ? 0.18 : 0.12, Math.min(0.12, accent.C * 0.55))),
    terminalScrollbar: hex(surfaceAt(dark ? 0.22 : 0.16, tintC)),
    terminalScrollbarHover: hex(surfaceAt(dark ? 0.3 : 0.22, tintC))
  };
}

// ---- VS Code themes, as T3 Code's parseVsCodeThemeFile ----

/** A VS Code theme's workbench colours, keyed as in its file, such as "editor.background". */
export type VsCodeColors = Record<string, string>;

/**
 * Every role of one variant, read from a VS Code theme's workbench colours the way T3 Code reads them: about thirty
 * keys, each laid over the surface it sits on, with a generated theme filling the rest. Null without a background.
 */
export function themeColorsFromVsCode(colors: VsCodeColors, appearance: Appearance): ThemeColors | null {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const parsed = parseColor(colors[key]);
      if (parsed) return parsed;
    }
    return null;
  };
  const solidOver = (base: Rgb, ...keys: string[]): string | null => {
    const parsed = pick(...keys);
    return parsed ? flattenOver(parsed, base) : null;
  };

  const canvasColor = pick('editor.background', 'editorPane.background');
  if (!canvasColor) return null;
  const canvas: Rgb = { r: canvasColor.r, g: canvasColor.g, b: canvasColor.b };
  const canvasHex = toHex(canvas);
  const raisedCandidate = solidOver(canvas, 'editorWidget.background', 'dropdown.background');
  const standsApart = (first: string, second: string) =>
    contrastRatio(hexToRgb(first), hexToRgb(second)) >= 1.1;

  let accentHex: string | null = null;
  let accentRgb: Rgb | null = null;
  for (const key of [
    'focusBorder',
    'button.background',
    'textLink.foreground',
    'activityBarBadge.background',
    'progressBar.background',
    'badge.background'
  ]) {
    const candidate = parseColor(colors[key]);
    if (!candidate) continue;
    const candidateHex = flattenOver(candidate, canvas);
    if (!standsApart(candidateHex, canvasHex)) continue;
    if (raisedCandidate !== null && !standsApart(candidateHex, raisedCandidate)) continue;
    accentHex = candidateHex;
    accentRgb = candidate;
    break;
  }
  const standard = builtInThemeColors('orbit', appearance);
  if (!accentHex || !accentRgb) {
    accentHex =
      [standard.accent, '#ffffff', '#000000'].find(
        (candidate) =>
          standsApart(candidate, canvasHex) &&
          (raisedCandidate === null || standsApart(candidate, raisedCandidate))
      ) ?? standard.accent;
    accentRgb = hexToRgb(accentHex);
  }

  const mutedAccentHex = flattenOver({ ...accentRgb, a: 0.2 }, canvas);
  const derived = generateThemeColors(appearance, canvasHex, mutedAccentHex);
  const sidebarHex = solidOver(canvas, 'sideBar.background', 'activityBar.background') ?? derived.sidebar;
  const sidebar = hexToRgb(sidebarHex);
  const terminalHex =
    solidOver(canvas, 'terminal.background', 'panel.background') ?? derived.terminalBackground;
  const terminal = hexToRgb(terminalHex);

  const readableOn = (surface: string, fallback: string, ...keys: string[]): string => {
    const surfaceRgb = hexToRgb(surface);
    const isReadable = (candidate: string) => contrastRatio(hexToRgb(candidate), surfaceRgb) >= 4.5;
    const specified = solidOver(surfaceRgb, ...keys);
    if (specified && isReadable(specified)) return specified;
    if (isReadable(fallback)) return fallback;
    return isDarkColor(surfaceRgb) ? '#ffffff' : '#000000';
  };
  // Status colours also fill controls that carry white text, so a dim one is lightened along its hue.
  const readableStatus = (fallback: string, ...keys: string[]): string => {
    const specified = solidOver(canvas, ...keys);
    const base = specified && standsApart(specified, canvasHex) ? specified : fallback;
    return readableColorOn(base, canvasHex, 4.5);
  };

  const surfaceRaisedHex = raisedCandidate ?? derived.surfaceRaised;
  const buttonHex = solidOver(canvas, 'button.background');
  const actionHex =
    buttonHex && standsApart(buttonHex, canvasHex) && standsApart(buttonHex, surfaceRaisedHex)
      ? buttonHex
      : accentHex;
  let inputHex =
    [derived.input, derived.surfaceRaised, standard.input, '#000000', '#ffffff', '#808080'].find(
      (candidate) => standsApart(candidate, canvasHex) && standsApart(candidate, actionHex)
    ) ?? '#808080';
  for (const key of ['input.background', 'input.border']) {
    const candidate = solidOver(canvas, key);
    if (candidate && standsApart(candidate, canvasHex) && standsApart(candidate, actionHex)) {
      inputHex = candidate;
      break;
    }
  }
  const searchMatchBackground =
    solidOver(canvas, 'editor.findMatchHighlightBackground') ?? derived.searchMatchBackground;
  const searchMatchActiveBackground =
    solidOver(canvas, 'editor.findMatchBackground') ?? derived.searchMatchActiveBackground;

  return {
    ...derived,
    canvas: canvasHex,
    text: readableOn(canvasHex, derived.text, 'editor.foreground', 'foreground'),
    textMuted: readableOn(canvasHex, derived.textMuted, 'descriptionForeground', 'disabledForeground'),
    surface: solidOver(canvas, 'editorWidget.background') ?? derived.surface,
    surfaceRaised: surfaceRaisedHex,
    surfaceOverlay:
      solidOver(canvas, 'menu.background', 'quickInput.background', 'dropdown.background') ??
      derived.surfaceOverlay,
    border: solidOver(canvas, 'panel.border', 'editorGroup.border', 'contrastBorder') ?? derived.border,
    input: inputHex,
    placeholder: readableOn(surfaceRaisedHex, derived.placeholder, 'input.placeholderForeground'),
    error: readableStatus(derived.error, 'editorError.foreground', 'errorForeground'),
    warning: readableStatus(derived.warning, 'editorWarning.foreground'),
    accentSurface:
      solidOver(canvas, 'list.activeSelectionBackground', 'list.hoverBackground') ?? derived.accentSurface,
    codeBackground: solidOver(canvas, 'textCodeBlock.background') ?? derived.codeBackground,
    searchMatchBackground,
    searchMatchForeground: readableOn(
      searchMatchBackground,
      derived.searchMatchForeground,
      'editor.findMatchHighlightForeground',
      'editor.foreground',
      'foreground'
    ),
    searchMatchActiveBackground,
    searchMatchActiveForeground: readableOn(
      searchMatchActiveBackground,
      derived.searchMatchActiveForeground,
      'editor.findMatchForeground',
      'editor.foreground',
      'foreground'
    ),
    sidebar: sidebarHex,
    sidebarForeground: readableOn(sidebarHex, derived.sidebarForeground, 'sideBar.foreground'),
    sidebarBorder: solidOver(sidebar, 'sideBar.border') ?? derived.sidebarBorder,
    sidebarRowHover: solidOver(sidebar, 'list.hoverBackground') ?? derived.sidebarRowHover,
    sidebarRowActive:
      solidOver(sidebar, 'list.inactiveSelectionBackground', 'list.hoverBackground') ??
      derived.sidebarRowActive,
    sidebarRowSelected: solidOver(sidebar, 'list.activeSelectionBackground') ?? derived.sidebarRowSelected,
    terminalBackground: terminalHex,
    terminalForeground: readableOn(terminalHex, derived.terminalForeground, 'terminal.foreground'),
    terminalCursor:
      solidOver(terminal, 'terminalCursor.foreground', 'editorCursor.foreground') ?? derived.terminalCursor,
    terminalSelection:
      solidOver(terminal, 'terminal.selectionBackground', 'editor.selectionBackground') ??
      derived.terminalSelection,
    terminalScrollbar: solidOver(terminal, 'scrollbarSlider.background') ?? derived.terminalScrollbar,
    accent: accentHex,
    focus: accentHex,
    messageAction: actionHex,
    messageActionForeground: readableOn(actionHex, derived.messageActionForeground, 'button.foreground'),
    accentForeground: readableOn(accentHex, derived.accentForeground, 'button.foreground')
  };
}

// ---- Stored custom themes ----

/** Keeps only well-formed custom themes. Themes saved before the full role set are rebuilt from their four colours. */
export function normalizeCustomThemes(value: unknown): CustomTheme[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const themes: CustomTheme[] = [];
  for (const entry of value) {
    if (themes.length >= MAX_CUSTOM_THEMES) break;
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = record['id'];
    const name = typeof record['name'] === 'string' ? record['name'].trim() : '';
    const dark = normalizeColors(record['dark'], 'dark');
    const light = normalizeColors(record['light'], 'light');
    if (!isCustomThemeId(id) || seen.has(id)) continue;
    if (name.length === 0 || name.length > CUSTOM_THEME_NAME_LENGTH || !dark || !light) continue;
    seen.add(id);
    themes.push({ id, name, dark, light });
  }
  return themes;
}

function normalizeColors(value: unknown, appearance: Appearance): ThemeColors | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { canvas, accent } = record;
  if (!isHexColor(canvas) || !isHexColor(accent)) return null;
  const colors = generateThemeColors(appearance, canvas, accent);
  for (const role of THEME_COLOR_ROLES) {
    const stored = record[role];
    if (isHexColor(stored)) colors[role] = stored.toLowerCase();
  }
  // Themes saved with Orbit's old four-colour model kept their overrides apart.
  const overrides = record['overrides'];
  if (typeof overrides === 'object' && overrides !== null) {
    const legacy = overrides as Record<string, unknown>;
    const map: Record<string, ThemeColorRole[]> = {
      raised: ['surfaceRaised'],
      hover: ['accentSurface', 'sidebarRowHover'],
      line: ['border', 'sidebarBorder'],
      muted: ['textMuted', 'secondaryLabel']
    };
    for (const [token, roles] of Object.entries(map)) {
      const color = legacy[token];
      if (isHexColor(color)) for (const role of roles) colors[role] = color;
    }
  }
  return colors;
}

// ---- CSS variables ----

const SUCCESS = { dark: '#34d399', light: '#047857' } as const;

/**
 * The CSS variables for one variant. Orbit's stylesheet reads these names; each maps to the T3 Code role that paints
 * the same part of T3 Code.
 */
export function paletteVariables(colors: ThemeColors): Record<string, string> {
  const dark = isDarkColor(hexToRgb(colors.canvas));
  const accentSoft = toHex(mixRgb(hexToRgb(colors.canvas), hexToRgb(colors.accent), dark ? 0.2 : 0.12));
  const canvas = hexToRgb(colors.canvas);
  // Links and other accent-coloured text. Some themes (Rosé Pine) have an accent that is a dark surface tint, so text
  // falls back to the action colour, and failing that to the accent lightened or darkened until it reads.
  const accentText =
    contrastRatio(hexToRgb(colors.accent), canvas) >= 3
      ? colors.accent
      : contrastRatio(hexToRgb(colors.messageAction), canvas) >= 3
        ? colors.messageAction
        : readableColorOn(colors.accent, colors.canvas, 4.5);
  return {
    '--canvas': colors.canvas,
    '--chrome': colors.chrome,
    '--toolbar': colors.toolbar,
    '--toolbar-text': colors.toolbarForeground,
    '--toolbar-line': colors.toolbarBorder,
    '--toolbar-control': colors.toolbarControl,
    '--toolbar-control-text': colors.toolbarControlForeground,
    '--toolbar-control-hover': colors.toolbarControlHover,
    '--surface': colors.surface,
    '--raised': colors.surfaceRaised,
    '--overlay': colors.surfaceOverlay,
    '--hover': colors.accentSurface,
    '--hover-text': colors.accentSurfaceForeground,
    '--line': colors.border,
    '--input': colors.input,
    '--text': colors.text,
    '--muted': colors.textMuted,
    '--subtle': colors.secondaryLabel,
    '--placeholder': colors.placeholder,
    '--icon-muted': colors.iconMuted,
    '--secondary': colors.secondary,
    '--secondary-text': colors.secondaryForeground,
    '--muted-surface': colors.muted,
    '--muted-surface-text': colors.mutedForeground,
    '--accent': colors.accent,
    '--accent-content': colors.accentForeground,
    '--accent-soft': accentSoft,
    '--accent-text': accentText,
    // Focus rings and the text caret must stand out from the background; a theme whose focus colour is a dark
    // surface tint (Rosé Pine) gets the readable accent instead.
    '--focus': contrastRatio(hexToRgb(colors.focus), canvas) >= 3 ? colors.focus : accentText,
    '--action': colors.messageAction,
    '--action-content': colors.messageActionForeground,
    '--action-hover': colors.messageActionHover,
    '--danger': colors.errorForeground,
    '--danger-fill': colors.error,
    '--danger-surface': colors.errorSurface,
    '--warning': colors.warningForeground,
    '--warning-fill': colors.warning,
    '--warning-surface': colors.warningSurface,
    '--update': colors.updateForeground,
    '--update-surface': colors.updateSurface,
    '--success': SUCCESS[dark ? 'dark' : 'light'],
    '--message-surface': colors.messageSurface,
    '--message-text': colors.messageForeground,
    '--code-bg': colors.codeBackground,
    '--code-text': colors.codeForeground,
    '--search-match': colors.searchMatchBackground,
    '--search-match-text': colors.searchMatchForeground,
    '--search-match-active': colors.searchMatchActiveBackground,
    '--search-match-active-text': colors.searchMatchActiveForeground,
    '--sidebar': colors.sidebar,
    '--sidebar-text': colors.sidebarForeground,
    '--sidebar-muted': colors.sidebarMutedForeground,
    '--sidebar-control': colors.sidebarControlSurface,
    '--sidebar-hover': colors.sidebarRowHover,
    '--sidebar-active': colors.sidebarRowActive,
    '--sidebar-selected': colors.sidebarRowSelected,
    '--sidebar-line': colors.sidebarBorder
  };
}

/** Every property a palette sets, so the page can clear them. */
export const PALETTE_PROPERTY_NAMES = Object.keys(paletteVariables(builtInThemeColors('orbit', 'dark')));

// ---- Open VSX ----

/** One extension from an Open VSX search. */
export interface ThemeSearchResult {
  namespace: string;
  name: string;
  displayName: string;
  description: string;
  downloads: number;
  verified: boolean;
  /** The extension's icon as a data URL, or null when it has none Orbit will show. */
  icon: string | null;
}

/** An empty query lists the most used themes. Sorting is by downloads, or by when they were last updated. */
export interface ThemeSearchRequest {
  query: string;
  sort: 'downloadCount' | 'timestamp';
}

export interface ThemeImportRef {
  namespace: string;
  name: string;
}

/** The workbench colours read from an extension's themes. A missing variant is filled with Orbit's own. */
export interface ThemeImportDraft {
  name: string;
  /** The extension it came from, as namespace.name. */
  source: string;
  dark: VsCodeColors | null;
  light: VsCodeColors | null;
}

/** A fresh id for a custom theme. Only letters, digits and dashes, so it passes isCustomThemeId. */
export function newCustomThemeId(): CustomThemeId {
  return `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** A custom theme from an imported extension. A variant it lacks, or cannot be read, takes Orbit's own. */
export function themeFromImport(draft: ThemeImportDraft): CustomTheme {
  const variant = (appearance: Appearance) =>
    (draft[appearance] && themeColorsFromVsCode(draft[appearance], appearance)) ??
    builtInThemeColors('orbit', appearance);
  return {
    id: newCustomThemeId(),
    name: draft.name.slice(0, CUSTOM_THEME_NAME_LENGTH),
    dark: variant('dark'),
    light: variant('light')
  };
}

/** A colour from any CSS-ish value, as six-digit hex, or null. */
export function normalizeHex(value: string): string | null {
  return colorToHex(value);
}
