# Orbit

A cross-platform desktop client for GitHub issues and pull requests on your personal repos.
Built with React, Tailwind CSS, DaisyUI, and Electron.

![Orbit logo reference](docs/assets/orbit-logo-reference.png)

Planning happens in this repo's Issues: start from the issue labelled `wayfinder:map`.

## Setup

Requirements:

- Node.js **24.11.0** (see `.nvmrc`; `engine-strict` is on, so other versions are refused)
- npm 11 (ships with Node 24)

```sh
nvm use            # or install Node 24.11.0 yourself
npm ci             # installs exactly what package-lock.json pins
npm run dev        # starts the app with hot reload
```

Dependencies are pinned to exact versions (`save-exact`): Electron 45, electron-vite 6, Vite 8,
React 19, Tailwind CSS 4 with daisyUI 5.

## Scripts

| Script                     | What it does                                                           |
| -------------------------- | ---------------------------------------------------------------------- |
| `npm run dev`              | Run the app with electron-vite dev server                              |
| `npm run build`            | Build main, preload, and renderer into `out/`                          |
| `npm run typecheck`        | Strict TypeScript for main/preload/shared and renderer                 |
| `npm run lint`             | ESLint (flat config, typescript-eslint)                                |
| `npm run format:check`     | Prettier check (`npm run format` to fix)                               |
| `npm run test:unit`        | Vitest unit tests and React Testing Library component tests            |
| `npm run test:integration` | Real-Electron launch against the built app (needs `npm run build`)     |
| `npm run test:e2e`         | Playwright tests (packaged app; set `ORBIT_E2E_EXECUTABLE`)            |
| `npm run package`          | Build and package with electron-builder for the current OS             |
| `npm run smoke -- <exe>`   | Smoke-test one packaged executable signed out with an isolated profile |

Routine tests do not use real GitHub credentials. The controlled
fake GitHub server in `tests/fakes/` is the harness for the GitHub-facing slices.

## Packaging

`electron-builder.yml` defines the targets:

- **Windows:** per-user NSIS installer (x64) and an unpacked app
- **macOS:** DMG for arm64 and x64
- **Linux:** AppImage and `.deb` (x64)

Builds are unsigned. Security fuses are flipped on the packaged app by `scripts/after-pack.cjs`.
They are never relaxed for tests. Icons are generated from `docs/assets/orbit-logo-reference.png`
by `node scripts/generate-icons.mjs`.

## First launch of unsigned builds

Orbit v1 is not code-signed or notarized, so each OS asks for confirmation the first time.

- **Windows:** SmartScreen shows "Windows protected your PC". Click **More info**, then **Run anyway**.
- **macOS:** Gatekeeper blocks a double-click. Right-click `Orbit.app`, choose **Open**, then **Open**
  again. If macOS still refuses, run `xattr -dr com.apple.quarantine /Applications/Orbit.app` once.
- **Linux (AppImage):** `chmod +x Orbit-*.AppImage`, then run it.
- **Linux (deb):** `sudo apt install ./Orbit-*-linux-x64.deb`.

## CI

`.github/workflows/ci.yml` runs on every pull request:

1. **Verify** on Ubuntu: format, lint, typecheck, unit tests, build, and integration tests under xvfb.
2. **Package and smoke** on Windows x64, macOS arm64, macOS x64 (smoke-tested under Rosetta), and Linux x64.
   Each packaged artifact is launched signed out with an isolated profile. The app must load its window
   and bundled assets, then exit with code 0.

Installers are uploaded as `orbit-pr<N>-<shortsha>-<os>-<arch>` with 7-day retention. Downloads
from a PR check are for testing only.

## Releases and updates

`.github/workflows/release.yml` publishes a GitHub Release when a `vX.Y.Z` tag is pushed. It only
publishes when:

1. the tag matches `version` in `package.json`, and
2. the tagged commit is on `main`.

It then reruns every `ci.yml` check on all platforms and packaged smoke tests. A single publish job
creates the release with the installers and `latest*.yml` metadata. The two macOS architectures'
metadata is merged by `scripts/merge-update-metadata.mjs`. Releases are never prereleases.

Installed copies check for updates at startup, every four hours, and from **Check for updates** (topbar
or tray). Updates are never offered for prereleases or older versions.

- **Windows, AppImage:** downloaded in the background. Orbit restarts only after you confirm. If you
  have unsent comments or edits, you are warned first.
- **Linux .deb:** downloaded and checked against its sha512, then installed with `pkexec`, which asks for
  administrator credentials.
- **macOS:** the DMG for your CPU architecture is downloaded, checked against its sha512, and opened.
  Drag Orbit into Applications to finish.
