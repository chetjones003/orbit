import type { IssueLabel, PullCheck, PullReview } from '../../../shared/issues';
import type { ProjectField, ProjectFieldValue } from '../../../shared/projects';

/** What a hover card is about: one issue or pull request. The kind is unknown for a bare reference. */
export interface HoverTarget {
  repoFullName: string;
  number: number;
  kind: 'issue' | 'pull' | null;
}

export type HoverState = 'open' | 'closed' | 'completed' | 'not-planned' | 'merged' | 'draft';

export interface CheckSummary {
  passed: number;
  failed: number;
  pending: number;
  total: number;
}

/** Where a pull request's review stands: each reviewer's latest review, summed up. */
export interface ReviewSummary {
  state: 'approved' | 'changes-requested' | 'commented' | 'none';
  approvals: number;
  changesRequested: number;
  reviewers: string[];
}

export interface ProjectFieldShown {
  field: ProjectField;
  value: ProjectFieldValue;
}

export interface ProjectShown {
  title: string;
  fields: ProjectFieldShown[];
}

export interface HoverCardData {
  kind: 'issue' | 'pull';
  repoFullName: string;
  number: number;
  title: string;
  state: HoverState;
  authorLogin: string;
  updatedAt: string;
  labels: IssueLabel[];
  assignees: string[];
  excerpt: string;
  commentCount: number;
  /** Issues: sub-issue progress, when the issue has any. */
  subIssues: { total: number; completed: number } | null;
  /** Pull requests: the head commit's checks. */
  checks: CheckSummary | null;
  /** Pull requests: where review stands. */
  review: ReviewSummary | null;
  /** Pull requests: the branches it merges between. */
  branches: { head: string; base: string } | null;
  projects: ProjectShown[];
}

const DATA_TTL_MS = 60_000;
const FIELDS_TTL_MS = 10 * 60_000;
const EXCERPT_MAX = 180;

