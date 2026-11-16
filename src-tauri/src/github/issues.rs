//! Issues, comments, labels, and task checkboxes. Ported from `src/main/github/issue-service.ts`.

use serde_json::{json, Value};

use super::util::*;
use super::write::{ApiError, Reconciled, UncertainState};
use super::{get_html, get_json, Ctx, Session, HTML_ACCEPT};
use crate::github::client::{GitHubError, WriteOptions};
use crate::model::issues::*;

/// A sub-issues read that fails shows as none, so the rest of the issue still loads.
async fn fetch_sub_issues(ctx: &Ctx, session: &Session, base: &str) -> Vec<SubIssueRef> {
    let result = get_json(ctx, session, &format!("{base}/sub_issues?per_page=100")).await;
    match result {
        Ok(Value::Array(list)) => list.iter().filter_map(to_sub_issue_ref).collect(),
        _ => Vec::new(),
    }
}

async fn fetch_parent(ctx: &Ctx, session: &Session, base: &str) -> Option<SubIssueRef> {
    let value = get_json(ctx, session, &format!("{base}/parent")).await.ok()?;
    to_sub_issue_ref(&value)
}

/// Follows comment pages until a short page. A thread longer than the page limit is reported partial.
pub async fn fetch_comments(
    ctx: &Ctx,
    session: &Session,
    base: &str,
) -> Result<(Vec<IssueComment>, bool), ApiError> {
    let mut comments = Vec::new();
    let mut dropped = false;
    for page in 1..=COMMENT_PAGE_LIMIT {
        let body = get_html(
            ctx,
            session,
            &format!("{base}/comments?per_page={COMMENTS_PER_PAGE}&page={page}"),
        )
        .await?;
        let list = body
            .as_array()
            .ok_or_else(|| ApiError::msg("GitHub returned invalid comments."))?;
        for raw in list {
            match to_comment(raw) {
                Some(c) => comments.push(c),
                None => dropped = true,
            }
        }
        if (list.len() as u32) < COMMENTS_PER_PAGE {
            return Ok((comments, dropped));
        }
    }
    Ok((comments, true))
}

pub async fn read_issue_snapshot(ctx: &Ctx, session: &Session, path: &str) -> Result<IssueSnapshot, ApiError> {
    let raw = get_html(ctx, session, path).await?;
    to_snapshot(&raw).ok_or_else(|| ApiError::msg("GitHub returned an invalid issue."))
}

async fn read_comment(ctx: &Ctx, session: &Session, path: &str) -> Result<Option<IssueComment>, ApiError> {
    match get_html(ctx, session, path).await {
        Ok(raw) => to_comment(&raw)
            .map(Some)
            .ok_or_else(|| ApiError::msg("GitHub returned an invalid comment.")),
        Err(ApiError::GitHub(GitHubError::Http(404))) => Ok(None),
        Err(e) => Err(e),
    }
}

async fn read_own_comment(
    ctx: &Ctx,
    session: &Session,
    path: &str,
    login: &str,
) -> Result<IssueComment, ApiError> {
    let comment = read_comment(ctx, session, path)
        .await?
        .ok_or_else(|| ApiError::msg("That comment no longer exists on GitHub."))?;
    if comment.author_login != login {
        return Err(ApiError::msg("You can only change your own comments."));
    }
    Ok(comment)
}

fn commit_path(owner: &str, repo: &str, comment_id: u64) -> String {
    format!(
        "/repos/{}/{}/issues/comments/{}",
        enc(owner),
        enc(repo),
        comment_id
    )
}

fn validate_comment_id(id: u64) -> Result<(), String> {
    if id < 1 {
        return Err("Comment ids must be positive whole numbers.".into());
    }
    Ok(())
}

pub async fn list_issues(ctx: &Ctx, query: &IssueListQuery) -> Result<IssueListPage, ApiError> {
    let (owner, repo) = ctx.personal_repo(&query.repo_full_name)?;
    let state = validate_state(&query.state).map_err(ApiError::msg)?;
    let page = validate_page(query.page).map_err(ApiError::msg)?;
    let mut params = vec![format!("state={state}")];
    if let Some(label) = &query.label {
        params.push(format!("labels={}", enc(&validate_text(label, "label").map_err(ApiError::msg)?)));
    }
    if let Some(author) = &query.author {
        params.push(format!("creator={}", enc(&validate_text(author, "author").map_err(ApiError::msg)?)));
    }
    params.push(format!("per_page={ISSUES_PER_PAGE}"));
    params.push(format!("page={page}"));

    let session = ctx.session().await?;
    let body = get_json(
        ctx,
        &session,
        &format!("{}/issues?{}", repo_path(&owner, &repo), params.join("&")),
    )
    .await?;
    let list = body
        .as_array()
        .ok_or_else(|| ApiError::msg("GitHub returned an invalid issue list."))?;

    let mut items = Vec::new();
    let mut partial = false;
    for raw in list {
        // Pull requests share this endpoint; they are not issues.
        if is_pull_request(raw) {
            continue;
        }
        match to_summary(raw) {
            Some(summary) => items.push(summary),
            None => partial = true,
        }
    }
    Ok(IssueListPage {
        items,
        page,
        has_next_page: list.len() as u32 == ISSUES_PER_PAGE,
        partial,
    })
}

