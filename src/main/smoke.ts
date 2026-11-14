import { app, type BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { HARDENED_WEB_PREFERENCES } from './window';

/**
 * Renderer-side readiness check, evaluated after the page loads. It also checks
 * at runtime that no Node globals leaked into the sandboxed page.
 */
const READY_SCRIPT = `(() => ({
  ready: document.documentElement.dataset.orbitReady === 'true',
  title: document.title,
  hasBridge: typeof window.orbit === 'object',
  nodeGlobalsAbsent: typeof require === 'undefined' && typeof process === 'undefined',
  // Strict CSP forbids eval; if eval runs, the policy was not applied to this page.
  cspActive: (() => { try { eval('0'); return false; } catch { return true; } })()
}))()`;

export interface SmokeReport {
  ok: boolean;
  ready: boolean;
  hasBridge: boolean;
  title: string;
  security: {
    hardenedPreferences: typeof HARDENED_WEB_PREFERENCES;
    nodeGlobalsAbsent: boolean;
    cspActive: boolean;
  };
  error?: string;
}

interface RendererState {
  ready: boolean;
  title: string;
  hasBridge: boolean;
  nodeGlobalsAbsent: boolean;
  cspActive: boolean;
}

/**
 * Diagnostics readiness signal for packaged smoke tests. It only reads state and
 * reports it; it does not change fuses, security settings, or authentication.
 */
export async function runSmokeTest(win: BrowserWindow, reportPath: string): Promise<void> {
  const report: SmokeReport = {
    ok: false,
    ready: false,
    hasBridge: false,
    title: '',
    security: {
      hardenedPreferences: HARDENED_WEB_PREFERENCES,
      nodeGlobalsAbsent: false,
      cspActive: false
    }
  };

  try {
    await waitForRenderer(win, report);
    report.ok =
      report.ready &&
      report.hasBridge &&
      report.security.nodeGlobalsAbsent &&
      report.security.cspActive &&
      HARDENED_WEB_PREFERENCES.sandbox &&
      HARDENED_WEB_PREFERENCES.contextIsolation &&
      !HARDENED_WEB_PREFERENCES.nodeIntegration;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  }

  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  app.exit(report.ok ? 0 : 1);
}

function waitForRenderer(win: BrowserWindow, report: SmokeReport): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 30_000;
    const poll = async (): Promise<void> => {
      if (Date.now() > deadline) {
        reject(new Error('renderer not ready within 30s'));
        return;
      }
      try {
        const state = (await win.webContents.executeJavaScript(READY_SCRIPT)) as RendererState;
        report.title = state.title;
        report.hasBridge = state.hasBridge;
        report.ready = state.ready;
        report.security.nodeGlobalsAbsent = state.nodeGlobalsAbsent;
        report.security.cspActive = state.cspActive;
        if (state.ready) {
          resolve();
          return;
        }
      } catch {
        // Page not loaded yet; keep polling until the deadline.
      }
      setTimeout(() => void poll(), 250);
    };
    void poll();
  });
}
