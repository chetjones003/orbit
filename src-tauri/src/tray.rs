//! System tray icon and the close-to-tray rule. Closing the window hides it while the tray keeps Orbit running.
//! Quitting, or a missing tray icon, always really closes, so the user can never lose the app.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

/// Set on the real quit path (tray menu, shell quit, OS shutdown). Closing the window alone only hides it.
#[derive(Default)]
pub struct Lifecycle {
    pub quitting: AtomicBool,
    pub tray_available: AtomicBool,
}

/// Pure rule for the window close button, kept free of Tauri so it can be tested.
pub fn should_hide_on_close(quitting: bool, tray_available: bool) -> bool {
    !quitting && tray_available
}

/// Tray menu entries as (id, label). A `None` label is a separator. Test-only: it documents the menu order.
#[cfg(test)]
pub fn tray_menu_entries() -> Vec<(&'static str, Option<&'static str>)> {
    vec![
        ("show", Some("Show Orbit")),
        ("check-updates", Some("Check for updates")),
        ("separator", None),
        ("quit", Some("Quit Orbit")),
    ]
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Orbit", true, None::<&str>)?;
    let updates = MenuItem::with_id(app, "check-updates", "Check for updates", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Orbit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &updates, &separator, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

    TrayIconBuilder::with_id("orbit-tray")
        .icon(icon)
        .tooltip("Orbit")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "check-updates" => {
                let _ = app.emit("updates:check-requested", ());
            }
            "quit" => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Shows and focuses the main window, from the tray or a notification click.
pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The real quit path. Marks quitting first so the close handler lets the window go.
pub fn quit_app(app: &AppHandle) {
    app.state::<Lifecycle>().quitting.store(true, Ordering::SeqCst);
    app.exit(0);
}

pub fn is_quitting(app: &AppHandle) -> bool {
    app.state::<Lifecycle>().quitting.load(Ordering::SeqCst)
}

pub fn tray_available(app: &AppHandle) -> bool {
    app.state::<Lifecycle>().tray_available.load(Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_hides_only_when_tray_exists_and_not_quitting() {
        assert!(should_hide_on_close(false, true));
        assert!(!should_hide_on_close(true, true));
        assert!(!should_hide_on_close(false, false));
        assert!(!should_hide_on_close(true, false));
    }

    #[test]
    fn tray_menu_order_matches_electron() {
        let labels: Vec<_> = tray_menu_entries().into_iter().map(|(_, l)| l).collect();
        assert_eq!(
            labels,
            vec![
                Some("Show Orbit"),
                Some("Check for updates"),
                None,
                Some("Quit Orbit")
            ]
        );
    }
}
