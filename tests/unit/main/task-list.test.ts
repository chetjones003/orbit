import { describe, expect, it } from 'vitest';
import { countTaskItems, setTaskItemChecked } from '../../../src/main/github/task-list';

describe('setTaskItemChecked', () => {
  it('flips only the requested task line and leaves the rest of the source untouched', () => {
    const source = ['Intro text', '', '- [ ] first', '- [x] second', '- [ ] third', ''].join('\n');

    const next = setTaskItemChecked(source, 1, false);

    expect(next).toBe(['Intro text', '', '- [ ] first', '- [ ] second', '- [ ] third', ''].join('\n'));
  });

  it('checks an unchecked item, accepting uppercase X as checked', () => {
    expect(setTaskItemChecked('* [ ] a\n* [X] b', 0, true)).toBe('* [x] a\n* [X] b');
  });

  it('counts task items in document order, including ordered and nested lists', () => {
    const source = ['1. [ ] one', '   - [x] nested', '2) [ ] two', '> - [ ] quoted'].join('\n');

    expect(countTaskItems(source)).toBe(4);
    expect(setTaskItemChecked(source, 3, true)).toBe(
      ['1. [ ] one', '   - [x] nested', '2) [ ] two', '> - [x] quoted'].join('\n')
    );
  });

  it('ignores task-looking lines inside fenced code blocks', () => {
    const source = ['```', '- [ ] not a task', '```', '- [ ] real task'].join('\n');

    expect(countTaskItems(source)).toBe(1);
    expect(setTaskItemChecked(source, 0, true)).toBe(
      ['```', '- [ ] not a task', '```', '- [x] real task'].join('\n')
    );
  });

  it('ignores task-looking lines inside an indented code block, as GitHub renders them', () => {
    const source = ['Intro', '', '    - [ ] example', '', '- [ ] real task'].join('\n');

    expect(countTaskItems(source)).toBe(1);
    expect(setTaskItemChecked(source, 0, true)).toBe(
      ['Intro', '', '    - [ ] example', '', '- [x] real task'].join('\n')
    );
  });

  it('keeps Windows line endings', () => {
    expect(setTaskItemChecked('- [ ] a\r\n- [ ] b\r\n', 1, true)).toBe('- [ ] a\r\n- [x] b\r\n');
  });

  it('refuses an index with no task item rather than editing the wrong line', () => {
    expect(() => setTaskItemChecked('- [ ] only', 3, true)).toThrow(/no task item/i);
    expect(() => setTaskItemChecked('plain text', 0, true)).toThrow(/no task item/i);
  });
});
