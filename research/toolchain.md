# Toolchain for Orbit: Electron + React + Tailwind + DaisyUI

Research for issue #2. Checked 2026-11-14. Version numbers come from the npm registry (`npm view <pkg> version`) on that date. Other claims cite the official docs, release notes, or source repo that owns them.

## Answer

| Concern | Pick | Pinned version |
|---|---|---|
| Runtime | Electron | `45.3.2` |
| Build / dev server | electron-vite on Vite 8 | `electron-vite@6.0.0`, `vite@8.3.8` |
| UI | React + `@vitejs/plugin-react` | `react@19.3.1`, `react-dom@19.3.1`, `@vitejs/plugin-react@6.3.0`, `@types/react@19.3.0` |
| CSS | Tailwind v4 (CSS-first) + Vite plugin | `tailwindcss@4.3.5`, `@tailwindcss/vite@4.3.5` |
| Components | daisyUI 5 as a Tailwind CSS plugin | `daisyui@5.8.0` |
| Packaging | electron-builder, one job per OS in a GitHub Actions matrix | `electron-builder@26.18.0` |
| Type checking | TypeScript 6 as `typescript` (needed by typescript-eslint). Optionally add TS 7 as a fast `tsc` | `typescript@6.0.3`, optionally `@typescript/native` aliased to `typescript@7.0.2` |
| Node (dev + CI) | Node 24 LTS (satisfies electron-vite/Vite `^20.19 \|\| >=22.12`) | `24.x` |

Scaffold with `npm create @quick-start/electron@latest orbit -- --template react-ts`, then apply the security changes below. The template ships with weaker defaults.

## 1. Scaffolding and dev server

### Options compared

| | electron-vite 6 | Electron Forge 8 + `@electron-forge/plugin-vite` | Plain Vite + custom scripts |
|---|---|---|---|
| Renderer HMR | Yes | Yes (load via `MAIN_WINDOW_VITE_DEV_SERVER_URL`) | Yes |
| Main/preload reload in dev | Hot reloading for main and preload | Not documented | You build it yourself |
| One config for main/preload/renderer | Yes (`electron.vite.config.ts`) | Yes, split across Forge config entries | No |
| TypeScript | `react-ts` template | Forge 8 removed `template-vite-typescript` | Manual |
| Vite support | Peer `vite ^6 \|\| ^7 \|\| ^8` | Targets Vite 8 | Any |
| Packaging | Bring your own (docs cover electron-builder and Forge) | Built in (makers) | Bring your own |
| Maturity | Stable, 6.0.0 released 2026-10-14 | Vite plugin left "experimental" in 8.0, but the docs page still says experimental | n/a |

Sources:
- electron-vite guide: a single config point for main, preload, and renderer; "instant Hot Module Replacement (HMR) for renderer processes" and hot reloading for main and preload; the `react-ts` template; requires Node 20.19+/22.12+. https://electron-vite.org/guide/
- electron-vite 6.0.0 release: adds Vite 8 and Rolldown (`rolldownOptions`), keeps Vite 6 and 7. https://github.com/alex8088/electron-vite/releases
- npm: `electron-vite@6.0.0` peer `vite: ^6.0.0 || ^7.0.0 || ^8.0.0` (`@swc/core` is an optional peer); engines `node ^20.19.0 || >=22.12.0`.
- Forge Vite plugin docs: "As of Electron Forge v7.5.0, Vite support for Electron Forge has been marked as experimental". HMR depends on the `*_VITE_DEV_SERVER_URL` and `*_VITE_NAME` globals. There are warnings about memory use and native modules. https://www.electronforge.io/config/plugins/vite
- Forge v8.0.1 release notes (2026-09-29): the Vite plugin is "covered by semver" and no longer experimental. It targets Vite 8, emits main and preload as `.cjs`, makes every `@electron-forge/*` package ESM-only, and requires Node 22.17+. It removes `template-vite-typescript` and deprecates `maker-appx` in favour of `maker-msix`. https://github.com/electron/forge/releases
- The Forge docs page and the release notes disagree on the "experimental" status. Treat the release notes as current.

