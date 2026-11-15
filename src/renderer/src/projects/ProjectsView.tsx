import { useEffect, useRef, useState } from 'react';
import type { CustomViewDefinition } from '../../../shared/custom-views';
import type {
  ProjectDetail,
  ProjectField,
  ProjectFieldInput,
  ProjectItem,
  ProjectListPage,
  ProjectSavedView
} from '../../../shared/projects';
import { CustomViewPanel } from './CustomViewPanel';
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
  // Orbit's own custom views of every project. Only definitions are kept here, never item data.
  const [customViews, setCustomViews] = useState<CustomViewDefinition[]>([]);
  const [customId, setCustomId] = useState<string | null>(null);
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [itemsPartial, setItemsPartial] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [addText, setAddText] = useState('');
  const pendingRef = useRef(new Set<string>());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  // The project on screen now, so a late add result can tell whether it still belongs here.
  const projectIdRef = useRef<string | null>(null);
  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);
  // The filter of the view on screen now. Saves and adds read it when they finish, not when they start.
  const filterRef = useRef('');

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

  useEffect(() => {
    let cancelled = false;
    window.orbit.settings.get().then(
      (settings) => !cancelled && setCustomViews(settings.customViews),
      () => !cancelled && setMessage('Custom views could not be loaded.')
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
    setCustomId(null);
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
  const projectViews = customViews.filter((v) => v.projectId === projectId);
  const customView = projectViews.find((v) => v.id === customId) ?? null;
  // The GitHub filter of whichever view is on screen: a saved view's filter, or a custom view's advanced filter.
  const activeFilter = view ? view.filter : customView ? customView.advancedFilter : null;
  useEffect(() => {
    filterRef.current = activeFilter ?? '';
  }, [activeFilter]);

  // Items follow the selected view's filter. GitHub applies the filter, so Orbit only shows the result.
  useEffect(() => {
    if (!projectId || activeFilter === null) return;
    let cancelled = false;
    setLoadingItems(true);
    window.orbit.projects.items(projectId, activeFilter).then(
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
    // `activeFilter` is derived from `detail`, `viewId`, and `customId`, which are the real dependencies.
  }, [projectId, viewId, customId, detail, reloadKey, activeFilter]);

  const setPending = (id: string, on: boolean) => {
    if (on) pendingRef.current.add(id);
    else pendingRef.current.delete(id);
    setPendingIds(new Set(pendingRef.current));
  };

  const replaceItem = (id: string, next: ProjectItem | null) =>
    setItems((prev) =>
      next ? prev.map((item) => (item.id === id ? next : item)) : prev.filter((item) => item.id !== id)
    );

  /** Resolves to the item GitHub now has when the save landed, and null otherwise. */
  const editField = async (
    item: ProjectItem,
    field: ProjectField,
    value: ProjectFieldInput | null
  ): Promise<ProjectItem | null> => {
    if (!projectId || pendingRef.current.has(item.id)) return null;
    setMessage(null);
    setPending(item.id, true);
    replaceItem(item.id, withFieldValue(item, field, value));
    try {
      const result = await window.orbit.projects.setField(projectId, item.id, { fieldId: field.id, value });
      // Busy: another save on this item is still running, which will not refresh this row. Restore the row as it was before this edit.
      if (result.kind === 'busy') {
        replaceItem(item.id, item);
        return null;
      }
      // A null item means GitHub could not be read back, so the row stays until a reload confirms it.
      if (result.item === null) {
        if (result.kind === 'failed') setMessage(result.message);
        setReloadKey((key) => key + 1);
        return null;
      }
      replaceItem(item.id, result.item);
      if (result.kind === 'failed') {
        setMessage(result.message);
        return null;
      }
      // A filtered view may stop or start matching after a save, so GitHub decides which items it shows.
      if (filterRef.current !== '') setReloadKey((key) => key + 1);
      return result.item;
    } catch (error) {
      setMessage(messageOf(error, 'This change could not be saved.'));
      setReloadKey((key) => key + 1);
      return null;
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
    const target = projectId;
    try {
      await window.orbit.projects.addItem(target, ref.repoFullName, ref.number);
      setAddText('');
      // The user moved to another project while this was saving; the item belongs to the one it was added to.
      if (projectIdRef.current !== target) return;
      // Let GitHub decide whether the added item belongs in the view on screen now.
      setReloadKey((key) => key + 1);
    } catch (error) {
      setMessage(messageOf(error, 'The item could not be added.'));
    }
  };

  // Every change to a custom view saves the whole list straight away, so nothing waits for a save button.
  const saveCustomViews = (next: CustomViewDefinition[]) => {
    setCustomViews(next);
    window.orbit.settings.update({ customViews: next }).then(undefined, () => {
      setMessage('Custom views could not be saved.');
    });
  };

  const addCustomView = () => {
    if (!projectId) return;
    const created: CustomViewDefinition = {
      id: crypto.randomUUID(),
      name: `Custom view ${projectViews.length + 1}`,
      projectId,
      layout: 'kanban',
      advancedFilter: '',
      conditions: [],
      sort: null,
      groupFieldId: null,
      columnFieldId: null,
      swimlaneFieldId: null
    };
    saveCustomViews([...customViews, created]);
    setCustomId(created.id);
    setViewId(null);
  };

  const deleteCustomView = (id: string) => {
    saveCustomViews(customViews.filter((v) => v.id !== id));
    setCustomId(null);
    setViewId(detail?.views[0]?.id ?? null);
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
                    onClick={() => {
                      setViewId(savedView.id);
                      setCustomId(null);
                    }}
                  >
                    {savedView.name} <span className="project-view-kind">{savedView.layout}</span>
                  </button>
                ))}
              </div>
            )}
            {detail && (
              <div className="project-view-tabs" role="tablist" aria-label="Custom views">
                {projectViews.map((custom) => (
                  <button
                    key={custom.id}
                    type="button"
                    role="tab"
                    aria-selected={custom.id === customId}
                    className={`project-view-tab ${custom.id === customId ? 'active' : ''}`}
                    onClick={() => {
                      setCustomId(custom.id);
                      setViewId(null);
                    }}
                  >
                    {custom.name} <span className="project-view-kind">{custom.layout}</span>
                  </button>
                ))}
                <button type="button" className="secondary-action" onClick={addCustomView}>
                  New custom view
                </button>
              </div>
            )}
            {detail && customView && (
              <>
                {message && (
                  <p role="alert" className="project-message">
                    {message}
                  </p>
                )}
                {loadingItems && <p>Loading items…</p>}
                {itemsPartial && <p className="project-note">Some items could not be shown.</p>}
                <CustomViewPanel
                  view={customView}
                  fields={detail.fields}
                  items={items}
                  pendingIds={pendingIds}
                  onChange={(next) => saveCustomViews(customViews.map((v) => (v.id === next.id ? next : v)))}
                  onDelete={() => deleteCustomView(customView.id)}
                  onEdit={editField}
                  onRemove={(item) => void removeItem(item)}
                  onOpen={onOpenItem}
                />
              </>
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
