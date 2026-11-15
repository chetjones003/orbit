import type { CSSProperties } from 'react';

export interface RepoMarkProps {
  /** Two letters shown on the mark. */
  letters: string;
  color: string;
  /** Edge length in pixels. */
  size?: number;
}

/** A repository's mark: its letters on a coloured tile. Used in the list, the side panels, and the settings. */
export function RepoMark({ letters, color, size = 22 }: RepoMarkProps) {
  const style = {
    width: size,
    height: size,
    background: `color-mix(in srgb, ${color} 28%, transparent)`,
    color,
    borderColor: `color-mix(in srgb, ${color} 55%, transparent)`,
    fontSize: Math.max(8, Math.round(size * 0.42))
  } as CSSProperties;
  return (
    <span className="repo-mark" style={style} aria-hidden="true">
      {letters}
    </span>
  );
}
