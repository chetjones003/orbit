// Renders GitHub-flavoured Markdown to HTML the way GitHub's rendered-body media type does: task lists with
// checkboxes, fenced code with language classes (```mermaid included), tables, strikethrough, and images.
// Built on the same @lezer/markdown GFM parser the app uses for task-list edits, so both agree on structure.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parser, GFM } = require('@lezer/markdown');
const gfm = parser.configure(GFM);

const MARKERS = new Set([
  'HeaderMark',
  'QuoteMark',
  'ListMark',
  'EmphasisMark',
  'StrikethroughMark',
  'LinkMark',
  'CodeMark',
  'TableDelimiter',
  'TaskMarker'
]);

export function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function kids(node) {
  const out = [];
  for (let child = node.firstChild; child; child = child.nextSibling) out.push(child);
  return out;
}

/** Inline content of a node: child nodes rendered, text between them escaped, markers dropped. */
function inline(node, src, skip = new Set()) {
  let html = '';
  let at = node.from;
  for (const child of kids(node)) {
    if (child.from > at) html += escapeHtml(src.slice(at, child.from));
    at = Math.max(at, child.to);
    if (MARKERS.has(child.name) || skip.has(child.name)) continue;
    html += renderInline(child, src);
  }
  if (node.to > at) html += escapeHtml(src.slice(at, node.to));
  return html;
}

function renderInline(node, src) {
  switch (node.name) {
    case 'Emphasis':
      return `<em>${inline(node, src)}</em>`;
    case 'StrongEmphasis':
      return `<strong>${inline(node, src)}</strong>`;
    case 'Strikethrough':
      return `<del>${inline(node, src)}</del>`;
    case 'InlineCode': {
      const text = src.slice(node.from, node.to).replace(/^`+ ?/, '').replace(/ ?`+$/, '');
      return `<code>${escapeHtml(text)}</code>`;
    }
    case 'Link': {
      const url = kids(node).find((c) => c.name === 'URL');
      const href = url ? src.slice(url.from, url.to) : '';
      // GitHub shows a video attachment as a player; the fake does the same for clip links.
      if (/\.(mp4|webm|mov)$/i.test(href))
        return `<video src="${escapeHtml(href)}" controls preload="none"></video>`;
      return `<a href="${escapeHtml(href)}">${inline(node, src, new Set(['URL']))}</a>`;
    }
    case 'Image': {
      const url = kids(node).find((c) => c.name === 'URL');
      const target = url ? src.slice(url.from, url.to) : '';
      // Alt text is what sits between the brackets, before any title.
      const close = src.indexOf(']', node.from);
      const alt = close > node.from ? src.slice(node.from + 2, close) : '';
      return `<img src="${escapeHtml(target)}" alt="${escapeHtml(alt)}">`;
    }
    case 'Autolink': {
      const url = kids(node).find((c) => c.name === 'URL');
      const href = url ? src.slice(url.from, url.to) : src.slice(node.from + 1, node.to - 1);
      return `<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`;
    }
    case 'HardBreak':
      return '<br>';
    case 'Escape':
      return escapeHtml(src.slice(node.from + 1, node.to));
    case 'URL':
      return escapeHtml(src.slice(node.from, node.to));
    case 'TaskMarker':
      return '';
    default:
      return inline(node, src);
  }
}

function fence(node, src) {
  const info = kids(node).find((c) => c.name === 'CodeInfo');
  const lang = info ? src.slice(info.from, info.to).trim().split(/\s+/)[0] : '';
  const text = kids(node).find((c) => c.name === 'CodeText');
  const code = text ? src.slice(text.from, text.to) : '';
  const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
  return `<div class="highlight highlight-source-${escapeHtml(lang || 'text')}"><pre class="notranslate"><code${cls}>${escapeHtml(code)}</code></pre></div>`;
}

function table(node, src) {
  const rows = kids(node).filter((c) => c.name === 'TableHeader' || c.name === 'TableRow');
  const cellHtml = (row, tag) =>
    kids(row)
      .filter((c) => c.name === 'TableCell')
      .map((cell) => `<${tag}>${inline(cell, src)}</${tag}>`)
      .join('');
  const [header, ...body] = rows;
  let html = '<table>';
  if (header) html += `<thead><tr>${cellHtml(header, 'th')}</tr></thead>`;
  if (body.length) html += `<tbody>${body.map((row) => `<tr>${cellHtml(row, 'td')}</tr>`).join('')}</tbody>`;
  return `${html}</table>`;
}

function listItem(node, src) {
  const children = kids(node);
  const task = children.find((c) => c.name === 'Task');
  if (!task) {
    const content = children
      .filter((c) => c.name !== 'ListMark')
      .map((c) => renderBlock(c, src, true))
      .join('');
    return `<li>${content}</li>`;
  }
  const marker = kids(task).find((c) => c.name === 'TaskMarker');
  const checked = marker !== undefined && /[xX]/.test(src.slice(marker.from, marker.to));
  const checkbox = `<input type="checkbox" class="task-list-item-checkbox" disabled${checked ? ' checked' : ''}> `;
  // The task's own text is the gap around its marker, so it is read as inline content of the task.
  const text = inline(task, src).trim();
  const rest = children
    .filter((c) => c !== task && c.name !== 'ListMark')
    .map((c) => renderBlock(c, src, true))
    .join('');
  return `<li class="task-list-item">${checkbox}${text}${rest}</li>`;
}

/** Renders a block. `tight` list content drops the paragraph wrapper, as GitHub does for simple lists. */
function renderBlock(node, src, tight = false) {
  switch (node.name) {
    case 'Document':
      return kids(node)
        .map((c) => renderBlock(c, src))
        .join('');
    case 'ATXHeading1':
    case 'ATXHeading2':
    case 'ATXHeading3':
    case 'ATXHeading4':
    case 'ATXHeading5':
    case 'ATXHeading6':
    case 'SetextHeading1':
    case 'SetextHeading2': {
      const level = node.name.slice(-1);
      return `<h${level}>${inline(node, src).trim()}</h${level}>\n`;
    }
    case 'Paragraph': {
      const body = inline(node, src);
      return tight ? body : `<p>${body}</p>\n`;
    }
    case 'BulletList':
      return `<ul>${kids(node)
        .map((c) => renderBlock(c, src))
        .join('')}</ul>\n`;
    case 'OrderedList':
      return `<ol>${kids(node)
        .map((c) => renderBlock(c, src))
        .join('')}</ol>\n`;
    case 'ListItem':
      return listItem(node, src);
    case 'Blockquote':
      return `<blockquote>\n${kids(node)
        .filter((c) => c.name !== 'QuoteMark')
        .map((c) => renderBlock(c, src))
        .join('')}</blockquote>\n`;
    case 'FencedCode':
      return `${fence(node, src)}\n`;
    case 'HorizontalRule':
      return '<hr>\n';
    case 'Table':
      return `${table(node, src)}\n`;
    case 'HTMLBlock':
      // Raw HTML is shown as text, not executed; GitHub's sanitizer would drop most of it anyway.
      return `<p>${escapeHtml(src.slice(node.from, node.to))}</p>\n`;
    default:
      return kids(node)
        .map((c) => renderBlock(c, src, tight))
        .join('');
  }
}

/** Renders one Markdown document. Empty input gives an empty string, as an empty GitHub body does. */
export function renderMarkdown(source) {
  if (!source || !source.trim()) return '';
  return renderBlock(gfm.parse(source).topNode, source);
}
