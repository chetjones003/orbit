//! GitHub Projects (v2) for the signed-in account: reads, membership, and field edits through GraphQL. Ported from
//! `projects-service.ts` and the project shapes in `shared/projects.ts`.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::sync::Mutex;

use super::client::WriteOptions;
use super::util::{s, u};
use crate::model::issues::IssueLabel;
use super::write::{ApiError, Reconciled};
use super::{Ctx, Session};

const PROJECTS_PER_PAGE: u32 = 100;
const FIELDS_PER_PROJECT: u32 = 100;
const VIEWS_PER_PROJECT: u32 = 50;
const MEMBERSHIPS_PER_ITEM: u32 = 20;
const MAX_FILTER_CHARS: usize = 1000;
pub const PROJECT_ITEMS_PAGE_SIZE: u32 = 50;
pub const PROJECT_ITEMS_PAGE_LIMIT: u32 = 10;
pub const PROJECT_FIELD_VALUES_PER_ITEM: u32 = 50;
/// Labels read per issue or pull request, for the cards. More than this are rare and would crowd a card.
pub const PROJECT_LABELS_PER_ITEM: u32 = 10;
pub const PROJECT_TEXT_MAX_CHARS: usize = 2048;

const FIELD_SELECTION: &str = r#"
  __typename
  ... on ProjectV2FieldCommon { id name dataType }
  ... on ProjectV2SingleSelectField { options { id name color } }
  ... on ProjectV2IterationField { configuration { iterations { id title startDate duration } } }
"#;

const PROJECT_SELECTION: &str = "id number title url closed";

const VALUE_SELECTION: &str = r#"
  __typename
  ... on ProjectV2ItemFieldSingleSelectValue { optionId name field { ... on ProjectV2FieldCommon { id } } }
  ... on ProjectV2ItemFieldIterationValue { iterationId title startDate duration field { ... on ProjectV2FieldCommon { id } } }
  ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { id } } }
  ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { id } } }
  ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { id } } }
"#;

fn item_selection() -> String {
    format!(
        r#"
  id
  type
  content {{
    __typename
    ... on Issue {{ id number title url state repository {{ nameWithOwner }} labels(first: {PROJECT_LABELS_PER_ITEM}) {{ nodes {{ name color }} }} }}
    ... on PullRequest {{ id number title url state isDraft repository {{ nameWithOwner }} labels(first: {PROJECT_LABELS_PER_ITEM}) {{ nodes {{ name color }} }} }}
    ... on DraftIssue {{ id title }}
  }}
  fieldValues(first: {PROJECT_FIELD_VALUES_PER_ITEM}) {{ nodes {{ {VALUE_SELECTION} }} }}
"#
    )
}

fn list_projects_query() -> String {
    format!("query {{ viewer {{ projectsV2(first: {PROJECTS_PER_PAGE}) {{ totalCount nodes {{ {PROJECT_SELECTION} }} }} }} }}")
}

fn project_detail_query() -> String {
    format!(
        r#"query($id: ID!) {{
  node(id: $id) {{
    ... on ProjectV2 {{
      {PROJECT_SELECTION}
      fields(first: {FIELDS_PER_PROJECT}) {{ nodes {{ {FIELD_SELECTION} }} }}
      views(first: {VIEWS_PER_PROJECT}) {{
        nodes {{ id name number layout filter groupByFields(first: 1) {{ nodes {{ ... on ProjectV2FieldCommon {{ id }} }} }} }}
      }}
    }}
  }}
}}"#
    )
}

fn project_items_query() -> String {
    format!(
        r#"query($id: ID!, $query: String, $cursor: String) {{
  node(id: $id) {{
    ... on ProjectV2 {{
      items(first: {PROJECT_ITEMS_PAGE_SIZE}, after: $cursor, query: $query) {{
        pageInfo {{ hasNextPage endCursor }}
        nodes {{ {} }}
      }}
    }}
  }}
}}"#,
        item_selection()
    )
}

fn item_by_id_query() -> String {
    format!(
        r#"query($id: ID!) {{
  node(id: $id) {{
    ... on ProjectV2Item {{ {} project {{ id }} }}
  }}
}}"#,
        item_selection()
    )
}

