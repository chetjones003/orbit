//! Runs GitHub writes safely. A write whose outcome is uncertain (the request may or may not have reached GitHub)
//! is checked against GitHub before any retry, so the same edit is never applied twice. Writes refused outright
//! by GitHub are not retried.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};

use super::client::GitHubError;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    Msg(String),
    #[error("{0}")]
    GitHub(#[from] GitHubError),
    #[error("{0}")]
    Auth(#[from] crate::auth::AuthError),
    #[error("Changes are paused until GitHub is reachable again.")]
    WriteBlocked,
}

impl ApiError {
    pub fn msg(text: impl Into<String>) -> Self {
        ApiError::Msg(text.into())
    }

    /// An uncertain outcome: the request may have landed. Only these are reconciled before a retry.
    pub fn is_transient(&self) -> bool {
        matches!(self, ApiError::GitHub(e) if e.is_transient())
    }

    /// GitHub refused the request outright (HTTP error or rate limit), so nothing was written.
    pub fn is_definitive(&self) -> bool {
        matches!(self, ApiError::GitHub(GitHubError::Http(_)) | ApiError::GitHub(GitHubError::RateLimited { .. }))
    }

    pub fn status(&self) -> Option<u16> {
        match self {
            ApiError::GitHub(GitHubError::Http(s)) => Some(*s),
            ApiError::GitHub(GitHubError::RateLimited { status, .. }) => Some(*status),
            _ => None,
        }
    }
}

pub enum Reconciled<T> {
    Applied(T),
    NotApplied,
}

/// What a write that may have landed needs to remember between calls. Each variant belongs to one write kind.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UncertainState {
    /// Comment writes: the comment ids that already existed before the first attempt.
    ExistingIds(Vec<u64>),
    /// Review submit: reviews the user had before the first attempt, and the pending review sent for, if any.
    Submit { baseline: Vec<String>, pending: Option<String> },
    /// Nothing to remember. Used when only the reconcile read matters.
    Empty,
}

pub struct WriteCoordinator {
    uncertain: Mutex<HashMap<String, UncertainState>>,
    can_write: Arc<dyn Fn() -> bool + Send + Sync>,
}

impl WriteCoordinator {
    pub fn new(can_write: Arc<dyn Fn() -> bool + Send + Sync>) -> Self {
        Self {
            uncertain: Mutex::new(HashMap::new()),
            can_write,
        }
    }

    pub fn assert_can_write(&self) -> Result<(), ApiError> {
        if (self.can_write)() {
            Ok(())
        } else {
            Err(ApiError::WriteBlocked)
        }
    }

    /// Runs a write once, retrying only when the outcome was uncertain and reconcile says it did not land.
    pub async fn run<T, FA, FutA, FR, FutR>(&self, attempt: FA, reconcile: FR) -> Result<T, ApiError>
    where
        FA: Fn() -> FutA,
        FutA: Future<Output = Result<T, ApiError>>,
        FR: Fn() -> FutR,
        FutR: Future<Output = Result<Reconciled<T>, ApiError>>,
    {
        self.assert_can_write()?;
        let max_attempts = 3;
        let mut last_error: Option<ApiError> = None;
        for _ in 0..max_attempts {
            match attempt().await {
                Ok(value) => return Ok(value),
                Err(error) if error.is_transient() => {
                    last_error = Some(error);
                    if let Reconciled::Applied(value) = reconcile().await? {
                        return Ok(value);
                    }
                }
                Err(error) => return Err(error),
            }
        }
        Err(last_error.unwrap_or_else(|| ApiError::msg("The write did not complete.")))
    }

    /// Runs a write keyed by what it does. If an earlier attempt of the same write ended uncertain, its state is
    /// kept, and the next call reconciles against GitHub before any new attempt. The write is never repeated
    /// because a response was lost.
    pub async fn keyed<T, FA, FutA, FR, FutR>(
        &self,
        key: String,
        initial: UncertainState,
        attempt: FA,
        reconcile: FR,
    ) -> Result<T, ApiError>
    where
        FA: Fn(Arc<Mutex<UncertainState>>) -> FutA,
        FutA: Future<Output = Result<T, ApiError>>,
        FR: Fn(Arc<Mutex<UncertainState>>) -> FutR,
        FutR: Future<Output = Result<Reconciled<T>, ApiError>>,
    {
        let (ctx, retrying) = {
            let mut map = self.uncertain.lock().expect("uncertain poisoned");
            let retrying = map.contains_key(&key);
            let state = map.get(&key).cloned().unwrap_or(initial);
            map.insert(key.clone(), state.clone());
            (Arc::new(Mutex::new(state)), retrying)
        };

        let result: Result<T, ApiError> = async {
            if retrying {
                if let Reconciled::Applied(value) = reconcile(ctx.clone()).await? {
                    return Ok(value);
                }
            }
            self.run(|| attempt(ctx.clone()), || reconcile(ctx.clone())).await
        }
        .await;

        let mut map = self.uncertain.lock().expect("uncertain poisoned");
        match &result {
            Ok(_) => {
                map.remove(&key);
            }
            Err(error) if error.is_definitive() || matches!(error, ApiError::WriteBlocked) => {
                map.remove(&key);
            }
            // The outcome is unknown: keep what we know so the next call reconciles instead of writing twice.
            Err(_) => {
                let state = ctx.lock().expect("state poisoned").clone();
                map.insert(key, state);
            }
        }
        result
    }
}
