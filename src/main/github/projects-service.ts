import {
  PROJECT_FIELD_VALUES_PER_ITEM,
  PROJECT_ITEMS_PAGE_LIMIT,
  PROJECT_ITEMS_PAGE_SIZE,
  isProjectNodeId,
  projectValueMatches,
  type IterationOption,
  type ItemMemberships,
  type ProjectDetail,
  type ProjectField,
  type ProjectFieldChange,
  type ProjectFieldInput,
  type ProjectFieldValue,
  type ProjectItem,
  type ProjectItemEditResult,
  type ProjectItemsPage,
  type ProjectListPage,
  type ProjectMembership,
  type ProjectSavedView,
  type ProjectSummary,
  type SingleSelectOption
} from '../../shared/projects';
import type { AuthService } from './auth-service';
import { GitHubClient } from './github-client';
import { runWrite } from './write-reconcile';

const PROJECTS_PER_PAGE = 100;
const FIELDS_PER_PROJECT = 100;
const VIEWS_PER_PROJECT = 50;
const MEMBERSHIPS_PER_ITEM = 20;
const MAX_FILTER_CHARS = 1000;
const REPO_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** Fields shared by every custom field selection. `dataType` tells Orbit which custom field this is. */
const FIELD_SELECTION = `
  __typename
  ... on ProjectV2FieldCommon { id name dataType }
  ... on ProjectV2SingleSelectField { options { id name color } }
  ... on ProjectV2IterationField { configuration { iterations { id title startDate duration } } }
`;

const PROJECT_SELECTION = 'id number title url closed';

const VALUE_SELECTION = `
  __typename
  ... on ProjectV2ItemFieldSingleSelectValue { optionId name field { ... on ProjectV2FieldCommon { id } } }
  ... on ProjectV2ItemFieldIterationValue { iterationId title startDate duration field { ... on ProjectV2FieldCommon { id } } }
  ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { id } } }
  ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { id } } }
  ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { id } } }
`;

/** Everything Orbit needs about an item. The content is an issue, a pull request, or a draft. */
const ITEM_SELECTION = `
  id
  type
  content {
    __typename
    ... on Issue { id number title url state repository { nameWithOwner } }
    ... on PullRequest { id number title url state isDraft repository { nameWithOwner } }
    ... on DraftIssue { id title }
  }
  fieldValues(first: ${PROJECT_FIELD_VALUES_PER_ITEM}) { nodes { ${VALUE_SELECTION} } }
`;

const LIST_PROJECTS = `
query {
  viewer { projectsV2(first: ${PROJECTS_PER_PAGE}) { totalCount nodes { ${PROJECT_SELECTION} } } }
}`;

const PROJECT_DETAIL = `
query($id: ID!) {
  node(id: $id) {
    ... on ProjectV2 {
      ${PROJECT_SELECTION}
      fields(first: ${FIELDS_PER_PROJECT}) { nodes { ${FIELD_SELECTION} } }
      views(first: ${VIEWS_PER_PROJECT}) {
        nodes { id name number layout filter groupByFields(first: 1) { nodes { ... on ProjectV2FieldCommon { id } } } }
      }
    }
  }
}`;

const PROJECT_ITEMS = `
query($id: ID!, $query: String, $cursor: String) {
  node(id: $id) {
    ... on ProjectV2 {
      items(first: ${PROJECT_ITEMS_PAGE_SIZE}, after: $cursor, query: $query) {
        pageInfo { hasNextPage endCursor }
        nodes { ${ITEM_SELECTION} }
      }
    }
  }
}`;

const ITEM_BY_ID = `
query($id: ID!) {
  node(id: $id) {
    ... on ProjectV2Item { ${ITEM_SELECTION} project { id } }
  }
}`;

