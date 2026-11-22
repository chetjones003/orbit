import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';

export interface SectionHeadProps {
  icon: IconName;
  title: string;
  /** Shown as a small count beside the title, when known. */
  count?: number | null;
  /** Controls or a status that belong to the section, on the right. */
  children?: ReactNode;
  /** Makes the title a toggle that shows or hides the section's body. */
  collapsible?: { open: boolean; onToggle: () => void; controls?: string };
}

/**
 * The title bar of a section on an issue or pull request page: an icon, the section's name as a real heading,
 * an optional count, and the section's own controls. It spans the top of its card, so each section reads as
 * its own block.
 */
export function SectionHead({ icon, title, count, children, collapsible }: SectionHeadProps) {
  const countBadge = count !== undefined && count !== null && <span className="section-count">{count}</span>;
  if (collapsible) {
    return (
      <header className={`section-head collapsible ${collapsible.open ? '' : 'collapsed'}`}>
        <h3>
          <button
            type="button"
            className="section-head-toggle"
            aria-expanded={collapsible.open}
            aria-controls={collapsible.controls}
            onClick={collapsible.onToggle}
          >
            <span className="section-head-chevron" aria-hidden="true">
              <Icon name="chevronDown" size={14} />
            </span>
            <span className="section-head-icon" aria-hidden="true">
              <Icon name={icon} size={15} />
            </span>
            <span>{title}</span>
            {countBadge}
          </button>
        </h3>
        {children && <div className="section-head-aside">{children}</div>}
      </header>
    );
  }
  return (
    <header className="section-head">
      <span className="section-head-icon" aria-hidden="true">
        <Icon name={icon} size={15} />
      </span>
      <h3>{title}</h3>
      {countBadge}
      {children && <div className="section-head-aside">{children}</div>}
    </header>
  );
}
