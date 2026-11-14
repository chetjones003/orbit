import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A canned response for one HTTP method and path. */
export interface FakeRoute {
  method: string;
  path: string;
  status?: number;
  body?: unknown;
}

export interface FakeGitHub {
  url: string;
  requests: Array<{ method: string; path: string }>;
  close(): Promise<void>;
}

/**
 * Controlled stand-in for the GitHub REST/GraphQL API. Integration tests point
 * the app at this server, so routine runs never touch real GitHub or credentials.
 * Unmatched requests get 404 and are still recorded so tests can assert on them.
 */
export async function startFakeGitHub(routes: FakeRoute[] = []): Promise<FakeGitHub> {
  const requests: FakeGitHub['requests'] = [];
  const server: Server = createServer((req, res) => {
    const method = req.method ?? 'GET';
    const path = req.url ?? '/';
    requests.push({ method, path });
    const route = routes.find((r) => r.method === method && r.path === path);
    res.writeHead(route?.status ?? (route ? 200 : 404), { 'content-type': 'application/json' });
    res.end(JSON.stringify(route?.body ?? { message: 'Not Found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  };
}
