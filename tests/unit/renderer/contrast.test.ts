import { describe, expect, it } from 'vitest';
import { contrastProperties, glassSurface, mixHex } from '../../../src/renderer/src/appearance/contrast';

const dark = { line: '#000000', muted: '#808080', subtle: '#404040', text: '#c0c0c0', surface: '#000000' };
const light = { line: '#808080', muted: '#808080', subtle: '#808080', text: '#000000', surface: '#ffffff' };

describe('mixHex', () => {
  it('mixes two hex colours by the given amount', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#000', '#fff', 1)).toBe('#ffffff');
  });

  it('returns null for a colour that is not hex', () => {
    expect(mixHex('color-mix(in srgb, red, blue)', '#ffffff', 0.5)).toBeNull();
  });
});

describe('contrastProperties', () => {
  it('leaves the theme alone at 100', () => {
    expect(contrastProperties(100, dark)).toEqual({});
  });

  it('moves borders and all text toward white on a dark surface above 100', () => {
    const properties = contrastProperties(200, dark);
    expect(properties['--line']).toBe('#737373');
    expect(properties['--text']).toBe('#e6e6e6');
    expect(properties['--muted']).toBe('#c0c0c0');
    expect(properties['--subtle']).toBe('#969696');
  });

  it('moves borders and text toward black on a light surface, and fades them below 100', () => {
    const properties = contrastProperties(0, light);
    expect(properties['--line']).toBe('#cccccc');
    expect(properties['--text']).toBe('#595959');
    expect(properties['--muted']).toBe('#a6a6a6');
  });

  it('skips a colour it cannot mix, so the theme value stays', () => {
    const properties = contrastProperties(200, { ...dark, text: 'rgb(0 0 0)' });
    expect(properties['--text']).toBeUndefined();
    expect(properties['--muted']).toBeDefined();
  });
});

describe('glassSurface', () => {
  it('returns null at 100, so the surface stays solid', () => {
    expect(glassSurface(100, '#191b24')).toBeNull();
  });

  it('adds the opacity as an alpha byte', () => {
    expect(glassSurface(60, '#191b24')).toBe('#191b2499');
  });

  it('returns null for a colour that is not hex', () => {
    expect(glassSurface(40, 'rgb(0 0 0)')).toBeNull();
  });
});
