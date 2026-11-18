import { useEffect, useMemo, useState } from 'react';
import type { InboxItem } from '../../../shared/inbox';
import {
  activeFilters,
  parseSearchText,
  removeSearchFilter,
  resolveSearch,
  type ActiveFilter,
  type RepoRef,
  type SearchChips,
  type SearchRequest
} from '../../../shared/search';

/** Typing settles for this long before a search runs. */
export const SEARCH_DELAY_MS = 250;

const DEFAULT_CHIPS: SearchChips = { kind: 'all', state: 'open', repoFullName: null };

interface SearchResult {
  key: string;
  /** Everything about the search except its words, to tell whether older results can stay on screen. */
  filtersKey: string;
  items: InboxItem[];
  totalCount: number;
  hasNextPage: boolean;
  partial: boolean;
}

export interface PaletteSearch {
  terms: string;
  number: number | null;
  filters: ActiveFilter[];
  hasQuery: boolean;
  items: InboxItem[];
  /** True while `items` belong to the previous words, shown until the new results arrive. */
  stale: boolean;
  totalCount: number | null;
  hasNextPage: boolean;
  partial: boolean;
  loading: boolean;
  error: string | null;
  loadMore(): void;
  retry(): void;
  /** The text with one filter's words taken out. */
  withoutFilter(filter: ActiveFilter): string;
}

function describeFailure(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : '';
  if (/rate limit/i.test(detail))
    return 'GitHub rate limit reached. Search works again after the limit resets.';
  if (/own repositories|GitHub account name|Search text|labels at a time/i.test(detail)) return detail;
  return 'Could not run this search.';
}

const itemKey = (item: InboxItem): string => `${item.repoFullName}#${item.number}:${item.kind}`;

/** Searches issues and pull requests for the palette. Filter words in the text are read as filters. */
export function usePaletteSearch(text: string, repos: RepoRef[], enabled: boolean): PaletteSearch {
  const resolved = useMemo(() => resolveSearch(parseSearchText(text, repos), DEFAULT_CHIPS), [text, repos]);
  const filters = activeFilters(resolved);
  const key = JSON.stringify(resolved);
  const filtersKey = JSON.stringify({ ...resolved, terms: '', number: null });
  const hasQuery = enabled && (resolved.terms !== '' || filters.length > 0);

  const [paging, setPaging] = useState({ key: '', page: 1 });
  const page = paging.key === key ? paging.page : 1;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setError(null);
    if (!hasQuery) {
      setResult(null);
      setLoading(false);
      return undefined;
    }
    const request: SearchRequest = { ...(JSON.parse(key) as Omit<SearchRequest, 'page'>), page };
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(
      () => {
        void window.orbit.search
          .query(request)
          .then(
            (value) => {
              if (cancelled) return;
              setResult((current) => {
                const earlier = page > 1 && current?.key === key ? current.items : [];
                const known = new Set(earlier.map(itemKey));
                return {
                  key,
                  filtersKey,
                  items: [...earlier, ...value.items.filter((item) => !known.has(itemKey(item)))],
                  totalCount: value.totalCount,
                  hasNextPage: value.hasNextPage,
                  partial: value.partial
                };
              });
            },
            (cause: unknown) => {
              if (!cancelled) setError(describeFailure(cause));
            }
          )
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      page > 1 ? 0 : SEARCH_DELAY_MS
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, filtersKey, page, attempt, hasQuery]);

  const current = hasQuery && result?.key === key ? result : null;
  const retained = hasQuery && !current && result?.filtersKey === filtersKey ? result : null;
  const shown = current ?? retained;

  return {
    terms: resolved.terms,
    number: resolved.number,
    filters: enabled ? filters : [],
    hasQuery,
    items: shown?.items ?? [],
    stale: current === null,
    totalCount: current?.totalCount ?? null,
    hasNextPage: current?.hasNextPage ?? false,
    partial: current?.partial ?? false,
    loading: hasQuery && loading,
    error: hasQuery ? error : null,
    loadMore: () => setPaging({ key, page: page + 1 }),
    retry: () => setAttempt((count) => count + 1),
    withoutFilter: (filter) => removeSearchFilter(text, filter, repos)
  };
}
