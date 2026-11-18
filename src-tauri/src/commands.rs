//! Tauri commands. Each one mirrors an `IpcChannels` entry in `src/shared/ipc.ts`: the same name (snake_case here,
//! dotted there), the same arguments, and the same result shape. Inputs are checked here before a service sees them.

use serde::Deserialize;
use std::sync::Arc;
use tauri::State;

use crate::auth::AuthStatus;
use crate::github::attachments::{self, AttachmentUploadResult};
use crate::github::conflicts::{self, ConflictCommitInput, ConflictCommitResult, ConflictSet};
use crate::github::inbox::{self, InboxPage, InboxQuery};
use crate::github::issues;
use crate::github::notifications::{parse_thread_id, NotificationOpenResult};
use crate::github::pulls;
use crate::github::refresh::{ConnectionStatus, RefreshStart};
use crate::github::repos::PersonalRepo;
use crate::github::search::{self, SearchPage, SearchRequest};
use crate::github::write::ApiError;
use crate::model::issues::*;
use crate::services::Services;
use crate::settings::{OrbitSettings, SettingsUpdate};
use crate::themes::{self, ThemeImportDraft, ThemeSearchResult};
use crate::updates::UpdateStatus;

type Svc<'a> = State<'a, Arc<Services>>;

fn err(e: ApiError) -> String {
    e.to_string()
}

// ---- Auth and settings. ----

#[tauri::command]
pub fn auth_get_status(state: Svc<'_>) -> AuthStatus {
    state.auth.status()
}

#[tauri::command]
pub async fn auth_start_sign_in(state: Svc<'_>) -> Result<AuthStatus, String> {
    Ok(state.auth.start_sign_in().await)
}

#[tauri::command]
pub fn auth_cancel_sign_in(state: Svc<'_>) -> AuthStatus {
    state.auth.cancel_sign_in()
}

#[tauri::command]
pub async fn auth_sign_out(state: Svc<'_>) -> Result<AuthStatus, String> {
    Ok(state.auth.sign_out().await)
}

#[tauri::command]
pub async fn settings_get(state: Svc<'_>) -> Result<OrbitSettings, String> {
    Ok(state.settings.load().await)
}

#[tauri::command]
pub async fn settings_update(state: Svc<'_>, app: tauri::AppHandle, update: SettingsUpdate) -> Result<OrbitSettings, String> {
    use tauri_plugin_autostart::ManagerExt;
    let touches_login = update.start_at_login.is_some();
    let saved = state.settings.update(update).await?;
    if touches_login {
        let launcher = app.autolaunch();
        let changed = if saved.start_at_login { launcher.enable() } else { launcher.disable() };
        changed.map_err(|_| "Orbit could not change its start-at-login setting.".to_string())?;
    }
    Ok(saved)
}

// ---- Repos, refresh, notifications. ----

#[tauri::command]
pub async fn repos_list(state: Svc<'_>) -> Result<Vec<PersonalRepo>, String> {
    state.repos.current(&state.ctx()).await.map_err(err)
}

#[tauri::command]
pub async fn repos_refresh(state: Svc<'_>) -> Result<RefreshStart, String> {
    Ok(state.engine.refresh_now().await)
}

#[tauri::command]
pub fn refresh_get_status(state: Svc<'_>) -> ConnectionStatus {
    state.engine.status()
}

#[tauri::command]
pub async fn refresh_wake(state: Svc<'_>) -> Result<RefreshStart, String> {
    Ok(state.engine.wake().await)
}

#[tauri::command]
pub async fn notifications_open(state: Svc<'_>, thread_id: String) -> Result<NotificationOpenResult, String> {
    let thread = parse_thread_id(&thread_id)?;
    Ok(state
        .notification_center
        .open(&state.notifications, &state.ctx(), &thread)
        .await)
}

#[tauri::command]
pub async fn inbox_list(state: Svc<'_>, query: InboxQuery) -> Result<InboxPage, String> {
    inbox::list(&state.ctx(), &query).await.map_err(err)
}

#[tauri::command]
pub async fn search_query(state: Svc<'_>, request: SearchRequest) -> Result<SearchPage, String> {
    search::search(&state.ctx(), &state.repos, &state.search_index, &request).await.map_err(err)
}

#[tauri::command]
pub fn search_index_status(state: Svc<'_>) -> crate::github::search_index::IndexStatus {
    state.search_index.status()
}

