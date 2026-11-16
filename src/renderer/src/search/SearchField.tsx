import { useEffect, useRef } from 'react';
import { SEARCH_TEXT_MAX } from '../../../shared/search';
import { Icon } from '../icons';

export interface SearchFieldProps {
  value: string;
  onChange(next: string): void;
  /** Focusing the field opens the search view, so the examples and filters are there to use. */
  onFocus(): void;
  /** Escape closes the search and returns to the section that was open. */
  onClose(): void;
}

/**
 * The title bar search field. Focusing or typing opens the search view; Escape closes it.
 * Ctrl+K (Cmd+K on macOS) focuses the field from anywhere in the window.
 */
export function SearchField({ value, onChange, onFocus, onClose }: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'k' ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="titlebar-search" role="search">
      <Icon name="search" size={13} />
      <input
        ref={inputRef}
        type="search"
        className="titlebar-search-input"
        aria-label="Search issues and pull requests"
        placeholder="Search issues and pull requests"
        title="Search issues and pull requests (Ctrl+K)"
        maxLength={SEARCH_TEXT_MAX}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          onClose();
          event.currentTarget.blur();
        }}
      />
    </div>
  );
}
