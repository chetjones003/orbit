import type { ReviewAnchor } from '../../shared/issues';

/**
 * True when the anchor names a line the file's patch shows on that side: a new-side line that is
 * added or kept, or an old-side line that is removed or kept. Lines outside every hunk are not anchors.
 */
export function anchorInPatch(patch: string, anchor: ReviewAnchor): boolean {
  let oldLine = 0;
  let newLine = 0;
  for (const text of patch.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      continue;
    }
    const marker = text.charAt(0);
    if (marker === ' ') {
      if (anchor.side === 'RIGHT' && newLine === anchor.line) return true;
      if (anchor.side === 'LEFT' && oldLine === anchor.line) return true;
      oldLine++;
      newLine++;
    } else if (marker === '-') {
      if (anchor.side === 'LEFT' && oldLine === anchor.line) return true;
      oldLine++;
    } else if (marker === '+') {
      if (anchor.side === 'RIGHT' && newLine === anchor.line) return true;
      newLine++;
    }
  }
  return false;
}
