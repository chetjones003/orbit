import type { CoreColors } from '../../shared/themes';

/** The colours Orbit takes from a VS Code theme, in the order it looks for them. */
const CANVAS_KEYS = ['editor.background', 'sideBar.background', 'activityBar.background'];
const SURFACE_KEYS = ['sideBar.background', 'editorWidget.background', 'panel.background'];
const TEXT_KEYS = ['editor.foreground', 'foreground'];
const ACCENT_KEYS = [
  'focusBorder',
  'button.background',
  'textLink.foreground',
  'activityBarBadge.background'
];

export interface VsCodeThemeFile {
  /** 'vs' (light), 'vs-dark', 'hc-black' or 'hc-light'. */
  uiTheme?: string;
  colors?: Record<string, unknown>;
  /** Another theme file whose colours this one builds on. */
  include?: string;
}

/**
 * Removes // and block comments, and trailing commas, from a JSON-with-comments document (VS Code's theme format).
 * Strings are left alone.
 */
export function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    const next = text[index + 1];
    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        index++;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index++;
      out += '\n';
    } else if (char === '/' && next === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index++;
      index++;
    } else {
      out += char;
    }
  }
  // Trailing commas before a closing brace or bracket are allowed in theme files.
  return out.replace(/,(\s*[}\]])/g, '$1');
}

export function parseVsCodeTheme(text: string): VsCodeThemeFile {
  const parsed: unknown = JSON.parse(stripJsonComments(text));
  if (typeof parsed !== 'object' || parsed === null) throw new Error('The theme file is not an object.');
  const record = parsed as Record<string, unknown>;
  return {
    uiTheme: typeof record['type'] === 'string' ? record['type'] : undefined,
    colors:
      typeof record['colors'] === 'object' && record['colors'] !== null
        ? (record['colors'] as Record<string, unknown>)
        : undefined,
    include: typeof record['include'] === 'string' ? record['include'] : undefined
  };
}

/** Whether a theme file is a dark one. Light themes are 'vs' and 'hc-light'. */
export function isDarkUiTheme(uiTheme: string | undefined): boolean {
  return uiTheme !== 'vs' && uiTheme !== 'hc-light';
}

/** A six-digit hex colour, from #rgb, #rrggbb or #rrggbbaa (the alpha is dropped). Anything else is null. */
export function hexFromVsCodeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (!match) return null;
  const digits = match[1]!;
  if (digits.length === 3)
    return `#${digits
      .split('')
      .map((d) => d + d)
      .join('')}`.toLowerCase();
  return `#${digits.slice(0, 6)}`.toLowerCase();
}

function firstHex(colors: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const hex = hexFromVsCodeColor(colors[key]);
    if (hex) return hex;
  }
  return null;
}

/**
 * The four core colours of a theme, read from its colour map. Returns null when the theme gives no background or
 * text colour, since nothing sensible can be built from it. Missing panel or accent colours fall back to the
 * background and to the Orbit accent for the variant.
 */
export function coreColorsFromVsCode(colors: Record<string, unknown>, dark: boolean): CoreColors | null {
  const canvas = firstHex(colors, CANVAS_KEYS);
  const text = firstHex(colors, TEXT_KEYS);
  if (!canvas || !text) return null;
  return {
    canvas,
    surface: firstHex(colors, SURFACE_KEYS) ?? canvas,
    text,
    accent: firstHex(colors, ACCENT_KEYS) ?? (dark ? '#b5a4ff' : '#6850b9')
  };
}
