/** Light, dark, or follow Windows. */
export const COLOR_SCHEMES = ['system', 'light', 'dark'] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

/**
 * The built-in palettes. Each one has a light and a dark variant; the colour scheme picks which one shows. They are
 * defined in index.css, keyed by data-palette.
 */
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

/** The four colours a person picks for one variant. */
export interface CoreColors {
  /** The window background. */
  canvas: string;
  /** Panels and cards. */
  surface: string;
  text: string;
  accent: string;
}

/** Tokens derived from the core colours. A person can override any of them under Advanced. */
export const DERIVED_TOKENS = ['raised', 'hover', 'muted', 'line', 'accentSoft'] as const;
export type DerivedToken = (typeof DERIVED_TOKENS)[number];

export interface ThemeColors extends CoreColors {
  overrides: Partial<Record<DerivedToken, string>>;
}

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

/** Keeps only well-formed custom themes: valid id, name, and six-digit colours for both variants. */
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
    const dark = normalizeColors(record['dark']);
    const light = normalizeColors(record['light']);
    if (!isCustomThemeId(id) || seen.has(id)) continue;
    if (name.length === 0 || name.length > CUSTOM_THEME_NAME_LENGTH || !dark || !light) continue;
    seen.add(id);
    themes.push({ id, name, dark, light });
  }
  return themes;
}

function normalizeColors(value: unknown): ThemeColors | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { canvas, surface, text, accent } = record;
  if (!isHexColor(canvas) || !isHexColor(surface) || !isHexColor(text) || !isHexColor(accent)) return null;
  const overrides: Partial<Record<DerivedToken, string>> = {};
  const stored =
    typeof record['overrides'] === 'object' && record['overrides'] !== null ? record['overrides'] : {};
  for (const token of DERIVED_TOKENS) {
    const value = (stored as Record<string, unknown>)[token];
    if (isHexColor(value)) overrides[token] = value;
  }
  return { canvas, surface, text, accent, overrides };
}

/** Mixes two hex colours: weightA of the first, the rest of the second. */
export function mixHex(a: string, b: string, weightA: number): string {
  const channels = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const first = channels(a);
  const second = channels(b);
  return (
    '#' +
    first
      .map((value, index) => Math.round(value * weightA + second[index]! * (1 - weightA)))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
  );
}

/** The value of a derived token: its override if one is set, otherwise mixed from the core colours. */
export function derivedColor(colors: ThemeColors, token: DerivedToken): string {
  const override = colors.overrides[token];
  if (override) return override;
  const { canvas, surface, text, accent } = colors;
  switch (token) {
    case 'raised':
      return mixHex(surface, text, 0.92);
    case 'hover':
      return mixHex(surface, text, 0.84);
    case 'line':
      return mixHex(surface, text, 0.78);
    case 'muted':
      return mixHex(text, canvas, 0.72);
    case 'accentSoft':
      return mixHex(accent, canvas, 0.18);
  }
}

/** The CSS variables for one variant of a custom theme, with derived tokens resolved to hex. */
export function paletteVariables(colors: ThemeColors): Record<string, string> {
  return {
    '--canvas': colors.canvas,
    '--surface': colors.surface,
    '--raised': derivedColor(colors, 'raised'),
    '--hover': derivedColor(colors, 'hover'),
    '--line': derivedColor(colors, 'line'),
    '--text': colors.text,
    '--muted': derivedColor(colors, 'muted'),
    '--subtle': mixHex(colors.text, colors.canvas, 0.52),
    '--accent': colors.accent,
    '--accent-soft': derivedColor(colors, 'accentSoft')
  };
}

/** Every property a custom theme sets, so the page can clear them when another palette is chosen. */
export const PALETTE_PROPERTY_NAMES = Object.keys(
  paletteVariables({
    canvas: '#000000',
    surface: '#000000',
    text: '#000000',
    accent: '#000000',
    overrides: {}
  })
);

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

/** The colours read from an extension's themes. A missing variant is filled with Orbit's own. */
export interface ThemeImportDraft {
  name: string;
  /** The extension it came from, as namespace.name. */
  source: string;
  dark: CoreColors | null;
  light: CoreColors | null;
}

/** Orbit's own core colours, used where a theme leaves a variant out. */
export const ORBIT_CORE_COLORS: { dark: CoreColors; light: CoreColors } = {
  dark: { canvas: '#14161d', surface: '#191b24', text: '#e9eaf3', accent: '#b5a4ff' },
  light: { canvas: '#f5f5f9', surface: '#ffffff', text: '#292738', accent: '#6850b9' }
};

/** A fresh id for a custom theme. Only letters, digits and dashes, so it passes isCustomThemeId. */
export function newCustomThemeId(): CustomThemeId {
  return `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
