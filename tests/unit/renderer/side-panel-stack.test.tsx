// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidePanelStack } from '../../../src/renderer/src/shell/SidePanelStack';
import type { ItemRef } from '../../../src/renderer/src/shell/SideList';

vi.mock('../../../src/renderer/src/issues/IssueDetail', () => ({ IssueDetailView: () => null }));

const item: ItemRef = { repoFullName: 'acme/app', number: 2, kind: 'issue' };

function setup() {
  const handlers = {
    onWidth: vi.fn<(width: number) => void>(),
    onExpand: vi.fn<(item: ItemRef) => void>(),
    onClose: vi.fn<(item: ItemRef) => void>(),
    onOpenItem: vi.fn<(item: ItemRef) => void>()
  };
  render(<SidePanelStack items={[item]} signedInLogin="chet" width={440} motion="full" {...handlers} />);
  return handlers;
}

describe('SidePanelStack', () => {
  afterEach(() => cleanup());

  it('resizes from the keyboard, one step at a time', () => {
    const handlers = setup();
    const edge = screen.getByRole('separator', { name: 'Resize panel' });
    fireEvent.keyDown(edge, { key: 'ArrowLeft' });
    expect(handlers.onWidth).toHaveBeenLastCalledWith(456);
    fireEvent.keyDown(edge, { key: 'ArrowRight' });
    expect(handlers.onWidth).toHaveBeenLastCalledWith(424);
  });

  it('closes only after the close animation has run', async () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Close issue #2' }));
    expect(handlers.onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(handlers.onClose).toHaveBeenCalledWith(item), { timeout: 2000 });
  });

  it('expands to full screen only after the grow animation has run', async () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open issue #2 full screen' }));
    expect(handlers.onExpand).not.toHaveBeenCalled();
    await waitFor(() => expect(handlers.onExpand).toHaveBeenCalledWith(item), { timeout: 2000 });
  });
});