fn item_memberships_query() -> String {
    let body = format!(
        "id projectItems(first: {MEMBERSHIPS_PER_ITEM}) {{ totalCount nodes {{ {} project {{ {PROJECT_SELECTION} }} }} }}",
        item_selection()
    );
    format!(
        r#"query($owner: String!, $name: String!, $number: Int!) {{
  repository(owner: $owner, name: $name) {{
    issueOrPullRequest(number: $number) {{
      __typename
      ... on Issue {{ {body} }}
      ... on PullRequest {{ {body} }}
    }}
  }}
}}"#
    )
}

const CONTENT_ID_QUERY: &str = r#"query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on Issue { id }
      ... on PullRequest { id }
    }
  }
}"#;

const ADD_ITEM: &str = r#"mutation($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } }
}"#;
const DELETE_ITEM: &str = r#"mutation($projectId: ID!, $itemId: ID!) {
  deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) { deletedItemId }
}"#;
const MOVE_ITEM: &str = r#"mutation($projectId: ID!, $itemId: ID!, $afterId: ID) {
  updateProjectV2ItemPosition(input: { projectId: $projectId, itemId: $itemId, afterId: $afterId }) {
    items { totalCount }
  }
}"#;
const UPDATE_VALUE: &str = r#"mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
  updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }) {
    projectV2Item { id }
  }
}"#;
const CLEAR_VALUE: &str = r#"mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
  clearProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId }) {
    projectV2Item { id }
  }
}"#;

