import { describe, expect, it } from 'vitest';
import { classifyLink } from '../../../src/renderer/src/issues/classify-link';

const OWNER = 'orbit-owner';

describe('classifyLink', () => {
  it('opens the owner repo issues inside Orbit, ignoring fragments and trailing paths', () => {
    expect(classifyLink('https://github.com/orbit-owner/app/issues/12', OWNER)).toEqual({
      kind: 'in-app',
      target: 'issue',
      repoFullName: 'orbit-owner/app',
      number: 12
    });
    expect(classifyLink('https://github.com/orbit-owner/app/issues/12#issuecomment-9', OWNER)).toMatchObject({
      kind: 'in-app',
      number: 12
    });
  });

  it('matches the owner case-insensitively', () => {
    expect(classifyLink('https://github.com/ORBIT-owner/app/issues/3', OWNER)).toMatchObject({
      kind: 'in-app',
      repoFullName: 'ORBIT-owner/app'
    });
  });

  it('routes the owner repo pull requests to the in-app pull request target', () => {
    expect(classifyLink('https://github.com/orbit-owner/app/pull/7', OWNER)).toEqual({
      kind: 'in-app',
      target: 'pull',
      repoFullName: 'orbit-owner/app',
      number: 7
    });
  });

  it('sends issues in other repos and owners to the controlled external open', () => {
    expect(classifyLink('https://github.com/someone-else/app/issues/12', OWNER)).toEqual({
      kind: 'external',
      url: 'https://github.com/someone-else/app/issues/12'
    });
  });

  it('sends other http, https, and mailto links to the controlled external open', () => {
    expect(classifyLink('https://example.com/docs', OWNER)).toEqual({
      kind: 'external',
      url: 'https://example.com/docs'
    });
    expect(classifyLink('http://example.com/', OWNER)?.kind).toBe('external');
    expect(classifyLink('mailto:owner@example.com', OWNER)).toEqual({
      kind: 'external',
      url: 'mailto:owner@example.com'
    });
  });

  it.each([
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,hi'],
    ['file scheme', 'file:///C:/Windows/system.ini'],
    ['relative path', '/orbit-owner/app/issues/1'],
    ['empty href', ''],
    ['credentials in URL', 'https://user:pass@example.com/']
  ])('blocks %s', (_label, href) => {
    expect(classifyLink(href, OWNER)).toEqual({ kind: 'blocked' });
  });
});
