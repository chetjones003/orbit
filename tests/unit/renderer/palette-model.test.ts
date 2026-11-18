import { describe, expect, it } from 'vitest';
import {
  BODY_ONLY_SCORE,
  applyFrozenOrder,
  paletteMode,
  paletteQuery,
  pushRecent,
  rankRows,
  requestPalette,
  scoreItem,
  scoreText,
  type RecentEntry
} from '../../../src/renderer/src/palette/palette-model';
import type { InboxItem } from '../../../src/shared/inbox';

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    repoFullName: 'me/atlas',
    number: 7,
    kind: 'pull',
    title: 'Ship the search',
    state: 'open',
    isDraft: false,
    authorLogin: 'me',
    labels: [],
    commentCount: 0,
    updatedAt: '2026-02-01T00:00:00Z',
    htmlUrl: 'https://github.com/me/atlas/pull/7',
    ...overrides
  };
}

describe('palette modes', () => {
  it('reads a leading > as command mode', () => {
    expect(paletteMode('')).toBe('goto');
    expect(paletteMode('settings')).toBe('goto');
    expect(paletteMode('comments:>5')).toBe('goto');
    expect(paletteMode('>zoom')).toBe('commands');
    expect(paletteQuery('> zoom in ')).toBe('zoom in');
    expect(paletteQuery(' atlas ')).toBe('atlas');
  });

  it('opens empty in go-to mode, and with > in command mode', () => {
    expect(requestPalette({ open: false, text: 'old' }, 'goto')).toEqual({ open: true, text: '' });
    expect(requestPalette({ open: false, text: '' }, 'commands')).toEqual({ open: true, text: '>' });
  });

  it('switches modes while open and keeps what was typed', () => {
    expect(requestPalette({ open: true, text: 'zoom' }, 'commands')).toEqual({ open: true, text: '>zoom' });
    expect(requestPalette({ open: true, text: '> zoom' }, 'goto')).toEqual({ open: true, text: 'zoom' });
  });

  it('closes when the shortcut names the mode already showing', () => {
    expect(requestPalette({ open: true, text: 'atlas' }, 'goto')).toEqual({ open: false, text: '' });
    expect(requestPalette({ open: true, text: '>zoom' }, 'commands')).toEqual({ open: false, text: '' });
  });
});

describe('scoring', () => {
  it('prefers exact, then prefix, then word start, then substring, then fuzzy', () => {
    const scores = [
      scoreText('zoom', 'Zoom'),
      scoreText('zoom', 'Zoom in'),
      scoreText('zoom', 'Reset zoom'),
      scoreText('zoom', 'Autozoom'),
      scoreText('zoom', 'Z o o m')
    ];
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(new Set(scores).size).toBe(scores.length);
    expect(scores.at(-1)).toBeGreaterThan(0);
  });

  it('matches every word of the query, in any order', () => {
    expect(scoreText('in zoom', 'Zoom in')).toBeGreaterThan(0);
    expect(scoreText('zoom out', 'Zoom in')).toBe(0);
  });

  it('rejects letters scattered too far apart to be a match', () => {
    expect(scoreText('ab', 'a long sentence that eventually reaches b')).toBe(0);
    expect(scoreText('xyz', 'Settings')).toBe(0);
  });

  it('puts an exact issue number first and hidden body matches last', () => {
    const exact = scoreItem(item({ number: 12, title: 'Unrelated' }), { terms: '12', number: 12 });
    const title = scoreItem(item({ title: '12 monkeys' }), { terms: '12', number: 12 });
    const hidden = scoreItem(item({ title: 'Unrelated' }), { terms: 'needle', number: null });
    expect(exact).toBeGreaterThan(title);
    expect(hidden).toBe(BODY_ONLY_SCORE);
    expect(scoreText('needle', 'needle')).toBeGreaterThan(hidden);
  });

  it('gives filter-only searches a real score, so their results rank with places', () => {
    expect(scoreItem(item(), { terms: '', number: null })).toBeGreaterThan(BODY_ONLY_SCORE);
  });
});

describe('ordering', () => {
  const row = (id: string, score: number) => ({ id, score });

  it('sorts by score and keeps source order on ties', () => {
    const ranked = rankRows([row('place', 5), row('best', 9), row('item', 5), row('none', 0)]);
    expect(ranked.map((entry) => entry.id)).toEqual(['best', 'place', 'item']);
  });

  it('keeps a frozen order and appends rows that arrive later', () => {
    const live = [row('new', 99), row('b', 5), row('a', 1)];
    expect(applyFrozenOrder(live, ['a', 'gone', 'b']).map((entry) => entry.id)).toEqual(['a', 'b', 'new']);
    expect(applyFrozenOrder(live, null)).toBe(live);
  });
});

describe('recents', () => {
  const place = (id: string): RecentEntry => ({ kind: 'place', id });

  it('moves a repeat to the front and stays bounded', () => {
    let recents: RecentEntry[] = [];
    for (let index = 0; index < 12; index += 1) recents = pushRecent(recents, place(`p${index}`));
    expect(recents).toHaveLength(8);
    expect(recents[0]).toEqual(place('p11'));
    recents = pushRecent(recents, place('p8'));
    expect(recents[0]).toEqual(place('p8'));
    expect(recents).toHaveLength(8);
  });

  it('treats an issue and a pull request with one number as different', () => {
    const issue: RecentEntry = { kind: 'item', item: item({ kind: 'issue' }) };
    const pull: RecentEntry = { kind: 'item', item: item({ kind: 'pull' }) };
    expect(pushRecent([issue], pull)).toHaveLength(2);
    expect(pushRecent([issue], issue)).toHaveLength(1);
  });
});
