import { useState } from 'react';
import {
  CUSTOM_VIEW_LAYOUTS,
  CUSTOM_VIEW_NAME_MAX,
  type CustomViewCondition,
  type CustomViewDefinition
} from '../../../shared/custom-views';
import type { ProjectField } from '../../../shared/projects';
import {
  findMappingRepairs,
  isDateField,
  isGroupableField,
  isIterationField,
  suggestMapping,
  type MappingRepair,
  type MappingSlot
} from './custom-view-model';

/** The mapping slots that hold a field, as opposed to a sort or a filter. */
type FieldSlot = Exclude<MappingSlot, 'sort' | 'condition'>;

const FIELD_SLOT_LABELS: Record<FieldSlot, string> = {
  columnFieldId: 'Column field',
  swimlaneFieldId: 'Swimlane field',
  groupFieldId: 'Group field',
  startFieldId: 'Start field',
  targetFieldId: 'Target field',
  iterationFieldId: 'Iteration field',
  calendarFieldId: 'Date field'
};

/** The fields a mapping slot can take: each slot only accepts the kind of field its role needs. */
function candidatesFor(slot: FieldSlot, fields: ProjectField[]): ProjectField[] {
  switch (slot) {
    case 'startFieldId':
    case 'targetFieldId':
    case 'calendarFieldId':
      return fields.filter(isDateField);
    case 'iterationFieldId':
      return fields.filter(isIterationField);
    case 'columnFieldId':
    case 'swimlaneFieldId':
    case 'groupFieldId':
      return fields.filter(isGroupableField);
  }
}

export interface CustomViewEditorProps {
  view: CustomViewDefinition;
  fields: ProjectField[];
  /** Called with the whole definition after every change. The parent saves it, so nothing needs a save button. */
  onChange: (next: CustomViewDefinition) => void;
  onDelete: () => void;
}

type ConditionKind = CustomViewCondition['kind'];

const CONDITION_LABELS: Record<ConditionKind, string> = {
  'one-of': 'Is one of',
  'no-value': 'Has no value',
  contains: 'Contains'
};

/**
 * Editing for one custom view's definition: its name, layout, filters, sort, and the field mapping.
 * Suggested mappings are shown but only applied when the user accepts them, and a mapping that no longer
 * fits is repaired by the user, never silently.
 */
