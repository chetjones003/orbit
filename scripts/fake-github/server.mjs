// Fake GitHub for debugging and tests: the OAuth device flow, REST, and GraphQL, served from an in-memory
// store seeded by data.mjs. Writes change the store, so the app reads them back the way it would from
// GitHub. Nothing here talks to the network or to a real account.
//
//   node scripts/fake-github/server.mjs [--port 4010]
//
// The app reaches it when ORBIT_GITHUB_URL is set to the server's loopback origin.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSeed, LOGIN } from './data.mjs';
import { createGraphQL, graphqlState } from './graphql-resolvers.mjs';
import {
  issueJson,
  pullJson,
  commentJson,
  reviewJson,
  fileJson,
  repoJson,
  userJson,
  labelJson,
  renderBody,
  checkRunJson,
  workflowRunJson,
  milestoneJson
} from './views.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, 'assets');
const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};
const SCOPES = 'repo,read:project,workflow,notifications';
const COLLABORATORS = [LOGIN, 'alex-reviewer', 'sam-contrib', 'jordan-design'];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Creates the fake's state and request handlers. `origin` is filled in when the server starts listening. */
export function createFakeGitHub() {
  const state = {
    store: createSeed(),
    origin: '',
    tokens: new Map(),
    devices: new Map(),
    uploads: new Map(),
    log: [],
    graphql: null
  };
  state.graphql = createGraphQL(state.store);

  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

  const repoBy = (owner, name) => {
    const repo = state.store.repos.find((r) => r.name === name && r.owner === owner);
    if (!repo) throw new HttpError(404, 'Not Found');
    return repo;
  };
  const itemBy = (repo, number, kind) => {
    const item = repo.items.find((i) => i.number === number && (kind === undefined || i.kind === kind));
    if (!item) throw new HttpError(404, 'Not Found');
    return item;
  };
  const paginate = (list, query) => {
    const perPage = Math.min(Number(query.get('per_page') ?? 30), 100);
    const page = Math.max(Number(query.get('page') ?? 1), 1);
    return list.slice((page - 1) * perPage, page * perPage);
  };
  const bodyOf = (ctx) => ctx.json ?? {};
  const wantsHtml = (ctx) => (ctx.req.headers['accept'] ?? '').includes('html+json');
  const itemFields = (ctx) => ({ html: wantsHtml(ctx) });
  const issueList = (repo, item, ctx) => issueJson(state.store, item, state.origin, itemFields(ctx));
  const pullView = (repo, item, ctx) => pullJson(state.store, item, state.origin, itemFields(ctx));
  const newItemNumber = (repo) => repo.items.length + 1;

  // -- OAuth device flow ----------------------------------------------------------------------------------

  route('POST', /^\/login\/device\/code$/, () => {
    const deviceCode = `dev_${state.store.nextId++}`;
    state.devices.set(deviceCode, false);
    return {
      body: {
        device_code: deviceCode,
        user_code: 'ABCD-1234',
        verification_uri: `${state.origin}/login/device`,
        expires_in: 900,
        interval: 1
      }
    };
  });
  route('POST', /^\/login\/oauth\/access_token$/, (ctx) => {
    const params = new URLSearchParams(ctx.text);
    if (params.get('grant_type') === 'refresh_token') {
      if (!state.tokens.has(params.get('refresh_token'))) return { body: { error: 'bad_refresh_token' } };
      state.tokens.delete(params.get('refresh_token'));
      return { body: issueTokens() };
    }
    const device = params.get('device_code');
    if (!state.devices.has(device)) return { body: { error: 'bad_verification_code' } };
    // The fake approves a device on its first poll, so sign-in finishes without a browser.
    return { body: issueTokens() };
  });
  route('GET', /^\/login\/device$/, () => ({
    headers: { 'content-type': 'text/html' },
    body: '<p>Orbit fake GitHub: sign-in is approved automatically.</p>'
  }));

  function issueTokens() {
    const n = state.store.nextId++;
    const access = `gho_fake_${n}`;
    const refresh = `ghr_fake_${n}`;
    state.tokens.set(refresh, access);
    return {
      access_token: access,
      token_type: 'bearer',
      scope: SCOPES,
      refresh_token: refresh,
      expires_in: 28800,
      refresh_token_expires_in: 15552000
    };
  }

  // -- Account, repos, and options ------------------------------------------------------------------------

  route('GET', /^\/user$/, () => ({
    body: { ...userJson(state.store, LOGIN), plan: { name: 'free' }, email: null }
  }));
  route('GET', /^\/user\/repos$/, (ctx) => {
    const owned = state.store.repos.filter((r) => r.owner === LOGIN);
    return { body: paginate(owned, ctx.query).map((r) => repoJson(state.store, r)) };
  });
  route('GET', /^\/repos\/([^/]+)\/([^/]+)$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    return { body: repoJson(state.store, repo) };
  });
  route('GET', /^\/repos\/([^/]+)\/([^/]+)\/labels$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    return { body: paginate(repo.labels.map(labelJson), ctx.query) };
  });
  route('GET', /^\/repos\/([^/]+)\/([^/]+)\/assignees$/, () => ({
    body: COLLABORATORS.map((login) => ({ login }))
  }));
  route('GET', /^\/repos\/([^/]+)\/([^/]+)\/milestones$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    const state_ = ctx.query.get('state') ?? 'open';
    const list = repo.milestones.filter((m) => state_ === 'all' || m.state === state_);
    return {
      body: paginate(
        list.map((m) => milestoneJson(repo, m.number)),
        ctx.query
      )
    };
  });
  route('GET', /^\/repos\/([^/]+)\/([^/]+)\/branches$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    return {
      body: paginate(
        repo.branches.map((name) => ({ name, commit: { sha: shaFor(repo, name) } })),
        ctx.query
      )
    };
  });
  route('DELETE', /^\/repos\/([^/]+)\/([^/]+)\/git\/refs\/heads\/(.+)$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    repo.branches = repo.branches.filter((b) => b !== decodeURIComponent(ctx.params[3]));
    return { status: 204 };
  });

  function shaFor(repo, branch) {
    let hash = 0;
    for (const ch of `${repo.name}/${branch}`) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return hash.toString(16).padStart(8, '0').repeat(5).slice(0, 40);
  }

  // -- Issues and pull requests ---------------------------------------------------------------------------

  route('GET', /^\/repos\/([^/]+)\/([^/]+)\/issues$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    const stateFilter = ctx.query.get('state') ?? 'open';
    const labels = (ctx.query.get('labels') ?? '').split(',').filter(Boolean);
    const creator = ctx.query.get('creator');
    const list = repo.items.filter(
      (i) =>
        (stateFilter === 'all' ||
          graphqlState(i).toLowerCase() === stateFilter ||
          (stateFilter === 'closed' && i.state === 'closed')) &&
        (labels.length === 0 || labels.every((l) => i.labels.some((x) => x.name === l))) &&
        (!creator || i.user === creator)
    );
    return { body: paginate(list, ctx.query).map((item) => issueList(repo, item, ctx)) };
  });
  route('POST', /^\/repos\/([^/]+)\/([^/]+)\/issues$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    if (repo.archived) throw new HttpError(403, 'This repository is archived');
    const b = bodyOf(ctx);
    if (typeof b.title !== 'string' || !b.title.trim()) throw new HttpError(422, 'Title is required');
    const item = addItemRecord(repo, {
      kind: 'issue',
      title: b.title,
      body: b.body ?? '',
      labels: labelsFrom(repo, b.labels),
      assignees: b.assignees ?? [],
      milestone: b.milestone ?? null
    });
    return { status: 201, body: issueList(repo, item, ctx) };
  });
  route('GET', /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    return { body: issueList(repo, itemBy(repo, Number(ctx.params[3])), ctx) };
  });
  route('PATCH', /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    const item = itemBy(repo, Number(ctx.params[3]));
    applyIssuePatch(repo, item, bodyOf(ctx));
    return { body: issueList(repo, item, ctx) };
  });
  route('GET', /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    const item = itemBy(repo, Number(ctx.params[3]));
    return {
      body: paginate(state.store.comments.get(item.key), ctx.query).map((c) =>
        commentJson(state.store, c, state.origin, itemFields(ctx))
      )
    };
  });
  route('POST', /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    const item = itemBy(repo, Number(ctx.params[3]));
    const c = addComment(item.key, LOGIN, bodyOf(ctx).body ?? '');
    return { status: 201, body: commentJson(state.store, c, state.origin, itemFields(ctx)) };
  });
  route('PATCH', /^\/repos\/([^/]+)\/([^/]+)\/issues\/comments\/(\d+)$/, (ctx) => {
    const found = findComment(Number(ctx.params[3]));
    found.comment.body = bodyOf(ctx).body ?? found.comment.body;
    found.comment.updated_at = new Date().toISOString();
    return { body: commentJson(state.store, found.comment, state.origin, itemFields(ctx)) };
  });
  route('DELETE', /^\/repos\/([^/]+)\/([^/]+)\/issues\/comments\/(\d+)$/, (ctx) => {
    const found = findComment(Number(ctx.params[3]));
    state.store.comments.set(
      found.key,
      state.store.comments.get(found.key).filter((c) => c.id !== found.comment.id)
    );
    return { status: 204 };
  });

  route('GET', /^\/repos\/([^/]+)\/([^/]+)\/pulls$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    const stateFilter = ctx.query.get('state') ?? 'open';
    const list = repo.items.filter(
      (i) =>
        i.kind === 'pull' &&
        (stateFilter === 'all' ||
          graphqlState(i).toLowerCase() === stateFilter ||
          (stateFilter === 'closed' && i.state === 'closed'))
    );
    return { body: paginate(list, ctx.query).map((item) => pullView(repo, item, ctx)) };
  });
  route('POST', /^\/repos\/([^/]+)\/([^/]+)\/pulls$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    if (repo.archived) throw new HttpError(403, 'This repository is archived');
    const b = bodyOf(ctx);
    if (!repo.branches.includes(b.head) || !repo.branches.includes(b.base))
      throw new HttpError(422, 'Head or base branch not found');
    const item = addItemRecord(repo, {
      kind: 'pull',
      title: b.title,
      body: b.body ?? '',
      draft: b.draft === true,
      head: { ref: b.head, sha: shaFor(repo, b.head), repo: repo.full_name },
      base: { ref: b.base }
    });
    item.files = [
      {
        filename: 'README.md',
        status: 'modified',
        additions: 1,
        deletions: 0,
        patch: '@@ -1 +1,2 @@\n Orbit\n+new line'
      }
    ];
    return { status: 201, body: pullView(repo, item, ctx) };
  });
  route('GET', /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    return { body: pullView(repo, itemBy(repo, Number(ctx.params[3]), 'pull'), ctx) };
  });
  route('PATCH', /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    const item = itemBy(repo, Number(ctx.params[3]), 'pull');
    applyIssuePatch(repo, item, bodyOf(ctx));
    return { body: pullView(repo, item, ctx) };
  });
  route('GET', /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/reviews$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    const item = itemBy(repo, Number(ctx.params[3]), 'pull');
    return { body: state.store.reviews.get(item.key).map((r) => reviewJson(state.store, r, item)) };
  });
  route('GET', /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/files$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    const item = itemBy(repo, Number(ctx.params[3]), 'pull');
    return { body: paginate(state.store.files.get(item.key).map(fileJson), ctx.query) };
  });
  route('PUT', /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/merge$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    const item = itemBy(repo, Number(ctx.params[3]), 'pull');
    const b = bodyOf(ctx);
    if (item.merged_at) throw new HttpError(405, 'Pull Request is already merged');
    if (item.state === 'closed') throw new HttpError(405, 'Pull Request is closed');
    if (b.sha && b.sha !== item.head.sha) throw new HttpError(409, 'Head branch was modified');
    if (item.mergeable === false || item.draft) throw new HttpError(405, 'Pull Request is not mergeable');
    const sha = `merge${item.number}${Date.now().toString(36)}`.padEnd(40, '0').slice(0, 40);
    Object.assign(item, {
      state: 'closed',
      closed_at: new Date().toISOString(),
      merged_at: new Date().toISOString(),
      merge_commit_sha: sha
    });
    return { body: { sha, merged: true, message: 'Pull Request successfully merged' } };
  });

  route('GET', /^\/repos\/([^/]+)\/([^/]+)\/commits\/([0-9a-f]+)\/check-runs$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    const item = repo.items.find((i) => i.head?.sha === ctx.params[3]);
    const runs = item ? state.store.checks.get(item.key) : [];
    return {
      body: {
        total_count: runs.length,
        check_runs: runs.map((c) => checkRunJson(c, repo.full_name, ctx.params[3]))
      }
    };
  });

  route('GET', /^\/repos\/([^/]+)\/([^/]+)\/actions\/runs$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    const sha = ctx.query.get('head_sha');
    const item = repo.items.find((i) => i.head?.sha === sha);
    const runs = item
      ? state.store.runs
          .get(item.key)
          .map((run, i) => workflowRunJson(run, runId(item, i), repo.full_name, sha))
      : [];
    return { body: { total_count: runs.length, workflow_runs: runs } };
  });
  route('GET', /^\/repos\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    const found = findRun(repo, Number(ctx.params[3]));
    return { body: workflowRunJson(found.run, found.id, repo.full_name, found.item.head.sha) };
  });
  const rerun = (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    const found = findRun(repo, Number(ctx.params[3]));
    found.run.status = 'queued';
    found.run.conclusion = null;
    state.store.checks.set(
      found.item.key,
      state.store.checks.get(found.item.key).map((c) => ({ ...c, status: 'queued', conclusion: null }))
    );
    return { status: 201, body: '' };
  };
  route('POST', /^\/repos\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)\/rerun$/, rerun);
  route('POST', /^\/repos\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)\/rerun-failed-jobs$/, rerun);

  // -- Workflow jobs, logs, and cancelling a run ---------------------------------------------------------

  /** Each job is one check run of the commit. Job ids are the run id, then the job's position. */
  const jobId = (runNumber, index) => runNumber * 100 + index + 1;
  const jobStatusTimes = (check) => {
    const now = Date.now();
    if (check.status === 'queued') return { started: null, completed: null };
    if (check.status === 'in_progress')
      return { started: new Date(now - 95_000).toISOString(), completed: null };
    return {
      started: new Date(now - 240_000).toISOString(),
      completed: new Date(now - 150_000).toISOString()
    };
  };
  const jobJson = (check, id, repoFullName) => {
    const times = jobStatusTimes(check);
    return {
      id,
      name: check.name,
      status: check.status,
      conclusion: check.conclusion,
      started_at: times.started,
      completed_at: times.completed,
      html_url: `https://github.com/${repoFullName}/actions/runs/${Math.floor(id / 100)}/job/${id}`
    };
  };
  route('GET', /^\/repos\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)\/jobs$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    const found = findRun(repo, Number(ctx.params[3]));
    const checks = state.store.checks.get(found.item.key);
    const jobs = checks.map((check, i) => jobJson(check, jobId(found.id, i), repo.full_name));
    return { body: { total_count: jobs.length, jobs } };
  });
  route('GET', /^\/repos\/([^/]+)\/([^/]+)\/actions\/jobs\/(\d+)\/logs$/, (ctx) => {
    const wanted = Number(ctx.params[3]);
    const runNumber = Math.floor(wanted / 100);
    const index = (wanted % 100) - 1;
    for (const repo of state.store.repos) {
      for (const item of repo.items) {
        if (runId(item, 0) !== runNumber) continue;
        const check = (state.store.checks.get(item.key) ?? [])[index];
        if (!check) throw new HttpError(404, 'Not Found');
        return { headers: { 'content-type': 'text/plain; charset=utf-8' }, body: logFor(check) };
      }
    }
    throw new HttpError(404, 'Not Found');
  });
  /** The workflow file of the fake repos. Jobs are named as the seeded checks are; smoke test needs the build and lint. */
  const WORKFLOW = [
    'name: CI',
    'on: pull_request',
    'jobs:',
    '  build:',
    '    name: build',
    '    strategy:',
    '      matrix:',
    '        os: [windows-latest, macos-latest, ubuntu-latest]',
    '    runs-on: ${{ matrix.os }}',
    '  lint:',
    '    name: lint',
    '    runs-on: ubuntu-latest',
    '  smoke:',
    '    name: smoke test',
    '    needs: [build, lint]',
    '    runs-on: windows-latest',
    ''
  ].join('\n');
  route('GET', /^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/, (ctx) => {
    const file = decodeURIComponent(ctx.params[3]);
    if (!file.startsWith('.github/workflows/')) throw new HttpError(404, 'Not Found');
    return { body: { type: 'file', encoding: 'base64', content: Buffer.from(WORKFLOW).toString('base64') } };
  });
  route('POST', /^\/repos\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)\/cancel$/, (ctx) => {
    const repo = repoBy(ctx.params[1], ctx.params[2]);
    const found = findRun(repo, Number(ctx.params[3]));
    if (found.run.status === 'completed') throw new HttpError(409, 'This workflow run is already completed.');
    found.run.status = 'completed';
    found.run.conclusion = 'cancelled';
    state.store.checks.set(
      found.item.key,
      state.store.checks
        .get(found.item.key)
        .map((check) =>
          check.status === 'completed' ? check : { ...check, status: 'completed', conclusion: 'cancelled' }
        )
    );
    return { status: 202, body: {} };
  });

  /** A plausible log for a job: setup, the work, and an error line when the job failed. */
  function logFor(check) {
    const lines = [
      '##[group]Set up job',
      "Current runner version: '2.329.0'",
      '##[endgroup]',
      `##[group]Run ${check.name}`
    ];
    if (check.status === 'queued') return ['Waiting for a runner to pick up this job…'].join('\n');
    lines.push(`$ run ${check.name}`, 'added 812 packages in 14s', '✔ checks finished');
    if (check.status === 'in_progress') lines.push('… still running');
    if (check.conclusion === 'failure') lines.push('##[error]Process completed with exit code 1.');
    if (check.conclusion === 'cancelled') lines.push('##[error]The operation was canceled.');
    lines.push('##[endgroup]');
    return lines.join('\n');
  }

  // -- Markdown, uploads, search, and notifications --------------------------------------------------------

  route('POST', /^\/markdown$/, (ctx) => ({
    headers: { 'content-type': 'text/html' },
    body: renderBody(bodyOf(ctx).text ?? '', state.origin)
  }));
  route('POST', /^\/user-attachments\/assets$/, (ctx) => {
    const id = `${state.store.nextId++}`;
    const name = ctx.query.get('name') ?? 'attachment';
    state.uploads.set(id, {
      name,
      contentType: ctx.query.get('content_type') ?? 'application/octet-stream',
      bytes: ctx.raw
    });
    return { body: { href: `${state.origin}/user-attachments/files/${id}/${encodeURIComponent(name)}` } };
  });
  route('GET', /^\/search\/issues$/, (ctx) => {
    const q = ctx.query.get('q') ?? '';
    const found = searchItems(q);
    const page = paginate(found, ctx.query);
    return {
      body: {
        total_count: found.length,
        incomplete_results: false,
        items: page.map((item) => searchJson(item, ctx))
      }
    };
  });
  route('GET', /^\/notifications$/, () => ({
    body: state.store.notifications
      .filter((n) => n.unread)
      .map((n) => {
        const repo = state.store.repos.find((r) => r.name === n.repo);
        const number = Number(n.subject.key.split('#')[1]);
        return {
          id: n.id,
          reason: n.reason,
          unread: true,
          updated_at: n.updated_at,
          repository: { full_name: repo.full_name, owner: userJson(state.store, repo.owner) },
          subject: {
            title: n.subject.title,
            type: n.subject.type,
            url: `https://api.github.com/repos/${repo.full_name}/${n.subject.type === 'PullRequest' ? 'pulls' : 'issues'}/${number}`
          }
        };
      })
  }));
  route('PATCH', /^\/notifications\/threads\/(\w+)$/, (ctx) => {
    const n = state.store.notifications.find((x) => x.id === ctx.params[1]);
    if (n) n.unread = false;
    return { status: 205 };
  });

  // -- Records and helpers for writes ---------------------------------------------------------------------

  function labelsFrom(repo, names) {
    return (names ?? []).map((name) => repo.labels.find((l) => l.name === name)).filter(Boolean);
  }

  function addItemRecord(repo, spec) {
    const number = newItemNumber(repo);
    const now = new Date().toISOString();
    const item = {
      repo: repo.name,
      number,
      key: `${repo.name}#${number}`,
      rest_id: state.store.nextId++,
      node_id: `I_${state.store.nextId++}`,
      kind: spec.kind,
      title: spec.title,
      body: spec.body ?? '',
      state: 'open',
      state_reason: null,
      user: LOGIN,
      labels: spec.labels ?? [],
      assignees: spec.assignees ?? [],
      milestone: spec.milestone ?? null,
      created_at: now,
      updated_at: now,
      closed_at: null,
      merged_at: null,
      merge_commit_sha: null,
      draft: spec.draft ?? false,
      head: spec.head ?? null,
      base: spec.base ?? null,
      mergeable: true,
      mergeable_state: 'clean',
      auto_merge: null,
      review_requested: []
    };
    repo.items.push(item);
    state.store.items.set(item.key, item);
    for (const map of [state.store.comments, state.store.reviews, state.store.threads]) map.set(item.key, []);
    state.store.checks.set(item.key, []);
    state.store.runs.set(item.key, []);
    state.store.files.set(item.key, spec.files ?? []);
    return item;
  }

  function addComment(key, user, body) {
    const now = new Date().toISOString();
    const c = { id: state.store.nextId++, user, body, created_at: now, updated_at: now };
    state.store.comments.get(key).push(c);
    return c;
  }

  function findComment(id) {
    for (const [key, list] of state.store.comments) {
      const comment = list.find((c) => c.id === id);
      if (comment) return { key, comment };
    }
    throw new HttpError(404, 'Not Found');
  }

  function applyIssuePatch(repo, item, b) {
    if (typeof b.title === 'string') item.title = b.title;
    if (typeof b.body === 'string') item.body = b.body;
    if (Array.isArray(b.labels))
      item.labels = labelsFrom(
        repo,
        b.labels.map((l) => (typeof l === 'string' ? l : l.name))
      );
    if (Array.isArray(b.assignees)) item.assignees = b.assignees;
    if (b.milestone !== undefined) item.milestone = b.milestone;
    if (b.state === 'closed' || b.state === 'open') {
      item.state = b.state;
      item.state_reason = b.state === 'closed' ? (b.state_reason ?? 'completed') : null;
      item.closed_at = b.state === 'closed' ? new Date().toISOString() : null;
    }
    item.updated_at = new Date().toISOString();
  }

  function runId(item, index) {
    return item.rest_id * 10 + index + 1;
  }

  function findRun(repo, id) {
    for (const item of repo.items) {
      const runs = state.store.runs.get(item.key) ?? [];
      const index = runs.findIndex((_, i) => runId(item, i) === id);
      if (index >= 0) return { item, run: runs[index], id };
    }
    throw new HttpError(404, 'Not Found');
  }

  function searchJson(item, ctx) {
    const repo = state.store.repos.find((r) => r.name === item.repo);
    const base = item.kind === 'pull' ? pullView(repo, item, ctx) : issueList(repo, item, ctx);
    return { ...base, repository_url: `https://api.github.com/repos/${repo.full_name}` };
  }

  /** Items matching the qualifiers the inbox uses: is:, author:, assignee:, review-requested:, mentions:, user:. */
  function searchItems(q) {
    const tokens = q.split(/\s+/).filter(Boolean);
    const owner = tokens.find((t) => t.startsWith('user:'))?.slice(5) ?? LOGIN;
    const all = state.store.repos
      .filter((r) => r.owner === owner)
      .flatMap((r) => r.items.map((item) => ({ repo: r, item })));
    return all
      .filter(({ item }) => {
        for (const token of tokens) {
          if (token === 'is:pr') {
            if (item.kind !== 'pull') return false;
            continue;
          }
          if (token === 'is:issue') {
            if (item.kind !== 'issue') return false;
            continue;
          }
          if (token === 'is:open') {
            if (item.state !== 'open') return false;
            continue;
          }
          if (token === 'is:closed') {
            if (item.state !== 'closed') return false;
            continue;
          }
          if (token.startsWith('author:') && item.user !== token.slice(7)) return false;
          if (token.startsWith('assignee:') && !item.assignees.includes(token.slice(9))) return false;
          if (token.startsWith('review-requested:') && !item.review_requested.includes(token.slice(17)))
            return false;
          if (token.startsWith('mentions:')) {
            const who = `@${token.slice(9)}`;
            const comments = state.store.comments
              .get(item.key)
              .map((c) => c.body)
              .join('\n');
            if (!`${item.body}\n${comments}`.includes(who)) return false;
          }
        }
        return true;
      })
      .sort((a, b) => b.item.updated_at.localeCompare(a.item.updated_at))
      .map(({ item }) => item);
  }

  return {
    state,
    /** Handles one request. Returns `{ status, headers, body }` with body as an object, a string, or a Buffer. */
    handle(method, url, raw, headers) {
      const path = url.pathname;
      if (path.startsWith('/__fake/')) return debugRoute(method, path, url);
      if (path.startsWith('/assets/')) return serveAsset(path.slice('/assets/'.length));
      if (path.startsWith('/user-attachments/files/')) return serveUpload(path);
      if (!path.startsWith('/login/')) requireAuthHeader(headers);
      return routeMatch(method, path, url, raw, headers);
    }
  };

  function requireAuthHeader(headers) {
    if (!(headers['authorization'] ?? '').startsWith('Bearer '))
      throw new HttpError(401, 'Requires authentication');
  }

  function routeMatch(method, path, url, raw, headers) {
    if (path === '/graphql' && method === 'POST') return graphqlRoute(raw);
    for (const entry of routes) {
      if (entry.method !== method) continue;
      const match = entry.pattern.exec(path);
      if (!match) continue;
      const text = raw.length ? raw.toString('utf8') : '';
      const json =
        text && (headers['content-type'] ?? '').includes('application/json') ? JSON.parse(text) : null;
      const ctx = { params: match, query: url.searchParams, json, raw, text, req: { headers } };
      const result = entry.handler(ctx) ?? {};
      return {
        status: result.status ?? 200,
        headers: result.headers ?? {},
        body: result.body ?? (result.status === 204 ? undefined : {})
      };
    }
    return {
      status: 404,
      headers: {},
      body: { message: 'Not Found', documentation_url: 'https://docs.github.com/rest' }
    };
  }

  function graphqlRoute(raw) {
    const payload = JSON.parse(raw.toString('utf8') || '{}');
    const result = state.graphql(
      payload.query ?? '',
      payload.variables ?? {},
      {},
      { operationName: payload.operationName }
    );
    if (result.warnings?.length)
      for (const w of result.warnings) state.log.push({ at: Date.now(), note: `graphql: ${w}` });
    return { status: 200, headers: {}, body: { data: result.data, errors: result.errors } };
  }

  function serveAsset(name) {
    const file = join(ASSETS, name.replace(/\.\.|\//g, ''));
    if (!existsSync(file) || !statSync(file).isFile())
      return { status: 404, headers: {}, body: { message: 'Not Found' } };
    return {
      status: 200,
      headers: {
        'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store'
      },
      body: readFileSync(file)
    };
  }

  function serveUpload(path) {
    const [, , , id] = path.split('/');
    const upload = state.uploads.get(id);
    if (!upload) return { status: 404, headers: {}, body: { message: 'Not Found' } };
    return { status: 200, headers: { 'content-type': upload.contentType }, body: upload.bytes };
  }

  function debugRoute(method, path) {
    if (path === '/__fake/state' && method === 'GET') {
      return { status: 200, headers: {}, body: summarize(state.store) };
    }
    if (path === '/__fake/log' && method === 'GET')
      return { status: 200, headers: {}, body: state.log.slice(-200) };
    if (path === '/__fake/reset' && method === 'POST') {
      state.store = createSeed();
      state.graphql = createGraphQL(state.store);
      state.tokens.clear();
      return { status: 200, headers: {}, body: { reset: true } };
    }
    return { status: 404, headers: {}, body: { message: 'Not Found' } };
  }
}

function summarize(store) {
  return {
    account: LOGIN,
    repos: store.repos.map((r) => ({
      name: r.name,
      private: r.private,
      fork: r.fork,
      archived: r.archived,
      items: r.items.length,
      open: r.items.filter((i) => i.state === 'open').length
    })),
    projects: store.projects.map((p) => ({
      title: p.title,
      closed: p.closed,
      items: p.items.length,
      views: p.views.map((v) => v.name)
    })),
    notifications: store.notifications.filter((n) => n.unread).length
  };
}

/** Starts the server on a loopback port and returns its origin and a close function. */
export async function startFakeGitHub({ port = 4010 } = {}) {
  const fake = createFakeGitHub();
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      // Bodies stay bytes: uploads are binary. Text and JSON are decoded where they are read.
      const raw = Buffer.concat(chunks);
      const url = new URL(req.url ?? '/', fake.state.origin || `http://127.0.0.1:${port}`);
      let result;
      try {
        result = fake.handle(req.method ?? 'GET', url, raw, req.headers);
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 500;
        result = { status, headers: {}, body: { message: error.message } };
      }
      fake.state.log.push({
        at: Date.now(),
        method: req.method,
        path: url.pathname + url.search,
        status: result.status
      });
      const headers = { 'content-type': 'application/json', ...result.headers };
      res.writeHead(result.status, headers);
      if (
        result.status === 204 ||
        result.status === 205 ||
        result.status === 304 ||
        result.body === undefined
      )
        return res.end();
      if (Buffer.isBuffer(result.body)) return res.end(result.body);
      if (typeof result.body === 'string') return res.end(result.body);
      res.end(JSON.stringify(result.body));
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  fake.state.origin = `http://127.0.0.1:${address.port}`;
  return {
    origin: fake.state.origin,
    state: fake.state,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      })
  };
}

// Run directly: `node scripts/fake-github/server.mjs --port 4010`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 4010;
  const fake = await startFakeGitHub({ port });
  console.log(`Fake GitHub for ${LOGIN} listening at ${fake.origin}`);
  console.log(`Start Orbit against it with ORBIT_GITHUB_URL=${fake.origin}`);
}
