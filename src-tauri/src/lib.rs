mod app;
mod auth;
mod commands;
mod credentials;
mod diagnostics;
mod endpoints;
mod github;
mod model;
mod oauth;
mod services;
mod settings;
mod shell;
mod themes;
mod tray;
mod updates;
mod window;

use std::sync::{Arc, OnceLock};
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};

use auth::{AuthService, AuthStatus};
use credentials::CredentialStore;
use endpoints::resolve_github_endpoints;
use github::client::GitHubClient;
use github::refresh::{ConnectionStatus, RefreshEngine, RefreshFuture};
use github::repos::RepoService;
use github::notifications::{desktop_notices, NotificationCenter, NotificationDelivery, NotificationService};
use github::write::{ApiError, WriteCoordinator};
use github::Ctx;
use services::Services;
use settings::SettingsStore;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(tray::Lifecycle::default())
        .setup(|app| {
            let handle = app.handle().clone();
            // ORBIT_USER_DATA gives a run its own profile, so the fake-GitHub dev build never touches a real install.
            let data_dir = match std::env::var_os("ORBIT_USER_DATA") {
                Some(dir) => std::path::PathBuf::from(dir),
                None => app.path().app_data_dir()?,
            };
            let endpoints = resolve_github_endpoints(std::env::var("ORBIT_GITHUB_URL").ok().as_deref());
            let http = reqwest::Client::builder()
                .user_agent("Orbit")
                .build()
                .map_err(|e| e.to_string())?;
            let client = Arc::new(GitHubClient::new(
                &endpoints.api_base_url,
                &endpoints.uploads_base_url,
                http.clone(),
            ));

            // Shared cells let services that depend on each other read the latest state without a cycle.
            let conn: Arc<std::sync::Mutex<ConnectionStatus>> = Arc::new(std::sync::Mutex::new(
                ConnectionStatus {
                    state: github::refresh::ConnectionState::Idle,
                    last_success_at: None,
                    next_retry_at: None,
                },
            ));
            let engines: Arc<OnceLock<(Arc<RefreshEngine>, Arc<RefreshEngine>)>> = Arc::new(OnceLock::new());

            let conn_for_guard = Arc::clone(&conn);
            let writes = Arc::new(WriteCoordinator::new(Arc::new(move || {
                let status = *conn_for_guard.lock().expect("connection poisoned");
                github::refresh::writes_allowed(&status)
            })));

            let store = Arc::new(CredentialStore::new(&data_dir));
            let auth_handle = handle.clone();
            let auth_engines = Arc::clone(&engines);
            let on_auth_change: auth::StatusListener = Arc::new(move |status: AuthStatus| {
                let _ = auth_handle.emit("auth:status-changed", status.clone());
                // Visible data and notifications poll only while signed in, as in the Electron build.
                if let Some((engine, notifications)) = auth_engines.get() {
                    let signed_in = matches!(status, AuthStatus::SignedIn { .. });
                    engine.stop();
                    notifications.stop();
                    if signed_in {
                        engine.start();
                        notifications.start();
                    }
                }
            });
            let auth = AuthService::new(
                store,
                &endpoints.oauth_base_url,
                &endpoints.api_base_url,
                http.clone(),
                on_auth_change,
            );

            let repos = Arc::new(RepoService::default());
            let ctx_parts = (Arc::clone(&auth), Arc::clone(&client), Arc::clone(&writes));

            // Visible data: the repo list refreshes on the engine's schedule.
            let refresh_parts = ctx_parts.clone();
            let refresh_repos = Arc::clone(&repos);
            let refresh_fn: github::refresh::RefreshFn = Arc::new(move || -> RefreshFuture {
                let (auth, client, writes) = refresh_parts.clone();
                let repos = Arc::clone(&refresh_repos);
                Box::pin(async move {
                    let ctx = Ctx { auth, client, writes };
                    repos.list_personal_repos(&ctx).await.map(|_| None)
                })
            });
            let guard_auth = Arc::clone(&auth);
            let engine_handle = handle.clone();
            let engine_conn = Arc::clone(&conn);
            let engine = RefreshEngine::new(
                refresh_fn,
                Arc::new(move || matches!(guard_auth.status(), AuthStatus::SignedIn { .. })),
                Arc::new(move |status: ConnectionStatus| {
                    *engine_conn.lock().expect("connection poisoned") = status;
                    let _ = engine_handle.emit("refresh:status-changed", status);
                }),
            );

            // Notifications poll on their own schedule. Their dedupe state lives in memory for one session.
            let notification_service = Arc::new(NotificationService::new());
            let notification_center = Arc::new(NotificationCenter::new());
            let notice_parts = ctx_parts.clone();
            let notice_service = Arc::clone(&notification_service);
            let notice_center = Arc::clone(&notification_center);
            let notice_handle = handle.clone();
            let diagnostics = Arc::new(diagnostics::Diagnostics::new(data_dir.join("logs")));
            let services_diagnostics = Arc::clone(&diagnostics);
            let notification_fn: github::refresh::RefreshFn = Arc::new(move || -> RefreshFuture {
                let (auth, client, writes) = notice_parts.clone();
                let service = Arc::clone(&notice_service);
                let center = Arc::clone(&notice_center);
                let app = notice_handle.clone();
                let diagnostics = Arc::clone(&diagnostics);
                Box::pin(async move {
                    let ctx = Ctx { auth, client, writes };
                    let poll = service.poll(&ctx).await?;
                    if let Some(delivery) = &poll.delivery {
                        if let NotificationDelivery::Items { items } = delivery {
                            for item in items {
                                center.remember(item);
                            }
                        }
                        // Focused: an in-app toast. Unfocused: a desktop notification. Never both.
                        let focused = window_focused(&app);
                        let count = match delivery {
                            NotificationDelivery::Items { items } => items.len(),
                            NotificationDelivery::Summary { count, .. } => *count,
                        };
                        if focused {
                            let _ = app.emit("notifications:delivered", delivery.clone());
                        } else {
                            for notice in desktop_notices(delivery, false) {
                                show_desktop_notice(&app, &notice);
                            }
                        }
                        diagnostics
                            .record("info", "notify", if focused { "in-app" } else { "desktop" }, &format!("{count} item(s)"))
                            .await;
                    }
                    Ok(poll.poll_interval_ms)
                })
            });
            let notification_engine = RefreshEngine::new(
                notification_fn,
                Arc::new({
                    let guard = Arc::clone(&auth);
                    move || matches!(guard.status(), AuthStatus::SignedIn { .. })
                }),
                Arc::new(|_status: ConnectionStatus| {}),
            );
            let _ = engines.set((Arc::clone(&engine), Arc::clone(&notification_engine)));

            let update_handle = handle.clone();
            let updates = updates::UpdateService::new(
                handle.clone(),
                Arc::new(move |status| {
                    let _ = update_handle.emit("updates:status-changed", status);
                }),
            );

            let settings = SettingsStore::new(&data_dir);
            let loaded = tauri::async_runtime::block_on(settings.load());
            settings::apply_prefs(&loaded);
            let saved_window = loaded.window_state;
            window::restore(&handle, saved_window.as_ref());
            window::attach(&handle);

            let tray_ok = tray::create_tray(&handle).is_ok();
            handle
                .state::<tray::Lifecycle>()
                .tray_available
                .store(tray_ok, Ordering::SeqCst);

            let index_handle = app.handle().clone();
            let services = Services {
                settings,
                auth: Arc::clone(&auth),
                client,
                writes,
                repos,
                search_index: github::search_index::SearchIndex::new(Arc::new(
                    move |status: github::search_index::IndexStatus| {
                        let _ = index_handle.emit("search:index-status", status);
                    },
                )),
                projects: github::projects::ProjectsService::default(),
                notifications: notification_service,
                notification_center,
                engine,
                updates: Arc::clone(&updates),
                diagnostics: services_diagnostics,
            };
            app.manage(Arc::new(services));

            // Restores a stored session in the background so the window opens without waiting on disk.
            let init_auth = Arc::clone(&auth);
            tauri::async_runtime::spawn(async move {
                init_auth.initialize().await;
            });

            // Checks at startup and every four hours. Unpackaged (debug) builds never check.
            if !cfg!(debug_assertions) {
                let check = Arc::clone(&updates);
                tauri::async_runtime::spawn(async move {
                    loop {
                        check.check().await;
                        tokio::time::sleep(updates::UPDATE_CHECK_INTERVAL).await;
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app::app_get_info,
            app::app_open_external,
            shell::shell_control,
            shell::shell_get_state,
            commands::auth_get_status,
            commands::auth_start_sign_in,
            commands::auth_cancel_sign_in,
            commands::auth_sign_out,
            commands::settings_get,
            commands::settings_update,
            commands::repos_list,
            commands::repos_refresh,
            commands::refresh_get_status,
            commands::refresh_wake,
            commands::notifications_open,
            commands::inbox_list,
            commands::search_query,
            commands::search_warm,
            commands::search_index_status,
            commands::themes_search,
            commands::themes_import,
            commands::updates_get_status,
            commands::updates_check,
            commands::updates_download,
            commands::updates_install,
            commands::diagnostics_record,
            commands::diagnostics_get_report,
            commands::issues_list,
            commands::issues_detail,
            commands::issues_links,
            commands::issues_create,
            commands::issues_update,
            commands::issues_update_fields,
            commands::issues_set_state,
            commands::issues_repo_options,
            commands::issues_set_task,
            commands::pulls_list,
            commands::pulls_detail,
            commands::pulls_files,
            commands::pulls_threads,
            commands::pulls_review_state,
            commands::pulls_review_comment,
            commands::pulls_review_reply,
            commands::pulls_review_resolve,
            commands::pulls_review_submit,
            commands::pulls_actions,
            commands::pulls_merge,
            commands::pulls_conflicts,
            commands::pulls_resolve_conflicts,
            commands::pulls_auto_merge,
            commands::pulls_draft,
            commands::pulls_runs,
            commands::pulls_rerun,
            commands::pulls_create,
            commands::pulls_branches,
            commands::actions_jobs,
            commands::actions_job_logs,
            commands::actions_workflow_graph,
            commands::actions_cancel_run,
            commands::projects_list,
            commands::projects_detail,
            commands::projects_items,
            commands::projects_item_memberships,
            commands::projects_add_item,
            commands::projects_remove_item,
            commands::projects_move_item,
            commands::projects_set_field,
            commands::markdown_preview,
            commands::comments_create,
            commands::comments_update,
            commands::comments_delete,
            commands::attachments_upload,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Orbit");
}

fn window_focused(_app: &tauri::AppHandle) -> bool {
    window::is_focused()
}

fn show_desktop_notice(app: &tauri::AppHandle, notice: &github::notifications::DesktopNotice) {
    if !settings::desktop_notifications() {
        return;
    }
    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title(&notice.title)
        .body(&notice.body)
        .show();
}

/// Maps an ApiError to the message the renderer shows.
pub fn error_text(error: ApiError) -> String {
    error.to_string()
}
