import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { installTauriBridge } from './tauri-bridge';
import { keepShellFixed } from './shell/fixed-shell';

// Under Tauri there is no preload script, so the bridge installs window.orbit before the first render.
if ('__TAURI_INTERNALS__' in window) installTauriBridge();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

keepShellFixed();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
