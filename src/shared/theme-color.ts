/**
 * Colour maths for themes, ported from T3 Code's theme palette so Orbit derives and reads colours the same way.
 * Colours are sRGB channels from 0 to 255. Every colour this module returns is a six-digit hex string.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  a: number;
}

export interface Oklch {
  L: number;
  C: number;
  h: number;
}

/** Below this relative luminance, white text reads better than black. */
export const DARK_LUMINANCE = 0.179;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function decodeGamma(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function encodeGamma(value: number): number {
  const c = clamp(value, 0, 1);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

/**
 * Reads #rgb, #rgba, #rrggbb, #rrggbbaa, oklch(L C h [/ a]) and color(srgb|display-p3 r g b [/ a]). The hash is optional
 * for hex, as VS Code themes sometimes leave it out. Null for anything else.
 */
export function parseColor(value: unknown): Rgba | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^oklch\(/i.test(trimmed)) return parseOklchFunction(trimmed);
  if (/^color\(/i.test(trimmed)) return parseColorFunction(trimmed);
  const hex = trimmed.replace(/^#/, '');
  if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null;
  const expand = (part: string) => parseInt(part.length === 1 ? part + part : part, 16);
  if (hex.length <= 4) {
    return {
      r: expand(hex[0]!),
      g: expand(hex[1]!),
      b: expand(hex[2]!),
      a: hex.length === 4 ? expand(hex[3]!) / 255 : 1
    };
  }
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
  };
}

function splitChannels(body: string): { channels: number[]; alpha: number } | null {
  const [channelPart, alphaPart] = body.split('/');
  const channels = channelPart!
    .trim()
    .split(/\s+/)
    .map((part) => (part.endsWith('%') ? parseFloat(part) / 100 : parseFloat(part)));
  const alphaRaw = alphaPart?.trim();
  const alpha =
    alphaRaw === undefined ? 1 : alphaRaw.endsWith('%') ? parseFloat(alphaRaw) / 100 : parseFloat(alphaRaw);
  if (channels.length !== 3 || ![...channels, alpha].every(Number.isFinite)) return null;
  return { channels, alpha: clamp(alpha, 0, 1) };
}

function parseOklchFunction(value: string): Rgba | null {
  const match = /^oklch\(\s*([^)]+)\)$/i.exec(value);
  const parts = match ? splitChannels(match[1]!) : null;
  if (!parts) return null;
  const [L, C, h] = parts.channels as [number, number, number];
  return { ...oklchToRgb({ L, C, h }, false), a: parts.alpha };
}

function parseColorFunction(value: string): Rgba | null {
  const match = /^color\(\s*(display-p3|srgb)\s+([^)]+)\)$/i.exec(value);
  const parts = match ? splitChannels(match[2]!) : null;
  if (!match || !parts) return null;
  const [red, green, blue] = parts.channels as [number, number, number];
  if (match[1]!.toLowerCase() === 'srgb') {
    return { r: red * 255, g: green * 255, b: blue * 255, a: parts.alpha };
  }
  const [lr, lg, lb] = [red, green, blue].map(decodeGamma) as [number, number, number];
  const srgb = [
    1.2249401762805 * lr - 0.2249401762805 * lg,
    -0.042056961239 * lr + 1.042056961239 * lg,
    -0.0196375547643 * lr - 0.0786360655012 * lg + 1.0982736202656 * lb
  ].map((channel) => encodeGamma(channel) * 255) as [number, number, number];
  return { r: srgb[0], g: srgb[1], b: srgb[2], a: parts.alpha };
}

export function toHex(color: Rgb): string {
  const channel = (value: number) =>
    Math.round(clamp(value, 0, 255))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

/** Any colour parseColor reads, as six-digit hex. Translucent colours are laid over `base`. */
export function colorToHex(value: unknown, base: Rgb = { r: 0, g: 0, b: 0 }): string | null {
  const parsed = parseColor(value);
  return parsed ? flattenOver(parsed, base) : null;
}

export function hexToRgb(value: string): Rgb {
  const parsed = parseColor(value);
  return parsed ? { r: parsed.r, g: parsed.g, b: parsed.b } : { r: 0, g: 0, b: 0 };
}

/** Lays a translucent colour over an opaque one. Theme roles are opaque. */
export function flattenOver(color: Rgba, base: Rgb): string {
  if (color.a >= 1) return toHex(color);
  return toHex(mixRgb(base, color, color.a));
}

/** `amount` of `overlay` mixed into `base`. */
export function mixRgb(base: Rgb, overlay: Rgb, amount: number): Rgb {
  return {
    r: base.r + (overlay.r - base.r) * amount,
    g: base.g + (overlay.g - base.g) * amount,
    b: base.b + (overlay.b - base.b) * amount
  };
}

export function relativeLuminance(color: Rgb): number {
  const channel = (value: number) => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

export function contrastRatio(first: Rgb, second: Rgb): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function isDarkColor(color: Rgb): boolean {
  return relativeLuminance(color) < DARK_LUMINANCE;
}

export function rgbToOklch(color: Rgb): Oklch {
  const r = decodeGamma(color.r / 255);
  const g = decodeGamma(color.g / 255);
  const b = decodeGamma(color.b / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), h: (Math.atan2(B, A) * 180) / Math.PI };
}

function oklchToLinear({ L, C, h }: Oklch): Rgb {
  const hr = (h * Math.PI) / 180;
  const A = C * Math.cos(hr);
  const B = C * Math.sin(hr);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  };
}

