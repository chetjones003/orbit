import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface VerifiedDownloadOptions {
  url: string;
  /** Base64 sha512 as published in latest*.yml. */
  sha512: string;
  dest: string;
  fetch?: typeof fetch;
}

/**
 * Downloads one release asset to `dest` and checks its sha512 before keeping it. A mismatch or a
 * failed response removes the partial file, so an unverified installer never reaches the user.
 */
export async function downloadVerified(options: VerifiedDownloadOptions): Promise<void> {
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch(options.url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }
  const hash = createHash('sha512');
  const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on('data', (chunk: Buffer) => hash.update(chunk));
  try {
    await pipeline(body, createWriteStream(options.dest));
    if (hash.digest('base64') !== options.sha512) {
      throw new Error('Downloaded file failed its checksum');
    }
  } catch (error) {
    await rm(options.dest, { force: true });
    throw error;
  }
}
