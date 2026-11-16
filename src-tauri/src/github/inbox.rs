//! The inbox: one fixed tab of the signed-in account's personal-repo items, read from GitHub search. Ported from
//! `inbox-service.ts`.

use serde::{Deserialize, Serialize};

use super::util::{s, u};
use super::write::ApiError;
use super::{get_json, Ctx};
use crate::model::issues::IssueLabel;

const INBOX_PER_PAGE: u64 = 30;
pub const SEARCH_RESULT_CAP: u64 = 1000;

pub const INBOX_TABS: &[&str] = &["my-open-prs", "assigned", "review-requested", "mentioned", "recent"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InboxQuery {
    pub tab: String,
    pub page: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    pub repo_full_name: String,
    pub number: u64,
    /// "issue" or "pull".
    pub kind: String,
    pub title: String,
    pub state: String,
    pub is_draft: bool,
    pub author_login: String,
    pub labels: Vec<IssueLabel>,
    pub comment_count: u64,
    pub updated_at: String,
    pub html_url: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InboxPage {
    pub tab: String,
    pub items: Vec<InboxItem>,
    pub page: u64,
    pub has_next_page: bool,
    pub partial: bool,
}

/// Search-side qualifiers for each fixed tab.
pub fn build_inbox_search_query(tab: &str, login: &str) -> String {
    let qualifier = match tab {
        "my-open-prs" => format!("is:pr is:open author:{login}"),
        "assigned" => format!("is:open assignee:{login}"),
        "review-requested" => format!("is:pr is:open review-requested:{login}"),
        "mentioned" => format!("is:open mentions:{login}"),
        _ => "is:open".to_string(),
    };
    format!("{qualifier} user:{login}")
}

fn is_login(text: &str) -> bool {
    let bytes = text.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 39
        && bytes[0].is_ascii_alphanumeric()
        && bytes.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'-')
}

pub async fn list(ctx: &Ctx, query: &InboxQuery) -> Result<InboxPage, ApiError> {
    if !INBOX_TABS.contains(&query.tab.as_str()) {
        return Err(ApiError::msg("Unknown inbox tab."));
    }
    let max_page = SEARCH_RESULT_CAP.div_ceil(INBOX_PER_PAGE);
    if query.page < 1 || query.page > max_page {
        return Err(ApiError::msg(
            "Inbox pages must be positive whole numbers within GitHub’s search limit.",
        ));
    }
    let (login, _) = ctx
        .signed_in()
        .map_err(|_| ApiError::msg("Sign in to GitHub to load your inbox."))?;
    if !is_login(&login) {
        return Err(ApiError::msg("The signed-in account name is not valid."));
    }
    let session = ctx.session().await?;
    let q = build_inbox_search_query(&query.tab, &login);
    let body = get_json(
        ctx,
        &session,
        &format!(
            "/search/issues?q={}&sort=updated&order=desc&per_page={INBOX_PER_PAGE}&page={}",
            crate::github::util::enc(&q),
            query.page
        ),
    )
    .await?;
    let total = body.get("total_count").and_then(|v| v.as_u64());
    let incomplete = body.get("incomplete_results").and_then(|v| v.as_bool());
    let (Some(total), Some(incomplete), Some(raw_items)) =
        (total, incomplete, body.get("items").and_then(|v| v.as_array()))
    else {
        return Err(ApiError::msg("GitHub returned an invalid inbox result."));
    };

    let mut items = Vec::new();
    let mut partial = incomplete || total > SEARCH_RESULT_CAP;
    for raw in raw_items {
        match to_inbox_item(raw, &login) {
            Some(item) => items.push(item),
            None => partial = true,
        }
    }
    let visible_total = total.min(SEARCH_RESULT_CAP);
    Ok(InboxPage {
        tab: query.tab.clone(),
        items,
        page: query.page,
        has_next_page: query.page * INBOX_PER_PAGE < visible_total,
        partial,
    })
}

/// Returns None for a result that is malformed or outside the account's own repos.
pub fn to_inbox_item(raw: &serde_json::Value, login: &str) -> Option<InboxItem> {
    let repo_full_name = repo_from_url(&s(raw, "repository_url")?)?;
    let owner = repo_full_name.split('/').next()?;
    if owner.to_lowercase() != login.to_lowercase() {
        return None;
    }
    let author = raw.get("user").and_then(|user| s(user, "login"))?;
    let state = s(raw, "state")?;
    if state != "open" && state != "closed" {
        return None;
    }
    let labels: Vec<IssueLabel> = raw
        .get("labels")?
        .as_array()?
        .iter()
        .filter_map(|label| {
            Some(IssueLabel {
                name: s(label, "name")?,
                color: s(label, "color").unwrap_or_default(),
            })
        })
        .collect();
    let is_pull = raw.get("pull_request").map(|p| !p.is_null()).unwrap_or(false);
    Some(InboxItem {
        repo_full_name,
        number: u(raw, "number")?,
        kind: if is_pull { "pull".into() } else { "issue".into() },
        title: s(raw, "title")?,
        state,
        is_draft: is_pull && raw.get("draft").and_then(|d| d.as_bool()) == Some(true),
        author_login: author,
        labels,
        comment_count: u(raw, "comments")?,
        updated_at: s(raw, "updated_at")?,
        html_url: s(raw, "html_url")?,
    })
}

/// `https://api.github.com/repos/owner/name` -> `owner/name`.
fn repo_from_url(url: &str) -> Option<String> {
    let idx = url.find("/repos/")?;
    let rest = &url[idx + "/repos/".len()..];
    let mut parts = rest.split('/');
    let owner = parts.next()?;
    let name = parts.next()?;
    if owner.is_empty() || name.is_empty() || parts.next().is_some() {
        return None;
    }
    Some(format!("{owner}/{name}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tab_queries_stay_in_the_account() {
        assert_eq!(
            build_inbox_search_query("assigned", "octo"),
            "is:open assignee:octo user:octo"
        );
    }

    #[test]
    fn repo_urls_are_parsed() {
        assert_eq!(
            repo_from_url("https://api.github.com/repos/octo/hello").as_deref(),
            Some("octo/hello")
        );
        assert_eq!(repo_from_url("https://example.com/x"), None);
    }
}
