//! Owns GitHub credentials in the backend. The renderer only ever sees `AuthStatus`, which holds no token.
//! Refresh is single-flight, and store writes are queued so a late write cannot resurrect credentials after
//! sign-out.

use crate::credentials::{CredentialStore, StoredCredentials};
use crate::oauth::{OAuthClient, OAuthError, PollResult, TokenSet};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use thiserror::Error;
use tokio::sync::Mutex as AsyncMutex;

/// Sign-in status as the renderer sees it. Deliberately holds no token material. `session_id` changes whenever the
/// signed-in account changes, so the renderer can drop in-memory work that belongs to a previous session.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum AuthStatus {
    SignedOut {
        #[serde(skip_serializing_if = "Option::is_none")]
        notice: Option<String>,
    },
    DevicePending {
        user_code: String,
        verification_uri: String,
        /// Epoch milliseconds when the code stops working.
        expires_at: i64,
    },
    SignedIn {
        session_id: u64,
        login: String,
        /// False when credentials could not be saved; sign-in ends when Orbit quits.
        persistent: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        notice: Option<String>,
    },
    ReauthRequired {
        session_id: u64,
        login: String,
        notice: String,
    },
}

const REFRESH_MARGIN_MS: i64 = 60_000;
const NOT_PERSISTED_NOTICE: &str = "Sign-in will not survive quitting Orbit: credentials could not be saved.";
const REAUTH_NOTICE: &str = "Your GitHub sign-in has expired. Sign in again to continue.";
const EXPIRED_NOTICE: &str = "The sign-in code expired. Start sign-in again.";

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("Not signed in to GitHub")]
    NotSignedIn,
    #[error("GitHub sign-in for {0} must be renewed")]
    ReauthRequired(String),
    #[error("{0}")]
    Transient(String),
}

#[derive(Clone)]
struct Session {
    session_id: u64,
    login: String,
    access_token: String,
    refresh_token: String,
    access_expires_at: i64,
    refresh_expires_at: i64,
    persistent: bool,
    needs_reauth: bool,
}

#[derive(Default)]
struct Inner {
    status: Option<AuthStatus>,
    session: Option<Session>,
    session_seq: u64,
    /// Bumped to cancel the active device flow. A flow applies results only while it is current.
    flow_id: u64,
}

pub type StatusListener = Arc<dyn Fn(AuthStatus) + Send + Sync>;

