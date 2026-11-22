<p align="center">
  <img src="./build/icon.png" width="80" height="80" alt="Orbit logo" />
</p>

<h1 align="center">Orbit</h1>

<p align="center">A desktop client for GitHub issues, pull requests, projects, and CI.</p>

<p align="center"><em>A vibe-coded piece of junk, usable for how I like to work. Feel free to play around with it.</em></p>

<p align="center">
  <a href="https://github.com/chetjones003/orbit/releases"><strong>Download</strong></a> ·
  <a href="https://github.com/chetjones003/orbit/issues">Issues</a> ·
  <a href="#development">Development</a> ·
  <a href="./LICENSE">License</a>
</p>

<p align="center">
  <img src="./docs/assets/social-preview.png" width="100%" alt="Orbit: issues, pull requests, project boards, and CI graphs in one desktop app" />
</p>

Orbit puts your GitHub work in one fast window. Issues and pull requests from every repo you track sit in one list. Open an item full screen, or keep it in a side panel while you work through the next one. Project boards, Gantt charts and CI workflow graphs are built in.

Orbit is built for your own repos. It signs in with GitHub, reads what you can already see, and writes only the changes you make.

## What you get

- **Every item in one list.** Issues and pull requests from all your tracked repositories, grouped by repo, with a state filter and refresh.
- **Side panel that stays out of the way.** One item at a time, floating over the workspace. Drag its edge to resize. A second pick replaces it. Double-click any item for full screen.
- **Projects.** Board, table, Gantt and calendar views over your GitHub Projects, with drag-and-drop on boards.
- **CI at a glance.** Workflow runs as a graph: which job failed, what ran in parallel, and how long each step took.
- **Pull requests you can finish.** Reviews, diffs, merge options and auto-merge without leaving Orbit.
- **Themes.** Light, dark or follow Windows. Five built-in palettes, your own themes, and themes from [Open VSX](https://open-vsx.org). Orbit reads only colours from a theme's package and never runs it.
- **Updates you control.** Orbit asks before it downloads a new version, and shows the release notes first.
- **Open.** GPL-3.0 licensed. Fork it, change it, ship your version.

## Install

### Download

Grab the installer for your system from the [latest release](https://github.com/chetjones003/orbit/releases/latest):

- **Windows:** the NSIS installer (x64)
- **macOS:** the DMG for Apple silicon (arm64) or Intel (x64)
- **Linux:** the AppImage or the `.deb` (x64)

Sign in with your GitHub account when Orbit opens. Orbit asks only for the access it needs to read and update your repos.

## First launch of unsigned builds

Orbit v1 is not code-signed or notarized, so each OS asks for confirmation the first time.

- **Windows:** SmartScreen shows "Windows protected your PC". Click **More info**, then **Run anyway**.
- **macOS:** Gatekeeper blocks a double-click. Right-click `Orbit.app`, choose **Open**, then **Open**
  again. If macOS still refuses, run `xattr -dr com.apple.quarantine /Applications/Orbit.app` once.
- **Linux (AppImage):** `chmod +x Orbit-*.AppImage`, then run it.
- **Linux (deb):** `sudo apt install ./Orbit-*-linux-x64.deb`.

## Releasing

Releases are cut from `main`. To release `X.Y.Z`:

1. Set `version` to `X.Y.Z` in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, then run `cargo check` in `src-tauri/` so `Cargo.lock` picks up the new version.
2. Merge that change into `main`.
3. Tag the merged commit `vX.Y.Z` and push the tag.

Pushing a tag `vX.Y.Z` runs `.github/workflows/release.yml`. It builds installers for Windows (NSIS), macOS (Apple silicon and Intel, DMG), and Linux (AppImage and .deb), signs the updater artifacts, and publishes the GitHub Release with `latest.json`, which installed copies read to offer updates. The updater replaces Windows, macOS, and AppImage installs. A `.deb` install is updated through its package manager, so Orbit points those users to the releases page.

The workflow needs two repository secrets, from the signing key generated with `npx tauri signer generate`:

- `TAURI_SIGNING_PRIVATE_KEY`: the contents of the private key file.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password.

Keep the private key and password out of the repository. Losing them means installed copies can no longer be updated, so store them in a password manager.

## Development

Requirements:

- Node.js 26.12.1 (see `.nvmrc`; `engine-strict` refuses other versions) and npm 11.
- Rust, stable, installed with [rustup](https://rustup.rs). On Windows, also the Microsoft C++ build tools. On Linux, the Tauri webview and tray libraries (`libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`).

```sh
nvm use            # or install Node 26.12.1 yourself
npm ci             # installs exactly what package-lock.json pins
npm run dev        # runs the app with hot reload (Vite renderer and Rust backend)
```

Orbit is a Tauri 2 app. The backend is Rust in `src-tauri/` (GitHub client, auth, settings, tray, notifications, updates). The interface is React 19 and TypeScript in `src/renderer/`, built with Vite, Tailwind CSS, daisyUI and [ui-sdk](https://ui-sdk.dev). Shared types are in `src/shared/`.

### Scripts

| Command                                   | What it does                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                             | Run the app with `tauri dev` (hot reload)                                                                                         |
| `npm run fake-dev`                        | Run the app against the fake GitHub on `127.0.0.1:4010`, seeded with demo repositories, projects, notifications and workflow runs |
| `npm run fake-dev -- --cdp`               | The same, plus WebView2 DevTools on port 9222, for scripted checks                                                                |
| `npm run fake-check`                      | Drive a running `fake-dev --cdp` app: sign in, push a review request, and check the in-app notification                           |
| `npm run fake-github`                     | Start only the fake GitHub server; point a build at it with `ORBIT_GITHUB_URL`                                                    |
| `npm run build`                           | Build the renderer with Vite into `dist/`                                                                                         |
| `npm run package`                         | Build installers for this machine with `tauri build`                                                                              |
| `npm run typecheck`                       | TypeScript for the Node tooling and the web app                                                                                   |
| `npm run lint`                            | ESLint                                                                                                                            |
| `npm run format` / `npm run format:check` | Prettier, write or check                                                                                                          |
| `npm run test:unit`                       | Renderer and shared unit tests (Vitest, jsdom)                                                                                    |
| `npm run icons`                           | Regenerate `build/icon.png` from `build/icon.svg`                                                                                 |
| `cargo test --locked` (in `src-tauri/`)   | Rust backend tests                                                                                                                |

### Testing

Before you open a pull request, run:

```sh
npm run format:check && npm run lint && npm run typecheck && npm run test:unit
cd src-tauri && cargo test --locked
```

Routine tests do not use real GitHub credentials. The fake GitHub server in `scripts/fake-github/` is the harness for the GitHub-facing code. To check the app end to end against it:

```sh
npm run fake-dev -- --cdp      # terminal 1: the app on the fake GitHub
npm run fake-check             # terminal 2: sign in, notify, and check the toast
```

`ORBIT_USER_DATA` overrides the profile folder, so a test run can use its own settings and sign-in.

### Building

`npm run package` builds the installer for the machine you run it on. The release targets (Windows x64, macOS arm64 and x64, Linux x64) are built in CI, not locally. macOS builds need the Xcode command line tools, and Linux builds need the packages listed above.

### CI

`.github/workflows/ci.yml` runs on every pull request:

1. **Verify** (Ubuntu): format, lint, typecheck and unit tests.
2. **Rust backend** (Windows): `cargo test --locked`.
3. **Package** (Windows x64, macOS arm64, macOS x64, Linux x64): `tauri build` for each platform. Each platform's installers are uploaded as `orbit-pr<N>-<sha>-<platform>` with 7-day retention. Downloads from a pull request check are for testing only.

## Releases and updates

`.github/workflows/release.yml` publishes a GitHub Release when a `vX.Y.Z` tag is pushed. It only publishes when:

1. the tag matches `version` in `package.json` and `src-tauri/tauri.conf.json`, and
2. the tagged commit is on `main`.

It then reruns every `ci.yml` check on all platforms, and a publish job builds, signs and uploads the installers and the updater manifest (`latest.json`). Releases are never prereleases.

Installed copies check for updates at startup, every four hours, and from **Check for updates** (topbar or tray). Updates are never offered for prereleases or older versions.

- **Windows, AppImage:** downloaded in the background. Orbit restarts only after you confirm. If you have unsent comments or edits, you are warned first.
- **Linux .deb:** downloaded and checked against its sha512, then installed with `pkexec`, which asks for administrator credentials.
- **macOS:** the DMG for your CPU architecture is downloaded, checked against its sha512, and opened. Drag Orbit into Applications to finish.

Development builds do not check for updates; **Check for updates** says so.

## Contributing

Open an issue before a large change so we can agree on the approach. Small, focused fixes are the easiest to review. Run `npm run typecheck`, `npm run lint`, `npm run format:check` and `npm run test:unit` before you open a pull request.

## License

Orbit is free software under the [GNU General Public License v3.0](./LICENSE). You may use, study, change and share it. Anything you distribute must also be GPL-3.0, with its source.