pub async fn get_issue_detail(ctx: &Ctx, repo_full_name: &str, number: u64) -> Result<IssueDetail, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    let base = item_path(&owner, &repo, "issues", number);
    let session = ctx.session().await?;

    let issue = get_html(ctx, &session, &base).await?;
    if is_pull_request(&issue) {
        return Err(ApiError::msg("That number is not an issue. It is a pull request."));
    }
    let summary = to_summary(&issue).ok_or_else(|| ApiError::msg("GitHub returned an invalid issue."))?;
    let body_html = s(&issue, "body_html").unwrap_or_default();
    let (comments, comments_partial) = fetch_comments(ctx, &session, &base).await?;
    let sub_issues = if summary.sub_issues.as_ref().map(|c| c.total > 0).unwrap_or(false) {
        Some(fetch_sub_issues(ctx, &session, &base).await)
    } else {
        None
    };
    let parent = if s(&issue, "parent_issue_url").is_some() {
        fetch_parent(ctx, &session, &base).await
    } else {
        None
    };
    Ok(IssueDetail {
        summary,
        body: raw_body(&issue),
        body_html,
        comments,
        comments_partial,
        sub_issues,
        parent,
    })
}

pub async fn create_issue(ctx: &Ctx, repo_full_name: &str, input: IssueContentInput) -> Result<IssueSnapshot, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    let content = validate_issue_content(&input.title, &input.body).map_err(ApiError::msg)?;
    let path = format!("{}/issues", repo_path(&owner, &repo));
    let started_at = chrono::Utc::now().timestamp_millis();
    let session = ctx.session().await?;
    let login = session.login.clone();
    let initial = UncertainState::Empty;

    let key = format!("create-issue\u{0}{owner}\u{0}{repo}\u{0}{}\u{0}{}", content.title, content.body);
    ctx.writes
        .keyed(
            key,
            initial,
            |_state| {
                let session = &session;
                let path = path.clone();
                let content = content.clone();
                async move {
                    let raw = ctx
                        .client
                        .send(
                            reqwest::Method::POST,
                            &path,
                            &session.token,
                            WriteOptions {
                                body: Some(json!({ "title": content.title, "body": content.body })),
                                accept: Some(HTML_ACCEPT),
                                ..Default::default()
                            },
                        )
                        .await?;
                    to_snapshot(&raw).ok_or_else(|| ApiError::msg("GitHub returned an invalid issue."))
                }
            },
            |_state| {
                let session = &session;
                let path = path.clone();
                let content = content.clone();
                let login = login.clone();
                async move {
                    let since = iso_from_ms(started_at - RECONCILE_SKEW_MS);
                    let recent = get_html(
                        ctx,
                        session,
                        &format!(
                            "{path}?creator={}&state=all&sort=created&direction=desc&since={since}&per_page={ISSUES_PER_PAGE}",
                            enc(&login)
                        ),
                    )
                    .await?;
                    let found = recent
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(to_snapshot)
                        .find(|s| s.summary.title == content.title && s.body == content.body);
                    Ok(match found {
                        Some(s) => Reconciled::Applied(s),
                        None => Reconciled::NotApplied,
                    })
                }
            },
        )
        .await
}

