//! Pull requests and commits linked to an issue, read from its timeline. Ported from `issue-links.ts` and the
//! `getIssueLinks` method.

use serde_json::Value;
use std::collections::BTreeMap;

use super::util::*;
use super::write::ApiError;
use super::{get_json, Ctx};
use crate::model::issues::{IssueLinks, LinkedCommit, LinkedPull};

const TIMELINE_PAGE_LIMIT: u32 = 5;
const LINKED_COMMIT_LIMIT: usize = 25;

pub struct TimelineLinks {
    pub pulls: Vec<LinkedPull>,
    /// Commit ids in the order GitHub recorded them, oldest first, without repeats.
    pub commit_shas: Vec<String>,
}

/// Reads the pull requests and commits the timeline links to an issue. A pull request from another repo, or an
/// issue rather than a pull request, is left out. Later events win.
pub fn links_from_timeline(events: &[Value], owner: &str, repo: &str) -> TimelineLinks {
    let mut pulls: BTreeMap<u64, LinkedPull> = BTreeMap::new();
    let mut commit_shas: Vec<String> = Vec::new();
    let repo_prefix = format!("https://github.com/{owner}/{repo}/").to_lowercase();

    for event in events {
        let name = event.get("event").and_then(Value::as_str).unwrap_or("");
        match name {
            "cross-referenced" | "connected" => {
                if let Some(pull) = to_linked_pull(event.get("source"), &repo_prefix) {
                    pulls.insert(pull.number, pull);
                }
            }
            "referenced" | "closed" => {
                if let Some(sha) = event.get("commit_id").and_then(Value::as_str) {
                    let is_sha = sha.len() >= 7
                        && sha.len() <= 40
                        && sha.chars().all(|c| c.is_ascii_hexdigit());
                    if is_sha && !commit_shas.iter().any(|s| s == sha) {
                        commit_shas.push(sha.to_string());
                    }
                }
            }
            _ => {}
        }
    }

    let mut pulls: Vec<LinkedPull> = pulls.into_values().collect();
    pulls.sort_by(|a, b| b.number.cmp(&a.number));
    TimelineLinks { pulls, commit_shas }
}

fn to_linked_pull(source: Option<&Value>, repo_prefix: &str) -> Option<LinkedPull> {
    let issue = source?.get("issue")?;
    let pull_request = issue.get("pull_request")?;
    if !pull_request.is_object() {
        return None;
    }
    let html_url = s(issue, "html_url")?;
    if !html_url.to_lowercase().starts_with(repo_prefix) {
        return None;
    }
    let state = s(issue, "state")?;
    if state != "open" && state != "closed" {
        return None;
    }
    Some(LinkedPull {
        number: u(issue, "number")?,
        title: s(issue, "title")?,
        state,
        merged: pull_request.get("merged_at").and_then(Value::as_str).is_some(),
        html_url,
        author_login: issue.get("user").and_then(login_of).unwrap_or_else(|| "ghost".into()),
    })
}

/// A commit from the commits API, or None when the response lacks what Orbit shows.
pub fn to_linked_commit(raw: &Value) -> Option<LinkedCommit> {
    let commit = raw.get("commit")?;
    let author = commit.get("author")?;
    let message = s(commit, "message")?;
    let date = s(author, "date")?;
    Some(LinkedCommit {
        sha: s(raw, "sha")?,
        message: message.split('\n').next().unwrap_or("").trim().to_string(),
        author_login: raw.get("author").and_then(login_of),
        author_name: s(author, "name").unwrap_or_default(),
        committed_at: date,
        html_url: s(raw, "html_url")?,
    })
}

pub async fn issue_links(ctx: &Ctx, repo_full_name: &str, number: u64) -> Result<IssueLinks, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    let base = item_path(&owner, &repo, "issues", number);
    let session = ctx.session().await?;

    let mut events: Vec<Value> = Vec::new();
    let mut partial = false;
    let mut page = 1;
    loop {
        if page > TIMELINE_PAGE_LIMIT {
            partial = true;
            break;
        }
        let body = get_json(ctx, &session, &format!("{base}/timeline?per_page=100&page={page}")).await?;
        let list = body
            .as_array()
            .ok_or_else(|| ApiError::msg("GitHub returned an invalid timeline."))?;
        events.extend(list.iter().cloned());
        if list.len() < 100 {
            break;
        }
        page += 1;
    }

    let links = links_from_timeline(&events, &owner, &repo);
    let recent: Vec<String> = links.commit_shas.iter().rev().cloned().collect();
    if recent.len() > LINKED_COMMIT_LIMIT {
        partial = true;
    }
    let take = recent.len().min(LINKED_COMMIT_LIMIT);
    let mut commits: Vec<LinkedCommit> = Vec::new();
    for sha in recent.iter().take(take) {
        let path = format!("/repos/{owner}/{repo}/commits/{sha}");
        match get_json(ctx, &session, &path).await.ok().and_then(|raw| to_linked_commit(&raw)) {
            Some(commit) => commits.push(commit),
            None => {}
        }
    }
    if commits.len() < take {
        partial = true;
    }
    Ok(IssueLinks {
        pulls: links.pulls,
        commits,
        partial,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn collects_pulls_and_commits_newest_pull_first() {
        let events = vec![
            json!({"event": "cross-referenced", "source": {"issue": {
                "number": 3, "title": "a", "state": "open", "html_url": "https://github.com/o/r/pull/3",
                "pull_request": {"merged_at": null}, "user": {"login": "x"}}}}),
            json!({"event": "connected", "source": {"issue": {
                "number": 9, "title": "b", "state": "closed", "html_url": "https://github.com/o/r/pull/9",
                "pull_request": {"merged_at": "2026-01-01T00:00:00Z"}}}}),
            json!({"event": "referenced", "commit_id": "abcdef1"}),
            json!({"event": "referenced", "commit_id": "abcdef1"}),
            json!({"event": "closed", "commit_id": "zzzz"}),
        ];
        let links = links_from_timeline(&events, "o", "r");
        assert_eq!(links.pulls.iter().map(|p| p.number).collect::<Vec<_>>(), vec![9, 3]);
        assert!(links.pulls[0].merged);
        assert_eq!(links.commit_shas, vec!["abcdef1".to_string()]);
    }

    #[test]
    fn ignores_pulls_from_other_repos() {
        let events = vec![json!({"event": "cross-referenced", "source": {"issue": {
            "number": 1, "title": "x", "state": "open", "html_url": "https://github.com/other/r/pull/1",
            "pull_request": {}}}})];
        assert!(links_from_timeline(&events, "o", "r").pulls.is_empty());
    }
}
