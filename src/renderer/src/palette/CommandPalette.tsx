import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react';
import { Dialog, DialogBackdrop, DialogContent, DialogTitle } from '@ui-sdk/react/dialog';
import type { InboxItem } from '../../../shared/inbox';
import { SEARCH_TEXT_MAX, type RepoRef } from '../../../shared/search';
import { shortcutLabel, type Command, type IconName } from '../commands/commands';
import { hovercardProps } from '../hovercard/hovercard-model';
import { Icon } from '../icons';
import {
  BODY_ONLY_SCORE,
  applyFrozenOrder,
  paletteMode,
  paletteQuery,
  rankRows,
  scoreItem,
  scoreTitled,
  type RecentEntry
} from './palette-model';
import { usePaletteSearch } from './use-palette-search';

/** A row chosen this soon after the list changed under the highlight runs what was highlighted before. */
const RERANK_GUARD_MS = 150;
const MORE_ROW_ID = 'more';

export interface PalettePlace {
  id: string;
  title: string;
  subtitle?: string;
  icon: IconName;
  /** What kind of place this is, shown at the end of the row. */
  tag: string;
  /** Listed before anything is typed. */
  main?: boolean;
}

export interface CommandPaletteProps<Place extends PalettePlace = PalettePlace> {
  text: string;
  onTextChange(text: string): void;
  signedIn: boolean;
  mac: boolean;
  commands: readonly Command[];
  places: readonly Place[];
  recents: readonly RecentEntry[];
  repos: RepoRef[];
  /** The item open now, marked in the results. */
  selected: { repoFullName: string; number: number } | null;
  onRunCommand(command: Command): void;
  onChoose(command: Command, choiceId: string): void;
  onOpenPlace(place: Place): void;
  onOpenItem(item: InboxItem): void;
  onClose(): void;
}

interface Row {
  id: string;
  title: string;
  subtitle?: string;
  icon?: IconName;
  tag?: string;
  shortcut?: string;
  section?: string;
  score: number;
  item?: InboxItem;
  run(): void;
}

function itemRowId(item: InboxItem): string {
  return `item:${item.repoFullName}#${item.number}:${item.kind}`;
}

function kindLabel(item: InboxItem): string {
  return item.kind === 'pull' ? 'Pull request' : 'Issue';
}

/**
 * The palette over the window. Plain text goes to places, issues, and pull requests; text starting with `>` runs
 * commands. Focus stays in the input while the arrow keys move a highlight through the list.
 */
