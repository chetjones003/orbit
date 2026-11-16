//! Pull requests: lists, detail, diffs, review threads, the pending review, merge, auto-merge, draft state, and CI
//! runs. Ported from `issue-service.ts`.

use serde_json::{json, Value};

use super::client::{GitHubError, WriteOptions};
use super::issues::fetch_comments;
use super::util::*;
use super::write::{ApiError, Reconciled, UncertainState};
use super::{get_html, get_json, Ctx, Session};
use crate::github::review_anchor::anchor_in_patch;
use crate::model::issues::*;

const PULLS_PER_PAGE: u32 = 100;
const PULL_LIST_PAGE_LIMIT: u32 = 10;
const PULL_FILES_PER_PAGE: u32 = 100;
const PULL_FILES_PAGE_LIMIT: u32 = 30;
const BRANCH_PAGE_LIMIT: u32 = 10;
const JOB_LOG_LIMIT: usize = 400_000;

const REVIEW_THREADS_QUERY: &str = r#"query ($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        totalCount
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          comments(first: 100) {
            totalCount
            nodes {
              fullDatabaseId
              author { login }
              body
              bodyHTML
              createdAt
              url
              diffHunk
            }
          }
        }
      }
    }
  }
}"#;

const REVIEW_STATE_QUERY: &str = r#"query ($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
      headRefOid
      author { login }
      reviews(first: 5, states: [PENDING]) {
        nodes {
          id
          commit { oid }
        }
      }
      reviewThreads(first: 100) {
        totalCount
        nodes {
          diffSide
          comments(first: 100) {
            nodes { fullDatabaseId path line body state }
          }
        }
      }
    }
  }
}"#;

const RECENT_REVIEWS_QUERY: &str = r#"query ($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviews(last: 10) {
        nodes { id state body author { login } }
      }
    }
  }
}"#;

const ADD_REVIEW: &str = r#"mutation ($input: AddPullRequestReviewInput!) {
  addPullRequestReview(input: $input) { pullRequestReview { id commit { oid } } }
}"#;
const ADD_REVIEW_THREAD: &str = r#"mutation ($input: AddPullRequestReviewThreadInput!) {
  addPullRequestReviewThread(input: $input) {
    thread { id diffSide comments(first: 1) { nodes { fullDatabaseId path line body } } }
  }
}"#;
const ADD_REVIEW_THREAD_REPLY: &str = r#"mutation ($input: AddPullRequestReviewThreadReplyInput!) {
  addPullRequestReviewThreadReply(input: $input) { comment { fullDatabaseId path line body } }
}"#;
const RESOLVE_THREAD: &str = r#"mutation ($input: ResolveReviewThreadInput!) {
  resolveReviewThread(input: $input) { thread { id isResolved } }
}"#;
const UNRESOLVE_THREAD: &str = r#"mutation ($input: UnresolveReviewThreadInput!) {
  unresolveReviewThread(input: $input) { thread { id isResolved } }
}"#;
const SUBMIT_REVIEW: &str = r#"mutation ($input: SubmitPullRequestReviewInput!) {
  submitPullRequestReview(input: $input) { pullRequestReview { id state } }
}"#;
const THREAD_SIDE_QUERY: &str = r#"query ($id: ID!) { node(id: $id) { ... on PullRequestReviewThread { diffSide } } }"#;
const THREAD_STATE_QUERY: &str = r#"query ($id: ID!) { node(id: $id) { ... on PullRequestReviewThread { isResolved } } }"#;
const REVIEW_STATE_NODE_QUERY: &str = r#"query ($id: ID!) { node(id: $id) { ... on PullRequestReview { state } } }"#;
const PULL_NODE_QUERY: &str = r#"query ($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
      headRefOid
      isDraft
      autoMergeRequest { mergeMethod }
    }
  }
}"#;
const ENABLE_AUTO_MERGE: &str = r#"mutation ($input: EnablePullRequestAutoMergeInput!) {
  enablePullRequestAutoMerge(input: $input) { pullRequest { id } }
}"#;
const DISABLE_AUTO_MERGE: &str = r#"mutation ($input: DisablePullRequestAutoMergeInput!) {
  disablePullRequestAutoMerge(input: $input) { pullRequest { id } }
}"#;
const CONVERT_TO_DRAFT: &str = r#"mutation ($input: ConvertPullRequestToDraftInput!) {
  convertPullRequestToDraft(input: $input) { pullRequest { id } }
}"#;
const MARK_READY_FOR_REVIEW: &str = r#"mutation ($input: MarkPullRequestReadyForReviewInput!) {
  markPullRequestReadyForReview(input: $input) { pullRequest { id } }
}"#;

const REVIEW_EVENTS: &[&str] = &["COMMENT", "APPROVE", "REQUEST_CHANGES"];
const MERGE_METHODS: &[&str] = &["merge", "squash", "rebase"];

fn merge_method_enum(method: &str) -> Option<&'static str> {
    match method {
        "merge" => Some("MERGE"),
        "squash" => Some("SQUASH"),
        "rebase" => Some("REBASE"),
        _ => None,
    }
}

fn check_method(method: &str) -> Result<(), ApiError> {
    if MERGE_METHODS.contains(&method) {
        Ok(())
    } else {
        Err(ApiError::msg("Choose a merge, squash, or rebase merge."))
    }
}

/// GraphQL responses: `data` from a 200 body. Any `errors` mean the request was refused, not retried.
fn graphql_data(response: Value) -> Result<Value, ApiError> {
    if let Some(list) = response.get("errors").and_then(Value::as_array) {
        if !list.is_empty() {
            return Err(ApiError::msg("GitHub refused the review request."));
        }
    }
    Ok(response.get("data").cloned().unwrap_or(json!({})))
}

async fn graphql(ctx: &Ctx, session: &Session, query: &str, variables: Value) -> Result<Value, ApiError> {
    let response = ctx
        .client
        .send(
            reqwest::Method::POST,
            "/graphql",
            &session.token,
            WriteOptions {
                body: Some(json!({ "query": query, "variables": variables })),
                ..Default::default()
            },
        )
        .await?;
    graphql_data(response)
}

/// A pull request's head and author, plus the user's pending review, in one read.
pub struct ReviewPullRequest {
    pub id: String,
    pub head_sha: String,
    pub author_login: String,
    pub pending: Option<PendingReview>,
}

