// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '../../../src/renderer/src/commands/commands';
import {
  CommandPalette,
  type CommandPaletteProps,
  type PalettePlace
} from '../../../src/renderer/src/palette/CommandPalette';
import type { RecentEntry } from '../../../src/renderer/src/palette/palette-model';
import type { InboxItem } from '../../../src/shared/inbox';
import type { SearchPage, SearchRequest } from '../../../src/shared/search';

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

function page(items: InboxItem[], overrides: Partial<SearchPage> = {}): SearchPage {
  return { items, totalCount: items.length, page: 1, hasNextPage: false, partial: false, ...overrides };
}

function installSearch(query: (request: SearchRequest) => Promise<SearchPage>) {
  const search = { query: vi.fn(query) };
  Object.defineProperty(window, 'orbit', { configurable: true, value: { search } });
  return search;
}

const places: PalettePlace[] = [
  { id: 'view:inbox', title: 'Inbox', icon: 'inbox', tag: 'View', main: true },
  { id: 'view:projects', title: 'Projects', icon: 'projects', tag: 'View', main: true },
  { id: 'repo:me/atlas', title: 'atlas', subtitle: 'me/atlas', icon: 'repos', tag: 'Repository' }
];

const commands: Command[] = [
  {
    id: 'zoom',
    title: 'Zoom in',
    category: 'View',
    icon: 'plus',
    available: true,
    shortcuts: [{ key: '=', mod: true }]
  },
  { id: 'hidden', title: 'Zoom secret', category: 'View', icon: 'plus', available: false },
  { id: 'menu-only', title: 'Zoom paste', category: 'Edit', icon: 'plus', available: true, inPalette: false },
  {
    id: 'new',
    title: 'New issue',
    category: 'Create',
    icon: 'issue',
    available: true,
    choose: {
      placeholder: 'Choose a repository',
      options: [
        { id: 'me/atlas', title: 'me/atlas' },
        { id: 'me/site', title: 'me/site' }
      ],
      run: vi.fn()
    }
  }
];

function Palette({
  initial = '',
  ...props
}: Partial<CommandPaletteProps> & {
  initial?: string;
}) {
  const [text, setText] = useState(initial);
  return (
    <>
      <output data-testid="text">{text}</output>
      <CommandPalette
        text={text}
        onTextChange={setText}
        signedIn
        mac={false}
        commands={commands}
        places={places}
        recents={[]}
        repos={[{ name: 'atlas', fullName: 'me/atlas' }]}
        selected={null}
        onRunCommand={vi.fn()}
        onChoose={vi.fn()}
        onOpenPlace={vi.fn()}
        onOpenItem={vi.fn()}
        onClose={vi.fn()}
        {...props}
      />
    </>
  );
}

const input = (): HTMLElement => screen.getByRole('combobox');
const options = (): string[] =>
  screen.queryAllByRole('option').map((option) => option.getAttribute('data-row-id') ?? '');