/// Edits the title and body. `base` is what the edit started from; if GitHub differs, the edit is a conflict.
pub async fn update_issue(
    ctx: &Ctx,
    repo_full_name: &str,
    number: u64,
    input: IssueContentInput,
    base: IssueContentInput,
) -> Result<IssueEditResult, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    let content = validate_issue_content(&input.title, &input.body).map_err(ApiError::msg)?;
    ctx.writes.assert_can_write()?;
    let path = item_path(&owner, &repo, "issues", number);
    let session = ctx.session().await?;
    let current = read_issue_snapshot(ctx, &session, &path).await?;
    if current.summary.title != base.title || current.body != base.body {
        return Ok(IssueEditResult::Conflict { current });
    }
    let saved = ctx
        .writes
        .run(
            || {
                let path = path.clone();
                let content = content.clone();
                let session = &session;
                async move {
                    let raw = ctx
                        .client
                        .send(
                            reqwest::Method::PATCH,
                            &path,
                            &session.token,
                            WriteOptions {
                                body: Some(json!({ "title": content.title, "body": content.body })),
                                accept: Some(HTML_ACCEPT),
                                ..Default::default()
                            },
                        )
                        .await?;
                    to_snapshot(&raw).ok_or_else(|| ApiError::msg("GitHub returned an invalid issue."))
                }
            },
            || {
                let path = path.clone();
                let content = content.clone();
                let session = &session;
                async move {
                    let now = read_issue_snapshot(ctx, session, &path).await?;
                    Ok(if now.summary.title == content.title && now.body == content.body {
                        Reconciled::Applied(now)
                    } else {
                        Reconciled::NotApplied
                    })
                }
            },
        )
        .await?;
    Ok(IssueEditResult::Saved { issue: saved })
}

/// Replaces labels, assignees, and milestone. Resolves with GitHub's version of the issue.
pub async fn update_issue_fields(
    ctx: &Ctx,
    repo_full_name: &str,
    number: u64,
    fields: IssueFieldsInput,
) -> Result<IssueSummary, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    validate_fields(&fields).map_err(ApiError::msg)?;
    ctx.writes.assert_can_write()?;
    let path = item_path(&owner, &repo, "issues", number);
    let session = ctx.session().await?;

    ctx.writes
        .run(
            || {
                let path = path.clone();
                let fields = fields.clone();
                let session = &session;
                async move {
                    let raw = ctx
                        .client
                        .send(
                            reqwest::Method::PATCH,
                            &path,
                            &session.token,
                            WriteOptions {
                                body: Some(json!({
                                    "labels": fields.labels,
                                    "assignees": fields.assignees,
                                    "milestone": fields.milestone_number,
                                })),
                                ..Default::default()
                            },
                        )
                        .await?;
                    to_summary(&raw).ok_or_else(|| ApiError::msg("GitHub returned an invalid issue."))
                }
            },
            || {
                let path = path.clone();
                let fields = fields.clone();
                let session = &session;
                async move {
                    let now = read_issue_snapshot(ctx, session, &path).await?.summary;
                    let same_labels = same_members(
                        &now.labels.iter().map(|l| l.name.clone()).collect::<Vec<_>>(),
                        &fields.labels,
                    );
                    let same_assignees = same_members(&now.assignees, &fields.assignees);
                    let same_milestone =
                        now.milestone.as_ref().map(|m| m.number) == fields.milestone_number;
                    Ok(if same_labels && same_assignees && same_milestone {
                        Reconciled::Applied(now)
                    } else {
                        Reconciled::NotApplied
                    })
                }
            },
        )
        .await
}

/// Closes an issue as completed or not planned, or reopens it.
pub async fn set_issue_state(
    ctx: &Ctx,
    repo_full_name: &str,
    number: u64,
    state: &str,
    reason: Option<&str>,
) -> Result<IssueSummary, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    if state != "open" && state != "closed" {
        return Err(ApiError::msg("An issue can only be open or closed."));
    }
    let state_reason: Option<&str> = if state == "closed" {
        Some(reason.unwrap_or("completed"))
    } else {
        None
    };
    if let Some(r) = state_reason {
        if r != "completed" && r != "not_planned" {
            return Err(ApiError::msg("Close an issue as completed or not planned."));
        }
    }
    ctx.writes.assert_can_write()?;
    let path = item_path(&owner, &repo, "issues", number);
    let session = ctx.session().await?;
    let body = match state_reason {
        None => json!({ "state": state }),
        Some(r) => json!({ "state": state, "state_reason": r }),
    };

    ctx.writes
        .run(
            || {
                let path = path.clone();
                let body = body.clone();
                let session = &session;
                async move {
                    let raw = ctx
                        .client
                        .send(
                            reqwest::Method::PATCH,
                            &path,
                            &session.token,
                            WriteOptions {
                                body: Some(body),
                                ..Default::default()
                            },
                        )
                        .await?;
                    to_summary(&raw).ok_or_else(|| ApiError::msg("GitHub returned an invalid issue."))
                }
            },
            || {
                let path = path.clone();
                let session = &session;
                async move {
                    let now = read_issue_snapshot(ctx, session, &path).await?.summary;
                    let reason_ok = state_reason.map(|r| now.state_reason.as_deref() == Some(r)).unwrap_or(true);
                    Ok(if now.state == state && reason_ok {
                        Reconciled::Applied(now)
                    } else {
                        Reconciled::NotApplied
                    })
                }
            },
        )
        .await
}

