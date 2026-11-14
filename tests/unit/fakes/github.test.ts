import { afterEach, describe, expect, it } from 'vitest';
import { startFakeGitHub, type FakeGitHub } from '../../fakes/github';

describe('fake GitHub server', () => {
  let fake: FakeGitHub | undefined;

  afterEach(async () => {
    await fake?.close();
    fake = undefined;
  });

  it('serves canned responses and records each request', async () => {
    fake = await startFakeGitHub([{ method: 'GET', path: '/user', body: { login: 'octocat' } }]);
    const res = await fetch(`${fake.url}/user`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ login: 'octocat' });
    expect(fake.requests).toEqual([{ method: 'GET', path: '/user' }]);
  });

  it('returns 404 for unmatched routes and still records them', async () => {
    fake = await startFakeGitHub();
    const res = await fetch(`${fake.url}/nope`);
    expect(res.status).toBe(404);
    expect(fake.requests).toEqual([{ method: 'GET', path: '/nope' }]);
  });
});
