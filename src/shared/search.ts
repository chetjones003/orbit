/**
 * Cross-repo search shapes shared by main, preload, and renderer. No Node or DOM APIs.
 * Search covers the signed-in account's personal repos, the same scope as the inbox.
 *
 * The owner types plain words. Words such as "open", "pull requests", "in app", "label bug" and "@name" are read
 * as filters, and the renderer sends the result as structured fields, so GitHub never receives raw search syntax.
 */

import type { InboxItem } from './inbox';

export const SEARCH_KINDS = ['all', 'issue', 'pull'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const SEARCH_STATES = ['open', 'closed', 'all'] as const;
export type SearchState = (typeof SEARCH_STATES)[number];

/** Longest search text Orbit accepts. */
export const SEARCH_TEXT_MAX = 256;
/** Most labels one search may require. */
export const SEARCH_LABELS_MAX = 5;

/** The filters chosen with the controls. Words in the text can override them. */
export interface SearchChips {
  kind: SearchKind;
  state: SearchState;
  repoFullName: string | null;
}

/** What main searches for. `terms` is the plain words left after the filters are read. */
export interface SearchRequest {
  terms: string;
  kind: SearchKind;
  state: SearchState;
  repoFullName: string | null;
  labels: string[];
  author: string | null;
  /**
   * A number the text names, such as 1236 or #1236. Main looks that issue or pull request up directly and lists it
   * first. The number stays in `terms` too, so text that mentions it still matches.
   */
  number: number | null;
  /** 1-based page number. */
  page: number;
}

export interface SearchPage {
  items: InboxItem[];
  /** Matches GitHub reports, capped at the search limit when `partial` is true. */
  totalCount: number;
  page: number;
  hasNextPage: boolean;
  /**
   * True when some matches are not shown: GitHub capped the results, search was incomplete, or
   * an item could not be read. The page is never presented as the full list when this is set.
   */
  partial: boolean;
}

/** A repo the owner can name in the text, such as "in app" or "in owner/app". */
export interface RepoRef {
  name: string;
  fullName: string;
}

export type SearchFilterKey = 'kind' | 'state' | 'repo' | 'label' | 'author';

/** A filter the owner can see as a chip and remove. `value` tells apart several labels. */
export interface ActiveFilter {
  key: SearchFilterKey;
  value: string;
  label: string;
}

export interface ParsedSearch {
  /** Plain words to match in titles and bodies. */
  terms: string;
  /** Each is null when the text does not set it, or when it sets two different values. */
  kind: Exclude<SearchKind, 'all'> | null;
  state: Exclude<SearchState, 'all'> | null;
  repoFullName: string | null;
  labels: string[];
  author: string | null;
  /** The first number in the text, read as an issue or pull request number. Still part of `terms`. */
  number: number | null;
}

interface Found {
  key: SearchFilterKey;
  value: string;
  /** The text as typed, kept so a filter can be removed and the rest of the text left as it was. */
  raw: string;
}

interface Pass {
  pattern: RegExp;
  /** Returns the filter the match means, or null to leave the text alone. */
  read(captures: string[]): Omit<Found, 'raw'> | null;
}

/**
 * Brackets a marker in the text while the filters are read. It is a private-use character, which is never typed,
 * so it cannot collide with a word.
 */
const MARK = '';
const MARKED = /\d+/g;

/** Words that carry no meaning in a search. Dropped unless nothing else is left. */
const STOPWORDS = new Set([
  'a',
  'about',
  'all',
  'am',
  'an',
  'and',
  'are',
  'at',
  'be',
  'by',
  'find',
  'for',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'show',
  'the',
  'to',
  'with'
]);

const END = '(?=[\\s.,!?;]|$)';

function unquote(value: string): string {
  return value
    .replace(/"/g, '')
    .replace(/[.,!?;]+$/, '')
    .trim();
}

function kindOf(word: string): Exclude<SearchKind, 'all'> | null {
  const value = word.toLowerCase();
  if (/^(pr|prs|pull|pulls|pull requests?)$/.test(value)) return 'pull';
  if (/^issues?$/.test(value)) return 'issue';
  return null;
}

function repoNamed(value: string, repos: RepoRef[]): string | null {
  const wanted = value.toLowerCase();
  return (
    repos.find((repo) => repo.fullName.toLowerCase() === wanted || repo.name.toLowerCase() === wanted)
      ?.fullName ?? null
  );
}

/** The passes, in the order they run. Each reads one kind of phrase out of the text. */
function passes(repos: RepoRef[]): Pass[] {
  return [
    {
      // The coded form still works for anyone who already uses it: is:pr, repo:app, label:"x", author:name.
      pattern: /(?:^|\s)(is|repo|label|author):("[^"]*"|\S+)/gi,
      read: ([name = '', rawValue = '']) => {
        const key = name.toLowerCase();
        const value = unquote(rawValue);
        if (!value) return null;
        if (key === 'is') {
          const kind = kindOf(value);
          if (kind) return { key: 'kind', value: kind };
          const word = value.toLowerCase();
          if (word === 'open' || word === 'closed') return { key: 'state', value: word };
          return null;
        }
        if (key === 'repo') {
          const fullName = repoNamed(value, repos);
          return fullName ? { key: 'repo', value: fullName } : null;
        }
        return key === 'label' ? { key: 'label', value } : { key: 'author', value };
      }
    },
    {
      // "label bug", "labeled good first issue" (quote a multi-word name to keep it whole).
      pattern: new RegExp(`(?:^|\\s)label(?:ed|s)?\\s+("[^"]+"|[^\\s"]+)`, 'gi'),
      read: ([rawValue = '']) => {
        const value = unquote(rawValue);
        return value ? { key: 'label', value } : null;
      }
    },
    {
      // "@name" for an author, as on GitHub.
      pattern: /(?:^|\s)@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))(?![A-Za-z0-9-])/g,
      read: ([login = '']) => ({ key: 'author', value: login })
    },
    {
      // "in app" or "in owner/app", only when it names one of the owner's repos.
      pattern: new RegExp(`(?:^|\\s)in\\s+([A-Za-z0-9._/-]+)${END}`, 'gi'),
      read: ([name = '']) => {
        const fullName = repoNamed(name, repos);
        return fullName ? { key: 'repo', value: fullName } : null;
      }
    },
    {
      // "issues", "pull requests", "PRs".
      pattern: new RegExp(`(?:^|\\s)(pull requests?|pulls|prs?|issues?)${END}`, 'gi'),
      read: ([word = '']) => {
        const kind = kindOf(word);
        return kind ? { key: 'kind', value: kind } : null;
      }
    },
    {
      pattern: new RegExp(`(?:^|\\s)(open|closed)${END}`, 'gi'),
      read: ([word = '']) => ({ key: 'state', value: word.toLowerCase() })
    }
  ];
}

