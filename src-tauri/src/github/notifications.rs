//! Unread GitHub notifications on the account's personal repos. Polls, decides what is new, and keeps only what the
//! user can still open, in memory. Ported from `notification-service.ts`, `notification-center.ts` and
//! `notification-policy.ts`.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use super::util::s;
use super::write::ApiError;
use super::Ctx;

/// Above this many new notifications in one poll, the user gets one summary instead of one each.
const CATCH_UP_LIMIT: usize = 3;
const DEFAULT_REMEMBER_LIMIT: usize = 200;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationTarget {
    /// "issue" or "pull".
    pub kind: String,
    pub repo_full_name: String,
    pub number: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationItem {
    pub thread_id: String,
    pub repo_full_name: String,
    pub title: String,
    pub reason: String,
    pub subject_type: String,
    pub updated_at: String,
    pub target: Option<NotificationTarget>,
}

/// What the user should be told. `items` gets one toast each; `summary` covers many. `desktop: false` is the quiet
/// startup baseline, shown in-app only.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum NotificationDelivery {
    Items { items: Vec<NotificationItem> },
    Summary { count: usize, desktop: bool },
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationOpenResult {
    pub target: Option<NotificationTarget>,
    pub mark_read_error: Option<String>,
}

pub struct NotificationPoll {
    pub poll_interval_ms: Option<u64>,
    pub delivery: Option<NotificationDelivery>,
}

/// One desktop notice. `thread_id` is None for summaries, which open the app without navigating.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DesktopNotice {
    pub thread_id: Option<String>,
    pub title: String,
    pub body: String,
}

fn reason_label(reason: &str) -> &str {
    match reason {
        "mention" => "Mention",
        "team_mention" => "Team mention",
        "review_requested" => "Review requested",
        "assign" => "Assigned",
        "author" => "Activity on your item",
        "comment" => "New comment",
        "state_change" => "State changed",
        "ci_activity" => "CI activity",
        "subscribed" => "Activity",
        other => other,
    }
}

/// How one notification reads in a toast or a desktop notification.
pub fn describe_item(item: &NotificationItem) -> (String, String) {
    (
        item.repo_full_name.clone(),
        format!("{}: {}", reason_label(&item.reason), item.title),
    )
}

/// How a summary reads. `quiet` is the startup baseline: existing unread, not new.
pub fn describe_summary(count: usize, quiet: bool) -> (String, String) {
    let body = if quiet {
        format!("{count} unread GitHub notifications")
    } else {
        format!("{count} new GitHub notifications")
    };
    ("Orbit".to_string(), body)
}

/// Desktop notices for a delivery. They appear only while Orbit is not focused. The quiet startup baseline never
/// becomes a desktop notice.
pub fn desktop_notices(delivery: &NotificationDelivery, focused: bool) -> Vec<DesktopNotice> {
    if focused {
        return Vec::new();
    }
    match delivery {
        NotificationDelivery::Summary { desktop: false, .. } => Vec::new(),
        NotificationDelivery::Summary { count, desktop: true } => {
            let (title, body) = describe_summary(*count, false);
            vec![DesktopNotice { thread_id: None, title, body }]
        }
        NotificationDelivery::Items { items } => items
            .iter()
            .map(|item| {
                let (title, body) = describe_item(item);
                DesktopNotice {
                    thread_id: Some(item.thread_id.clone()),
                    title,
                    body,
                }
            })
            .collect(),
    }
}

/// Maps an API subject URL such as `.../repos/o/r/issues/12` to the item it names.
pub fn parse_target(url: Option<&str>) -> Option<NotificationTarget> {
    let url = url?;
    let parsed = url::Url::parse(url).ok()?;
    let path = parsed.path();
    let idx = path.find("/repos/")?;
    let parts: Vec<&str> = path[idx + "/repos/".len()..].split('/').collect();
    if parts.len() != 4 {
        return None;
    }
    let kind = match parts[2] {
        "issues" => "issue",
        "pulls" => "pull",
        _ => return None,
    };
    let number: u64 = parts[3].parse().ok()?;
    Some(NotificationTarget {
        kind: kind.into(),
        repo_full_name: format!("{}/{}", parts[0], parts[1]),
        number,
    })
}

