//! An in-memory index of the signed-in account's issues and pull requests in its personal repos, for search. It lives for
//! the session only: GitHub responses are never written to disk. Search answers from the index once every personal repo
//! has been read. The index then catches up in the background, asking GitHub only for items changed since each repo's
//! last read.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures::future::try_join_all;
use serde::Serialize;
use serde_json::Value;

use super::inbox::{to_inbox_item, InboxItem, SEARCH_RESULT_CAP};
use super::repos::RepoService;
use super::search::{matches_filters, SearchPage, SearchRequest, SEARCH_PER_PAGE};
use super::util::{enc, repo_path};
use super::write::ApiError;
use super::{get_json, Ctx};

const READ_PAGE: u64 = 100;
/// Repos read at once. Each read pages through its items one page after another.
const REPO_CONCURRENCY: usize = 4;
/// A complete index is re-read in the background once it is older than this.
const STALE_AFTER: Duration = Duration::from_secs(60);

/// What the index is doing, for the window. The totals are 0 until the repo list has come back.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub syncing: bool,
    pub ready: bool,
    pub repos_read: usize,
    pub repos_total: usize,
}

/// Called with the new status whenever it changes.
pub type IndexListener = Arc<dyn Fn(IndexStatus) + Send + Sync>;

#[derive(Clone)]
struct Indexed {
    item: InboxItem,
    /// Lowercased title, body, labels, author and repo name, for word matching.
    text: String,
}

#[derive(Default)]
struct State {
    login: Option<String>,
    /// Bumped when the account changes, so a read still running for the old account writes nothing.
    generation: u64,
    /// Keyed by `repo#number`.
    items: HashMap<String, Indexed>,
    /// Per repo, the time its last read started. The next read asks only for items changed since then.
    read_at: HashMap<String, String>,
    /// Every personal repo has been read at least once for this account.
    complete: bool,
    syncing: bool,
    last_read: Option<Instant>,
    repos_read: usize,
    repos_total: usize,
}

/// The shared index. One per app; the state inside belongs to whichever account is signed in.
pub struct SearchIndex {
    state: Mutex<State>,
    on_change: IndexListener,
}

