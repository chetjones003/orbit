import { describe, expect, it } from 'vitest';
import { fitCount } from '../../../src/renderer/src/projects/ProjectViewTabs';

describe('fitCount', () => {
  it('shows every tab when they all fit', () => {
    expect(fitCount([100, 100, 100], 400, 40)).toBe(3);
  });

  it('keeps the leading tabs that fit and leaves room for the More button', () => {
    // Budget is 250 - 40 = 210: 100 + 100 fits, the third would reach 300.
    expect(fitCount([100, 100, 100, 100], 250, 40)).toBe(2);
  });

  it('shows none when not even one tab fits beside the More button', () => {
    expect(fitCount([120, 80], 100, 40)).toBe(0);
  });
});
