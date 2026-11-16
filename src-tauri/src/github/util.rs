//! Conversions from GitHub's JSON into Orbit's shapes, plus the input checks run before any request is sent.
//! Every converter returns `None` for a malformed entry, so one bad item drops out instead of failing the list.

use serde_json::Value;

use crate::model::issues::*;

pub const COMMENT_PAGE_LIMIT: u32 = 10;
pub const COMMENTS_PER_PAGE: u32 = 100;
pub const ISSUES_PER_PAGE: u32 = 30;
pub const RECONCILE_SKEW_MS: i64 = 60_000;
pub const LABEL_NAME_MAX_CHARS: usize = 50;
pub const TEXT_FILTER_MAX: usize = 100;

pub fn s(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_string)
}

pub fn u(v: &Value, key: &str) -> Option<u64> {
    v.get(key).and_then(Value::as_u64)
}

pub fn b(v: &Value, key: &str) -> bool {
    v.get(key).and_then(Value::as_bool) == Some(true)
}

/// A pull request is an issue whose JSON carries a `pull_request` object.
pub fn is_pull_request(v: &Value) -> bool {
    v.get("pull_request").map(|p| !p.is_null()).unwrap_or(false)
}

pub fn login_of(v: &Value) -> Option<String> {
    v.get("login").and_then(Value::as_str).map(str::to_string)
}

pub fn to_label(v: &Value) -> Option<IssueLabel> {
    Some(IssueLabel {
        name: s(v, "name")?,
        color: s(v, "color")?,
    })
}

pub fn to_milestone(v: &Value) -> Option<IssueMilestone> {
    Some(IssueMilestone {
        number: u(v, "number")?,
        title: s(v, "title")?,
    })
}

pub fn to_sub_issue_count(v: &Value) -> Option<SubIssueCount> {
    Some(SubIssueCount {
        total: u(v, "total")?,
        completed: u(v, "completed")?,
    })
}

pub fn to_sub_issue_ref(v: &Value) -> Option<SubIssueRef> {
    let state = s(v, "state")?;
    if state != "open" && state != "closed" {
        return None;
    }
    Some(SubIssueRef {
        number: u(v, "number")?,
        title: s(v, "title")?,
        state,
        html_url: s(v, "html_url")?,
    })
}

pub fn to_summary(v: &Value) -> Option<IssueSummary> {
    if !v.is_object() {
        return None;
    }
    let state = s(v, "state")?;
    if state != "open" && state != "closed" {
        return None;
    }
    let labels = v.get("labels")?.as_array()?;
    let comments = u(v, "comments")?;
    Some(IssueSummary {
        id: u(v, "id")?,
        number: u(v, "number")?,
        title: s(v, "title")?,
        state,
        state_reason: s(v, "state_reason"),
        author_login: v
            .get("user")
            .and_then(login_of)
            .unwrap_or_else(|| "ghost".into()),
        labels: labels.iter().filter_map(to_label).collect(),
        assignees: v
            .get("assignees")
            .and_then(Value::as_array)
            .map(|list| list.iter().filter_map(login_of).collect())
            .unwrap_or_default(),
        milestone: v.get("milestone").and_then(to_milestone),
        comment_count: comments,
        created_at: s(v, "created_at")?,
        updated_at: s(v, "updated_at")?,
        html_url: s(v, "html_url")?,
        sub_issues: v.get("sub_issues_summary").and_then(to_sub_issue_count),
    })
}

pub fn to_pull_summary(v: &Value) -> Option<PullSummary> {
    // A pull request without a comment count still reads; GitHub omits it on some list responses.
    let mut patched = v.clone();
    if patched.get("comments").and_then(Value::as_u64).is_none() {
        patched["comments"] = Value::from(0);
    }
    let issue = to_summary(&patched)?;
    Some(PullSummary {
        issue,
        draft: b(v, "draft"),
        merged: b(v, "merged") || v.get("merged_at").is_some_and(|m| !m.is_null()),
        head_ref: v
            .get("head")
            .and_then(|h| s(h, "ref"))
            .unwrap_or_default(),
        base_ref: v
            .get("base")
            .and_then(|h| s(h, "ref"))
            .unwrap_or_default(),
    })
}

pub fn to_comment(v: &Value) -> Option<IssueComment> {
    if !v.is_object() {
        return None;
    }
    Some(IssueComment {
        id: u(v, "id")?,
        author_login: v
            .get("user")
            .and_then(login_of)
            .unwrap_or_else(|| "ghost".into()),
        created_at: s(v, "created_at")?,
        updated_at: s(v, "updated_at")?,
        html_url: s(v, "html_url")?,
        body: s(v, "body").unwrap_or_default(),
        body_html: s(v, "body_html").unwrap_or_default(),
    })
}