const ISSUE_OR_PULL_URL = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)\/?(?:[?#].*)?$/i;

/**
 * The issue or pull request an element points at. Rows and cards say so with `data-hovercard-repo` and
 * `data-hovercard-number`; links in issue bodies are read from their GitHub URL.
 */
export function hoverTargetOf(element: Element): { anchor: Element; target: HoverTarget } | null {
  const tagged = element.closest('[data-hovercard-number]');
  if (tagged) {
    const repoFullName = tagged.getAttribute('data-hovercard-repo') ?? '';
    const number = Number(tagged.getAttribute('data-hovercard-number'));
    const kind = tagged.getAttribute('data-hovercard-kind');
    if (repoFullName.includes('/') && Number.isInteger(number) && number > 0) {
      return {
        anchor: tagged,
        target: { repoFullName, number, kind: kind === 'pull' || kind === 'issue' ? kind : null }
      };
    }
  }
  const link = element.closest('a[href]');
  if (!link) return null;
  const target = targetFromUrl(link.getAttribute('href') ?? '');
  return target ? { anchor: link, target } : null;
}

export function targetFromUrl(href: string): HoverTarget | null {
  const match = ISSUE_OR_PULL_URL.exec(href.trim());
  if (!match) return null;
  const [, owner = '', repo = '', kind = '', number = ''] = match;
  return {
    repoFullName: `${owner}/${repo}`,
    number: Number(number),
    kind: kind === 'pull' ? 'pull' : 'issue'
  };
}

/** The attributes that give a row, card or link a hover card. */
export function hovercardProps(
  repoFullName: string | null | undefined,
  number: number | null | undefined,
  kind?: 'issue' | 'pull' | 'draft' | null
): Record<string, string> {
  if (!repoFullName || number === null || number === undefined) return {};
  const props: Record<string, string> = {
    'data-hovercard-repo': repoFullName,
    'data-hovercard-number': String(number)
  };
  if (kind === 'issue' || kind === 'pull') props['data-hovercard-kind'] = kind;
  return props;
}

/** A short plain-text taste of a Markdown body: no code, images, markup or links, cut at a word. */
export function bodyExcerpt(body: string, max = EXCERPT_MAX): string {
  const text = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    // A heading is a label for what follows, not part of the story, so it is left out.
    .replace(/^\s{0,3}#{1,6}\s.*$/gm, ' ')
    .replace(/^\s*(?:[-*+]\s+)?\[[ xX]\]\s*/gm, '')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|~~|\*|_)(\S[^*_~]*?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}

/** Counts the checks on a pull request's head commit by outcome. */
export function summarizeChecks(checks: PullCheck[]): CheckSummary | null {
  if (checks.length === 0) return null;
  const summary = { passed: 0, failed: 0, pending: 0, total: checks.length };
  for (const check of checks) {
    if (check.status !== 'completed') summary.pending += 1;
    else if (
      ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'].includes(
        check.conclusion ?? ''
      )
    )
      summary.failed += 1;
    else summary.passed += 1;
  }
  return summary;
}

/**
 * Sums up review from each reviewer's latest review that counts: a requested change outweighs approvals, and
 * a plain comment only shows when nobody has approved or asked for changes. Dismissed and pending reviews
 * are left out.
 */
export function summarizeReviews(reviews: PullReview[]): ReviewSummary {
  const latest = new Map<string, string>();
  const ordered = [...reviews].sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''));
  for (const review of ordered) {
    const state = review.state.toUpperCase();
    if (state === 'DISMISSED' || state === 'PENDING') continue;
    // A later comment does not undo an approval or a change request.
    if (state === 'COMMENTED' && latest.has(review.authorLogin)) continue;
    latest.set(review.authorLogin, state);
  }
  const states = [...latest.values()];
  const approvals = states.filter((state) => state === 'APPROVED').length;
  const changesRequested = states.filter((state) => state === 'CHANGES_REQUESTED').length;
  const state =
    changesRequested > 0
      ? 'changes-requested'
      : approvals > 0
        ? 'approved'
        : states.length > 0
          ? 'commented'
          : 'none';
  return { state, approvals, changesRequested, reviewers: [...latest.keys()] };
}

/**
 * The project fields worth a glance, in reading order: single selects (Status, Priority, Size and the like)
 * first, Status before everything, then iterations, dates and numbers. Free text is left out.
 */
export function importantFields(
  fields: ProjectField[],
  values: Record<string, ProjectFieldValue>
): ProjectFieldShown[] {
  const rank = (field: ProjectField): number => {
    const name = field.name.toLowerCase();
    if (name === 'status') return 0;
    if (name.includes('priority')) return 1;
    if (field.kind === 'single-select') return 2;
    if (field.kind === 'iteration') return 3;
    if (field.kind === 'date') return /start/.test(name) ? 4 : 5;
    if (field.kind === 'number') return 6;
    return 9;
  };
  return fields
    .filter((field) => field.kind !== 'text' && values[field.id] !== undefined)
    .map((field) => ({ field, value: values[field.id] as ProjectFieldValue }))
    .sort((a, b) => rank(a.field) - rank(b.field));
}

interface Cached<T> {
  at: number;
  value: Promise<T>;
}

const dataCache = new Map<string, Cached<HoverCardData | null>>();
const fieldCache = new Map<string, Cached<ProjectField[]>>();

const keyOf = (target: HoverTarget): string => `${target.repoFullName.toLowerCase()}#${target.number}`;

/** Forgets every loaded card, so the next hover reads fresh data. */
export function clearHovercardCache(): void {
  dataCache.clear();
  fieldCache.clear();
}

/**
 * Loads a card's data once a minute at most, sharing one request between every hover of the same item. A
 * repository Orbit cannot read gives null, and the card is not shown.
 */
