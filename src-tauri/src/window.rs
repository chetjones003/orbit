//! The main window: restores its last size and place, saves them as they change, and hides instead of closing
//! while the tray keeps Orbit running.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WindowEvent};

use crate::settings::WindowState;
use crate::tray;
use crate::services::Services;
use std::sync::Arc;

const SAVE_DELAY: Duration = Duration::from_millis(250);

/// Each geometry change bumps this; only the newest pending save writes.
static SAVE_GENERATION: AtomicU64 = AtomicU64::new(0);

/// Whether the main window has focus, kept from focus events. Asking the window directly was unreliable here.
static FOCUSED: AtomicBool = AtomicBool::new(false);
/// Set once the close-to-tray notice has been shown in this session.
static TRAY_NOTICE_SHOWN: AtomicBool = AtomicBool::new(false);

pub fn is_focused() -> bool {
    FOCUSED.load(Ordering::SeqCst)
}

/// Applies a saved window state. Position is kept only when it still lands on a visible monitor.
pub fn restore(app: &AppHandle, saved: Option<&WindowState>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Some(saved) = saved else {
        return;
    };
    let _ = window.set_size(tauri::LogicalSize::new(saved.width, saved.height));
    if let (Some(x), Some(y)) = (saved.x, saved.y) {
        let on_screen = window
            .available_monitors()
            .map(|monitors| {
                monitors.iter().any(|m| {
                    let pos = m.position();
                    let size = m.size();
                    let (mx, my) = (pos.x as f64, pos.y as f64);
                    let (mw, mh) = (size.width as f64, size.height as f64);
                    x + 100.0 > mx && x < mx + mw && y + 50.0 > my && y < my + mh
                })
            })
            .unwrap_or(false);
        if on_screen {
            let _ = window.set_position(tauri::LogicalPosition::new(x, y));
        }
    }
    if saved.maximized {
        let _ = window.maximize();
    }
}

/// Wires close-to-tray and geometry saving onto the main window.
pub fn attach(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    FOCUSED.store(window.is_focused().unwrap_or(false), Ordering::SeqCst);
    let handle = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(focused) => FOCUSED.store(*focused, Ordering::SeqCst),
        WindowEvent::CloseRequested { api, .. } => {
            let hide = tray::should_hide_on_close(tray::is_quitting(&handle), tray::tray_available(&handle))
                && crate::settings::close_to_tray();
            if hide {
                api.prevent_close();
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.hide();
                }
                // Say once per session that closing kept Orbit running, so the window does not seem to have vanished.
                if !TRAY_NOTICE_SHOWN.swap(true, std::sync::atomic::Ordering::Relaxed) {
                    use tauri_plugin_notification::NotificationExt;
                    let _ = handle
                        .notification()
                        .builder()
                        .title("Orbit is still running")
                        .body("Closing the window keeps Orbit in the system tray. Use the tray icon to reopen it or quit.")
                        .show();
                }
            }
        }
        WindowEvent::Resized(_) => {
            crate::shell::emit_state(&handle);
            schedule_save(&handle);
        }
        WindowEvent::Moved(_) => schedule_save(&handle),
        _ => {}
    });
}

fn schedule_save(app: &AppHandle) {
    let generation = SAVE_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SAVE_DELAY).await;
        if SAVE_GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        let Some(geometry) = geometry(&app) else {
            return;
        };
        let Some(state) = app.try_state::<Arc<Services>>() else {
            return;
        };
        let current = state.settings.load().await.window_state;
        // A maximized window keeps the normal size it returns to.
        let next = match (geometry.maximized, current) {
            (true, Some(prev)) => WindowState { maximized: true, ..prev },
            _ => geometry,
        };
        let _ = state.settings.save_window_state(next).await;
    });
}

/// The window's geometry in logical pixels.
fn geometry(app: &AppHandle) -> Option<WindowState> {
    let window = app.get_webview_window("main")?;
    let scale = window.scale_factor().ok()?;
    let maximized = window.is_maximized().ok()?;
    let size: PhysicalSize<u32> = window.inner_size().ok()?;
    let position: PhysicalPosition<i32> = window.outer_position().ok()?;
    let logical_size = size.to_logical::<f64>(scale);
    let logical_pos = position.to_logical::<f64>(scale);
    Some(WindowState {
        x: Some(logical_pos.x),
        y: Some(logical_pos.y),
        width: logical_size.width,
        height: logical_size.height,
        maximized,
        details_width: None,
    })
}