/** Takes every filter phrase out of the text. Returns what is left and the filters found, in the order typed. */
function scan(text: string, repos: RepoRef[]): { rest: string; found: Found[]; skeleton: string } {
  const found: Found[] = [];
  let skeleton = text;
  for (const pass of passes(repos)) {
    skeleton = skeleton.replace(pass.pattern, (match: string, ...args: unknown[]) => {
      const captures = args.slice(0, -2).map((capture) => String(capture ?? ''));
      const read = pass.read(captures);
      if (!read) return match;
      found.push({ ...read, raw: match.trim() });
      // A marker keeps the phrase's place in the text, so taking it out later leaves the other words in order.
      return ` ${MARK}${found.length - 1}${MARK} `;
    });
  }
  const rest = skeleton.replace(MARKED, ' ').replace(/\s+/g, ' ').trim();
  return { rest, found, skeleton };
}

/** The value a key was set to, when every phrase for it agrees. Two different values mean the text is ambiguous. */
function agreed(found: Found[], key: SearchFilterKey): string | null {
  const values = [...new Set(found.filter((entry) => entry.key === key).map((entry) => entry.value))];
  return values.length === 1 ? (values[0] ?? null) : null;
}

function firstOf(found: Found[], key: SearchFilterKey): string | null {
  return found.find((entry) => entry.key === key)?.value ?? null;
}