const type = (text: string): void => void fireEvent.change(input(), { target: { value: text } });
const press = (key: string): void => void fireEvent.keyDown(input(), { key });
const activeRow = (): string | null => {
  const id = input().getAttribute('aria-activedescendant');
  return id ? (document.getElementById(id)?.getAttribute('data-row-id') ?? null) : null;
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('go-to mode', () => {
  it('starts with recents and the main places, focused on the input', async () => {
    installSearch(async () => page([]));
    const recents: RecentEntry[] = [
      { kind: 'item', item: item() },
      { kind: 'place', id: 'repo:me/atlas' }
    ];
    render(<Palette recents={recents} />);
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    await waitFor(() => expect(input()).toHaveFocus());
    expect(options()).toEqual(['item:me/atlas#7:pull', 'repo:me/atlas', 'view:inbox', 'view:projects']);
    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(activeRow()).toBe('item:me/atlas#7:pull');
  });

  it('shows matching places at once and merges search results by best match', async () => {
    const api = installSearch(async () =>
      page([item({ title: 'Mentions nothing visible', number: 1 }), item({ title: 'atlas', number: 2 })])
    );
    render(<Palette initial="atlas" />);
    expect(options()).toEqual(['repo:me/atlas']);
    await waitFor(() => expect(options()).toHaveLength(3));
    expect(options()).toEqual(['repo:me/atlas', 'item:me/atlas#2:pull', 'item:me/atlas#1:pull']);
    expect(api.query).toHaveBeenCalledWith(
      expect.objectContaining({ terms: 'atlas', state: 'open', page: 1 })
    );
  });

  it('keeps places matchable when a word doubles as a filter, and shows the filter as a chip', async () => {
    const api = installSearch(async () => page([]));
    const custom: PalettePlace[] = [{ id: 'open', title: 'Open source', icon: 'repos', tag: 'Project' }];
    render(<Palette initial="open" places={custom} />);
    expect(options()).toEqual(['open']);
    fireEvent.change(input(), { target: { value: 'closed' } });
    await waitFor(() => expect(api.query).toHaveBeenCalledWith(expect.objectContaining({ state: 'closed' })));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Closed' }));
    expect(screen.getByTestId('text')).toHaveTextContent(/^$/);
  });

  it('labels a partial list and offers more results as a row', async () => {
    const api = installSearch(async (request) =>
      request.page === 1
        ? page([item({ title: 'one', number: 1 })], { hasNextPage: true, partial: true, totalCount: 2 })
        : page([item({ title: 'one two', number: 2 })], { page: 2, totalCount: 2 })
    );
    render(<Palette initial="one" />);
    await screen.findByText(/may be incomplete/);
    expect(options()).toEqual(['item:me/atlas#1:pull', 'more']);
    press('ArrowDown');
    press('Enter');
    await waitFor(() => expect(api.query).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
    await waitFor(() => expect(options()).toContain('item:me/atlas#2:pull'));
  });

  it('explains a failed search and retries', async () => {
    let fail = true;
    const api = installSearch(async () => {
      if (fail) throw new Error('GitHub rate limit exceeded');
      return page([item({ title: 'zzz' })]);
    });
    render(<Palette initial="zzz" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/rate limit reached/);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(options()).toEqual(['item:me/atlas#7:pull']));
    expect(api.query).toHaveBeenCalledTimes(2);
  });

  it('opens the chosen rows', async () => {
    installSearch(async () => page([item({ title: 'atlas' })]));
    const onOpenPlace = vi.fn();
    const onOpenItem = vi.fn();
    render(<Palette initial="atlas" onOpenPlace={onOpenPlace} onOpenItem={onOpenItem} />);
    press('Enter');
    expect(onOpenPlace).toHaveBeenCalledWith(places[2]);
    const row = await screen.findByRole('option', { name: /atlas #7/ });
    fireEvent.click(row);
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ number: 7 }));
  });
});

describe('re-ranking and Enter', () => {
  function pending() {
    let resolve: (value: SearchPage) => void = () => undefined;
    installSearch(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    return (value: SearchPage) => act(async () => resolve(value));
  }
  const better = page([item({ title: 'at', number: 9 })]);
  const custom: PalettePlace[] = [{ id: 'place', title: 'Great at things', icon: 'repos', tag: 'Project' }];

  it('lets a better result take the top while the user is only typing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const finish = pending();
    render(<Palette initial="at" places={custom} />);
    act(() => void vi.advanceTimersByTime(300));
    expect(activeRow()).toBe('place');
    await finish(better);
    expect(options()[0]).toBe('item:me/atlas#9:pull');
    expect(activeRow()).toBe('item:me/atlas#9:pull');
  });

  it('runs the row the user saw when results land just before Enter', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const finish = pending();
    const onOpenPlace = vi.fn();
    const onOpenItem = vi.fn();
    render(<Palette initial="at" places={custom} onOpenPlace={onOpenPlace} onOpenItem={onOpenItem} />);
    act(() => void vi.advanceTimersByTime(300));
    await finish(better);
    act(() => void vi.advanceTimersByTime(100));
    press('Enter');
    expect(onOpenPlace).toHaveBeenCalledWith(custom[0]);
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it('runs the new top row once it has been on screen long enough', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const finish = pending();
    const onOpenItem = vi.fn();
    render(<Palette initial="at" places={custom} onOpenItem={onOpenItem} />);
    act(() => void vi.advanceTimersByTime(300));
    await finish(better);
    act(() => void vi.advanceTimersByTime(151));
    press('Enter');
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ number: 9 }));
  });

  it('freezes the order after an arrow key and appends late results', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const finish = pending();
    const two: PalettePlace[] = [
      ...custom,
      { id: 'second', title: 'Also at home', icon: 'repos', tag: 'Project' }
    ];
    render(<Palette initial="at" places={two} />);
    act(() => void vi.advanceTimersByTime(300));
    press('ArrowDown');
    expect(activeRow()).toBe('second');
    await finish(better);
    expect(options()).toEqual(['place', 'second', 'item:me/atlas#9:pull']);
    expect(activeRow()).toBe('second');
    press('ArrowUp');
    press('ArrowUp');
    expect(activeRow()).toBe('item:me/atlas#9:pull');
  });
});

