/**
 * Orbit is a window, not a web page. Only the panes that are meant to scroll do. Focus or a scroll inside a pane can
 * still push a clipped (overflow: hidden) ancestor sideways or down, so on each axis that is clipped, any such scroll
 * is put back. Panes with a scrollable axis are left alone.
 */
export function keepShellFixed(root: Document = document): () => void {
  const isClipped = (value: string): boolean => value === 'hidden' || value === 'clip';

  const onScroll = (event: Event): void => {
    const target = event.target;
    const element = target === root ? root.scrollingElement : target;
    if (!(element instanceof Element)) return;
    const style = getComputedStyle(element);
    if (isClipped(style.overflowX || style.overflow) && element.scrollLeft !== 0) element.scrollLeft = 0;
    if (isClipped(style.overflowY || style.overflow) && element.scrollTop !== 0) element.scrollTop = 0;
  };

  root.addEventListener('scroll', onScroll, true);
  return () => root.removeEventListener('scroll', onScroll, true);
}