**Why electron-vite:** It is the only option that reloads main and preload in dev, and it has a maintained React + TS template. It also lets you choose the packager, which matters for section 3. Forge 8's Vite plugin is a reasonable fallback now that it is stable. It is newer, though, and the docs lag behind it.

## 2. Tailwind CSS and daisyUI

- **Current majors:** Tailwind CSS 4 (`4.3.5`) and daisyUI 5 (`5.8.0`; the daisyUI site header also shows 5.8.0).
- **Tailwind v4 integration** has no `tailwind.config.js`. Install `tailwindcss` and `@tailwindcss/vite`, add `tailwindcss()` to the Vite plugins, then write `@import "tailwindcss";` in CSS. https://tailwindcss.com/docs/installation/using-vite
- **daisyUI 5** is loaded from CSS. https://daisyui.com/docs/install/ and https://daisyui.com/docs/themes/
  ```css
  @import "tailwindcss";
  @plugin "daisyui" {
    themes: light --default, dark --prefersdark;
  }
  ```
  To switch themes, set `data-theme` on `<html>` or any element.
- **Where it goes in electron-vite:** Add `tailwindcss()` to the `renderer.plugins` array only, next to `react()`, in `electron.vite.config.ts`. Main and preload have no CSS. `@tailwindcss/vite` peers on `vite ^5.2 || ^6 || ^7 || ^8`, so it works with Vite 8.
- **Electron-specific problems:** None found in primary sources. Tailwind v4 needs Chrome 111+ (https://tailwindcss.com/docs/compatibility), and Electron 45 ships Chromium 156 (https://www.electronjs.org/blog/electron-45-0). The only thing to watch is CSP. The template's CSP allows `style-src 'self' 'unsafe-inline'`, which Vite's dev-mode style injection needs. Built CSS is emitted as files, so you can tighten the CSP for production builds.

## 3. Packaging (unsigned Windows, macOS, Linux in GitHub Actions)

### Host constraints (both tools)

- electron-builder: "macOS Code Signing works only on macOS". Native dependencies "can only be compiled on the target platform unless prebuild is used". Windows targets can be built on Linux with Wine/Docker. https://www.electron.build/v26/docs/features/multi-platform-build/
- Forge: "You can only build the DMG target on macOS machines" (https://www.electronforge.io/config/makers/dmg.md). Squirrel.Windows needs Windows, or Linux with mono and wine (https://www.electronforge.io/config/makers/squirrel.windows.md).
- Either way, the practical setup is **one job per OS**: `windows-latest`, `macos-latest`, `ubuntu-latest`.

### electron-builder (recommended)

- The docs' GitHub Actions example uses `strategy.matrix.os: [macos-latest, windows-latest, ubuntu-latest]` and runs `npx electron-builder --publish never` for build-only jobs. `--publish always` with `GH_TOKEN` uploads to a release, and `releaseType: draft` creates draft releases. https://www.electron.build/v26/docs/features/github-actions
- electron-vite's distribution guide gives an `electron-builder.yml` and `build:win` / `build:mac` / `build:linux` scripts. Its CI example produces `.exe`, `.dmg`, `.AppImage`, and `.deb`. It also warns that Forge's fixed `out` directory "conflicts with electron-vite", so you must pass `--outDir=dist` if you use Forge. https://electron-vite.org/guide/distribution
- **Unsigned macOS:** "leave all `CSC_*` environment variables unset and set `CSC_IDENTITY_AUTO_DISCOVERY=false`", or set `mac.identity: null`. electron-builder "does **not** apply an ad-hoc signature automatically". You opt in to ad-hoc signing with `mac.identity: "-"`. On Apple Silicon, users can run unsigned apps after approving them in System Settings > Privacy & Security. https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/
- **Version note:** electron.build's unversioned `/docs/` pages describe unreleased v27. Use the `/v26/` pages, which match `electron-builder@26.18.0`.

### Forge makers (alternative)

Forge 8 has makers for Squirrel.Windows, WiX MSI, MSIX, DMG, pkg, ZIP, deb, RPM, Flatpak, and Snapcraft (https://www.electronforge.io/llms.txt). They need the same per-OS matrix. They also add the `out`/`dist` conflict with electron-vite and the Forge 8 ESM-only config change.

**Why electron-builder:** A single YAML config produces NSIS, dmg/zip, and AppImage/deb. It has an official GitHub Actions page and a documented unsigned path. The electron-vite docs and template use it directly.

## 4. Security defaults

From the Electron security checklist (https://www.electronjs.org/docs/latest/tutorial/security):

- `nodeIntegration` has been off by default since Electron 5. `contextIsolation` has been on by default since 12, and `sandbox` since 20. Keep all three at their defaults.
- Define a restrictive CSP (`script-src 'self'` …). Limit navigation (`will-navigate` → `preventDefault`) and deny unexpected windows with `setWindowOpenHandler` returning `{ action: 'deny' }`. Validate the `sender` of every IPC message. Don't pass untrusted URLs to `shell.openExternal`.
- Prefer a custom protocol (`protocol.handle`) over `file://` for local pages.
- Flip risky fuses (`runAsNode`, `nodeCliInspect`) with `@electron/fuses`.
- Preload: expose "one method per IPC message" with `contextBridge.exposeInMainWorld`. Never expose `ipcRenderer` or its `send`/`on` methods directly, and wrap callbacks so the event object isn't passed through. Type the exposed API with a `declare global { interface Window { … } }` file. https://www.electronjs.org/docs/latest/tutorial/context-isolation
- A sandboxed preload's `require` can only load `electron`, so the preload must be one bundle. https://www.electronjs.org/docs/latest/tutorial/sandbox
- **Electron 45 breaking change:** sandboxed preloads lose `Buffer`, `setImmediate`, and the `events`/`timers`/`url` shims, and `require()` loads only `electron`, `electron/renderer`, and `electron/common`. https://www.electronjs.org/blog/electron-45-0

### The electron-vite template must be changed

The `react-ts` template does three insecure things:
- It sets `webPreferences.sandbox: false`.
- It loads the production renderer with `loadFile` (`file://`).
- It exposes `@electron-toolkit/preload`'s `electronAPI`, which gives the renderer generic `ipcRenderer.send/invoke/on/...`.

Sources: https://github.com/alex8088/quick-start (`packages/create-electron/playground/react-ts/src/main/index.ts`, `src/preload/index.ts`) and https://github.com/alex8088/electron-toolkit/tree/master/packages/preload

To fix it:
1. Remove `sandbox: false`.
2. Bundle the preload into a single file. electron-vite's docs say "isolated build" (`preload.build.isolatedEntries: true`, `externalizeDeps: false`) "is a prerequisite for supporting the Electron sandbox". The feature is marked **experimental**. With one preload entry and no npm imports, a normal build already produces one file. https://electron-vite.org/guide/isolated-build
3. Keep the preload in CommonJS. electron-vite's docs say ESM preloads must be unsandboxed and use `.mjs`. https://electron-vite.org/guide/dev
4. Replace `electronAPI` with a narrow, typed `window.orbit` API: one function per IPC channel, all using `invoke`.
5. Serve the production renderer through a custom `app://` scheme registered with `protocol.handle`.

## Caveats

- **TypeScript 7:** `typescript@latest` is 7.0.2, the native Go compiler. It "does not ship with an API", and the 7.1 API will be "new (and different)". https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ `typescript-eslint@8.72.2` peers on `typescript >=4.8.4 <6.1.0` (npm). Pin `typescript@6.0.3`. For fast checks, add TS 7 under an alias such as `"@typescript/native": "npm:typescript@^7.0.2"`, which is the pattern the TS blog recommends.
- **Electron support window:** Electron supports the latest three stable majors (https://www.electronjs.org/docs/latest/tutorial/electron-timelines). Electron 45 went stable on 2026-10-20 with tentative EOL 2027-04-27. Electron 46 is due 2027-01-05 and moves to Node 26. https://releases.electronjs.org/schedule
- **Unsigned builds:** Windows SmartScreen and macOS Gatekeeper will warn users. That is expected for a personal app. The Apple Silicon ad-hoc signing behaviour (`mac.identity: "-"`) still needs to be tested on a real arm64 Mac in CI output.
- **Experimental pieces:** electron-vite's isolated build is experimental, and so is the Forge Vite plugin according to its own docs page.
- Forge 8 requires Node 22.17+ according to its release notes, while its npm `engines` says `>= 22.13.0`. Node 24 satisfies both.