/** Lowers chroma until the colour fits in sRGB, keeping lightness and hue. */
function intoGamut(color: Oklch): Oklch {
  const fits = (C: number) => {
    const linear = oklchToLinear({ ...color, C });
    return [linear.r, linear.g, linear.b].every((channel) => channel >= -0.0001 && channel <= 1.0001);
  };
  if (fits(color.C)) return color;
  let low = 0;
  let high = color.C;
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2;
    if (fits(mid)) low = mid;
    else high = mid;
  }
  return { ...color, C: low };
}

export function oklchToRgb(color: Oklch, round = true): Rgb {
  const linear = oklchToLinear(intoGamut(color));
  const channel = (value: number) => {
    const srgb = encodeGamma(value) * 255;
    return round ? Math.round(srgb) : srgb;
  };
  return { r: channel(linear.r), g: channel(linear.g), b: channel(linear.b) };
}

export function oklchToHex(color: Oklch): string {
  return toHex(oklchToRgb(color));
}

/** Moves only the lightness of `base` until it reaches `minContrast` against every colour in `against`. */
export function solveLightness(
  base: Oklch,
  against: readonly Rgb[],
  minContrast: number,
  direction: 'lighter' | 'darker'
): Oklch {
  const contrastOf = (color: Oklch) =>
    Math.min(...against.map((surface) => contrastRatio(oklchToRgb(color), surface)));
  if (contrastOf(base) >= minContrast) return base;
  let low = direction === 'lighter' ? base.L : 0;
  let high = direction === 'lighter' ? 1 : base.L;
  for (let step = 0; step < 18; step += 1) {
    const mid = (low + high) / 2;
    const passes = contrastOf({ ...base, L: mid }) >= minContrast;
    if (direction === 'lighter') {
      if (passes) high = mid;
      else low = mid;
    } else if (passes) low = mid;
    else high = mid;
  }
  return { ...base, L: direction === 'lighter' ? high : low };
}

/** `color` with its lightness moved until it reads on `surface`, keeping its hue. */
export function readableColorOn(color: string, surface: string, minContrast: number): string {
  const parsed = parseColor(color);
  const background = parseColor(surface);
  if (!parsed || !background) return color;
  if (contrastRatio(parsed, background) >= minContrast) return toHex(parsed);
  const direction = isDarkColor(background) ? 'lighter' : 'darker';
  return oklchToHex(solveLightness(rgbToOklch(parsed), [background], minContrast, direction));
}

const LIGHT_FOREGROUND: Rgb = { r: 255, g: 250, b: 255 };
const DARK_FOREGROUND: Rgb = { r: 36, g: 21, b: 35 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/** Near-white or near-black text, whichever reads on `background`. */
export function readableForeground(background: Rgb): Rgb {
  const light = contrastRatio(background, LIGHT_FOREGROUND);
  const dark = contrastRatio(background, DARK_FOREGROUND);
  if (Math.max(light, dark) >= 4.5) return light >= dark ? LIGHT_FOREGROUND : DARK_FOREGROUND;
  return contrastRatio(background, WHITE) >= contrastRatio(background, BLACK) ? WHITE : BLACK;
}

/** `foreground` softened toward `background` as far as `amount`, but never below `minimumRatio`. */
export function readableText(background: Rgb, foreground: Rgb, amount: number, minimumRatio: number): Rgb {
  const softened = mixRgb(foreground, background, amount);
  if (contrastRatio(softened, background) >= minimumRatio) return softened;
  let readable = foreground;
  let lower = 0;
  let upper = amount;
  for (let index = 0; index < 12; index += 1) {
    const candidateAmount = (lower + upper) / 2;
    const candidate = mixRgb(foreground, background, candidateAmount);
    if (contrastRatio(candidate, background) >= minimumRatio) {
      readable = candidate;
      lower = candidateAmount;
    } else {
      upper = candidateAmount;
    }
  }
  return readable;
}

/** Muted text at the contrast T3 Code's standard theme uses. */
export function mutedText(background: Rgb, foreground: Rgb): Rgb {
  return readableText(background, foreground, 1, isDarkColor(background) ? 5.082 : 4.705);
}
