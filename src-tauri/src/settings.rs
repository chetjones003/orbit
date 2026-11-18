//! User preferences. Only preferences are stored here; GitHub responses and credentials never are.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::Mutex;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    pub width: f64,
    pub height: f64,
    pub maximized: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details_width: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrbitSettings {
    pub pinned_repo_ids: Vec<u64>,
    /// Definitions of custom views. Never item data.
    pub custom_views: Vec<serde_json::Value>,
    pub color_scheme: String,
    pub custom_themes: Vec<serde_json::Value>,
    pub palette: String,
    pub open_items_in: String,
    pub motion: String,
    pub interface_font: String,
    pub interface_font_size: u32,
    pub monospace_font: String,
    pub monospace_font_size: u32,
    pub word_wrap: bool,
    /// When an issue or pull request card opens on hover: "off", "quick", "normal" or "slow".
    pub hover_cards: String,
    /// Keys in the file editor: "standard" or "vim".
    pub editor_keys: String,
    /// Long lines wrap onto the next line in the file editor, rather than running off to the side.
    pub editor_word_wrap: bool,
    /// Closing the window hides Orbit to the tray, when the tray is available.
    pub close_to_tray: bool,
    /// Shows a Windows notification for new GitHub activity while the window is hidden or unfocused.
    pub desktop_notifications: bool,
    /// Minutes between checks of GitHub: one of the refresh engine's polling choices.
    pub poll_minutes: u32,
    /// Opens Orbit when the person signs in to Windows.
    pub start_at_login: bool,
    /// 0 to 200. 100 is the theme as designed.
    pub contrast: u32,
    /// 0 to 100. 100 keeps menus, dialogs and the composer solid.
    pub glass_opacity: u32,
    pub window_state: Option<WindowState>,
    pub public_upload_notice_acknowledged: bool,
}

impl Default for OrbitSettings {
    fn default() -> Self {
        Self {
            pinned_repo_ids: vec![],
            custom_views: vec![],
            color_scheme: "dark".into(),
            custom_themes: vec![],
            palette: "orbit".into(),
            open_items_in: "side".into(),
            motion: "always".into(),
            interface_font: "inter".into(),
            interface_font_size: 14,
            monospace_font: "code-new-roman".into(),
            monospace_font_size: 13,
            word_wrap: true,
            hover_cards: "normal".into(),
            editor_keys: "standard".into(),
            editor_word_wrap: false,
            close_to_tray: true,
            desktop_notifications: true,
            poll_minutes: 1,
            start_at_login: false,
            contrast: 100,
            glass_opacity: 100,
            window_state: None,
            public_upload_notice_acknowledged: false,
        }
    }
}

/// Partial update from the renderer. Fields absent here keep their stored value.
#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdate {
    pub pinned_repo_ids: Option<Vec<u64>>,
    pub custom_views: Option<Vec<serde_json::Value>>,
    pub color_scheme: Option<String>,
    pub palette: Option<String>,
    pub custom_themes: Option<Vec<serde_json::Value>>,
    pub open_items_in: Option<String>,
    pub motion: Option<String>,
    pub interface_font: Option<String>,
    pub interface_font_size: Option<u32>,
    pub monospace_font: Option<String>,
    pub monospace_font_size: Option<u32>,
    pub word_wrap: Option<bool>,
    pub hover_cards: Option<String>,
    pub editor_keys: Option<String>,
    pub editor_word_wrap: Option<bool>,
    pub close_to_tray: Option<bool>,
    pub desktop_notifications: Option<bool>,
    pub poll_minutes: Option<u32>,
    pub start_at_login: Option<bool>,
    pub contrast: Option<u32>,
    pub glass_opacity: Option<u32>,
    pub details_width: Option<f64>,
}

static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);
static DESKTOP_NOTIFICATIONS: AtomicBool = AtomicBool::new(true);