pub fn raw_body(v: &Value) -> String {
    s(v, "body").unwrap_or_default()
}

pub fn to_snapshot(v: &Value) -> Option<IssueSnapshot> {
    Some(IssueSnapshot {
        summary: to_summary(v)?,
        body: raw_body(v),
        body_html: s(v, "body_html").unwrap_or_default(),
    })
}

pub fn to_pull_file(v: &Value) -> Option<PullFile> {
    let status = s(v, "status")?;
    const STATUSES: &[&str] = &[
        "added", "removed", "modified", "renamed", "copied", "changed", "unchanged",
    ];
    if !STATUSES.contains(&status.as_str()) {
        return None;
    }
    let additions = u(v, "additions")?;
    let deletions = u(v, "deletions")?;
    let changes = u(v, "changes")?;
    let patch = s(v, "patch");
    // GitHub omits the patch for binary files (no changed lines) and for diffs it will not return.
    let no_patch_reason = match (&patch, changes) {
        (Some(_), _) => None,
        (None, 0) => Some("binary".to_string()),
        (None, _) => Some("too-large".to_string()),
    };
    Some(PullFile {
        filename: s(v, "filename")?,
        previous_filename: s(v, "previous_filename"),
        status,
        additions,
        deletions,
        patch,
        no_patch_reason,
    })
}

/// GitHub's database ids arrive as strings in GraphQL. Anything that is not a positive safe integer is rejected.
pub fn database_id_of(v: &Value) -> Option<u64> {
    let id = match v {
        Value::Number(n) => n.as_u64()?,
        Value::String(text) => text.parse::<u64>().ok()?,
        _ => return None,
    };
    if id == 0 || id > 9_007_199_254_740_991 {
        return None;
    }
    Some(id)
}

pub fn to_workflow_job(v: &Value) -> Option<WorkflowJob> {
    Some(WorkflowJob {
        id: u(v, "id")?,
        name: s(v, "name")?,
        status: s(v, "status").unwrap_or_else(|| "unknown".into()),
        conclusion: s(v, "conclusion"),
        started_at: s(v, "started_at"),
        completed_at: s(v, "completed_at"),
        html_url: s(v, "html_url").unwrap_or_default(),
    })
}

pub fn to_workflow_run(v: &Value) -> Option<WorkflowRun> {
    Some(WorkflowRun {
        id: u(v, "id")?,
        name: s(v, "name")?,
        status: s(v, "status").unwrap_or_else(|| "unknown".into()),
        conclusion: s(v, "conclusion"),
        html_url: s(v, "html_url").unwrap_or_default(),
    })
}

// ---- Input checks. Run before any request, so a bad value never reaches GitHub. ----

pub fn validate_repo(repo_full_name: &str) -> Result<(String, String), String> {
    let parts: Vec<&str> = repo_full_name.split('/').collect();
    if parts.len() != 2 {
        return Err("Repository names must look like owner/name.".into());
    }
    let (owner, repo) = (parts[0], parts[1]);
    if !is_owner(owner) || !is_repo(repo) || repo == "." || repo == ".." {
        return Err("Repository names must look like owner/name.".into());
    }
    Ok((owner.to_string(), repo.to_string()))
}

fn is_owner(owner: &str) -> bool {
    let bytes = owner.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 39
        && bytes[0].is_ascii_alphanumeric()
        && bytes.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'-')
}

fn is_repo(repo: &str) -> bool {
    !repo.is_empty()
        && repo.len() <= 100
        && repo
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'_' || c == b'-')
}

pub fn validate_item_number(number: u64) -> Result<(), String> {
    if number < 1 {
        return Err("Issue numbers must be positive whole numbers.".into());
    }
    Ok(())
}

pub fn validate_comment_body(body: &str) -> Result<(), String> {
    if body.trim().is_empty() {
        return Err("A comment cannot be empty.".into());
    }
    if body.chars().count() > COMMENT_MAX_CHARS {
        return Err(format!(
            "Comments can be at most {} characters.",
            with_commas(COMMENT_MAX_CHARS)
        ));
    }
    Ok(())
}

pub fn validate_state(state: &str) -> Result<String, String> {
    match state {
        "open" | "closed" | "all" => Ok(state.to_string()),
        _ => Err("Issue state must be open, closed, or all.".into()),
    }
}

pub fn validate_page(page: u32) -> Result<u32, String> {
    if !(1..=10_000).contains(&page) {
        return Err("Page must be a whole number from 1.".into());
    }
    Ok(page)
}

