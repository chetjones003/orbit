//! The signed-in account's own repositories. Held in memory for one session only. Ported from `repo-service.ts`.

use serde::Serialize;
use std::sync::Mutex;

use super::write::ApiError;
use super::{get_json, Ctx};

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersonalRepo {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub description: Option<String>,
    pub is_private: bool,
    pub is_fork: bool,
    pub is_archived: bool,
    pub default_branch: String,
    pub updated_at: String,
    pub html_url: String,
}

#[derive(Default)]
pub struct RepoService {
    /// The last complete list, for one session.
    snapshot: Mutex<Option<(u64, Vec<PersonalRepo>)>>,
}

impl RepoService {
    /// The list to show: the last complete one for this session, otherwise a fresh fetch.
    pub async fn current(&self, ctx: &Ctx) -> Result<Vec<PersonalRepo>, ApiError> {
        if let Ok((_, session_id)) = ctx.signed_in() {
            let cached = self.snapshot.lock().expect("repo snapshot poisoned").clone();
            if let Some((cached_session, repos)) = cached {
                if cached_session == session_id {
                    return Ok(repos);
                }
            }
        }
        self.list_personal_repos(ctx).await
    }

    pub async fn list_personal_repos(&self, ctx: &Ctx) -> Result<Vec<PersonalRepo>, ApiError> {
        let (login, session_id) = ctx
            .signed_in()
            .map_err(|_| ApiError::msg("Sign in to GitHub to load repositories."))?;
        let session = ctx.session().await?;
        let mut repos = Vec::new();
        for page in 1.. {
            let body = get_json(
                ctx,
                &session,
                &format!("/user/repos?type=owner&sort=updated&per_page=100&page={page}"),
            )
            .await?;
            let list = body
                .as_array()
                .ok_or_else(|| ApiError::msg("GitHub returned an invalid repository list."))?;
            // The account may have changed while the page was in flight.
            match ctx.signed_in() {
                Ok((_, now)) if now == session_id => {}
                _ => return Err(ApiError::msg("The signed-in account changed. Reload repositories.")),
            }
            for item in list {
                let owner = item.get("owner").and_then(|o| o.get("login")).and_then(|l| l.as_str());
                if owner.map(|o| o.to_lowercase()) != Some(login.to_lowercase()) {
                    continue;
                }
                if let Some(repo) = to_repo(item) {
                    repos.push(repo);
                }
            }
            if list.len() < 100 {
                *self.snapshot.lock().expect("repo snapshot poisoned") = Some((session_id, repos.clone()));
                return Ok(repos);
            }
        }
        unreachable!("the page loop returns when a short page arrives")
    }
}

fn to_repo(item: &serde_json::Value) -> Option<PersonalRepo> {
    Some(PersonalRepo {
        id: item.get("id")?.as_u64()?,
        name: item.get("name")?.as_str()?.to_string(),
        full_name: item.get("full_name")?.as_str()?.to_string(),
        description: item.get("description").and_then(|d| d.as_str()).map(str::to_string),
        is_private: item.get("private").and_then(|v| v.as_bool()) == Some(true),
        is_fork: item.get("fork").and_then(|v| v.as_bool()) == Some(true),
        is_archived: item.get("archived").and_then(|v| v.as_bool()) == Some(true),
        default_branch: item.get("default_branch")?.as_str()?.to_string(),
        updated_at: item.get("updated_at")?.as_str()?.to_string(),
        html_url: item.get("html_url")?.as_str()?.to_string(),
    })
}