/// Copies the preferences the window and notification code read synchronously. Called on load and on every save.
pub fn apply_prefs(settings: &OrbitSettings) {
    CLOSE_TO_TRAY.store(settings.close_to_tray, Ordering::Relaxed);
    DESKTOP_NOTIFICATIONS.store(settings.desktop_notifications, Ordering::Relaxed);
    crate::github::refresh::set_poll_interval_minutes(u64::from(settings.poll_minutes));
}

pub fn close_to_tray() -> bool {
    CLOSE_TO_TRAY.load(Ordering::Relaxed)
}

pub fn desktop_notifications() -> bool {
    DESKTOP_NOTIFICATIONS.load(Ordering::Relaxed)
}

pub struct SettingsStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl SettingsStore {
    pub fn new(user_data: &Path) -> Self {
        Self {
            path: user_data.join("settings.json"),
            lock: Mutex::new(()),
        }
    }

    pub async fn load(&self) -> OrbitSettings {
        match tokio::fs::read_to_string(&self.path).await {
            Ok(raw) => match serde_json::from_str::<serde_json::Value>(&raw) {
                Ok(value) => normalize(value),
                Err(_) => OrbitSettings::default(),
            },
            Err(_) => OrbitSettings::default(),
        }
    }

    pub async fn update(&self, update: SettingsUpdate) -> Result<OrbitSettings, String> {
        let _guard = self.lock.lock().await;
        let current = self.load().await;
        let mut next = current.clone();
        if let Some(v) = update.pinned_repo_ids {
            next.pinned_repo_ids = v;
        }
        if let Some(v) = update.custom_views {
            next.custom_views = v;
        }
        if let Some(v) = update.color_scheme {
            next.color_scheme = v;
        }
        if let Some(v) = update.palette {
            next.palette = v;
        }
        if let Some(v) = update.custom_themes {
            next.custom_themes = v;
        }
        if let Some(v) = update.open_items_in {
            next.open_items_in = v;
        }
        if let Some(v) = update.motion {
            next.motion = v;
        }
        if let Some(v) = update.interface_font {
            next.interface_font = v;
        }
        if let Some(v) = update.interface_font_size {
            next.interface_font_size = v;
        }
        if let Some(v) = update.monospace_font {
            next.monospace_font = v;
        }
        if let Some(v) = update.monospace_font_size {
            next.monospace_font_size = v;
        }
        if let Some(v) = update.word_wrap {
            next.word_wrap = v;
        }
        if let Some(v) = update.hover_cards {
            next.hover_cards = v;
        }
        if let Some(v) = update.editor_keys {
            next.editor_keys = v;
        }
        if let Some(v) = update.editor_word_wrap {
            next.editor_word_wrap = v;
        }
        if let Some(v) = update.close_to_tray {
            next.close_to_tray = v;
        }
        if let Some(v) = update.desktop_notifications {
            next.desktop_notifications = v;
        }
        if let Some(v) = update.poll_minutes {
            next.poll_minutes = v;
        }
        if let Some(v) = update.start_at_login {
            next.start_at_login = v;
        }
        if let Some(v) = update.contrast {
            next.contrast = v;
        }
        if let Some(v) = update.glass_opacity {
            next.glass_opacity = v;
        }
        if let Some(width) = update.details_width {
            let mut state = current.window_state.clone().unwrap_or(WindowState {
                x: None,
                y: None,
                width: 1100.0,
                height: 720.0,
                maximized: false,
                details_width: None,
            });
            state.details_width = Some(width);
            next.window_state = Some(state);
        }
        let next = normalize(serde_json::to_value(&next).map_err(|e| e.to_string())?);
        self.save(&next).await?;
        Ok(next)
    }

    /// Only the app calls this; the renderer cannot set it through `update`.
    pub async fn acknowledge_public_upload_notice(&self) -> Result<(), String> {
        let _guard = self.lock.lock().await;
        let mut current = self.load().await;
        current.public_upload_notice_acknowledged = true;
        self.save(&current).await
    }

    pub async fn save_window_state(&self, state: WindowState) -> Result<(), String> {
        let _guard = self.lock.lock().await;
        let mut current = self.load().await;
        let details = current.window_state.as_ref().and_then(|w| w.details_width);
        current.window_state = Some(WindowState {
            details_width: details,
            ..state
        });
        self.save(&current).await
    }

