//! GitHub OAuth device flow and token refresh. Plain HTTP against the configured endpoints.

use serde_json::Value;
use thiserror::Error;

/// Orbit's own OAuth App (public client ID; device flow needs no secret).
pub const ORBIT_CLIENT_ID: &str = "Ov23liaksIKemjW5EXuD";
pub const ORBIT_SCOPES: &str = "repo project workflow offline_access";
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";

#[derive(Debug, Error)]
pub enum OAuthError {
    /// Network or server failure; the existing session may still be valid.
    #[error("{0}")]
    Transient(String),
    /// The refresh token was rejected; the user must sign in again.
    #[error("GitHub rejected the refresh token ({0})")]
    RefreshRejected(String),
}

#[derive(Debug, Clone)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    /// Seconds until the device code expires.
    pub expires_in: u64,
    /// Minimum seconds between polls.
    pub interval: u64,
}

#[derive(Debug, Clone)]
pub struct TokenSet {
    pub access_token: String,
    pub refresh_token: String,
    pub access_expires_in: u64,
    pub refresh_expires_in: u64,
}

#[derive(Debug)]
pub enum PollResult {
    Pending,
    SlowDown { interval: Option<u64> },
    Expired,
    Denied,
    Tokens(TokenSet),
}

pub struct OAuthClient {
    base_url: String,
    http: reqwest::Client,
}

impl OAuthClient {
    pub fn new(base_url: &str, http: reqwest::Client) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http,
        }
    }

    async fn post_form(&self, path: &str, params: &[(&str, &str)]) -> Result<Value, OAuthError> {
        let response = self
            .http
            .post(format!("{}{}", self.base_url, path))
            .header("accept", "application/json")
            .form(params)
            .send()
            .await
            .map_err(|_| OAuthError::Transient("Could not reach GitHub".into()))?;
        let status = response.status();
        if status.is_server_error() {
            return Err(OAuthError::Transient(format!("GitHub returned {}", status.as_u16())));
        }
        response
            .json::<Value>()
            .await
            .map_err(|_| OAuthError::Transient("GitHub sent an unreadable response".into()))
    }

    pub async fn request_device_code(&self) -> Result<DeviceCode, OAuthError> {
        let json = self
            .post_form(
                "/login/device/code",
                &[("client_id", ORBIT_CLIENT_ID), ("scope", ORBIT_SCOPES)],
            )
            .await?;
        if let Some(error) = json.get("error").and_then(Value::as_str) {
            return Err(OAuthError::Transient(format!("Could not start sign-in ({error})")));
        }
        Ok(DeviceCode {
            device_code: str_field(&json, "device_code"),
            user_code: str_field(&json, "user_code"),
            verification_uri: str_field(&json, "verification_uri"),
            expires_in: json.get("expires_in").and_then(Value::as_u64).unwrap_or(900),
            interval: json.get("interval").and_then(Value::as_u64).unwrap_or(5),
        })
    }

    pub async fn poll_device_token(&self, device_code: &str) -> Result<PollResult, OAuthError> {
        let json = self
            .post_form(
                "/login/oauth/access_token",
                &[
                    ("client_id", ORBIT_CLIENT_ID),
                    ("device_code", device_code),
                    ("grant_type", DEVICE_GRANT),
                ],
            )
            .await?;
        match json.get("error").and_then(Value::as_str) {
            None => Ok(PollResult::Tokens(to_token_set(&json))),
            Some("authorization_pending") => Ok(PollResult::Pending),
            Some("slow_down") => Ok(PollResult::SlowDown {
                interval: json.get("interval").and_then(Value::as_u64),
            }),
            Some("expired_token") => Ok(PollResult::Expired),
            Some("access_denied") => Ok(PollResult::Denied),
            Some(other) => Err(OAuthError::Transient(format!("Sign-in failed ({other})"))),
        }
    }

    pub async fn refresh_tokens(&self, refresh_token: &str) -> Result<TokenSet, OAuthError> {
        let json = self
            .post_form(
                "/login/oauth/access_token",
                &[
                    ("client_id", ORBIT_CLIENT_ID),
                    ("grant_type", "refresh_token"),
                    ("refresh_token", refresh_token),
                ],
            )
            .await?;
        if let Some(error) = json.get("error").and_then(Value::as_str) {
            return Err(OAuthError::RefreshRejected(error.to_string()));
        }
        Ok(to_token_set(&json))
    }
}

fn str_field(json: &Value, key: &str) -> String {
    json.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn to_token_set(json: &Value) -> TokenSet {
    TokenSet {
        access_token: str_field(json, "access_token"),
        refresh_token: str_field(json, "refresh_token"),
        access_expires_in: json.get("expires_in").and_then(Value::as_u64).unwrap_or(0),
        refresh_expires_in: json
            .get("refresh_token_expires_in")
            .and_then(Value::as_u64)
            .unwrap_or(0),
    }
}
