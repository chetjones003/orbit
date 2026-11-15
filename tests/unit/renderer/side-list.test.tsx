// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SideList, type ItemRef } from '../../../src/renderer/src/shell/SideList';
import type { PersonalRepo } from '../../../src/shared/ipc';

const repo = { id: 1, fullName: 'acme/app', name: 'app' } as PersonalRepo;
const row = { number: 7, title: 'Fix the thing', commentCount: 2 };
const item: ItemRef = { repoFullName: 'acme/app', number: 7, kind: 'issue' };

function setup() {
  const handlers = { onOpen: vi.fn<(item: ItemRef) => void>(), onOpenFull: vi.fn<(item: ItemRef) => void>() };
  Object.assign(window, {
    orbit: {
      issues: { list: vi.fn(async () => ({ items: [row] })) },
      pulls: { list: vi.fn(async () => ({ items: [] })) }
    }
  });
  render(
    <SideList
      kind="issue"
      repos={[repo]}
      selected={null}
      onOpen={handlers.onOpen}
      onOpenFull={handlers.onOpenFull}
      onContextMenu={vi.fn()}
      onRefreshRepos={vi.fn()}
    />
  );
  return handlers;
}

const rowButton = async () => screen.findByRole('button', { name: /Fix the thing/ });

describe('SideList picks', () => {
  afterEach(() => cleanup());

  it('a single click picks the item once the double-click wait has passed', async () => {
    const handlers = setup();
    fireEvent.click(await rowButton());
    expect(handlers.onOpen).not.toHaveBeenCalled();
    await waitFor(() => expect(handlers.onOpen).toHaveBeenCalledWith(item), { timeout: 1000 });
    expect(handlers.onOpenFull).not.toHaveBeenCalled();
  });

  it('a double click opens full screen and never picks the item for the side panel', async () => {
    const handlers = setup();
    const button = await rowButton();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.doubleClick(button);
    expect(handlers.onOpenFull).toHaveBeenCalledWith(item);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(handlers.onOpen).not.toHaveBeenCalled();
    expect(handlers.onOpenFull).toHaveBeenCalledTimes(1);
  });
});