#[tauri::command]
pub async fn search_warm(state: Svc<'_>) -> Result<(), String> {
    search::warm(&state.ctx(), &state.repos, &state.search_index);
    Ok(())
}

// ---- Themes. ----

#[derive(Deserialize)]
pub struct ThemeSearchInput {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub sort: String,
}

#[derive(Deserialize)]
pub struct ThemeRef {
    #[serde(default)]
    pub namespace: String,
    #[serde(default)]
    pub name: String,
}

#[tauri::command]
pub async fn themes_search(request: ThemeSearchInput) -> Result<Vec<ThemeSearchResult>, String> {
    let sort = if request.sort == "timestamp" { "timestamp" } else { "downloadCount" };
    themes::search(&request.query, sort).await
}

#[tauri::command]
pub async fn themes_import(reference: ThemeRef) -> Result<ThemeImportDraft, String> {
    themes::import(&reference.namespace, &reference.name).await
}

// ---- Updates and diagnostics. ----

#[tauri::command]
pub fn updates_get_status(state: Svc<'_>) -> UpdateStatus {
    state.updates.status()
}

#[tauri::command]
pub async fn updates_check(state: Svc<'_>) -> Result<UpdateStatus, String> {
    Ok(state.updates.check().await)
}

#[tauri::command]
pub async fn updates_download(state: Svc<'_>) -> Result<UpdateStatus, String> {
    Ok(state.updates.download().await)
}

/// Runs only after the user confirmed a restart. The app then quits so the installer can take over.
#[tauri::command]
pub async fn updates_install(state: Svc<'_>) -> Result<(), String> {
    state.updates.install().await
}

#[derive(Deserialize)]
pub struct DiagnosticEntry {
    pub scope: String,
    pub code: String,
}

#[tauri::command]
pub async fn diagnostics_record(state: Svc<'_>, entry: DiagnosticEntry) -> Result<(), String> {
    if !crate::diagnostics::validate_renderer_code(&entry.scope)
        || !crate::diagnostics::validate_renderer_code(&entry.code)
    {
        return Err("Invalid diagnostic".into());
    }
    state.diagnostics.record("warn", &entry.scope, &entry.code, "").await;
    Ok(())
}

#[tauri::command]
pub fn diagnostics_get_report(state: Svc<'_>) -> String {
    state.diagnostics.report()
}

// ---- Issues. ----

#[tauri::command]
pub async fn issues_list(state: Svc<'_>, query: IssueListQuery) -> Result<IssueListPage, String> {
    issues::list_issues(&state.ctx(), &query).await.map_err(err)
}

#[tauri::command]
pub async fn issues_detail(state: Svc<'_>, repo_full_name: String, number: u64) -> Result<IssueDetail, String> {
    issues::get_issue_detail(&state.ctx(), &repo_full_name, number).await.map_err(err)
}

#[tauri::command]
pub async fn issues_links(state: Svc<'_>, repo_full_name: String, number: u64) -> Result<IssueLinks, String> {
    issues::get_issue_links(&state.ctx(), &repo_full_name, number).await.map_err(err)
}

#[tauri::command]
pub async fn issues_create(state: Svc<'_>, repo_full_name: String, input: IssueContentInput) -> Result<IssueSnapshot, String> {
    issues::create_issue(&state.ctx(), &repo_full_name, input).await.map_err(err)
}

#[tauri::command]
pub async fn issues_update(
    state: Svc<'_>,
    repo_full_name: String,
    number: u64,
    input: IssueContentInput,
    base: IssueContentInput,
) -> Result<IssueEditResult, String> {
    issues::update_issue(&state.ctx(), &repo_full_name, number, input, base).await.map_err(err)
}

#[tauri::command]
pub async fn issues_update_fields(
    state: Svc<'_>,
    repo_full_name: String,
    number: u64,
    fields: IssueFieldsInput,
) -> Result<IssueSummary, String> {
    issues::update_issue_fields(&state.ctx(), &repo_full_name, number, fields).await.map_err(err)
}

