import { describe, expect, it } from 'vitest';
import { debugMediaOrigin, GITHUB_ENDPOINTS } from '../../../src/main/github/endpoints';
import { buildContentSecurityPolicy } from '../../../src/main/security';

describe('debug media origin', () => {
  it('is null in every normal run, with no override set', () => {
    expect(debugMediaOrigin(undefined)).toBeNull();
  });

  it('is the fake server origin only for a bare loopback override', () => {
    expect(debugMediaOrigin('http://127.0.0.1:4010')).toBe('http://127.0.0.1:4010');
    expect(debugMediaOrigin('http://localhost:4010')).toBe('http://localhost:4010');
  });

  it('is null for a remote host, an https origin, or a path, so media never reaches a remote server', () => {
    expect(debugMediaOrigin('https://evil.example')).toBeNull();
    expect(debugMediaOrigin('http://10.0.0.5:4010')).toBeNull();
    expect(debugMediaOrigin('http://127.0.0.1:4010/api')).toBeNull();
    expect(debugMediaOrigin('not a url')).toBeNull();
    expect(GITHUB_ENDPOINTS.apiBaseUrl).toBe('https://api.github.com');
  });
});

describe('content security policy with a debug media origin', () => {
  it('allows the fake origin for images and video only when it is set', () => {
    const debugged = buildContentSecurityPolicy({ mediaOrigin: 'http://127.0.0.1:4010' });
    expect(debugged).toContain(
      "img-src 'self' data: https://github.com https://*.githubusercontent.com http://127.0.0.1:4010"
    );
    expect(debugged).toContain(
      "media-src 'self' https://github.com https://*.githubusercontent.com http://127.0.0.1:4010"
    );

    const normal = buildContentSecurityPolicy({});
    expect(normal).not.toContain('127.0.0.1');
  });
});
