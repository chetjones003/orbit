/**
 * Attachment rules shared by main (which enforces them) and the renderer (which checks early).
 * No Node or DOM APIs.
 */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Video limit on a free GitHub plan. */
export const MAX_VIDEO_BYTES_FREE = 10 * 1024 * 1024;
/** Video limit on a paid GitHub plan. */
export const MAX_VIDEO_BYTES_PAID = 100 * 1024 * 1024;

export type AttachmentKind = 'image' | 'video';
export type AccountPlan = 'free' | 'paid';

interface AllowedType {
  kind: AttachmentKind;
  contentType: string;
}

const ALLOWED: Record<string, AllowedType> = {
  png: { kind: 'image', contentType: 'image/png' },
  jpg: { kind: 'image', contentType: 'image/jpeg' },
  jpeg: { kind: 'image', contentType: 'image/jpeg' },
  gif: { kind: 'image', contentType: 'image/gif' },
  webp: { kind: 'image', contentType: 'image/webp' },
  svg: { kind: 'image', contentType: 'image/svg+xml' },
  mp4: { kind: 'video', contentType: 'video/mp4' },
  mov: { kind: 'video', contentType: 'video/quicktime' },
  webm: { kind: 'video', contentType: 'video/webm' }
};

export type AttachmentCheck =
  { ok: true; kind: AttachmentKind; contentType: string } | { ok: false; message: string };

/**
 * Decides whether a file may be uploaded, from its extension and size alone. Runs before any request.
 * The file's own MIME type is not trusted.
 */
export function checkAttachment(file: { name: string; size: number }, plan: AccountPlan): AttachmentCheck {
  const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  const allowed = ALLOWED[extension];
  if (!allowed) {
    return { ok: false, message: 'Attach a PNG, JPG, GIF, WebP, SVG, MP4, MOV, or WebM file.' };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, message: 'That file is empty.' };
  }
  if (allowed.kind === 'image' && file.size > MAX_IMAGE_BYTES) {
    return { ok: false, message: 'Images can be at most 10 MB.' };
  }
  if (allowed.kind === 'video') {
    const limit = plan === 'paid' ? MAX_VIDEO_BYTES_PAID : MAX_VIDEO_BYTES_FREE;
    if (file.size > limit) {
      return {
        ok: false,
        message:
          plan === 'paid' ? 'Videos can be at most 100 MB.' : 'Videos can be at most 10 MB on a free plan.'
      };
    }
  }
  return { ok: true, kind: allowed.kind, contentType: allowed.contentType };
}

/** A file the user picked or dropped, as it crosses from the renderer to main. */
export interface AttachmentFile {
  name: string;
  bytes: Uint8Array;
}

/** Uploaded, or held until the user acknowledges that uploads to a public repo are public at once. */
export type AttachmentUploadResult = { kind: 'uploaded'; url: string } | { kind: 'public-notice' };

/** Brackets and line breaks would end the Markdown alt text early, so they are dropped from the name. */
function altText(name: string): string {
  return name.replace(/[[\]\r\n]/g, '');
}

/** Text put at the cursor while a file uploads. Its counter keeps it unique in the document. */
export function uploadPlaceholder(counter: number, name: string): string {
  return `![Uploading ${altText(name)} (${counter})]()`;
}

/** The Markdown that replaces a placeholder once the upload succeeds. */
export function attachmentMarkdown(kind: AttachmentKind, name: string, url: string): string {
  // A video is a bare link on its own line, which GitHub renders as a player.
  return kind === 'image' ? `![${altText(name)}](${url})` : url;
}

/** Replaces the first occurrence of `needle`. Returns the text unchanged when it is gone. */
export function replaceFirst(text: string, needle: string, replacement: string): string {
  const at = text.indexOf(needle);
  if (at === -1) return text;
  return text.slice(0, at) + replacement + text.slice(at + needle.length);
}

/** An upload URL is inserted into Markdown, so it must be https with no characters that would break the link. */
export function isSafeAttachmentUrl(url: string): boolean {
  if (!/^https:\/\/[^\s()[\]<>]+$/.test(url)) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}
