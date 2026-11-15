import type { CSSProperties } from 'react';
import type { IssueLabel } from '../../../shared/issues';

/**
 * One GitHub label. The label's own colour tints the chip, so it reads as the label on GitHub. The colour
 * is passed as a custom property, which the stylesheet turns into a tint and a border.
 */
export function IssueLabelChip({ label }: { label: IssueLabel }) {
  const style = { '--label': `#${label.color}` } as CSSProperties;
  return (
    <span className="issue-label" style={style} title={label.name}>
      {label.name}
    </span>
  );
}
