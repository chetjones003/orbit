import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { sanitizeIssueHtml } from './sanitize-issue-html';
import { renderMermaidSvg } from './mermaid-render';

/**
 * Sanitized GitHub HTML. Links are routed through `onLink`; long bodies collapse behind Show full.
 * Mermaid diagrams are drawn into the body, with a toggle to show their source. This is the only place GitHub
 * HTML is inserted into the DOM.
 */
/** Bodies longer than this (in text characters) start collapsed behind Show full. */
const COLLAPSE_AFTER_CHARS = 800;

type DrawResult = { svg: string } | { error: string };
let diagramCounter = 0;

export function RichBody({
  html,
  viewOnGitHubUrl,
  onLink,
  emptyText,
  onTaskToggle
}: {
  html: string;
  viewOnGitHubUrl: string;
  onLink: (href: string) => void;
  emptyText: string;
  /**
   * When given, task-list checkboxes are clickable. The click is reported with the checkbox's position
   * among the body's checkboxes. The box is shown unticked again until the caller re-renders with saved HTML.
   */
  onTaskToggle?: (index: number, checked: boolean) => void;
}) {
  const clean = useMemo(() => sanitizeIssueHtml(html, { viewOnGitHubUrl }), [html, viewOnGitHubUrl]);
  const textLength = useMemo(() => textOf(clean).length, [clean]);
  const collapsible = textLength > COLLAPSE_AFTER_CHARS;
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const sources = useMemo(() => mermaidSourcesIn(clean), [clean]);
  const [drawn, setDrawn] = useState<Record<string, DrawResult>>({});
  const [sourceShown, setSourceShown] = useState<Record<string, boolean>>({});
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Each diagram is drawn once. The result is stored by source, so a re-render never draws it again.
  useEffect(() => {
    for (const source of sources) {
      if (drawn[source] || inFlight.current.has(source)) continue;
      inFlight.current.add(source);
      renderMermaidSvg(source, `orbit-mermaid-${++diagramCounter}`).then(
        (svg) => {
          inFlight.current.delete(source);
          if (mounted.current) setDrawn((current) => ({ ...current, [source]: { svg } }));
        },
        (failure: unknown) => {
          inFlight.current.delete(source);
          const error = failure instanceof Error ? failure.message : 'unknown error';
          if (mounted.current) setDrawn((current) => ({ ...current, [source]: { error } }));
        }
      );
    }
  }, [sources, drawn]);

  const shown = useMemo(
    () => withDiagrams(clean, drawn, sourceShown, viewOnGitHubUrl),
    [clean, drawn, sourceShown, viewOnGitHubUrl]
  );

  // Sanitizing disables every checkbox. Editable bodies re-enable them and report changes natively,
  // because React does not own the markup inside dangerouslySetInnerHTML.
  useEffect(() => {
    const node = bodyRef.current;
    if (!node || !onTaskToggle) return;
    const boxes = (): HTMLInputElement[] => [
      ...node.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    ];
    for (const box of boxes()) box.disabled = false;
    const onChange = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
      const index = boxes().indexOf(target);
      const checked = target.checked;
      target.checked = !checked;
      onTaskToggle(index, checked);
    };
    node.addEventListener('change', onChange);
    return () => node.removeEventListener('change', onChange);
  }, [shown, onTaskToggle]);

  if (clean.trim() === '') {
    return emptyText ? <p className="empty-state">{emptyText}</p> : null;
  }

  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target as Element;
    const toggle = target.closest('[data-mermaid-toggle]');
    if (toggle) {
      const source = decodeURIComponent(toggle.getAttribute('data-mermaid-toggle') ?? '');
      setSourceShown((current) => ({ ...current, [source]: !current[source] }));
      return;
    }
    const anchor = target.closest('a');
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute('href');
    if (!href) return;
    // Notice links (View on GitHub for diagrams and math) always leave for GitHub.
    if (anchor.getAttribute('data-external') === 'true') void window.orbit.app.openExternal(href);
    else onLink(href);
  };

  return (
    <div className="issue-body-wrap">
      <div
        ref={bodyRef}
        className={`issue-body ${collapsible && !expanded ? 'collapsed' : ''}`}
        onClick={onClick}
        // Sanitized by sanitizeIssueHtml; drawn diagrams are sanitized by renderMermaidSvg. Scripts, handlers,
        // and unsafe URLs are removed.
        dangerouslySetInnerHTML={{ __html: shown }}
      />
      {collapsible && !expanded && (
        <button className="secondary-action" onClick={() => setExpanded(true)}>
          Show full
        </button>
      )}
    </div>
  );
}

/** The source of every Mermaid block in a sanitized body, in document order. */
function mermaidSourcesIn(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll<HTMLElement>('[data-mermaid-source]')].map((node) =>
    decodeURIComponent(node.getAttribute('data-mermaid-source') ?? '')
  );
}

/**
 * The body with each Mermaid block replaced by its drawing, or by its source while the drawing is pending,
 * failed, or the user has chosen to see the source. Each drawing comes from renderMermaidSvg, so it is safe.
 */
function withDiagrams(
  html: string,
  drawn: Record<string, DrawResult>,
  sourceShown: Record<string, boolean>,
  viewOnGitHubUrl: string
): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const notice of [...doc.querySelectorAll<HTMLElement>('[data-mermaid-source]')]) {
    const source = decodeURIComponent(notice.getAttribute('data-mermaid-source') ?? '');
    const result = drawn[source];
    const wantsSource = sourceShown[source] === true || !result || 'error' in result;
    const tools = doc.createElement('div');
    tools.className = 'diagram-tools';
    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'secondary-action diagram-toggle';
    toggle.setAttribute('data-mermaid-toggle', encodeURIComponent(source));
    const link = doc.createElement('a');
    link.setAttribute('href', viewOnGitHubUrl);
    link.setAttribute('data-external', 'true');
    link.textContent = 'View on GitHub';

    if (!result) {
      const note = notice.querySelector('.unrendered-note');
      if (note) note.textContent = 'Drawing diagram… ';
    } else if ('error' in result) {
      const note = notice.querySelector('.unrendered-note');
      if (note)
        note.textContent = `Diagram could not be drawn (${result.error.slice(0, 160)}). Source shown. `;
    }

    if (wantsSource) {
      // Show the source with a control back to the drawing when there is one.
      toggle.textContent = 'Show diagram';
      toggle.disabled = !result || 'error' in result;
      tools.append(toggle, link);
      notice.append(tools);
      continue;
    }

    const figure = doc.createElement('figure');
    figure.className = 'mermaid-diagram';
    const holder = doc.createElement('div');
    holder.className = 'mermaid-svg';
    holder.innerHTML = (result as { svg: string }).svg;
    toggle.textContent = 'Show source';
    tools.append(toggle, link);
    figure.append(holder, tools);
    notice.replaceWith(figure);
  }
  return doc.body.innerHTML;
}

function textOf(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}