const ITEM_MEMBERSHIPS = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on Issue { id projectItems(first: ${MEMBERSHIPS_PER_ITEM}) { totalCount nodes { ${ITEM_SELECTION} project { ${PROJECT_SELECTION} } } } }
      ... on PullRequest { id projectItems(first: ${MEMBERSHIPS_PER_ITEM}) { totalCount nodes { ${ITEM_SELECTION} project { ${PROJECT_SELECTION} } } } }
    }
  }
}`;

const CONTENT_ID = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on Issue { id }
      ... on PullRequest { id }
    }
  }
}`;

const ADD_ITEM = `
mutation($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } }
}`;

const DELETE_ITEM = `
mutation($projectId: ID!, $itemId: ID!) {
  deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) { deletedItemId }
}`;

const UPDATE_VALUE = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
  updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }) {
    projectV2Item { id }
  }
}`;

const CLEAR_VALUE = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
  clearProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId }) {
    projectV2Item { id }
  }
}`;

export interface ProjectsServiceOptions {
  auth: Pick<AuthService, 'getStatus' | 'getAccessToken'>;
  apiBaseUrl: string;
  /** Shared client. Created internally when omitted. */
  client?: GitHubClient;
  fetch?: typeof fetch;
  /** False while GitHub is unreachable or rate limiting. Writes are refused before any request. */
  canWrite?: () => boolean;
}

/**
 * Reads and edits the signed-in account's own Projects (v2) through GitHub's GraphQL API. Nothing is
 * persisted. Each item has at most one pending edit; a second request for it is refused as busy.
 */
export class ProjectsService {
  private readonly auth: ProjectsServiceOptions['auth'];
  private readonly client: GitHubClient;
  private readonly canWrite: () => boolean;
  private readonly pending = new Set<string>();

  constructor(options: ProjectsServiceOptions) {
    this.auth = options.auth;
    this.client =
      options.client ?? new GitHubClient({ apiBaseUrl: options.apiBaseUrl, fetch: options.fetch });
    this.canWrite = options.canWrite ?? (() => true);
  }

  /** The projects the signed-in account owns. */
  async listProjects(): Promise<ProjectListPage> {
    const { token, scope } = await this.session();
    const data = await this.graphql<{ viewer?: { projectsV2?: { totalCount?: unknown; nodes?: unknown } } }>(
      LIST_PROJECTS,
      {},
      token,
      scope
    );
    const connection = data.viewer?.projectsV2;
    const nodes = Array.isArray(connection?.nodes) ? (connection.nodes as unknown[]) : [];
    const projects = nodes.map(toProjectSummary).filter((p): p is ProjectSummary => p !== null);
    const total = typeof connection?.totalCount === 'number' ? connection.totalCount : nodes.length;
    return { projects, partial: total > projects.length || projects.length < nodes.length };
  }

  /** A project's custom fields and its table and board saved views. */
  async getProject(projectId: string): Promise<ProjectDetail> {
    assertNodeId(projectId);
    const { token, scope } = await this.session();
    const data = await this.graphql<{ node?: Record<string, unknown> | null }>(
      PROJECT_DETAIL,
      { id: projectId },
      token,
      scope
    );
    const node = data.node;
    const project = node ? toProjectSummary(node) : null;
    if (!node || !project) throw new Error('That project is not available.');
    const fields = nodesOf(node['fields'])
      .map(toField)
      .filter((f): f is ProjectField => f !== null);
    const views = nodesOf(node['views'])
      .map(toSavedView)
      .filter((v): v is ProjectSavedView => v !== null);
    return { project, fields, views };
  }

