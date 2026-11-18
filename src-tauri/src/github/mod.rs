//! GitHub domain services. Each one reads or writes the signed-in account's own repositories, and nothing it
//! reads is persisted: results go straight back to the caller.

pub mod client;
pub mod conflicts;
pub mod inbox;
pub mod issues;
pub mod links;
pub mod projects;
pub mod pulls;
pub mod refresh;
pub mod repos;
pub mod search;
pub mod search_index;
pub mod util;
pub mod write;
pub mod notifications;
pub mod attachments;
pub mod review_anchor;
pub mod task_list;

use std::sync::Arc;

use crate::auth::{AuthService, AuthStatus};
use client::GitHubClient;
use write::{ApiError, WriteCoordinator};

pub const HTML_ACCEPT: &str = "application/vnd.github.html+json";

/// The session a request runs under. The scope keeps ETag caches apart per signed-in account.
pub struct Session {
    pub token: String,
    pub scope: String,
    pub login: String,
}

/// Everything a domain service needs from the rest of the backend.
pub struct Ctx {
    pub auth: Arc<AuthService>,
    pub client: Arc<GitHubClient>,
    pub writes: Arc<WriteCoordinator>,
}

impl Ctx {
    pub fn signed_in(&self) -> Result<(String, u64), ApiError> {
        match self.auth.status() {
            AuthStatus::SignedIn { login, session_id, .. } => Ok((login, session_id)),
            _ => Err(ApiError::msg("Sign in to GitHub to load issues.")),
        }
    }

    pub async fn session(&self) -> Result<Session, ApiError> {
        let (login, session_id) = self.signed_in()?;
        let token = self.auth.access_token().await?;
        Ok(Session {
            token,
            scope: session_id.to_string(),
            login,
        })
    }

    /// Checks the repo is one of the signed-in account's personal repos, then splits it into owner and name.
    pub fn personal_repo(&self, repo_full_name: &str) -> Result<(String, String), ApiError> {
        let (owner, repo) = util::validate_repo(repo_full_name).map_err(ApiError::msg)?;
        let (login, _) = self.signed_in()?;
        if owner.to_lowercase() != login.to_lowercase() {
            return Err(ApiError::msg(
                "Only personal repos, owned by the signed-in account, can be opened.",
            ));
        }
        Ok((owner, repo))
    }
}

/// Typed GET helper: sends with the session, and parses into the caller's value.
pub async fn get_json(ctx: &Ctx, session: &Session, path: &str) -> Result<serde_json::Value, ApiError> {
    Ok(ctx.client.get(path, &session.token, &session.scope).await?)
}

pub async fn get_html(ctx: &Ctx, session: &Session, path: &str) -> Result<serde_json::Value, ApiError> {
    Ok(ctx
        .client
        .get_with_meta(path, &session.token, &session.scope, Some(HTML_ACCEPT))
        .await?
        .data)
}
