import { describe, expect, it } from 'vitest';
import { resolveGitHubEndpoints, GITHUB_ENDPOINTS } from '../../../src/main/github/endpoints';

describe('resolveGitHubEndpoints', () => {
  it('uses the real GitHub endpoints when no override is set', () => {
    expect(resolveGitHubEndpoints(undefined)).toEqual(GITHUB_ENDPOINTS);
    expect(GITHUB_ENDPOINTS).toEqual({
      oauthBaseUrl: 'https://github.com',
      apiBaseUrl: 'https://api.github.com'
    });
  });

  it('accepts a loopback override for controlled tests', () => {
    expect(resolveGitHubEndpoints('http://127.0.0.1:4010')).toEqual({
      oauthBaseUrl: 'http://127.0.0.1:4010',
      apiBaseUrl: 'http://127.0.0.1:4010'
    });
  });

  it.each([
    ['remote host', 'https://evil.example'],
    ['public IP', 'http://93.184.216.34'],
    ['not a URL', 'not a url'],
    ['path on loopback', 'http://127.0.0.1:4010/extra']
  ])('ignores an override that is %s', (_label, override) => {
    expect(resolveGitHubEndpoints(override)).toEqual(GITHUB_ENDPOINTS);
  });
});
