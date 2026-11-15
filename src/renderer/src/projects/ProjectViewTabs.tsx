import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { Icon } from '../icons';

type IconName = ComponentProps<typeof Icon>['name'];

export interface ProjectViewTabItem {
  key: string;
  name: string;
  /** The layout's name, such as "Kanban", shown beside the view's name. */
  kind: string;
  icon: IconName;
  selected: boolean;
  onSelect: () => void;
}

export interface ProjectViewTabsProps {
  tabs: ProjectViewTabItem[];
  onNew: () => void;
}

/** How many leading tabs fit in `available` pixels, leaving room for the More button when some do not. */
export function fitCount(widths: number[], available: number, moreWidth: number): number {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= available) return widths.length;
  const budget = available - moreWidth;
  let used = 0;
  let count = 0;
  for (const width of widths) {
    if (used + width > budget) break;
    used += width;
    count += 1;
  }
  return count;
}

/**
 * The views of a project on one line, like GitHub's. Tabs that do not fit move into a More menu at the end of
 * the line, so the row never wraps and the New custom view button is always in reach.
 */
export function ProjectViewTabs({ tabs, onNew }: ProjectViewTabsProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const newRef = useRef<HTMLButtonElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const moreWrapRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState(tabs.length);
  const [menuOpen, setMenuOpen] = useState(false);

  // Re-measures the tabs against the row. The measuring strip always holds every tab, so widths never change.
  const recalc = (): void => {
    const row = rowRef.current;
    const strip = measureRef.current;
    if (!row || !strip) return;
    const every = [...strip.children] as HTMLElement[];
    // Unmeasurable (not laid out yet, or no layout engine): keep every tab visible.
    if (row.clientWidth === 0) {
      setFit(every.length);
      return;
    }
    const style = getComputedStyle(row);
    const inner = row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const reserved = newRef.current?.offsetWidth ?? 0;
    const moreWidth = (moreRef.current?.offsetWidth ?? 44) + 8;
    setFit(
      fitCount(
        every.map((el) => el.offsetWidth),
        inner - reserved,
        moreWidth
      )
    );
  };

  const signature = tabs.map((tab) => `${tab.key}:${tab.name}:${tab.kind}`).join('|');
  useLayoutEffect(() => {
    recalc();
    // The tabs' labels are what change their widths, so the signature is the only trigger that matters here.
  }, [signature]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => recalc());
    observer.observe(row);
    return () => observer.disconnect();
    // `recalc` only reads refs and the DOM, so one observer for the row's life is enough.
  }, []);

  // The More menu closes on Escape and on any press outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const onPress = (event: MouseEvent): void => {
      if (!moreWrapRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPress);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPress);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const visible = tabs.slice(0, fit);
  const hidden = tabs.slice(fit);
  const hiddenSelected = hidden.some((tab) => tab.selected);

  return (
    <div className="project-view-tabs" role="tablist" aria-label="Views" ref={rowRef}>
      <div className="project-view-measure" ref={measureRef} aria-hidden="true">
        {tabs.map((tab) => (
          <span key={tab.key} className="project-view-tab">
            <Icon name={tab.icon} size={13} />
            {tab.name}
            <span className="project-view-kind">{tab.kind}</span>
          </span>
        ))}
      </div>
      {visible.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.selected}
          className={`project-view-tab ${tab.selected ? 'active' : ''}`}
          onClick={tab.onSelect}
        >
          <Icon name={tab.icon} size={13} />
          {tab.name}
          <span className="project-view-kind">{tab.kind}</span>
        </button>
      ))}
      {hidden.length > 0 && (
        <div className="project-view-more" ref={moreWrapRef}>
          <button
            ref={moreRef}
            type="button"
            className={`project-view-tab project-view-more-button ${hiddenSelected ? 'active' : ''}`}
            aria-label={`More views, ${hidden.length} not shown`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name="dots" size={14} />
            <span>{hidden.length}</span>
          </button>
          {menuOpen && (
            <div className="project-view-menu" role="menu">
              {hidden.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="menuitem"
                  className={tab.selected ? 'active' : ''}
                  onClick={() => {
                    tab.onSelect();
                    setMenuOpen(false);
                  }}
                >
                  <Icon name={tab.icon} size={13} />
                  {tab.name}
                  <span className="project-view-kind">{tab.kind}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <button ref={newRef} type="button" className="project-view-tab project-view-new" onClick={onNew}>
        <Icon name="plus" size={13} />
        New custom view
      </button>
    </div>
  );
}