impl SearchIndex {
    pub fn new(on_change: IndexListener) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State::default()),
            on_change,
        })
    }

    /// What the index is doing now.
    pub fn status(&self) -> IndexStatus {
        let st = self.state.lock().expect("search index poisoned");
        IndexStatus {
            syncing: st.syncing,
            ready: st.complete,
            repos_read: st.repos_read,
            repos_total: st.repos_total,
        }
    }

    /// Tells the window the status changed. Called without the lock held.
    fn notify(&self) {
        (self.on_change)(self.status());
    }

    /// Answers a search from the index, or None when the index has not yet read every repo for this account.
    pub fn query(&self, login: &str, request: &SearchRequest) -> Option<SearchPage> {
        let st = self.state.lock().expect("search index poisoned");
        if !st.complete || st.login.as_deref() != Some(login) {
            return None;
        }
        let words: Vec<String> = request
            .terms
            .split_whitespace()
            .map(clean_word)
            .filter(|w| !w.is_empty())
            .collect();
        let number = request.number;
        // The number alone was typed: only that item matches.
        let number_only = number.is_some_and(|n| words.iter().all(|w| w.trim_start_matches('#') == n.to_string()));

        let mut hits: Vec<&Indexed> = st
            .items
            .values()
            .filter(|entry| matches_filters(&entry.item, request))
            .filter(|entry| match number {
                Some(n) if number_only => entry.item.number == n,
                _ => words.iter().all(|w| entry.text.contains(w.as_str())),
            })
            .collect();
        // Newest first; ties broken by key so the order is the same every time.
        hits.sort_by(|a, b| {
            b.item
                .updated_at
                .cmp(&a.item.updated_at)
                .then_with(|| key_of(&a.item).cmp(&key_of(&b.item)))
        });
        if let Some(n) = number {
            // An item whose number was typed is listed before the text matches.
            hits.sort_by_key(|entry| entry.item.number != n);
        }

        let per_page = SEARCH_PER_PAGE as usize;
        let total = hits.len();
        let start = (request.page.saturating_sub(1) as usize) * per_page;
        let items = hits.iter().skip(start).take(per_page).map(|entry| entry.item.clone()).collect();
        let reachable = total.min(SEARCH_RESULT_CAP as usize);
        Some(SearchPage {
            items,
            total_count: total as u64,
            page: request.page,
            has_next_page: start + per_page < reachable,
            partial: false,
        })
    }

    /// Starts reading the account's repos into the index in the background. Does nothing while a read is running, or
    /// when the index is complete and recent.
    pub fn refresh(self: &Arc<Self>, ctx: &Ctx, repos: &Arc<RepoService>, login: &str) {
        let generation = {
            let mut st = self.state.lock().expect("search index poisoned");
            if st.login.as_deref() != Some(login) {
                let generation = st.generation + 1;
                *st = State {
                    login: Some(login.to_string()),
                    generation,
                    ..State::default()
                };
            }
            if st.syncing {
                return;
            }
            if st.complete && st.last_read.is_some_and(|at| at.elapsed() < STALE_AFTER) {
                return;
            }
            st.syncing = true;
            st.generation
        };
        self.notify();
        let index = Arc::clone(self);
        let ctx = owned_ctx(ctx);
        let repos = Arc::clone(repos);
        let login = login.to_string();
        tokio::spawn(async move {
            let result = index.read_all(&ctx, &repos, &login, generation).await;
            {
                let mut st = index.state.lock().expect("search index poisoned");
                if st.generation != generation {
                    return;
                }
                st.syncing = false;
                if result.is_ok() {
                    st.complete = true;
                    st.last_read = Some(Instant::now());
                }
            }
            index.notify();
        });
    }

    async fn read_all(&self, ctx: &Ctx, repos: &RepoService, login: &str, generation: u64) -> Result<(), ApiError> {
        let names: Vec<String> = repos
            .list_personal_repos(ctx)
            .await?
            .into_iter()
            .map(|repo| repo.full_name)
            .collect();
        {
            let mut st = self.state.lock().expect("search index poisoned");
            if st.generation != generation {
                return Ok(());
            }
            st.repos_total = names.len();
            st.repos_read = 0;
        }
        self.notify();
        for chunk in names.chunks(REPO_CONCURRENCY) {
            let since: Vec<Option<String>> = {
                let st = self.state.lock().expect("search index poisoned");
                chunk.iter().map(|name| st.read_at.get(name).cloned()).collect()
            };
            let mut pending = Vec::with_capacity(chunk.len());
            for (name, since) in chunk.iter().zip(since) {
                pending.push(read_repo(ctx, name.clone(), since));
            }
            let read = try_join_all(pending).await?;

            let mut st = self.state.lock().expect("search index poisoned");
            if st.generation != generation {
                return Ok(());
            }
            for (name, started, rows) in read {
                for raw in &rows {
                    if let Some(item) = to_inbox_item(raw, login) {
                        let key = key_of(&item);
                        let text = haystack(raw, &item);
                        st.items.insert(key, Indexed { item, text });
                    }
                }
                st.read_at.insert(name, started);
            }
            st.repos_read += chunk.len();
            drop(st);
            self.notify();
        }
        Ok(())
    }
}

/// One repo's items, changed since `since` when a previous read exists. Returns the time this read started, which is
/// what the next read asks from: anything that changes during this read is picked up again next time.
async fn read_repo(
    ctx: &Ctx,
    full_name: String,
    since: Option<String>,
) -> Result<(String, String, Vec<Value>), ApiError> {
    let started = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let (owner, name) = full_name
        .split_once('/')
        .ok_or_else(|| ApiError::msg("GitHub returned an invalid repository."))?;
    let session = ctx.session().await?;
    let mut rows = Vec::new();
    for page in 1.. {
        let mut path = format!(
            "{}/issues?state=all&sort=updated&direction=desc&per_page={READ_PAGE}&page={page}",
            repo_path(owner, name)
        );
        if let Some(since) = &since {
            path.push_str(&format!("&since={}", enc(since)));
        }
        let body = get_json(ctx, &session, &path).await?;
        let list = body
            .as_array()
            .ok_or_else(|| ApiError::msg("GitHub returned an invalid issue list."))?;
        rows.extend(list.iter().cloned());
        if (list.len() as u64) < READ_PAGE {
            break;
        }
    }
    Ok((full_name, started, rows))
}

/// Everything the account can search for in one item, lowercased.
fn haystack(raw: &Value, item: &InboxItem) -> String {
    let mut text = String::new();
    text.push_str(&item.title);
    text.push('\n');
    if let Some(body) = raw.get("body").and_then(Value::as_str) {
        text.push_str(body);
        text.push('\n');
    }
    text.push_str(&item.author_login);
    text.push('\n');
    for label in &item.labels {
        text.push_str(&label.name);
        text.push('\n');
    }
    text.push_str(&item.repo_full_name);
    text.to_lowercase()
}

