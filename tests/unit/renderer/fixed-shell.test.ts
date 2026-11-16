// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { keepShellFixed } from '../../../src/renderer/src/shell/fixed-shell';

describe('keepShellFixed', () => {
  let stop: () => void = () => undefined;
  afterEach(() => {
    stop();
    document.body.innerHTML = '';
  });

  it('puts a scrolled app frame back to the origin', () => {
    document.body.innerHTML =
      '<div class="app-frame" style="overflow: hidden"></div><div class="pane"></div>';
    stop = keepShellFixed();
    const frame = document.querySelector<HTMLElement>('.app-frame')!;
    frame.scrollTop = 40;
    frame.scrollLeft = 25;
    frame.dispatchEvent(new Event('scroll'));
    expect(frame.scrollTop).toBe(0);
    expect(frame.scrollLeft).toBe(0);
  });

  it('puts back a clipped pane that a scroll pushed sideways', () => {
    document.body.innerHTML =
      '<div class="workspace" style="overflow: hidden"><div class="gantt" style="overflow: auto"></div></div>';
    stop = keepShellFixed();
    const workspace = document.querySelector<HTMLElement>('.workspace')!;
    workspace.scrollLeft = 120;
    workspace.dispatchEvent(new Event('scroll'));
    expect(workspace.scrollLeft).toBe(0);
  });

  it('leaves the panes alone, so they can scroll', () => {
    document.body.innerHTML =
      '<div class="app-frame" style="overflow: hidden"></div><div class="pane" style="overflow: auto"></div>';
    stop = keepShellFixed();
    const pane = document.querySelector<HTMLElement>('.pane')!;
    pane.scrollLeft = 30;
    pane.dispatchEvent(new Event('scroll'));
    expect(pane.scrollLeft).toBe(30);
  });
});
