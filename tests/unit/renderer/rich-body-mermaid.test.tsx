// @vitest-environment jsdom
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const renderer = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('../../../src/renderer/src/issues/mermaid-render', () => ({
  renderMermaidSvg: vi.fn(async (source: string) => {
    renderer.calls.push(source);
    return '<svg xmlns="http://www.w3.org/2000/svg" data-test="drawn"><text>ok</text></svg>';
  })
}));

import { RichBody } from '../../../src/renderer/src/issues/RichBody';

const html = '<pre><code class="language-mermaid">graph TD\n  A--&gt;B</code></pre>';
const url = 'https://github.com/o/r/issues/1';

describe('RichBody mermaid drawing', () => {
  it('draws the diagram in place of its source notice', async () => {
    const { container } = render(
      <RichBody html={html} viewOnGitHubUrl={url} onLink={vi.fn()} emptyText="" />
    );
    await waitFor(() => expect(container.querySelector('figure.mermaid-diagram')).not.toBeNull());
    expect(renderer.calls).toEqual(['graph TD\n  A-->B']);
    expect(container.querySelector('[data-test="drawn"]')).not.toBeNull();
    expect(within(container).queryByText(/shown as source/)).toBeNull();
  });

  it('switches between the drawing and its source with one control', async () => {
    const { container } = render(
      <RichBody html={html} viewOnGitHubUrl={url} onLink={vi.fn()} emptyText="" />
    );
    await waitFor(() => expect(container.querySelector('figure.mermaid-diagram')).not.toBeNull());

    fireEvent.click(within(container).getByRole('button', { name: 'Show source' }));
    expect(container.querySelector('figure.mermaid-diagram')).toBeNull();
    expect(container.querySelector('.unrendered-block code')?.textContent).toContain('graph TD');

    fireEvent.click(within(container).getByRole('button', { name: 'Show diagram' }));
    expect(container.querySelector('figure.mermaid-diagram')).not.toBeNull();
  });
});
