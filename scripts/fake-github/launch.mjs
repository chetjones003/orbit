// Starts the fake GitHub and runs Orbit's dev build (`tauri dev`) against it, with its own profile so a real install
// of Orbit and its saved sign-in are left alone.
//
//   npm run fake-dev                  the app against the fake, on 127.0.0.1:4010
//   npm run fake-dev -- --cdp 9222    also expose WebView2 DevTools on 127.0.0.1:9222, for scripted checks
//   npm run fake-dev -- --port 4011   use another port for the fake
//
// The profile is kept in your temp folder between runs, so repositories you track are remembered. Set
// ORBIT_USER_DATA to use another folder.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeGitHub } from './server.mjs';
import { DEMO_CUSTOM_VIEWS } from './demo-views.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Adds the demo custom views to the profile's settings, keeping everything already there. */
function seedDemoViews(profileDir) {
  const path = join(profileDir, 'settings.json');
  let settings = {};
  try {
    settings = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    settings = {};
  }
  const existing = Array.isArray(settings.customViews) ? settings.customViews : [];
  const have = new Set(existing.map((view) => view?.id));
  const missing = DEMO_CUSTOM_VIEWS.filter((view) => !have.has(view.id));
  if (missing.length === 0) return;
  settings.customViews = [...existing, ...missing];
  writeFileSync(path, JSON.stringify(settings, null, 2));
  console.log(`Added ${missing.length} demo custom views to the profile.`);
}

const argValue = (flag, fallback) => {
  const at = process.argv.indexOf(flag);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const port = Number(argValue('--port', 4010));
const cdpPort = argValue('--cdp', null);

const fake = await startFakeGitHub({ port });
const profile = process.env.ORBIT_USER_DATA ?? join(tmpdir(), 'orbit-fake-profile');
mkdirSync(profile, { recursive: true });
seedDemoViews(profile);

// Tauri needs cargo. rustup adds it to the user PATH, but terminals opened before that do not see it, so add it here.
const cargoBin = join(homedir(), '.cargo', 'bin');
const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
const env = {
  ...process.env,
  ORBIT_GITHUB_URL: fake.origin,
  ORBIT_USER_DATA: profile,
  [pathKey]: existsSync(cargoBin)
    ? `${cargoBin}${process.platform === 'win32' ? ';' : ':'}${process.env[pathKey] ?? ''}`
    : process.env[pathKey]
};
if (cdpPort) env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${Number(cdpPort)}`;

console.log(`Fake GitHub for demo-dev at ${fake.origin}`);
console.log(`Orbit profile: ${profile}`);
if (cdpPort) console.log(`WebView2 DevTools on http://127.0.0.1:${cdpPort}`);

const dev = spawn('npx tauri dev', { cwd: repoRoot, env, shell: true, stdio: 'inherit' });

let stopping = false;
const stop = (code) => {
  if (stopping) return;
  stopping = true;
  // The dev command starts Orbit as a child, so the whole tree goes.
  if (dev.pid && process.platform === 'win32') spawnSync('taskkill', ['/pid', String(dev.pid), '/T', '/F']);
  else if (dev.pid) dev.kill('SIGTERM');
  void fake.close().then(() => process.exit(code));
};
process.on('SIGINT', () => stop(0));
dev.on('exit', (code) => stop(code ?? 0));
