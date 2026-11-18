import type { CustomViewSort } from '../../../shared/custom-views';
import type { ProjectField, ProjectFieldInput, ProjectItem } from '../../../shared/projects';
import { ProjectFieldEditor } from './ProjectFieldEditor';
import type { ItemGroup } from './custom-view-model';
import { openableKind } from './project-model';
import { hovercardProps } from '../hovercard/hovercard-model';

export interface ProjectTableProps {
  fields: ProjectField[];
  items: ProjectItem[];
  /** When given, rows are listed under a heading per group, and `items` is ignored. */
  groups?: ItemGroup[];
  /** The custom view's sort. Its field's header shows the direction. */
  sort?: CustomViewSort | null;
  /** Pressing a field's header asks for a sort on it. Only shown when given. */
  onSort?: (fieldId: string) => void;
  pendingIds: ReadonlySet<string>;
  onEdit: (item: ProjectItem, field: ProjectField, value: ProjectFieldInput | null) => void;
  onRemove: (item: ProjectItem) => void;
  onOpen: (repoFullName: string, number: number, kind: 'issue' | 'pull') => void;
}

/** Items as rows and project fields as columns. Each cell edits its field in place. */
export function ProjectTable({
  fields,
  items,
  groups,
  sort,
  onSort,
  pendingIds,
  onEdit,
  onRemove,
  onOpen
}: ProjectTableProps) {
  const row = (item: ProjectItem) => {
    const pending = pendingIds.has(item.id);
    const kind = openableKind(item);
    const itemLabel = item.title;
    return (
      <tr key={item.id} aria-busy={pending || undefined} className={pending ? 'pending' : undefined}>
        <th scope="row">
          {kind && item.repoFullName && item.number !== null ? (
            <button
              type="button"
              className="link-button"
              {...hovercardProps(item.repoFullName, item.number, kind)}
              onClick={() => onOpen(item.repoFullName as string, item.number as number, kind)}
            >
              {item.title}
            </button>
          ) : (
            item.title
          )}
          {item.repoFullName && (
            <span className="project-card-ref">
              {' '}
              {item.repoFullName}#{item.number}
            </span>
          )}
        </th>
        {fields.map((field) => (
          <td key={field.id}>
            <ProjectFieldEditor
              field={field}
              value={item.fieldValues[field.id]}
              itemLabel={itemLabel}
              disabled={pending}
              onChange={(value) => onEdit(item, field, value)}
            />
          </td>
        ))}
        <td>
          <button
            type="button"
            className="secondary-action"
            disabled={pending}
            aria-label={`Remove ${item.title} from project`}
            onClick={() => onRemove(item)}
          >
            Remove
          </button>
        </td>
      </tr>
    );
  };

  const header = (field: ProjectField) => {
    if (!onSort) return field.name;
    const direction = sort?.fieldId === field.id ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : '';
    return (
      <button
        type="button"
        className="link-button"
        aria-label={`Sort by ${field.name}`}
        onClick={() => onSort(field.id)}
      >
        {field.name}
        {direction}
      </button>
    );
  };

  return (
    <div className="project-table-scroll">
      <table className="project-table">
        <thead>
          <tr>
            <th scope="col">Item</th>
            {fields.map((field) => (
              <th scope="col" key={field.id}>
                {header(field)}
              </th>
            ))}
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        {groups ? (
          groups.map((group) => (
            <tbody
              key={group.key}
              role="rowgroup"
              aria-label={`${group.label}, ${countLabel(group.items.length)}`}
            >
              <tr className="project-group-row">
                <th scope="rowgroup" colSpan={fields.length + 2}>
                  {group.label} <span className="project-column-count">{group.items.length}</span>
                </th>
              </tr>
              {group.items.map(row)}
            </tbody>
          ))
        ) : (
          <tbody>{items.map(row)}</tbody>
        )}
      </table>
    </div>
  );
}

function countLabel(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}
