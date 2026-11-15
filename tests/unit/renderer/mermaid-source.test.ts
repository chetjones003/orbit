// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeIssueHtml } from '../../../src/renderer/src/issues/sanitize-issue-html';

describe('mermaid source on the fallback notice', () => {
  it('keeps the diagram source on the notice, so the renderer can draw the diagram in its place', () => {
    const html = '<pre><code class="language-mermaid">graph TD\n  A--&gt;B</code></pre>';
    const clean = sanitizeIssueHtml(html, { viewOnGitHubUrl: 'https://github.com/o/r/issues/1' });
    const doc = new DOMParser().parseFromString(clean, 'text/html');
    const notice = doc.querySelector('[data-mermaid-source]');
    expect(notice).not.toBeNull();
    expect(decodeURIComponent(notice?.getAttribute('data-mermaid-source') ?? '')).toBe('graph TD\n  A-->B');
  });
});