    async fn save(&self, settings: &OrbitSettings) -> Result<(), String> {
        apply_prefs(settings);
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| e.to_string())?;
        }
        let tmp = self.path.with_extension("json.tmp");
        let body = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
        tokio::fs::write(&tmp, format!("{body}\n"))
            .await
            .map_err(|e| e.to_string())?;
        tokio::fs::rename(&tmp, &self.path)
            .await
            .map_err(|e| e.to_string())
    }
}

const FONTS: &[&str] = &["inter", "system", "segoe", "arial"];
const MONO_FONTS: &[&str] = &["cascadia", "consolas", "courier", "code-new-roman"];
const UI_SIZES: &[u32] = &[12, 13, 14, 15, 16, 18];
const MONO_SIZES: &[u32] = &[11, 12, 13, 14, 15];
const PALETTES: &[&str] = &["orbit", "ocean", "ember", "iris", "grove"];

/// Mirrors the Electron normalizer: unknown or malformed values fall back to defaults, never fail.
pub fn normalize(value: serde_json::Value) -> OrbitSettings {
    let defaults = OrbitSettings::default();
    let Some(obj) = value.as_object() else {
        return defaults;
    };
    let str_of = |key: &str| obj.get(key).and_then(|v| v.as_str()).map(str::to_string);
    let pick = |key: &str, allowed: &[&str], fallback: &str| {
        str_of(key)
            .filter(|v| allowed.contains(&v.as_str()))
            .unwrap_or_else(|| fallback.to_string())
    };
    let uint_of = |key: &str, allowed: &[u32], fallback: u32| {
        obj.get(key)
            .and_then(|v| v.as_u64())
            .and_then(|n| u32::try_from(n).ok())
            .filter(|n| allowed.contains(n))
            .unwrap_or(fallback)
    };

    let custom_theme_ids: Vec<String> = obj
        .get("customThemes")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|theme| theme.get("id").and_then(|id| id.as_str()).map(str::to_string))
        .collect();

    let percent_of = |key: &str, fallback: u32, max: u32| {
        obj.get(key)
            .and_then(|v| v.as_u64())
            .map(|n| n.min(max as u64) as u32)
            .unwrap_or(fallback)
    };

    let pinned_repo_ids = {
        let mut seen: Vec<u64> = Vec::new();
        for id in obj
            .get("pinnedRepoIds")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
            .filter_map(|v| v.as_u64())
            .filter(|id| *id > 0)
        {
            if !seen.contains(&id) {
                seen.push(id);
            }
        }
        seen
    };

    let window_state = obj
        .get("windowState")
        .and_then(|v| serde_json::from_value::<WindowState>(v.clone()).ok())
        .map(|mut w| {
            w.details_width = w.details_width.map(|d| d.round().clamp(260.0, 4000.0));
            w
        });

    OrbitSettings {
        pinned_repo_ids,
        custom_views: obj
            .get("customViews")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default(),
        color_scheme: pick("colorScheme", &["system", "light", "dark"], &defaults.color_scheme),
        custom_themes: obj
            .get("customThemes")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default(),
        // A custom theme is chosen by its id, so the id is valid when a saved custom theme has it.
        palette: str_of("palette")
            .filter(|p| PALETTES.contains(&p.as_str()) || custom_theme_ids.contains(p))
            .unwrap_or_else(|| defaults.palette.clone()),
        open_items_in: if str_of("openItemsIn").as_deref() == Some("full") {
            "full".into()
        } else {
            "side".into()
        },
        motion: if str_of("motion").as_deref() == Some("system") {
            "system".into()
        } else {
            "always".into()
        },
        interface_font: pick("interfaceFont", FONTS, &defaults.interface_font),
        interface_font_size: uint_of("interfaceFontSize", UI_SIZES, defaults.interface_font_size),
        monospace_font: pick("monospaceFont", MONO_FONTS, &defaults.monospace_font),
        monospace_font_size: uint_of("monospaceFontSize", MONO_SIZES, defaults.monospace_font_size),
        word_wrap: obj.get("wordWrap").and_then(|v| v.as_bool()) != Some(false),
        hover_cards: pick("hoverCards", &["off", "quick", "normal", "slow"], &defaults.hover_cards),
        editor_keys: pick("editorKeys", &["standard", "vim"], &defaults.editor_keys),
        editor_word_wrap: obj.get("editorWordWrap").and_then(|v| v.as_bool()) == Some(true),
        close_to_tray: obj.get("closeToTray").and_then(|v| v.as_bool()) != Some(false),
        desktop_notifications: obj.get("desktopNotifications").and_then(|v| v.as_bool()) != Some(false),
        poll_minutes: {
            let asked = obj.get("pollMinutes").and_then(|v| v.as_u64()).unwrap_or(1);
            if crate::github::refresh::POLL_CHOICES_MINUTES.contains(&asked) { asked as u32 } else { 1 }
        },
        start_at_login: obj.get("startAtLogin").and_then(|v| v.as_bool()) == Some(true),
        contrast: percent_of("contrast", defaults.contrast, 200),
        glass_opacity: percent_of("glassOpacity", defaults.glass_opacity, 100),
        window_state,
        public_upload_notice_acknowledged: obj
            .get("publicUploadNoticeAcknowledged")
            .and_then(|v| v.as_bool())
            == Some(true),
    }
}

