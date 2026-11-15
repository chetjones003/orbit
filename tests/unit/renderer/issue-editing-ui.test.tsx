// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IssueDetailView } from '../../../src/renderer/src/issues/IssueDetail';
import { NewIssueForm } from '../../../src/renderer/src/issues/NewIssueForm';
import { drafts } from '../../../src/renderer/src/comments/draft-store';
import type { IssueDetail, IssueRepoOptions, IssueSnapshot, IssueSummary } from '../../../src/shared/issues';

vi.mock('../../../src/renderer/src/comments/CodeEditor', async () => {
  const { FakeCodeEditor } = await import('./fakes/fake-code-editor');
  return { CodeEditor: FakeCodeEditor };
});

const REPO = 'orbit-owner/app';
const BODY = 'Steps:\n- [ ] reproduce\n- [x] report';

const SUMMARY: IssueSummary = {
  id: 104,
  number: 4,
  title: 'Crash on save',
  state: 'open',
  stateReason: null,
  authorLogin: 'orbit-owner',
  labels: [{ name: 'bug', color: 'd73a4a' }],
  assignees: [],
  milestone: null,
  commentCount: 0,
  createdAt: '2026-01-02T00:00:00Z',
  updatedAt: '2026-01-03T00:00:00Z',
  htmlUrl: 'https://github.com/orbit-owner/app/issues/4'
};

const OPTIONS: IssueRepoOptions = {
  labels: [
    { name: 'bug', color: 'd73a4a' },
    { name: 'urgent', color: 'ff0000' }
  ],
  assignees: ['orbit-owner', 'helper'],
  milestones: [{ number: 2, title: 'v1' }],
  partial: false
};

function detail(overrides: Partial<IssueDetail> = {}): IssueDetail {
  return {
    summary: SUMMARY,
    body: BODY,
    bodyHtml:
      '<ul><li><input type="checkbox" disabled=""> reproduce</li><li><input type="checkbox" checked="" disabled=""> report</li></ul>',
    comments: [],
    commentsPartial: false,
    ...overrides
  };
}

function snapshot(overrides: Partial<IssueSummary> = {}, body = BODY): IssueSnapshot {
  return { summary: { ...SUMMARY, ...overrides }, body, bodyHtml: `<p>${body}</p>` };
}

let api: {
  issues: Record<string, ReturnType<typeof vi.fn>>;
  pulls: { detail: ReturnType<typeof vi.fn> };
  markdown: { preview: ReturnType<typeof vi.fn> };
  app: { openExternal: ReturnType<typeof vi.fn> };
};

function renderDetail(kind: 'issue' | 'pull' = 'issue') {
  return render(
    <IssueDetailView
      repoFullName={REPO}
      number={4}
      signedInLogin="orbit-owner"
      kind={kind}
      onOpenIssue={vi.fn()}
    />
  );
}

function taskBoxes(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>('.issue-body input[type="checkbox"]')];
}

