//! Keeps visible data current while the app runs. Automatic refreshes run every minute, slow down when GitHub asks,
//! back off on transient failures, and wait for a rate-limit reset. Manual refreshes respect the same limits.
//! Ported from `refresh-engine.ts`.

use serde::Serialize;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::task::JoinHandle;

use super::client::GitHubError;
use super::write::ApiError;

const MINUTE_MS: u64 = 60_000;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectionState {
    Idle,
    Fresh,
    Stale,
    Offline,
    RateLimited,
}

/// Timing and state only. Safe to send to the renderer and to log.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pub state: ConnectionState,
    /// Epoch ms of the last successful refresh.
    pub last_success_at: Option<i64>,
    /// Epoch ms of the next automatic attempt, when known.
    pub next_retry_at: Option<i64>,
}

/// Result of asking for a refresh. `started: false` says why it did not run.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RefreshStart {
    pub started: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_at: Option<i64>,
}

impl RefreshStart {
    fn started() -> Self {
        Self {
            started: true,
            reason: None,
            retry_at: None,
        }
    }
    fn refused(reason: &'static str, retry_at: Option<i64>) -> Self {
        Self {
            started: false,
            reason: Some(reason),
            retry_at,
        }
    }
}

/// Writes are refused while GitHub is unreachable or rate limiting, so outcomes stay certain.
pub fn writes_allowed(status: &ConnectionStatus) -> bool {
    !matches!(status.state, ConnectionState::Offline | ConnectionState::RateLimited)
}

pub type RefreshFuture = Pin<Box<dyn Future<Output = Result<Option<u64>, ApiError>> + Send>>;
pub type RefreshFn = Arc<dyn Fn() -> RefreshFuture + Send + Sync>;
pub type GuardFn = Arc<dyn Fn() -> bool + Send + Sync>;
pub type ChangeListener = Arc<dyn Fn(ConnectionStatus) + Send + Sync>;

struct Inner {
    status: ConnectionStatus,
    in_flight: bool,
    running: bool,
    /// Bumped by stop() so a refresh started before it is discarded.
    generation: u64,
    consecutive_failures: u32,
    last_manual_at: Option<i64>,
    timer: Option<JoinHandle<()>>,
}

pub struct RefreshEngine {
    inner: Mutex<Inner>,
    refresh: RefreshFn,
    can_refresh: GuardFn,
    listener: ChangeListener,
    max_backoff_ms: u64,
    manual_cooldown_ms: u64,
}

/// How often the connection is checked, in milliseconds. Set from the Polling setting; one minute by default.
pub static POLL_INTERVAL_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(MINUTE_MS);

/// The polling choices the Settings screen offers, in minutes.
pub const POLL_CHOICES_MINUTES: &[u64] = &[1, 2, 5, 10, 15];

