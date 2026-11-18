import { useRef, type KeyboardEvent } from 'react';
import { Dialog, DialogBackdrop, DialogContent, DialogTitle } from '@ui-sdk/react/dialog';
import type { InboxItem } from '../../../shared/inbox';
import { SEARCH_TEXT_MAX, type RepoRef } from '../../../shared/search';
import { Icon } from '../icons';
import { SearchView, type SearchSelection } from './SearchView';
import { moveRowFocus } from '../shell/row-keys';

export interface SearchPaletteProps {
  /** The search text. Filter words in it set the chips and controls, as in the search view. */
  text: string;
  onTextChange(text: string): void;
  repos: RepoRef[];
  selected: SearchSelection | null;
  onOpenItem(item: InboxItem): void;
  /** Escape, a click outside the dialog, or choosing a result. Clears the search. */
  onClose(): void;
}

/**
 * Search in a dialog over the window, opened with Ctrl+K (Cmd+K on macOS). The input takes focus as the dialog
 * opens; Escape or a press outside closes it, and focus goes back to whatever had it before.
 */
export function SearchPalette({
  text,
  onTextChange,
  repos,
  selected,
  onOpenItem,
  onClose
}: SearchPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  /** The result rows, in order. Arrow keys move between them; Enter in the search box opens the first one. */
  const rows = (): HTMLButtonElement[] =>
    bodyRef.current ? [...bodyRef.current.querySelectorAll<HTMLButtonElement>('.issue-row')] : [];

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' && rows().length > 0) {
      event.preventDefault();
      rows()[0]?.focus();
    } else if (event.key === 'Enter' && rows().length > 0) {
      event.preventDefault();
      rows()[0]?.click();
    }
  };

  const onBodyKey = (event: KeyboardEvent<HTMLDivElement>): void =>
    moveRowFocus(event, bodyRef.current, inputRef.current);

  return (
    <Dialog defaultOpen modal onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogBackdrop className="search-palette-backdrop" />
      <DialogContent
        container={document.body}
        className="search-palette"
        initialFocus={() => inputRef.current}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="search-palette-head">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            type="search"
            className="search-palette-input"
            aria-label="Search issues and pull requests"
            placeholder="Search issues and pull requests"
            maxLength={SEARCH_TEXT_MAX}
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            onKeyDown={onInputKey}
          />
        </div>
        <div className="search-palette-body" ref={bodyRef} onKeyDown={onBodyKey}>
          <SearchView
            text={text}
            onTextChange={onTextChange}
            repos={repos}
            selected={selected}
            onOpenItem={(item) => {
              onOpenItem(item);
              onClose();
            }}
            onClose={onClose}
            showClose={false}
          />
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
            <kbd>Enter</kbd> Open
          </span>
          <span>
            <kbd>Esc</kbd> Close
          </span>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
