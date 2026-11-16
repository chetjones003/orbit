//! Cross-repo search for issues and pull requests in the account's personal repos. Ported from `search-service.ts`.
//! The text parsing that turns typed words into these structured fields lives in the renderer, so GitHub never
//! receives raw search syntax.

use serde::{Deserialize, Serialize};

use super::client::GitHubError;
use super::inbox::{to_inbox_item, InboxItem, SEARCH_RESULT_CAP};
use super::util::{enc, repo_path};
use super::write::ApiError;
use super::{get_json, Ctx};

const SEARCH_PER_PAGE: u64 = 30;
const LOOKUP_BATCH: usize = 6;
const SEARCH_TEXT_MAX: usize = 256;
const SEARCH_LABELS_MAX: usize = 5;
const NUMBER_MAX: u64 = 999_999_999;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub terms: String,
    /// "all", "issue", or "pull".
    pub kind: String,
    /// "open", "closed", or "all".
    pub state: String,
    pub repo_full_name: Option<String>,
    pub labels: Vec<String>,
    pub author: Option<String>,
    pub number: Option<u64>,
    pub page: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub items: Vec<InboxItem>,
    pub total_count: u64,
    pub page: u64,
    pub has_next_page: bool,
    pub partial: bool,
}

fn is_login(text: &str) -> bool {
    let bytes = text.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 39
        && bytes[0].is_ascii_alphanumeric()
        && bytes.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'-')
}

fn is_repo_name(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 100
        && text.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'_' || c == b'-')
}

/// The GitHub search query for one request. Always limited to the account's own repos.
pub fn build_search_query(request: &SearchRequest, login: &str) -> Result<(String, Option<&'static str>), ApiError> {
    if !is_login(login) {
        return Err(ApiError::msg("The signed-in account name is not valid."));
    }
    let mut parts = vec![format!("user:{login}")];
    match request.kind.as_str() {
        "issue" => parts.push("is:issue".into()),
        "pull" => parts.push("is:pr".into()),
        _ => {}
    }
    if request.state != "all" {
        parts.push(format!("is:{}", request.state));
    }
    if let Some(full) = &request.repo_full_name {
        let pieces: Vec<&str> = full.split('/').collect();
        let owner_ok = pieces.len() == 2 && pieces[0].to_lowercase() == login.to_lowercase();
        if !owner_ok || !is_repo_name(pieces[1]) {
            return Err(ApiError::msg("Search covers only your own repositories."));
        }
        parts.push(format!("repo:{}/{}", pieces[0], pieces[1]));
    }
    for label in &request.labels {
        let clean = label.replace('"', "");
        let clean = clean.trim();
        if !clean.is_empty() {
            parts.push(format!("label:\"{clean}\""));
        }
    }
    if let Some(author) = &request.author {
        if !is_login(author) {
            return Err(ApiError::msg("The author must be a GitHub account name."));
        }
        parts.push(format!("author:{author}"));
    }
    let words: Vec<String> = request
        .terms
        .split_whitespace()
        .map(|w| w.chars().filter(|c| !matches!(c, '"' | '\'' | ':')).collect::<String>())
        .filter(|w| !w.is_empty())
        .collect();
    let has_words = !words.is_empty();
    parts.extend(words);
    let sort = if has_words { None } else { Some("updated") };
    Ok((parts.join(" "), sort))
}

/// True when the only words typed are the number itself, such as "1236" or "#1236".
fn is_number_only(terms: &str, number: u64) -> bool {
    let words: Vec<&str> = terms.split_whitespace().collect();
    !words.is_empty() && words.iter().all(|w| w.trim_start_matches('#') == number.to_string())
}

