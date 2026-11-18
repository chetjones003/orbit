// GraphQL resolvers for the fake GitHub server: the Repository, pull request, review, and Projects v2
// types the app queries and mutates, built on the store. Mutations change the store, so a write is read
// back by the next query exactly as it would be on GitHub.
import { createExecutor } from './graphql.mjs';
import { renderBody } from './views.mjs';
import { LOGIN } from './data.mjs';

const ABSTRACTS = {
  ProjectV2FieldCommon: new Set(['ProjectV2Field', 'ProjectV2SingleSelectField', 'ProjectV2IterationField'])
};

/** GraphQL enum state for an item: OPEN, CLOSED, or MERGED for pull requests. */
export function graphqlState(item) {
  if (item.kind === 'pull' && item.merged_at) return 'MERGED';
  return item.state === 'closed' ? 'CLOSED' : 'OPEN';
}

/** Every node id in the store, so a mutation or node query can find its object. */
function indexNodes(store) {
  const byId = new Map();
  for (const item of store.items.values()) byId.set(item.node_id, { kind: 'item', item });
  for (const [key, threads] of store.threads) {
    for (const thread of threads) byId.set(thread.node_id, { kind: 'thread', key, thread });
  }
  for (const [key, reviews] of store.reviews) {
    for (const review of reviews) byId.set(review.node_id, { kind: 'review', key, review });
  }
  for (const project of store.projects) {
    byId.set(project.id, { kind: 'project', project });
    for (const pitem of project.items) byId.set(pitem.id, { kind: 'projectItem', project, pitem });
  }
  return byId;
}

/** A GitHub connection: `{ totalCount, nodes, pageInfo }`. */
function connection(nodes) {
  return { totalCount: nodes.length, nodes, pageInfo: { hasNextPage: false, endCursor: null } };
}

/**
 * The Projects filter syntax the fake supports: `field:value`, `field:v1,v2`, `field:"multi word"`,
 * `-field:value` to negate, `is:state`, and free text in titles.
 */
export function parseFilter(text) {
  const clauses = { fields: [], text: [] };
  const fieldPattern = /(-?)([A-Za-z][A-Za-z ]*?):("[^"]*"|[^\s"]+)/g;
  let rest = text;
  for (const match of text.matchAll(fieldPattern)) {
    const raw = match[3].replace(/^"|"$/g, '');
    clauses.fields.push({
      negate: match[1] === '-',
      name: match[2].trim().toLowerCase(),
      values: raw.split(',').map((v) => v.trim().toLowerCase())
    });
    rest = rest.replace(match[0], ' ');
  }
  clauses.text = rest
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  return clauses;
}

/** The display value of a field value, as the filter compares it. */
function displayValue(field, value) {
  switch (value.kind) {
    case 'single-select':
      return field.options.find((o) => o.id === value.optionId)?.name ?? '';
    case 'iteration':
      return field.configuration.iterations.find((i) => i.id === value.iterationId)?.title ?? '';
    case 'text':
      return value.text;
    case 'number':
      return String(value.number);
    case 'date':
      return value.date;
    default:
      return '';
  }
}

function itemMatches(store, project, pitem, clauses) {
  for (const clause of clauses.fields) {
    const item = pitem.key ? store.items.get(pitem.key) : null;
    let hit;
    if (clause.name === 'is') {
      const state = item ? graphqlState(item).toLowerCase() : 'open';
      hit = clause.values.includes(state);
    } else {
      const field = project.fields.find((f) => f.name.toLowerCase() === clause.name);
      if (!field) return false;
      const value = pitem.values[field.id];
      const shown = value ? displayValue(field, value).toLowerCase() : '';
      hit = clause.values.includes(shown);
    }
    if (hit === clause.negate) return false;
  }
  const title = itemTitle(store, pitem);
  return clauses.text.every((word) => title.toLowerCase().includes(word));
}

function itemTitle(store, pitem) {
  return pitem.key ? (store.items.get(pitem.key)?.title ?? '') : (pitem.draftTitle ?? '');
}

