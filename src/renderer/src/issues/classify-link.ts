export type LinkRoute =
  | { kind: 'in-app'; target: 'issue' | 'pull'; repoFullName: string; number: number }
  | { kind: 'external'; url: string }
  | { kind: 'blocked' };

const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);
const ISSUE_OR_PULL_PATH = /^\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)\/?$/;

/**
 * Decides where a link inside an issue body goes. Issues and pull requests in the signed-in
 * owner's repos open in Orbit; other http(s) and mailto links go through the controlled
 * external open; everything else is blocked.
 */
export function classifyLink(href: string, signedInLogin: string): LinkRoute {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { kind: 'blocked' };
  }
  if (url.username !== '' || url.password !== '') return { kind: 'blocked' };
  if (!EXTERNAL_PROTOCOLS.has(url.protocol)) return { kind: 'blocked' };

  if (url.protocol === 'https:' && url.hostname === 'github.com') {
    const match = ISSUE_OR_PULL_PATH.exec(url.pathname);
    if (match) {
      const [, owner = '', repo = '', kind = '', number = ''] = match;
      if (owner.toLowerCase() === signedInLogin.toLowerCase()) {
        return {
          kind: 'in-app',
          target: kind === 'pull' ? 'pull' : 'issue',
          repoFullName: `${owner}/${repo}`,
          number: Number(number)
        };
      }
    }
  }
  return { kind: 'external', url: url.toString() };
}
