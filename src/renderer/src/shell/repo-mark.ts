/** The colours a repository mark can take. Default marks are picked from these by the repo's name. */
export const REPO_MARK_COLORS = [
  '#e5484d',
  '#f76b15',
  '#f5a524',
  '#30a46c',
  '#12a594',
  '#0ea5e9',
  '#3e63dd',
  '#8e4ec6',
  '#d6409f',
  '#64748b'
] as const;

/**
 * The two letters a default repository mark shows: the first letters of the first two words of the name,
 * split on dashes, underscores, dots, spaces, and camel case. "orbit" gives "OR"; "Atlas-CAD" gives "AC".
 */
export function markLetters(repoName: string): string {
  const words = repoName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[-_. ]+/)
    .filter((word) => word.length > 0);
  const letters =
    words.length >= 2 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : (words[0] ?? '').slice(0, 2);
  return letters.toUpperCase() || '?';
}

/** A stable colour for a repository, so its mark keeps the same colour between launches. */
export function markColor(fullName: string): string {
  let hash = 0;
  for (const char of fullName) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return REPO_MARK_COLORS[hash % REPO_MARK_COLORS.length] ?? REPO_MARK_COLORS[0];
}
