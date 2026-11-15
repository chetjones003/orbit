// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomThemeEditor } from '../../../src/renderer/src/shell/CustomThemeEditor';

describe('CustomThemeEditor', () => {
  afterEach(() => cleanup());

  it('keeps Create theme disabled until the theme has a name', () => {
    render(<CustomThemeEditor initial={null} onSave={vi.fn()} onCancel={vi.fn()} />);
    const create = screen.getByRole('button', { name: 'Create theme' });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('e.g. Aurora'), { target: { value: 'Aurora' } });
    expect(create).toBeEnabled();
  });

  it('saves the named theme with the colours chosen for each variant', () => {
    const onSave = vi.fn();
    render(<CustomThemeEditor initial={null} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('e.g. Aurora'), { target: { value: '  Aurora  ' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Accent hex' }), { target: { value: '#00ff88' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create theme' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]?.[0];
    expect(saved.name).toBe('Aurora');
    expect(saved.id).toMatch(/^custom-/);
    expect(saved.dark.accent).toBe('#00ff88');
  });

  it('shows derived colours only under Advanced', () => {
    render(<CustomThemeEditor initial={null} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('textbox', { name: 'Border hex' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Advanced' }));
    expect(screen.getByRole('textbox', { name: 'Border hex' })).toBeInTheDocument();
  });
});