pub fn validate_text(value: &str, field: &str) -> Result<String, String> {
    let invalid = || format!("The {field} filter is invalid.");
    if value.is_empty() || value.chars().count() > TEXT_FILTER_MAX {
        return Err(invalid());
    }
    // Filters are user text; control characters are refused so they cannot reach headers or logs.
    if value.chars().any(|c| (c as u32) < 0x20 || c as u32 == 0x7f) {
        return Err(invalid());
    }
    Ok(value.to_string())
}

pub fn validate_sha(sha: &str) -> Result<(), String> {
    let ok = !sha.is_empty()
        && sha.len() <= 64
        && sha.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'_' || c == b'-');
    if !ok {
        return Err("The reviewed commit is missing.".into());
    }
    Ok(())
}

pub fn validate_issue_content(title: &str, body: &str) -> Result<IssueContentInput, String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err("An issue needs a title.".into());
    }
    if trimmed.chars().count() > ISSUE_TITLE_MAX_CHARS {
        return Err(format!("Titles can be at most {ISSUE_TITLE_MAX_CHARS} characters."));
    }
    if body.chars().count() > ISSUE_BODY_MAX_CHARS {
        return Err(format!(
            "Issue descriptions can be at most {} characters.",
            with_commas(ISSUE_BODY_MAX_CHARS)
        ));
    }
    Ok(IssueContentInput {
        title: trimmed.to_string(),
        body: body.to_string(),
    })
}

pub fn validate_fields(fields: &IssueFieldsInput) -> Result<(), String> {
    if fields
        .labels
        .iter()
        .any(|l| l.is_empty() || l.chars().count() > LABEL_NAME_MAX_CHARS)
    {
        return Err("Labels must be names of up to 50 characters.".into());
    }
    if fields.assignees.iter().any(|a| !is_owner(a)) {
        return Err("Assignees must be GitHub logins.".into());
    }
    if let Some(m) = fields.milestone_number {
        if m < 1 {
            return Err("A milestone must be a positive whole number, or none.".into());
        }
    }
    Ok(())
}

pub fn validate_anchor_side(side: &str) -> Result<(), String> {
    if side != "LEFT" && side != "RIGHT" {
        return Err("Choose the old or new side of the diff.".into());
    }
    Ok(())
}

pub fn same_members(a: &[String], b: &[String]) -> bool {
    let left: std::collections::HashSet<&String> = a.iter().collect();
    let right: std::collections::HashSet<&String> = b.iter().collect();
    left.len() == right.len() && left.iter().all(|x| right.contains(*x))
}

/// Groups digits with commas, as the English messages do (e.g. 65536 -> 65,536).
pub fn with_commas(n: usize) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// Repo item path for issues or pulls.
pub fn item_path(owner: &str, repo: &str, kind: &str, number: u64) -> String {
    format!("/repos/{}/{}/{}/{}", enc(owner), enc(repo), kind, number)
}

pub fn repo_path(owner: &str, repo: &str) -> String {
    format!("/repos/{}/{}", enc(owner), enc(repo))
}

/// Percent-encodes one URL path or query component the way encodeURIComponent does.
pub fn enc(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}


#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn repo_names_are_checked() {
        assert!(validate_repo("octo/hello-world").is_ok());
        assert!(validate_repo("octo").is_err());
        assert!(validate_repo("octo/..").is_err());
        assert!(validate_repo("-bad/x").is_err());
    }

    #[test]
    fn commas_group_thousands() {
        assert_eq!(with_commas(65_536), "65,536");
        assert_eq!(with_commas(999), "999");
    }

    #[test]
    fn encodes_like_encode_uri_component() {
        assert_eq!(enc("a b/c"), "a%20b%2Fc");
    }

    #[test]
    fn summary_drops_malformed_items() {
        assert!(to_summary(&json!({"id": 1})).is_none());
        let ok = to_summary(&json!({
            "id": 1, "number": 2, "title": "t", "state": "open",
            "labels": [], "comments": 0,
            "created_at": "a", "updated_at": "b", "html_url": "u"
        }))
        .expect("valid summary");
        assert_eq!(ok.author_login, "ghost");
    }

    #[test]
    fn database_ids_must_be_positive_safe_integers() {
        assert_eq!(database_id_of(&json!("42")), Some(42));
        assert_eq!(database_id_of(&json!(0)), None);
        assert_eq!(database_id_of(&json!("x")), None);
    }

    #[test]
    fn patchless_files_say_why() {
        let binary = to_pull_file(&json!({
            "filename": "a.png", "status": "added", "additions": 0, "deletions": 0, "changes": 0
        }))
        .unwrap();
        assert_eq!(binary.no_patch_reason.as_deref(), Some("binary"));
        let big = to_pull_file(&json!({
            "filename": "a.rs", "status": "modified", "additions": 5, "deletions": 1, "changes": 6
        }))
        .unwrap();
        assert_eq!(big.no_patch_reason.as_deref(), Some("too-large"));
    }
}
