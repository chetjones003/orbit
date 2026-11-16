//! Issue, pull request, review, and CI shapes. These serialize to exactly the JSON in `src/shared/issues.ts`,
//! which the renderer reads. Bodies are GitHub's own rendered HTML; the renderer sanitizes them before display.

use serde::{Deserialize, Serialize};

pub const COMMENT_MAX_CHARS: usize = 65_536;
pub const ISSUE_TITLE_MAX_CHARS: usize = 256;
pub const ISSUE_BODY_MAX_CHARS: usize = COMMENT_MAX_CHARS;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IssueLabel {
    pub name: String,
    pub color: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IssueMilestone {
    pub number: u64,
    pub title: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubIssueCount {
    pub total: u64,
    pub completed: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubIssueRef {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub html_url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IssueSummary {
    pub id: u64,
    pub number: u64,
    pub title: String,
    /// "open" or "closed".
    pub state: String,
    pub state_reason: Option<String>,
    pub author_login: String,
    pub labels: Vec<IssueLabel>,
    pub assignees: Vec<String>,
    pub milestone: Option<IssueMilestone>,
    pub comment_count: u64,
    pub created_at: String,
    pub updated_at: String,
    pub html_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sub_issues: Option<SubIssueCount>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullSummary {
    #[serde(flatten)]
    pub issue: IssueSummary,
    pub draft: bool,
    /// Merged, as opposed to closed without merging. The issue state alone cannot say which.
    pub merged: bool,
    pub head_ref: String,
    pub base_ref: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullListQuery {
    pub repo_full_name: String,
    pub state: String,
    pub label: Option<String>,
    pub author: Option<String>,
    pub page: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullListPage {
    pub items: Vec<PullSummary>,
    pub page: u32,
    pub has_next_page: bool,
    pub partial: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullReview {
    pub id: u64,
    pub author_login: String,
    pub state: String,
    pub submitted_at: Option<String>,
    pub body: String,
    pub html_url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullCheck {
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub details_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullDetail {
    pub summary: PullSummary,
    pub body: String,
    pub body_html: String,
    pub comments: Vec<IssueComment>,
    pub comments_partial: bool,
    pub reviews: Vec<PullReview>,
    pub reviews_partial: bool,
    pub checks: Vec<PullCheck>,
    pub checks_partial: bool,
    pub mergeable: Option<bool>,
    pub mergeable_state: String,
    pub merged: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullFile {
    pub filename: String,
    pub previous_filename: Option<String>,
    pub status: String,
    pub additions: u64,
    pub deletions: u64,
    pub patch: Option<String>,
    /// "binary" or "too-large".
    pub no_patch_reason: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullFilesPage {
    pub files: Vec<PullFile>,
    pub partial: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullReviewComment {
    pub id: u64,
    pub author_login: String,
    pub created_at: String,
    pub html_url: String,
    pub body: String,
    pub body_html: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullReviewThread {
    pub id: String,
    pub path: String,
    pub line: Option<u64>,
    pub original_line: Option<u64>,
    pub is_resolved: bool,
    pub is_outdated: bool,
    pub diff_hunk: String,
    pub comments: Vec<PullReviewComment>,
    pub comments_partial: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullReviewThreadsPage {
    pub threads: Vec<PullReviewThread>,
    pub partial: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IssueListQuery {
    pub repo_full_name: String,
    pub state: String,
    pub label: Option<String>,
    pub author: Option<String>,
    pub page: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IssueListPage {
    pub items: Vec<IssueSummary>,
    pub page: u32,
    pub has_next_page: bool,
    pub partial: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IssueComment {
    pub id: u64,
    pub author_login: String,
    pub created_at: String,
    pub updated_at: String,
    pub html_url: String,
    pub body: String,
    pub body_html: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum CommentUpdateResult {
    Saved { comment: IssueComment },
    Conflict { current: IssueComment },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IssueDetail {
    pub summary: IssueSummary,
    pub body: String,
    pub body_html: String,
    pub comments: Vec<IssueComment>,
    pub comments_partial: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_issues: Option<Vec<SubIssueRef>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<SubIssueRef>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IssueSnapshot {
    pub summary: IssueSummary,
    pub body: String,
    pub body_html: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IssueContentInput {
    pub title: String,
    pub body: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum IssueEditResult {
    Saved { issue: IssueSnapshot },
    Conflict { current: IssueSnapshot },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum TaskToggleResult {
    Saved { issue: IssueSnapshot },
    Stale { current: IssueSnapshot },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IssueFieldsInput {
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
    pub milestone_number: Option<u64>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IssueRepoOptions {
    pub labels: Vec<IssueLabel>,
    pub assignees: Vec<String>,
    pub milestones: Vec<IssueMilestone>,
    pub partial: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewAnchor {
    pub path: String,
    /// "LEFT" (old file) or "RIGHT" (new file).
    pub side: String,
    pub line: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingReviewComment {
    pub id: u64,
    pub path: String,
    pub side: String,
    pub line: Option<u64>,
    pub body: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingReview {
    pub id: String,
    pub commit_sha: String,
    pub comments: Vec<PendingReviewComment>,
    pub comments_partial: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullReviewState {
    pub head_sha: String,
    pub is_own_pull: bool,
    pub pending: Option<PendingReview>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum ReviewCommentResult {
    Saved { comment: PendingReviewComment },
    NewCommits { head_sha: String },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum ReviewSubmitResult {
    Submitted,
    NewCommits { head_sha: String },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullActions {
    pub head_sha: String,
    pub head_ref: String,
    pub head_in_repo: bool,
    pub draft: bool,
    pub merged: bool,
    pub state: String,
    pub allowed_merge_methods: Vec<String>,
    pub allow_auto_merge: bool,
    pub auto_merge_method: Option<String>,
    pub delete_branch_on_merge: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum PullMergeResult {
    Merged { sha: String, branch_deleted: bool },
    NewCommits { head_sha: String },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum PullWriteResult {
    Changed,
    NewCommits { head_sha: String },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRun {
    pub id: u64,
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub html_url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullCreateInput {
    pub title: String,
    pub body: String,
    pub head: String,
    pub base: String,
    pub draft: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowJob {
    pub id: u64,
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub html_url: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowGraphJob {
    pub key: String,
    pub name: String,
    pub needs: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LinkedPull {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub merged: bool,
    pub html_url: String,
    pub author_login: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LinkedCommit {
    pub sha: String,
    pub message: String,
    pub author_login: Option<String>,
    pub author_name: String,
    pub committed_at: String,
    pub html_url: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IssueLinks {
    pub pulls: Vec<LinkedPull>,
    pub commits: Vec<LinkedCommit>,
    pub partial: bool,
}
