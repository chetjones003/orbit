// Starts the fake GitHub and launches Orbit against it, with its own profile so a real install of Orbit
// and its saved sign-in are left alone. Run after `electron-vite build` (`npm run fake-app` does both).
//
//   node scripts/fake-github/launch.mjs [--port 4010]
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeGitHub } from './server.mjs';
import { DEMO_CUSTOM_VIEWS } from './demo-views.mjs';

const require = createRequire(import.meta.url);

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
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const portArg = process.argv.indexOf('--port');
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 4010;

const fake = await startFakeGitHub({ port });
// One profile for the fake account, so the repositories you track survive restarts, as they do for a real account.
const profile = join(tmpdir(), 'orbit-fake-profile');
mkdirSync(profile, { recursive: true });
// The demo views are added when missing, so views you edit or add in this profile are kept.
seedDemoViews(profile);
// `electron` exports the path to the Electron binary when required from Node.
const electronBinary = require('electron');
const env = { ...process.env, ORBIT_GITHUB_URL: fake.origin };
delete env['ELECTRON_RUN_AS_NODE'];

console.log(`Fake GitHub for demo-dev at ${fake.origin}`);
console.log(`Orbit profile: ${profile}`);

// `--cdp <port>` exposes Chromium DevTools on that loopback port, for scripted checks.
const cdpArg = process.argv.indexOf('--cdp');
const cdp = cdpArg > 0 ? [`--remote-debugging-port=${Number(process.argv[cdpArg + 1])}`] : [];
const app = spawn(electronBinary, [repoRoot, `--user-data-dir=${profile}`, ...cdp], {
  env,
  stdio: 'inherit'
});
const stop = async () => {
  app.kill();
  await fake.close();
};
process.on('SIGINT', () => void stop().then(() => process.exit(0)));
app.on('exit', (code) => {
  void fake.close().then(() => process.exit(code ?? 0));
});
