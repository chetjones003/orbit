import { describe, expect, it } from 'vitest';
import { parseExternalUrl } from '../../../src/shared/ipc';

describe('parseExternalUrl', () => {
  it('accepts absolute https, http, and mailto URLs', () => {
    expect(parseExternalUrl('https://github.com/chetjones003/orbit')?.hostname).toBe('github.com');
    expect(parseExternalUrl('http://example.com/')?.protocol).toBe('http:');
    expect(parseExternalUrl('mailto:owner@example.com')?.protocol).toBe('mailto:');
  });

  it.each([
    ['ftp scheme', 'ftp://example.com/'],
    ['file scheme', 'file:///C:/Windows/system.ini'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['embedded credentials', 'https://user:pass@github.com/'],
    ['relative path', '/chetjones003/orbit'],
    ['empty string', ''],
    ['non-string input', 42],
    ['overlong input', `https://github.com/${'a'.repeat(2100)}`]
  ])('rejects %s', (_label, input) => {
    expect(parseExternalUrl(input)).toBeNull();
  });
});