  /**
   * Items matching a saved view's filter, read page by page. GitHub applies the filter itself, so an empty
   * filter returns every item. Stops at the page limit and reports the result as partial.
   */
  async listItems(projectId: string, filter: string): Promise<ProjectItemsPage> {
    assertNodeId(projectId);
    if (typeof filter !== 'string' || filter.length > MAX_FILTER_CHARS)
      throw new Error('That filter is not valid.');
    const { token, scope } = await this.session();
    const items: ProjectItem[] = [];
    let partial = false;
    let cursor: string | null = null;
    for (let page = 1; page <= PROJECT_ITEMS_PAGE_LIMIT; page++) {
      const data = await this.graphql<{ node?: { items?: { pageInfo?: unknown; nodes?: unknown } } | null }>(
        PROJECT_ITEMS,
        { id: projectId, query: filter === '' ? null : filter, cursor },
        token,
        scope
      );
      const connection = data.node?.items;
      if (!connection) throw new Error('That project is not available.');
      for (const raw of nodesOf(connection)) {
        const item = toProjectItem(raw);
        if (item) items.push(item);
        else partial = true;
      }
      const pageInfo = connection.pageInfo as { hasNextPage?: unknown; endCursor?: unknown } | undefined;
      if (pageInfo?.hasNextPage !== true) return { items, partial };
      if (typeof pageInfo.endCursor !== 'string') return { items, partial: true };
      cursor = pageInfo.endCursor;
      if (page === PROJECT_ITEMS_PAGE_LIMIT) partial = true;
    }
    return { items, partial };
  }

  /** The issue or pull request's id and the projects it is in. */
  async getItemMemberships(repoFullName: string, number: number): Promise<ItemMemberships> {
    const { owner, name } = parseRepoFullName(repoFullName);
    assertIssueNumber(number);
    const { token, scope } = await this.session();
    const data = await this.graphql<{
      repository?: {
        issueOrPullRequest?: {
          id?: unknown;
          projectItems?: { totalCount?: unknown; nodes?: unknown };
        } | null;
      } | null;
    }>(ITEM_MEMBERSHIPS, { owner, name, number }, token, scope);
    const content = data.repository?.issueOrPullRequest;
    if (!content || typeof content.id !== 'string')
      throw new Error('That issue or pull request is not available.');
    const memberships: ProjectMembership[] = [];
    for (const raw of nodesOf(content.projectItems)) {
      const item = toProjectItem(raw);
      const project = toProjectSummary((raw as { project?: unknown }).project);
      if (item && project) memberships.push({ project, item });
    }
    const total = typeof content.projectItems?.totalCount === 'number' ? content.projectItems.totalCount : 0;
    return {
      contentId: content.id,
      memberships,
      partial: total > MEMBERSHIPS_PER_ITEM || memberships.length < nodesOf(content.projectItems).length
    };
  }

  /**
   * Adds an issue or pull request from one of the user's personal repos to a project. A transient failure is
   * checked against the project's items before any retry, so the item is never added twice.
   */
  async addItem(projectId: string, repoFullName: string, number: number): Promise<ProjectItem> {
    assertNodeId(projectId);
    const { owner, name } = parseRepoFullName(repoFullName);
    assertIssueNumber(number);
    const status = this.auth.getStatus();
    if (status.kind === 'signed-in' && owner.toLowerCase() !== status.login.toLowerCase()) {
      throw new Error('Only personal repos, owned by the signed-in account, can be added to a project.');
    }
    const lockKey = `add\u0000${projectId}\u0000${repoFullName}#${number}`;
    if (this.pending.has(lockKey)) throw new Error('This item is already being added to the project.');
    this.pending.add(lockKey);
    try {
      const { token, scope } = await this.session();
      const contentId = await this.contentIdOf(owner, name, number, token, scope);
      const itemId = await runWrite<string>({
        canWrite: this.canWrite,
        attempt: async () => {
          const data = await this.graphql<{ addProjectV2ItemById?: { item?: { id?: unknown } } }>(
            ADD_ITEM,
            { projectId, contentId },
            token,
            scope
          );
          const id = data.addProjectV2ItemById?.item?.id;
          if (typeof id !== 'string') throw new Error('GitHub returned an invalid project item.');
          return id;
        },
        reconcile: async () => {
          const found = await this.getItemMemberships(repoFullName, number);
          const membership = found.memberships.find((m) => m.project.id === projectId);
          return membership ? { applied: true, value: membership.item.id } : { applied: false };
        }
      });
      const item = await this.readItem(itemId, token, scope);
      if (!item) throw new Error('GitHub did not return the added item.');
      return item;
    } finally {
      this.pending.delete(lockKey);
    }
  }

