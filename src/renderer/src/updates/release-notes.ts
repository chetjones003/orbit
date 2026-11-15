/**
 * Release notes as plain, readable text. Notes arrive as Markdown or as HTML; either way they are shown as text,
 * never as markup, so nothing in a release can run or restyle the app. List items keep a bullet and headings
 * keep their own line.
 */
export function plainReleaseNotes(notes: string): string {
  if (!/<[a-z][\s\S]*>/i.test(notes)) return notes.trim();
  const doc = new DOMParser().parseFromString(notes, 'text/html');
  for (const item of doc.querySelectorAll('li')) item.prepend('• ');
  for (const line of doc.querySelectorAll('br')) line.replaceWith('\n');
  for (const block of doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, pre, blockquote')) {
    block.append('\n');
  }
  return (doc.body.textContent ?? '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
