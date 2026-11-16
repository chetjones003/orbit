import { useLayoutEffect, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@ui-sdk/react/menu';
import { Tabs, TabsList, TabsTab } from '@ui-sdk/react/tabs';
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
  const moreWrapRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState(tabs.length);

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
    const moreWidth = (moreWrapRef.current?.offsetWidth ?? 44) + 8;
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

  const visible = tabs.slice(0, fit);
  const hidden = tabs.slice(fit);
  const hiddenSelected = hidden.some((tab) => tab.selected);
  const selectedKey = tabs.find((tab) => tab.selected)?.key ?? null;

  return (
    <div className="project-view-tabs" ref={rowRef}>
      <div className="project-view-measure" ref={measureRef} aria-hidden="true">
        {tabs.map((tab) => (
          <span key={tab.key} className="project-view-tab">
            <Icon name={tab.icon} size={13} />
            {tab.name}
            <span className="project-view-kind">{tab.kind}</span>
          </span>
        ))}
      </div>
      <Tabs
        className="project-view-strip"
        value={selectedKey}
        onValueChange={(key) => {
          const tab = tabs.find((candidate) => candidate.key === key);
          if (tab) tab.onSelect();
        }}
      >
        <TabsList aria-label="Views">
          {visible.map((tab) => (
            <TabsTab
              key={tab.key}
              value={tab.key}
              className={`project-view-tab ${tab.selected ? 'active' : ''}`}
            >
              <Icon name={tab.icon} size={13} />
              {tab.name}
              <span className="project-view-kind">{tab.kind}</span>
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>
      {hidden.length > 0 && (
        <div className="project-view-more" ref={moreWrapRef}>
          <Menu onAction={(key) => tabs.find((tab) => tab.key === key)?.onSelect()}>
            <MenuTrigger
              className={`project-view-tab project-view-more-button ${hiddenSelected ? 'active' : ''}`}
              aria-label={`More views, ${hidden.length} not shown`}
            >
              <Icon name="dots" size={14} />
              <span>{hidden.length}</span>
            </MenuTrigger>
            <MenuContent className="project-view-menu">
              {hidden.map((tab) => (
                <MenuItem key={tab.key} value={tab.key} className={tab.selected ? 'active' : ''}>
                  <Icon name={tab.icon} size={13} />
                  {tab.name}
                  <span className="project-view-kind">{tab.kind}</span>
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        </div>
      )}
      <button ref={newRef} type="button" className="project-view-tab project-view-new" onClick={onNew}>
        <Icon name="plus" size={13} />
        New custom view
      </button>
    </div>
  );
}
