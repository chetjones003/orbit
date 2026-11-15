import { describe, expect, it } from 'vitest';
import {
  attachmentMarkdown,
  checkAttachment,
  isSafeAttachmentUrl,
  replaceFirst,
  uploadPlaceholder,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES_FREE,
  MAX_VIDEO_BYTES_PAID
} from '../../../src/shared/attachments';

describe('checkAttachment', () => {
  it.each([
    ['photo.png', 'image/png', 'image'],
    ['photo.JPG', 'image/jpeg', 'image'],
    ['photo.jpeg', 'image/jpeg', 'image'],
    ['anim.gif', 'image/gif', 'image'],
    ['shot.webp', 'image/webp', 'image'],
    ['logo.svg', 'image/svg+xml', 'image'],
    ['clip.mp4', 'video/mp4', 'video'],
    ['clip.mov', 'video/quicktime', 'video'],
    ['clip.webm', 'video/webm', 'video']
  ])('accepts %s as %s %s', (name, contentType, kind) => {
    expect(checkAttachment({ name, size: 1024 }, 'free')).toEqual({ ok: true, kind, contentType });
  });

  it.each(['notes.pdf', 'archive.zip', 'page.html', 'no-extension'])(
    'rejects %s before any upload',
    (name) => {
      const result = checkAttachment({ name, size: 1024 }, 'paid');
      expect(result.ok).toBe(false);
    }
  );

  it('caps images at 10 MB', () => {
    expect(checkAttachment({ name: 'a.png', size: MAX_IMAGE_BYTES }, 'free').ok).toBe(true);
    const over = checkAttachment({ name: 'a.png', size: MAX_IMAGE_BYTES + 1 }, 'paid');
    expect(over.ok).toBe(false);
  });

  it('caps videos at 10 MB on the free plan and 100 MB on a paid plan', () => {
    expect(checkAttachment({ name: 'a.mp4', size: MAX_VIDEO_BYTES_FREE }, 'free').ok).toBe(true);
    expect(checkAttachment({ name: 'a.mp4', size: MAX_VIDEO_BYTES_FREE + 1 }, 'free').ok).toBe(false);
    expect(checkAttachment({ name: 'a.mp4', size: MAX_VIDEO_BYTES_PAID }, 'paid').ok).toBe(true);
    expect(checkAttachment({ name: 'a.mp4', size: MAX_VIDEO_BYTES_PAID + 1 }, 'paid').ok).toBe(false);
  });

  it('rejects empty files', () => {
    expect(checkAttachment({ name: 'a.png', size: 0 }, 'free').ok).toBe(false);
  });
});

describe('placeholders and Markdown', () => {
  it('builds an uploading placeholder that names the file and a counter', () => {
    expect(uploadPlaceholder(3, 'photo.png')).toBe('![Uploading photo.png (3)]()');
  });

  it('turns an image into Markdown image syntax', () => {
    expect(attachmentMarkdown('image', 'photo.png', 'https://github.com/user-attachments/assets/abc')).toBe(
      '![photo.png](https://github.com/user-attachments/assets/abc)'
    );
  });

  it('turns a video into a bare link on its own line so GitHub renders the player', () => {
    expect(attachmentMarkdown('video', 'clip.mp4', 'https://github.com/user-attachments/assets/abc')).toBe(
      'https://github.com/user-attachments/assets/abc'
    );
  });

  it('replaces only the first occurrence of a placeholder', () => {
    expect(replaceFirst('a ![x]() b ![x]()', '![x]()', 'Y')).toBe('a Y b ![x]()');
  });

  it('leaves the text alone when the placeholder was deleted meanwhile', () => {
    expect(replaceFirst('no placeholder here', '![x]()', 'Y')).toBe('no placeholder here');
  });
});

describe('isSafeAttachmentUrl', () => {
  it('accepts an absolute https URL', () => {
    expect(isSafeAttachmentUrl('https://github.com/user-attachments/assets/abc-123')).toBe(true);
  });

  it.each([
    'http://github.com/a',
    'https://github.com/a)b',
    'https://github.com/a b',
    'javascript:alert(1)',
    'https://github.com/[x]'
  ])('rejects %s, which would break or inject Markdown', (url) => {
    expect(isSafeAttachmentUrl(url)).toBe(false);
  });
});
