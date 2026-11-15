import { useState } from 'react';
import { ISSUE_TITLE_MAX_CHARS } from '../../../shared/issues';
import { Composer } from '../comments/Composer';

export interface NewIssueFormProps {
  repoFullName: string;
  signedInLogin: string;
  /** Called with the new issue's number once GitHub has created it. */
  onCreated: (number: number) => void;
  onCancel: () => void;
}

/** Opens a new issue in one of the user's personal repos. The title is required; the description is optional. */
export function NewIssueForm({ repoFullName, signedInLogin, onCreated, onCancel }: NewIssueFormProps) {
  const [title, setTitle] = useState('');
  const blank = title.trim() === '';

  const create = async (body: string): Promise<void> => {
    const saved = await window.orbit.issues.create(repoFullName, { title: title.trim(), body });
    onCreated(saved.summary.number);
  };

  return (
    <section className="new-issue" aria-label="New issue">
      <h3>New issue</h3>
      <label className="field">
        <span>Title</span>
        <input
          aria-label="Title"
          value={title}
          maxLength={ISSUE_TITLE_MAX_CHARS * 4}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <Composer
        draftKey={{ login: signedInLogin, repoFullName, kind: 'issue', number: 0, target: 'new-issue' }}
        placeholder="Describe the issue (optional)"
        ariaLabel="Description"
        submitLabel="Create issue"
        previewText={(text) => window.orbit.markdown.preview(repoFullName, text)}
        onSubmit={create}
        onCancel={onCancel}
        onExternalLink={(href) => void window.orbit.app.openExternal(href)}
        viewOnGitHubUrl={`https://github.com/${repoFullName}/issues/new`}
        allowEmpty
        submitDisabled={blank}
        attachTo={{ repoFullName }}
      />
    </section>
  );
}
