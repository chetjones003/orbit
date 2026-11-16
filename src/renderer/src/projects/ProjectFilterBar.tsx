import type { ReactNode } from 'react';
import { Icon } from '../icons';

export interface ProjectFilterBarProps {
  keyword: string;
  onKeywordChange: (keyword: string) => void;
  /** How many items the view shows after the filter. */
  count?: number;
  /** Buttons that sit on the right of the bar, such as View settings. */
  children?: ReactNode;
}

/**
 * The bar above a project view: a keyword filter that matches titles, references, and field values, the
 * count of items it leaves, and the view's own actions.
 */
export function ProjectFilterBar({ keyword, onKeywordChange, count, children }: ProjectFilterBarProps) {
  return (
    <div className="project-view-bar">
      <label className="project-filter-input">
        <Icon name="search" size={14} />
        <span className="sr-only">Filter items</span>
        <input
          type="search"
          value={keyword}
          placeholder="Filter by keyword"
          onChange={(event) => onKeywordChange(event.target.value)}
        />
      </label>
      {count !== undefined && (
        <span className="project-filter-count">
          {count} {count === 1 ? 'item' : 'items'}
        </span>
      )}
      <div className="project-view-actions">{children}</div>
    </div>
  );
}