/// Sets the polling interval from a minute count. Anything not offered falls back to one minute.
pub fn set_poll_interval_minutes(minutes: u64) {
    let chosen = if POLL_CHOICES_MINUTES.contains(&minutes) { minutes } else { 1 };
    POLL_INTERVAL_MS.store(chosen * MINUTE_MS, std::sync::atomic::Ordering::Relaxed);
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

impl RefreshEngine {
    pub fn new(refresh: RefreshFn, can_refresh: GuardFn, listener: ChangeListener) -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(Inner {
                status: ConnectionStatus {
                    state: ConnectionState::Idle,
                    last_success_at: None,
                    next_retry_at: None,
                },
                in_flight: false,
                running: false,
                generation: 0,
                consecutive_failures: 0,
                last_manual_at: None,
                timer: None,
            }),
            refresh,
            can_refresh,
            listener,
            max_backoff_ms: 5 * MINUTE_MS,
            manual_cooldown_ms: 30_000,
        })
    }

    fn interval(&self) -> u64 {
        POLL_INTERVAL_MS.load(std::sync::atomic::Ordering::Relaxed)
    }

    pub fn status(&self) -> ConnectionStatus {
        self.inner.lock().expect("refresh state poisoned").status
    }

    pub fn start(self: &Arc<Self>) {
        {
            let mut inner = self.inner.lock().expect("refresh state poisoned");
            if inner.running {
                return;
            }
            inner.running = true;
        }
        let in_flight = self.inner.lock().expect("refresh state poisoned").in_flight;
        if !in_flight {
            self.begin();
        }
    }

    pub fn stop(&self) {
        let mut inner = self.inner.lock().expect("refresh state poisoned");
        inner.running = false;
        inner.generation += 1;
        if let Some(timer) = inner.timer.take() {
            timer.abort();
        }
    }

    /// Runs a refresh now unless the limits in force forbid it.
    pub async fn refresh_now(self: &Arc<Self>) -> RefreshStart {
        if !(self.can_refresh)() {
            return RefreshStart::refused("signed-out", None);
        }
        let now = now_ms();
        let handle = {
            let mut inner = self.inner.lock().expect("refresh state poisoned");
            if inner.in_flight {
                return RefreshStart::refused("in-flight", None);
            }
            if let Some(retry) = rate_limit_until(&inner.status, now) {
                return RefreshStart::refused("rate-limited", Some(retry));
            }
            if let Some(last) = inner.last_manual_at {
                if now - last < self.manual_cooldown_ms as i64 {
                    return RefreshStart::refused("cooldown", Some(last + self.manual_cooldown_ms as i64));
                }
            }
            inner.last_manual_at = Some(now);
            if let Some(timer) = inner.timer.take() {
                timer.abort();
            }
            self.begin_locked(&mut inner)
        };
        if let Some(handle) = handle {
            let _ = handle.await;
        }
        RefreshStart::started()
    }

    /// Retries now after a suspected outage. Ignores backoff and the manual cooldown, but still honours rate limits,
    /// in-flight refreshes, and sign-out.
    pub async fn wake(self: &Arc<Self>) -> RefreshStart {
        if !(self.can_refresh)() {
            return RefreshStart::refused("signed-out", None);
        }
        let now = now_ms();
        let handle = {
            let mut inner = self.inner.lock().expect("refresh state poisoned");
            if inner.in_flight {
                return RefreshStart::refused("in-flight", None);
            }
            if let Some(retry) = rate_limit_until(&inner.status, now) {
                return RefreshStart::refused("rate-limited", Some(retry));
            }
            if let Some(timer) = inner.timer.take() {
                timer.abort();
            }
            self.begin_locked(&mut inner)
        };
        if let Some(handle) = handle {
            let _ = handle.await;
        }
        RefreshStart::started()
    }

    fn begin(self: &Arc<Self>) {
        let mut inner = self.inner.lock().expect("refresh state poisoned");
        self.begin_locked(&mut inner);
    }

    fn begin_locked(self: &Arc<Self>, inner: &mut Inner) -> Option<JoinHandle<()>> {
        if inner.in_flight {
            return None;
        }
        inner.in_flight = true;
        let generation = inner.generation;
        let this = Arc::clone(self);
        Some(tokio::spawn(async move {
            let outcome = (this.refresh)().await;
            this.finish(generation, outcome);
        }))
    }

    fn finish(self: &Arc<Self>, generation: u64, outcome: Result<Option<u64>, ApiError>) {
        let mut inner = self.inner.lock().expect("refresh state poisoned");
        inner.in_flight = false;
        if generation != inner.generation {
            // The engine was stopped (and maybe restarted) while this refresh ran. Its result is dropped.
            if inner.running {
                self.schedule_locked(&mut inner, 0);
            }
            return;
        }
        let now = now_ms();
        match outcome {
            Ok(poll_interval_ms) => {
                inner.consecutive_failures = 0;
                let delay = self.interval().max(poll_interval_ms.unwrap_or(0));
                self.set_state_locked(&mut inner, ConnectionState::Fresh, now + delay as i64, Some(now));
                self.schedule_locked(&mut inner, delay);
            }
            Err(ApiError::GitHub(GitHubError::RateLimited { reset_at, retry_after_ms, .. })) => {
                let reset = reset_at
                    .or(retry_after_ms.map(|ms| now + ms))
                    .unwrap_or(now + self.interval() as i64);
                // A reset time in the past must not produce a zero-delay retry loop.
                let retry_at = reset.max(now + self.interval() as i64);
                self.set_state_locked(&mut inner, ConnectionState::RateLimited, retry_at, None);
                self.schedule_locked(&mut inner, (retry_at - now).max(0) as u64);
            }
            Err(ApiError::GitHub(e)) if e.is_transient() => {
                inner.consecutive_failures += 1;
                let exponent = inner.consecutive_failures.saturating_sub(1).min(20);
                let delay = (self.interval().saturating_mul(1u64 << exponent)).min(self.max_backoff_ms);
                self.set_state_locked(&mut inner, ConnectionState::Offline, now + delay as i64, None);
                self.schedule_locked(&mut inner, delay);
            }
            Err(_) => {
                self.set_state_locked(&mut inner, ConnectionState::Stale, now + self.interval() as i64, None);
                self.schedule_locked(&mut inner, self.interval());
            }
        }
    }

    fn schedule_locked(self: &Arc<Self>, inner: &mut Inner, delay_ms: u64) {
        if !inner.running {
            return;
        }
        if let Some(timer) = inner.timer.take() {
            timer.abort();
        }
        let this = Arc::clone(self);
        inner.timer = Some(tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            {
                let mut inner = this.inner.lock().expect("refresh state poisoned");
                inner.timer = None;
            }
            this.begin();
        }));
    }

    /// Keeps lastSuccessAt across failures; a successful refresh passes its own time.
    fn set_state_locked(&self, inner: &mut Inner, state: ConnectionState, next_retry_at: i64, success_at: Option<i64>) {
        let last_success_at = success_at.or(inner.status.last_success_at);
        inner.status = ConnectionStatus {
            state,
            last_success_at,
            next_retry_at: Some(next_retry_at),
        };
        (self.listener)(inner.status);
    }
}

/// The time a rate limit lifts, when GitHub has asked Orbit to wait and that time is still ahead.
fn rate_limit_until(status: &ConnectionStatus, now: i64) -> Option<i64> {
    match (status.state, status.next_retry_at) {
        (ConnectionState::RateLimited, Some(at)) if now < at => Some(at),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offline_and_rate_limited_block_writes() {
        let mut status = ConnectionStatus {
            state: ConnectionState::Offline,
            last_success_at: None,
            next_retry_at: None,
        };
        assert!(!writes_allowed(&status));
        status.state = ConnectionState::Fresh;
        assert!(writes_allowed(&status));
    }

    #[test]
    fn rate_limit_only_applies_before_its_reset() {
        let status = ConnectionStatus {
            state: ConnectionState::RateLimited,
            last_success_at: None,
            next_retry_at: Some(1_000),
        };
        assert_eq!(rate_limit_until(&status, 500), Some(1_000));
        assert_eq!(rate_limit_until(&status, 1_500), None);
    }
}
