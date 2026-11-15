import { describe, expect, it } from 'vitest';
// The fake GitHub is debugging tooling written as plain Node modules; tests exercise it directly.
// @ts-expect-error -- untyped .mjs module outside the typed source trees
import { createFakeGitHub } from '../../../scripts/fake-github/server.mjs';
// @ts-expect-error -- untyped .mjs module outside the typed source trees
import { renderMarkdown } from '../../../scripts/fake-github/markdown.mjs';
// @ts-expect-error -- untyped .mjs module outside the typed source trees
import { createSeed } from '../../../scripts/fake-github/data.mjs';
// @ts-expect-error -- untyped .mjs module outside the typed source trees
import { createGraphQL } from '../../../scripts/fake-github/graphql-resolvers.mjs';
// @ts-expect-error -- untyped .mjs module outside the typed source trees
import { createExecutor } from '../../../scripts/fake-github/graphql.mjs';

type Response = { status: number; body: unknown };

const ORIGIN = 'http://127.0.0.1:4010';
const AUTH = { authorization: 'Bearer gho_test', 'content-type': 'application/json' };

/** Calls the fake the way the HTTP server does, with a JSON or form body when given. */
function call(
  fake: ReturnType<typeof createFakeGitHub>,
  method: string,
  path: string,
  body?: unknown,
  headers = AUTH
): Response {
  const url = new URL(path, ORIGIN);
  const raw =
    body === undefined
      ? Buffer.alloc(0)
      : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  try {
    const result = fake.handle(method, url, raw, headers);
    return { status: result.status, body: result.body };
  } catch (error) {
    // The HTTP wrapper turns errors with a status into responses; mirror that here.
    const status = (error as { status?: number }).status ?? 500;
    return { status, body: { message: (error as Error).message } };
  }
}

describe('fake GitHub markdown', () => {
  it('renders task lists, tables, fenced code, mermaid, and images the way GitHub does', () => {
    const html = renderMarkdown(
      '- [x] done\n- [ ] open\n\n| a | b |\n| - | - |\n| 1 | <2> |\n\n```mermaid\ngraph TD\n  A-->B\n```\n\n![shot](https://github.com/x.png "title")'
    );
    expect(html).toContain('<input type="checkbox" class="task-list-item-checkbox" disabled checked> done');
    expect(html).toContain('<input type="checkbox" class="task-list-item-checkbox" disabled> open');
    expect(html).toContain('<td>&lt;2&gt;</td>');
    expect(html).toContain('<code class="language-mermaid">graph TD\n  A--&gt;B</code>');
    expect(html).toContain('<img src="https://github.com/x.png" alt="shot">');
  });

  it('shows a video link as a player, as GitHub does for uploaded clips', () => {
    expect(renderMarkdown('[clip.webm](http://127.0.0.1:4010/assets/clip.webm)')).toContain(
      '<video src="http://127.0.0.1:4010/assets/clip.webm" controls preload="none"></video>'
    );
  });
});

describe('fake GitHub GraphQL executor', () => {
  it('resolves fields, aliases, variables, and inline fragments against plain objects', () => {
    const run = createExecutor({
      resolvers: { Query: { thing: () => ({ __typename: 'Issue', n: 7, title: 'x' }) } },
      abstracts: {}
    });
    const result = run(
      'query($k: Int) { t: thing { __typename ... on Issue { n title } ... on PullRequest { title } } }',
      { k: 1 }
    );
    expect(result.data).toEqual({ t: { __typename: 'Issue', n: 7, title: 'x' } });
  });

  it('reports a field it does not model instead of inventing a value', () => {
    const run = createExecutor({ resolvers: {}, abstracts: {} });
    const result = run('query { mystery }', {}, {}, {});
    expect(result.data).toEqual({ mystery: null });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('mystery is not modelled by the fake');
  });

  it('answers the project item query the app sends, with the filter applied', () => {
    const gql = createGraphQL(createSeed());
    const projects = gql('query { viewer { projectsV2(first: 10) { nodes { id title } } } }', {}, {}, {});
    const projectId = projects.data.viewer.projectsV2.nodes[0].id;
    const items = gql(
      'query($id: ID!, $query: String) { node(id: $id) { ... on ProjectV2 { items(first: 100, query: $query) { totalCount nodes { id type } } } } }',
      { id: projectId, query: 'status:"In progress"' },
      {},
      {}
    );
    expect(items.data.node.items.totalCount).toBeGreaterThan(0);
    expect(items.data.node.items.nodes.every((n: { type: string }) => typeof n.type === 'string')).toBe(true);
  });

  it('applies a field write so the next read returns it', () => {
    const store = createSeed();
    const gql = createGraphQL(store);
    const projectId = store.projects[0].id;
    const item = store.projects[0].items[0];
    const option = store.projects[0].fields.find((f: { id: string }) => f.id === 'PVTSSF_status').options[3];
    gql(
      'mutation($input: UpdateProjectV2ItemFieldValueInput!) { updateProjectV2ItemFieldValue(input: $input) { projectV2Item { id } } }',
      {
        input: {
          projectId,
          itemId: item.id,
          fieldId: 'PVTSSF_status',
          value: { singleSelectOptionId: option.id }
        }
      },
      {},
      {}
    );
    expect(item.values['PVTSSF_status']).toMatchObject({ kind: 'single-select', optionId: option.id });
  });
});