/// Labels, assignees, and open milestones the repo offers. The first page of each.
pub async fn get_repo_options(ctx: &Ctx, repo_full_name: &str) -> Result<IssueRepoOptions, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    let session = ctx.session().await?;
    let base = repo_path(&owner, &repo);
    let labels = get_json(ctx, &session, &format!("{base}/labels?per_page={COMMENTS_PER_PAGE}")).await?;
    let assignees = get_json(ctx, &session, &format!("{base}/assignees?per_page={COMMENTS_PER_PAGE}")).await?;
    let milestones = get_json(
        ctx,
        &session,
        &format!("{base}/milestones?state=open&per_page={COMMENTS_PER_PAGE}"),
    )
    .await?;
    let (Some(labels), Some(assignees), Some(milestones)) =
        (labels.as_array(), assignees.as_array(), milestones.as_array())
    else {
        return Err(ApiError::msg("GitHub returned invalid repo options."));
    };
    // A list that fills its first page may have more entries that were not read.
    let partial = [labels.len(), assignees.len(), milestones.len()]
        .iter()
        .any(|n| *n as u32 >= COMMENTS_PER_PAGE);
    Ok(IssueRepoOptions {
        labels: labels.iter().filter_map(to_label).collect(),
        assignees: assignees.iter().filter_map(login_of).collect(),
        milestones: milestones.iter().filter_map(to_milestone).collect(),
        partial,
    })
}

/// Ticks or unticks one task checkbox. Written only if the body on GitHub still matches what the user saw.
pub async fn set_task_item(
    ctx: &Ctx,
    repo_full_name: &str,
    number: u64,
    index: u64,
    checked: bool,
    expected_body: &str,
) -> Result<TaskToggleResult, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    ctx.writes.assert_can_write()?;
    let path = item_path(&owner, &repo, "issues", number);
    let session = ctx.session().await?;
    let current = read_issue_snapshot(ctx, &session, &path).await?;
    if current.body != expected_body {
        return Ok(TaskToggleResult::Stale { current });
    }

    let next_body = crate::github::task_list::set_task_item_checked(&current.body, index as usize, checked)
        .map_err(ApiError::msg)?;
    if next_body == current.body {
        return Ok(TaskToggleResult::Saved { issue: current });
    }
    let saved = ctx
        .writes
        .run(
            || {
                let path = path.clone();
                let next_body = next_body.clone();
                let session = &session;
                async move {
                    let raw = ctx
                        .client
                        .send(
                            reqwest::Method::PATCH,
                            &path,
                            &session.token,
                            WriteOptions {
                                body: Some(json!({ "body": next_body })),
                                accept: Some(HTML_ACCEPT),
                                ..Default::default()
                            },
                        )
                        .await?;
                    to_snapshot(&raw).ok_or_else(|| ApiError::msg("GitHub returned an invalid issue."))
                }
            },
            || {
                let path = path.clone();
                let next_body = next_body.clone();
                let session = &session;
                async move {
                    let now = read_issue_snapshot(ctx, session, &path).await?;
                    Ok(if now.body == next_body {
                        Reconciled::Applied(now)
                    } else {
                        Reconciled::NotApplied
                    })
                }
            },
        )
        .await?;
    Ok(TaskToggleResult::Saved { issue: saved })
}

pub async fn create_comment(ctx: &Ctx, repo_full_name: &str, number: u64, body: &str) -> Result<IssueComment, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    validate_comment_body(body).map_err(ApiError::msg)?;
    let path = format!("{}/comments", item_path(&owner, &repo, "issues", number));
    let started_at = chrono::Utc::now().timestamp_millis();
    let session = ctx.session().await?;
    let login = session.login.clone();

    let key = format!("comment\u{0}{owner}\u{0}{repo}\u{0}{number}\u{0}{body}");
    ctx.writes
        .keyed(
            key,
            UncertainState::Empty,
            |_s| {
                let path = path.clone();
                let session = &session;
                async move {
                    let raw = ctx
                        .client
                        .send(
                            reqwest::Method::POST,
                            &path,
                            &session.token,
                            WriteOptions {
                                body: Some(json!({ "body": body })),
                                accept: Some(HTML_ACCEPT),
                                ..Default::default()
                            },
                        )
                        .await?;
                    to_comment(&raw).ok_or_else(|| ApiError::msg("GitHub returned an invalid comment."))
                }
            },
            |_s| {
                let path = path.clone();
                let session = &session;
                let login = login.clone();
                async move {
                    let since = iso_from_ms(started_at - RECONCILE_SKEW_MS);
                    let thread = get_html(
                        ctx,
                        session,
                        &format!("{path}?since={since}&per_page={COMMENTS_PER_PAGE}"),
                    )
                    .await?;
                    let found = thread
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(to_comment)
                        .find(|c| c.author_login == login && c.body == body);
                    Ok(match found {
                        Some(c) => Reconciled::Applied(c),
                        None => Reconciled::NotApplied,
                    })
                }
            },
        )
        .await
}