export function loadHovercard(target: HoverTarget, now = Date.now()): Promise<HoverCardData | null> {
  const key = keyOf(target);
  const cached = dataCache.get(key);
  if (cached && now - cached.at < DATA_TTL_MS) return cached.value;
  const value = fetchCard(target).catch(() => null);
  dataCache.set(key, { at: now, value });
  return value;
}

/** The card data from whatever is already loaded, without waiting. */
export function peekHovercard(target: HoverTarget): Promise<HoverCardData | null> | null {
  return dataCache.get(keyOf(target))?.value ?? null;
}

async function fetchCard(target: HoverTarget): Promise<HoverCardData | null> {
  const projects = loadProjects(target);
  // A bare reference could be either; a pull request is asked for first, and an issue answers otherwise.
  if (target.kind !== 'issue') {
    try {
      const pull = await window.orbit.pulls.detail(target.repoFullName, target.number);
      const summary = pull.summary;
      const state: HoverState =
        pull.merged || summary.merged
          ? 'merged'
          : summary.state === 'closed'
            ? 'closed'
            : summary.draft
              ? 'draft'
              : 'open';
      return {
        kind: 'pull',
        repoFullName: target.repoFullName,
        number: target.number,
        title: summary.title,
        state,
        authorLogin: summary.authorLogin,
        updatedAt: summary.updatedAt,
        labels: summary.labels,
        assignees: summary.assignees,
        excerpt: bodyExcerpt(pull.body),
        commentCount: summary.commentCount,
        subIssues: null,
        checks: summarizeChecks(pull.checks),
        review: summarizeReviews(pull.reviews),
        branches: { head: summary.headRef, base: summary.baseRef },
        projects: await projects
      };
    } catch (cause) {
      if (target.kind === 'pull') throw cause;
    }
  }
  const issue = await window.orbit.issues.detail(target.repoFullName, target.number);
  const summary = issue.summary;
  const subIssues = issue.subIssues?.length
    ? {
        total: issue.subIssues.length,
        completed: issue.subIssues.filter((sub) => sub.state === 'closed').length
      }
    : summary.subIssues && summary.subIssues.total > 0
      ? summary.subIssues
      : null;
  const state: HoverState =
    summary.state === 'open' ? 'open' : summary.stateReason === 'not_planned' ? 'not-planned' : 'completed';
  return {
    kind: 'issue',
    repoFullName: target.repoFullName,
    number: target.number,
    title: summary.title,
    state,
    authorLogin: summary.authorLogin,
    updatedAt: summary.updatedAt,
    labels: summary.labels,
    assignees: summary.assignees,
    excerpt: bodyExcerpt(issue.body),
    commentCount: summary.commentCount,
    subIssues,
    checks: null,
    review: null,
    branches: null,
    projects: await projects
  };
}

/** The item's projects and their important fields. A failure here leaves the projects out, not the card. */
async function loadProjects(target: HoverTarget): Promise<ProjectShown[]> {
  try {
    const { memberships } = await window.orbit.projects.itemMemberships(target.repoFullName, target.number);
    const shown = await Promise.all(
      memberships.map(async ({ project, item }) => {
        const fields = await projectFields(project.id);
        return { title: project.title, fields: importantFields(fields, item.fieldValues) };
      })
    );
    return shown;
  } catch {
    return [];
  }
}

function projectFields(projectId: string, now = Date.now()): Promise<ProjectField[]> {
  const cached = fieldCache.get(projectId);
  if (cached && now - cached.at < FIELDS_TTL_MS) return cached.value;
  const value = window.orbit.projects
    .detail(projectId)
    .then((detail) => detail.fields)
    .catch(() => {
      fieldCache.delete(projectId);
      return [] as ProjectField[];
    });
  fieldCache.set(projectId, { at: now, value });
  return value;
}

/** The hover card attributes for an issue or pull request known by its GitHub URL. */
export function hovercardUrlProps(url: string | null | undefined): Record<string, string> {
  const target = url ? targetFromUrl(url) : null;
  return target ? hovercardProps(target.repoFullName, target.number, target.kind) : {};
}