fn matches_filters(item: &InboxItem, request: &SearchRequest) -> bool {
    if request.kind == "issue" && item.kind != "issue" {
        return false;
    }
    if request.kind == "pull" && item.kind != "pull" {
        return false;
    }
    if request.state != "all" && item.state != request.state {
        return false;
    }
    if let Some(author) = &request.author {
        if item.author_login.to_lowercase() != author.to_lowercase() {
            return false;
        }
    }
    request.labels.iter().all(|wanted| {
        item.labels
            .iter()
            .any(|l| l.name.to_lowercase() == wanted.to_lowercase())
    })
}

fn item_key(item: &InboxItem) -> String {
    format!("{}#{}", item.repo_full_name, item.number)
}

pub async fn search(ctx: &Ctx, repos: &super::repos::RepoService, request: &SearchRequest) -> Result<SearchPage, ApiError> {
    if request.terms.chars().count() > SEARCH_TEXT_MAX {
        return Err(ApiError::msg(format!(
            "Search text must be {SEARCH_TEXT_MAX} characters or fewer."
        )));
    }
    if !["all", "issue", "pull"].contains(&request.kind.as_str()) {
        return Err(ApiError::msg("Unknown search type."));
    }
    if !["open", "closed", "all"].contains(&request.state.as_str()) {
        return Err(ApiError::msg("Unknown search state."));
    }
    if request.labels.len() > SEARCH_LABELS_MAX || request.labels.iter().any(|l| l.chars().count() > 100) {
        return Err(ApiError::msg(format!(
            "Search up to {SEARCH_LABELS_MAX} labels at a time."
        )));
    }
    if let Some(n) = request.number {
        if !(1..=NUMBER_MAX).contains(&n) {
            return Err(ApiError::msg("Issue and pull request numbers are whole numbers."));
        }
    }
    let max_page = SEARCH_RESULT_CAP.div_ceil(SEARCH_PER_PAGE);
    if request.page < 1 || request.page > max_page {
        return Err(ApiError::msg(
            "Search pages must be positive whole numbers within GitHub’s search limit.",
        ));
    }
    let (login, session_id) = ctx
        .signed_in()
        .map_err(|_| ApiError::msg("Sign in to GitHub to search."))?;
    let session = ctx.session().await?;
    let _ = session_id;

    let (q, sort) = build_search_query(request, &login)?;

    // A number is looked up directly, on the first page only, and listed before any text matches.
    let hits = match request.number {
        Some(number) if request.page == 1 => find_by_number(ctx, repos, number, request, &login, &session).await?,
        _ => LookupHits {
            items: Vec::new(),
            partial: false,
        },
    };
    if let Some(number) = request.number {
        if is_number_only(&request.terms, number) {
            let count = hits.items.len() as u64;
            return Ok(SearchPage {
                items: hits.items,
                total_count: count,
                page: request.page,
                has_next_page: false,
                partial: hits.partial,
            });
        }
    }

    let mut path = format!("/search/issues?q={}&per_page={SEARCH_PER_PAGE}&page={}", enc(&q), request.page);
    if let Some(sort) = sort {
        path.push_str(&format!("&sort={sort}&order=desc"));
    }
    let body = get_json(ctx, &session, &path).await?;
    let total = body.get("total_count").and_then(|v| v.as_u64());
    let incomplete = body.get("incomplete_results").and_then(|v| v.as_bool());
    let (Some(total), Some(incomplete), Some(raw_items)) =
        (total, incomplete, body.get("items").and_then(|v| v.as_array()))
    else {
        return Err(ApiError::msg("GitHub returned an invalid search result."));
    };

    let mut found: Vec<InboxItem> = Vec::new();
    let mut partial = incomplete || total > SEARCH_RESULT_CAP || hits.partial;
    for raw in raw_items {
        match to_inbox_item(raw, &login) {
            Some(item) => found.push(item),
            None => partial = true,
        }
    }

    // Lookup hits lead, and a search result for the same item is not listed twice.
    let seen: std::collections::HashSet<String> = hits.items.iter().map(item_key).collect();
    let mut items = hits.items.clone();
    for item in &found {
        if !seen.contains(&item_key(item)) {
            items.push(item.clone());
        }
    }
    let visible_total = total.min(SEARCH_RESULT_CAP);
    let total_count = visible_total + items.len() as u64 - found.len() as u64;
    Ok(SearchPage {
        items,
        total_count,
        page: request.page,
        has_next_page: request.page * SEARCH_PER_PAGE < visible_total,
        partial,
    })
}