describe('IssueDetailView editing', () => {
  beforeEach(() => {
    api = {
      issues: {
        detail: vi.fn(async () => detail()),
        repoOptions: vi.fn(async () => OPTIONS),
        update: vi.fn(),
        updateFields: vi.fn(),
        setState: vi.fn(),
        setTask: vi.fn()
      },
      pulls: { detail: vi.fn(async () => detail()) },
      markdown: { preview: vi.fn(async (_repo: string, text: string) => `<p>${text}</p>`) },
      app: { openExternal: vi.fn(async () => ({ opened: true })) }
    };
    window.orbit = api as unknown as typeof window.orbit;
  });

  afterEach(() => {
    cleanup();
    drafts.clearAccount('orbit-owner');
  });

  it('saves a new title and body and shows the saved version', async () => {
    api.issues.update.mockResolvedValueOnce({
      kind: 'saved',
      issue: snapshot({ title: 'New title' }, 'New body')
    });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit issue' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'New title' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit description' }), {
      target: { value: 'New body' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('heading', { name: 'New title' })).toBeInTheDocument();
    expect(api.issues.update).toHaveBeenCalledWith(
      REPO,
      4,
      { title: 'New title', body: 'New body' },
      { title: 'Crash on save', body: BODY }
    );
  });

  it('keeps the user’s text and says so when GitHub holds a newer version', async () => {
    api.issues.update.mockResolvedValueOnce({
      kind: 'conflict',
      current: snapshot({ title: 'Their title', updatedAt: '2026-01-09T00:00:00Z' }, 'Their body')
    });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit issue' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'My title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('changed on GitHub');
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('My title');
  });

  it('closes as not planned, then offers to reopen', async () => {
    api.issues.setState.mockResolvedValueOnce({ ...SUMMARY, state: 'closed', stateReason: 'not_planned' });
    api.issues.setState.mockResolvedValueOnce({ ...SUMMARY, state: 'open' });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Close as not planned' }));
    expect(await screen.findByText('Closed')).toBeInTheDocument();
    expect(api.issues.setState).toHaveBeenLastCalledWith(REPO, 4, 'closed', 'not_planned');

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(await screen.findByText('Open')).toBeInTheDocument();
    expect(api.issues.setState).toHaveBeenLastCalledWith(REPO, 4, 'open');
  });

  it('shows a label change at once, and rolls it back when GitHub refuses it', async () => {
    let refuse!: (error: Error) => void;
    api.issues.updateFields.mockReturnValueOnce(new Promise((_resolve, reject) => (refuse = reject)));
    renderDetail();

    const urgent = await screen.findByRole('checkbox', { name: 'urgent' });
    fireEvent.click(urgent);
    expect(screen.getByRole('checkbox', { name: 'urgent' })).toBeChecked();

    refuse(new Error('GitHub refused the change.'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'urgent' })).not.toBeChecked());
    expect(api.issues.updateFields).toHaveBeenCalledWith(REPO, 4, {
      labels: ['bug', 'urgent'],
      assignees: [],
      milestoneNumber: null
    });
  });

  it('does not start a second field change while one is still saving', async () => {
    let finish!: (summary: IssueSummary) => void;
    api.issues.updateFields.mockReturnValueOnce(new Promise<IssueSummary>((resolve) => (finish = resolve)));
    renderDetail();

    fireEvent.click(await screen.findByRole('checkbox', { name: 'urgent' }));
    expect(screen.getByRole('checkbox', { name: 'helper' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'helper' }));

    expect(api.issues.updateFields).toHaveBeenCalledTimes(1);
    finish({ ...SUMMARY, labels: [...SUMMARY.labels, { name: 'urgent', color: 'ff0000' }] });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'helper' })).not.toBeDisabled());
  });

  it('ticks only the clicked task checkbox and sends the body the user saw', async () => {
    api.issues.setTask.mockResolvedValueOnce({
      kind: 'saved',
      issue: snapshot({}, BODY.replace('[ ] reproduce', '[x] reproduce'))
    });
    const { container } = renderDetail();
    await screen.findByRole('heading', { name: 'Crash on save' });

    fireEvent.click(taskBoxes(container)[0]!);

    await waitFor(() =>
      expect(api.issues.setTask).toHaveBeenCalledWith(REPO, 4, {
        index: 0,
        checked: true,
        expectedBody: BODY
      })
    );
  });

  it('asks the user to refresh, without changing the box, when the body changed upstream', async () => {
    api.issues.setTask.mockResolvedValueOnce({ kind: 'stale', current: snapshot({}, 'Rewritten') });
    const { container } = renderDetail();
    await screen.findByRole('heading', { name: 'Crash on save' });

    fireEvent.click(taskBoxes(container)[0]!);

    expect(await screen.findByRole('alert')).toHaveTextContent('changed on GitHub');
    expect(api.issues.detail).toHaveBeenCalledTimes(2);
  });

  it('shows pull request task checkboxes read-only and offers no edit controls', async () => {
    api.pulls.detail.mockResolvedValue(detail());
    const { container } = renderDetail('pull');
    await screen.findByRole('heading', { name: 'Crash on save' });

    expect(taskBoxes(container).every((box) => box.disabled)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Edit issue' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close as not planned' })).toBeNull();
  });

  it('keeps the title the user typed when they load the latest version after a conflict', async () => {
    api.issues.update.mockResolvedValueOnce({
      kind: 'conflict',
      current: snapshot({ title: 'Their title' }, 'Their body')
    });
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit issue' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'My title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load latest version' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Edit issue' }));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('My title');
  });

  it('says when the repo has more labels, assignees, or milestones than are listed', async () => {
    api.issues.repoOptions.mockResolvedValueOnce({ ...OPTIONS, partial: true });
    renderDetail();
    await screen.findByRole('heading', { name: 'Crash on save' });

    expect(await screen.findByText(/Only the first 100/)).toBeInTheDocument();
  });

  it('shows the issue’s current milestone even when the repo no longer offers it as open', async () => {
    api.issues.detail.mockResolvedValueOnce(
      detail({ summary: { ...SUMMARY, milestone: { number: 9, title: 'Closed sprint' } } })
    );
    renderDetail();
    await screen.findByRole('heading', { name: 'Crash on save' });

    const fields = screen.getByRole('region', { name: 'Issue fields' });
    expect(await within(fields).findByRole('combobox', { name: 'Milestone' })).toHaveDisplayValue(
      'Closed sprint'
    );
  });

  it('lists the choices the repo offers for labels, assignees, and milestone', async () => {
    renderDetail();
    await screen.findByRole('heading', { name: 'Crash on save' });

    const fields = screen.getByRole('region', { name: 'Issue fields' });
    expect(await within(fields).findByRole('checkbox', { name: 'helper' })).toBeInTheDocument();
    expect(within(fields).getByRole('combobox', { name: 'Milestone' })).toHaveDisplayValue('No milestone');
  });
});

describe('NewIssueForm', () => {
  beforeEach(() => {
    api = {
      issues: {
        detail: vi.fn(),
        repoOptions: vi.fn(),
        update: vi.fn(),
        updateFields: vi.fn(),
        setState: vi.fn(),
        setTask: vi.fn(),
        create: vi.fn(async () => snapshot({ number: 12, title: 'Bug' }, 'Details'))
      },
      markdown: { preview: vi.fn(async () => '<p>Details</p>') },
      app: { openExternal: vi.fn(async () => ({ opened: true })) }
    };
    window.orbit = api as unknown as typeof window.orbit;
  });

  afterEach(() => {
    cleanup();
    drafts.clearAccount('orbit-owner');
  });

  it('creates the issue with its title and body, then reports its number', async () => {
    const onCreated = vi.fn();
    render(
      <NewIssueForm
        repoFullName={REPO}
        signedInLogin="orbit-owner"
        onCreated={onCreated}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Bug' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'Details' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create issue' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(12));
    expect(api.issues.create).toHaveBeenCalledWith(REPO, { title: 'Bug', body: 'Details' });
  });

  it('does not send a blank title', () => {
    render(
      <NewIssueForm repoFullName={REPO} signedInLogin="orbit-owner" onCreated={vi.fn()} onCancel={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: 'Create issue' })).toBeDisabled();
    expect(api.issues.create).not.toHaveBeenCalled();
  });
});
