// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/renderer/src/App';
import type { OrbitApi } from '../../../src/shared/ipc';

function installBridge(getInfo: OrbitApi['app']['getInfo']): void {
  window.orbit = {
    app: { getInfo, openExternal: vi.fn(async () => ({ opened: true })) }
  };
}

describe('App', () => {
  afterEach(() => {
    delete document.documentElement.dataset['orbitReady'];
  });

  it('shows app name, version, and platform from the preload bridge', async () => {
    installBridge(async () => ({ name: 'Orbit', version: '0.1.0', platform: 'win32' }));
    render(<App />);
    expect(await screen.findByText('Orbit 0.1.0 on win32')).toBeInTheDocument();
  });

  it('marks the document ready only after the bridge call resolves', async () => {
    installBridge(async () => ({ name: 'Orbit', version: '0.1.0', platform: 'linux' }));
    render(<App />);
    await waitFor(() => {
      expect(document.documentElement.dataset['orbitReady']).toBe('true');
    });
  });

  it('stays not-ready while the bridge call is pending', () => {
    installBridge(() => new Promise(() => {}));
    render(<App />);
    expect(screen.getByText('Starting…')).toBeInTheDocument();
    expect(document.documentElement.dataset['orbitReady']).toBeUndefined();
  });
});