/// Strips the characters search syntax uses, the same way the GitHub query is built.
fn clean_word(word: &str) -> String {
    word.chars()
        .filter(|c| !matches!(c, '"' | '\'' | ':'))
        .collect::<String>()
        .to_lowercase()
}

fn key_of(item: &InboxItem) -> String {
    format!("{}#{}", item.repo_full_name, item.number)
}

/// The same handles, owned, so a background read can outlive the request that started it.
fn owned_ctx(ctx: &Ctx) -> Ctx {
    Ctx {
        auth: Arc::clone(&ctx.auth),
        client: Arc::clone(&ctx.client),
        writes: Arc::clone(&ctx.writes),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::search::SearchRequest;
    use serde_json::json;

    fn raw(number: u64, title: &str, body: &str, state: &str, updated: &str) -> Value {
        json!({
            "number": number,
            "title": title,
            "body": body,
            "state": state,
            "updated_at": updated,
            "html_url": format!("https://github.com/octo/app/issues/{number}"),
            "repository_url": "https://api.github.com/repos/octo/app",
            "user": { "login": "octo" },
            "labels": [{ "name": "bug", "color": "ff0000" }],
            "comments": 0
        })
    }

    fn request(terms: &str) -> SearchRequest {
        SearchRequest {
            terms: terms.into(),
            kind: "all".into(),
            state: "all".into(),
            repo_full_name: None,
            labels: vec![],
            author: None,
            number: None,
            page: 1,
        }
    }

    fn index_with(rows: Vec<Value>) -> Arc<SearchIndex> {
        let index = SearchIndex::new(Arc::new(|_| {}));
        {
            let mut st = index.state.lock().unwrap();
            st.login = Some("octo".into());
            st.complete = true;
            for row in rows {
                let item = to_inbox_item(&row, "octo").expect("valid item");
                let text = haystack(&row, &item);
                st.items.insert(key_of(&item), Indexed { item, text });
            }
        }
        index
    }

    #[test]
    fn nothing_is_answered_until_every_repo_has_been_read() {
        let index = SearchIndex::new(Arc::new(|_| {}));
        index.state.lock().unwrap().login = Some("octo".into());
        assert!(index.query("octo", &request("")).is_none());
    }

    #[test]
    fn words_match_the_title_body_and_labels_and_newest_come_first() {
        let index = index_with(vec![
            raw(1, "Crash on save", "the editor freezes", "open", "2026-01-01T00:00:00Z"),
            raw(2, "Add dark mode", "users asked", "open", "2026-02-01T00:00:00Z"),
            raw(3, "Typo", "freezes the menu", "closed", "2026-03-01T00:00:00Z"),
        ]);
        let page = index.query("octo", &request("freezes")).expect("answered");
        assert_eq!(page.total_count, 2);
        assert_eq!(page.items.iter().map(|i| i.number).collect::<Vec<_>>(), vec![3, 1]);
        assert!(!page.partial);
    }

    #[test]
    fn state_and_words_together_narrow_the_result() {
        let index = index_with(vec![
            raw(1, "Crash", "", "open", "2026-01-01T00:00:00Z"),
            raw(2, "Crash", "", "closed", "2026-01-02T00:00:00Z"),
        ]);
        let mut open = request("crash");
        open.state = "open".into();
        let page = index.query("octo", &open).expect("answered");
        assert_eq!(page.items.iter().map(|i| i.number).collect::<Vec<_>>(), vec![1]);
    }

    #[test]
    fn a_typed_number_lists_that_item_first_and_alone_when_only_the_number_is_typed() {
        let index = index_with(vec![
            raw(7, "Unrelated", "", "open", "2026-03-01T00:00:00Z"),
            raw(8, "Mentions 7 in text", "", "open", "2026-02-01T00:00:00Z"),
        ]);
        let mut only = request("7");
        only.number = Some(7);
        let page = index.query("octo", &only).expect("answered");
        assert_eq!(page.items.iter().map(|i| i.number).collect::<Vec<_>>(), vec![7]);
    }

    #[test]
    fn another_account_gets_no_answer_from_this_index() {
        let index = index_with(vec![raw(1, "Crash", "", "open", "2026-01-01T00:00:00Z")]);
        assert!(index.query("someone-else", &request("crash")).is_none());
    }
}
