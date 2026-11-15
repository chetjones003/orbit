import { useEffect, useState } from 'react';
import type { ProjectField, ProjectFieldInput, ProjectFieldValue } from '../../../shared/projects';
import { describeValue } from './project-model';

export interface ProjectFieldEditorProps {
  field: ProjectField;
  value: ProjectFieldValue | undefined;
  /** Names the item in control labels, so each control is unambiguous to a screen reader. */
  itemLabel: string;
  disabled: boolean;
  /** `null` clears the field. */
  onChange: (value: ProjectFieldInput | null) => void;
}

/**
 * Edits one Project field of one item. Selects save on change. Text and number inputs save on blur or Enter,
 * so one edit is one request, not one request per keystroke.
 */
export function ProjectFieldEditor({ field, value, itemLabel, disabled, onChange }: ProjectFieldEditorProps) {
  const label = `${field.name} for ${itemLabel}`;
  const current = describeValue(value);

  if (field.kind === 'single-select') {
    return (
      <select
        aria-label={label}
        disabled={disabled}
        value={value?.kind === 'single-select' ? value.optionId : ''}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : { kind: 'single-select', optionId: event.target.value })
        }
      >
        <option value="">No value</option>
        {field.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    );
  }

  if (field.kind === 'iteration') {
    return (
      <select
        aria-label={label}
        disabled={disabled}
        value={value?.kind === 'iteration' ? value.iterationId : ''}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : { kind: 'iteration', iterationId: event.target.value })
        }
      >
        <option value="">No iteration</option>
        {field.iterations.map((iteration) => (
          <option key={iteration.id} value={iteration.id}>
            {iteration.title} ({iteration.startDate}, {iteration.duration} days)
          </option>
        ))}
      </select>
    );
  }

  return (
    <span className="project-field-input">
      {field.kind === 'date' ? (
        <input
          type="date"
          aria-label={label}
          disabled={disabled}
          value={value?.kind === 'date' ? value.date : ''}
          onChange={(event) =>
            event.target.value === '' ? onChange(null) : onChange({ kind: 'date', date: event.target.value })
          }
        />
      ) : (
        <DraftInput
          field={field}
          label={label}
          current={current}
          disabled={disabled}
          onCommit={(draft) => {
            if (draft.trim() === '' && field.kind === 'text') {
              if (current !== '') onChange(null);
              return;
            }
            if (field.kind === 'number') {
              const number = Number(draft);
              // An empty box clears the number. Text that is not a number is ignored, so a stray key cannot clear it.
              if (draft.trim() === '') {
                if (current !== '') onChange(null);
                return;
              }
              if (!Number.isFinite(number)) return;
              if (number !== (value?.kind === 'number' ? value.number : undefined))
                onChange({ kind: 'number', number });
              return;
            }
            if (draft !== current) onChange({ kind: 'text', text: draft });
          }}
        />
      )}
      {value !== undefined && (
        <button
          type="button"
          className="project-field-clear"
          aria-label={`Clear ${label}`}
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          ×
        </button>
      )}
    </span>
  );
}

function DraftInput({
  field,
  label,
  current,
  disabled,
  onCommit
}: {
  field: ProjectField;
  label: string;
  current: string;
  disabled: boolean;
  onCommit: (draft: string) => void;
}) {
  const [draft, setDraft] = useState(current);
  // A saved or reconciled value replaces the draft, so the input always shows what is stored.
  useEffect(() => setDraft(current), [current]);
  return (
    <input
      type={field.kind === 'number' ? 'number' : 'text'}
      aria-label={label}
      disabled={disabled}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') setDraft(current);
      }}
    />
  );
}