fn database_pending_comments(thread: &Value) -> Vec<PendingReviewComment> {
    let side = thread.get("diffSide");
    thread
        .get("comments")
        .and_then(|c| c.get("nodes"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|node| node.get("state").and_then(Value::as_str) == Some("PENDING"))
        .filter_map(|node| to_pending_comment(node, side))
        .collect()
}

fn to_pending_comment(node: &Value, side: Option<&Value>) -> Option<PendingReviewComment> {
    let id = database_id_of(node.get("fullDatabaseId")?)?;
    let path = s(node, "path")?;
    let side = side?.as_str()?;
    if side != "LEFT" && side != "RIGHT" {
        return None;
    }
    Some(PendingReviewComment {
        id,
        path,
        side: side.to_string(),
        line: u(node, "line"),
        body: s(node, "body").unwrap_or_default(),
    })
}

async fn read_review_pull_request(ctx: &Ctx, session: &Session, owner: &str, repo: &str, number: u64) -> Result<ReviewPullRequest, ApiError> {
    let data = graphql(ctx, session, REVIEW_STATE_QUERY, json!({ "owner": owner, "name": repo, "number": number })).await?;
    let pr = data
        .get("repository")
        .and_then(|r| r.get("pullRequest"))
        .filter(|p| !p.is_null())
        .ok_or_else(|| ApiError::msg("GitHub returned an invalid pull request."))?;
    let id = s(pr, "id").ok_or_else(|| ApiError::msg("GitHub returned an invalid pull request."))?;
    let head_sha = s(pr, "headRefOid").ok_or_else(|| ApiError::msg("GitHub returned an invalid pull request."))?;
    let author_login = pr.get("author").and_then(login_of).unwrap_or_default();

    let nodes = pr
        .get("reviews")
        .and_then(|r| r.get("nodes"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let threads = pr.get("reviewThreads");
    let thread_nodes = threads
        .and_then(|t| t.get("nodes"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let pending_comments: Vec<PendingReviewComment> = thread_nodes.iter().flat_map(database_pending_comments).collect();
    let threads_total = threads.and_then(|t| t.get("totalCount")).and_then(Value::as_u64);
    let threads_partial = threads_total.map(|t| t as usize > thread_nodes.len()).unwrap_or(false);

    let pending = nodes.first().and_then(|first| {
        let review_id = s(first, "id")?;
        let commit_sha = first.get("commit").and_then(|c| s(c, "oid"))?;
        Some(PendingReview {
            id: review_id,
            commit_sha,
            comments: pending_comments.clone(),
            comments_partial: threads_partial,
        })
    });

    Ok(ReviewPullRequest {
        id,
        head_sha,
        author_login,
        pending,
    })
}

pub async fn list_pulls(ctx: &Ctx, query: &PullListQuery) -> Result<PullListPage, ApiError> {
    let (owner, repo) = ctx.personal_repo(&query.repo_full_name)?;
    let page = validate_page(query.page).map_err(ApiError::msg)?;
    let state = validate_state(&query.state).map_err(ApiError::msg)?;
    let label = query
        .label
        .as_deref()
        .map(|l| validate_text(l, "label").map_err(ApiError::msg))
        .transpose()?;
    let author = query
        .author
        .as_deref()
        .map(|a| validate_text(a, "author").map_err(ApiError::msg))
        .transpose()?;
    let session = ctx.session().await?;

    let mut matches: Vec<PullSummary> = Vec::new();
    let mut partial = false;
    let mut exhausted = false;
    let needed = (page * ISSUES_PER_PAGE + 1) as usize;
    for source_page in 1..=PULL_LIST_PAGE_LIMIT {
        let body = get_json(
            ctx,
            &session,
            &format!(
                "{}/pulls?state={state}&per_page={PULLS_PER_PAGE}&page={source_page}",
                repo_path(&owner, &repo)
            ),
        )
        .await?;
        let list = body
            .as_array()
            .ok_or_else(|| ApiError::msg("GitHub returned an invalid pull request list."))?;
        for raw in list {
            let Some(item) = to_pull_summary(raw) else {
                partial = true;
                continue;
            };
            if let Some(label) = &label {
                if !item.issue.labels.iter().any(|l| l.name.to_lowercase() == label.to_lowercase()) {
                    continue;
                }
            }
            if let Some(author) = &author {
                if item.issue.author_login.to_lowercase() != author.to_lowercase() {
                    continue;
                }
            }
            matches.push(item);
        }
        if (list.len() as u32) < PULLS_PER_PAGE {
            exhausted = true;
            break;
        }
        if source_page == PULL_LIST_PAGE_LIMIT {
            partial = true;
        }
        if matches.len() >= needed {
            break;
        }
    }
    if !exhausted && matches.len() < needed {
        partial = true;
    }
    let start = ((page - 1) * ISSUES_PER_PAGE) as usize;
    let end = (start + ISSUES_PER_PAGE as usize).min(matches.len());
    let has_next = matches.len() > start + ISSUES_PER_PAGE as usize;
    let items = if start < matches.len() {
        matches[start..end].to_vec()
    } else {
        Vec::new()
    };
    Ok(PullListPage {
        items,
        page,
        has_next_page: has_next,
        partial,
    })
}

pub async fn get_pull_detail(ctx: &Ctx, repo_full_name: &str, number: u64) -> Result<PullDetail, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    let base = item_path(&owner, &repo, "issues", number);
    let session = ctx.session().await?;
    let pull_path = item_path(&owner, &repo, "pulls", number);

    let pull_body = get_html(ctx, &session, &pull_path).await?;
    let summary = to_summary(&pull_body).ok_or_else(|| ApiError::msg("GitHub returned an invalid pull request."))?;
    let body_html = s(&pull_body, "body_html").unwrap_or_default();
    let (comments, comments_partial) = fetch_comments(ctx, &session, &base).await?;
    let head_sha = pull_body
        .get("head")
        .and_then(|h| s(h, "sha"))
        .unwrap_or_default();

    let reviews_raw = get_json(ctx, &session, &format!("{pull_path}/reviews?per_page=100&page=1")).await?;
    let runs_raw = get_json(
        ctx,
        &session,
        &format!(
            "{}/commits/{}/check-runs?per_page=100",
            repo_path(&owner, &repo),
            enc(&head_sha)
        ),
    )
    .await?;

    let reviews_list = reviews_raw.as_array().cloned();
    let reviews: Vec<PullReview> = reviews_list
        .as_ref()
        .map(|list| {
            list.iter()
                .filter_map(|r| {
                    Some(PullReview {
                        id: u(r, "id")?,
                        author_login: r.get("user").and_then(login_of).unwrap_or_else(|| "unknown".into()),
                        state: s(r, "state").unwrap_or_else(|| "COMMENTED".into()),
                        submitted_at: s(r, "submitted_at"),
                        body: s(r, "body").unwrap_or_default(),
                        html_url: s(r, "html_url").unwrap_or_default(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let runs = runs_raw
        .get("check_runs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let checks: Vec<PullCheck> = runs
        .iter()
        .filter_map(|c| {
            Some(PullCheck {
                name: s(c, "name")?,
                status: s(c, "status").unwrap_or_else(|| "queued".into()),
                conclusion: s(c, "conclusion"),
                details_url: s(c, "html_url"),
            })
        })
        .collect();
    let check_total = runs_raw.get("total_count").and_then(Value::as_u64);

    let summary = to_pull_summary(&pull_body).unwrap_or(PullSummary {
        issue: summary,
        draft: false,
        merged: false,
        head_ref: String::new(),
        base_ref: String::new(),
    });
    Ok(PullDetail {
        summary,
        body: raw_body(&pull_body),
        body_html,
        comments,
        comments_partial,
        reviews,
        reviews_partial: reviews_list.as_ref().map(|l| l.len() as u32 >= 100).unwrap_or(true),
        checks_partial: check_total.map(|t| t as usize > checks.len()).unwrap_or(false),
        checks,
        mergeable: pull_body.get("mergeable").and_then(Value::as_bool),
        mergeable_state: s(&pull_body, "mergeable_state").unwrap_or_else(|| "unknown".into()),
        merged: b(&pull_body, "merged"),
    })
}

pub async fn get_pull_files(ctx: &Ctx, repo_full_name: &str, number: u64) -> Result<PullFilesPage, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    let session = ctx.session().await?;
    let mut files = Vec::new();
    let mut partial = false;
    for page in 1..=PULL_FILES_PAGE_LIMIT {
        let body = get_json(
            ctx,
            &session,
            &format!(
                "{}/files?per_page={PULL_FILES_PER_PAGE}&page={page}",
                item_path(&owner, &repo, "pulls", number)
            ),
        )
        .await?;
        let list = body
            .as_array()
            .ok_or_else(|| ApiError::msg("GitHub returned an invalid list of changed files."))?;
        for raw in list {
            match to_pull_file(raw) {
                Some(file) => files.push(file),
                None => partial = true,
            }
        }
        if (list.len() as u32) < PULL_FILES_PER_PAGE {
            return Ok(PullFilesPage { files, partial });
        }
    }
    Ok(PullFilesPage { files, partial: true })
}

pub async fn get_pull_review_threads(ctx: &Ctx, repo_full_name: &str, number: u64) -> Result<PullReviewThreadsPage, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    let session = ctx.session().await?;
    let data = graphql(
        ctx,
        &session,
        REVIEW_THREADS_QUERY,
        json!({ "owner": owner, "name": repo, "number": number }),
    )
    .await?;
    let connection = data
        .get("repository")
        .and_then(|r| r.get("pullRequest"))
        .and_then(|p| p.get("reviewThreads"))
        .filter(|c| c.get("nodes").map(Value::is_array).unwrap_or(false))
        .ok_or_else(|| ApiError::msg("GitHub returned invalid review threads."))?;
    let nodes = connection.get("nodes").and_then(Value::as_array).cloned().unwrap_or_default();
    let threads: Vec<PullReviewThread> = nodes.iter().filter_map(to_review_thread).collect();
    let invalid = nodes.len() - threads.len();
    let total = connection
        .get("totalCount")
        .and_then(Value::as_u64)
        .map(|t| t as usize)
        .unwrap_or(threads.len());
    Ok(PullReviewThreadsPage {
        threads,
        partial: invalid > 0 || total > nodes.len(),
    })
}

fn to_review_thread(raw: &Value) -> Option<PullReviewThread> {
    let id = s(raw, "id")?;
    let path = s(raw, "path")?;
    let comments_obj = raw.get("comments")?;
    let nodes = comments_obj.get("nodes")?.as_array()?;
    let comments: Vec<PullReviewComment> = nodes
        .iter()
        .filter_map(|node| {
            let id = database_id_of(node.get("fullDatabaseId")?)?;
            let created_at = s(node, "createdAt")?;
            let html_url = s(node, "url")?;
            Some(PullReviewComment {
                id,
                author_login: node.get("author").and_then(login_of).unwrap_or_else(|| "ghost".into()),
                created_at,
                html_url,
                body: s(node, "body").unwrap_or_default(),
                body_html: s(node, "bodyHTML").unwrap_or_default(),
            })
        })
        .collect();
    let total = comments_obj
        .get("totalCount")
        .and_then(Value::as_u64)
        .map(|t| t as usize)
        .unwrap_or(nodes.len());
    let diff_hunk = nodes
        .first()
        .and_then(|n| s(n, "diffHunk"))
        .unwrap_or_default();
    Some(PullReviewThread {
        id,
        path,
        line: u(raw, "line"),
        original_line: u(raw, "originalLine"),
        is_resolved: b(raw, "isResolved"),
        is_outdated: b(raw, "isOutdated"),
        diff_hunk,
        comments_partial: total > nodes.len() || comments.len() < nodes.len(),
        comments,
    })
}

pub async fn get_pull_review_state(ctx: &Ctx, repo_full_name: &str, number: u64) -> Result<PullReviewState, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    let session = ctx.session().await?;
    let login = session.login.clone();
    let pr = read_review_pull_request(ctx, &session, &owner, &repo, number).await?;
    Ok(PullReviewState {
        head_sha: pr.head_sha,
        is_own_pull: pr.author_login.to_lowercase() == login.to_lowercase(),
        pending: pr.pending,
    })
}

/// The id of the user's pending review, starting one on `expected_head` when none exists. Fresh state is read each
/// time, so a head that has moved is reported instead of written against.
async fn ensure_pending_review(
    ctx: &Ctx,
    session: &Session,
    owner: &str,
    repo: &str,
    number: u64,
    expected_head: &str,
) -> Result<Result<String, String>, ApiError> {
    let current = read_review_pull_request(ctx, session, owner, repo, number).await?;
    if current.head_sha != expected_head {
        return Ok(Err(current.head_sha));
    }
    if let Some(pending) = current.pending {
        return Ok(Ok(pending.id));
    }
    let data = graphql(
        ctx,
        session,
        ADD_REVIEW,
        json!({ "input": { "pullRequestId": current.id, "commitOID": expected_head } }),
    )
    .await?;
    let id = data
        .get("addPullRequestReview")
        .and_then(|r| r.get("pullRequestReview"))
        .and_then(|r| s(r, "id"))
        .ok_or_else(|| ApiError::msg("GitHub returned an invalid review."))?;
    // The head may have moved while the review was being created. The caller must not write against it.
    let after = read_review_pull_request(ctx, session, owner, repo, number).await?;
    if after.head_sha != expected_head {
        return Ok(Err(after.head_sha));
    }
    Ok(Ok(id))
}

async fn read_recent_own_reviews(
    ctx: &Ctx,
    session: &Session,
    owner: &str,
    repo: &str,
    number: u64,
    login: &str,
) -> Result<Vec<(String, String, String)>, ApiError> {
    let data = graphql(
        ctx,
        session,
        RECENT_REVIEWS_QUERY,
        json!({ "owner": owner, "name": repo, "number": number }),
    )
    .await?;
    let nodes = data
        .get("repository")
        .and_then(|r| r.get("pullRequest"))
        .and_then(|p| p.get("reviews"))
        .and_then(|r| r.get("nodes"))
        .and_then(Value::as_array);
    let Some(nodes) = nodes else {
        return Ok(Vec::new());
    };
    Ok(nodes
        .iter()
        .filter(|node| {
            node.get("author").and_then(login_of).map(|l| l.to_lowercase() == login.to_lowercase()).unwrap_or(false)
        })
        .filter_map(|node| Some((s(node, "id")?, s(node, "body")?, s(node, "state").unwrap_or_default())))
        .collect())
}

async fn thread_side(ctx: &Ctx, session: &Session, thread_id: &str) -> Result<String, ApiError> {
    let node = read_node(ctx, session, thread_id, THREAD_SIDE_QUERY).await?;
    match node.as_ref().and_then(|n| n.get("diffSide")).and_then(Value::as_str) {
        Some(side) if side == "LEFT" || side == "RIGHT" => Ok(side.to_string()),
        _ => Err(ApiError::msg("That review thread is not on this pull request.")),
    }
}

async fn read_node(ctx: &Ctx, session: &Session, id: &str, query: &str) -> Result<Option<Value>, ApiError> {
    let data = graphql(ctx, session, query, json!({ "id": id })).await?;
    Ok(data.get("node").filter(|n| !n.is_null()).cloned())
}

/// Saves a comment on a changed line into the pending review, starting the review if none exists.
pub async fn add_review_comment(
    ctx: &Ctx,
    repo_full_name: &str,
    number: u64,
    anchor: ReviewAnchor,
    body: &str,
    reviewed_head_sha: &str,
) -> Result<ReviewCommentResult, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    if anchor.path.is_empty() || anchor.path.len() > 1024 {
        return Err(ApiError::msg("Choose a line in a changed file."));
    }
    validate_anchor_side(&anchor.side).map_err(ApiError::msg)?;
    if anchor.line < 1 {
        return Err(ApiError::msg("Choose a line in a changed file."));
    }
    validate_comment_body(body).map_err(ApiError::msg)?;
    validate_sha(reviewed_head_sha).map_err(ApiError::msg)?;
    ctx.writes.assert_can_write()?;
    let session = ctx.session().await?;
    let pr = read_review_pull_request(ctx, &session, &owner, &repo, number).await?;
    if pr.head_sha != reviewed_head_sha {
        return Ok(ReviewCommentResult::NewCommits { head_sha: pr.head_sha });
    }

    let files = get_pull_files_inner(ctx, &session, &owner, &repo, number).await?;
    let file = files.iter().find(|f| f.filename == anchor.path);
    match file.and_then(|f| f.patch.as_deref()) {
        Some(patch) if anchor_in_patch(patch, &anchor) => {}
        _ => return Err(ApiError::msg("That line is not part of the diff, so it cannot take a comment.")),
    }

    let existing: Vec<u64> = pr
        .pending
        .as_ref()
        .map(|p| p.comments.iter().map(|c| c.id).collect())
        .unwrap_or_default();
    let key = format!(
        "comment\u{0}{owner}\u{0}{repo}\u{0}{number}\u{0}{}\u{0}{}\u{0}{}\u{0}{body}",
        anchor.path, anchor.side, anchor.line
    );
    let pr_id = pr.id.clone();
    let body = body.to_string();
    ctx.writes
        .keyed(
            key,
            UncertainState::ExistingIds(existing.clone()),
            |_state| {
                let anchor = anchor.clone();
                let body = body.clone();
                let session = &session;
                let (owner, repo) = (owner.clone(), repo.clone());
                let pr_id = pr_id.clone();
                let expected = reviewed_head_sha.to_string();
                async move {
                    let review_id = match ensure_pending_review(ctx, session, &owner, &repo, number, &expected).await? {
                        Ok(id) => id,
                        Err(head) => return Ok(ReviewCommentResult::NewCommits { head_sha: head }),
                    };
                    let data = graphql(
                        ctx,
                        session,
                        ADD_REVIEW_THREAD,
                        json!({ "input": {
                            "pullRequestId": pr_id,
                            "pullRequestReviewId": review_id,
                            "path": anchor.path,
                            "line": anchor.line,
                            "side": anchor.side,
                            "body": body,
                        }}),
                    )
                    .await?;
                    let thread = data.get("addPullRequestReviewThread").and_then(|t| t.get("thread"));
                    let side = thread.and_then(|t| t.get("diffSide"));
                    let comment = thread
                        .and_then(|t| t.get("comments"))
                        .and_then(|c| c.get("nodes"))
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .find_map(|node| to_pending_comment(node, side))
                        .ok_or_else(|| ApiError::msg("GitHub returned an invalid review comment."))?;
                    Ok(ReviewCommentResult::Saved { comment })
                }
            },
            |state| {
                let anchor = anchor.clone();
                let body = body.clone();
                let session = &session;
                let (owner, repo) = (owner.clone(), repo.clone());
                let existing = existing.clone();
                let _ = &state;
                async move {
                    let now = read_review_pull_request(ctx, session, &owner, &repo, number).await?;
                    let found = now.pending.as_ref().and_then(|p| {
                        p.comments.iter().find(|c| {
                            !existing.contains(&c.id)
                                && c.path == anchor.path
                                && c.side == anchor.side
                                && c.line == Some(anchor.line)
                                && c.body == body
                        })
                    });
                    Ok(match found {
                        Some(c) => Reconciled::Applied(ReviewCommentResult::Saved { comment: c.clone() }),
                        None => Reconciled::NotApplied,
                    })
                }
            },
        )
        .await
}

async fn get_pull_files_inner(ctx: &Ctx, session: &Session, owner: &str, repo: &str, number: u64) -> Result<Vec<PullFile>, ApiError> {
    let mut files = Vec::new();
    for page in 1..=PULL_FILES_PAGE_LIMIT {
        let body = get_json(
            ctx,
            session,
            &format!(
                "{}/files?per_page={PULL_FILES_PER_PAGE}&page={page}",
                item_path(owner, repo, "pulls", number)
            ),
        )
        .await?;
        let list = body
            .as_array()
            .ok_or_else(|| ApiError::msg("GitHub returned an invalid list of changed files."))?;
        files.extend(list.iter().filter_map(to_pull_file));
        if (list.len() as u32) < PULL_FILES_PER_PAGE {
            break;
        }
    }
    Ok(files)
}

/// Replies to a review thread inside the pending review.
pub async fn reply_to_review_thread(
    ctx: &Ctx,
    repo_full_name: &str,
    number: u64,
    thread_id: &str,
    body: &str,
    reviewed_head_sha: &str,
) -> Result<ReviewCommentResult, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    validate_node_id(thread_id)?;
    validate_comment_body(body).map_err(ApiError::msg)?;
    validate_sha(reviewed_head_sha).map_err(ApiError::msg)?;
    ctx.writes.assert_can_write()?;
    let session = ctx.session().await?;
    let pr = read_review_pull_request(ctx, &session, &owner, &repo, number).await?;
    if pr.head_sha != reviewed_head_sha {
        return Ok(ReviewCommentResult::NewCommits { head_sha: pr.head_sha });
    }
    let side = thread_side(ctx, &session, thread_id).await?;
    let existing: Vec<u64> = pr
        .pending
        .as_ref()
        .map(|p| p.comments.iter().map(|c| c.id).collect())
        .unwrap_or_default();
    let key = format!("reply\u{0}{owner}\u{0}{repo}\u{0}{number}\u{0}{thread_id}\u{0}{body}");
    let body = body.to_string();
    let thread_id = thread_id.to_string();
    let expected = reviewed_head_sha.to_string();
    ctx.writes
        .keyed(
            key,
            UncertainState::ExistingIds(existing.clone()),
            |_state| {
                let body = body.clone();
                let thread_id = thread_id.clone();
                let side = side.clone();
                let session = &session;
                let (owner, repo) = (owner.clone(), repo.clone());
                let expected = expected.clone();
                async move {
                    let review_id = match ensure_pending_review(ctx, session, &owner, &repo, number, &expected).await? {
                        Ok(id) => id,
                        Err(head) => return Ok(ReviewCommentResult::NewCommits { head_sha: head }),
                    };
                    let data = graphql(
                        ctx,
                        session,
                        ADD_REVIEW_THREAD_REPLY,
                        json!({ "input": { "pullRequestReviewId": review_id, "pullRequestReviewThreadId": thread_id, "body": body } }),
                    )
                    .await?;
                    let comment = data
                        .get("addPullRequestReviewThreadReply")
                        .and_then(|r| r.get("comment"))
                        .and_then(|c| to_pending_comment(c, Some(&Value::String(side.clone()))))
                        .ok_or_else(|| ApiError::msg("GitHub returned an invalid reply."))?;
                    Ok(ReviewCommentResult::Saved { comment })
                }
            },
            |_state| {
                let body = body.clone();
                let session = &session;
                let (owner, repo) = (owner.clone(), repo.clone());
                let existing = existing.clone();
                async move {
                    let now = read_review_pull_request(ctx, session, &owner, &repo, number).await?;
                    let found = now
                        .pending
                        .as_ref()
                        .and_then(|p| p.comments.iter().find(|c| !existing.contains(&c.id) && c.body == body));
                    Ok(match found {
                        Some(c) => Reconciled::Applied(ReviewCommentResult::Saved { comment: c.clone() }),
                        None => Reconciled::NotApplied,
                    })
                }
            },
        )
        .await
}

fn validate_node_id(id: &str) -> Result<(), ApiError> {
    if id.is_empty() || id.len() > 200 {
        return Err(ApiError::msg("That review thread is invalid."));
    }
    Ok(())
}

pub async fn set_review_thread_resolved(
    ctx: &Ctx,
    repo_full_name: &str,
    number: u64,
    thread_id: &str,
    resolved: bool,
) -> Result<bool, ApiError> {
    let _ = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    validate_node_id(thread_id)?;
    ctx.writes.assert_can_write()?;
    let session = ctx.session().await?;
    let field = if resolved { "resolveReviewThread" } else { "unresolveReviewThread" };
    let query = if resolved { RESOLVE_THREAD } else { UNRESOLVE_THREAD };
    ctx.writes
        .run(
            || {
                let session = &session;
                async move {
                    let data = graphql(ctx, session, query, json!({ "input": { "threadId": thread_id } })).await?;
                    data.get(field)
                        .and_then(|f| f.get("thread"))
                        .and_then(|t| t.get("isResolved"))
                        .and_then(Value::as_bool)
                        .ok_or_else(|| ApiError::msg("GitHub returned an invalid review thread."))
                }
            },
            || {
                let session = &session;
                async move {
                    let now = read_node(ctx, session, thread_id, THREAD_STATE_QUERY).await?;
                    let is_resolved = now.as_ref().and_then(|n| n.get("isResolved")).and_then(Value::as_bool);
                    Ok(if is_resolved == Some(resolved) {
                        Reconciled::Applied(resolved)
                    } else {
                        Reconciled::NotApplied
                    })
                }
            },
        )
        .await
}

pub async fn submit_review(
    ctx: &Ctx,
    repo_full_name: &str,
    number: u64,
    event: &str,
    body: &str,
    reviewed_head_sha: &str,
) -> Result<ReviewSubmitResult, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    if !REVIEW_EVENTS.contains(&event) {
        return Err(ApiError::msg("Choose Comment, Approve, or Request changes."));
    }
    if body.chars().count() > COMMENT_MAX_CHARS {
        return Err(ApiError::msg(format!(
            "Reviews can be at most {} characters.",
            with_commas(COMMENT_MAX_CHARS)
        )));
    }
    validate_sha(reviewed_head_sha).map_err(ApiError::msg)?;
    ctx.writes.assert_can_write()?;
    let session = ctx.session().await?;
    let login = session.login.clone();
    let pr = read_review_pull_request(ctx, &session, &owner, &repo, number).await?;
    if event != "COMMENT" && pr.author_login.to_lowercase() == login.to_lowercase() {
        return Err(ApiError::msg("You can't approve or request changes on your own pull request."));
    }
    if pr.head_sha != reviewed_head_sha {
        return Ok(ReviewSubmitResult::NewCommits { head_sha: pr.head_sha });
    }

    let key = format!("submit\u{0}{owner}\u{0}{repo}\u{0}{number}\u{0}{event}\u{0}{body}");
    let baseline: Vec<String> = read_recent_own_reviews(ctx, &session, &owner, &repo, number, &login)
        .await?
        .into_iter()
        .map(|(id, _, _)| id)
        .collect();
    let body = body.to_string();
    let event = event.to_string();
    let expected = reviewed_head_sha.to_string();
    ctx.writes
        .keyed(
            key,
            UncertainState::Submit { baseline, pending: None },
            |state| {
                let body = body.clone();
                let event = event.clone();
                let expected = expected.clone();
                let session = &session;
                let (owner, repo) = (owner.clone(), repo.clone());
                async move {
                    let current = read_review_pull_request(ctx, session, &owner, &repo, number).await?;
                    if current.head_sha != expected {
                        return Ok(ReviewSubmitResult::NewCommits { head_sha: current.head_sha });
                    }
                    if let Some(pending) = current.pending {
                        set_submit_pending(&state, Some(pending.id.clone()));
                        graphql(
                            ctx,
                            session,
                            SUBMIT_REVIEW,
                            json!({ "input": { "pullRequestReviewId": pending.id, "event": event, "body": body } }),
                        )
                        .await?;
                    } else {
                        graphql(
                            ctx,
                            session,
                            ADD_REVIEW,
                            json!({ "input": { "pullRequestId": current.id, "commitOID": current.head_sha, "event": event, "body": body } }),
                        )
                        .await?;
                    }
                    Ok(ReviewSubmitResult::Submitted)
                }
            },
            |state| {
                let body = body.clone();
                let session = &session;
                let (owner, repo) = (owner.clone(), repo.clone());
                let login = login.clone();
                async move {
                    let (baseline, pending) = submit_state(&state);
                    if let Some(pending_id) = pending {
                        let node = read_node(ctx, session, &pending_id, REVIEW_STATE_NODE_QUERY).await?;
                        let landed = node
                            .as_ref()
                            .and_then(|n| n.get("state"))
                            .and_then(Value::as_str)
                            .map(|st| st != "PENDING")
                            .unwrap_or(false);
                        return Ok(if landed {
                            Reconciled::Applied(ReviewSubmitResult::Submitted)
                        } else {
                            Reconciled::NotApplied
                        });
                    }
                    // A review created by the failed request is one the user did not have before the first attempt.
                    let now = read_recent_own_reviews(ctx, session, &owner, &repo, number, &login).await?;
                    let landed = now
                        .iter()
                        .any(|(id, b, st)| !baseline.contains(id) && *b == body && st != "PENDING");
                    Ok(if landed {
                        Reconciled::Applied(ReviewSubmitResult::Submitted)
                    } else {
                        Reconciled::NotApplied
                    })
                }
            },
        )
        .await
}

fn set_submit_pending(state: &std::sync::Mutex<UncertainState>, pending: Option<String>) {
    if let UncertainState::Submit { pending: slot, .. } = &mut *state.lock().expect("state poisoned") {
        *slot = pending;
    }
}

fn submit_state(state: &std::sync::Mutex<UncertainState>) -> (Vec<String>, Option<String>) {
    match &*state.lock().expect("state poisoned") {
        UncertainState::Submit { baseline, pending } => (baseline.clone(), pending.clone()),
        _ => (Vec::new(), None),
    }
}

/// Merge settings of a repo, as GitHub reports them.
#[derive(Clone, Copy)]
pub struct MergeSettings {
    pub allow_merge_commit: bool,
    pub allow_squash_merge: bool,
    pub allow_rebase_merge: bool,
    pub allow_auto_merge: bool,
    pub delete_branch_on_merge: bool,
}

fn read_merge_settings(raw: &Value) -> MergeSettings {
    MergeSettings {
        allow_merge_commit: b(raw, "allow_merge_commit"),
        allow_squash_merge: b(raw, "allow_squash_merge"),
        allow_rebase_merge: b(raw, "allow_rebase_merge"),
        allow_auto_merge: b(raw, "allow_auto_merge"),
        delete_branch_on_merge: b(raw, "delete_branch_on_merge"),
    }
}

fn allowed_merge_methods(settings: MergeSettings) -> Vec<String> {
    let mut methods = Vec::new();
    if settings.allow_merge_commit {
        methods.push("merge".to_string());
    }
    if settings.allow_squash_merge {
        methods.push("squash".to_string());
    }
    if settings.allow_rebase_merge {
        methods.push("rebase".to_string());
    }
    methods
}

async fn read_merge_settings_for(ctx: &Ctx, session: &Session, owner: &str, repo: &str) -> Result<MergeSettings, ApiError> {
    let raw = get_json(ctx, session, &repo_path(owner, repo)).await?;
    Ok(read_merge_settings(&raw))
}

/// The pull request's GraphQL node id, head, draft state, and auto-merge method.
pub struct PullNode {
    pub id: String,
    pub head_sha: String,
    pub is_draft: bool,
    pub auto_merge_method: Option<String>,
}

async fn read_pull_node(ctx: &Ctx, session: &Session, owner: &str, repo: &str, number: u64) -> Result<PullNode, ApiError> {
    let data = graphql(ctx, session, PULL_NODE_QUERY, json!({ "owner": owner, "name": repo, "number": number })).await?;
    let pr = data
        .get("repository")
        .and_then(|r| r.get("pullRequest"))
        .filter(|p| !p.is_null())
        .ok_or_else(|| ApiError::msg("GitHub returned an invalid pull request."))?;
    let id = s(pr, "id").ok_or_else(|| ApiError::msg("GitHub returned an invalid pull request."))?;
    let head_sha = s(pr, "headRefOid").ok_or_else(|| ApiError::msg("GitHub returned an invalid pull request."))?;
    let enum_value = pr
        .get("autoMergeRequest")
        .and_then(|a| a.get("mergeMethod"))
        .and_then(Value::as_str);
    let auto_merge_method = ["merge", "squash", "rebase"]
        .into_iter()
        .find(|m| merge_method_enum(m) == enum_value)
        .map(str::to_string);
    Ok(PullNode {
        id,
        head_sha,
        is_draft: pr.get("isDraft").and_then(Value::as_bool) == Some(true),
        auto_merge_method,
    })
}

/// The REST fields the merge flow reads from a pull request.
pub struct PullFields {
    pub head_sha: String,
    pub head_ref: String,
    pub head_repo: String,
    pub draft: bool,
    pub merged: bool,
    pub merge_commit_sha: Option<String>,
    pub state: String,
}

fn read_pull_fields(raw: &Value) -> Result<PullFields, ApiError> {
    let head = raw.get("head");
    let head_sha = head
        .and_then(|h| s(h, "sha"))
        .ok_or_else(|| ApiError::msg("GitHub returned an invalid pull request."))?;
    let merged = b(raw, "merged");
    Ok(PullFields {
        head_sha,
        head_ref: head.and_then(|h| s(h, "ref")).unwrap_or_default(),
        head_repo: head
            .and_then(|h| h.get("repo"))
            .and_then(|r| s(r, "full_name"))
            .unwrap_or_default(),
        draft: b(raw, "draft"),
        merged,
        merge_commit_sha: if merged { s(raw, "merge_commit_sha") } else { None },
        state: if s(raw, "state").as_deref() == Some("closed") {
            "closed".into()
        } else {
            "open".into()
        },
    })
}

pub async fn get_pull_actions(ctx: &Ctx, repo_full_name: &str, number: u64) -> Result<PullActions, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    let session = ctx.session().await?;
    let path = item_path(&owner, &repo, "pulls", number);
    let settings = read_merge_settings_for(ctx, &session, &owner, &repo).await?;
    let pull_raw = get_json(ctx, &session, &path).await?;
    let node = read_pull_node(ctx, &session, &owner, &repo, number).await?;
    let pr = read_pull_fields(&pull_raw)?;
    Ok(PullActions {
        head_sha: pr.head_sha,
        head_ref: pr.head_ref,
        head_in_repo: pr.head_repo.to_lowercase() == format!("{owner}/{repo}").to_lowercase(),
        draft: pr.draft,
        merged: pr.merged,
        state: pr.state,
        allowed_merge_methods: allowed_merge_methods(settings),
        allow_auto_merge: settings.allow_auto_merge,
        auto_merge_method: node.auto_merge_method,
        delete_branch_on_merge: settings.delete_branch_on_merge,
    })
}

/// Merges with a method the repo allows, pinned to the reviewed head. A merge that GitHub reports as already landed
/// is reconciled, not repeated. The head branch is deleted only after a merge, and only if it lives in this repo.
pub async fn merge_pull(
    ctx: &Ctx,
    repo_full_name: &str,
    number: u64,
    method: &str,
    delete_branch: bool,
    expected_head_sha: &str,
) -> Result<PullMergeResult, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    check_method(method)?;
    validate_sha(expected_head_sha).map_err(ApiError::msg)?;
    ctx.writes.assert_can_write()?;
    let session = ctx.session().await?;
    let path = item_path(&owner, &repo, "pulls", number);
    let settings = read_merge_settings_for(ctx, &session, &owner, &repo).await?;
    if !allowed_merge_methods(settings).iter().any(|m| m == method) {
        return Err(ApiError::msg(format!("This repo does not allow {method} merges.")));
    }
    let pr = read_pull_fields(&get_json(ctx, &session, &path).await?)?;
    if pr.merged {
        return Err(ApiError::msg("This pull request is already merged."));
    }
    if pr.state != "open" {
        return Err(ApiError::msg("This pull request is closed."));
    }
    if pr.head_sha != expected_head_sha {
        return Ok(PullMergeResult::NewCommits { head_sha: pr.head_sha });
    }

    let sha = match ctx
        .writes
        .run(
            || {
                let path = path.clone();
                let session = &session;
                async move {
                    let merged = ctx
                        .client
                        .send(
                            reqwest::Method::PUT,
                            &format!("{path}/merge"),
                            &session.token,
                            WriteOptions {
                                body: Some(json!({ "merge_method": method, "sha": expected_head_sha })),
                                ..Default::default()
                            },
                        )
                        .await?;
                    merged
                        .get("sha")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .ok_or_else(|| ApiError::msg("GitHub returned an invalid merge."))
                }
            },
            || {
                let path = path.clone();
                let session = &session;
                async move {
                    let now = read_pull_fields(&get_json(ctx, session, &path).await?)?;
                    Ok(match now.merge_commit_sha {
                        Some(sha) => Reconciled::Applied(sha),
                        None => Reconciled::NotApplied,
                    })
                }
            },
        )
        .await
    {
        Ok(sha) => sha,
        // GitHub refuses a merge pinned to a head that has moved with 409.
        Err(error) if error.status() == Some(409) => {
            let now = read_pull_fields(&get_json(ctx, &session, &path).await?)?;
            return Ok(PullMergeResult::NewCommits { head_sha: now.head_sha });
        }
        Err(error) => return Err(error),
    };

    let mut branch_deleted = false;
    if delete_branch && pr.head_repo.to_lowercase() == format!("{owner}/{repo}").to_lowercase() {
        branch_deleted = delete_head_branch(ctx, &session, &owner, &repo, &pr.head_ref).await;
    }
    Ok(PullMergeResult::Merged { sha, branch_deleted })
}

/// Deletes a head branch after its pull request merged. When the delete fails, the branch is checked: a delete whose
/// response was lost may already have landed, and a branch that is gone counts as deleted.
async fn delete_head_branch(ctx: &Ctx, session: &Session, owner: &str, repo: &str, branch: &str) -> bool {
    if branch.is_empty() {
        return false;
    }
    let reference = format!(
        "{}/git/refs/heads/{}",
        repo_path(owner, repo),
        branch.split('/').map(enc).collect::<Vec<_>>().join("/")
    );
    match ctx
        .client
        .send(reqwest::Method::DELETE, &reference, &session.token, WriteOptions::default())
        .await
    {
        Ok(_) => true,
        Err(_) => match get_json(ctx, session, &reference).await {
            Ok(_) => false,
            Err(ApiError::GitHub(GitHubError::Http(404))) => true,
            Err(_) => false,
        },
    }
}

pub async fn set_pull_auto_merge(
    ctx: &Ctx,
    repo_full_name: &str,
    number: u64,
    enabled: bool,
    method: Option<&str>,
    expected_head_sha: &str,
) -> Result<PullWriteResult, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    validate_sha(expected_head_sha).map_err(ApiError::msg)?;
    if enabled {
        match method {
            Some(m) if MERGE_METHODS.contains(&m) => {}
            _ => return Err(ApiError::msg("Choose a merge, squash, or rebase merge.")),
        }
    }
    ctx.writes.assert_can_write()?;
    let session = ctx.session().await?;
    let method = if enabled { method.map(str::to_string) } else { None };
    if let Some(m) = &method {
        let settings = read_merge_settings_for(ctx, &session, &owner, &repo).await?;
        if !settings.allow_auto_merge {
            return Err(ApiError::msg("Auto-merge is not allowed in this repo."));
        }
        if !allowed_merge_methods(settings).iter().any(|x| x == m) {
            return Err(ApiError::msg(format!("This repo does not allow {m} merges.")));
        }
    }
    let node = read_pull_node(ctx, &session, &owner, &repo, number).await?;
    if node.head_sha != expected_head_sha {
        return Ok(PullWriteResult::NewCommits { head_sha: node.head_sha });
    }

    ctx.writes
        .run(
            || {
                let method = method.clone();
                let node_id = node.id.clone();
                let session = &session;
                async move {
                    match &method {
                        Some(m) => {
                            graphql(
                                ctx,
                                session,
                                ENABLE_AUTO_MERGE,
                                json!({ "input": {
                                    "pullRequestId": node_id,
                                    "mergeMethod": merge_method_enum(m).unwrap_or("MERGE"),
                                    "expectedHeadOid": expected_head_sha,
                                }}),
                            )
                            .await?;
                        }
                        None => {
                            graphql(ctx, session, DISABLE_AUTO_MERGE, json!({ "input": { "pullRequestId": node_id } })).await?;
                        }
                    }
                    Ok(PullWriteResult::Changed)
                }
            },
            || {
                let method = method.clone();
                let session = &session;
                let (owner, repo) = (owner.clone(), repo.clone());
                async move {
                    let now = read_pull_node(ctx, session, &owner, &repo, number).await?;
                    Ok(if now.auto_merge_method == method {
                        Reconciled::Applied(PullWriteResult::Changed)
                    } else {
                        Reconciled::NotApplied
                    })
                }
            },
        )
        .await
}

pub async fn set_pull_draft(
    ctx: &Ctx,
    repo_full_name: &str,
    number: u64,
    draft: bool,
    expected_head_sha: &str,
) -> Result<PullWriteResult, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    validate_sha(expected_head_sha).map_err(ApiError::msg)?;
    ctx.writes.assert_can_write()?;
    let session = ctx.session().await?;
    let node = read_pull_node(ctx, &session, &owner, &repo, number).await?;
    if node.head_sha != expected_head_sha {
        return Ok(PullWriteResult::NewCommits { head_sha: node.head_sha });
    }
    ctx.writes
        .run(
            || {
                let node_id = node.id.clone();
                let session = &session;
                async move {
                    let query = if draft { CONVERT_TO_DRAFT } else { MARK_READY_FOR_REVIEW };
                    graphql(ctx, session, query, json!({ "input": { "pullRequestId": node_id } })).await?;
                    Ok(PullWriteResult::Changed)
                }
            },
            || {
                let session = &session;
                let (owner, repo) = (owner.clone(), repo.clone());
                async move {
                    let now = read_pull_node(ctx, session, &owner, &repo, number).await?;
                    Ok(if now.is_draft == draft {
                        Reconciled::Applied(PullWriteResult::Changed)
                    } else {
                        Reconciled::NotApplied
                    })
                }
            },
        )
        .await
}

pub async fn get_pull_workflow_runs(ctx: &Ctx, repo_full_name: &str, number: u64) -> Result<Vec<WorkflowRun>, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    let session = ctx.session().await?;
    let node = read_pull_node(ctx, &session, &owner, &repo, number).await?;
    let raw = get_json(
        ctx,
        &session,
        &format!(
            "{}/actions/runs?head_sha={}&per_page=100",
            repo_path(&owner, &repo),
            enc(&node.head_sha)
        ),
    )
    .await?;
    Ok(raw
        .get("workflow_runs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(to_workflow_run)
        .collect())
}

/// Re-runs a run, all of it or only failed jobs, only while it still belongs to the reviewed commit. A re-run is not
/// retried after an uncertain outcome.
pub async fn rerun_pull_workflow(
    ctx: &Ctx,
    repo_full_name: &str,
    run_id: u64,
    mode: &str,
    expected_head_sha: &str,
) -> Result<PullWriteResult, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    if run_id < 1 {
        return Err(ApiError::msg("Workflow run ids must be positive whole numbers."));
    }
    if mode != "all" && mode != "failed" {
        return Err(ApiError::msg("Re-run all jobs or only the failed ones."));
    }
    validate_sha(expected_head_sha).map_err(ApiError::msg)?;
    ctx.writes.assert_can_write()?;
    let session = ctx.session().await?;
    let run_path = format!("{}/actions/runs/{run_id}", repo_path(&owner, &repo));
    let run = get_json(ctx, &session, &run_path).await?;
    let run_head = s(&run, "head_sha").ok_or_else(|| ApiError::msg("GitHub returned an invalid workflow run."))?;
    if run_head != expected_head_sha {
        return Ok(PullWriteResult::NewCommits { head_sha: run_head });
    }
    let suffix = if mode == "failed" { "rerun-failed-jobs" } else { "rerun" };
    ctx.client
        .send(
            reqwest::Method::POST,
            &format!("{run_path}/{suffix}"),
            &session.token,
            WriteOptions {
                text: true,
                ..Default::default()
            },
        )
        .await?;
    Ok(PullWriteResult::Changed)
}

pub async fn get_run_jobs(ctx: &Ctx, repo_full_name: &str, run_id: u64) -> Result<Vec<WorkflowJob>, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    if run_id < 1 {
        return Err(ApiError::msg("Workflow run ids must be positive whole numbers."));
    }
    let session = ctx.session().await?;
    let raw = get_json(
        ctx,
        &session,
        &format!("{}/actions/runs/{run_id}/jobs?per_page=100", repo_path(&owner, &repo)),
    )
    .await?;
    Ok(raw
        .get("jobs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(to_workflow_job)
        .collect())
}

/// The jobs of a run's workflow file and what each one needs, read at the run's commit. Empty on any failure.
pub async fn get_workflow_graph(ctx: &Ctx, repo_full_name: &str, run_id: u64) -> Result<Vec<WorkflowGraphJob>, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    if run_id < 1 {
        return Err(ApiError::msg("Workflow run ids must be positive whole numbers."));
    }
    let session = ctx.session().await?;
    let base = repo_path(&owner, &repo);
    let read = async {
        let run = get_json(ctx, &session, &format!("{base}/actions/runs/{run_id}")).await.ok()?;
        let path = s(&run, "path")?;
        let sha = s(&run, "head_sha")?;
        let file = get_json(
            ctx,
            &session,
            &format!(
                "{base}/contents/{}?ref={}",
                path.split('/').map(enc).collect::<Vec<_>>().join("/"),
                enc(&sha)
            ),
        )
        .await
        .ok()?;
        let content = s(&file, "content")?;
        let cleaned: String = content.chars().filter(|c| !c.is_whitespace()).collect();
        let bytes = base64_decode(&cleaned)?;
        Some(String::from_utf8_lossy(&bytes).into_owned())
    };
    match read.await {
        Some(text) => Ok(workflow_graph_of(&text)),
        None => Ok(Vec::new()),
    }
}

