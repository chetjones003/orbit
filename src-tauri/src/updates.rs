//! Update checks, downloads, and the confirmed install, on Tauri's updater. Every update is signed; the app only
//! accepts one that verifies against the public key in tauri.conf.json. Nothing downloads until the user asks, and
//! nothing installs until the user confirms.

use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt};

pub const UPDATE_CHECK_INTERVAL: Duration = Duration::from_secs(4 * 60 * 60);

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum UpdateStatus {
    Idle,
    Checking,
    UpToDate { checked_at: i64 },
    Available { version: String, release_notes: Option<String> },
    Downloading { version: String, percent: u8 },
    Ready { version: String, release_notes: Option<String> },
    Error { message: String },
}

/// A stable `x.y.z` release strictly newer than `current`. Prereleases and older versions are refused.
pub fn is_eligible_update(candidate: &str, current: &str) -> bool {
    fn parse(v: &str) -> Option<[u64; 3]> {
        let mut parts = v.split('.');
        let a = parts.next()?;
        let b = parts.next()?;
        let c = parts.next()?;
        if parts.next().is_some() {
            return None;
        }
        let digits = |s: &str| !s.is_empty() && s.bytes().all(|x| x.is_ascii_digit());
        if !(digits(a) && digits(b) && digits(c)) {
            return None;
        }
        Some([a.parse().ok()?, b.parse().ok()?, c.parse().ok()?])
    }
    match (parse(candidate), parse(current)) {
        (Some(next), Some(now)) => next > now,
        _ => false,
    }
}

/// The updater can replace the app on Windows, macOS and AppImage installs. A Linux .deb install is updated
/// through its package manager, so the updater does not touch it.
pub fn updates_supported(os: &str, running_from_appimage: bool) -> bool {
    os != "linux" || running_from_appimage
}

/// The offered update, and once downloaded, its signed bytes waiting for the user's confirmation.
struct Pending {
    update: Update,
    bytes: Option<Vec<u8>>,
}

pub struct UpdateService {
    app: AppHandle,
    status: Mutex<UpdateStatus>,
    pending: Mutex<Option<Pending>>,
    on_change: Arc<dyn Fn(UpdateStatus) + Send + Sync>,
}

impl UpdateService {
    pub fn new(app: AppHandle, on_change: Arc<dyn Fn(UpdateStatus) + Send + Sync>) -> Arc<Self> {
        Arc::new(Self {
            app,
            status: Mutex::new(UpdateStatus::Idle),
            pending: Mutex::new(None),
            on_change,
        })
    }

    pub fn status(&self) -> UpdateStatus {
        self.status.lock().expect("update status poisoned").clone()
    }

    fn set(&self, next: UpdateStatus) {
        *self.status.lock().expect("update status poisoned") = next.clone();
        (self.on_change)(next);
    }

    /// Looks for an update. Never fails; problems become an error status with a generic message.
    pub async fn check(&self) -> UpdateStatus {
        // Unpackaged (debug) builds have no release to compare against.
        if cfg!(debug_assertions) {
            self.set(UpdateStatus::Error {
                message: "Updates are checked in installed release builds, not in development builds.".into(),
            });
            return self.status();
        }
        if !updates_supported(std::env::consts::OS, std::env::var_os("APPIMAGE").is_some()) {
            self.set(UpdateStatus::Error {
                message: "Updates for this install come from the Orbit releases page.".into(),
            });
            return self.status();
        }
        // Once a downloaded update waits for confirmation, a further check would only repeat it.
        if self.pending.lock().expect("pending poisoned").as_ref().is_some_and(|p| p.bytes.is_some()) {
            return self.status();
        }
        self.set(UpdateStatus::Checking);
        let current = self.app.package_info().version.to_string();
        let outcome = match self.app.updater() {
            Ok(updater) => updater.check().await.map_err(|e| e.to_string()),
            Err(e) => Err(e.to_string()),
        };
        match outcome {
            Ok(Some(update)) if is_eligible_update(&update.version, &current) => {
                let version = update.version.clone();
                let release_notes = update.body.clone().filter(|b| !b.trim().is_empty());
                *self.pending.lock().expect("pending poisoned") = Some(Pending { update, bytes: None });
                self.set(UpdateStatus::Available { version, release_notes });
            }
            Ok(_) => {
                *self.pending.lock().expect("pending poisoned") = None;
                self.set(UpdateStatus::UpToDate {
                    checked_at: chrono::Utc::now().timestamp_millis(),
                });
            }
            // The message stays generic: error text from a network stack can carry URLs or account details.
            Err(_) => self.set(UpdateStatus::Error {
                message: "Orbit could not check for or download an update.".into(),
            }),
        }
        self.status()
    }

    /// Downloads the offered update. Called only after the user asks for it; a no-op otherwise.
    pub async fn download(self: &Arc<Self>) -> UpdateStatus {
        let taken = {
            let status = self.status();
            let mut pending = self.pending.lock().expect("pending poisoned");
            match (status, pending.take()) {
                (UpdateStatus::Available { .. }, Some(p)) => Some(p),
                (_, other) => {
                    *pending = other;
                    None
                }
            }
        };
        let Some(Pending { update, .. }) = taken else {
            return self.status();
        };
        let version = update.version.clone();
        let release_notes = update.body.clone().filter(|b| !b.trim().is_empty());
        self.set(UpdateStatus::Downloading {
            version: version.clone(),
            percent: 0,
        });

        let downloaded = AtomicU64::new(0);
        let progress_service = Arc::clone(self);
        let progress_version = version.clone();
        let result = update
            .download(
                move |chunk, total| {
                    let so_far = downloaded.fetch_add(chunk as u64, Ordering::Relaxed) + chunk as u64;
                    if let Some(total) = total.filter(|t| *t > 0) {
                        let percent = ((so_far.saturating_mul(100)) / total).min(100) as u8;
                        progress_service.set(UpdateStatus::Downloading {
                            version: progress_version.clone(),
                            percent,
                        });
                    }
                },
                || {},
            )
            .await;

        match result {
            Ok(bytes) => {
                *self.pending.lock().expect("pending poisoned") = Some(Pending {
                    update,
                    bytes: Some(bytes),
                });
                self.set(UpdateStatus::Ready { version, release_notes });
            }
            Err(_) => self.set(UpdateStatus::Error {
                message: "Orbit could not download the update.".into(),
            }),
        }
        self.status()
    }

    /// Installs the downloaded update, then restarts. Called only after the user has confirmed.
    pub async fn install(&self) -> Result<(), String> {
        let ready = {
            let mut pending = self.pending.lock().expect("pending poisoned");
            match pending.take() {
                Some(Pending { update, bytes: Some(bytes) }) => (update, bytes),
                other => {
                    *pending = other;
                    return Err("No update is ready to install".into());
                }
            }
        };
        let (update, bytes) = ready;
        update.install(bytes).map_err(|_| "The update could not be installed".to_string())?;
        self.app.restart();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_deb_installs_are_not_updated_in_place() {
        assert!(updates_supported("windows", false));
        assert!(updates_supported("macos", false));
        assert!(updates_supported("linux", true));
        assert!(!updates_supported("linux", false));
    }

    #[test]
    fn only_newer_stable_releases_are_offered() {
        assert!(is_eligible_update("0.4.2", "0.4.1"));
        assert!(is_eligible_update("1.0.0", "0.9.9"));
        assert!(!is_eligible_update("0.4.1", "0.4.1"));
        assert!(!is_eligible_update("0.3.9", "0.4.1"));
        assert!(!is_eligible_update("0.5.0-beta.1", "0.4.1"));
    }
}
