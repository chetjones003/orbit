import DOMPurify from 'dompurify';
import { EXTERNAL_PROTOCOLS } from '../../../shared/ipc';

export interface SanitizeOptions {
  /** Link shown beside diagrams and math that Orbit cannot render. */
  viewOnGitHubUrl: string;
}

/** Tags GitHub's rendered bodies use. Anything else is removed, keeping its text. */
const ALLOWED_TAGS = [
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'dd',
  'del',
  'details',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'input',
  'kbd',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'samp',
  'small',
  'source',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
  'video',
  'div'
];

const ALLOWED_ATTR = [
  'align',
  'alt',
  'checked',
  'class',
  'colspan',
  'controls',
  'data-external',
  'dir',
  'disabled',
  'height',
  'href',
  'lang',
  'loop',
  'muted',
  'open',
  'playsinline',
  'poster',
  'preload',
  'rowspan',
  'src',
  'title',
  'type',
  'width'
];

/** Media may come only from GitHub-hosted origins, matching the CSP. */
export function isGitHubMediaUrl(value: string | null): boolean {
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false;
  return url.hostname === 'github.com' || url.hostname.endsWith('.githubusercontent.com');
}

// Registered once. Strips unsafe link targets that survive the default filter.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href');
    if (href !== null && !isAllowedLink(href)) node.removeAttribute('href');
    node.removeAttribute('target');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  if (node.tagName === 'INPUT') {
    node.setAttribute('disabled', '');
  }
});

/**
 * Turns GitHub's rendered issue HTML into markup that is safe to insert. Scripts, event
 * handlers, frames, and unsafe URLs are removed; media loads only from GitHub-hosted origins
 * and never autoplays; Mermaid diagrams and math are shown as source with a link to GitHub.
 */
export function sanitizeIssueHtml(html: string, options: SanitizeOptions): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;

  for (const code of [...body.querySelectorAll('code.language-mermaid')]) {
    const block = code.closest('pre') ?? code;
    block.replaceWith(
      sourceNotice(doc, 'Mermaid diagram', block.textContent ?? '', options.viewOnGitHubUrl, true)
    );
  }
  for (const math of [...body.querySelectorAll('.js-render-math, math-renderer')]) {
    math.replaceWith(sourceNotice(doc, 'Math', math.textContent ?? '', options.viewOnGitHubUrl, false));
  }

  for (const media of [...body.querySelectorAll('img, video, audio, source')]) {
    if (!isGitHubMediaUrl(media.getAttribute('src'))) {
      media.remove();
      continue;
    }
  }
  for (const video of [...body.querySelectorAll('video, audio')]) {
    video.removeAttribute('autoplay');
    video.setAttribute('preload', 'none');
    video.setAttribute('controls', '');
    const poster = video.getAttribute('poster');
    if (poster !== null && !isGitHubMediaUrl(poster)) video.removeAttribute('poster');
  }
  for (const input of [...body.querySelectorAll('input')]) {
    if (input.getAttribute('type') !== 'checkbox') input.remove();
  }

  return DOMPurify.sanitize(body.innerHTML, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_ATTR: ['autoplay', 'style', 'target'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false
  });
}

function isAllowedLink(href: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(href).protocol);
  } catch {
    return false;
  }
}

/** Shows unrendered source as text with a link back to the issue on GitHub. */
function sourceNotice(
  doc: Document,
  label: string,
  source: string,
  viewOnGitHubUrl: string,
  block: boolean
): HTMLElement {
  const wrapper = doc.createElement(block ? 'div' : 'span');
  wrapper.className = block ? 'unrendered unrendered-block' : 'unrendered unrendered-inline';
  const code = doc.createElement('code');
  code.textContent = source;
  const note = doc.createElement('span');
  note.className = 'unrendered-note';
  note.textContent = `${label} shown as source. `;
  const link = doc.createElement('a');
  link.setAttribute('href', viewOnGitHubUrl);
  // Marks the link for the renderer to open on GitHub directly, not route it as an in-app link.
  link.setAttribute('data-external', 'true');
  link.textContent = 'View on GitHub';
  if (block) {
    const pre = doc.createElement('pre');
    pre.appendChild(code);
    wrapper.append(pre, note, link);
  } else {
    wrapper.append(code, ' ', note, link);
  }
  return wrapper;
}
