// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeImportDialog } from '../../../src/renderer/src/shell/ThemeImportDialog';

describe('ThemeImportDialog', () => {
  afterEach(() => cleanup());

  it('shows the title of each theme, with its publisher and an Add button', async () => {
    Object.assign(window, {
      orbit: {
        themes: {
          search: vi.fn(async () => [
            {
              namespace: 'dracula-theme',
              name: 'theme-dracula',
              displayName: 'Dracula Theme Official',
              description: 'A dark theme',
              downloads: 465428,
              verified: true,
              icon: null
            }
          ]),
          import: vi.fn()
        }
      }
    });
    render(<ThemeImportDialog onAdd={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('Dracula Theme Official')).toBeInTheDocument();
    expect(screen.getByText(/dracula-theme · 465,428 downloads/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Dracula Theme Official' })).toBeInTheDocument();
    await waitFor(() =>
      expect(window.orbit.themes.search).toHaveBeenCalledWith({ query: '', sort: 'downloadCount' })
    );
  });
});