// ---- Shapes the renderer reads. ----

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub number: u64,
    pub title: String,
    pub url: String,
    pub closed: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSavedView {
    pub id: String,
    pub number: u64,
    pub name: String,
    /// "table" or "board".
    pub layout: String,
    pub filter: String,
    pub group_by_field_id: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SingleSelectOption {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IterationOption {
    pub id: String,
    pub title: String,
    pub start_date: String,
    pub duration: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum ProjectField {
    SingleSelect {
        id: String,
        name: String,
        options: Vec<SingleSelectOption>,
    },
    Iteration {
        id: String,
        name: String,
        iterations: Vec<IterationOption>,
    },
    Text {
        id: String,
        name: String,
    },
    Number {
        id: String,
        name: String,
    },
    Date {
        id: String,
        name: String,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum ProjectFieldValue {
    SingleSelect {
        option_id: String,
        name: String,
    },
    Iteration {
        iteration_id: String,
        title: String,
        start_date: String,
        duration: u64,
    },
    Text {
        text: String,
    },
    Number {
        number: f64,
    },
    Date {
        date: String,
    },
}

/// A value to write. Only identifiers and plain values are accepted; names and dates from GitHub come back on read.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum ProjectFieldInput {
    SingleSelect { option_id: String },
    Iteration { iteration_id: String },
    Text { text: String },
    Number { number: f64 },
    Date { date: String },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFieldChange {
    pub field_id: String,
    pub value: Option<ProjectFieldInput>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectItem {
    pub id: String,
    /// "issue", "pull", or "draft".
    pub kind: String,
    pub content_id: Option<String>,
    pub repo_full_name: Option<String>,
    pub number: Option<u64>,
    pub title: String,
    pub html_url: Option<String>,
    /// "open", "closed", or "merged".
    pub state: String,
    pub is_draft: bool,
    /// The issue or pull request's labels. Empty for drafts.
    pub labels: Vec<IssueLabel>,
    pub field_values: BTreeMap<String, ProjectFieldValue>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    pub project: ProjectSummary,
    pub fields: Vec<ProjectField>,
    pub views: Vec<ProjectSavedView>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListPage {
    pub projects: Vec<ProjectSummary>,
    pub partial: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectItemsPage {
    pub items: Vec<ProjectItem>,
    pub partial: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMembership {
    pub project: ProjectSummary,
    pub item: ProjectItem,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ItemMemberships {
    pub content_id: String,
    pub memberships: Vec<ProjectMembership>,
    pub partial: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum ProjectItemEditResult {
    Saved { item: ProjectItem },
    Failed { item: Option<ProjectItem>, message: String },
    Busy,
}

// ---- Validation, run before any request. ----

/// Node ids GitHub returns are opaque strings; this only rules out empty and oversized values.
pub fn is_node_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'=' || c == b'-')
}

fn is_date(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let digits = |r: std::ops::Range<usize>| b[r].iter().all(|c| c.is_ascii_digit());
    if !(digits(0..4) && digits(5..7) && digits(8..10)) {
        return false;
    }
    let month: u32 = value[5..7].parse().unwrap_or(0);
    let day: u32 = value[8..10].parse().unwrap_or(0);
    (1..=12).contains(&month) && (1..=31).contains(&day)
}

pub fn validate_field_input(input: &ProjectFieldInput) -> Result<(), String> {
    match input {
        ProjectFieldInput::SingleSelect { option_id } if !is_node_id(option_id) => Err("That field change is not valid.".into()),
        ProjectFieldInput::Iteration { iteration_id } if !is_node_id(iteration_id) => Err("That field change is not valid.".into()),
        ProjectFieldInput::Text { text } if text.chars().count() > PROJECT_TEXT_MAX_CHARS => Err("That field change is not valid.".into()),
        ProjectFieldInput::Number { number } if !number.is_finite() => Err("That field change is not valid.".into()),
        ProjectFieldInput::Date { date } if !is_date(date) => Err("That field change is not valid.".into()),
        _ => Ok(()),
    }
}

fn assert_node_id(value: &str) -> Result<(), ApiError> {
    if !is_node_id(value) {
        return Err(ApiError::msg("That project item is not valid."));
    }
    Ok(())
}

fn assert_issue_number(value: u64) -> Result<(), ApiError> {
    if value < 1 || value > 2_147_483_647 {
        return Err(ApiError::msg("That issue number is not valid."));
    }
    Ok(())
}

fn parse_repo_full_name(full: &str) -> Result<(String, String), ApiError> {
    let parts: Vec<&str> = full.split('/').collect();
    let login_ok = |o: &str| {
        let b = o.as_bytes();
        !b.is_empty() && b.len() <= 39 && b[0].is_ascii_alphanumeric() && b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'-')
    };
    let name_ok = |n: &str| !n.is_empty() && n.len() <= 100 && n.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'.' | b'-'));
    if parts.len() != 2 || !login_ok(parts[0]) || !name_ok(parts[1]) {
        return Err(ApiError::msg("Choose a repository as owner/name."));
    }
    Ok((parts[0].to_string(), parts[1].to_string()))
}

// ---- Mapping GitHub's JSON into the shapes above. ----

fn to_project_summary(node: &Value) -> Option<ProjectSummary> {
    Some(ProjectSummary {
        id: s(node, "id")?,
        number: u(node, "number")?,
        title: s(node, "title")?,
        url: s(node, "url")?,
        closed: node.get("closed").and_then(Value::as_bool) == Some(true),
    })
}

fn nodes_of(connection: Option<&Value>) -> Vec<Value> {
    connection
        .and_then(|c| c.get("nodes"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn to_field(node: &Value) -> Option<ProjectField> {
    let id = s(node, "id")?;
    let name = s(node, "name")?;
    match node.get("dataType").and_then(Value::as_str)? {
        "SINGLE_SELECT" => {
            let options = node
                .get("options")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|o| {
                    Some(SingleSelectOption {
                        id: s(o, "id")?,
                        name: s(o, "name")?,
                        color: s(o, "color"),
                    })
                })
                .collect();
            Some(ProjectField::SingleSelect { id, name, options })
        }
        "ITERATION" => {
            let iterations = node
                .get("configuration")
                .and_then(|c| c.get("iterations"))
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|i| {
                    Some(IterationOption {
                        id: s(i, "id")?,
                        title: s(i, "title")?,
                        start_date: s(i, "startDate")?,
                        duration: u(i, "duration")?,
                    })
                })
                .collect();
            Some(ProjectField::Iteration { id, name, iterations })
        }
        "TEXT" => Some(ProjectField::Text { id, name }),
        "NUMBER" => Some(ProjectField::Number { id, name }),
        "DATE" => Some(ProjectField::Date { id, name }),
        // Built-in fields such as Title, Labels or Milestone are read-only and not offered.
        _ => None,
    }
}

fn to_saved_view(node: &Value) -> Option<ProjectSavedView> {
    let layout = match node.get("layout").and_then(Value::as_str)? {
        "BOARD_LAYOUT" => "board",
        "TABLE_LAYOUT" => "table",
        _ => return None,
    };
    let group_by = nodes_of(node.get("groupByFields")).into_iter().next();
    Some(ProjectSavedView {
        id: s(node, "id")?,
        number: u(node, "number")?,
        name: s(node, "name")?,
        layout: layout.into(),
        filter: s(node, "filter").unwrap_or_default(),
        group_by_field_id: group_by.and_then(|g| s(&g, "id")),
    })
}

fn to_field_value(node: &Value) -> Option<(String, ProjectFieldValue)> {
    let field_id = node.get("field").and_then(|f| s(f, "id"))?;
    let value = match node.get("__typename").and_then(Value::as_str)? {
        "ProjectV2ItemFieldSingleSelectValue" => ProjectFieldValue::SingleSelect {
            option_id: s(node, "optionId")?,
            name: s(node, "name").unwrap_or_default(),
        },
        "ProjectV2ItemFieldIterationValue" => ProjectFieldValue::Iteration {
            iteration_id: s(node, "iterationId")?,
            title: s(node, "title").unwrap_or_default(),
            start_date: s(node, "startDate")?,
            duration: u(node, "duration")?,
        },
        "ProjectV2ItemFieldTextValue" => ProjectFieldValue::Text {
            text: s(node, "text")?,
        },
        "ProjectV2ItemFieldNumberValue" => ProjectFieldValue::Number {
            number: node.get("number")?.as_f64()?,
        },
        "ProjectV2ItemFieldDateValue" => ProjectFieldValue::Date {
            date: s(node, "date")?,
        },
        _ => return None,
    };
    Some((field_id, value))
}

/// Maps a GraphQL item. Returns None for redacted or unreadable items, so the caller marks the page partial.
pub fn to_project_item(node: &Value) -> Option<ProjectItem> {
    let id = s(node, "id")?;
    let mut field_values = BTreeMap::new();
    for value_node in nodes_of(node.get("fieldValues")) {
        if let Some((field_id, value)) = to_field_value(&value_node) {
            field_values.insert(field_id, value);
        }
    }
    if node.get("type").and_then(Value::as_str) == Some("DRAFT_ISSUE") {
        let content = node.get("content");
        return Some(ProjectItem {
            id,
            kind: "draft".into(),
            content_id: None,
            repo_full_name: None,
            number: None,
            title: content.and_then(|c| s(c, "title")).unwrap_or_default(),
            html_url: None,
            state: "open".into(),
            is_draft: false,
            labels: Vec::new(),
            field_values,
        });
    }
    let content = node.get("content")?;
    let typename = content.get("__typename").and_then(Value::as_str)?;
    if typename != "Issue" && typename != "PullRequest" {
        return None;
    }
    let state = match content.get("state").and_then(Value::as_str)? {
        "OPEN" => "open",
        "CLOSED" => "closed",
        "MERGED" => "merged",
        _ => return None,
    };
    Some(ProjectItem {
        id,
        kind: if typename == "PullRequest" { "pull".into() } else { "issue".into() },
        content_id: Some(s(content, "id")?),
        repo_full_name: Some(content.get("repository").and_then(|r| s(r, "nameWithOwner"))?),
        number: Some(u(content, "number")?),
        title: s(content, "title")?,
        html_url: Some(s(content, "url")?),
        state: state.into(),
        is_draft: typename == "PullRequest" && content.get("isDraft").and_then(Value::as_bool) == Some(true),
        labels: nodes_of(content.get("labels"))
            .iter()
            .filter_map(|label| Some(IssueLabel { name: s(label, "name")?, color: s(label, "color").unwrap_or_default() }))
            .collect(),
        field_values,
    })
}

/// Whether a stored value already equals the value a write would set. Confirms a write that may have landed.
fn value_matches(current: Option<&ProjectFieldValue>, input: Option<&ProjectFieldInput>) -> bool {
    match (current, input) {
        (None, None) => true,
        (Some(c), Some(i)) => match (c, i) {
            (ProjectFieldValue::SingleSelect { option_id, .. }, ProjectFieldInput::SingleSelect { option_id: want }) => option_id == want,
            (ProjectFieldValue::Iteration { iteration_id, .. }, ProjectFieldInput::Iteration { iteration_id: want }) => iteration_id == want,
            (ProjectFieldValue::Text { text }, ProjectFieldInput::Text { text: want }) => text == want,
            (ProjectFieldValue::Number { number }, ProjectFieldInput::Number { number: want }) => number == want,
            (ProjectFieldValue::Date { date }, ProjectFieldInput::Date { date: want }) => date == want,
            _ => false,
        },
        _ => false,
    }
}

fn value_variable(input: &ProjectFieldInput) -> Value {
    match input {
        ProjectFieldInput::SingleSelect { option_id } => json!({ "singleSelectOptionId": option_id }),
        ProjectFieldInput::Iteration { iteration_id } => json!({ "iterationId": iteration_id }),
        ProjectFieldInput::Text { text } => json!({ "text": text }),
        ProjectFieldInput::Number { number } => json!({ "number": number }),
        ProjectFieldInput::Date { date } => json!({ "date": date }),
    }
}

#[derive(Default)]
pub struct ProjectsService {
    /// One pending edit per item, so a second request for it is refused as busy.
    pending: Mutex<HashSet<String>>,
}

struct PendingGuard<'a> {
    set: &'a Mutex<HashSet<String>>,
    key: String,
}

impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        self.set.lock().expect("pending poisoned").remove(&self.key);
    }
}

impl ProjectsService {
    fn lock(&self, key: &str) -> Option<PendingGuard<'_>> {
        let mut set = self.pending.lock().expect("pending poisoned");
        if set.contains(key) {
            return None;
        }
        set.insert(key.to_string());
        Some(PendingGuard {
            set: &self.pending,
            key: key.to_string(),
        })
    }

    /// GraphQL sends some failures inside a 200 response. Any error means GitHub refused the request.
    async fn graphql(&self, ctx: &Ctx, session: &Session, query: &str, variables: Value) -> Result<Value, ApiError> {
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
        if let Some(list) = response.get("errors").and_then(Value::as_array) {
            if !list.is_empty() {
                return Err(ApiError::msg("GitHub refused the project request."));
            }
        }
        Ok(response.get("data").cloned().unwrap_or(json!({})))
    }

    async fn read_item(&self, ctx: &Ctx, session: &Session, item_id: &str) -> Result<Option<ProjectItem>, ApiError> {
        let data = self.graphql(ctx, session, &item_by_id_query(), json!({ "id": item_id })).await?;
        Ok(data.get("node").filter(|n| !n.is_null()).and_then(to_project_item))
    }

    pub async fn list_projects(&self, ctx: &Ctx) -> Result<ProjectListPage, ApiError> {
        let session = ctx.session().await?;
        let data = self.graphql(ctx, &session, &list_projects_query(), json!({})).await?;
        let connection = data.get("viewer").and_then(|v| v.get("projectsV2"));
        let nodes = nodes_of(connection);
        let projects: Vec<ProjectSummary> = nodes.iter().filter_map(to_project_summary).collect();
        let total = connection
            .and_then(|c| c.get("totalCount"))
            .and_then(Value::as_u64)
            .map(|t| t as usize)
            .unwrap_or(nodes.len());
        Ok(ProjectListPage {
            partial: total > projects.len() || projects.len() < nodes.len(),
            projects,
        })
    }

    pub async fn get_project(&self, ctx: &Ctx, project_id: &str) -> Result<ProjectDetail, ApiError> {
        assert_node_id(project_id)?;
        let session = ctx.session().await?;
        let data = self.graphql(ctx, &session, &project_detail_query(), json!({ "id": project_id })).await?;
        let node = data
            .get("node")
            .filter(|n| !n.is_null())
            .ok_or_else(|| ApiError::msg("That project is not available."))?;
        let project = to_project_summary(node).ok_or_else(|| ApiError::msg("That project is not available."))?;
        Ok(ProjectDetail {
            project,
            fields: nodes_of(node.get("fields")).iter().filter_map(to_field).collect(),
            views: nodes_of(node.get("views")).iter().filter_map(to_saved_view).collect(),
        })
    }

    /// Items matching a saved view's filter, page by page. Stops at the page limit and reports partial.
    pub async fn list_items(&self, ctx: &Ctx, project_id: &str, filter: &str) -> Result<ProjectItemsPage, ApiError> {
        assert_node_id(project_id)?;
        if filter.chars().count() > MAX_FILTER_CHARS {
            return Err(ApiError::msg("That filter is not valid."));
        }
        let session = ctx.session().await?;
        let mut items = Vec::new();
        let mut partial = false;
        let mut cursor: Value = Value::Null;
        for page in 1..=PROJECT_ITEMS_PAGE_LIMIT {
            let query_value = if filter.is_empty() { Value::Null } else { Value::String(filter.into()) };
            let data = self
                .graphql(
                    ctx,
                    &session,
                    &project_items_query(),
                    json!({ "id": project_id, "query": query_value, "cursor": cursor }),
                )
                .await?;
            let connection = data
                .get("node")
                .and_then(|n| n.get("items"))
                .ok_or_else(|| ApiError::msg("That project is not available."))?;
            for raw in nodes_of(Some(connection)) {
                match to_project_item(&raw) {
                    Some(item) => items.push(item),
                    None => partial = true,
                }
            }
            let page_info = connection.get("pageInfo");
            let has_next = page_info.and_then(|p| p.get("hasNextPage")).and_then(Value::as_bool) == Some(true);
            if !has_next {
                return Ok(ProjectItemsPage { items, partial });
            }
            match page_info.and_then(|p| s(p, "endCursor")) {
                Some(next) => cursor = Value::String(next),
                None => return Ok(ProjectItemsPage { items, partial: true }),
            }
            if page == PROJECT_ITEMS_PAGE_LIMIT {
                partial = true;
            }
        }
        Ok(ProjectItemsPage { items, partial })
    }

    pub async fn get_item_memberships(&self, ctx: &Ctx, repo_full_name: &str, number: u64) -> Result<ItemMemberships, ApiError> {
        let (owner, name) = parse_repo_full_name(repo_full_name)?;
        assert_issue_number(number)?;
        let session = ctx.session().await?;
        let data = self
            .graphql(ctx, &session, &item_memberships_query(), json!({ "owner": owner, "name": name, "number": number }))
            .await?;
        let content = data
            .get("repository")
            .and_then(|r| r.get("issueOrPullRequest"))
            .filter(|c| !c.is_null())
            .ok_or_else(|| ApiError::msg("That issue or pull request is not available."))?;
        let content_id = s(content, "id").ok_or_else(|| ApiError::msg("That issue or pull request is not available."))?;
        let connection = content.get("projectItems");
        let nodes = nodes_of(connection);
        let mut memberships = Vec::new();
        for raw in &nodes {
            let item = to_project_item(raw);
            let project = raw.get("project").and_then(to_project_summary);
            if let (Some(item), Some(project)) = (item, project) {
                memberships.push(ProjectMembership { project, item });
            }
        }
        let total = connection
            .and_then(|c| c.get("totalCount"))
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize;
        Ok(ItemMemberships {
            content_id,
            partial: total > MEMBERSHIPS_PER_ITEM as usize || memberships.len() < nodes.len(),
            memberships,
        })
    }

    async fn content_id_of(&self, ctx: &Ctx, session: &Session, owner: &str, name: &str, number: u64) -> Result<String, ApiError> {
        let data = self
            .graphql(ctx, session, CONTENT_ID_QUERY, json!({ "owner": owner, "name": name, "number": number }))
            .await?;
        data.get("repository")
            .and_then(|r| r.get("issueOrPullRequest"))
            .and_then(|c| s(c, "id"))
            .ok_or_else(|| ApiError::msg("That issue or pull request was not found."))
    }

    /// Adds an issue or pull request from a personal repo to a project. A transient failure is checked against the
    /// project's items before any retry, so the item is never added twice.
    pub async fn add_item(&self, ctx: &Ctx, project_id: &str, repo_full_name: &str, number: u64) -> Result<ProjectItem, ApiError> {
        assert_node_id(project_id)?;
        let (owner, name) = parse_repo_full_name(repo_full_name)?;
        assert_issue_number(number)?;
        if let Ok((login, _)) = ctx.signed_in() {
            if owner.to_lowercase() != login.to_lowercase() {
                return Err(ApiError::msg(
                    "Only personal repos, owned by the signed-in account, can be added to a project.",
                ));
            }
        }
        let key = format!("add\u{0}{project_id}\u{0}{repo_full_name}#{number}");
        let _guard = self
            .lock(&key)
            .ok_or_else(|| ApiError::msg("This item is already being added to the project."))?;
        let session = ctx.session().await?;
        let content_id = self.content_id_of(ctx, &session, &owner, &name, number).await?;
        let item_id = ctx
            .writes
            .run(
                || {
                    let content_id = content_id.clone();
                    let session = &session;
                    async move {
                        let data = self
                            .graphql(ctx, session, ADD_ITEM, json!({ "projectId": project_id, "contentId": content_id }))
                            .await?;
                        data.get("addProjectV2ItemById")
                            .and_then(|r| r.get("item"))
                            .and_then(|i| s(i, "id"))
                            .ok_or_else(|| ApiError::msg("GitHub returned an invalid project item."))
                    }
                },
                || {
                    let session = &session;
                    async move {
                        let found = self.get_item_memberships(ctx, repo_full_name, number).await;
                        let _ = session;
                        Ok(match found {
                            Ok(found) => match found.memberships.into_iter().find(|m| m.project.id == project_id) {
                                Some(m) => Reconciled::Applied(m.item.id),
                                None => Reconciled::NotApplied,
                            },
                            Err(_) => Reconciled::NotApplied,
                        })
                    }
                },
            )
            .await?;
        self.read_item(ctx, &session, &item_id)
            .await?
            .ok_or_else(|| ApiError::msg("GitHub did not return the added item."))
    }

    /// Places an item after another in the manual order, or at the top when `after_id` is None.
    pub async fn move_item(&self, ctx: &Ctx, project_id: &str, item_id: &str, after_id: Option<&str>) -> Result<(), ApiError> {
        assert_node_id(project_id)?;
        assert_node_id(item_id)?;
        if let Some(after) = after_id {
            assert_node_id(after)?;
        }
        let _guard = self
            .lock(item_id)
            .ok_or_else(|| ApiError::msg("This item already has a change in progress."))?;
        let session = ctx.session().await?;
        ctx.writes
            .run(
                || {
                    let session = &session;
                    async move {
                        self.graphql(
                            ctx,
                            session,
                            MOVE_ITEM,
                            json!({ "projectId": project_id, "itemId": item_id, "afterId": after_id }),
                        )
                        .await?;
                        Ok(())
                    }
                },
                || async { Ok(Reconciled::NotApplied) },
            )
            .await
    }

    /// Removes an item from its project. The item stays on GitHub; only the project membership goes.
    pub async fn remove_item(&self, ctx: &Ctx, project_id: &str, item_id: &str) -> Result<(), ApiError> {
        assert_node_id(project_id)?;
        assert_node_id(item_id)?;
        let _guard = self
            .lock(item_id)
            .ok_or_else(|| ApiError::msg("This item already has a change in progress."))?;
        let session = ctx.session().await?;
        ctx.writes
            .run(
                || {
                    let session = &session;
                    async move {
                        self.graphql(ctx, session, DELETE_ITEM, json!({ "projectId": project_id, "itemId": item_id }))
                            .await?;
                        Ok(())
                    }
                },
                || {
                    let session = &session;
                    async move {
                        Ok(match self.read_item(ctx, session, item_id).await? {
                            None => Reconciled::Applied(()),
                            Some(_) => Reconciled::NotApplied,
                        })
                    }
                },
            )
            .await
    }

    /// Sets or clears one field. Returns GitHub's version of the item whether or not the save succeeded.
    pub async fn set_field_value(
        &self,
        ctx: &Ctx,
        project_id: &str,
        item_id: &str,
        change: &ProjectFieldChange,
    ) -> Result<ProjectItemEditResult, ApiError> {
        assert_node_id(project_id)?;
        assert_node_id(item_id)?;
        assert_node_id(&change.field_id)?;
        if let Some(value) = &change.value {
            validate_field_input(value).map_err(ApiError::msg)?;
        }
        let Some(_guard) = self.lock(item_id) else {
            return Ok(ProjectItemEditResult::Busy);
        };
        let session = match ctx.session().await {
            Ok(s) => s,
            Err(e) => {
                return Ok(ProjectItemEditResult::Failed {
                    item: None,
                    message: e.to_string(),
                })
            }
        };
        // Set once GitHub has confirmed the write, so a later read failure cannot report it as unsaved.
        let write = ctx
            .writes
            .run(
                || {
                    let session = &session;
                    async move {
                        match &change.value {
                            None => {
                                self.graphql(ctx, session, CLEAR_VALUE, json!({ "projectId": project_id, "itemId": item_id, "fieldId": change.field_id }))
                                    .await?;
                            }
                            Some(value) => {
                                self.graphql(
                                    ctx,
                                    session,
                                    UPDATE_VALUE,
                                    json!({
                                        "projectId": project_id,
                                        "itemId": item_id,
                                        "fieldId": change.field_id,
                                        "value": value_variable(value),
                                    }),
                                )
                                .await?;
                            }
                        }
                        Ok(())
                    }
                },
                || {
                    let session = &session;
                    async move {
                        let stored = self.read_item(ctx, session, item_id).await?;
                        let current = stored.as_ref().and_then(|i| i.field_values.get(&change.field_id));
                        Ok(if value_matches(current, change.value.as_ref()) {
                            Reconciled::Applied(())
                        } else {
                            Reconciled::NotApplied
                        })
                    }
                },
            )
            .await;

        match write {
            Ok(()) => match self.read_item(ctx, &session, item_id).await {
                Ok(Some(item)) => Ok(ProjectItemEditResult::Saved { item }),
                Ok(None) => Ok(ProjectItemEditResult::Failed {
                    item: None,
                    message: "That item is no longer in the project.".into(),
                }),
                Err(_) => Ok(ProjectItemEditResult::Failed {
                    item: None,
                    message: "The change saved, but GitHub could not be read back.".into(),
                }),
            },
            Err(error) => {
                // A failed or uncertain save: read GitHub's version so the view shows what is actually stored.
                let item = self.read_item(ctx, &session, item_id).await.ok().flatten();
                let message = match &error {
                    ApiError::Msg(m) => m.clone(),
                    other => other.to_string(),
                };
                let message = if message.is_empty() { "GitHub could not save this change.".into() } else { message };
                Ok(ProjectItemEditResult::Failed { item, message })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_ids_are_opaque_but_bounded() {
        assert!(is_node_id("PVT_kwDOAbc=_-"));
        assert!(!is_node_id(""));
        assert!(!is_node_id("bad id"));
    }

    #[test]
    fn dates_must_be_calendar_shaped() {
        assert!(is_date("2026-11-16"));
        assert!(!is_date("2026-13-01"));
        assert!(!is_date("16-11-2026"));
    }

    #[test]
    fn draft_items_map_without_a_repo() {
        let node = json!({
            "id": "PVTI_1", "type": "DRAFT_ISSUE",
            "content": {"__typename": "DraftIssue", "id": "x", "title": "Idea"},
            "fieldValues": {"nodes": []}
        });
        let item = to_project_item(&node).unwrap();
        assert_eq!(item.kind, "draft");
        assert_eq!(item.title, "Idea");
        assert!(item.repo_full_name.is_none());
        assert!(item.labels.is_empty());
    }

    #[test]
    fn issue_items_carry_their_labels() {
        let node = json!({
            "id": "PVTI_3", "type": "ISSUE",
            "content": {
                "__typename": "Issue", "id": "I_1", "number": 7, "title": "Crash", "url": "https://github.com/o/r/issues/7",
                "state": "OPEN", "repository": {"nameWithOwner": "o/r"},
                "labels": {"nodes": [{"name": "bug", "color": "d73a4a"}, {"name": "help wanted", "color": "008672"}]}
            },
            "fieldValues": {"nodes": []}
        });
        let item = to_project_item(&node).unwrap();
        let names: Vec<&str> = item.labels.iter().map(|label| label.name.as_str()).collect();
        assert_eq!(names, ["bug", "help wanted"]);
        assert_eq!(item.labels[0].color, "d73a4a");
    }

    #[test]
    fn field_values_are_keyed_by_field() {
        let node = json!({
            "id": "PVTI_2", "type": "ISSUE",
            "content": {"__typename": "Issue", "id": "I_1", "number": 4, "title": "t", "url": "u", "state": "OPEN",
                "repository": {"nameWithOwner": "o/r"}},
            "fieldValues": {"nodes": [
                {"__typename": "ProjectV2ItemFieldTextValue", "text": "hi", "field": {"id": "F_1"}}
            ]}
        });
        let item = to_project_item(&node).unwrap();
        assert_eq!(item.field_values.get("F_1"), Some(&ProjectFieldValue::Text { text: "hi".into() }));
    }
}
