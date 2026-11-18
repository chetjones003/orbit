// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListResizeHandle } from '../../../src/renderer/src/shell/ListResizeHandle';
import {
  clampListWidth,
  readStoredListWidth,
  storeListWidth
} from '../../../src/renderer/src/shell/side-list-width';

beforeEach(() => {
  // Node's own experimental localStorage can shadow jsdom's, so the test brings a plain in-memory store.
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, String(value)),
      removeItem: (key: string) => void values.delete(key),
      clear: () => values.clear()
    }
  });
});

afterEach(() => {
  cleanup();
});

describe('ListResizeHandle', () => {
  it('nudges the width with the arrow keys and resets on a double click', () => {
    const onResize = vi.fn();
    render(<ListResizeHandle width={300} onResize={onResize} />);
    const handle = screen.getByRole('separator', { name: 'Resize lists panel' });

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onResize).toHaveBeenLastCalledWith(316);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onResize).toHaveBeenLastCalledWith(284);
    fireEvent.doubleClick(handle);
    expect(onResize).toHaveBeenLastCalledWith(300);
  });
});

describe('list width', () => {
  it('keeps the width between the minimum and the room the workspace leaves', () => {
    expect(clampListWidth(100, 1200)).toBe(240);
    expect(clampListWidth(900, 1200)).toBe(560);
    // 700px window: only 340px is left after the workspace's 360px minimum.
    expect(clampListWidth(500, 700)).toBe(340);
    expect(clampListWidth(500, 500)).toBe(240);
  });

  it('reads and writes the saved width, and falls back to the default when storage is empty or broken', () => {
    expect(readStoredListWidth()).toBe(300);
    storeListWidth(412);
    expect(readStoredListWidth()).toBe(412);
    expect(readStoredListWidth({ getItem: () => 'nonsense' })).toBe(300);
    expect(
      readStoredListWidth({
        getItem: () => {
          throw new Error('blocked');
        }
      })
    ).toBe(300);
  });
});
