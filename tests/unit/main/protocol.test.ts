import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRendererPath } from '../../../src/main/protocol';

const root = resolve('/app/out/renderer');

describe('resolveRendererPath', () => {
  it('maps the root path to index.html', () => {
    expect(resolveRendererPath(root, '/')).toBe(join(root, 'index.html'));
  });

  it('maps asset paths inside the renderer directory', () => {
    expect(resolveRendererPath(root, '/assets/index-abc.js')).toBe(join(root, 'assets', 'index-abc.js'));
  });

  it.each([
    ['parent traversal', '/../main/index.js'],
    ['deep traversal', '/assets/../../../etc/passwd'],
    ['encoded traversal', '/%2e%2e/main/index.js'],
    ['malformed encoding', '/%E0%A4%A']
  ])('refuses %s', (_label, pathname) => {
    expect(resolveRendererPath(root, pathname)).toBeNull();
  });
});
