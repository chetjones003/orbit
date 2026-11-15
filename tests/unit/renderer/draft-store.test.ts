import { describe, expect, it } from 'vitest';
import { DraftStore, type DraftKey } from '../../../src/renderer/src/comments/draft-store';

const NEW_COMMENT: DraftKey = {
  login: 'orbit-owner',
  repoFullName: 'orbit-owner/app',
  kind: 'issue',
  number: 4,
  target: 'new'
};

describe('DraftStore', () => {
  it('keeps unsent text for an item so it is still there after navigating away and back', () => {
    const store = new DraftStore();
    store.set(NEW_COMMENT, 'Half-written reply');

    expect(store.get(NEW_COMMENT)).toBe('Half-written reply');
  });

  it('keeps drafts for different accounts, repos, items, and targets apart', () => {
    const store = new DraftStore();
    store.set(NEW_COMMENT, 'issue 4');
    store.set({ ...NEW_COMMENT, number: 5 }, 'issue 5');
    store.set({ ...NEW_COMMENT, repoFullName: 'orbit-owner/other' }, 'other repo');
    store.set({ ...NEW_COMMENT, login: 'second-account' }, 'second account');
    store.set({ ...NEW_COMMENT, target: { commentId: 9 } }, 'editing comment 9');

    expect(store.get(NEW_COMMENT)).toBe('issue 4');
    expect(store.get({ ...NEW_COMMENT, number: 5 })).toBe('issue 5');
    expect(store.get({ ...NEW_COMMENT, repoFullName: 'orbit-owner/other' })).toBe('other repo');
    expect(store.get({ ...NEW_COMMENT, login: 'second-account' })).toBe('second account');
    expect(store.get({ ...NEW_COMMENT, target: { commentId: 9 } })).toBe('editing comment 9');
  });

  it('removes the draft when the text is cleared', () => {
    const store = new DraftStore();
    store.set(NEW_COMMENT, 'text');
    store.set(NEW_COMMENT, '');

    expect(store.get(NEW_COMMENT)).toBeUndefined();
    expect(store.hasDrafts()).toBe(false);
  });

  it('reports unsent drafts so the app can warn before losing them, ignoring whitespace-only text', () => {
    const store = new DraftStore();
    store.set(NEW_COMMENT, '   \n  ');
    expect(store.hasDrafts()).toBe(false);

    store.set(NEW_COMMENT, 'real words');
    expect(store.hasDrafts()).toBe(true);
  });

  it("drops only one account's drafts on sign-out", () => {
    const store = new DraftStore();
    store.set(NEW_COMMENT, 'mine');
    store.set({ ...NEW_COMMENT, login: 'second-account' }, 'theirs');

    store.clearAccount('orbit-owner');

    expect(store.get(NEW_COMMENT)).toBeUndefined();
    expect(store.get({ ...NEW_COMMENT, login: 'second-account' })).toBe('theirs');
  });
});
