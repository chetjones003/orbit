import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { InboxItem } from '../../../shared/inbox';
import { SEARCH_TEXT_MAX, type RepoRef } from '../../../shared/search';
import { Icon } from '../icons';
import { SearchView, type SearchSelection } from './SearchView';

export interface SearchPaletteProps {
  /** The search text. Filter words in it set the chips and controls, as in the search view. */
  text: string;
  onTextChange(text: string): void;
  repos: RepoRef[];
  selected: SearchSelection | null;
  onOpenItem(item: InboxItem): void;
  /** Escape, a click outside the dialog, Close search, or choosing a result. Clears the search. */
  onClose(): void;
}

/**
 * Search in a dialog over the window, opened with Ctrl+K (Cmd+K on macOS). The window behind is blurred.
 * The input is focused as the dialog opens, Escape or a click outside closes it, and focus goes back to
 * whatever had it before.
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
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      className="search-palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Search" className="search-palette">
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
          />
          <kbd className="search-palette-key">Esc</kbd>
        </div>
        <div className="search-palette-body">
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
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