pub struct AuthService {
    inner: Mutex<Inner>,
    refresh_lock: AsyncMutex<()>,
    store_lock: AsyncMutex<()>,
    store: Arc<CredentialStore>,
    oauth: OAuthClient,
    http: reqwest::Client,
    api_base_url: String,
    on_change: StatusListener,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

impl AuthService {
    pub fn new(
        store: Arc<CredentialStore>,
        oauth_base_url: &str,
        api_base_url: &str,
        http: reqwest::Client,
        on_change: StatusListener,
    ) -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(Inner::default()),
            refresh_lock: AsyncMutex::new(()),
            store_lock: AsyncMutex::new(()),
            store,
            oauth: OAuthClient::new(oauth_base_url, http.clone()),
            http,
            api_base_url: api_base_url.trim_end_matches('/').to_string(),
            on_change,
        })
    }

    pub fn status(&self) -> AuthStatus {
        let inner = self.inner.lock().expect("auth state poisoned");
        inner.status.clone().unwrap_or(AuthStatus::SignedOut { notice: None })
    }

    fn set_status(&self, next: AuthStatus) {
        {
            let mut inner = self.inner.lock().expect("auth state poisoned");
            inner.status = Some(next.clone());
        }
        (self.on_change)(next);
    }

    /// Restores a stored session without contacting GitHub. Unreadable data is discarded.
    pub async fn initialize(&self) {
        match self.store.load().await {
            Ok(Some(creds)) => {
                let session = {
                    let mut inner = self.inner.lock().expect("auth state poisoned");
                    inner.session_seq += 1;
                    let session = session_from(&creds, inner.session_seq, true);
                    inner.session = Some(session.clone());
                    session
                };
                self.set_status(signed_in_status(&session));
            }
            Ok(None) => {}
            Err(_) => {
                let _ = self.store.clear().await;
                self.set_status(AuthStatus::SignedOut {
                    notice: Some("Stored sign-in could not be read. Sign in again to continue.".into()),
                });
            }
        }
    }

    /// Starts the device flow. Resolves with the pending status; the outcome arrives as status changes.
    pub async fn start_sign_in(self: &Arc<Self>) -> AuthStatus {
        let current = self.status();
        if matches!(current, AuthStatus::DevicePending { .. }) {
            return current;
        }
        let flow = {
            let mut inner = self.inner.lock().expect("auth state poisoned");
            inner.flow_id += 1;
            inner.flow_id
        };
        let code = match self.oauth.request_device_code().await {
            Ok(code) => code,
            Err(_) => {
                self.end_flow(flow, Some("Could not reach GitHub to start sign-in. Try again.".into()));
                return self.status();
            }
        };
        if !self.flow_current(flow) {
            return self.status();
        }
        let expires_at = now_ms() + (code.expires_in as i64) * 1000;
        self.set_status(AuthStatus::DevicePending {
            user_code: code.user_code.clone(),
            verification_uri: code.verification_uri.clone(),
            expires_at,
        });
        let this = Arc::clone(self);
        tokio::spawn(async move {
            this.poll_until_done(flow, code.device_code, code.interval, expires_at).await;
        });
        self.status()
    }

    pub fn cancel_sign_in(&self) -> AuthStatus {
        if !matches!(self.status(), AuthStatus::DevicePending { .. }) {
            return self.status();
        }
        {
            let mut inner = self.inner.lock().expect("auth state poisoned");
            inner.flow_id += 1;
        }
        self.set_status(self.restore_status(None));
        self.status()
    }

    pub async fn sign_out(&self) -> AuthStatus {
        {
            let mut inner = self.inner.lock().expect("auth state poisoned");
            inner.flow_id += 1;
            inner.session = None;
        }
        let notice = {
            let _guard = self.store_lock.lock().await;
            match self.store.clear().await {
                Ok(()) => None,
                Err(_) => Some("Signed out, but stored credentials could not be removed.".to_string()),
            }
        };
        self.set_status(AuthStatus::SignedOut { notice });
        self.status()
    }

    /// Returns a usable access token, refreshing it first if it is close to expiry.
    pub async fn access_token(&self) -> Result<String, AuthError> {
        if let Some(token) = self.fresh_token()? {
            return Ok(token);
        }
        let _refresh = self.refresh_lock.lock().await;
        // Another caller may have refreshed while we waited for the lock.
        if let Some(token) = self.fresh_token()? {
            return Ok(token);
        }
        let session = self.current_session().ok_or(AuthError::NotSignedIn)?;
        match self.oauth.refresh_tokens(&session.refresh_token).await {
            Ok(tokens) => {
                let token = tokens.access_token.clone();
                let applied = self.apply_tokens(session.session_id, &tokens);
                if applied {
                    self.persist(session.session_id).await;
                }
                Ok(token)
            }
            Err(OAuthError::RefreshRejected(_)) => {
                let login = {
                    let mut inner = self.inner.lock().expect("auth state poisoned");
                    match inner.session.as_mut() {
                        Some(s) if s.session_id == session.session_id => {
                            s.needs_reauth = true;
                            Some(s.login.clone())
                        }
                        _ => None,
                    }
                };
                if let Some(login) = login {
                    self.set_status(self.restore_status(None));
                    return Err(AuthError::ReauthRequired(login));
                }
                Err(AuthError::NotSignedIn)
            }
            Err(OAuthError::Transient(message)) => Err(AuthError::Transient(message)),
        }
    }

    /// Returns the access token when it is still fresh. Errors when signed out or when re-auth is required.
    fn fresh_token(&self) -> Result<Option<String>, AuthError> {
        let inner = self.inner.lock().expect("auth state poisoned");
        let session = inner.session.as_ref().ok_or(AuthError::NotSignedIn)?;
        if session.needs_reauth {
            return Err(AuthError::ReauthRequired(session.login.clone()));
        }
        if session.access_expires_at - now_ms() > REFRESH_MARGIN_MS {
            return Ok(Some(session.access_token.clone()));
        }
        Ok(None)
    }

    fn current_session(&self) -> Option<Session> {
        self.inner.lock().expect("auth state poisoned").session.clone()
    }

    fn flow_current(&self, flow: u64) -> bool {
        self.inner.lock().expect("auth state poisoned").flow_id == flow
    }

    async fn poll_until_done(self: Arc<Self>, flow: u64, device_code: String, interval_s: u64, expires_at: i64) {
        let mut interval = interval_s.max(1);
        while self.flow_current(flow) {
            if now_ms() >= expires_at {
                self.end_flow(flow, Some(EXPIRED_NOTICE.into()));
                return;
            }
            tokio::time::sleep(std::time::Duration::from_secs(interval)).await;
            if !self.flow_current(flow) {
                return;
            }
            let result = match self.oauth.poll_device_token(&device_code).await {
                Ok(result) => result,
                Err(OAuthError::Transient(_)) => continue,
                Err(_) => {
                    self.end_flow(flow, Some("Sign-in failed. Try again.".into()));
                    return;
                }
            };
            if !self.flow_current(flow) {
                return;
            }
            match result {
                PollResult::Pending => continue,
                PollResult::SlowDown { interval: next } => {
                    interval = next.unwrap_or(interval + 5);
                }
                PollResult::Expired => {
                    self.end_flow(flow, Some(EXPIRED_NOTICE.into()));
                    return;
                }
                PollResult::Denied => {
                    self.end_flow(flow, Some("Sign-in was denied on GitHub.".into()));
                    return;
                }
                PollResult::Tokens(tokens) => {
                    self.complete_sign_in(flow, tokens).await;
                    return;
                }
            }
        }
    }

    async fn complete_sign_in(&self, flow: u64, tokens: TokenSet) {
        let login = match self.fetch_login(&tokens.access_token).await {
            Ok(login) => login,
            Err(_) => {
                self.end_flow(flow, Some("Could not confirm your GitHub account. Try signing in again.".into()));
                return;
            }
        };
        if !self.flow_current(flow) {
            return;
        }

        let (session, previous_login) = {
            let mut inner = self.inner.lock().expect("auth state poisoned");
            inner.flow_id += 1;
            let previous = inner.session.clone();
            // The same account re-authenticating keeps its session id, so in-memory work survives.
            let session_id = match &previous {
                Some(p) if p.login == login => p.session_id,
                _ => {
                    inner.session_seq += 1;
                    inner.session_seq
                }
            };
            let mut session = Session {
                session_id,
                login: login.clone(),
                access_token: String::new(),
                refresh_token: String::new(),
                access_expires_at: 0,
                refresh_expires_at: 0,
                persistent: false,
                needs_reauth: false,
            };
            apply_to_session(&mut session, &tokens);
            inner.session = Some(session.clone());
            (session, previous.map(|p| p.login).filter(|l| *l != login))
        };

        // A different account replaces the old one on disk, even if the new save fails.
        if previous_login.is_some() {
            let _guard = self.store_lock.lock().await;
            let _ = self.store.clear().await;
        }
        self.persist(session.session_id).await;
        let current = self.current_session().unwrap_or(session);
        self.set_status(signed_in_status(&current));
    }

    async fn fetch_login(&self, access_token: &str) -> Result<String, String> {
        let response = self
            .http
            .get(format!("{}/user", self.api_base_url))
            .bearer_auth(access_token)
            .header("accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("GitHub returned {}", response.status().as_u16()));
        }
        let body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
        body.get("login")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .ok_or_else(|| "GitHub did not return a login".to_string())
    }

    fn end_flow(&self, flow: u64, notice: Option<String>) {
        {
            let mut inner = self.inner.lock().expect("auth state poisoned");
            if inner.flow_id != flow {
                return;
            }
            inner.flow_id += 1;
        }
        self.set_status(self.restore_status(notice));
    }

    /// Writes the current session to disk. Skipped if the session was replaced or signed out meanwhile.
    async fn persist(&self, session_id: u64) {
        let _guard = self.store_lock.lock().await;
        let snapshot = {
            let inner = self.inner.lock().expect("auth state poisoned");
            match &inner.session {
                Some(s) if s.session_id == session_id => s.clone(),
                _ => return,
            }
        };
        let saved = self
            .store
            .save(&StoredCredentials {
                login: snapshot.login.clone(),
                access_token: snapshot.access_token.clone(),
                refresh_token: snapshot.refresh_token.clone(),
                access_expires_at: snapshot.access_expires_at,
                refresh_expires_at: snapshot.refresh_expires_at,
            })
            .await;
        let persistent = saved.is_ok();
        let changed = {
            let mut inner = self.inner.lock().expect("auth state poisoned");
            match inner.session.as_mut() {
                Some(s) if s.session_id == session_id => {
                    let changed = s.persistent != persistent;
                    s.persistent = persistent;
                    changed
                }
                _ => false,
            }
        };
        if changed && matches!(self.status(), AuthStatus::SignedIn { .. }) {
            let current = self.current_session();
            if let Some(s) = current {
                self.set_status(signed_in_status(&s));
            }
        }
    }

    /// Returns false when the session was replaced while the refresh was in flight.
    fn apply_tokens(&self, session_id: u64, tokens: &TokenSet) -> bool {
        let mut inner = self.inner.lock().expect("auth state poisoned");
        match inner.session.as_mut() {
            Some(s) if s.session_id == session_id => {
                apply_to_session(s, tokens);
                true
            }
            _ => false,
        }
    }

    fn restore_status(&self, notice: Option<String>) -> AuthStatus {
        let session = self.current_session();
        let Some(session) = session else {
            return AuthStatus::SignedOut { notice };
        };
        if session.needs_reauth {
            return AuthStatus::ReauthRequired {
                session_id: session.session_id,
                login: session.login,
                notice: notice.unwrap_or_else(|| REAUTH_NOTICE.into()),
            };
        }
        let signed_in = signed_in_status(&session);
        match (signed_in, notice) {
            (AuthStatus::SignedIn { session_id, login, persistent, .. }, Some(notice)) => AuthStatus::SignedIn {
                session_id,
                login,
                persistent,
                notice: Some(notice),
            },
            (status, _) => status,
        }
    }
}

fn session_from(creds: &StoredCredentials, session_id: u64, persistent: bool) -> Session {
    Session {
        session_id,
        login: creds.login.clone(),
        access_token: creds.access_token.clone(),
        refresh_token: creds.refresh_token.clone(),
        access_expires_at: creds.access_expires_at,
        refresh_expires_at: creds.refresh_expires_at,
        persistent,
        needs_reauth: false,
    }
}

fn apply_to_session(session: &mut Session, tokens: &TokenSet) {
    let now = now_ms();
    session.access_token = tokens.access_token.clone();
    session.refresh_token = tokens.refresh_token.clone();
    session.access_expires_at = now + (tokens.access_expires_in as i64) * 1000;
    session.refresh_expires_at = now + (tokens.refresh_expires_in as i64) * 1000;
    session.needs_reauth = false;
}

fn signed_in_status(session: &Session) -> AuthStatus {
    AuthStatus::SignedIn {
        session_id: session.session_id,
        login: session.login.clone(),
        persistent: session.persistent,
        notice: if session.persistent {
            None
        } else {
            Some(NOT_PERSISTED_NOTICE.into())
        },
    }
}
