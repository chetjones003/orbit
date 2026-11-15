import { useEffect, useRef, useState } from 'react';
import type {
  ProjectDetail,
  ProjectField,
  ProjectFieldInput,
  ProjectItem,
  ProjectListPage,
  ProjectSavedView
} from '../../../shared/projects';
import { ProjectBoard } from './ProjectBoard';
import { ProjectTable } from './ProjectTable';
import { groupingField, parseItemRef, withFieldValue } from './project-model';

export interface ProjectsViewProps {
  /** Opens an issue or pull request in Orbit's details panel. */
  onOpenItem: (repoFullName: string, number: number, kind: 'issue' | 'pull') => void;
}

/**
 * The Projects view: the signed-in account's projects, their table and board saved views, and the
 * items each view shows. Edits save one at a time per item; GitHub's version of an item replaces the
 * local copy whenever a save answers, so a failed save shows what is actually stored.
 */
export function ProjectsView({ onOpenItem }: ProjectsViewProps) {
  const [list, setList] = useState<ProjectListPage | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [itemsPartial, setItemsPartial] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [addText, setAddText] = useState('');
  const pendingRef = useRef(new Set<string>());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    window.orbit.projects.list().then(
      (page) => !cancelled && setList(page),
      (error: unknown) => !cancelled && setListError(messageOf(error, 'Projects could not be loaded.'))
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Opening a project loads its fields and views, and selects its first view.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setDetail(null);
    setViewId(null);
    setItems([]);
    setMessage(null);
    window.orbit.projects.detail(projectId).then(
      (next) => {
        if (cancelled) return;
        setDetail(next);
        setViewId(next.views[0]?.id ?? null);
      },
      (error: unknown) => !cancelled && setMessage(messageOf(error, 'This project could not be opened.'))
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const view = detail?.views.find((v) => v.id === viewId) ?? null;

  // Items follow the selected view's filter. GitHub applies the filter, so Orbit only shows the result.
  useEffect(() => {
    if (!projectId || !view) return;
    let cancelled = false;
    setLoadingItems(true);
    window.orbit.projects.items(projectId, view.filter).then(
      (page) => {
        if (cancelled) return;
        setItems(page.items);
        setItemsPartial(page.partial);
        setLoadingItems(false);
      },
      (error: unknown) => {
        if (cancelled) return;
        setLoadingItems(false);
        setMessage(messageOf(error, 'Items could not be loaded.'));
      }
    );
    return () => {
      cancelled = true;
    };
    // `view` is derived from `detail` and `viewId`, which are the real dependencies.
  }, [projectId, viewId, detail, reloadKey]);

  const setPending = (id: string, on: boolean) => {
    if (on) pendingRef.current.add(id);
    else pendingRef.current.delete(id);
    setPendingIds(new Set(pendingRef.current));
  };

  const replaceItem = (id: string, next: ProjectItem | null) =>
    setItems((prev) =>
      next ? prev.map((item) => (item.id === id ? next : item)) : prev.filter((item) => item.id !== id)
    );

  const editField = async (item: ProjectItem, field: ProjectField, value: ProjectFieldInput | null) => {
    if (!projectId || pendingRef.current.has(item.id)) return;
    setMessage(null);
    setPending(item.id, true);
    replaceItem(item.id, withFieldValue(item, field, value));
    try {
      const result = await window.orbit.projects.setField(projectId, item.id, { fieldId: field.id, value });
      // Busy means another save on this item is running, so the local copy can't be trusted: reload.
      // A null item means GitHub could not be read back, so the row stays until a reload confirms it.
      if (result.kind === 'busy' || result.item === null) {
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

  const removeItem = async (item: ProjectItem) => {
    if (!projectId || pendingRef.current.has(item.id)) return;
    setMessage(null);
    setPending(item.id, true);
    try {
      await window.orbit.projects.removeItem(projectId, item.id);
      replaceItem(item.id, null);
    } catch (error) {
      setMessage(messageOf(error, 'The item could not be removed.'));
    } finally {
      setPending(item.id, false);
    }
  };

  const addByReference = async () => {
    if (!projectId) return;
    const ref = parseItemRef(addText);
    if (!ref) {
      setMessage('Enter the item as owner/repo#12, or paste its GitHub link.');
      return;
    }
    setMessage(null);
    try {
      const added = await window.orbit.projects.addItem(projectId, ref.repoFullName, ref.number);
      setItems((prev) => (prev.some((item) => item.id === added.id) ? prev : [...prev, added]));
      setAddText('');
    } catch (error) {
      setMessage(messageOf(error, 'The item could not be added.'));
    }
  };

  const selectedProject = list?.projects.find((p) => p.id === projectId) ?? null;
  const boardField = view?.layout === 'board' && detail ? groupingField(view, detail.fields) : null;

  return (
    <div className="projects-layout">
      <aside className="projects-list" aria-label="Your projects">
        <h3>Your projects</h3>
        {listError && <p role="alert">{listError}</p>}
        {!list && !listError && <p>Loading projects…</p>}
        {list && list.projects.length === 0 && <p>You have no projects yet.</p>}
        {list?.projects.map((project) => (
          <button
            key={project.id}
            type="button"
            className={`projects-list-item ${project.id === projectId ? 'active' : ''}`}
            aria-pressed={project.id === projectId}
            onClick={() => setProjectId(project.id)}
          >
            {project.title}
            {project.closed && <span className="project-closed"> (closed)</span>}
          </button>
        ))}
        {list?.partial && <p className="project-note">Only some projects are listed.</p>}
      </aside>

      <section className="projects-main" aria-label="Project items">
        {!selectedProject && <p>Choose a project to see its saved views and items.</p>}
        {selectedProject && (
          <>
            <div className="projects-header">
              <h2>{selectedProject.title}</h2>
              <a
                className="github-link"
                href={selectedProject.url}
                onClick={(event) => {
                  event.preventDefault();
                  void window.orbit.app.openExternal(selectedProject.url);
                }}
              >
                Open on GitHub ↗
              </a>
            </div>
            {detail && detail.views.length === 0 && <p>This project has no table or board saved views.</p>}
            {detail && detail.views.length > 0 && (
              <div className="project-view-tabs" role="tablist" aria-label="Saved views">
                {detail.views.map((savedView: ProjectSavedView) => (
                  <button
                    key={savedView.id}
                    type="button"
                    role="tab"
                    aria-selected={savedView.id === viewId}
                    className={`project-view-tab ${savedView.id === viewId ? 'active' : ''}`}
                    onClick={() => setViewId(savedView.id)}
                  >
                    {savedView.name} <span className="project-view-kind">{savedView.layout}</span>
                  </button>
                ))}
              </div>
            )}
            {detail && view && (
              <>
                <form
                  className="project-add-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void addByReference();
                  }}
                >
                  <label>
                    Add an item
                    <input
                      type="text"
                      value={addText}
                      placeholder="owner/repo#12 or a GitHub link"
                      onChange={(event) => setAddText(event.target.value)}
                    />
                  </label>
                  <button type="submit" className="secondary-action" disabled={addText.trim() === ''}>
                    Add to project
                  </button>
                </form>
                {message && (
                  <p role="alert" className="project-message">
                    {message}
                  </p>
                )}
                {loadingItems && <p>Loading items…</p>}
                {itemsPartial && <p className="project-note">Some items could not be shown.</p>}
                {view.layout === 'board' && boardField ? (
                  <ProjectBoard
                    field={boardField}
                    items={items}
                    cardFields={detail.fields}
                    pendingIds={pendingIds}
                    onMove={(item, optionId) =>
                      void editField(item, boardField, optionId ? { kind: 'single-select', optionId } : null)
                    }
                    onOpen={onOpenItem}
                  />
                ) : (
                  <>
                    {view.layout === 'board' && (
                      <p className="project-note">
                        This board has no single-select field to group by, so its items are listed.
                      </p>
                    )}
                    <ProjectTable
                      fields={detail.fields}
                      items={items}
                      pendingIds={pendingIds}
                      onEdit={(item, field, value) => void editField(item, field, value)}
                      onRemove={(item) => void removeItem(item)}
                      onOpen={onOpenItem}
                    />
                  </>
                )}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
