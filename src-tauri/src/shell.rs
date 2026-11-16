//! `shell:*` commands. Mirrors `src/main/shell-actions.ts`. Only the window and editing actions the title bar
//! uses are accepted; anything else fails to deserialize and is refused.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::tray;

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct ShellState {
    pub maximized: bool,
    pub fullscreen: bool,
}

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum ShellAction {
    Minimize,
    ToggleMaximize,
    Close,
    ToggleFullscreen,
    ZoomIn,
    ZoomOut,
    ZoomReset,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Quit,
}

/// Zoom in percent. 100 is the default.
static ZOOM_PERCENT: AtomicU32 = AtomicU32::new(100);

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window is not open".to_string())
}

/// Pushes maximize and full-screen changes to the page, which the title bar shows as Restore and Maximize.
pub fn emit_state(app: &AppHandle) {
    use tauri::Emitter;
    if let Ok(window) = main_window(app) {
        if let Ok(state) = state_of(&window) {
            let _ = app.emit("shell:state-changed", state);
        }
    }
}

fn state_of(window: &WebviewWindow) -> Result<ShellState, String> {
    Ok(ShellState {
        maximized: window.is_maximized().map_err(|e| e.to_string())?,
        fullscreen: window.is_fullscreen().map_err(|e| e.to_string())?,
    })
}

#[tauri::command]
pub fn shell_get_state(app: AppHandle) -> Result<ShellState, String> {
    state_of(&main_window(&app)?)
}

#[tauri::command]
pub fn shell_control(app: AppHandle, action: ShellAction) -> Result<(), String> {
    let window = main_window(&app)?;
    match action {
        ShellAction::Minimize => window.minimize().map_err(|e| e.to_string())?,
        ShellAction::ToggleMaximize => {
            if window.is_maximized().map_err(|e| e.to_string())? {
                window.unmaximize().map_err(|e| e.to_string())?
            } else {
                window.maximize().map_err(|e| e.to_string())?
            }
        }
        // Routed through the close handler, so with a tray icon the window hides instead of closing.
        ShellAction::Close => window.close().map_err(|e| e.to_string())?,
        ShellAction::ToggleFullscreen => {
            let full = window.is_fullscreen().map_err(|e| e.to_string())?;
            window.set_fullscreen(!full).map_err(|e| e.to_string())?
        }
        ShellAction::ZoomIn => set_zoom(&window, ZOOM_PERCENT.load(Ordering::SeqCst) + 10)?,
        ShellAction::ZoomOut => set_zoom(&window, ZOOM_PERCENT.load(Ordering::SeqCst).saturating_sub(10))?,
        ShellAction::ZoomReset => set_zoom(&window, 100)?,
        ShellAction::Undo => exec_command(&window, "undo")?,
        ShellAction::Redo => exec_command(&window, "redo")?,
        ShellAction::Cut => exec_command(&window, "cut")?,
        ShellAction::Copy => exec_command(&window, "copy")?,
        ShellAction::Paste => exec_command(&window, "paste")?,
        ShellAction::SelectAll => exec_command(&window, "selectAll")?,
        ShellAction::Quit => tray::quit_app(&app),
    }
    Ok(())
}

fn set_zoom(window: &WebviewWindow, percent: u32) -> Result<(), String> {
    let clamped = percent.clamp(50, 200);
    ZOOM_PERCENT.store(clamped, Ordering::SeqCst);
    window
        .set_zoom(f64::from(clamped) / 100.0)
        .map_err(|e| e.to_string())
}

/// Runs a document editing command in the page, the same way the Electron menu roles did.
fn exec_command(window: &WebviewWindow, command: &str) -> Result<(), String> {
    window
        .eval(format!("document.execCommand('{command}')"))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::ShellAction;

    #[test]
    fn accepts_the_title_bar_actions() {
        for name in [
            "minimize",
            "toggle-maximize",
            "close",
            "toggle-fullscreen",
            "zoom-in",
            "zoom-out",
            "zoom-reset",
            "undo",
            "redo",
            "cut",
            "copy",
            "paste",
            "select-all",
            "quit",
        ] {
            let parsed: Result<ShellAction, _> = serde_json::from_str(&format!("\"{name}\""));
            assert!(parsed.is_ok(), "{name} should be accepted");
        }
    }

    #[test]
    fn refuses_unknown_actions() {
        let parsed: Result<ShellAction, _> = serde_json::from_str("\"reload\"");
        assert!(parsed.is_err());
    }
}