#[tauri::command]
pub async fn issues_set_state(
    svc: Svc<'_>,
    repo_full_name: String,
    number: u64,
    state: String,
    reason: Option<String>,
) -> Result<IssueSummary, String> {
    issues::set_issue_state(&svc.ctx(), &repo_full_name, number, &state, reason.as_deref())
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn issues_repo_options(state: Svc<'_>, repo_full_name: String) -> Result<IssueRepoOptions, String> {
    issues::get_repo_options(&state.ctx(), &repo_full_name).await.map_err(err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub index: u64,
    pub checked: bool,
    pub expected_body: String,
}

#[tauri::command]
pub async fn issues_set_task(state: Svc<'_>, repo_full_name: String, number: u64, input: TaskInput) -> Result<TaskToggleResult, String> {
    issues::set_task_item(&state.ctx(), &repo_full_name, number, input.index, input.checked, &input.expected_body)
        .await
        .map_err(err)
}

// ---- Pull requests. ----

#[tauri::command]
pub async fn pulls_list(state: Svc<'_>, query: PullListQuery) -> Result<PullListPage, String> {
    pulls::list_pulls(&state.ctx(), &query).await.map_err(err)
}

#[tauri::command]
pub async fn pulls_detail(state: Svc<'_>, repo_full_name: String, number: u64) -> Result<PullDetail, String> {
    pulls::get_pull_detail(&state.ctx(), &repo_full_name, number).await.map_err(err)
}

#[tauri::command]
pub async fn pulls_files(state: Svc<'_>, repo_full_name: String, number: u64) -> Result<PullFilesPage, String> {
    pulls::get_pull_files(&state.ctx(), &repo_full_name, number).await.map_err(err)
}

#[tauri::command]
pub async fn pulls_threads(state: Svc<'_>, repo_full_name: String, number: u64) -> Result<PullReviewThreadsPage, String> {
    pulls::get_pull_review_threads(&state.ctx(), &repo_full_name, number).await.map_err(err)
}

#[tauri::command]
pub async fn pulls_review_state(state: Svc<'_>, repo_full_name: String, number: u64) -> Result<PullReviewState, String> {
    pulls::get_pull_review_state(&state.ctx(), &repo_full_name, number).await.map_err(err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCommentInput {
    pub anchor: ReviewAnchor,
    pub body: String,
    pub reviewed_head_sha: String,
}

#[tauri::command]
pub async fn pulls_review_comment(state: Svc<'_>, repo_full_name: String, number: u64, input: ReviewCommentInput) -> Result<ReviewCommentResult, String> {
    pulls::add_review_comment(&state.ctx(), &repo_full_name, number, input.anchor, &input.body, &input.reviewed_head_sha)
        .await
        .map_err(err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewReplyInput {
    pub thread_id: String,
    pub body: String,
    pub reviewed_head_sha: String,
}

#[tauri::command]
pub async fn pulls_review_reply(state: Svc<'_>, repo_full_name: String, number: u64, input: ReviewReplyInput) -> Result<ReviewCommentResult, String> {
    pulls::reply_to_review_thread(&state.ctx(), &repo_full_name, number, &input.thread_id, &input.body, &input.reviewed_head_sha)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn pulls_review_resolve(state: Svc<'_>, repo_full_name: String, number: u64, thread_id: String, resolved: bool) -> Result<bool, String> {
    pulls::set_review_thread_resolved(&state.ctx(), &repo_full_name, number, &thread_id, resolved)
        .await
        .map_err(err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSubmitInput {
    pub event: String,
    pub body: String,
    pub reviewed_head_sha: String,
}

#[tauri::command]
pub async fn pulls_review_submit(state: Svc<'_>, repo_full_name: String, number: u64, input: ReviewSubmitInput) -> Result<ReviewSubmitResult, String> {
    pulls::submit_review(&state.ctx(), &repo_full_name, number, &input.event, &input.body, &input.reviewed_head_sha)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn pulls_actions(state: Svc<'_>, repo_full_name: String, number: u64) -> Result<PullActions, String> {
    pulls::get_pull_actions(&state.ctx(), &repo_full_name, number).await.map_err(err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeInput {
    pub method: String,
    pub delete_branch: bool,
    pub expected_head_sha: String,
}

#[tauri::command]
pub async fn pulls_merge(state: Svc<'_>, repo_full_name: String, number: u64, input: MergeInput) -> Result<PullMergeResult, String> {
    pulls::merge_pull(&state.ctx(), &repo_full_name, number, &input.method, input.delete_branch, &input.expected_head_sha)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn pulls_conflicts(state: Svc<'_>, repo_full_name: String, number: u64) -> Result<ConflictSet, String> {
    conflicts::read_conflicts(&state.ctx(), &repo_full_name, number).await.map_err(err)
}

#[tauri::command]
pub async fn pulls_resolve_conflicts(
    state: Svc<'_>,
    repo_full_name: String,
    number: u64,
    input: ConflictCommitInput,
) -> Result<ConflictCommitResult, String> {
    conflicts::commit_resolution(&state.ctx(), &repo_full_name, number, input).await.map_err(err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoMergeInput {
    pub enabled: bool,
    pub method: Option<String>,
    pub expected_head_sha: String,
}

#[tauri::command]
pub async fn pulls_auto_merge(state: Svc<'_>, repo_full_name: String, number: u64, input: AutoMergeInput) -> Result<PullWriteResult, String> {
    pulls::set_pull_auto_merge(&state.ctx(), &repo_full_name, number, input.enabled, input.method.as_deref(), &input.expected_head_sha)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn pulls_draft(state: Svc<'_>, repo_full_name: String, number: u64, draft: bool, expected_head_sha: String) -> Result<PullWriteResult, String> {
    pulls::set_pull_draft(&state.ctx(), &repo_full_name, number, draft, &expected_head_sha)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn pulls_runs(state: Svc<'_>, repo_full_name: String, number: u64) -> Result<Vec<WorkflowRun>, String> {
    pulls::get_pull_workflow_runs(&state.ctx(), &repo_full_name, number).await.map_err(err)
}

#[tauri::command]
pub async fn pulls_rerun(state: Svc<'_>, repo_full_name: String, run_id: u64, mode: String, expected_head_sha: String) -> Result<PullWriteResult, String> {
    pulls::rerun_pull_workflow(&state.ctx(), &repo_full_name, run_id, &mode, &expected_head_sha)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn pulls_create(state: Svc<'_>, repo_full_name: String, input: PullCreateInput) -> Result<PullSummary, String> {
    pulls::create_pull(&state.ctx(), &repo_full_name, input).await.map_err(err)
}

#[tauri::command]
pub async fn pulls_branches(state: Svc<'_>, repo_full_name: String) -> Result<Vec<String>, String> {
    pulls::list_branches(&state.ctx(), &repo_full_name).await.map_err(err)
}

// ---- Actions (CI). ----

#[tauri::command]
pub async fn actions_jobs(state: Svc<'_>, repo_full_name: String, run_id: u64) -> Result<Vec<WorkflowJob>, String> {
    pulls::get_run_jobs(&state.ctx(), &repo_full_name, run_id).await.map_err(err)
}

#[tauri::command]
pub async fn actions_job_logs(state: Svc<'_>, repo_full_name: String, job_id: u64) -> Result<String, String> {
    pulls::get_job_logs(&state.ctx(), &repo_full_name, job_id).await.map_err(err)
}

#[tauri::command]
pub async fn actions_workflow_graph(state: Svc<'_>, repo_full_name: String, run_id: u64) -> Result<Vec<WorkflowGraphJob>, String> {
    pulls::get_workflow_graph(&state.ctx(), &repo_full_name, run_id).await.map_err(err)
}

#[tauri::command]
pub async fn actions_cancel_run(state: Svc<'_>, repo_full_name: String, run_id: u64) -> Result<PullWriteResult, String> {
    pulls::cancel_run(&state.ctx(), &repo_full_name, run_id).await.map_err(err)
}

// ---- Projects. ----

#[tauri::command]
pub async fn projects_list(state: Svc<'_>) -> Result<crate::github::projects::ProjectListPage, String> {
    state.projects.list_projects(&state.ctx()).await.map_err(err)
}

#[tauri::command]
pub async fn projects_detail(state: Svc<'_>, project_id: String) -> Result<crate::github::projects::ProjectDetail, String> {
    state.projects.get_project(&state.ctx(), &project_id).await.map_err(err)
}

#[tauri::command]
pub async fn projects_items(state: Svc<'_>, project_id: String, filter: String) -> Result<crate::github::projects::ProjectItemsPage, String> {
    state.projects.list_items(&state.ctx(), &project_id, &filter).await.map_err(err)
}

#[tauri::command]
pub async fn projects_item_memberships(state: Svc<'_>, repo_full_name: String, number: u64) -> Result<crate::github::projects::ItemMemberships, String> {
    state.projects.get_item_memberships(&state.ctx(), &repo_full_name, number).await.map_err(err)
}

#[tauri::command]
pub async fn projects_add_item(state: Svc<'_>, project_id: String, repo_full_name: String, number: u64) -> Result<crate::github::projects::ProjectItem, String> {
    state.projects.add_item(&state.ctx(), &project_id, &repo_full_name, number).await.map_err(err)
}

#[tauri::command]
pub async fn projects_remove_item(state: Svc<'_>, project_id: String, item_id: String) -> Result<(), String> {
    state.projects.remove_item(&state.ctx(), &project_id, &item_id).await.map_err(err)
}

#[tauri::command]
pub async fn projects_move_item(state: Svc<'_>, project_id: String, item_id: String, after_id: Option<String>) -> Result<(), String> {
    state.projects.move_item(&state.ctx(), &project_id, &item_id, after_id.as_deref()).await.map_err(err)
}

#[tauri::command]
pub async fn projects_set_field(
    state: Svc<'_>,
    project_id: String,
    item_id: String,
    change: crate::github::projects::ProjectFieldChange,
) -> Result<crate::github::projects::ProjectItemEditResult, String> {
    if let Some(value) = &change.value {
        crate::github::projects::validate_field_input(value)?;
    }
    state.projects.set_field_value(&state.ctx(), &project_id, &item_id, &change).await.map_err(err)
}

// ---- Markdown, comments, attachments. ----

#[tauri::command]
pub async fn markdown_preview(state: Svc<'_>, repo_full_name: String, text: String) -> Result<String, String> {
    issues::markdown_preview(&state.ctx(), &repo_full_name, &text).await.map_err(err)
}

#[tauri::command]
pub async fn comments_create(state: Svc<'_>, repo_full_name: String, number: u64, body: String) -> Result<IssueComment, String> {
    issues::create_comment(&state.ctx(), &repo_full_name, number, &body).await.map_err(err)
}

#[tauri::command]
pub async fn comments_update(
    state: Svc<'_>,
    repo_full_name: String,
    comment_id: u64,
    body: String,
    base_updated_at: String,
) -> Result<CommentUpdateResult, String> {
    issues::update_comment(&state.ctx(), &repo_full_name, comment_id, &body, &base_updated_at)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn comments_delete(state: Svc<'_>, repo_full_name: String, comment_id: u64) -> Result<(), String> {
    issues::delete_comment(&state.ctx(), &repo_full_name, comment_id).await.map_err(err)
}

#[derive(Deserialize)]
pub struct AttachmentFileInput {
    pub name: String,
    pub bytes: Vec<u8>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentOptions {
    #[serde(default)]
    pub acknowledged_public: bool,
}

#[tauri::command]
pub async fn attachments_upload(
    state: Svc<'_>,
    repo_full_name: String,
    file: AttachmentFileInput,
    options: Option<AttachmentOptions>,
) -> Result<AttachmentUploadResult, String> {
    let settings = state.settings.load().await;
    let acknowledged = options.unwrap_or_default().acknowledged_public;
    let outcome = attachments::upload(
        &state.ctx(),
        &repo_full_name,
        &file.name,
        file.bytes,
        acknowledged,
        settings.public_upload_notice_acknowledged,
    )
    .await
    .map_err(err)?;
    if outcome.acknowledge_now {
        state.settings.acknowledge_public_upload_notice().await?;
    }
    Ok(outcome.result)
}


#[cfg(test)]
mod ipc_contract {
    use super::*;
    use serde_json::json;

    /// The renderer sends camelCase keys. Each of these failed before the struct renamed its fields.
    #[test]
    fn inputs_accept_the_renderer_field_names() {
        let task: TaskInput = serde_json::from_value(json!({
            "index": 1, "checked": true, "expectedBody": "- [ ] a"
        }))
        .expect("task");
        assert_eq!(task.expected_body, "- [ ] a");

        let merge: MergeInput = serde_json::from_value(json!({
            "method": "squash", "deleteBranch": true, "expectedHeadSha": "abc"
        }))
        .expect("merge");
        assert!(merge.delete_branch);
        assert_eq!(merge.expected_head_sha, "abc");

        let reply: ReviewReplyInput = serde_json::from_value(json!({
            "threadId": "T1", "body": "ok", "reviewedHeadSha": "abc"
        }))
        .expect("reply");
        assert_eq!(reply.thread_id, "T1");

        let options: AttachmentOptions =
            serde_json::from_value(json!({ "acknowledgedPublic": true })).expect("options");
        assert!(options.acknowledged_public);
    }
}
