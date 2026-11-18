import { describe, expect, it } from 'vitest';
import {
  builtInThemeColors,
  generateThemeColors,
  isHexColor,
  normalizeCustomThemes,
  paletteExists,
  paletteVariables,
  THEME_COLOR_ROLES,
  themeColorsFromVsCode,
  themeFromImport,
  type CustomTheme
} from '../../../src/shared/themes';
import { contrastRatio, hexToRgb } from '../../../src/shared/theme-color';

const dark = generateThemeColors('dark', '#191724', '#ebbcba');
const light = generateThemeColors('light', '#faf4ed', '#d7827e');
const theme: CustomTheme = { id: 'custom-aurora', name: 'Aurora', dark, light };

/** A cut-down Rosé Pine, in VS Code's own keys. */
const ROSE_PINE: Record<string, string> = {
  'editor.background': '#191724',
  'editor.foreground': '#e0def4',
  'editorWidget.background': '#1f1d2e',
  'sideBar.background': '#191724',
  'sideBar.border': '#26233a',
  focusBorder: '#6e6a8620',
  'button.background': '#ebbcba',
  'button.foreground': '#191724',
  'textLink.foreground': '#c4a7e7',
  'list.hoverBackground': '#6e6a861a',
  'list.activeSelectionBackground': '#6e6a8633',
  'panel.border': '#26233a',
  'menu.background': '#1f1d2e',
  'input.background': '#26233a80',
  errorForeground: '#eb6f92'
};

describe('theme model', () => {
  it('fills every role with a hex colour', () => {
    for (const colors of [dark, light, builtInThemeColors('ocean', 'dark')]) {
      expect(THEME_COLOR_ROLES.every((role) => isHexColor(colors[role]))).toBe(true);
    }
  });

  it('generates readable text from a background and accent', () => {
    expect(dark.canvas).toBe('#191724');
    expect(dark.accent).toBe('#ebbcba');
    expect(contrastRatio(hexToRgb(dark.text), hexToRgb(dark.canvas))).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(hexToRgb(light.text), hexToRgb(light.canvas))).toBeGreaterThanOrEqual(7);
  });

  it('reads a VS Code theme the way T3 Code does', () => {
    const colors = themeColorsFromVsCode(ROSE_PINE, 'dark')!;
    expect(colors.canvas).toBe('#191724');
    expect(colors.text).toBe('#e0def4');
    expect(colors.surface).toBe('#1f1d2e');
    expect(colors.surfaceOverlay).toBe('#1f1d2e');
    expect(colors.border).toBe('#26233a');
    expect(colors.sidebarBorder).toBe('#26233a');
    // focusBorder is too faint to stand apart, so the button colour is the accent.
    expect(colors.accent).toBe('#ebbcba');
    expect(colors.messageAction).toBe('#ebbcba');
    expect(colors.messageActionForeground).toBe('#191724');
    // Translucent list colours are laid over the sidebar.
    expect(colors.sidebarRowSelected).not.toBe('#6e6a8633');
    expect(isHexColor(colors.sidebarRowSelected)).toBe(true);
  });

  it('needs an editor background to read a VS Code theme', () => {
    expect(themeColorsFromVsCode({ 'editor.foreground': '#ffffff' }, 'dark')).toBeNull();
  });

  it('fills a variant an import lacks with Orbit’s own', () => {
    const imported = themeFromImport({ name: 'Rosé Pine', source: 'x.y', dark: ROSE_PINE, light: null });
    expect(imported.dark.canvas).toBe('#191724');
    expect(imported.light).toEqual(builtInThemeColors('orbit', 'light'));
  });

  it('maps roles to the variables the stylesheet reads', () => {
    const variables = paletteVariables(dark);
    expect(variables['--canvas']).toBe(dark.canvas);
    expect(variables['--sidebar']).toBe(dark.sidebar);
    expect(variables['--action']).toBe(dark.messageAction);
    expect(variables['--overlay']).toBe(dark.surfaceOverlay);
  });

  it('keeps focus rings and the caret visible when a theme’s focus colour is a dark surface tint', () => {
    // Rosé Pine's focus and accent are #2a2838, which barely differs from its #191724 background.
    const roseLike = { ...dark, focus: '#2a2838', accent: '#2a2838', messageAction: '#ebbcba' };
    const variables = paletteVariables(roseLike);
    expect(variables['--focus']).toBe('#ebbcba');
    expect(
      contrastRatio(hexToRgb(variables['--focus'] as string), hexToRgb(roseLike.canvas))
    ).toBeGreaterThanOrEqual(3);
    // A readable focus colour is kept as the theme chose it.
    expect(paletteVariables({ ...dark, focus: '#9ccfd8' })['--focus']).toBe('#9ccfd8');
  });

  it('keeps only well-formed custom themes', () => {
    const kept = normalizeCustomThemes([
      theme,
      { ...theme, id: 'custom-bad-colour', dark: { ...dark, canvas: 'red' } },
      { ...theme, id: 'not-custom' },
      { ...theme, id: 'custom-blank', name: '   ' },
      { ...theme, id: 'custom-aurora' }
    ]);
    expect(kept.map((entry) => entry.id)).toEqual(['custom-aurora']);
    expect(kept[0]?.dark).toEqual(dark);
  });

  it('rebuilds themes saved with the old four colours', () => {
    const [saved] = normalizeCustomThemes([
      {
        id: 'custom-old',
        name: 'Old',
        dark: {
          canvas: '#282a36',
          surface: '#21222c',
          text: '#f8f8f2',
          accent: '#bd93f9',
          overrides: { line: '#44475a', hover: 'blue' }
        },
        light: { canvas: '#ffffff', surface: '#ffffff', text: '#000000', accent: '#6850b9', overrides: {} }
      }
    ]);
    expect(saved?.dark.canvas).toBe('#282a36');
    expect(saved?.dark.surface).toBe('#21222c');
    expect(saved?.dark.border).toBe('#44475a');
    expect(THEME_COLOR_ROLES.every((role) => isHexColor(saved?.dark[role]))).toBe(true);
  });

  it('recognises built-in palettes and custom themes that exist', () => {
    expect(paletteExists('ocean', [])).toBe(true);
    expect(paletteExists('custom-aurora', [theme])).toBe(true);
    expect(paletteExists('custom-gone', [theme])).toBe(false);
  });
});
