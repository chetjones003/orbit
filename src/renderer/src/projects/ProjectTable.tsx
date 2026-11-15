import type { ProjectField, ProjectFieldInput, ProjectItem } from '../../../shared/projects';
import { ProjectFieldEditor } from './ProjectFieldEditor';
import { openableKind } from './project-model';

export interface ProjectTableProps {
  fields: ProjectField[];
  items: ProjectItem[];
  pendingIds: ReadonlySet<string>;
  onEdit: (item: ProjectItem, field: ProjectField, value: ProjectFieldInput | null) => void;
  onRemove: (item: ProjectItem) => void;
  onOpen: (repoFullName: string, number: number, kind: 'issue' | 'pull') => void;
}

/** Items as rows and project fields as columns. Each cell edits its field in place. */
export function ProjectTable({ fields, items, pendingIds, onEdit, onRemove, onOpen }: ProjectTableProps) {
  return (
    <div className="project-table-scroll">
      <table className="project-table">
        <thead>
          <tr>
            <th scope="col">Item</th>
            {fields.map((field) => (
              <th scope="col" key={field.id}>
                {field.name}
              </th>
            ))}
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
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
          })}
        </tbody>
      </table>
    </div>
  );
}
