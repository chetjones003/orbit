// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeIssueHtml } from '../../../src/renderer/src/issues/sanitize-issue-html';

const VIEW_ON_GITHUB = 'https://github.com/orbit-owner/app/issues/4';

function render(html: string): HTMLDivElement {
  const host = document.createElement('div');
  host.innerHTML = sanitizeIssueHtml(html, { viewOnGitHubUrl: VIEW_ON_GITHUB });
  return host;
}

describe('sanitizeIssueHtml', () => {
  it('removes scripts, event handlers, and frames', () => {
    const host = render(
      '<p onclick="steal()">Hi</p><script>alert(1)</script><iframe src="https://github.com/"></iframe><style>body{}</style>'
    );

    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('iframe')).toBeNull();
    expect(host.querySelector('style')).toBeNull();
    expect(host.querySelector('p')?.getAttribute('onclick')).toBeNull();
    expect(host.textContent).toContain('Hi');
  });

  it('removes javascript: and other unsafe link schemes', () => {
    const host = render(
      '<a href="javascript:alert(1)">bad</a><a href="data:text/html,x">data</a><a href="https://github.com/a">good</a>'
    );

    const hrefs = [...host.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([null, null, 'https://github.com/a']);
  });

  it('keeps code highlighting classes so the theme can style them', () => {
    const host = render('<pre><code><span class="pl-k">const</span> x</code></pre>');

    expect(host.querySelector('span.pl-k')?.textContent).toBe('const');
  });

  it('keeps task list checkboxes but never enables them', () => {
    const host = render('<ul><li><input type="checkbox" checked disabled> done</li></ul>');

    const box = host.querySelector('input');
    expect(box?.getAttribute('type')).toBe('checkbox');
    expect(box?.hasAttribute('disabled')).toBe(true);
  });

  it('loads images only from GitHub-hosted origins', () => {
    const host = render(
      '<img alt="ok" src="https://user-images.githubusercontent.com/1/a.png">' +
        '<img alt="tracker" src="https://tracker.example/pixel.png">'
    );

    const sources = [...host.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(sources).toEqual(['https://user-images.githubusercontent.com/1/a.png']);
  });

  it('keeps video from GitHub-hosted origins, never autoplays, and does not preload', () => {
    const host = render(
      '<video autoplay src="https://github.com/user-attachments/assets/clip.mp4"></video>' +
        '<video src="https://evil.example/clip.mp4"></video>'
    );

    const videos = [...host.querySelectorAll('video')];
    expect(videos).toHaveLength(1);
    expect(videos[0]?.hasAttribute('autoplay')).toBe(false);
    expect(videos[0]?.getAttribute('preload')).toBe('none');
    expect(videos[0]?.hasAttribute('controls')).toBe(true);
  });

  it('shows Mermaid diagrams as source with a View on GitHub link', () => {
    const host = render('<pre><code class="language-mermaid">graph TD; A-->B</code></pre>');

    expect(host.querySelector('code.language-mermaid')).toBeNull();
    expect(host.textContent).toContain('graph TD; A-->B');
    expect(host.querySelector(`a[href="${VIEW_ON_GITHUB}"]`)?.textContent).toBe('View on GitHub');
  });

  it('shows math as source with a View on GitHub link', () => {
    const host = render('<span class="js-render-math">x^2 + y^2</span>');

    expect(host.textContent).toContain('x^2 + y^2');
    expect(host.querySelector(`a[href="${VIEW_ON_GITHUB}"]`)).not.toBeNull();
  });
});

describe('View on GitHub notice links', () => {
  it('marks the notice link as external so it opens GitHub, not an in-app issue route', () => {
    const host = render('<pre><code class="language-mermaid">graph TD</code></pre>');

    expect(host.querySelector(`a[href="${VIEW_ON_GITHUB}"]`)?.getAttribute('data-external')).toBe('true');
  });
});