export function CommandPalette<Place extends PalettePlace = PalettePlace>({
  text,
  onTextChange,
  signedIn,
  mac,
  commands,
  places,
  recents,
  repos,
  selected,
  onRunCommand,
  onChoose,
  onOpenPlace,
  onOpenItem,
  onClose
}: CommandPaletteProps<Place>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [step, setStep] = useState<Command | null>(null);
  const [stepQuery, setStepQuery] = useState('');

  // A shortcut can change the text from outside, which leaves any step that was open.
  useEffect(() => setStep(null), [text]);

  const mode = signedIn ? paletteMode(text) : 'commands';
  const query = paletteQuery(text);
  const searching = signedIn && mode === 'goto' && !step;
  const search = usePaletteSearch(searching ? query : '', repos, searching);
  const listKey = step ? `step:${step.id}:${stepQuery}` : text;

  const liveRows = useMemo<Row[]>(() => {
    const commandRow = (command: Command, score: number, section?: string): Row => ({
      id: command.id,
      title: command.title,
      icon: command.icon,
      shortcut: shortcutLabel(command, mac),
      section,
      score,
      run: () => {
        if (command.choose) {
          setStepQuery('');
          setStep(command);
        } else onRunCommand(command);
      }
    });
    const placeRow = (place: Place, score: number, section?: string): Row => ({
      id: place.id,
      title: place.title,
      subtitle: place.subtitle,
      icon: place.icon,
      tag: place.tag,
      section,
      score,
      run: () => onOpenPlace(place)
    });
    const itemRow = (item: InboxItem, score: number, section?: string): Row => ({
      id: itemRowId(item),
      title: item.title,
      subtitle: `${item.repoFullName} · @${item.authorLogin}`,
      tag: kindLabel(item),
      section,
      score,
      item,
      run: () => onOpenItem(item)
    });

    if (step?.choose) {
      const { choose } = step;
      return rankRows(
        choose.options.map((option) => ({
          id: option.id,
          title: option.title,
          subtitle: option.subtitle,
          icon: 'repos' as const,
          score: stepQuery ? scoreTitled(stepQuery, option.title, option.subtitle) : 1,
          run: () => onChoose(step, option.id)
        }))
      );
    }

    if (mode === 'commands') {
      const runnable = commands.filter((command) => command.available && command.inPalette !== false);
      if (query) {
        return rankRows(
          runnable.map((command) => commandRow(command, scoreTitled(query, command.title, command.category)))
        );
      }
      const recentIds = recents.flatMap((entry) => (entry.kind === 'command' ? [entry.id] : []));
      const recent = recentIds.flatMap((id) => {
        const command = runnable.find((candidate) => candidate.id === id);
        return command ? [commandRow(command, 1, 'Recent')] : [];
      });
      const rest = runnable
        .filter((command) => !recentIds.includes(command.id))
        .map((command) => commandRow(command, 1, command.category));
      return [...recent, ...rest];
    }

    if (query) {
      const placeRows = places.map((place) =>
        placeRow(place, scoreTitled(query, place.title, place.subtitle))
      );
      const itemRows = search.items.flatMap((item) => {
        const score = scoreItem(item, search);
        // Older results stay only while they still visibly match what is typed now.
        return search.stale && score <= BODY_ONLY_SCORE ? [] : [itemRow(item, score)];
      });
      return rankRows([...placeRows, ...itemRows]);
    }

    const recentPlaceIds = new Set(recents.flatMap((entry) => (entry.kind === 'place' ? [entry.id] : [])));
    const recent = recents.flatMap((entry) => {
      if (entry.kind === 'item') return [itemRow(entry.item, 1, 'Recent')];
      if (entry.kind !== 'place') return [];
      const place = places.find((candidate) => candidate.id === entry.id);
      return place ? [placeRow(place, 1, 'Recent')] : [];
    });
    const main = places
      .filter((place) => place.main && !recentPlaceIds.has(place.id))
      .map((place) => placeRow(place, 1, 'Places'));
    return [...recent, ...main];
  }, [
    step,
    stepQuery,
    mode,
    query,
    commands,
    places,
    recents,
    mac,
    search.items,
    search.stale,
    search.terms,
    search.number,
    onRunCommand,
    onChoose,
    onOpenPlace,
    onOpenItem
  ]);

  // Both are tied to the text they were set under, so typing clears them without an effect.
  const [frozen, setFrozen] = useState<{ key: string; ids: string[] } | null>(null);
  const [picked, setPicked] = useState<{ key: string; id: string } | null>(null);

  const ordered = applyFrozenOrder(liveRows, frozen?.key === listKey ? frozen.ids : null);
  const rows: Row[] =
    searching && search.hasNextPage
      ? [
          ...ordered,
          {
            id: MORE_ROW_ID,
            title: search.loading ? 'Loading more results…' : 'Show more results',
            icon: 'chevronDown',
            score: 1,
            run: () => {
              if (!search.loading) search.loadMore();
            }
          }
        ]
      : ordered;

  const pickedId = picked?.key === listKey ? picked.id : null;
  const activeId = rows.some((row) => row.id === pickedId) ? pickedId : (rows[0]?.id ?? null);
  const activeIndex = rows.findIndex((row) => row.id === activeId);
  const rowDomId = (index: number): string => `${listId}-row-${index}`;

  // What the highlight sat on before the list last moved it, for the guard on Enter.
  const highlight = useRef<{ id: string | null; previous: string | null; key: string; at: number }>({
    id: null,
    previous: null,
    key: listKey,
    at: 0
  });
  useLayoutEffect(() => {
    const last = highlight.current;
    if (last.id === activeId && last.key === listKey) return;
    highlight.current = {
      id: activeId,
      previous: last.key === listKey ? last.id : null,
      key: listKey,
      at: Date.now()
    };
  }, [activeId, listKey]);

  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(rowDomId(activeIndex))?.scrollIntoView?.({ block: 'nearest' });
    // The element id follows the index, and the prefix never changes.
  }, [activeIndex]);

  const move = (delta: number): void => {
    if (rows.length === 0) return;
    const next = rows[(activeIndex + delta + rows.length) % rows.length];
    if (!next) return;
    if (frozen?.key !== listKey) {
      setFrozen({ key: listKey, ids: ordered.map((row) => row.id) });
    }
    // Chosen by the user, so the guard on Enter has nothing to protect.
    highlight.current = { id: next.id, previous: null, key: listKey, at: Date.now() };
    setPicked({ key: listKey, id: next.id });
  };

  const moveRef = useRef(move);
  moveRef.current = move;

  // Ctrl+N and Ctrl+P move the highlight wherever focus is in the dialog.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
      if (key !== 'n' && key !== 'p') return;
      event.preventDefault();
      event.stopPropagation();
      moveRef.current(key === 'n' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const runActive = (): void => {
    const { previous, at, key } = highlight.current;
    const justMoved = previous !== null && key === listKey && Date.now() - at < RERANK_GUARD_MS;
    const seen = justMoved ? rows.find((row) => row.id === previous) : undefined;
    (seen ?? rows[activeIndex])?.run();
  };

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runActive();
    } else if (event.key === 'Backspace' && step && stepQuery === '') {
      event.preventDefault();
      setStep(null);
    }
  };

  const placeholder =
    step?.choose?.placeholder ??
    (mode === 'commands' ? 'Type a command' : 'Go to a place, or search issues and pull requests');
  const enterLabel = step ? 'Choose' : mode === 'commands' ? 'Run' : 'Open';
  const emptyMessage =
    step !== null
      ? 'Nothing matches.'
      : mode === 'commands'
        ? 'No matching commands.'
        : search.totalCount === 0 || !search.hasQuery
          ? `No matches for “${query}”.`
          : null;

  let section: string | undefined;
  const listChildren: ReactNode[] = [];
  rows.forEach((row, index) => {
    if (row.section && row.section !== section) {
      section = row.section;
      listChildren.push(
        <div key={`section:${row.section}`} className="palette-section" role="presentation">
          {row.section}
        </div>
      );
    }
    const { item } = row;
    const isOpen = item && selected?.repoFullName === item.repoFullName && selected.number === item.number;
    listChildren.push(
      <div
        key={row.id}
        {...(item ? hovercardProps(item.repoFullName, item.number, item.kind) : {})}
        id={rowDomId(index)}
        role="option"
        aria-selected={row.id === activeId}
        data-row-id={row.id}
        className={`palette-row${row.id === activeId ? ' active' : ''}${isOpen ? ' current' : ''}`}
        // Keeps focus in the input, so the keyboard still works after a press that does not choose anything.
        onMouseDown={(event) => event.preventDefault()}
        onClick={row.run}
      >
        {item ? (
          <span className={`issue-state ${item.state}`} aria-hidden="true">
            <Icon name={item.kind === 'pull' ? 'pull' : 'issue'} size={15} />
          </span>
        ) : (
          <span className="palette-row-icon" aria-hidden="true">
            {row.icon && <Icon name={row.icon} size={15} />}
          </span>
        )}
        <span className="palette-row-copy">
          <span className="palette-row-title">
            {row.title}
            {item && <span className="issue-number"> #{item.number}</span>}
            {item?.isDraft && <small> Draft pull request</small>}
          </span>
          {row.subtitle && <span className="palette-row-subtitle">{row.subtitle}</span>}
        </span>
        {row.tag && <span className="palette-row-tag">{row.tag}</span>}
        {row.shortcut && <kbd className="palette-row-key">{row.shortcut}</kbd>}
      </div>
    );
  });

  return (
    <Dialog defaultOpen modal onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogBackdrop className="search-palette-backdrop" />
      <DialogContent
        container={document.body}
        className="search-palette"
        initialFocus={() => inputRef.current}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="search-palette-head">
          <Icon name={mode === 'commands' || step ? 'chevronRight' : 'search'} size={16} />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            className="search-palette-input"
            aria-label={placeholder}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? rowDomId(activeIndex) : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            // One more than a search allows, for the > that starts a command.
            maxLength={SEARCH_TEXT_MAX + 1}
            value={step ? stepQuery : text}
            onChange={(event) => (step ? setStepQuery(event.target.value) : onTextChange(event.target.value))}
            onKeyDown={onInputKey}
          />
        </div>
        {search.filters.length > 0 && (
          <ul className="search-chips palette-chips" aria-label="Active filters">
            {search.filters.map((filter) => (
              <li key={`${filter.key}:${filter.value}`} className="search-chip">
                <span>{filter.label}</span>
                <button
                  type="button"
                  className="search-chip-remove"
                  aria-label={`Remove ${filter.label}`}
                  onClick={() => onTextChange(search.withoutFilter(filter))}
                >
                  <Icon name="close" size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="search-palette-body">
          <div id={listId} role="listbox" aria-label="Results" className="palette-list">
            {listChildren}
          </div>
          {searching && search.error && (
            <div role="alert" className="search-error palette-message">
              <p>{search.error}</p>
              <button type="button" className="secondary-action" onClick={search.retry}>
                Try again
              </button>
            </div>
          )}
          {rows.length === 0 && !search.loading && !search.error && (query || step) && emptyMessage && (
            <p className="empty-state palette-message">{emptyMessage}</p>
          )}
          {/* No count at zero: places may still be listed, and an empty list says so itself. */}
          {searching && search.hasQuery && (search.totalCount ? true : search.partial || search.loading) && (
            <p className="search-count" role="status">
              {search.totalCount === null
                ? 'Searching…'
                : `${search.totalCount.toLocaleString()} ${search.totalCount === 1 ? 'match' : 'matches'}`}
              {search.partial && ' · this list may be incomplete'}
            </p>
          )}
        </div>
        <footer className="search-palette-foot" aria-hidden="true">
          <span>
            <kbd>
              <Icon name="arrowUp" size={12} />
            </kbd>
            <kbd>
              <Icon name="arrowDown" size={12} />
            </kbd>
            Navigate
          </span>
          <span>
            <kbd>Enter</kbd> {enterLabel}
          </span>
          <span>
            <kbd>Esc</kbd> Close
          </span>
          {signedIn && mode === 'goto' && (
            <span className="palette-foot-end">
              <kbd>&gt;</kbd> Commands
            </span>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
