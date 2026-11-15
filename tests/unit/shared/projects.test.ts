import { describe, expect, it } from 'vitest';
import {
  parseProjectFieldChange,
  parseProjectFieldInput,
  projectValueMatches,
  PROJECT_TEXT_MAX_CHARS
} from '../../../src/shared/projects';

describe('parseProjectFieldInput', () => {
  it('accepts each field type in its own shape', () => {
    expect(parseProjectFieldInput({ kind: 'single-select', optionId: 'opt_1' })).toEqual({
      kind: 'single-select',
      optionId: 'opt_1'
    });
    expect(parseProjectFieldInput({ kind: 'iteration', iterationId: 'it_1' })).toEqual({
      kind: 'iteration',
      iterationId: 'it_1'
    });
    expect(parseProjectFieldInput({ kind: 'text', text: 'hi' })).toEqual({ kind: 'text', text: 'hi' });
    expect(parseProjectFieldInput({ kind: 'number', number: 2.5 })).toEqual({ kind: 'number', number: 2.5 });
    expect(parseProjectFieldInput({ kind: 'date', date: '2026-02-28' })).toEqual({
      kind: 'date',
      date: '2026-02-28'
    });
  });

  it('refuses malformed values', () => {
    expect(parseProjectFieldInput(null)).toBeNull();
    expect(parseProjectFieldInput({ kind: 'unknown' })).toBeNull();
    expect(parseProjectFieldInput({ kind: 'single-select', optionId: '' })).toBeNull();
    expect(parseProjectFieldInput({ kind: 'single-select', optionId: 'has space' })).toBeNull();
    expect(parseProjectFieldInput({ kind: 'number', number: Number.NaN })).toBeNull();
    expect(parseProjectFieldInput({ kind: 'number', number: '3' })).toBeNull();
    expect(parseProjectFieldInput({ kind: 'text', text: 'x'.repeat(PROJECT_TEXT_MAX_CHARS + 1) })).toBeNull();
    expect(parseProjectFieldInput({ kind: 'date', date: '2026-13-01' })).toBeNull();
    expect(parseProjectFieldInput({ kind: 'date', date: '2026-02-30T00:00' })).toBeNull();
  });
});

describe('parseProjectFieldChange', () => {
  it('keeps a clear (null value) and refuses a change with no field', () => {
    expect(parseProjectFieldChange({ fieldId: 'FLD_1', value: null })).toEqual({
      fieldId: 'FLD_1',
      value: null
    });
    expect(parseProjectFieldChange({ value: null })).toBeNull();
    expect(parseProjectFieldChange({ fieldId: 'FLD_1', value: { kind: 'text' } })).toBeNull();
  });
});

describe('projectValueMatches', () => {
  it('compares stored values with the value a write would set', () => {
    expect(
      projectValueMatches(
        { kind: 'single-select', optionId: 'a', name: 'A' },
        { kind: 'single-select', optionId: 'a' }
      )
    ).toBe(true);
    expect(
      projectValueMatches(
        { kind: 'single-select', optionId: 'a', name: 'A' },
        { kind: 'single-select', optionId: 'b' }
      )
    ).toBe(false);
    expect(projectValueMatches({ kind: 'number', number: 3 }, { kind: 'number', number: 3 })).toBe(true);
    expect(projectValueMatches({ kind: 'text', text: 'x' }, { kind: 'number', number: 3 })).toBe(false);
  });

  it('treats a missing value as matching a clear', () => {
    expect(projectValueMatches(undefined, null)).toBe(true);
    expect(projectValueMatches({ kind: 'text', text: 'x' }, null)).toBe(false);
  });
});
