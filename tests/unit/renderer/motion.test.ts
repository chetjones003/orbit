import { describe, expect, it } from 'vitest';
import { motionMode } from '../../../src/renderer/src/shell/motion';

describe('motionMode', () => {
  it('follows Windows: a fade when animations are off there', () => {
    expect(motionMode('system', true)).toBe('fade');
    expect(motionMode(undefined, true)).toBe('fade');
  });

  it('slides and grows when Windows has animations on', () => {
    expect(motionMode('system', false)).toBe('full');
  });

  it('animates in full whatever Windows says, when always animate is chosen', () => {
    expect(motionMode('always', true)).toBe('full');
    expect(motionMode('always', false)).toBe('full');
  });
});