#[cfg(test)]
mod tests {
    use super::normalize;
    use serde_json::json;

    #[test]
    fn editor_keys_are_standard_or_vim() {
        assert_eq!(normalize(json!({})).editor_keys, "standard");
        assert_eq!(normalize(json!({ "editorKeys": "vim" })).editor_keys, "vim");
        assert_eq!(normalize(json!({ "editorKeys": "emacs" })).editor_keys, "standard");
        assert!(!normalize(json!({})).editor_word_wrap);
        assert!(normalize(json!({ "editorWordWrap": true })).editor_word_wrap);
    }

    #[test]
    fn hover_cards_keep_a_known_speed_or_fall_back_to_normal() {
        assert_eq!(normalize(json!({})).hover_cards, "normal");
        assert_eq!(normalize(json!({ "hoverCards": "off" })).hover_cards, "off");
        assert_eq!(normalize(json!({ "hoverCards": "instant" })).hover_cards, "normal");
    }

    #[test]
    fn contrast_and_glass_keep_defaults_and_clamp_to_range() {
        let defaults = normalize(json!({}));
        assert_eq!(defaults.contrast, 100);
        assert_eq!(defaults.glass_opacity, 100);

        let clamped = normalize(json!({ "contrast": 250, "glassOpacity": 40 }));
        assert_eq!(clamped.contrast, 200);
        assert_eq!(clamped.glass_opacity, 40);

        let malformed = normalize(json!({ "contrast": "high", "glassOpacity": -5 }));
        assert_eq!(malformed.contrast, 100);
        assert_eq!(malformed.glass_opacity, 100);
    }

    #[test]
    fn a_saved_custom_theme_can_be_the_palette() {
        let custom = normalize(json!({
            "palette": "dracula-official",
            "customThemes": [{ "id": "dracula-official", "name": "Dracula" }]
        }));
        assert_eq!(custom.palette, "dracula-official");

        let unknown = normalize(json!({ "palette": "no-such-theme" }));
        assert_eq!(unknown.palette, "orbit");
    }
}

#[cfg(test)]
mod poll_and_login_tests {
    use super::normalize;
    use serde_json::json;

    #[test]
    fn polling_keeps_only_offered_minutes_and_login_is_off_by_default() {
        assert_eq!(normalize(json!({})).poll_minutes, 1);
        assert_eq!(normalize(json!({ "pollMinutes": 10 })).poll_minutes, 10);
        assert_eq!(normalize(json!({ "pollMinutes": 7 })).poll_minutes, 1);
        assert!(!normalize(json!({})).start_at_login);
        assert!(normalize(json!({ "startAtLogin": true })).start_at_login);
    }
}