function keywords(rest: string): string {
  const words = rest.split(' ').filter(Boolean);
  const meaningful = words.filter((word) => !STOPWORDS.has(word.toLowerCase()));
  return (meaningful.length > 0 ? meaningful : words).join(' ');
}

/** A bare number, optionally with a leading #, that is a plausible issue or pull request number. */
const NUMBER_WORD = /(?:^|\s)#?(\d{1,9})(?=[\s.,!?;]|$)/;

/** Reads the search text into plain words and the filters it names. */
export function parseSearchText(text: string, repos: RepoRef[] = []): ParsedSearch {
  const { rest, found } = scan(text, repos);
  const number = NUMBER_WORD.exec(rest);
  return {
    terms: keywords(rest),
    kind: agreed(found, 'kind') as ParsedSearch['kind'],
    state: agreed(found, 'state') as ParsedSearch['state'],
    repoFullName: firstOf(found, 'repo'),
    labels: [...new Set(found.filter((entry) => entry.key === 'label').map((entry) => entry.value))],
    author: firstOf(found, 'author'),
    number: number?.[1] ? Number(number[1]) : null
  };
}

/** The filters in effect: the text wins over the controls, the controls fill in what the text leaves out. */
export function resolveSearch(parsed: ParsedSearch, chips: SearchChips): Omit<SearchRequest, 'page'> {
  return {
    terms: parsed.terms,
    kind: parsed.kind ?? chips.kind,
    state: parsed.state ?? chips.state,
    repoFullName: parsed.repoFullName ?? chips.repoFullName,
    labels: parsed.labels,
    author: parsed.author,
    number: parsed.number
  };
}

/** The filters in effect, as chips the owner can see and remove. The default state (open) is not shown. */
export function activeFilters(resolved: Omit<SearchRequest, 'page'>): ActiveFilter[] {
  const filters: ActiveFilter[] = [];
  if (resolved.kind !== 'all') {
    filters.push({
      key: 'kind',
      value: resolved.kind,
      label: resolved.kind === 'pull' ? 'Pull requests' : 'Issues'
    });
  }
  if (resolved.state !== 'open') {
    filters.push({
      key: 'state',
      value: resolved.state,
      label: resolved.state === 'closed' ? 'Closed' : 'Open and closed'
    });
  }
  if (resolved.repoFullName) {
    filters.push({ key: 'repo', value: resolved.repoFullName, label: resolved.repoFullName });
  }
  for (const label of resolved.labels) filters.push({ key: 'label', value: label, label: `Label: ${label}` });
  if (resolved.author) filters.push({ key: 'author', value: resolved.author, label: `@${resolved.author}` });
  return filters;
}

/**
 * The text without one filter. Its phrases are taken out and the rest of the text is kept as typed. A kind, state
 * or repo filter removes every phrase of that kind; a label removes only the label it names.
 */
export function removeSearchFilter(text: string, filter: ActiveFilter, repos: RepoRef[] = []): string {
  const { found, skeleton } = scan(text, repos);
  const isRemoved = (entry: Found): boolean =>
    entry.key === filter.key && (filter.key !== 'label' || entry.value === filter.value);
  // Nothing to take out: the text stays exactly as typed, so the words keep their order.
  if (!found.some(isRemoved)) return text;
  return skeleton
    .replace(MARKED, (marker) => {
      const entry = found[Number(marker.slice(1, -1))];
      return entry && !isRemoved(entry) ? ` ${entry.raw} ` : ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** A plain-language line for the result summary. */
export function describeFilters(resolved: Omit<SearchRequest, 'page'>): string {
  return activeFilters(resolved)
    .map((filter) => filter.label)
    .join(' · ');
}
