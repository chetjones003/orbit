export interface GitHubEndpoints {
  /** github.com OAuth endpoints (device code, token, refresh). */
  oauthBaseUrl: string;
  /** GitHub REST API base. */
  apiBaseUrl: string;
  /** Host that receives attachment uploads. */
  uploadsBaseUrl: string;
}

export const GITHUB_ENDPOINTS: GitHubEndpoints = {
  oauthBaseUrl: 'https://github.com',
  apiBaseUrl: 'https://api.github.com',
  uploadsBaseUrl: 'https://uploads.github.com'
};

/**
 * Test-only override (ORBIT_GITHUB_URL) that points both endpoints at the fake GitHub
 * server. It is accepted only as a bare loopback origin, so tokens can never be sent
 * to a remote host through this setting.
 */
/**
 * The fake GitHub's origin, whose images and video the renderer may load. Set only when the same loopback
 * override is in use, so it is never a remote host. Null in every normal run.
 */
export function debugMediaOrigin(override: string | undefined): string | null {
  const endpoints = resolveGitHubEndpoints(override);
  return endpoints === GITHUB_ENDPOINTS ? null : new URL(endpoints.apiBaseUrl).origin;
}

export function resolveGitHubEndpoints(override: string | undefined): GitHubEndpoints {
  if (!override) return GITHUB_ENDPOINTS;
  let url: URL;
  try {
    url = new URL(override);
  } catch {
    return GITHUB_ENDPOINTS;
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  const bareOrigin = url.pathname === '/' && url.search === '' && url.hash === '' && url.username === '';
  if (url.protocol !== 'http:' || !loopback || !bareOrigin) return GITHUB_ENDPOINTS;
  const base = `${url.protocol}//${url.host}`;
  return { oauthBaseUrl: base, apiBaseUrl: base, uploadsBaseUrl: base };
}
