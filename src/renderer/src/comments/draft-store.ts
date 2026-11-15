/**
 * Where a draft belongs. Drafts are keyed by account, repo, item, and target so text never leaks
 * between them. Drafts live only in memory: GitHub content is never written to disk.
 */
export interface DraftKey {
  login: string;
  repoFullName: string;
  kind: 'issue' | 'pull';
  number: number;
  /** A new comment, an edit of one comment, the description of an issue, or a new issue. */
  target: 'new' | 'issue-body' | 'issue-title' | 'new-issue' | { commentId: number };
}

/** Unsent comment text, held for the length of the session. */
export class DraftStore {
  private readonly drafts = new Map<string, { login: string; text: string }>();

  get(key: DraftKey): string | undefined {
    return this.drafts.get(encode(key))?.text;
  }

  /** Empty text removes the draft, so a cleared box is not reported as unsent work. */
  set(key: DraftKey, text: string): void {
    if (text === '') this.drafts.delete(encode(key));
    else this.drafts.set(encode(key), { login: key.login, text });
  }

  /** True when any draft holds visible text. Used to warn before the app closes or the user signs out. */
  hasDrafts(): boolean {
    return [...this.drafts.values()].some((draft) => draft.text.trim() !== '');
  }

  /** Drops one account's drafts, for example on sign-out. Other accounts keep theirs. */
  clearAccount(login: string): void {
    for (const [id, draft] of this.drafts) {
      if (draft.login === login) this.drafts.delete(id);
    }
  }
}

function encode(key: DraftKey): string {
  const target = typeof key.target === 'string' ? key.target : `comment:${key.target.commentId}`;
  return [key.login, key.repoFullName, key.kind, key.number, target].join('\u0000');
}

/** The one store the app uses. Drafts survive navigation and are dropped on sign-out. */
export const drafts = new DraftStore();