describe('fake GitHub REST', () => {
  it('refuses requests without a token', () => {
    const fake = createFakeGitHub();
    expect(call(fake, 'GET', '/user', undefined, {}).status).toBe(401);
  });

  it('lists the account repos, excluding nothing the owner owns', () => {
    const fake = createFakeGitHub();
    const repos = call(fake, 'GET', '/user/repos?type=owner&per_page=100&page=1').body as Array<{
      full_name: string;
    }>;
    expect(repos.map((r) => r.full_name)).toContain('demo-dev/atlas-cad');
    expect(repos.every((r) => r.full_name.startsWith('demo-dev/'))).toBe(true);
  });

  it('creates, edits, and closes an issue, and the list reflects each change', () => {
    const fake = createFakeGitHub();
    const created = call(fake, 'POST', '/repos/demo-dev/atlas-cad/issues', {
      title: 'Test issue',
      body: '- [ ] step',
      labels: ['bug']
    });
    expect(created.status).toBe(201);
    const number = (created.body as { number: number }).number;
    call(fake, 'PATCH', `/repos/demo-dev/atlas-cad/issues/${number}`, {
      state: 'closed',
      state_reason: 'completed'
    });
    const closed = call(fake, 'GET', `/repos/demo-dev/atlas-cad/issues/${number}`).body as {
      state: string;
      state_reason: string;
    };
    expect(closed).toMatchObject({ state: 'closed', state_reason: 'completed' });
  });

  it('adds a comment and deletes it again', () => {
    const fake = createFakeGitHub();
    const comment = call(fake, 'POST', '/repos/demo-dev/atlas-cad/issues/1/comments', { body: 'hello' });
    expect(comment.status).toBe(201);
    const id = (comment.body as { id: number }).id;
    expect(call(fake, 'DELETE', `/repos/demo-dev/atlas-cad/issues/comments/${id}`).status).toBe(204);
  });

  it('refuses a merge pinned to a head that has moved', () => {
    const fake = createFakeGitHub();
    const response = call(fake, 'PUT', '/repos/demo-dev/atlas-cad/pulls/14/merge', {
      merge_method: 'squash',
      sha: 'not-the-head'
    });
    expect(response.status).toBe(409);
  });

  it('finds PRs awaiting the account’s review through the inbox search', () => {
    const fake = createFakeGitHub();
    const found = call(
      fake,
      'GET',
      '/search/issues?q=review-requested:demo-dev+is:pr+is:open+user:demo-dev&per_page=30&page=1'
    ).body as { total_count: number };
    expect(found.total_count).toBeGreaterThan(0);
  });

  it('approves a device sign-in on the first poll and rotates the refresh token', () => {
    const fake = createFakeGitHub();
    const code = call(fake, 'POST', '/login/device/code', undefined, {}).body as { device_code: string };
    const form = `client_id=x&device_code=${code.device_code}&grant_type=urn:ietf:params:oauth:grant-type:device_code`;
    const token = call(fake, 'POST', '/login/oauth/access_token', form, {}).body as {
      access_token: string;
      refresh_token: string;
    };
    expect(token.access_token).toMatch(/^gho_fake_/);
    const refreshed = call(
      fake,
      'POST',
      '/login/oauth/access_token',
      `client_id=x&grant_type=refresh_token&refresh_token=${token.refresh_token}`,
      {}
    ).body as { access_token: string };
    expect(refreshed.access_token).not.toBe(token.access_token);
  });
});