fn base64_decode(text: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(text).ok()
}

/// The jobs of a workflow file. Jobs without a name are shown by their key.
pub fn workflow_graph_of(text: &str) -> Vec<WorkflowGraphJob> {
    let Ok(document) = serde_yaml_ng::from_str::<Value>(text) else {
        return Vec::new();
    };
    let Some(jobs) = document.get("jobs").and_then(Value::as_object) else {
        return Vec::new();
    };
    jobs.iter()
        .map(|(key, job)| {
            let needs = match job.get("needs") {
                Some(Value::String(one)) => vec![one.clone()],
                Some(Value::Array(list)) => list.iter().filter_map(|n| n.as_str().map(str::to_string)).collect(),
                _ => Vec::new(),
            };
            WorkflowGraphJob {
                key: key.clone(),
                name: job.get("name").and_then(Value::as_str).unwrap_or(key).to_string(),
                needs,
            }
        })
        .collect()
}

/// The plain-text log of one job. Large logs are cut to the last part, with the cut said in the text.
pub async fn get_job_logs(ctx: &Ctx, repo_full_name: &str, job_id: u64) -> Result<String, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    if job_id < 1 {
        return Err(ApiError::msg("Job ids must be positive whole numbers."));
    }
    let session = ctx.session().await?;
    let raw = ctx
        .client
        .send(
            reqwest::Method::GET,
            &format!("{}/actions/jobs/{job_id}/logs", repo_path(&owner, &repo)),
            &session.token,
            WriteOptions {
                text: true,
                ..Default::default()
            },
        )
        .await?;
    let text = raw.as_str().unwrap_or_default().to_string();
    if text.len() > JOB_LOG_LIMIT {
        let start = text.len() - JOB_LOG_LIMIT;
        // Cut on a character boundary.
        let start = (start..text.len()).find(|i| text.is_char_boundary(*i)).unwrap_or(text.len());
        return Ok(format!("[Earlier output is not shown]\n{}", &text[start..]));
    }
    Ok(text)
}

