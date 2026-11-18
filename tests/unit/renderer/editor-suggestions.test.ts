// @vitest-environment jsdom
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SLASH_COMMANDS,
  matchItems,
  matchPeople,
  suggestionSource,
  type ItemSuggestion
} from '../../../src/renderer/src/comments/editor-suggestions';

const item = (number: number, title: string, kind: 'issue' | 'pull' = 'issue'): ItemSuggestion => ({
  number,
  title,
  kind,
  state: 'open',
  updatedAt: `2026-11-${String(number).padStart(2, '0')}`
});

/** Asks the source for suggestions with the cursor at the end of `text`. */
async function suggest(text: string, context = { repoFullName: 'me/app', people: ['ana'] }) {
  const state = EditorState.create({ doc: text });
  const result = await suggestionSource(() => context)(new CompletionContext(state, text.length, false));
  return result?.options.map((option) => option.label) ?? null;
}

beforeEach(() => {
  (window as unknown as { orbit: unknown }).orbit = {
    issues: {
      list: vi.fn(async () => ({
        items: [
          { number: 3, title: 'Export drops rows', state: 'open', updatedAt: '2026-11-03' },
          { number: 12, title: 'Crash on save', state: 'closed', updatedAt: '2026-11-12' }
        ]
      })),
      repoOptions: vi.fn(async () => ({
        assignees: ['bo', 'ana'],
        labels: [],
        milestones: [],
        partial: false
      }))
    },
    pulls: {
      list: vi.fn(async () => ({
        items: [
          {
            number: 14,
            title: 'Fix export',
            state: 'open',
            merged: false,
            draft: false,
            updatedAt: '2026-11-14'
          }
        ]
      }))
    }
  };
});

describe('matching', () => {
  const items = [
    item(1, 'Docs diagrams'),
    item(14, 'Fix crash on Windows', 'pull'),
    item(12, 'Crash reports')
  ];

  it('matches a number by its start and words anywhere in the title', () => {
    expect(matchItems(items, '1').map((entry) => entry.number)).toEqual([1, 14, 12]);
    expect(matchItems(items, '14').map((entry) => entry.number)).toEqual([14]);
    expect(matchItems(items, 'crash').map((entry) => entry.number)).toEqual([14, 12]);
    expect(matchItems(items, '').length).toBe(3);
  });

  it('lists people whose login starts with the text before those that only contain it, once each', () => {
    expect(matchPeople(['bo', 'ana', 'banana', 'ana'], 'an')).toEqual(['ana', 'banana']);
  });
});

describe('suggestion source', () => {
  it('suggests issues and pull requests after #, newest first', async () => {
    expect(await suggest('Blocked by #')).toEqual(['#14', '#12', '#3']);
    expect(await suggest('Blocked by #1')).toEqual(['#14', '#12']);
  });

  it('suggests people after @, the conversation first', async () => {
    expect(await suggest('Thanks @')).toEqual(['@ana', '@bo']);
  });

  it('only triggers at the start of a word', async () => {
    expect(await suggest('mail me@')).toBeNull();
    expect(await suggest('issue#')).toBeNull();
  });

  it('offers Markdown snippets after / at the start of a line, filtered by name', async () => {
    expect((await suggest('/'))?.length).toBe(SLASH_COMMANDS.length);
    expect(await suggest('Some text\n/table')).toEqual(['/Table']);
    expect(await suggest('and/or')).toBeNull();
  });
});