  /** Removes an item from its project. The item stays in GitHub; only the project membership goes. */
  async removeItem(projectId: string, itemId: string): Promise<void> {
    assertNodeId(projectId);
    assertNodeId(itemId);
    if (this.pending.has(itemId)) throw new Error('This item already has a change in progress.');
    this.pending.add(itemId);
    try {
      const { token, scope } = await this.session();
      await runWrite<void>({
        canWrite: this.canWrite,
        attempt: async () => {
          await this.graphql(DELETE_ITEM, { projectId, itemId }, token, scope);
        },
        reconcile: async () =>
          (await this.readItem(itemId, token, scope)) === null
            ? { applied: true, value: undefined }
            : { applied: false }
      });
    } finally {
      this.pending.delete(itemId);
    }
  }

  /**
   * Sets one field on an item, or clears it. Returns GitHub's version of the item whether or not the save
   * succeeded, so the view shows what actually saved. Only one edit per item runs at a time.
   */
  async setFieldValue(
    projectId: string,
    itemId: string,
    change: ProjectFieldChange
  ): Promise<ProjectItemEditResult> {
    assertNodeId(projectId);
    assertNodeId(itemId);
    assertNodeId(change.fieldId);
    if (this.pending.has(itemId)) return { kind: 'busy' };
    this.pending.add(itemId);
    let session: { token: string; scope: string } | null = null;
    try {
      const current = await this.session();
      session = current;
      await runWrite<void>({
        canWrite: this.canWrite,
        attempt: () => this.sendFieldWrite(projectId, itemId, change, current.token, current.scope),
        reconcile: async () => {
          const stored = await this.readItem(itemId, current.token, current.scope);
          return projectValueMatches(stored?.fieldValues[change.fieldId], change.value)
            ? { applied: true, value: undefined }
            : { applied: false };
        }
      });
      const item = await this.readItem(itemId, current.token, current.scope);
      if (!item) return { kind: 'failed', item: null, message: 'That item is no longer in the project.' };
      return { kind: 'saved', item };
    } catch (error) {
      // A failed or uncertain save: read GitHub's version so the view shows what is actually stored.
      const item = session
        ? await this.readItem(itemId, session.token, session.scope).catch(() => null)
        : null;
      return { kind: 'failed', item, message: messageOf(error, 'GitHub could not save this change.') };
    } finally {
      this.pending.delete(itemId);
    }
  }

  private async sendFieldWrite(
    projectId: string,
    itemId: string,
    change: ProjectFieldChange,
    token: string,
    scope: string
  ): Promise<void> {
    if (change.value === null) {
      await this.graphql(CLEAR_VALUE, { projectId, itemId, fieldId: change.fieldId }, token, scope);
      return;
    }
    await this.graphql(
      UPDATE_VALUE,
      { projectId, itemId, fieldId: change.fieldId, value: valueVariable(change.value) },
      token,
      scope
    );
  }

  /** One item by node id, or null when GitHub no longer has it. */
  private async readItem(itemId: string, token: string, scope: string): Promise<ProjectItem | null> {
    const data = await this.graphql<{ node?: Record<string, unknown> | null }>(
      ITEM_BY_ID,
      { id: itemId },
      token,
      scope
    );
    return data.node ? toProjectItem(data.node) : null;
  }

  private async contentIdOf(
    owner: string,
    name: string,
    number: number,
    token: string,
    scope: string
  ): Promise<string> {
    const data = await this.graphql<{
      repository?: { issueOrPullRequest?: { id?: unknown } | null } | null;
    }>(CONTENT_ID, { owner, name, number }, token, scope);
    const id = data.repository?.issueOrPullRequest?.id;
    if (typeof id !== 'string') throw new Error('That issue or pull request was not found.');
    return id;
  }

  private async session(): Promise<{ token: string; scope: string }> {
    const status = this.auth.getStatus();
    if (status.kind !== 'signed-in') throw new Error('Sign in to GitHub to load projects.');
    return { token: await this.auth.getAccessToken(), scope: String(status.sessionId) };
  }

