import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A request as the fake server received it. */
export interface FakeRequestInfo {
  method: string;
  path: string;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

/** A canned response for one HTTP method and path, or a function that computes one. */
export interface FakeRoute {
  method: string;
  path: string;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  respond?: (req: FakeRequestInfo) => { status?: number; body?: unknown; headers?: Record<string, string> };
}

export interface FakeGitHub {
  url: string;
  requests: Array<{ method: string; path: string }>;
  /** Full request detail, including bodies and headers. */
  received: FakeRequestInfo[];
  close(): Promise<void>;
}

/**
 * Controlled stand-in for the GitHub REST/GraphQL API. Integration tests point
 * the app at this server, so routine runs never touch real GitHub or credentials.
 * Unmatched requests get 404 and are still recorded so tests can assert on them.
 */
export async function startFakeGitHub(routes: FakeRoute[] = []): Promise<FakeGitHub> {
  const requests: FakeGitHub['requests'] = [];
  const received: FakeRequestInfo[] = [];
  const server: Server = createServer((req, res) => {
    const method = req.method ?? 'GET';
    const path = req.url ?? '/';
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (raw += chunk));
    req.on('end', () => {
      requests.push({ method, path });
      received.push({ method, path, body: raw, headers: req.headers });
      const route = routes.find((r) => r.method === method && r.path === path);
      const computed = route?.respond?.({ method, path, body: raw, headers: req.headers });
      const status = computed?.status ?? route?.status ?? (route ? 200 : 404);
      const body = computed ? computed.body : route ? route.body : { message: 'Not Found' };
      const headers = computed?.headers ?? route?.headers ?? {};
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      // A 304 or 204 carries no body. A string sent as text/html is raw markup, as the Markdown preview returns it.
      const rawHtml = typeof body === 'string' && headers['content-type']?.includes('text/html');
      if (status === 304 || status === 204) res.end();
      else res.end(rawHtml ? (body as string) : JSON.stringify(body ?? {}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    received,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  };
}
