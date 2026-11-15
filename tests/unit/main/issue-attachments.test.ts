import { describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../../../src/main/github/auth-service';
import { IssueService, type AttachmentNoticeStore } from '../../../src/main/github/issue-service';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES_FREE } from '../../../src/shared/attachments';

const SIGNED_IN = { kind: 'signed-in' as const, sessionId: 7, login: 'orbit-owner', persistent: true };
const HREF = 'https://github.com/user-attachments/assets/3f2a-91bc';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

interface Options {
  isPrivate?: boolean;
  push?: boolean;
  plan?: string;
  uploadStatus?: number;
  uploadBody?: unknown;
  acknowledged?: boolean;
}

/** Routes the calls an upload makes. Anything unexpected fails the test loudly. */
function makeHarness(options: Options = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.startsWith('https://api.github.test/repos/orbit-owner/app')) {
      return json({
        id: 555,
        private: options.isPrivate ?? true,
        permissions: { push: options.push ?? true }
      });
    }
    if (url === 'https://api.github.test/user')
      return json({ login: 'orbit-owner', plan: { name: options.plan ?? 'free' } });
    if (url.startsWith('https://uploads.github.test/user-attachments/assets')) {
      return json(options.uploadBody ?? { href: HREF }, options.uploadStatus ?? 201);
    }
    throw new Error(`unexpected request ${url}`);
  });
  let acknowledged = options.acknowledged ?? false;
  const notice: AttachmentNoticeStore = {
    isAcknowledged: vi.fn(async () => acknowledged),
    acknowledge: vi.fn(async () => {
      acknowledged = true;
    })
  };
  const auth = {
    getStatus: () => SIGNED_IN,
    getAccessToken: vi.fn(async () => 'secret')
  } as unknown as Pick<AuthService, 'getStatus' | 'getAccessToken'>;
  const service = new IssueService({
    auth,
    apiBaseUrl: 'https://api.github.test',
    uploadsBaseUrl: 'https://uploads.github.test',
    fetch: fetch as unknown as typeof globalThis.fetch,
    attachmentNotice: notice
  });
  const uploads = () => calls.filter((c) => c.url.includes('/user-attachments/assets'));
  return { service, calls, uploads, notice, fetch };
}

const PNG = { name: 'shot.png', bytes: new Uint8Array(2048) };

describe('IssueService.uploadAttachment', () => {
  it('uploads the bytes to the uploads host with the repo id and returns the attachment link', async () => {
    const { service, uploads } = makeHarness();

    const result = await service.uploadAttachment('orbit-owner/app', PNG, { acknowledgedPublic: false });

    expect(result).toEqual({ kind: 'uploaded', url: HREF });
    const [upload] = uploads();
    expect(upload?.url).toBe(
      'https://uploads.github.test/user-attachments/assets?name=shot.png&content_type=image%2Fpng&repository_id=555'
    );
    expect(upload?.init.method).toBe('POST');
    expect(upload?.init.body).toBe(PNG.bytes);
    expect(upload?.init.headers).toMatchObject({
      authorization: 'Bearer secret',
      'content-type': 'image/png'
    });
  });

  it('refuses an unsupported type before sending any request', async () => {
    const { service, calls } = makeHarness();

    await expect(
      service.uploadAttachment(
        'orbit-owner/app',
        { name: 'notes.pdf', bytes: new Uint8Array(10) },
        {
          acknowledgedPublic: false
        }
      )
    ).rejects.toThrow(/PNG, JPG, GIF, WebP, SVG, MP4, MOV, or WebM/);
    expect(calls).toHaveLength(0);
  });

  it('refuses an image over 10 MB before sending any request', async () => {
    const { service, calls } = makeHarness();

    await expect(
      service.uploadAttachment(
        'orbit-owner/app',
        { name: 'big.png', bytes: new Uint8Array(MAX_IMAGE_BYTES + 1) },
        { acknowledgedPublic: false }
      )
    ).rejects.toThrow('Images can be at most 10 MB.');
    expect(calls).toHaveLength(0);
  });

  it('refuses a repo the user cannot write to, and uploads nothing', async () => {
    const { service, uploads } = makeHarness({ push: false });

    await expect(
      service.uploadAttachment('orbit-owner/app', PNG, { acknowledgedPublic: false })
    ).rejects.toThrow('You need write access to this repo to attach files.');
    expect(uploads()).toHaveLength(0);
  });

  it('applies the free-plan video limit to a free account', async () => {
    const { service, uploads } = makeHarness({ plan: 'free' });
    const video = { name: 'clip.mp4', bytes: new Uint8Array(MAX_VIDEO_BYTES_FREE + 1) };

    await expect(
      service.uploadAttachment('orbit-owner/app', video, { acknowledgedPublic: false })
    ).rejects.toThrow('Videos can be at most 10 MB on a free plan.');
    expect(uploads()).toHaveLength(0);
  });

  it('allows a larger video on a paid plan', async () => {
    const { service, uploads } = makeHarness({ plan: 'pro' });
    const video = { name: 'clip.mp4', bytes: new Uint8Array(MAX_VIDEO_BYTES_FREE + 1) };

    const result = await service.uploadAttachment('orbit-owner/app', video, { acknowledgedPublic: false });

    expect(result.kind).toBe('uploaded');
    expect(uploads()).toHaveLength(1);
  });

  it('holds an upload to a public repo until the user acknowledges that it becomes public at once', async () => {
    const { service, uploads, notice } = makeHarness({ isPrivate: false });

    const first = await service.uploadAttachment('orbit-owner/app', PNG, { acknowledgedPublic: false });
    expect(first).toEqual({ kind: 'public-notice' });
    expect(uploads()).toHaveLength(0);

    const second = await service.uploadAttachment('orbit-owner/app', PNG, { acknowledgedPublic: true });
    expect(second).toEqual({ kind: 'uploaded', url: HREF });
    expect(notice.acknowledge).toHaveBeenCalledTimes(1);
  });

  it('does not ask again once the public-repo notice has been acknowledged', async () => {
    const { service, uploads } = makeHarness({ isPrivate: false, acknowledged: true });

    const result = await service.uploadAttachment('orbit-owner/app', PNG, { acknowledgedPublic: false });

    expect(result).toEqual({ kind: 'uploaded', url: HREF });
    expect(uploads()).toHaveLength(1);
  });

  it('reports an endpoint refusal as an error and returns no link', async () => {
    const { service } = makeHarness({ uploadStatus: 422, uploadBody: { message: 'unprocessable' } });

    await expect(
      service.uploadAttachment('orbit-owner/app', PNG, { acknowledgedPublic: false })
    ).rejects.toThrow('GitHub returned 422.');
  });

  it('refuses a returned link that is not a safe https URL', async () => {
    const { service } = makeHarness({ uploadBody: { href: 'https://github.com/a)[x](' } });

    await expect(
      service.uploadAttachment('orbit-owner/app', PNG, { acknowledgedPublic: false })
    ).rejects.toThrow('GitHub did not return an attachment link.');
  });
});
