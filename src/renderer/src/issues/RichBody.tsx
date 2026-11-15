import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { sanitizeIssueHtml } from './sanitize-issue-html';

/**
 * Sanitized GitHub HTML. Links are routed through `onLink`; long bodies collapse behind Show full.
 * This is the only place GitHub HTML is inserted into the DOM.
 */
/** Bodies longer than this (in text characters) start collapsed behind Show full. */
const COLLAPSE_AFTER_CHARS = 800;

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
  }, [clean, onTaskToggle]);

  if (clean.trim() === '') {
    return emptyText ? <p className="empty-state">{emptyText}</p> : null;
  }

  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    const anchor = (event.target as Element).closest('a');
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
        // Sanitized by sanitizeIssueHtml: scripts, handlers, and unsafe URLs are removed.
        dangerouslySetInnerHTML={{ __html: clean }}
      />
      {collapsible && !expanded && (
        <button className="secondary-action" onClick={() => setExpanded(true)}>
          Show full
        </button>
      )}
    </div>
  );
}

function textOf(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}