pub async fn cancel_run(ctx: &Ctx, repo_full_name: &str, run_id: u64) -> Result<PullWriteResult, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    if run_id < 1 {
        return Err(ApiError::msg("Workflow run ids must be positive whole numbers."));
    }
    ctx.writes.assert_can_write()?;
    let session = ctx.session().await?;
    ctx.client
        .send(
            reqwest::Method::POST,
            &format!("{}/actions/runs/{run_id}/cancel", repo_path(&owner, &repo)),
            &session.token,
            WriteOptions {
                text: true,
                ..Default::default()
            },
        )
        .await?;
    Ok(PullWriteResult::Changed)
}

/// Opens a pull request from a branch in the same personal repo. An uncertain create is reconciled by looking for a
/// pull request with this title and base created since the request began.
pub async fn create_pull(ctx: &Ctx, repo_full_name: &str, input: PullCreateInput) -> Result<PullSummary, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    let title = input.title.trim().to_string();
    let head = input.head.clone();
    let base = input.base.clone();
    if title.is_empty() {
        return Err(ApiError::msg("A pull request needs a title."));
    }
    if head.is_empty() || base.is_empty() {
        return Err(ApiError::msg("Choose the branch to merge from and into."));
    }
    if head == base {
        return Err(ApiError::msg("The head and base branches must be different."));
    }
    if input.body.chars().count() > COMMENT_MAX_CHARS {
        return Err(ApiError::msg(format!(
            "Descriptions can be at most {} characters.",
            with_commas(COMMENT_MAX_CHARS)
        )));
    }
    ctx.writes.assert_can_write()?;
    let session = ctx.session().await?;
    let path = format!("{}/pulls", repo_path(&owner, &repo));
    let payload = json!({ "title": title, "body": input.body, "head": head, "base": base, "draft": input.draft });
    let since = chrono::Utc::now().timestamp_millis() - RECONCILE_SKEW_MS;
    let key = format!("create-pull\u{0}{owner}\u{0}{repo}\u{0}{head}\u{0}{base}\u{0}{title}");

    ctx.writes
        .keyed(
            key,
            UncertainState::Empty,
            |_state| {
                let session = &session;
                let payload = payload.clone();
                let path = path.clone();
                async move {
                    let raw = ctx
                        .client
                        .send(
                            reqwest::Method::POST,
                            &path,
                            &session.token,
                            WriteOptions {
                                body: Some(payload),
                                ..Default::default()
                            },
                        )
                        .await?;
                    to_pull_summary(&raw).ok_or_else(|| ApiError::msg("GitHub returned an invalid pull request."))
                }
            },
            |_state| {
                let session = &session;
                let path = path.clone();
                let title = title.clone();
                let base = base.clone();
                let owner = owner.clone();
                let head = head.clone();
                async move {
                    let found = get_json(
                        ctx,
                        session,
                        &format!(
                            "{path}?state=all&head={}&per_page=100",
                            enc(&format!("{owner}:{head}"))
                        ),
                    )
                    .await?;
                    let matched = found
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(to_pull_summary)
                        .find(|p| {
                            p.issue.title == title
                                && p.base_ref == base
                                && created_at_ms(&p.issue.created_at).map(|t| t >= since).unwrap_or(false)
                        });
                    Ok(match matched {
                        Some(p) => Reconciled::Applied(p),
                        None => Reconciled::NotApplied,
                    })
                }
            },
        )
        .await
}

