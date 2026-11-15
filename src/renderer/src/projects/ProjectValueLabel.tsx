import type { ProjectField, ProjectFieldValue } from '../../../shared/projects';
import { IssueLabelChip } from '../issues/IssueLabelChip';
import { describeValue, valueColorHex } from './project-model';

export interface ProjectValueLabelProps {
  field: ProjectField;
  value: ProjectFieldValue | undefined;
}

/**
 * A field value shown the way GitHub shows labels: a single-select value is a chip in its option's colour, the
 * same chip an issue label uses. Other values are plain text.
 */
export function ProjectValueLabel({ field, value }: ProjectValueLabelProps) {
  const color = valueColorHex(field, value);
  if (color && value?.kind === 'single-select') {
    return <IssueLabelChip label={{ name: value.name, color }} />;
  }
  return <>{describeValue(value)}</>;
}
