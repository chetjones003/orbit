import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';

export interface SectionHeadProps {
  icon: IconName;
  title: string;
  /** Shown as a small count beside the title, when known. */
  count?: number | null;
  /** Controls or a status that belong to the section, on the right. */
  children?: ReactNode;
}

/**
 * The title bar of a section on an issue or pull request page: an icon, the section's name as a real heading,
 * an optional count, and the section's own controls. It spans the top of its card, so each section reads as
 * its own block.
 */
export function SectionHead({ icon, title, count, children }: SectionHeadProps) {
  return (
    <header className="section-head">
      <span className="section-head-icon" aria-hidden="true">
        <Icon name={icon} size={15} />
      </span>
      <h3>{title}</h3>
      {count !== undefined && count !== null && <span className="section-count">{count}</span>}
      {children && <div className="section-head-aside">{children}</div>}
    </header>
  );
}
