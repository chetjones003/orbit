//! REST and GraphQL client for GitHub. Keeps an in-memory ETag cache, so unchanged reads cost a conditional
//! request. Nothing is written to disk. Every failure is classed so callers can tell a rate limit from a
//! network drop from a plain HTTP error.

use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use thiserror::Error;

#[derive(Debug, Clone, Error)]
pub enum GitHubError {
    /// GitHub asked Orbit to wait. `reset_at` is epoch ms, `retry_after_ms` is relative.
    #[error("GitHub rate limit reached.")]
    RateLimited {
        status: u16,
        reset_at: Option<i64>,
        retry_after_ms: Option<i64>,
    },
    /// The request may or may not have reached GitHub. Callers must reconcile before retrying a write.
    #[error("{0}")]
    Transient(String),
    #[error("GitHub returned {0}.")]
    Http(u16),
    /// GraphQL answered with errors in a 200 body.
    #[error("{0}")]
    GraphQl(String),
    #[error("GitHub returned an unreadable response.")]
    Decode,
}

impl GitHubError {
    pub fn is_transient(&self) -> bool {
        matches!(self, GitHubError::Transient(_))
    }
    pub fn is_rate_limited(&self) -> bool {
        matches!(self, GitHubError::RateLimited { .. })
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Base {
    Api,
    Uploads,
}

pub struct GitHubResult {
    pub data: Value,
    /// Milliseconds from X-Poll-Interval, when GitHub sent one.
    pub poll_interval_ms: Option<u64>,
}

struct CacheEntry {
    etag: String,
    body: Value,
}

pub struct GitHubClient {
    api_base: String,
    uploads_base: String,
    http: reqwest::Client,
    cache: Mutex<HashMap<String, CacheEntry>>,
}

/// Options for a write. `body` is JSON; `raw` is an attachment upload body with its own content type.
#[derive(Default)]
pub struct WriteOptions<'a> {
    pub body: Option<Value>,
    pub base: Option<Base>,
    pub raw: Option<(Vec<u8>, &'a str)>,
    pub accept: Option<&'a str>,
    /// Return the raw response text as a JSON string, for media types such as rendered HTML.
    pub text: bool,
}

const JSON_ACCEPT: &str = "application/vnd.github+json";

impl GitHubClient {
    pub fn new(api_base: &str, uploads_base: &str, http: reqwest::Client) -> Self {
        Self {
            api_base: api_base.trim_end_matches('/').to_string(),
            uploads_base: uploads_base.trim_end_matches('/').to_string(),
            http,
            cache: Mutex::new(HashMap::new()),
        }
    }

    /// Cached GET. `scope` partitions the cache (the session id), so bodies never cross accounts.
    pub async fn get(&self, path: &str, token: &str, scope: &str) -> Result<Value, GitHubError> {
        Ok(self.get_with_meta(path, token, scope, None).await?.data)
    }

    pub async fn get_with_meta(
        &self,
        path: &str,
        token: &str,
        scope: &str,
        accept: Option<&str>,
    ) -> Result<GitHubResult, GitHubError> {
        let accept = accept.unwrap_or(JSON_ACCEPT);
        let url = format!("{}{}", self.api_base, path);
        let key = format!("{scope}\u{0}{accept}\u{0}{url}");
        let cached = self
            .cache
            .lock()
            .expect("cache poisoned")
            .get(&key)
            .map(|e| (e.etag.clone(), e.body.clone()));

        let mut request = self
            .http
            .get(&url)
            .bearer_auth(token)
            .header("accept", accept);
        if let Some((etag, _)) = &cached {
            request = request.header("if-none-match", etag);
        }
        let response = self.send_checked(request, cached.is_some()).await?;
        let poll_interval_ms = read_seconds(response.headers().get("x-poll-interval"), 1000);

        if response.status().as_u16() == 304 {
            if let Some((_, body)) = cached {
                return Ok(GitHubResult {
                    data: body,
                    poll_interval_ms,
                });
            }
        }

        let etag = response
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let body: Value = response.json().await.map_err(|_| GitHubError::Decode)?;
        if let Some(etag) = etag {
            self.cache.lock().expect("cache poisoned").insert(
                key,
                CacheEntry {
                    etag,
                    body: body.clone(),
                },
            );
        }
        Ok(GitHubResult {
            data: body,
            poll_interval_ms,
        })
    }

    /// Writes are never cached. A transient failure means the request may have reached GitHub.
    pub async fn send(
        &self,
        method: reqwest::Method,
        path: &str,
        token: &str,
        options: WriteOptions<'_>,
    ) -> Result<Value, GitHubError> {
        let root = match options.base.unwrap_or(Base::Api) {
            Base::Api => &self.api_base,
            Base::Uploads => &self.uploads_base,
        };
        let accept = options.accept.unwrap_or(JSON_ACCEPT);
        let mut request = self
            .http
            .request(method, format!("{root}{path}"))
            .bearer_auth(token)
            .header("accept", accept);
        if let Some((bytes, content_type)) = options.raw {
            request = request.header("content-type", content_type).body(bytes);
        } else if let Some(body) = options.body {
            request = request.json(&body);
        }
        let response = self.send_checked(request, false).await?;
        let status = response.status().as_u16();
        // 204 and 205 carry no body. 205 is what marking a notification read returns.
        if status == 204 || status == 205 {
            return Ok(Value::Null);
        }
        if options.text {
            let text = response.text().await.map_err(|_| GitHubError::Decode)?;
            return Ok(Value::String(text));
        }
        response.json().await.map_err(|_| GitHubError::Decode)
    }

    /// Sends one request and maps every failure to a GitHubError. A 304 passes through only when the caller
    /// holds a cached body to reuse.
    async fn send_checked(
        &self,
        request: reqwest::RequestBuilder,
        allow_not_modified: bool,
    ) -> Result<reqwest::Response, GitHubError> {
        let response = request
            .send()
            .await
            .map_err(|_| GitHubError::Transient("GitHub could not be reached.".into()))?;
        let status = response.status().as_u16();
        if allow_not_modified && status == 304 {
            return Ok(response);
        }
        if status == 403 || status == 429 {
            let headers = response.headers().clone();
            let remaining = headers.get("x-ratelimit-remaining").and_then(|v| v.to_str().ok());
            let retry_after_ms = read_seconds(headers.get("retry-after"), 1000);
            let reset_at = read_seconds(headers.get("x-ratelimit-reset"), 1000);
            // Secondary limits can arrive as a bare 403 that names the limit in its message.
            let named = if status == 403 {
                let text = response.text().await.unwrap_or_default();
                if text.to_lowercase().contains("rate limit") {
                    true
                } else {
                    return Err(GitHubError::Http(status));
                }
            } else {
                false
            };
            if remaining == Some("0") || retry_after_ms.is_some() || status == 429 || named {
                return Err(GitHubError::RateLimited {
                    status,
                    reset_at: reset_at.map(|ms| ms as i64),
                    retry_after_ms: retry_after_ms.map(|ms| ms as i64),
                });
            }
            return Err(GitHubError::Http(status));
        }
        if status >= 500 {
            return Err(GitHubError::Transient(format!("GitHub is unavailable ({status}).")));
        }
        if !(200..300).contains(&status) && status != 304 {
            return Err(GitHubError::Http(status));
        }
        Ok(response)
    }
}

fn read_seconds(value: Option<&reqwest::header::HeaderValue>, unit_ms: u64) -> Option<u64> {
    let seconds: f64 = value?.to_str().ok()?.parse().ok()?;
    if seconds.is_finite() && seconds >= 0.0 {
        Some((seconds * unit_ms as f64) as u64)
    } else {
        None
    }
}
