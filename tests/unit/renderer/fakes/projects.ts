import { vi } from 'vitest';

/**
 * A `window.orbit.projects` stub for tests that render issue or pull request details. The
 * sidebar asks for memberships and the project list, so both answer with nothing by default.
 */
export function projectsStub() {
  return {
    list: vi.fn(async () => ({ projects: [], partial: false })),
    detail: vi.fn(),
    items: vi.fn(async () => ({ items: [], partial: false })),
    itemMemberships: vi.fn(async () => ({ contentId: 'I_1', memberships: [], partial: false })),
    addItem: vi.fn(),
    removeItem: vi.fn(),
    setField: vi.fn()
  };
}
