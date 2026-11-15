/**
 * Pure security policy for the main process. No Electron imports here so the
 * rules can be unit tested directly.
 */

/** Origin of the packaged renderer (see protocol.ts). */
export const PACKAGED_APP_ORIGIN = 'orbit://app';

export interface CspOptions {
  /** Vite dev server origin, e.g. http://localhost:5173. Omit for packaged builds. */
  devServerOrigin?: string;
  /** The fake GitHub's loopback origin, allowed for media only while debugging against it. */
  mediaOrigin?: string | null;
}

/** Origins GitHub serves issue images and video from. Nothing else may load media. */
export const GITHUB_MEDIA_ORIGINS = 'https://github.com https://*.githubusercontent.com';

/** Strict CSP. Packaged builds allow scripts and styles only from the app bundle. */
export function buildContentSecurityPolicy(options: CspOptions = {}): string {
  const dev = options.devServerOrigin;
  const scriptSrc = dev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self'";
  const connectSrc = dev ? `'self' ${dev} ${dev.replace(/^http/, 'ws')}` : "'self'";
  const media = options.mediaOrigin ? ` ${options.mediaOrigin}` : '';
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    // Issue bodies may embed images and video, but only from GitHub-hosted origins.
    `img-src 'self' data: ${GITHUB_MEDIA_ORIGINS}${media}`,
    `media-src 'self' ${GITHUB_MEDIA_ORIGINS}${media}`,
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'none'"
  ].join('; ');
}

/**
 * True when `url` is the app's own renderer: the packaged orbit:// origin or the
 * dev server origin. Navigation and IPC senders are limited to this.
 */
export function isAppUrl(url: string, devServerOrigin?: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // Custom schemes have an opaque origin in Node's URL, so compare protocol and host.
  if (`${parsed.protocol}//${parsed.host}` === PACKAGED_APP_ORIGIN) return true;
  if (!devServerOrigin) return false;
  try {
    return parsed.origin === new URL(devServerOrigin).origin;
  } catch {
    return false;
  }
}