export function CustomViewEditor({ view, fields, onChange, onDelete }: CustomViewEditorProps) {
  const [confirming, setConfirming] = useState(false);
  // The name as typed. Only a non-blank name is saved: a blank one would be dropped from storage on reload.
  const [nameDraft, setNameDraft] = useState(view.name);
  const groupable = candidatesFor('columnFieldId', fields);
  const repairs = findMappingRepairs(view, fields);
  const suggestion = suggestMapping(fields);
  const update = (patch: Partial<CustomViewDefinition>) => onChange({ ...view, ...patch });

  const setCondition = (index: number, next: CustomViewCondition) =>
    update({ conditions: view.conditions.map((c, i) => (i === index ? next : c)) });
  const removeCondition = (index: number) =>
    update({ conditions: view.conditions.filter((_, i) => i !== index) });

  // A new filter uses the first kind of field the project has, so every project can add one.
  const addCondition = () => {
    const single = groupable[0];
    const text = fields.find((f) => f.kind === 'text');
    const first = fields[0];
    const next: CustomViewCondition | null = single
      ? { kind: 'one-of', fieldId: single.id, valueIds: [] }
      : text
        ? { kind: 'contains', fieldId: text.id, text: '' }
        : first
          ? { kind: 'no-value', fieldId: first.id }
          : null;
    if (next) update({ conditions: [...view.conditions, next] });
  };

  return (
    <form
      className="custom-view-editor"
      aria-label="Custom view settings"
      onSubmit={(e) => e.preventDefault()}
    >
      <label>
        View name
        <input
          type="text"
          value={nameDraft}
          maxLength={CUSTOM_VIEW_NAME_MAX}
          onChange={(event) => {
            setNameDraft(event.target.value);
            if (event.target.value.trim() !== '') update({ name: event.target.value });
          }}
        />
      </label>

      <label>
        Layout
        <select
          value={view.layout}
          onChange={(event) => {
            const layout = CUSTOM_VIEW_LAYOUTS.find((option) => option === event.target.value);
            if (layout) update({ layout });
          }}
        >
          <option value="kanban">Kanban</option>
          <option value="table">Table</option>
          <option value="gantt">Gantt</option>
          <option value="calendar">Calendar</option>
        </select>
      </label>

      <label>
        Advanced filter
        <input
          type="text"
          value={view.advancedFilter}
          placeholder="is:issue status:Todo"
          onChange={(event) => update({ advancedFilter: event.target.value })}
        />
      </label>
      <p className="project-note">
        GitHub&apos;s project filter syntax. GitHub applies it, as it does for a saved view.
      </p>

      <fieldset className="custom-view-filters">
        <legend>Filters</legend>
        {view.conditions.map((condition, index) => (
          <FilterRow
            key={index}
            condition={condition}
            fields={fields}
            onChange={(next) => setCondition(index, next)}
            onRemove={() => removeCondition(index)}
          />
        ))}
        <button
          type="button"
          className="secondary-action"
          onClick={addCondition}
          disabled={fields.length === 0}
        >
          Add filter
        </button>
      </fieldset>

      <label>
        Sort by
        <select
          value={view.sort?.fieldId ?? ''}
          onChange={(event) =>
            update({
              sort:
                event.target.value === ''
                  ? null
                  : { fieldId: event.target.value, direction: view.sort?.direction ?? 'asc' }
            })
          }
        >
          <option value="">Manual order</option>
          {fields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      {view.sort && (
        <label>
          Sort direction
          <select
            value={view.sort.direction}
            onChange={(event) =>
              update({
                sort: {
                  fieldId: view.sort?.fieldId as string,
                  direction: event.target.value === 'desc' ? 'desc' : 'asc'
                }
              })
            }
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
      )}

      {view.layout === 'kanban' && (
        <>
          <MappingSelect
            label="Columns"
            value={view.columnFieldId}
            options={groupable}
            emptyLabel="Choose a field"
            onChange={(columnFieldId) => update({ columnFieldId })}
          />
          {view.columnFieldId === null && suggestion && (
            <SuggestionNote
              name={fields.find((f) => f.id === suggestion)?.name ?? ''}
              what="column field"
              onUse={() => update({ columnFieldId: suggestion })}
            />
          )}
          <MappingSelect
            label="Swimlanes"
            value={view.swimlaneFieldId}
            options={groupable}
            emptyLabel="None"
            onChange={(swimlaneFieldId) => update({ swimlaneFieldId })}
          />
        </>
      )}
      {view.layout === 'table' && (
        <MappingSelect
          label="Group by"
          value={view.groupFieldId}
          options={groupable}
          emptyLabel="No grouping"
          onChange={(groupFieldId) => update({ groupFieldId })}
        />
      )}
      {view.layout === 'gantt' && (
        <>
          <label>
            Bars from
            <select
              value={view.ganttSource}
              onChange={(event) =>
                update({ ganttSource: event.target.value === 'iteration' ? 'iteration' : 'dates' })
              }
            >
              <option value="dates">Start and target dates</option>
              <option value="iteration">An iteration field</option>
            </select>
          </label>
          {view.ganttSource === 'dates' ? (
            <>
              <MappingSelect
                label="Start field"
                value={view.startFieldId}
                options={candidatesFor('startFieldId', fields)}
                emptyLabel="Choose a field"
                onChange={(startFieldId) => update({ startFieldId })}
              />
              <MappingSelect
                label="Target field"
                value={view.targetFieldId}
                options={candidatesFor('targetFieldId', fields)}
                emptyLabel="Choose a field"
                onChange={(targetFieldId) => update({ targetFieldId })}
              />
            </>
          ) : (
            <MappingSelect
              label="Iteration field"
              value={view.iterationFieldId}
              options={candidatesFor('iterationFieldId', fields)}
              emptyLabel="Choose a field"
              onChange={(iterationFieldId) => update({ iterationFieldId })}
            />
          )}
        </>
      )}
      {view.layout === 'calendar' && (
        <>
          <MappingSelect
            label="Date field"
            value={view.calendarFieldId}
            options={candidatesFor('calendarFieldId', fields)}
            emptyLabel="Choose a field"
            onChange={(calendarFieldId) => update({ calendarFieldId })}
          />
          <label>
            Calendar scale
            <select
              value={view.calendarScale}
              onChange={(event) =>
                update({ calendarScale: event.target.value === 'week' ? 'week' : 'month' })
              }
            >
              <option value="month">Month</option>
              <option value="week">Week</option>
            </select>
          </label>
        </>
      )}

      {repairs.map((repair, index) => (
        <RepairNote
          key={`${index}-${repair.slot}-${repair.fieldId}`}
          repair={repair}
          fields={fields}
          current={view}
          onFix={update}
          onClearBrokenFilters={() =>
            update({ conditions: view.conditions.filter((c) => c.fieldId !== repair.fieldId) })
          }
        />
      ))}

      <div className="custom-view-danger">
        {confirming ? (
          <>
            <button type="button" className="secondary-action" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className="secondary-action" onClick={onDelete}>
              Confirm delete
            </button>
          </>
        ) : (
          <button type="button" className="secondary-action" onClick={() => setConfirming(true)}>
            Delete view
          </button>
        )}
      </div>
    </form>
  );
}

function MappingSelect({
  label,
  value,
  options,
  emptyLabel,
  onChange
}: {
  label: string;
  value: string | null;
  options: ProjectField[];
  emptyLabel: string;
  onChange: (value: string | null) => void;
}) {
  return (
    <label>
      {label}
      <select
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">{emptyLabel}</option>
        {options.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function SuggestionNote({ name, what, onUse }: { name: string; what: string; onUse: () => void }) {
  return (
    <p className="project-note">
      Suggested {what}: {name}{' '}
      <button type="button" className="secondary-action" onClick={onUse}>
        Use suggestion
      </button>
    </p>
  );
}

function RepairNote({
  repair,
  fields,
  current,
  onFix,
  onClearBrokenFilters
}: {
  repair: MappingRepair;
  fields: ProjectField[];
  current: CustomViewDefinition;
  onFix: (patch: Partial<CustomViewDefinition>) => void;
  onClearBrokenFilters: () => void;
}) {
  const reason =
    repair.reason === 'missing' ? 'was removed from this project' : 'can no longer be used for this view';
  if (repair.slot === 'sort') {
    return (
      <p role="alert" className="project-message">
        The sort field was removed from this project.{' '}
        <button type="button" className="secondary-action" onClick={() => onFix({ sort: null })}>
          Clear sort
        </button>
      </p>
    );
  }
  if (repair.slot === 'condition') {
    return (
      <p role="alert" className="project-message">
        A filter uses a field that {reason}.{' '}
        <button type="button" className="secondary-action" onClick={onClearBrokenFilters}>
          Remove broken filters
        </button>
      </p>
    );
  }
  const slot = repair.slot as FieldSlot;
  const label = FIELD_SLOT_LABELS[slot];
  return (
    <p role="alert" className="project-message">
      {label} {reason}.{' '}
      <label>
        Repair {label.toLowerCase()}
        <select
          aria-label={`Repair ${label.toLowerCase()}`}
          value={current[slot] ?? ''}
          onChange={(event) => onFix({ [slot]: event.target.value === '' ? null : event.target.value })}
        >
          <option value="">Clear</option>
          {candidatesFor(slot, fields).map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
    </p>
  );
}

function FilterRow({
  condition,
  fields,
  onChange,
  onRemove
}: {
  condition: CustomViewCondition;
  fields: ProjectField[];
  onChange: (next: CustomViewCondition) => void;
  onRemove: () => void;
}) {
  const fieldsFor = (kind: ConditionKind) =>
    fields.filter((f) => {
      if (kind === 'one-of') return f.kind === 'single-select' || f.kind === 'iteration';
      if (kind === 'contains') return f.kind === 'text';
      return true;
    });
  const field = fields.find((f) => f.id === condition.fieldId);
  const choose = (kind: ConditionKind, fieldId: string): CustomViewCondition => {
    if (kind === 'one-of') return { kind, fieldId, valueIds: [] };
    if (kind === 'contains') return { kind, fieldId, text: '' };
    return { kind, fieldId };
  };
  const values =
    field?.kind === 'single-select'
      ? field.options.map((o) => ({ id: o.id, label: o.name }))
      : field?.kind === 'iteration'
        ? field.iterations.map((i) => ({ id: i.id, label: i.title }))
        : [];

  return (
    <div className="custom-filter">
      <select
        aria-label="Filter type"
        value={condition.kind}
        onChange={(event) => {
          const kind = event.target.value as ConditionKind;
          const nextField = fieldsFor(kind).find((f) => f.id === condition.fieldId) ?? fieldsFor(kind)[0];
          if (nextField) onChange(choose(kind, nextField.id));
        }}
      >
        {(Object.keys(CONDITION_LABELS) as ConditionKind[]).map((kind) => (
          <option key={kind} value={kind}>
            {CONDITION_LABELS[kind]}
          </option>
        ))}
      </select>
      <select
        aria-label="Filter field"
        value={condition.fieldId}
        onChange={(event) => onChange(choose(condition.kind, event.target.value))}
      >
        {fieldsFor(condition.kind).map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      {condition.kind === 'one-of' &&
        values.map((value) => {
          const checked = condition.valueIds.includes(value.id);
          const last = checked && condition.valueIds.length === 1;
          return (
            <label key={value.id} className="custom-filter-value">
              <input
                type="checkbox"
                checked={checked}
                disabled={last}
                onChange={(event) =>
                  onChange({
                    ...condition,
                    valueIds: event.target.checked
                      ? [...condition.valueIds, value.id]
                      : condition.valueIds.filter((id) => id !== value.id)
                  })
                }
              />
              {value.label}
            </label>
          );
        })}
      {condition.kind === 'contains' && (
        <input
          type="text"
          aria-label="Text to find"
          value={condition.text}
          onChange={(event) => onChange({ ...condition, text: event.target.value })}
        />
      )}
      <button type="button" className="secondary-action" onClick={onRemove}>
        Remove filter
      </button>
    </div>
  );
}
