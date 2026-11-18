import type { InboxItem } from '../../../shared/inbox';

export type PaletteMode = 'goto' | 'commands';

export interface PaletteState {
  open: boolean;
  text: string;
}

/** Something chosen in the palette this session. Kept in memory only, and dropped when the session ends. */
export type RecentEntry =
  { kind: 'command'; id: string } | { kind: 'place'; id: string } | { kind: 'item'; item: InboxItem };

const RECENT_LIMIT = 8;
const COMMAND_PREFIX = '>';

/** A search result whose match is in text the row does not show, such as the body. It sorts last. */
export const BODY_ONLY_SCORE = 1;
const EXACT_NUMBER_SCORE = 1200;
const FILTER_ONLY_SCORE = 300;
const EXACT_SCORE = 1000;
const PREFIX_SCORE = 800;
const WORD_START_SCORE = 600;
const SUBSTRING_SCORE = 400;
const FUZZY_BASE_SCORE = 100;
/** Fuzzy letters may spread over this many characters per query letter. */
const FUZZY_SPREAD = 4;
/** A secondary field, such as the repository under a title, counts for this share of its score. */
const SECONDARY_WEIGHT = 0.5;

export function paletteMode(text: string): PaletteMode {
  return text.trimStart().startsWith(COMMAND_PREFIX) ? 'commands' : 'goto';
}

/** The text without the mode prefix. */
export function paletteQuery(text: string): string {
  const trimmed = text.trim();
  return paletteMode(trimmed) === 'commands' ? trimmed.slice(COMMAND_PREFIX.length).trim() : trimmed;
}

/** What a palette shortcut does: opens the palette, switches its mode, or closes it if that mode is showing. */
export function requestPalette(current: PaletteState, mode: PaletteMode): PaletteState {
  if (!current.open) return { open: true, text: mode === 'commands' ? COMMAND_PREFIX : '' };
  if (paletteMode(current.text) === mode) return { open: false, text: '' };
  const query = paletteQuery(current.text);
  return { open: true, text: mode === 'commands' ? `${COMMAND_PREFIX}${query}` : query };
}

function fuzzyScore(query: string, text: string): number {
  let from = 0;
  let first = -1;
  let last = -1;
  for (const letter of query) {
    const at = text.indexOf(letter, from);
    if (at === -1) return 0;
    if (first === -1) first = at;
    last = at;
    from = at + 1;
  }
  const span = last - first + 1;
  if (span > query.length * FUZZY_SPREAD) return 0;
  return FUZZY_BASE_SCORE + (FUZZY_BASE_SCORE * query.length) / span;
}

function scoreWord(query: string, text: string): number {
  if (text === query) return EXACT_SCORE;
  if (text.startsWith(query)) return PREFIX_SCORE;
  if (text.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(query))) return WORD_START_SCORE;
  if (text.includes(query)) return SUBSTRING_SCORE;
  return query.length > 1 ? fuzzyScore(query, text) : 0;
}

/** How well the query matches text the user can see. 0 means it does not match. */
export function scoreText(query: string, text: string): number {
  const wanted = query.trim().toLowerCase();
  const target = text.toLowerCase();
  if (wanted === '') return 0;
  const words = wanted.split(/\s+/);
  if (words.length === 1) return scoreWord(wanted, target);
  if (target === wanted) return EXACT_SCORE;
  if (target.startsWith(wanted)) return PREFIX_SCORE;
  if (target.includes(wanted)) return WORD_START_SCORE;
  const scores = words.map((word) => scoreWord(word, target));
  if (scores.includes(0)) return 0;
  return (0.9 * scores.reduce((sum, score) => sum + score, 0)) / scores.length;
}

/** The same score, for a title with a secondary line beneath it. */
export function scoreTitled(query: string, title: string, secondary = ''): number {
  return Math.max(scoreText(query, title), secondary ? SECONDARY_WEIGHT * scoreText(query, secondary) : 0);
}

/**
 * Scores a search result by what its row shows. The search already decided it matches, so it is never dropped here:
 * a match the row cannot explain simply sorts last.
 */
export function scoreItem(item: InboxItem, query: { terms: string; number: number | null }): number {
  if (query.number === item.number) return EXACT_NUMBER_SCORE;
  if (query.terms === '') return FILTER_ONLY_SCORE;
  const visible = Math.max(
    scoreTitled(query.terms, item.title, item.repoFullName),
    SECONDARY_WEIGHT * scoreText(query.terms, item.authorLogin)
  );
  return visible > 0 ? visible : BODY_ONLY_SCORE;
}

/** Best first, keeping the given order on ties. Rows that do not match are dropped. */
export function rankRows<T extends { score: number }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.score > 0).toSorted((a, b) => b.score - a.score);
}

/** Keeps rows where the user last saw them. Rows that arrived since go after them, best first. */
export function applyFrozenOrder<T extends { id: string }>(rows: T[], frozen: readonly string[] | null): T[] {
  if (!frozen) return rows;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const seen = new Set(frozen);
  return [
    ...frozen.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    }),
    ...rows.filter((row) => !seen.has(row.id))
  ];
}

function recentKey(entry: RecentEntry): string {
  return entry.kind === 'item'
    ? `item:${entry.item.repoFullName}#${entry.item.number}:${entry.item.kind}`
    : `${entry.kind}:${entry.id}`;
}

export function pushRecent(recents: readonly RecentEntry[], entry: RecentEntry): RecentEntry[] {
  const key = recentKey(entry);
  return [entry, ...recents.filter((other) => recentKey(other) !== key)].slice(0, RECENT_LIMIT);
}