#[derive(Default)]
struct PollState {
    session_id: Option<u64>,
    /// Thread id plus updated_at for every notification already seen in this session.
    seen: HashSet<String>,
    baselined: bool,
}

pub struct NotificationService {
    state: Mutex<PollState>,
}

impl NotificationService {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(PollState::default()),
        }
    }

    pub async fn poll(&self, ctx: &Ctx) -> Result<NotificationPoll, ApiError> {
        let (login, session_id) = ctx
            .signed_in()
            .map_err(|_| ApiError::msg("Sign in to GitHub to receive notifications."))?;
        {
            let mut state = self.state.lock().expect("notification state poisoned");
            if state.session_id != Some(session_id) {
                // A different account starts a new session, so its first poll is quiet again.
                *state = PollState {
                    session_id: Some(session_id),
                    ..PollState::default()
                };
            }
        }
        let session = ctx.session().await?;
        let result = ctx
            .client
            .get_with_meta("/notifications?participating=false", &session.token, &session.scope, None)
            .await?;

        // The account may have changed while GitHub answered. That answer belongs to the old session.
        match ctx.signed_in() {
            Ok((_, now)) if now == session_id => {}
            _ => {
                return Ok(NotificationPoll {
                    poll_interval_ms: result.poll_interval_ms,
                    delivery: None,
                })
            }
        }
        let list = result
            .data
            .as_array()
            .ok_or_else(|| ApiError::msg("GitHub returned an invalid notification list."))?;

        let lower_login = login.to_lowercase();
        let mine: Vec<&serde_json::Value> = list
            .iter()
            .filter(|thread| {
                thread
                    .get("repository")
                    .and_then(|r| r.get("owner"))
                    .and_then(|o| s(o, "login"))
                    .map(|l| l.to_lowercase() == lower_login)
                    .unwrap_or(false)
            })
            .collect();

        let mut state = self.state.lock().expect("notification state poisoned");
        let fresh: Vec<&serde_json::Value> = mine
            .iter()
            .copied()
            .filter(|t| !state.seen.contains(&dedupe_key(t)))
            .collect();
        for thread in &mine {
            state.seen.insert(dedupe_key(thread));
        }

        let poll_interval_ms = result.poll_interval_ms;
        if !state.baselined {
            state.baselined = true;
            let delivery = if mine.is_empty() {
                None
            } else {
                Some(NotificationDelivery::Summary {
                    count: mine.len(),
                    desktop: false,
                })
            };
            return Ok(NotificationPoll { poll_interval_ms, delivery });
        }
        if fresh.is_empty() {
            return Ok(NotificationPoll {
                poll_interval_ms,
                delivery: None,
            });
        }
        if fresh.len() > CATCH_UP_LIMIT {
            return Ok(NotificationPoll {
                poll_interval_ms,
                delivery: Some(NotificationDelivery::Summary {
                    count: fresh.len(),
                    desktop: true,
                }),
            });
        }
        Ok(NotificationPoll {
            poll_interval_ms,
            delivery: Some(NotificationDelivery::Items {
                items: fresh.into_iter().filter_map(to_item).collect(),
            }),
        })
    }

    /// Marks one thread read on GitHub. A failure is returned, so the caller keeps the thread unread and reports it.
    pub async fn mark_read(&self, ctx: &Ctx, thread_id: &str) -> Result<(), ApiError> {
        ctx.signed_in()
            .map_err(|_| ApiError::msg("Sign in to GitHub to update notifications."))?;
        let session = ctx.session().await?;
        ctx.client
            .send(
                reqwest::Method::PATCH,
                &format!("/notifications/threads/{}", crate::github::util::enc(thread_id)),
                &session.token,
                super::client::WriteOptions::default(),
            )
            .await?;
        Ok(())
    }
}

