import { useEffect, useRef, useState } from 'react';
import type {
  ItemMemberships,
  ProjectDetail,
  ProjectField,
  ProjectFieldInput,
  ProjectItem,
  ProjectListPage,
  ProjectMembership
} from '../../../shared/projects';
import { Icon } from '../icons';
import { ProjectFieldEditor } from './ProjectFieldEditor';
import { describeValue, withFieldValue } from './project-model';
import { subscribeItemsRefresh } from '../shell/list-events';

export interface ItemProjectsProps {
  repoFullName: string;
  number: number;
}

/**
 * The Projects section of an issue or pull request. It shows each project the item is in, edits that
 * project's fields, and adds or removes the item. One edit per item runs at a time.
 */
export function ItemProjects({ repoFullName, number }: ItemProjectsProps) {
  const [memberships, setMemberships] = useState<ItemMemberships | null>(null);
  const [details, setDetails] = useState<Record<string, ProjectDetail>>({});
  const [allProjects, setAllProjects] = useState<ProjectListPage | null>(null);
  const [addId, setAddId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const pendingRef = useRef(new Set<string>());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);
  // Each project is a disclosure: collapsed by default, so an issue with several projects stays compact.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useEffect(
    () =>
      subscribeItemsRefresh(() => {
        setReloadKey((key) => key + 1);
        void window.orbit.projects.list().then(setAllProjects, () => undefined);
      }),
    []
  );

  useEffect(() => {
    let cancelled = false;
    setMemberships(null);
    setMessage(null);
    window.orbit.projects.itemMemberships(repoFullName, number).then(
      async (next) => {
        if (cancelled) return;
        setMemberships(next);
        // Field definitions come from each project. They load once per project, not once per edit.
        const missing = [...new Set(next.memberships.map((m) => m.project.id))];
        try {
          const loaded = await Promise.all(
            missing.map((id) => window.orbit.projects.detail(id).then((d) => [id, d] as const))
          );
          if (!cancelled) setDetails((prev) => ({ ...prev, ...Object.fromEntries(loaded) }));
        } catch (error) {
          if (!cancelled) setMessage(messageOf(error, 'The project fields could not be loaded.'));
        }
      },
      (error: unknown) => !cancelled && setMessage(messageOf(error, 'Projects could not be loaded.'))
    );
    return () => {
      cancelled = true;
    };
  }, [repoFullName, number, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    window.orbit.projects.list().then(
      (page) => !cancelled && setAllProjects(page),
      () => undefined
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const setPending = (id: string, on: boolean) => {
    if (on) pendingRef.current.add(id);
    else pendingRef.current.delete(id);
    setPendingIds(new Set(pendingRef.current));
  };

  const replaceItem = (id: string, next: ProjectItem | null) =>
    setMemberships((prev) =>
      prev
        ? {
            ...prev,
            memberships: next
              ? prev.memberships.map((m) => (m.item.id === id ? { ...m, item: next } : m))
              : prev.memberships.filter((m) => m.item.id !== id)
          }
        : prev
    );

  const editField = async (
    membership: ProjectMembership,
    field: ProjectField,
    value: ProjectFieldInput | null
  ) => {
    const { item, project } = membership;
    if (pendingRef.current.has(item.id)) return;
    setMessage(null);
    setPending(item.id, true);
    replaceItem(item.id, withFieldValue(item, field, value));
    try {
      const result = await window.orbit.projects.setField(project.id, item.id, { fieldId: field.id, value });
      // Busy: another save on this item is still running and will not refresh this panel. Restore the row as it was before this edit.
      if (result.kind === 'busy') {
        replaceItem(item.id, item);
        return;
      }
      // Unreadable: reload from GitHub rather than trust the local copy or drop the membership.
      if (result.item === null) {
        if (result.kind === 'failed') setMessage(result.message);
        setReloadKey((key) => key + 1);
        return;
      }
      replaceItem(item.id, result.item);
      if (result.kind === 'failed') setMessage(result.message);
    } catch (error) {
      setMessage(messageOf(error, 'This change could not be saved.'));
      setReloadKey((key) => key + 1);
    } finally {
      setPending(item.id, false);
    }
  };

  const removeFromProject = async (membership: ProjectMembership) => {
    const { item, project } = membership;
    if (pendingRef.current.has(item.id)) return;
    setPending(item.id, true);
    setMessage(null);
    try {
      await window.orbit.projects.removeItem(project.id, item.id);
      replaceItem(item.id, null);
    } catch (error) {
      setMessage(messageOf(error, 'The item could not be removed from the project.'));
    } finally {
      setPending(item.id, false);
    }
  };

  const addToProject = async () => {
    if (!addId) return;
    setMessage(null);
    try {
      await window.orbit.projects.addItem(addId, repoFullName, number);
      setAddId('');
      setReloadKey((key) => key + 1);
    } catch (error) {
      setMessage(messageOf(error, 'The item could not be added to the project.'));
    }
  };

  const joined = new Set(memberships?.memberships.map((m) => m.project.id) ?? []);
  const addable = (allProjects?.projects ?? []).filter((p) => !p.closed && !joined.has(p.id));

  return (
    <section className="item-projects" aria-label="Projects">
      <h3>Projects</h3>
      {message && (
        <p role="alert" className="project-message">
          {message}
        </p>
      )}
      {!memberships && !message && <p>Loading projects…</p>}
      {memberships && memberships.memberships.length === 0 && <p>Not in any of your projects.</p>}
      {memberships?.memberships.map((membership) => {
        const { project, item } = membership;
        const detail = details[project.id];
        const pending = pendingIds.has(item.id);
        const isOpen = expanded[project.id] === true;
        const statusField = detail?.fields.find((field) => field.name === 'Status');
        const statusText = statusField ? describeValue(item.fieldValues[statusField.id]) : '';
        return (
          <div className="item-project" key={project.id} aria-busy={pending || undefined}>
            <div className="item-project-header">
              <button
                type="button"
                className="item-project-toggle"
                aria-expanded={isOpen}
                onClick={() => setExpanded((current) => ({ ...current, [project.id]: !isOpen }))}
              >
                <span className="item-project-title">
                  <span className="item-project-mark" aria-hidden="true">
                    <Icon name="projects" size={13} />
                  </span>
                  <strong>{project.title}</strong>
                </span>
                {statusText && <span className="item-project-summary">Status: {statusText}</span>}
                <span className={`item-project-chevron ${isOpen ? 'open' : ''}`} aria-hidden="true">
                  <Icon name="chevronDown" size={14} />
                </span>
              </button>
              <button
                type="button"
                className="secondary-action"
                disabled={pending}
                onClick={() => void removeFromProject(membership)}
              >
                Remove from project
              </button>
            </div>
            {isOpen &&
              (detail ? (
                detail.fields.map((field) => (
                  <label className="item-project-field" key={field.id}>
                    <span>{field.name}</span>
                    <ProjectFieldEditor
                      field={field}
                      value={item.fieldValues[field.id]}
                      itemLabel={`${repoFullName}#${number} in ${project.title}`}
                      disabled={pending}
                      onChange={(value) => void editField(membership, field, value)}
                    />
                  </label>
                ))
              ) : (
                <p>Loading fields…</p>
              ))}
          </div>
        );
      })}
      {memberships && addable.length > 0 && (
        <form
          className="item-project-add"
          onSubmit={(event) => {
            event.preventDefault();
            void addToProject();
          }}
        >
          <label>
            Add to project
            <select value={addId} onChange={(event) => setAddId(event.target.value)}>
              <option value="">Choose a project</option>
              {addable.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="secondary-action" disabled={addId === ''}>
            Add
          </button>
        </form>
      )}
    </section>
  );
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