describe('command mode', () => {
  it('lists only commands that can run, with their shortcuts', () => {
    installSearch(async () => page([]));
    const api = window.orbit.search.query;
    render(<Palette initial=">zoom" />);
    expect(options()).toEqual(['zoom']);
    expect(within(screen.getByRole('option')).getByText('Ctrl+=')).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });

  it('runs the highlighted command', () => {
    installSearch(async () => page([]));
    const onRunCommand = vi.fn();
    render(<Palette initial=">zoom" onRunCommand={onRunCommand} />);
    press('Enter');
    expect(onRunCommand).toHaveBeenCalledWith(commands[0]);
  });

  it('asks for a choice in place, and Backspace on the empty step goes back', () => {
    installSearch(async () => page([]));
    const onChoose = vi.fn();
    render(<Palette initial=">new" onChoose={onChoose} />);
    press('Enter');
    expect(input()).toHaveAttribute('placeholder', 'Choose a repository');
    expect(input()).toHaveValue('');
    expect(options()).toEqual(['me/atlas', 'me/site']);
    press('Backspace');
    expect(input()).toHaveValue('>new');
    press('Enter');
    type('site');
    press('Enter');
    expect(onChoose).toHaveBeenCalledWith(commands[3], 'me/site');
  });

  it('treats everything as commands while signed out', () => {
    installSearch(async () => page([]));
    render(<Palette initial="zoom" signedIn={false} />);
    expect(options()).toEqual(['zoom']);
    expect(window.orbit.search.query).not.toHaveBeenCalled();
  });
});

describe('dialog behaviour', () => {
  it('closes on Escape', async () => {
    installSearch(async () => page([]));
    const onClose = vi.fn();
    render(<Palette onClose={onClose} />);
    await waitFor(() => expect(input()).toHaveFocus());
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves with Ctrl+N and Ctrl+P, wrapping at the ends, and keeps the keys from the webview', () => {
    installSearch(async () => page([]));
    render(<Palette />);
    expect(activeRow()).toBe('view:inbox');
    expect(fireEvent.keyDown(input(), { key: 'n', ctrlKey: true })).toBe(false);
    expect(activeRow()).toBe('view:projects');
    fireEvent.keyDown(input(), { key: 'n', ctrlKey: true });
    expect(activeRow()).toBe('view:inbox');
    expect(fireEvent.keyDown(input(), { key: 'p', ctrlKey: true })).toBe(false);
    expect(activeRow()).toBe('view:projects');
  });

  it('leaves Ctrl+Shift+P to the palette shortcut', () => {
    installSearch(async () => page([]));
    render(<Palette />);
    fireEvent.keyDown(input(), { key: 'P', ctrlKey: true, shiftKey: true });
    expect(activeRow()).toBe('view:inbox');
  });

  it('is a combobox tied to its list', () => {
    installSearch(async () => page([]));
    render(<Palette />);
    expect(input()).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    press('ArrowUp');
    expect(activeRow()).toBe('view:projects');
    expect(screen.getByRole('option', { selected: true })).toHaveAttribute('data-row-id', 'view:projects');
  });
});
