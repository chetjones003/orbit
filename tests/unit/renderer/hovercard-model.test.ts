// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  bodyExcerpt,
  hoverTargetOf,
  hovercardProps,
  importantFields,
  summarizeChecks,
  summarizeReviews,
  targetFromUrl
} from '../../../src/renderer/src/hovercard/hovercard-model';
import type { ProjectField } from '../../../src/shared/projects';

describe('hover card targets', () => {
  it('reads an issue or pull request from its GitHub URL', () => {
    expect(targetFromUrl('https://github.com/me/app/issues/12')).toEqual({
      repoFullName: 'me/app',
      number: 12,
      kind: 'issue'
    });
    expect(targetFromUrl('https://github.com/me/app/pull/3#discussion')).toMatchObject({
      kind: 'pull',
      number: 3
    });
    expect(targetFromUrl('https://github.com/me/app/tree/main')).toBeNull();
    expect(targetFromUrl('https://example.com/me/app/issues/1')).toBeNull();
  });

  it('finds the tagged row or the link around the hovered element', () => {
    document.body.innerHTML = `
      <button ${Object.entries(hovercardProps('me/app', 7, 'pull'))
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ')}><span id="inner">Title</span></button>
      <a href="https://github.com/me/app/issues/9"><b id="bold">#9</b></a>
      <a id="web" href="https://example.com">site</a>`;
    expect(hoverTargetOf(document.getElementById('inner')!)?.target).toEqual({
      repoFullName: 'me/app',
      number: 7,
      kind: 'pull'
    });
    expect(hoverTargetOf(document.getElementById('bold')!)?.target.number).toBe(9);
    expect(hoverTargetOf(document.getElementById('web')!)).toBeNull();
  });

  it('gives a draft or an item without a number no hover card', () => {
    expect(hovercardProps(null, null, 'draft')).toEqual({});
    expect(hovercardProps('me/app', 4, 'draft')).not.toHaveProperty('data-hovercard-kind');
  });
});

describe('hover card content', () => {
  it('turns a Markdown body into a short plain excerpt cut at a word', () => {
    const body =
      '## Steps\n\n- [ ] Open the **export** dialog\n\n```js\nboom()\n```\n\nSee [the docs](https://x.y) ![shot](a.png)';
    expect(bodyExcerpt(body)).toBe('Open the export dialog See the docs');
    const long = bodyExcerpt('word '.repeat(80), 40);
    expect(long.endsWith('…')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(41);
  });

  it('counts checks as passed, failed or still running', () => {
    expect(
      summarizeChecks([
        { name: 'a', status: 'completed', conclusion: 'success', detailsUrl: null },
        { name: 'b', status: 'completed', conclusion: 'failure', detailsUrl: null },
        { name: 'c', status: 'in_progress', conclusion: null, detailsUrl: null },
        { name: 'd', status: 'completed', conclusion: 'skipped', detailsUrl: null }
      ])
    ).toEqual({ passed: 2, failed: 1, pending: 1, total: 4 });
    expect(summarizeChecks([])).toBeNull();
  });

  it('shows Status and Priority first, then other fields, and leaves out text and empty ones', () => {
    const fields: ProjectField[] = [
      { id: 'n', name: 'Notes', kind: 'text' },
      { id: 't', name: 'Target date', kind: 'date' },
      { id: 's', name: 'Start date', kind: 'date' },
      { id: 'p', name: 'Priority', kind: 'single-select', options: [] },
      { id: 'st', name: 'Status', kind: 'single-select', options: [] },
      { id: 'e', name: 'Estimate', kind: 'number' }
    ];
    const shown = importantFields(fields, {
      n: { kind: 'text', text: 'x' },
      t: { kind: 'date', date: '2026-11-12' },
      s: { kind: 'date', date: '2026-11-02' },
      p: { kind: 'single-select', optionId: 'p1', name: 'P1' },
      st: { kind: 'single-select', optionId: 'o', name: 'In progress' }
    });
    expect(shown.map((entry) => entry.field.name)).toEqual([
      'Status',
      'Priority',
      'Start date',
      'Target date'
    ]);
  });
});

describe('review summary', () => {
  const review = (authorLogin: string, state: string, submittedAt: string) => ({
    id: 1,
    authorLogin,
    state,
    submittedAt,
    body: '',
    htmlUrl: ''
  });

  it('takes each reviewer’s latest review, and a change request outweighs approvals', () => {
    expect(
      summarizeReviews([
        review('ana', 'CHANGES_REQUESTED', '2026-11-01'),
        review('ana', 'APPROVED', '2026-11-03'),
        review('bo', 'APPROVED', '2026-11-02')
      ])
    ).toMatchObject({ state: 'approved', approvals: 2, changesRequested: 0 });
    expect(
      summarizeReviews([
        review('ana', 'APPROVED', '2026-11-01'),
        review('bo', 'CHANGES_REQUESTED', '2026-11-02')
      ]).state
    ).toBe('changes-requested');
  });

  it('keeps an approval when the reviewer comments later, and ignores dismissed reviews', () => {
    expect(
      summarizeReviews([review('ana', 'APPROVED', '2026-11-01'), review('ana', 'COMMENTED', '2026-11-02')])
        .state
    ).toBe('approved');
    expect(summarizeReviews([review('ana', 'DISMISSED', '2026-11-01')]).state).toBe('none');
    expect(summarizeReviews([review('ana', 'COMMENTED', '2026-11-01')]).state).toBe('commented');
  });
});
