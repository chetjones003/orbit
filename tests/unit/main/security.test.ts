import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy, isAppUrl } from '../../../src/main/security';

describe('buildContentSecurityPolicy', () => {
  it('packaged builds allow scripts only from the app bundle', () => {
    const csp = buildContentSecurityPolicy();
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it('blocks objects, framing, base-uri hijacking, and form posts', () => {
    const csp = buildContentSecurityPolicy();
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
  });

  it('dev builds allow only the dev server origin and its websocket for connect-src', () => {
    const csp = buildContentSecurityPolicy({ devServerOrigin: 'http://localhost:5173' });
    expect(csp).toContain("connect-src 'self' http://localhost:5173 ws://localhost:5173");
  });
});

describe('isAppUrl', () => {
  it('accepts the packaged orbit:// renderer origin', () => {
    expect(isAppUrl('orbit://app/index.html')).toBe(true);
  });

  it('rejects remote URLs and file URLs in packaged builds', () => {
    expect(isAppUrl('https://github.com/')).toBe(false);
    expect(isAppUrl('file:///C:/app/out/renderer/index.html')).toBe(false);
  });

  it('rejects a lookalike orbit origin', () => {
    expect(isAppUrl('orbit://app.evil.example/')).toBe(false);
  });

  it('accepts only the exact dev server origin', () => {
    expect(isAppUrl('http://localhost:5173/src/main.tsx', 'http://localhost:5173')).toBe(true);
    expect(isAppUrl('http://localhost:9999/', 'http://localhost:5173')).toBe(false);
    expect(isAppUrl('https://evil.example/', 'http://localhost:5173')).toBe(false);
  });
});
