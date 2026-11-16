/** The left panel's width in pixels. It can be dragged between these bounds, and reset with a double click. */
export const LIST_DEFAULT_WIDTH = 300;
export const LIST_MIN_WIDTH = 240;
export const LIST_MAX_WIDTH = 560;
/** Room kept for the workspace beside the left panel, so the centre never disappears. */
export const WORKSPACE_MIN_WIDTH = 360;
/** Where the width is kept between launches. */
export const LIST_WIDTH_STORAGE_KEY = 'orbit.listWidth';

/**
 * Keeps a requested width between the minimum and the widest the window allows. The list is never wider than
 * the window minus the room the workspace needs, but never narrower than the rail fits.
 */
export function clampListWidth(next: number, windowWidth: number): number {
  const room = Math.min(LIST_MAX_WIDTH, windowWidth - WORKSPACE_MIN_WIDTH);
  const max = Math.max(LIST_MIN_WIDTH, room);
  return Math.min(max, Math.max(LIST_MIN_WIDTH, Math.round(next)));
}

/** The saved width, or the default when nothing valid is stored. Storage can be unavailable; the default still applies. */
export function readStoredListWidth(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): number {
  try {
    const value = Number(storage?.getItem(LIST_WIDTH_STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : LIST_DEFAULT_WIDTH;
  } catch {
    return LIST_DEFAULT_WIDTH;
  }
}

export function storeListWidth(
  width: number,
  storage: Pick<Storage, 'setItem'> | undefined = safeStorage()
): void {
  try {
    storage?.setItem(LIST_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // Not saved this time; the width still holds for the session.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
