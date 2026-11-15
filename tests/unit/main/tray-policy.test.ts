import { describe, expect, it, vi } from 'vitest';
import { shouldHideOnClose, trayMenuItems } from '../../../src/main/tray-policy';

describe('shouldHideOnClose', () => {
  it('hides the window instead of closing it while Orbit keeps running in the tray', () => {
    expect(shouldHideOnClose({ quitting: false, trayAvailable: true })).toBe(true);
  });

  it('closes the window when the user really quits', () => {
    expect(shouldHideOnClose({ quitting: true, trayAvailable: true })).toBe(false);
  });

  it('closes the window when no tray icon exists, so the user is never left with no way back', () => {
    expect(shouldHideOnClose({ quitting: false, trayAvailable: false })).toBe(false);
  });
});

describe('trayMenuItems', () => {
  it('offers Show Orbit and Quit Orbit, wired to the given handlers', () => {
    const show = vi.fn();
    const quit = vi.fn();
    const items = trayMenuItems({ show, quit });

    expect(items.map((entry) => entry.label)).toEqual(['Show Orbit', undefined, 'Quit Orbit']);
    items[0]?.onSelect?.();
    items[2]?.onSelect?.();
    expect(show).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
  });
});