struct LookupHits {
    items: Vec<InboxItem>,
    partial: bool,
}

/// The item with this number in each repo it could be in: the one chosen, or every personal repo. A repo without
/// that number answers 404 and is skipped. Other failures mark the result partial.
async fn find_by_number(
    ctx: &Ctx,
    repos: &super::repos::RepoService,
    number: u64,
    request: &SearchRequest,
    login: &str,
    session: &super::Session,
) -> Result<LookupHits, ApiError> {
    let names: Vec<String> = match &request.repo_full_name {
        Some(name) => vec![name.clone()],
        None => repos
            .current(ctx)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|r| r.full_name)
            .filter(|full| full.split('/').next().map(|o| o.to_lowercase()) == Some(login.to_lowercase()))
            .collect(),
    };

    let mut items = Vec::new();
    let mut partial = false;
    for batch in names.chunks(LOOKUP_BATCH) {
        let mut futures = Vec::new();
        for full in batch {
            let path = format!("{}/issues/{number}", repo_path_from_full(full));
            futures.push(async move { (full.clone(), ctx.client.get(&path, &session.token, &session.scope).await) });
        }
        let results = futures_util_join_all(futures).await;
        for (full, result) in results {
            match result {
                Err(GitHubError::Http(404)) => {}
                Err(_) => partial = true,
                Ok(raw) => {
                    // The single-item response may omit the repo link, so the repo this request was made for is used.
                    let mut with_repo = raw;
                    if with_repo.get("repository_url").is_none() {
                        with_repo["repository_url"] =
                            serde_json::Value::String(format!("https://api.github.com/repos/{full}"));
                    }
                    if let Some(item) = to_inbox_item(&with_repo, login) {
                        if matches_filters(&item, request) {
                            items.push(item);
                        }
                    }
                }
            }
        }
    }
    Ok(LookupHits { items, partial })
}

fn repo_path_from_full(full: &str) -> String {
    let mut parts = full.splitn(2, '/');
    let owner = parts.next().unwrap_or_default();
    let name = parts.next().unwrap_or_default();
    repo_path(owner, name)
}

/// Runs a batch of futures together and returns their results in order.
async fn futures_util_join_all<F, T>(futures: Vec<F>) -> Vec<T>
where
    F: std::future::Future<Output = T>,
{
    let mut out = Vec::with_capacity(futures.len());
    for f in futures {
        out.push(f.await);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(terms: &str) -> SearchRequest {
        SearchRequest {
            terms: terms.into(),
            kind: "all".into(),
            state: "open".into(),
            repo_full_name: None,
            labels: vec![],
            author: None,
            number: None,
            page: 1,
        }
    }

    #[test]
    fn query_is_always_limited_to_the_account() {
        let (q, sort) = build_search_query(&request(""), "octo").unwrap();
        assert!(q.starts_with("user:octo"));
        assert_eq!(sort, Some("updated"));
        let (_, sort) = build_search_query(&request("crash"), "octo").unwrap();
        assert_eq!(sort, None);
    }

    #[test]
    fn foreign_repos_are_refused() {
        let mut r = request("x");
        r.repo_full_name = Some("someone/else".into());
        assert!(build_search_query(&r, "octo").is_err());
    }

    #[test]
    fn quotes_and_colons_are_stripped_from_words() {
        let (q, _) = build_search_query(&request("a\"b:c"), "octo").unwrap();
        assert!(q.ends_with("abc"));
    }

    #[test]
    fn number_only_detects_bare_numbers() {
        assert!(is_number_only("#1236", 1236));
        assert!(!is_number_only("1236 crash", 1236));
    }
}
