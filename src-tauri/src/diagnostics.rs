//! Bounded, rotating, redacted local diagnostics. The file lives beside the settings in app data and is never uploaded.
//! Entries describe what happened, not GitHub content or editor text. Ported from `diagnostics.ts`.

use regex_lite::Regex;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use tokio::io::AsyncWriteExt;

const MAX_ENTRIES: usize = 500;
const MAX_FILE_BYTES: u64 = 512 * 1024;

static TOKEN_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"github_pat_[A-Za-z0-9_]+",
        r"gh[pousr]_[A-Za-z0-9_]+",
        r"(?i)Bearer\s+\S+",
        r"(?i)(?:access_token|refresh_token|client_secret)=\S+",
    ]
    .iter()
    .map(|p| Regex::new(p).expect("valid redaction pattern"))
    .collect()
});

/// Removes anything that looks like a credential. Over-redaction is acceptable.
pub fn redact(text: &str) -> String {
    let mut result = text.to_string();
    for pattern in TOKEN_PATTERNS.iter() {
        result = pattern.replace_all(&result, "[redacted]").into_owned();
    }
    result
}

pub struct Diagnostics {
    dir: PathBuf,
    entries: Mutex<VecDeque<String>>,
}

impl Diagnostics {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            entries: Mutex::new(VecDeque::new()),
        }
    }

    /// Records one entry. `scope` and `code` are short identifiers; `message` is redacted before it is kept.
    pub async fn record(&self, level: &str, scope: &str, code: &str, message: &str) {
        let line = format!(
            "{} {} {} {} {}",
            chrono::Utc::now().to_rfc3339(),
            level.to_uppercase(),
            scope,
            code,
            redact(message)
        );
        {
            let mut entries = self.entries.lock().expect("diagnostics poisoned");
            entries.push_back(line.clone());
            while entries.len() > MAX_ENTRIES {
                entries.pop_front();
            }
        }
        let _ = self.append(&line).await;
    }

    /// Text for "Copy diagnostics", built from the redacted in-memory entries only.
    pub fn report(&self) -> String {
        self.entries
            .lock()
            .expect("diagnostics poisoned")
            .iter()
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    }

    async fn append(&self, line: &str) -> std::io::Result<()> {
        tokio::fs::create_dir_all(&self.dir).await?;
        let file = self.dir.join("diagnostics.log");
        let size = tokio::fs::metadata(&file).await.map(|m| m.len()).unwrap_or(0);
        if size + line.len() as u64 + 1 > MAX_FILE_BYTES && size > 0 {
            tokio::fs::rename(&file, self.dir.join("diagnostics.1.log")).await?;
        }
        let mut handle = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file)
            .await?;
        handle.write_all(format!("{line}\n").as_bytes()).await
    }
}

/// Renderer-reported diagnostics carry only a scope and a short code. Anything else is rejected.
pub fn validate_renderer_code(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 40
        && bytes[0].is_ascii_lowercase()
        && bytes.iter().all(|c| c.is_ascii_lowercase() || *c == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_are_redacted() {
        assert_eq!(redact("token ghp_abc123 ok"), "token [redacted] ok");
        assert_eq!(redact("Bearer xyz"), "[redacted]");
        assert_eq!(redact("access_token=secret"), "[redacted]");
    }

    #[test]
    fn renderer_codes_are_short_words() {
        assert!(validate_renderer_code("rate-limited"));
        assert!(!validate_renderer_code("Has Spaces"));
        assert!(!validate_renderer_code(""));
    }
}
