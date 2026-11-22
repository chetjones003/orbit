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

  it('reads the diagram out of the enrichment section the GitHub API returns, dropping its loading spinner', () => {
    const html =
      '<section class="js-render-needs-enrichment render-needs-enrichment" data-type="mermaid">' +
      '<div class="js-render-enrichment-target" data-plain="xychart-beta">' +
      '<div class="render-plaintext-hidden"><pre lang="mermaid" aria-label="Raw mermaid code">xychart-beta\n  line [1, 2]\n</pre></div>' +
      '</div><span class="js-render-enrichment-loader"><svg aria-label="Loading"></svg></span></section>';
    const clean = sanitizeIssueHtml(html, { viewOnGitHubUrl: 'https://github.com/o/r/pull/1' });
    const doc = new DOMParser().parseFromString(clean, 'text/html');
    const notices = doc.querySelectorAll('[data-mermaid-source]');
    expect(notices).toHaveLength(1);
    expect(decodeURIComponent(notices[0]?.getAttribute('data-mermaid-source') ?? '')).toBe(
      'xychart-beta\n  line [1, 2]'
    );
    expect(doc.body.textContent).not.toContain('Loading');
  });
});
