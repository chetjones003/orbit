import { useState } from 'react';
import type { IssueSnapshot } from '../../../shared/issues';
import { ISSUE_TITLE_MAX_CHARS } from '../../../shared/issues';
import { Composer } from '../comments/Composer';
import { drafts } from '../comments/draft-store';

export interface IssueEditorProps {
  repoFullName: string;
  number: number;
  signedInLogin: string;
  /** The version the edit starts from. Its title and body are what GitHub checks the save against. */
  snapshot: IssueSnapshot;
  onSaved: (issue: IssueSnapshot) => void;
  onCancel: () => void;
  /** Reloads the issue, used after a conflict so the user can start again from GitHub's version. */
  onReload: () => void;
  onLink: (href: string) => void;
  viewOnGitHubUrl: string;
}

/**
 * Edits an issue's title and description. A save is checked against GitHub's version: when the issue changed
 * since the user opened it, nothing is overwritten and their text stays in the editor.
 */
export function IssueEditor({
  repoFullName,
  number,
  signedInLogin,
  snapshot,
  onSaved,
  onCancel,
  onReload,
  onLink,
  viewOnGitHubUrl
}: IssueEditorProps) {
  const bodyKey = {
    login: signedInLogin,
    repoFullName,
    kind: 'issue' as const,
    number,
    target: 'issue-body' as const
  };
  const titleKey = { ...bodyKey, target: 'issue-title' as const };
  // An unsaved title is kept as a draft, like the description, so "Load latest version" does not lose it.
  const [title, setTitle] = useState(() => drafts.get(titleKey) ?? snapshot.summary.title);
  const [conflict, setConflict] = useState(false);

  const changeTitle = (next: string): void => {
    setTitle(next);
    drafts.set(titleKey, next === snapshot.summary.title ? '' : next);
  };

  const save = async (body: string): Promise<'keep' | void> => {
    const cleanTitle = title.trim();
    if (cleanTitle === '') throw new Error('An issue needs a title.');
    if ([...cleanTitle].length > ISSUE_TITLE_MAX_CHARS) {
      throw new Error(`Titles can be at most ${ISSUE_TITLE_MAX_CHARS} characters.`);
    }
    const result = await window.orbit.issues.update(
      repoFullName,
      number,
      { title: cleanTitle, body },
      { title: snapshot.summary.title, body: snapshot.body }
    );
    if (result.kind === 'saved') {
      drafts.set(titleKey, '');
      drafts.set(bodyKey, '');
      onSaved(result.issue);
      return;
    }
    setConflict(true);
    return 'keep';
  };

  return (
    <div className="issue-editor">
      <label className="field">
        <span>Title</span>
        <input aria-label="Title" value={title} onChange={(event) => changeTitle(event.target.value)} />
      </label>
      <Composer
        draftKey={bodyKey}
        initialText={snapshot.body}
        placeholder="Describe the issue"
        ariaLabel="Edit description"
        submitLabel="Save changes"
        previewText={(text) => window.orbit.markdown.preview(repoFullName, text)}
        onSubmit={save}
        onCancel={onCancel}
        onExternalLink={onLink}
        viewOnGitHubUrl={viewOnGitHubUrl}
        allowEmpty
      />
      {conflict && (
        <div className="issue-error" role="alert">
          <p>
            This issue changed on GitHub while you were editing it. Your title and description are still here.
            Copy them if you want to keep them, then load the latest version.
          </p>
          <button type="button" className="secondary-action" onClick={onReload}>
            Load latest version
          </button>
        </div>
      )}
    </div>
  );
}