  /** GraphQL reports some failures inside a 200 response. Any error means GitHub refused the request. */
  private async graphql<T = unknown>(
    query: string,
    variables: Record<string, unknown>,
    token: string,
    scope: string
  ): Promise<T> {
    const response = await this.client.send<{ data?: T; errors?: unknown } | null>('POST', '/graphql', {
      token,
      scope,
      body: { query, variables }
    });
    if (Array.isArray(response?.errors) && response.errors.length > 0) {
      throw new Error('GitHub refused the project request.');
    }
    return (response?.data ?? {}) as T;
  }
}

function assertNodeId(value: unknown): asserts value is string {
  if (!isProjectNodeId(value)) throw new Error('That project item is not valid.');
}

function assertIssueNumber(value: unknown): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 2_147_483_647) {
    throw new Error('That issue number is not valid.');
  }
}

/** Personal repos only: the owner must be the signed-in account. Items from other repos still show when a project has them. */
function parseRepoFullName(repoFullName: string): { owner: string; name: string } {
  const parts = typeof repoFullName === 'string' ? repoFullName.split('/') : [];
  const [owner, name] = parts;
  if (parts.length !== 2 || !owner || !name || !LOGIN_PATTERN.test(owner) || !REPO_NAME_PATTERN.test(name)) {
    throw new Error('Choose a repository as owner/name.');
  }
  return { owner, name };
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function valueVariable(value: ProjectFieldInput): Record<string, unknown> {
  switch (value.kind) {
    case 'single-select':
      return { singleSelectOptionId: value.optionId };
    case 'iteration':
      return { iterationId: value.iterationId };
    case 'text':
      return { text: value.text };
    case 'number':
      return { number: value.number };
    case 'date':
      return { date: value.date };
  }
}

function nodesOf(connection: unknown): unknown[] {
  const nodes = (connection as { nodes?: unknown } | null | undefined)?.nodes;
  return Array.isArray(nodes) ? nodes : [];
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function toProjectSummary(raw: unknown): ProjectSummary | null {
  const node = obj(raw);
  if (!node) return null;
  const id = str(node['id']);
  const title = str(node['title']);
  const url = str(node['url']);
  if (!id || !title || !url || typeof node['number'] !== 'number') return null;
  return { id, number: node['number'], title, url, closed: node['closed'] === true };
}

function toField(raw: unknown): ProjectField | null {
  const node = obj(raw);
  const id = str(node?.['id']);
  const name = str(node?.['name']);
  if (!node || !id || !name) return null;
  switch (node['dataType']) {
    case 'SINGLE_SELECT': {
      // `options` is a plain list in GitHub's schema, not a connection.
      const options = listOf(node['options'])
        .map(toOption)
        .filter((o): o is SingleSelectOption => o !== null);
      return { id, name, kind: 'single-select', options };
    }
    case 'ITERATION': {
      const iterations = listOf(obj(node['configuration'])?.['iterations'])
        .map(toIteration)
        .filter((i): i is IterationOption => i !== null);
      return { id, name, kind: 'iteration', iterations };
    }
    case 'TEXT':
      return { id, name, kind: 'text' };
    case 'NUMBER':
      return { id, name, kind: 'number' };
    case 'DATE':
      return { id, name, kind: 'date' };
    default:
      // Built-in fields such as Title, Labels, or Milestone are read-only and not offered.
      return null;
  }
}

function toOption(raw: unknown): SingleSelectOption | null {
  const node = obj(raw);
  const id = str(node?.['id']);
  const name = str(node?.['name']);
  if (!node || !id || !name) return null;
  return { id, name, color: str(node['color']) };
}

function toIteration(raw: unknown): IterationOption | null {
  const node = obj(raw);
  const id = str(node?.['id']);
  const title = str(node?.['title']);
  const startDate = str(node?.['startDate']);
  if (!node || !id || !title || !startDate || typeof node['duration'] !== 'number') return null;
  return { id, title, startDate, duration: node['duration'] };
}

function toSavedView(raw: unknown): ProjectSavedView | null {
  const node = obj(raw);
  const id = str(node?.['id']);
  const name = str(node?.['name']);
  if (!node || !id || !name || typeof node['number'] !== 'number') return null;
  const layout =
    node['layout'] === 'BOARD_LAYOUT' ? 'board' : node['layout'] === 'TABLE_LAYOUT' ? 'table' : null;
  if (!layout) return null;
  const groupBy = nodesOf(node['groupByFields'])[0];
  return {
    id,
    number: node['number'],
    name,
    layout,
    filter: str(node['filter']) ?? '',
    groupByFieldId: str(obj(groupBy)?.['id'])
  };
}

function toFieldValue(raw: unknown): { fieldId: string; value: ProjectFieldValue } | null {
  const node = obj(raw);
  const fieldId = str(obj(node?.['field'])?.['id']);
  if (!node || !fieldId) return null;
  switch (node['__typename']) {
    case 'ProjectV2ItemFieldSingleSelectValue': {
      const optionId = str(node['optionId']);
      return optionId
        ? { fieldId, value: { kind: 'single-select', optionId, name: str(node['name']) ?? '' } }
        : null;
    }
    case 'ProjectV2ItemFieldIterationValue': {
      const iterationId = str(node['iterationId']);
      const startDate = str(node['startDate']);
      if (!iterationId || !startDate || typeof node['duration'] !== 'number') return null;
      return {
        fieldId,
        value: {
          kind: 'iteration',
          iterationId,
          title: str(node['title']) ?? '',
          startDate,
          duration: node['duration']
        }
      };
    }
    case 'ProjectV2ItemFieldTextValue':
      return typeof node['text'] === 'string'
        ? { fieldId, value: { kind: 'text', text: node['text'] } }
        : null;
    case 'ProjectV2ItemFieldNumberValue':
      return typeof node['number'] === 'number'
        ? { fieldId, value: { kind: 'number', number: node['number'] } }
        : null;
    case 'ProjectV2ItemFieldDateValue': {
      const date = str(node['date']);
      return date ? { fieldId, value: { kind: 'date', date } } : null;
    }
    default:
      return null;
  }
}

/** Maps a GraphQL item. Returns null for redacted or unreadable items, so the caller marks the page partial. */
function toProjectItem(raw: unknown): ProjectItem | null {
  const node = obj(raw);
  const id = str(node?.['id']);
  if (!node || !id) return null;
  const content = obj(node['content']);
  const fieldValues: Record<string, ProjectFieldValue> = {};
  for (const valueNode of nodesOf(node['fieldValues'])) {
    const parsed = toFieldValue(valueNode);
    if (parsed) fieldValues[parsed.fieldId] = parsed.value;
  }
  if (node['type'] === 'DRAFT_ISSUE') {
    return {
      id,
      kind: 'draft',
      contentId: null,
      repoFullName: null,
      number: null,
      title: str(content?.['title']) ?? '',
      htmlUrl: null,
      state: 'open',
      isDraft: false,
      fieldValues
    };
  }
  const typename = content?.['__typename'];
  if (!content || (typename !== 'Issue' && typename !== 'PullRequest')) return null;
  const contentId = str(content['id']);
  const number = typeof content['number'] === 'number' ? content['number'] : null;
  const title = str(content['title']);
  const htmlUrl = str(content['url']);
  const repoFullName = str(obj(content['repository'])?.['nameWithOwner']);
  const state = content['state'];
  const mappedState =
    state === 'OPEN' ? 'open' : state === 'CLOSED' ? 'closed' : state === 'MERGED' ? 'merged' : null;
  if (!contentId || number === null || !title || !htmlUrl || !repoFullName || !mappedState) return null;
  return {
    id,
    kind: typename === 'PullRequest' ? 'pull' : 'issue',
    contentId,
    repoFullName,
    number,
    title,
    htmlUrl,
    state: mappedState,
    isDraft: typename === 'PullRequest' && content['isDraft'] === true,
    fieldValues
  };
}
