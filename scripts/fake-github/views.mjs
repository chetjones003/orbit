// Turns the fake's store into GitHub's REST response shapes. Field names and nesting follow the GitHub
// REST API, so the app's own parsers read the fake exactly as they read the real service.
import { renderMarkdown } from './markdown.mjs';
import { LOGIN } from './data.mjs';

/** Bodies are stored with root-relative asset paths; the server's own origin is added at render time. */
export function renderBody(raw, origin) {
  const absolute = (raw ?? '').replace(/\]\(\/assets\//g, `](${origin}/assets/`);
  return renderMarkdown(absolute);
}

export function userJson(store, login) {
  const user = store.users[login] ?? { login, id: 0, name: login };
  return {
    login: user.login,
    id: user.id,
    name: user.name,
    html_url: `https://github.com/${user.login}`,
    avatar_url: `https://avatars.githubusercontent.com/u/${user.id}`,
    type: 'User'
  };
}

export function repoJson(store, repo, { viewerPush = true } = {}) {
  return {
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    owner: userJson(store, repo.owner),
    private: repo.private,
    fork: repo.fork,
    archived: repo.archived,
    description: repo.description,
    default_branch: repo.default_branch,
    html_url: repo.html_url,
    updated_at: repo.updated_at,
    created_at: repo.created_at,
    permissions: { admin: false, push: viewerPush && !repo.archived, pull: true },
    allow_merge_commit: repo.allow_merge_commit,
    allow_squash_merge: repo.allow_squash_merge,
    allow_rebase_merge: repo.allow_rebase_merge,
    allow_auto_merge: repo.allow_auto_merge,
    delete_branch_on_merge: repo.delete_branch_on_merge,
    ...(repo.parent ? { parent: { full_name: repo.parent } } : {})
  };
}

export function labelJson(label) {
  return {
    id: label.id,
    name: label.name,
    color: label.color,
    description: label.description,
    default: false
  };
}

export function milestoneJson(repo, number) {
  const m = repo.milestones.find((candidate) => candidate.number === number);
  if (!m) return null;
  return {
    number: m.number,
    title: m.title,
    description: m.description,
    state: m.state,
    due_on: m.due_on,
    html_url: `${repo.html_url}/milestone/${m.number}`
  };
}

function labelsOf(repo, item) {
  return item.labels.map((label) => {
    const known = repo.labels.find((l) => l.name === label.name);
    return labelJson(known ?? label);
  });
}

/** Counts the comments on an item, which GitHub reports on the issue itself. */
function commentCount(store, item) {
  return store.comments.get(item.key).length;
}

/** An issue or pull request as GitHub's issues endpoint returns it. Pulls carry `pull_request`. */
export function issueJson(store, item, origin, { html = true } = {}) {
  const repo = store.repos.find((r) => r.name === item.repo);
  const base = `/repos/${repo.full_name}`;
  const body = item.body ?? '';
  const json = {
    id: item.rest_id,
    node_id: item.node_id,
    number: item.number,
    title: item.title,
    state: item.state,
    state_reason: item.state_reason,
    user: userJson(store, item.user),
    labels: labelsOf(repo, item),
    assignees: item.assignees.map((login) => userJson(store, login)),
    milestone: milestoneJson(repo, item.milestone),
    comments: commentCount(store, item),
    created_at: item.created_at,
    updated_at: item.updated_at,
    closed_at: item.closed_at,
    html_url: `${repo.html_url}/${item.kind === 'pull' ? 'pull' : 'issues'}/${item.number}`,
    url: `https://api.github.com${base}/issues/${item.number}`,
    body,
    ...(html ? { body_html: renderBody(body, origin) } : {})
  };
  if (item.kind === 'pull') {
    json.pull_request = {
      url: `https://api.github.com${base}/pulls/${item.number}`,
      merged_at: item.merged_at
    };
  } else {
    // Sub-issues, as GitHub reports them on every issue: a count, and the parent when there is one.
    const children = repo.items.filter((i) => i.kind === 'issue' && i.parent === item.number);
    const completed = children.filter((i) => i.state === 'closed').length;
    json.sub_issues_summary = {
      total: children.length,
      completed,
      percent_completed: children.length ? Math.round((completed / children.length) * 100) : 0
    };
    if (item.parent) json.parent_issue_url = `https://api.github.com${base}/issues/${item.parent}`;
  }
  return json;
}

/** A pull request as GitHub's pulls endpoint returns it: the issue fields plus head, base, and merge state. */
export function pullJson(store, item, origin, { html = true } = {}) {
  const repo = store.repos.find((r) => r.name === item.repo);
  const merged = item.merged_at !== null;
  return {
    ...issueJson(store, item, origin, { html }),
    draft: item.draft,
    merged,
    merged_at: item.merged_at,
    merge_commit_sha: item.merge_commit_sha,
    mergeable: item.mergeable,
    mergeable_state: item.mergeable_state,
    head: {
      ref: item.head.ref,
      sha: item.head.sha,
      repo: { full_name: item.head.repo, name: repo.name, owner: userJson(store, LOGIN) }
    },
    base: {
      ref: item.base.ref,
      sha: '1111111111111111111111111111111111111111',
      repo: { full_name: repo.full_name }
    }
  };
}

export function commentJson(store, c, origin, { html = true } = {}) {
  return {
    id: c.id,
    user: userJson(store, c.user),
    body: c.body,
    ...(html ? { body_html: renderBody(c.body, origin) } : {}),
    created_at: c.created_at,
    updated_at: c.updated_at,
    html_url: `https://github.com/${LOGIN}/comment-${c.id}`
  };
}

export function reviewJson(store, review, item) {
  return {
    id: review.id,
    node_id: review.node_id,
    user: userJson(store, review.user),
    state: review.state,
    body: review.body,
    submitted_at: review.submitted_at,
    html_url: `${item.repo ? `https://github.com/${LOGIN}/${item.repo}` : ''}/pull/${item.number}#pullrequestreview-${review.id}`
  };
}

export function fileJson(file) {
  const additions = file.additions ?? 0;
  const deletions = file.deletions ?? 0;
  return {
    filename: file.filename,
    previous_filename: file.previous_filename ?? undefined,
    status: file.status,
    additions,
    deletions,
    changes: file.changes ?? additions + deletions,
    patch: file.patch ?? undefined
  };
}

export function checkRunJson(check, repoFullName, sha) {
  return {
    name: check.name,
    status: check.status,
    conclusion: check.conclusion,
    html_url: `https://github.com/${repoFullName}/runs/${check.name.length}-${sha.slice(0, 7)}`
  };
}

export function workflowRunJson(run, id, repoFullName, sha) {
  return {
    id,
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    head_sha: sha,
    path: '.github/workflows/ci.yml',
    html_url: `https://github.com/${repoFullName}/actions/runs/${id}`
  };
}