pub async fn update_comment(
    ctx: &Ctx,
    repo_full_name: &str,
    comment_id: u64,
    body: &str,
    base_updated_at: &str,
) -> Result<CommentUpdateResult, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_comment_id(comment_id).map_err(ApiError::msg)?;
    validate_comment_body(body).map_err(ApiError::msg)?;
    ctx.writes.assert_can_write()?;
    let path = commit_path(&owner, &repo, comment_id);
    let session = ctx.session().await?;
    let current = read_own_comment(ctx, &session, &path, &session.login).await?;
    if current.updated_at != base_updated_at {
        return Ok(CommentUpdateResult::Conflict { current });
    }
    let saved = ctx
        .writes
        .run(
            || {
                let path = path.clone();
                let session = &session;
                async move {
                    let raw = ctx
                        .client
                        .send(
                            reqwest::Method::PATCH,
                            &path,
                            &session.token,
                            WriteOptions {
                                body: Some(json!({ "body": body })),
                                accept: Some(HTML_ACCEPT),
                                ..Default::default()
                            },
                        )
                        .await?;
                    to_comment(&raw).ok_or_else(|| ApiError::msg("GitHub returned an invalid comment."))
                }
            },
            || {
                let path = path.clone();
                let session = &session;
                async move {
                    let now = read_comment(ctx, session, &path).await?;
                    Ok(match now {
                        Some(c) if c.body == body => Reconciled::Applied(c),
                        _ => Reconciled::NotApplied,
                    })
                }
            },
        )
        .await?;
    Ok(CommentUpdateResult::Saved { comment: saved })
}

pub async fn delete_comment(ctx: &Ctx, repo_full_name: &str, comment_id: u64) -> Result<(), ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_comment_id(comment_id).map_err(ApiError::msg)?;
    ctx.writes.assert_can_write()?;
    let path = commit_path(&owner, &repo, comment_id);
    let session = ctx.session().await?;
    read_own_comment(ctx, &session, &path, &session.login).await?;
    ctx.writes
        .run(
            || {
                let path = path.clone();
                let session = &session;
                async move {
                    ctx.client
                        .send(reqwest::Method::DELETE, &path, &session.token, WriteOptions::default())
                        .await?;
                    Ok(())
                }
            },
            || {
                let path = path.clone();
                let session = &session;
                async move {
                    // A comment GitHub no longer has was deleted by the earlier request.
                    Ok(match read_comment(ctx, session, &path).await? {
                        None => Reconciled::Applied(()),
                        Some(_) => Reconciled::NotApplied,
                    })
                }
            },
        )
        .await
}

pub async fn markdown_preview(ctx: &Ctx, repo_full_name: &str, text: &str) -> Result<String, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_comment_body(text).map_err(ApiError::msg)?;
    let session = ctx.session().await?;
    let raw = ctx
        .client
        .send(
            reqwest::Method::POST,
            "/markdown",
            &session.token,
            WriteOptions {
                body: Some(json!({ "text": text, "mode": "gfm", "context": format!("{owner}/{repo}") })),
                text: true,
                ..Default::default()
            },
        )
        .await?;
    Ok(raw.as_str().unwrap_or_default().to_string())
}

/// Links, comments and sub-issues of one issue, for the detail view. Used by `get_issue_links`.
pub async fn get_issue_links(ctx: &Ctx, repo_full_name: &str, number: u64) -> Result<IssueLinks, ApiError> {
    crate::github::links::issue_links(ctx, repo_full_name, number).await
}

fn iso_from_ms(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .unwrap_or_default()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comment_path_matches_api_shape() {
        assert_eq!(commit_path("o", "r", 7), "/repos/o/r/issues/comments/7");
    }
}
