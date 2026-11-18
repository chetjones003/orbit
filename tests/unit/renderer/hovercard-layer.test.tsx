// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOVERCARD_OPEN_MS, HoverCardLayer } from '../../../src/renderer/src/hovercard/HoverCardLayer';
import { clearHovercardCache, hovercardProps } from '../../../src/renderer/src/hovercard/hovercard-model';

const summary = {
  id: 1,
  number: 5,
  title: 'Export drops rows',
  state: 'open',
  stateReason: null,
  authorLogin: 'ana',
  labels: [{ name: 'bug', color: 'd73a4a' }],
  assignees: ['bo'],
  milestone: null,
  commentCount: 0,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  htmlUrl: 'https://github.com/me/app/issues/5'
};

beforeEach(() => {
  vi.useFakeTimers();
  clearHovercardCache();
  (window as unknown as { orbit: unknown }).orbit = {
    issues: {
      detail: vi.fn(async () => ({
        summary,
        body: 'Rows with **accents** go missing.',
        bodyHtml: '',
        comments: [],
        commentsPartial: false
      }))
    },
    pulls: { detail: vi.fn(async () => Promise.reject(new Error('not a pull'))) },
    projects: { itemMemberships: vi.fn(async () => ({ contentId: 'x', memberships: [], partial: false })) }
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderWithLink(props: Parameters<typeof HoverCardLayer>[0] = {}) {
  render(
    <>
      <button {...hovercardProps('me/app', 5, 'issue')}>Export drops rows</button>
      <HoverCardLayer {...props} />
    </>
  );
  return screen.getByRole('button', { name: 'Export drops rows' });
}

async function hover(element: HTMLElement, wait: number) {
  fireEvent.pointerOver(element, { pointerType: 'mouse', buttons: 0 });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(wait);
  });
}

describe('HoverCardLayer', () => {
  it('opens a card after the pointer rests on an issue, with its title, state, labels and assignee', async () => {
    const link = renderWithLink();
    await hover(link, HOVERCARD_OPEN_MS.normal - 50);
    expect(screen.queryByRole('dialog')).toBeNull();
    await hover(link, 100);
    const card = screen.getByRole('dialog', { name: 'Issue #5' });
    expect(card.textContent).toContain('Export drops rows');
    expect(card.textContent).toContain('Open');
    expect(card.textContent).toContain('bug');
    expect(card.textContent).toContain('@bo');
    expect(card.textContent).toContain('Rows with accents go missing.');
  });

  it('opens the item from the card title, and closes the card', async () => {
    const onOpen = vi.fn();
    const link = renderWithLink({ onOpen });
    await hover(link, HOVERCARD_OPEN_MS.normal + 50);
    const title = screen.getByTitle('Open in Orbit');
    fireEvent.pointerDown(title);
    fireEvent.click(title);
    expect(onOpen).toHaveBeenCalledWith('me/app', 5, 'issue');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows no card when hover cards are off', async () => {
    const link = renderWithLink({ speed: 'off' });
    await hover(link, 2000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens sooner at the quick speed', async () => {
    const link = renderWithLink({ speed: 'quick' });
    await hover(link, HOVERCARD_OPEN_MS.quick + 20);
    expect(screen.getByRole('dialog')).toBeDefined();
  });
});
