import { PACKAGED_APP_ORIGIN } from './security';
import { protocol } from 'electron';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

/**
 * Packaged renderer is served from a privileged custom scheme. The file:// protocol
 * cannot load the asar bundle once GrantFileProtocolExtraPrivileges is off, and that
 * fuse stays off in release builds.
 */
export const APP_SCHEME = 'orbit';
export const APP_ORIGIN = PACKAGED_APP_ORIGIN;
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

/** Must run before app ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true }
    }
  ]);
}

/**
 * Maps a URL pathname to a file inside `rendererDir`. Returns null for anything that
 * escapes the directory, including encoded traversal sequences.
 */
export function resolveRendererPath(rendererDir: string, pathname: string): string | null {
  const root = resolve(rendererDir);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, '') || 'index.html';
  const target = resolve(root, relative);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

/** Serves files from `rendererDir` only; anything outside it is refused. */
export function registerAppProtocol(rendererDir: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const target = resolveRendererPath(rendererDir, new URL(request.url).pathname);
    if (!target) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      const body = await readFile(target);
      return new Response(body, {
        headers: { 'content-type': MIME_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream' }
      });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  });
}
