//! The one container of backend services. Commands reach it through `tauri::State<Arc<Services>>`.

use std::sync::Arc;

use crate::auth::AuthService;
use crate::diagnostics::Diagnostics;
use crate::github::client::GitHubClient;
use crate::github::notifications::{NotificationCenter, NotificationService};
use crate::github::projects::ProjectsService;
use crate::github::refresh::RefreshEngine;
use crate::github::repos::RepoService;
use crate::github::write::WriteCoordinator;
use crate::github::Ctx;
use crate::settings::SettingsStore;
use crate::updates::UpdateService;

pub struct Services {
    pub settings: SettingsStore,
    pub auth: Arc<AuthService>,
    pub client: Arc<GitHubClient>,
    pub writes: Arc<WriteCoordinator>,
    pub repos: Arc<RepoService>,
    pub search_index: Arc<crate::github::search_index::SearchIndex>,
    pub projects: ProjectsService,
    pub notifications: Arc<NotificationService>,
    pub notification_center: Arc<NotificationCenter>,
    pub engine: Arc<RefreshEngine>,
    pub updates: Arc<UpdateService>,
    pub diagnostics: Arc<Diagnostics>,
}

impl Services {
    /// The shared pieces every GitHub call needs. Cheap: only Arcs are cloned.
    pub fn ctx(&self) -> Ctx {
        Ctx {
            auth: Arc::clone(&self.auth),
            client: Arc::clone(&self.client),
            writes: Arc::clone(&self.writes),
        }
    }
}