fn dedupe_key(thread: &serde_json::Value) -> String {
    format!(
        "{}\u{0}{}",
        s(thread, "id").unwrap_or_default(),
        s(thread, "updated_at").unwrap_or_default()
    )
}

fn to_item(thread: &serde_json::Value) -> Option<NotificationItem> {
    let subject = thread.get("subject")?;
    Some(NotificationItem {
        thread_id: s(thread, "id")?,
        repo_full_name: thread.get("repository").and_then(|r| s(r, "full_name"))?,
        title: s(subject, "title")?,
        reason: s(thread, "reason")?,
        subject_type: s(subject, "type")?,
        updated_at: s(thread, "updated_at")?,
        target: parse_target(s(subject, "url").as_deref()),
    })
}

/// Keeps the items the user can still open, in memory. Turns mark-read failures into a reportable result.
pub struct NotificationCenter {
    items: Mutex<HashMap<String, NotificationItem>>,
    order: Mutex<Vec<String>>,
    remember_limit: usize,
}

impl NotificationCenter {
    pub fn new() -> Self {
        Self {
            items: Mutex::new(HashMap::new()),
            order: Mutex::new(Vec::new()),
            remember_limit: DEFAULT_REMEMBER_LIMIT,
        }
    }

    pub fn remember(&self, item: &NotificationItem) {
        let mut items = self.items.lock().expect("items poisoned");
        let mut order = self.order.lock().expect("order poisoned");
        order.retain(|id| id != &item.thread_id);
        order.push(item.thread_id.clone());
        items.insert(item.thread_id.clone(), item.clone());
        while order.len() > self.remember_limit {
            let oldest = order.remove(0);
            items.remove(&oldest);
        }
    }

    pub fn target_of(&self, thread_id: &str) -> Option<Option<NotificationTarget>> {
        self.items
            .lock()
            .expect("items poisoned")
            .get(thread_id)
            .map(|item| item.target.clone())
    }

    /// Marks the thread read and returns where it leads. A mark-read failure does not block navigation.
    pub async fn open(&self, service: &NotificationService, ctx: &Ctx, thread_id: &str) -> NotificationOpenResult {
        let Some(target) = self.target_of(thread_id) else {
            return NotificationOpenResult {
                target: None,
                mark_read_error: None,
            };
        };
        match service.mark_read(ctx, thread_id).await {
            Ok(()) => NotificationOpenResult {
                target,
                mark_read_error: None,
            },
            Err(error) => NotificationOpenResult {
                target,
                mark_read_error: Some(error.to_string()),
            },
        }
    }
}

/// Ids accepted for a notification thread: short non-empty strings.
pub fn parse_thread_id(input: &str) -> Result<String, String> {
    if input.is_empty() || input.len() > 64 {
        return Err("Invalid notification thread.".into());
    }
    Ok(input.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subject_urls_map_to_items() {
        let target = parse_target(Some("https://api.github.com/repos/octo/hello/pulls/12")).unwrap();
        assert_eq!(target.kind, "pull");
        assert_eq!(target.number, 12);
        assert!(parse_target(Some("https://api.github.com/repos/octo/hello/releases/1")).is_none());
        assert!(parse_target(None).is_none());
    }

    #[test]
    fn focused_windows_get_no_desktop_notices() {
        let delivery = NotificationDelivery::Summary { count: 5, desktop: true };
        assert!(desktop_notices(&delivery, true).is_empty());
        assert_eq!(desktop_notices(&delivery, false).len(), 1);
        let quiet = NotificationDelivery::Summary { count: 5, desktop: false };
        assert!(desktop_notices(&quiet, false).is_empty());
    }
}
