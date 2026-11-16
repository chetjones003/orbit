/**
 * Update status shared by the backend and the renderer. Checks, eligibility (stable releases only) and signature
 * verification live in the backend, which uses Tauri's updater.
 */
export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date'; checkedAt: number }
  /** A newer release exists. Nothing is downloaded until the user asks for it. */
  | { kind: 'available'; version: string; releaseNotes: string | null }
  | { kind: 'downloading'; version: string; percent: number }
  /** Downloaded, verified and waiting for the user to confirm the restart. */
  | { kind: 'ready'; version: string; releaseNotes: string | null }
  | { kind: 'error'; message: string };
