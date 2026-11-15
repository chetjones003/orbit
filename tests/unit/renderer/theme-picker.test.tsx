// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemePicker } from '../../../src/renderer/src/shell/ThemePicker';
import { resolveColorScheme } from '../../../src/renderer/src/shell/theme';

function setup(overrides: { colorScheme?: 'system' | 'light' | 'dark'; systemPrefersDark?: boolean } = {}) {
  const onColorScheme = vi.fn();
  const onPalette = vi.fn();
  render(
    <ThemePicker
      colorScheme={overrides.colorScheme ?? 'dark'}
      palette="orbit"
      systemPrefersDark={overrides.systemPrefersDark ?? false}
      onColorScheme={onColorScheme}
      onPalette={onPalette}
      customThemes={[]}
      onSaveCustomTheme={vi.fn()}
      onDeleteCustomTheme={vi.fn()}
    />
  );
  return { onColorScheme, onPalette };
}

describe('ThemePicker', () => {
  afterEach(() => cleanup());

  it('picks a colour scheme and marks the current one', () => {
    const { onColorScheme } = setup({ colorScheme: 'dark' });
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(onColorScheme).toHaveBeenCalledWith('system');
  });

  it('picks a palette from the grid', () => {
    const { onPalette } = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Ocean' }));
    expect(onPalette).toHaveBeenCalledWith('ocean');
  });

  it('shows what System resolves to right now', () => {
    setup({ colorScheme: 'system', systemPrefersDark: true });
    expect(screen.getByText('Follows Windows: dark now.')).toBeInTheDocument();
  });
});

describe('resolveColorScheme', () => {
  it('follows Windows only for System', () => {
    expect(resolveColorScheme('system', true)).toBe('dark');
    expect(resolveColorScheme('system', false)).toBe('light');
    expect(resolveColorScheme('light', true)).toBe('light');
    expect(resolveColorScheme('dark', false)).toBe('dark');
  });
});