/** Builds the GraphQL endpoint for a store. */
export function createGraphQL(store) {
  const byNodeId = () => indexNodes(store);

  const projectItemsOf = (key) => {
    const out = [];
    for (const project of store.projects) {
      for (const pitem of project.items) if (pitem.key === key) out.push({ project, pitem });
    }
    return out;
  };

  // -- Node builders. Each returns an object tagged with __typename, so inline fragments match. --------

  const projectNode = (project) => ({
    __typename: 'ProjectV2',
    id: project.id,
    number: project.number,
    title: project.title,
    url: project.url,
    closed: project.closed,
    _project: project
  });

  const fieldNode = (project, field) => ({
    __typename:
      field.dataType === 'SINGLE_SELECT'
        ? 'ProjectV2SingleSelectField'
        : field.dataType === 'ITERATION'
          ? 'ProjectV2IterationField'
          : 'ProjectV2Field',
    id: field.id,
    name: field.name,
    dataType: field.dataType,
    options: field.options,
    configuration: field.configuration,
    _project: project
  });

  const viewNode = (project, view) => ({
    __typename: 'ProjectV2View',
    id: view.id,
    name: view.name,
    number: view.number,
    layout: view.layout,
    filter: view.filter,
    groupBy: view.groupBy,
    _project: project
  });

  const projectItemNode = (project, pitem) => {
    const item = pitem.key ? store.items.get(pitem.key) : null;
    const type = item === null ? 'DRAFT_ISSUE' : item.kind === 'pull' ? 'PULL_REQUEST' : 'ISSUE';
    return { __typename: 'ProjectV2Item', id: pitem.id, type, _project: project, _pitem: pitem, _item: item };
  };

  const valueNode = (project, value) => {
    const field = project.fields.find((f) => f.id === value.fieldId);
    const fieldRef = fieldNode(project, field);
    switch (value.kind) {
      case 'single-select':
        return {
          __typename: 'ProjectV2ItemFieldSingleSelectValue',
          optionId: value.optionId,
          name: displayValue(field, value),
          field: fieldRef
        };
      case 'iteration': {
        const it = field.configuration.iterations.find((i) => i.id === value.iterationId);
        return {
          __typename: 'ProjectV2ItemFieldIterationValue',
          iterationId: value.iterationId,
          title: it?.title ?? '',
          startDate: it?.startDate ?? '',
          duration: it?.duration ?? 14,
          field: fieldRef
        };
      }
      case 'text':
        return { __typename: 'ProjectV2ItemFieldTextValue', text: value.text, field: fieldRef };
      case 'number':
        return { __typename: 'ProjectV2ItemFieldNumberValue', number: value.number, field: fieldRef };
      case 'date':
        return { __typename: 'ProjectV2ItemFieldDateValue', date: value.date, field: fieldRef };
      default:
        return null;
    }
  };

  const contentNode = (item) => {
    const base = { ...item, id: item.node_id, state: graphqlState(item), _item: item };
    return item.kind === 'pull' ? { ...base, __typename: 'PullRequest' } : { ...base, __typename: 'Issue' };
  };

  const threadNode = (key, thread) => ({
    __typename: 'PullRequestReviewThread',
    id: thread.node_id,
    isResolved: thread.isResolved,
    isOutdated: thread.isOutdated,
    path: thread.path,
    line: thread.line,
    originalLine: thread.originalLine,
    diffSide: thread.diffSide,
    _key: key,
    _thread: thread
  });

  const commentNode = (thread, c) => ({
    __typename: 'PullRequestReviewComment',
    fullDatabaseId: String(c.id),
    author: { login: c.user },
    body: c.body,
    bodyHTML: renderBody(c.body, ''),
    createdAt: c.createdAt ?? c.created_at,
    url: `https://github.com/${LOGIN}/comment-${c.id}`,
    diffHunk: thread._thread.diffHunk ?? '',
    state: c.state ?? 'SUBMITTED',
    path: thread.path,
    line: thread.line
  });

  const reviewNode = (key, review) => ({
    __typename: 'PullRequestReview',
    id: review.node_id,
    body: review.body ?? '',
    state: review.state,
    author: { login: review.user },
    commit: { oid: review.commit_id },
    _key: key,
    _review: review
  });

  // -- Field resolvers, by type. -------------------------------------------------------------------------

  const labelsOf = (parent) =>
    connection((parent._item.labels ?? []).map((label) => ({ name: label.name, color: label.color })));

  const pullResolvers = {
    labels: labelsOf,
    headRefOid: (parent) => parent._item.head.sha,
    isDraft: (parent) => parent._item.draft,
    autoMergeRequest: (parent) => (parent._item.auto_merge ? { mergeMethod: parent._item.auto_merge } : null),
    reviews: (parent, args) => {
      let list = store.reviews.get(parent._item.key);
      if (args.states) list = list.filter((r) => args.states.includes(r.state));
      if (args.last) list = list.slice(-args.last);
      return connection(list.map((r) => reviewNode(parent._item.key, r)));
    },
    reviewThreads: (parent) =>
      connection(store.threads.get(parent._item.key).map((t) => threadNode(parent._item.key, t))),
    projectItems: (parent) =>
      connection(projectItemsOf(parent._item.key).map((p) => projectItemNode(p.project, p.pitem)))
  };

  const resolvers = {
    Query: {
      viewer: () => ({ __typename: 'User', login: LOGIN }),
      node: (_parent, args) => {
        const found = byNodeId().get(args.id);
        if (!found) return null;
        switch (found.kind) {
          case 'project':
            return projectNode(found.project);
          case 'projectItem':
            return projectItemNode(found.project, found.pitem);
          case 'item':
            return contentNode(found.item);
          case 'thread':
            return threadNode(found.key, found.thread);
          case 'review':
            return reviewNode(found.key, found.review);
          default:
            return null;
        }
      },
      repository: (_parent, args) => {
        const repo = store.repos.find((r) => r.full_name === `${args.owner}/${args.name}`);
        return repo
          ? { __typename: 'Repository', name: repo.name, nameWithOwner: repo.full_name, _repo: repo }
          : null;
      }
    },
    User: {
      projectsV2: () => connection(store.projects.map(projectNode))
    },
    Repository: {
      pullRequest: (parent, args) => {
        const item = parent._repo.items.find((i) => i.number === args.number && i.kind === 'pull');
        return item ? contentNode(item) : null;
      },
      issueOrPullRequest: (parent, args) => {
        const item = parent._repo.items.find((i) => i.number === args.number);
        return item ? contentNode(item) : null;
      }
    },
    ProjectV2: {
      fields: (parent) => connection(parent._project.fields.map((f) => fieldNode(parent._project, f))),
      views: (parent) => connection(parent._project.views.map((v) => viewNode(parent._project, v))),
      items: (parent, args) => {
        const project = parent._project;
        const clauses = parseFilter(args.query ?? '');
        const matching = project.items.filter((pitem) => itemMatches(store, project, pitem, clauses));
        const start = args.after ? Number(String(args.after).replace('c:', '')) + 1 : 0;
        const first = args.first ?? 100;
        const page = matching.slice(start, start + first);
        return {
          totalCount: matching.length,
          nodes: page.map((pitem) => projectItemNode(project, pitem)),
          pageInfo: {
            hasNextPage: start + first < matching.length,
            endCursor: page.length ? `c:${start + page.length - 1}` : null
          }
        };
      }
    },
    ProjectV2View: {
      groupByFields: (parent) => {
        const field = parent._project.fields.find((f) => f.id === parent.groupBy);
        return connection(field ? [fieldNode(parent._project, field)] : []);
      }
    },
    ProjectV2Item: {
      fieldValues: (parent) =>
        connection(
          Object.values(parent._pitem.values)
            .map((v) => valueNode(parent._project, v))
            .filter(Boolean)
        ),
      content: (parent) =>
        parent._item
          ? contentNode(parent._item)
          : { __typename: 'DraftIssue', id: parent._pitem.id, title: parent._pitem.draftTitle },
      project: (parent) => projectNode(parent._project)
    },
    Issue: {
      labels: labelsOf,
      url: (parent) =>
        `${store.repos.find((r) => r.name === parent._item.repo).html_url}/issues/${parent._item.number}`,
      repository: (parent) => ({
        nameWithOwner: store.repos.find((r) => r.name === parent._item.repo).full_name
      }),
      projectItems: (parent) =>
        connection(projectItemsOf(parent._item.key).map((p) => projectItemNode(p.project, p.pitem)))
    },
    PullRequest: {
      ...pullResolvers,
      url: (parent) =>
        `${store.repos.find((r) => r.name === parent._item.repo).html_url}/pull/${parent._item.number}`,
      repository: (parent) => ({
        nameWithOwner: store.repos.find((r) => r.name === parent._item.repo).full_name
      })
    },
    PullRequestReviewThread: {
      comments: (parent) => connection(parent._thread.comments.map((c) => commentNode(parent, c)))
    }
  };

  // -- Mutations. ----------------------------------------------------------------------------------------

  const setThreadResolved = (threadId, resolved) => {
    const found = byNodeId().get(threadId);
    if (!found || found.kind !== 'thread') throw new Error('Could not resolve to a review thread');
    found.thread.isResolved = resolved;
    return { thread: { id: found.thread.node_id, isResolved: resolved } };
  };

  const mutations = {
    addPullRequestReview: (_parent, args) => {
      const found = byNodeId().get(args.input.pullRequestId);
      if (!found || found.kind !== 'item') throw new Error('Could not resolve to a pull request');
      const review = {
        id: store.nextId++,
        node_id: `PRR_${store.nextId++}`,
        user: LOGIN,
        state: 'PENDING',
        body: '',
        submitted_at: null,
        commit_id: args.input.commitOID
      };
      store.reviews.get(found.item.key).push(review);
      return { pullRequestReview: { id: review.node_id, commit: { oid: review.commit_id } } };
    },
    addPullRequestReviewThread: (_parent, args) => {
      const input = args.input;
      const found = byNodeId().get(input.pullRequestReviewId);
      if (!found || found.kind !== 'review') throw new Error('Could not resolve to a pull request review');
      const thread = {
        node_id: `PRRT_${store.nextId++}`,
        path: input.path,
        line: input.line,
        originalLine: input.line,
        diffSide: input.side,
        isResolved: false,
        isOutdated: false,
        diffHunk: '',
        comments: [
          {
            id: store.nextId++,
            user: LOGIN,
            body: input.body,
            createdAt: new Date().toISOString(),
            state: 'PENDING',
            reviewId: found.review.id
          }
        ]
      };
      store.threads.get(found.key).push(thread);
      return { thread: threadNode(found.key, thread) };
    },
    addPullRequestReviewThreadReply: (_parent, args) => {
      const input = args.input;
      const found = byNodeId().get(input.pullRequestReviewThreadId);
      if (!found || found.kind !== 'thread') throw new Error('Could not resolve to a review thread');
      const pending = input.pullRequestReviewId ? byNodeId().get(input.pullRequestReviewId) : null;
      const comment = {
        id: store.nextId++,
        user: LOGIN,
        body: input.body,
        createdAt: new Date().toISOString(),
        state: 'PENDING',
        reviewId: pending?.review?.id ?? null
      };
      found.thread.comments.push(comment);
      return { comment: commentNode(threadNode(found.key, found.thread), comment) };
    },
    resolveReviewThread: (_parent, args) => setThreadResolved(args.input.threadId, true),
    unresolveReviewThread: (_parent, args) => setThreadResolved(args.input.threadId, false),
    submitPullRequestReview: (_parent, args) => {
      const input = args.input;
      const found = byNodeId().get(input.pullRequestReviewId);
      if (!found || found.kind !== 'review') throw new Error('Could not resolve to a pull request review');
      const state =
        { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED', COMMENT: 'COMMENTED' }[input.event] ??
        'COMMENTED';
      found.review.state = state;
      found.review.body = input.body ?? '';
      found.review.submitted_at = new Date().toISOString();
      for (const thread of store.threads.get(found.key)) {
        for (const c of thread.comments) if (c.reviewId === found.review.id) c.state = 'SUBMITTED';
      }
      return { pullRequestReview: { id: found.review.node_id, state } };
    },
    enablePullRequestAutoMerge: (_parent, args) => {
      const found = byNodeId().get(args.input.pullRequestId);
      found.item.auto_merge = args.input.mergeMethod ?? 'MERGE';
      return { pullRequest: { id: found.item.node_id } };
    },
    disablePullRequestAutoMerge: (_parent, args) => {
      const found = byNodeId().get(args.input.pullRequestId);
      found.item.auto_merge = null;
      return { pullRequest: { id: found.item.node_id } };
    },
    convertPullRequestToDraft: (_parent, args) => {
      const found = byNodeId().get(args.input.pullRequestId);
      found.item.draft = true;
      return { pullRequest: { id: found.item.node_id } };
    },
    markPullRequestReadyForReview: (_parent, args) => {
      const found = byNodeId().get(args.input.pullRequestId);
      found.item.draft = false;
      return { pullRequest: { id: found.item.node_id } };
    },
    addProjectV2ItemById: (_parent, args) => {
      const project = store.projects.find((p) => p.id === args.input.projectId);
      const content = [...store.items.values()].find((i) => i.node_id === args.input.contentId);
      if (!project || !content) throw new Error('Could not resolve to a node');
      if (project.items.some((p) => p.key === content.key))
        throw new Error('That item is already in the project');
      const id = `PVTI_${store.nextId++}`;
      project.items.push({ id, key: content.key, draftTitle: null, values: {} });
      return { item: { id } };
    },
    deleteProjectV2Item: (_parent, args) => {
      const project = store.projects.find((p) => p.id === args.input.projectId);
      if (!project) throw new Error('Could not resolve to a node');
      project.items = project.items.filter((p) => p.id !== args.input.itemId);
      return { deletedItemId: args.input.itemId };
    },
    updateProjectV2ItemPosition: (_parent, args) => {
      const project = store.projects.find((p) => p.id === args.input.projectId);
      return { items: { totalCount: project ? project.items.length : 0 } };
    },
    updateProjectV2ItemFieldValue: (_parent, args) => {
      const input = args.input;
      const found = byNodeId().get(input.itemId);
      const project = store.projects.find((p) => p.id === input.projectId);
      const field = project?.fields.find((f) => f.id === input.fieldId);
      if (!found || found.kind !== 'projectItem' || !field) throw new Error('Could not resolve to a node');
      const value = input.value ?? {};
      const set = (next) => {
        found.pitem.values[field.id] = { fieldId: field.id, ...next };
      };
      if (value.singleSelectOptionId !== undefined)
        set({ kind: 'single-select', optionId: value.singleSelectOptionId });
      else if (value.iterationId !== undefined) set({ kind: 'iteration', iterationId: value.iterationId });
      else if (value.text !== undefined) set({ kind: 'text', text: value.text });
      else if (value.number !== undefined) set({ kind: 'number', number: value.number });
      else if (value.date !== undefined) set({ kind: 'date', date: value.date });
      return { projectV2Item: { id: found.pitem.id } };
    },
    clearProjectV2ItemFieldValue: (_parent, args) => {
      const input = args.input;
      const found = byNodeId().get(input.itemId);
      if (!found || found.kind !== 'projectItem') throw new Error('Could not resolve to a node');
      delete found.pitem.values[input.fieldId];
      return { projectV2Item: { id: found.pitem.id } };
    }
  };

  resolvers.Mutation = mutations;
  return createExecutor({ resolvers, abstracts: ABSTRACTS });
}
