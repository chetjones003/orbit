import { describe, expect, it } from 'vitest';
import {
  derivedColor,
  mixHex,
  normalizeCustomThemes,
  paletteExists,
  paletteVariables,
  type CustomTheme,
  type ThemeColors
} from '../../../src/shared/themes';

const colors: ThemeColors = {
  canvas: '#000000',
  surface: '#ffffff',
  text: '#000000',
  accent: '#ff0000',
  overrides: {}
};

const theme: CustomTheme = {
  id: 'custom-aurora',
  name: 'Aurora',
  dark: colors,
  light: colors
};

describe('theme model', () => {
  it('mixes hex colours by weight', () => {
    expect(mixHex('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(mixHex('#ff0000', '#000000', 1)).toBe('#ff0000');
  });

  it('derives tokens from the core colours unless one is overridden', () => {
    expect(derivedColor(colors, 'line')).toBe(mixHex('#ffffff', '#000000', 0.78));
    const overridden = { ...colors, overrides: { line: '#123456' } };
    expect(derivedColor(overridden, 'line')).toBe('#123456');
    expect(paletteVariables(colors)['--canvas']).toBe('#000000');
    expect(paletteVariables(colors)['--accent']).toBe('#ff0000');
  });

  it('keeps only well-formed custom themes', () => {
    const kept = normalizeCustomThemes([
      theme,
      { ...theme, id: 'custom-bad-colour', dark: { ...colors, canvas: 'red' } },
      { ...theme, id: 'not-custom' },
      { ...theme, id: 'custom-blank', name: '   ' },
      { ...theme, id: 'custom-aurora' }
    ]);
    expect(kept.map((entry) => entry.id)).toEqual(['custom-aurora']);
  });

  it('drops overrides that are not hex colours', () => {
    const [saved] = normalizeCustomThemes([
      { ...theme, dark: { ...colors, overrides: { line: 'blue', hover: '#abcdef' } } }
    ]);
    expect(saved?.dark.overrides).toEqual({ hover: '#abcdef' });
  });

  it('recognises built-in palettes and custom themes that exist', () => {
    expect(paletteExists('ocean', [])).toBe(true);
    expect(paletteExists('custom-aurora', [theme])).toBe(true);
    expect(paletteExists('custom-gone', [theme])).toBe(false);
  });
});
