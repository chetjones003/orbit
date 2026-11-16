//! `app:*` commands. Mirrors `src/main/ipc.ts` (`app:get-info`, `app:open-external`).

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
    /// Absent outside debug runs against the fake GitHub.
    pub debug_media_origin: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenExternalResult {
    pub opened: bool,
}

#[tauri::command]
pub fn app_get_info(app: AppHandle) -> AppInfo {
    AppInfo {
        name: app.package_info().name.clone(),
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_string(),
        debug_media_origin: None,
    }
}

/// Only http(s) links leave the app, as in the Electron version.
#[tauri::command]
pub fn app_open_external(app: AppHandle, url: String) -> Result<OpenExternalResult, String> {
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Ok(OpenExternalResult { opened: false });
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())?;
    Ok(OpenExternalResult { opened: true })
}