fn created_at_ms(text: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(text).ok().map(|d| d.timestamp_millis())
}

pub async fn list_branches(ctx: &Ctx, repo_full_name: &str) -> Result<Vec<String>, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    let session = ctx.session().await?;
    let base = format!("{}/branches?per_page=100", repo_path(&owner, &repo));
    let mut names = Vec::new();
    for page in 1..=BRANCH_PAGE_LIMIT {
        let raw = get_json(ctx, &session, &format!("{base}&page={page}")).await?;
        let Some(list) = raw.as_array() else { break };
        names.extend(list.iter().filter_map(|b| s(b, "name")));
        if list.len() < 100 {
            break;
        }
    }
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workflow_graph_reads_jobs_and_needs() {
        let text = "jobs:\n  build:\n    name: Build it\n  test:\n    needs: build\n  lint:\n    needs: [build, test]\n";
        let graph = workflow_graph_of(text);
        let find = |k: &str| graph.iter().find(|j| j.key == k).unwrap().clone();
        assert_eq!(find("build").name, "Build it");
        assert_eq!(find("test").name, "test");
        assert_eq!(find("test").needs, vec!["build".to_string()]);
        assert_eq!(find("lint").needs, vec!["build".to_string(), "test".to_string()]);
    }

    #[test]
    fn merge_methods_map_to_graphql_enums() {
        assert_eq!(merge_method_enum("squash"), Some("SQUASH"));
        assert_eq!(merge_method_enum("nope"), None);
    }

    #[test]
    fn graphql_errors_are_refusals() {
        let refused = graphql_data(json!({"errors": [{"message": "no"}]}));
        assert!(refused.is_err());
        assert!(graphql_data(json!({"data": {"x": 1}})).is_ok());
    }
}
