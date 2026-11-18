import type { ProjectItem } from '../../../shared/projects';
import { IssueLabelChip } from '../issues/IssueLabelChip';

/** An item's GitHub labels on a board or Kanban card. Nothing for drafts or items with no labels. */
export function ProjectCardLabels({ item }: { item: ProjectItem }) {
  // Older cached items, and drafts, may have no label list.
  const labels = item.labels ?? [];
  if (labels.length === 0) return null;
  return (
    <div className="issue-labels project-card-labels" aria-label="Labels">
      {labels.map((label) => (
        <IssueLabelChip key={label.name} label={label} />
      ))}
    </div>
  );
}
