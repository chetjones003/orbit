// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchField } from '../../../src/renderer/src/search/SearchField';
import { SearchView } from '../../../src/renderer/src/search/SearchView';
import { ListResizeHandle } from '../../../src/renderer/src/shell/ListResizeHandle';
import {
  clampListWidth,
  readStoredListWidth,
  storeListWidth
} from '../../../src/renderer/src/shell/side-list-width';
import type { InboxItem } from '../../../src/shared/inbox';
import type { SearchPage, SearchRequest } from '../../../src/shared/search';

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    repoFullName: 'orbit-owner/atlas-cad',
    number: 7,
    kind: 'pull',
    title: 'Ship the search',
    state: 'open',
    isDraft: false,
    authorLogin: 'orbit-owner',
    labels: [],
    commentCount: 0,
    updatedAt: '2026-02-01T00:00:00Z',
    htmlUrl: 'https://github.com/orbit-owner/atlas-cad/pull/7',
    ...overrides
  };
}

function page(overrides: Partial<SearchPage> = {}): SearchPage {
  return { items: [item()], totalCount: 1, page: 1, hasNextPage: false, partial: false, ...overrides };
}

const repos = [
  { name: 'atlas-cad', fullName: 'orbit-owner/atlas-cad' },
  { name: 'site', fullName: 'orbit-owner/site' }
];

function installApi(query: (request: SearchRequest) => Promise<SearchPage>) {
  const searchApi = { query: vi.fn(query) };
  Object.defineProperty(window, 'orbit', { configurable: true, value: { search: searchApi } });
  return searchApi;
}

/** Holds the text the way App does, so the view's writes come back in. */
function Harness({ initial, onClose = vi.fn() }: { initial: string; onClose?: () => void }) {
  const [text, setText] = useState(initial);
  return (
    <>
      <p data-testid="text">{text}</p>
      <SearchView
        text={text}
        onTextChange={setText}
        repos={repos}
        selected={null}
        onOpenItem={vi.fn()}
        onClose={onClose}
      />
    </>
  );
}

const textNow = (): string => screen.getByTestId('text').textContent ?? '';
const lastRequest = (api: { query: ReturnType<typeof vi.fn> }): SearchRequest =>
  api.query.mock.lastCall?.[0] as SearchRequest;

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

describe('SearchView reads plain words', () => {
  it('searches the words with the default filters and shows the matches', async () => {
    const api = installApi(async () => page());
    render(<Harness initial="ship" />);

    expect(await screen.findByText('Ship the search')).toBeInTheDocument();
    expect(lastRequest(api)).toEqual({
      terms: 'ship',
      kind: 'all',
      state: 'open',
      repoFullName: null,
      labels: [],
      author: null,
      number: null,
      page: 1
    });
    expect(screen.getByText('1 match')).toBeInTheDocument();
  });

  it('turns filter words into chips and sets the controls to match, without any syntax', async () => {
    const api = installApi(async () => page());
    render(<Harness initial="open pull requests in atlas-cad" />);

    expect(await screen.findByText('Ship the search')).toBeInTheDocument();
    expect(lastRequest(api)).toMatchObject({
      terms: '',
      kind: 'pull',
      state: 'open',
      repoFullName: 'orbit-owner/atlas-cad'
    });
    const chips = screen.getByRole('list', { name: 'Active filters' });
    expect(chips).toHaveTextContent('Pull requests');
    expect(chips).toHaveTextContent('orbit-owner/atlas-cad');
    expect(screen.getByRole('button', { name: 'Pull requests' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Repository')).toHaveValue('orbit-owner/atlas-cad');
  });

  it('reads labels and authors from everyday words', async () => {
    const api = installApi(async () => page());
    render(<Harness initial="issues labeled bug @octo" />);
    await screen.findByText('Ship the search');
    expect(lastRequest(api)).toMatchObject({ terms: '', kind: 'issue', labels: ['bug'], author: 'octo' });
    expect(screen.getByRole('list', { name: 'Active filters' })).toHaveTextContent('Label: bug');
    expect(screen.getByRole('list', { name: 'Active filters' })).toHaveTextContent('@octo');
  });
});

describe('numbers', () => {
  it('asks main for the number, and says it is listed first', async () => {
    const api = installApi(async () => page());
    render(<Harness initial="1236" />);
    await screen.findByText('Ship the search');
    expect(lastRequest(api)).toMatchObject({ terms: '1236', number: 1236 });
    expect(screen.getByText(/#1236 is listed first/)).toBeInTheDocument();
  });
});

describe('controls and chips write back to the text', () => {
  it('a control takes its phrase out of the text, so the text cannot override the choice', async () => {
    const api = installApi(async () => page());
    render(<Harness initial="open pull requests crash" />);
    await screen.findByText('Ship the search');

    fireEvent.click(screen.getByRole('button', { name: 'Issues' }));
    expect(textNow()).not.toMatch(/pull requests/);
    await waitFor(() => expect(lastRequest(api)).toMatchObject({ kind: 'issue', terms: 'crash' }));
    expect(screen.getByRole('button', { name: 'Issues' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('removing a chip removes its words and returns the control to its default', async () => {
    const api = installApi(async () => page());
    render(<Harness initial="pull requests in atlas-cad" />);
    await screen.findByText('Ship the search');

    fireEvent.click(screen.getByRole('button', { name: 'Remove orbit-owner/atlas-cad' }));
    expect(textNow()).not.toMatch(/atlas-cad/);
    await waitFor(() => expect(lastRequest(api)).toMatchObject({ repoFullName: null, kind: 'pull' }));
  });

  it('shows the examples to start from, and an example fills in the text', async () => {
    const api = installApi(async () => page());
    render(<Harness initial="" />);

    expect(screen.getByText(/set filters for you/)).toBeInTheDocument();
    expect(api.query).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'closed issues' }));
    expect(textNow()).toBe('closed issues');
    await waitFor(() => expect(lastRequest(api)).toMatchObject({ kind: 'issue', state: 'closed' }));
  });

  it('a control can search with no words at all, once a filter is chosen', async () => {
    const api = installApi(async () => page());
    render(<Harness initial="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Closed' }));
    await waitFor(() => expect(lastRequest(api)).toMatchObject({ terms: '', state: 'closed' }));
  });

  it('offers to clear filters when nothing matches', async () => {
    installApi(async () => page({ items: [], totalCount: 0 }));
    render(<Harness initial="closed pull requests zzz" />);
    expect(await screen.findByText(/No matches for “zzz”/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(textNow()).toBe('zzz');
  });
});

describe('SearchView states', () => {
  it('shows a plain message when the search fails', async () => {
    installApi(async () => {
      throw new Error('GitHub rate limit exceeded');
    });
    render(<Harness initial="ship" />);
    expect(await screen.findByText(/rate limit reached/)).toBeInTheDocument();
  });

  it('says so when the list may be incomplete', async () => {
    installApi(async () => page({ partial: true, totalCount: 1000, hasNextPage: true }));
    render(<Harness initial="ship" />);
    expect(await screen.findByText(/this list may be incomplete/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });
});

describe('title bar search field', () => {
  it('opens the search when focused and closes on Escape', () => {
    const onFocus = vi.fn();
    const onClose = vi.fn();
    render(<SearchField value="" onChange={vi.fn()} onFocus={onFocus} onClose={onClose} />);
    const input = screen.getByRole('searchbox', { name: 'Search issues and pull requests' });
    fireEvent.focus(input);
    expect(onFocus).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
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
