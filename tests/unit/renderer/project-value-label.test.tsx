// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectValueLabel } from '../../../src/renderer/src/projects/ProjectValueLabel';
import { valueColorHex } from '../../../src/renderer/src/projects/project-model';
import type { ProjectField } from '../../../src/shared/projects';

const PRIORITY: ProjectField = {
  id: 'FLD_priority',
  name: 'Priority',
  kind: 'single-select',
  options: [
    { id: 'opt_p0', name: 'P0', color: 'RED' },
    { id: 'opt_p2', name: 'P2', color: null }
  ]
};

describe('valueColorHex', () => {
  it('reads the colour of the option a single-select value was set to', () => {
    expect(valueColorHex(PRIORITY, { kind: 'single-select', optionId: 'opt_p0', name: 'P0' })).toBe('cf222e');
  });

  it('gives no colour for an option without one, or for a value that is not a single-select', () => {
    expect(valueColorHex(PRIORITY, { kind: 'single-select', optionId: 'opt_p2', name: 'P2' })).toBeNull();
    expect(valueColorHex(PRIORITY, { kind: 'text', text: 'hi' })).toBeNull();
  });
});

describe('ProjectValueLabel', () => {
  afterEach(() => cleanup());

  it('shows a single-select value as a label chip in its option colour', () => {
    const { container } = render(
      <ProjectValueLabel field={PRIORITY} value={{ kind: 'single-select', optionId: 'opt_p0', name: 'P0' }} />
    );
    const chip = within(container).getByText('P0');
    expect(chip.className).toContain('issue-label');
    expect(chip.getAttribute('style')).toContain('#cf222e');
    expect(screen.queryByText('Priority')).toBeNull();
  });
});
