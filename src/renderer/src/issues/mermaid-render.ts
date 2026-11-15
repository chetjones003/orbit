import DOMPurify from 'dompurify';
import type mermaidApi from 'mermaid';

/**
 * Mermaid is large, so it loads the first time a body contains a diagram. Diagrams render with strict
 * security, as text rather than HTML labels, and the SVG is sanitized again before it reaches the DOM.
 */
let mermaidModule: Promise<typeof mermaidApi> | null = null;

function loadMermaid(): Promise<typeof mermaidApi> {
  mermaidModule ??= import('mermaid').then((module) => module.default);
  return mermaidModule;
}

/** Renders one diagram to sanitized SVG markup. Rejects when the source is not a valid diagram. */
export async function renderMermaidSvg(source: string, id: string): Promise<string> {
  const mermaid = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: document.documentElement.dataset['theme'] === 'light' ? 'default' : 'dark',
    fontFamily: 'inherit',
    // Plain SVG text labels survive sanitizing; HTML labels would need foreignObject.
    // Plain SVG text labels: the top-level setting is what stops mermaid writing HTML labels.
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    sequence: { useMaxWidth: true }
  });
  const { svg } = await mermaid.render(id, source);
  // Flowchart labels are HTML inside foreignObject, so both profiles are kept. Scripts and handlers are still removed.
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    // The diagram's own <style> sets its label colours; its selectors are scoped to this diagram's id.
    ADD_TAGS: ['foreignObject', 'style']
  });
}
