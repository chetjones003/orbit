/**
 * Pure security policy for the main process. No Electron imports here so the
 * rules can be unit tested directly.
 */

/** Origin of the packaged renderer (see protocol.ts). */
export const PACKAGED_APP_ORIGIN = 'orbit://app';

export interface CspOptions {
  /** Vite dev server origin, e.g. http://localhost:5173. Omit for packaged builds. */
  devServerOrigin?: string;
}

/** Strict CSP. Packaged builds allow scripts and styles only from the app bundle. */
export function buildContentSecurityPolicy(options: CspOptions = {}): string {
  const dev = options.devServerOrigin;
  const scriptSrc = dev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self'";
  const connectSrc = dev ? `'self' ${dev} ${dev.replace(/^http/, 'ws')}` : "'self'";
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
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
