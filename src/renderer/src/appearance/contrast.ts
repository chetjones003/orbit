/** Colour adjustments for Settings > Appearance > Interface. Pure functions, so they can be tested without a window. */

type Rgb = [number, number, number];

function parseHex(value: string): Rgb | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const digits = match[1]!.length === 3 ? [...match[1]!].map((c) => c + c).join('') : match[1]!;
  return [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

/** Mixes `amount` (0 to 1) of `to` into `from`. Returns null when either colour is not a #rgb or #rrggbb hex value. */
export function mixHex(from: string, to: string, amount: number): string | null {
  const a = parseHex(from);
  const b = parseHex(to);
  if (!a || !b) return null;
  const t = Math.min(1, Math.max(0, amount));
  return toHex(a.map((channel, i) => channel + (b[i]! - channel) * t) as Rgb);
}

/** Relative brightness from 0 (black) to 1 (white). Null when the colour is not hex. */
function brightness(value: string): number | null {
  const rgb = parseHex(value);
  if (!rgb) return null;
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
}

export interface ContrastBase {
  /** Borders and dividers. */
  line: string;
  /** Secondary text. */
  muted: string;
  /** Tertiary text. */
  subtle: string;
  /** Primary text. */
  text: string;
  surface: string;
}

/**
 * The custom properties for a contrast setting (0 to 200, 100 as designed). Above 100, borders and all text move toward
 * the text extreme for the surface: white on a dark surface, black on a light one. Below 100, they fade toward the
 * surface. A colour that is not hex is left alone, so that property keeps the theme's own value.
 */
export function contrastProperties(contrast: number, base: ContrastBase): Record<string, string> {
  const t = (contrast - 100) / 100;
  if (t === 0) return {};
  const extreme = (brightness(base.surface) ?? 0.5) < 0.5 ? '#ffffff' : '#000000';
  const mix = (from: string, amountUp: number, amountDown: number): string | null =>
    t > 0 ? mixHex(from, extreme, t * amountUp) : mixHex(from, base.surface, -t * amountDown);
  const properties: Record<string, string> = {};
  const assign = (name: string, value: string | null): void => {
    if (value) properties[name] = value;
  };
  assign('--line', t > 0 ? mixHex(base.line, base.text, t * 0.6) : mixHex(base.line, base.surface, -t * 0.6));
  assign('--text', mix(base.text, 0.6, 0.35));
  assign('--muted', mix(base.muted, 0.5, 0.3));
  assign('--subtle', mix(base.subtle, 0.45, 0.3));
  return properties;
}

/**
 * The surface colours with the glass opacity applied, as #rrggbbaa. 100 (or a colour that is not hex) returns null, so
 * the theme's own colour stays solid.
 */
export function glassSurface(glass: number, colour: string): string | null {
  if (glass >= 100) return null;
  const rgb = parseHex(colour);
  if (!rgb) return null;
  const alpha = Math.round((Math.max(0, glass) / 100) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${toHex(rgb)}${alpha}`;
}
