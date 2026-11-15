// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  isGitHubMediaUrl,
  sanitizeIssueHtml,
  setDebugMediaOrigin
} from '../../../src/renderer/src/issues/sanitize-issue-html';

describe('media from the debug origin', () => {
  afterEach(() => setDebugMediaOrigin(null));

  it('rejects the fake origin in normal runs, as it rejects every non-GitHub host', () => {
    expect(isGitHubMediaUrl('http://127.0.0.1:4010/assets/crash-dialog.png')).toBe(false);
  });

  it('accepts only the exact debug origin once the main process has reported it', () => {
    setDebugMediaOrigin('http://127.0.0.1:4010');
    expect(isGitHubMediaUrl('http://127.0.0.1:4010/assets/crash-dialog.png')).toBe(true);
    expect(isGitHubMediaUrl('http://127.0.0.1:4011/assets/crash-dialog.png')).toBe(false);
    expect(isGitHubMediaUrl('https://evil.example/x.png')).toBe(false);
  });

  it('keeps the image in sanitized issue HTML only while the debug origin is set', () => {
    const html = '<p><img src="http://127.0.0.1:4010/assets/import-log.png" alt="log"></p>';
    expect(sanitizeIssueHtml(html)).not.toContain('import-log.png');
    setDebugMediaOrigin('http://127.0.0.1:4010');
    expect(sanitizeIssueHtml(html)).toContain('http://127.0.0.1:4010/assets/import-log.png');
  });
});
