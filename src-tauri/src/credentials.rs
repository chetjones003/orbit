//! Stores the GitHub token pair on disk, encrypted. Windows uses DPAPI (the same protection Electron's
//! safeStorage used). Elsewhere, and if DPAPI fails, an AES-256-GCM key kept beside the file is used.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Token material held in the backend. Never sent to the renderer or logged.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct StoredCredentials {
    pub login: String,
    pub access_token: String,
    pub refresh_token: String,
    /// Epoch milliseconds.
    pub access_expires_at: i64,
    /// Epoch milliseconds.
    pub refresh_expires_at: i64,
}

/// Stored credentials exist but cannot be read or trusted. The user must sign in again.
#[derive(Debug, Error)]
pub enum CredentialError {
    #[error("Stored sign-in could not be read")]
    Unreadable,
    #[error("Stored sign-in is corrupt")]
    Corrupt,
    #[error("Stored sign-in could not be decrypted")]
    Undecryptable,
    #[error("Stored sign-in could not be saved")]
    Save,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CipherKind {
    Os,
    LocalKey,
}

#[derive(Serialize, Deserialize)]
struct Envelope {
    version: u32,
    cipher: CipherKind,
    data: String,
}

pub struct CredentialStore {
    dir: PathBuf,
    cipher: CipherKind,
}

impl CredentialStore {
    pub fn new(dir: &Path) -> Self {
        let cipher = if os_protection_available() {
            CipherKind::Os
        } else {
            CipherKind::LocalKey
        };
        Self {
            dir: dir.to_path_buf(),
            cipher,
        }
    }

    fn credentials_path(&self) -> PathBuf {
        self.dir.join("credentials.json")
    }

    /// Writes atomically: a temp file is renamed over the real file.
    pub async fn save(&self, creds: &StoredCredentials) -> Result<(), CredentialError> {
        tokio::fs::create_dir_all(&self.dir)
            .await
            .map_err(|_| CredentialError::Save)?;
        let plain = serde_json::to_vec(creds).map_err(|_| CredentialError::Save)?;
        let sealed = self.seal(self.cipher, &plain).await?;
        let envelope = Envelope {
            version: 1,
            cipher: self.cipher,
            data: base64::engine::general_purpose::STANDARD.encode(sealed),
        };
        let body = serde_json::to_string(&envelope).map_err(|_| CredentialError::Save)?;
        let target = self.credentials_path();
        let temp = target.with_extension("json.tmp");
        tokio::fs::write(&temp, body)
            .await
            .map_err(|_| CredentialError::Save)?;
        tokio::fs::rename(&temp, &target)
            .await
            .map_err(|_| CredentialError::Save)
    }

    /// Returns `None` when nothing is stored. Errors mean stored data cannot be trusted.
    pub async fn load(&self) -> Result<Option<StoredCredentials>, CredentialError> {
        let raw = match tokio::fs::read_to_string(self.credentials_path()).await {
            Ok(raw) => raw,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(CredentialError::Unreadable),
        };
        let envelope: Envelope = serde_json::from_str(&raw).map_err(|_| CredentialError::Corrupt)?;
        if envelope.version != 1 {
            return Err(CredentialError::Corrupt);
        }
        let sealed = base64::engine::general_purpose::STANDARD
            .decode(envelope.data)
            .map_err(|_| CredentialError::Corrupt)?;
        // Read with the cipher that wrote the data. Never fall back to a weaker one.
        let plain = self.open(envelope.cipher, &sealed).await?;
        serde_json::from_slice(&plain)
            .map(Some)
            .map_err(|_| CredentialError::Undecryptable)
    }

    pub async fn clear(&self) -> Result<(), CredentialError> {
        for path in [self.credentials_path(), self.credentials_path().with_extension("json.tmp")] {
            match tokio::fs::remove_file(&path).await {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(CredentialError::Save),
            }
        }
        Ok(())
    }

    async fn seal(&self, kind: CipherKind, plain: &[u8]) -> Result<Vec<u8>, CredentialError> {
        match kind {
            CipherKind::Os => os_protect(plain).ok_or(CredentialError::Save),
            CipherKind::LocalKey => {
                let key = self.load_or_create_local_key().await?;
                let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
                let mut iv = [0u8; 12];
                rand::thread_rng().fill_bytes(&mut iv);
                // aes-gcm appends the tag; the stored layout is iv | tag | ciphertext.
                let mut out = cipher
                    .encrypt(Nonce::from_slice(&iv), plain)
                    .map_err(|_| CredentialError::Save)?;
                let tag = out.split_off(out.len() - 16);
                let mut sealed = Vec::with_capacity(12 + 16 + out.len());
                sealed.extend_from_slice(&iv);
                sealed.extend_from_slice(&tag);
                sealed.extend_from_slice(&out);
                Ok(sealed)
            }
        }
    }

    async fn open(&self, kind: CipherKind, sealed: &[u8]) -> Result<Vec<u8>, CredentialError> {
        match kind {
            CipherKind::Os => os_unprotect(sealed).ok_or(CredentialError::Undecryptable),
            CipherKind::LocalKey => {
                if sealed.len() < 28 {
                    return Err(CredentialError::Undecryptable);
                }
                let key = self.load_or_create_local_key().await?;
                let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
                let (iv, rest) = sealed.split_at(12);
                let (tag, body) = rest.split_at(16);
                let mut joined = Vec::with_capacity(body.len() + 16);
                joined.extend_from_slice(body);
                joined.extend_from_slice(tag);
                cipher
                    .decrypt(Nonce::from_slice(iv), joined.as_slice())
                    .map_err(|_| CredentialError::Undecryptable)
            }
        }
    }

    async fn load_or_create_local_key(&self) -> Result<Vec<u8>, CredentialError> {
        let path = self.dir.join("local.key");
        match tokio::fs::read_to_string(&path).await {
            Ok(raw) => {
                let key = base64::engine::general_purpose::STANDARD
                    .decode(raw.trim())
                    .map_err(|_| CredentialError::Unreadable)?;
                if key.len() != 32 {
                    return Err(CredentialError::Unreadable);
                }
                Ok(key)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                tokio::fs::create_dir_all(&self.dir)
                    .await
                    .map_err(|_| CredentialError::Save)?;
                let mut key = [0u8; 32];
                rand::thread_rng().fill_bytes(&mut key);
                let encoded = base64::engine::general_purpose::STANDARD.encode(key);
                tokio::fs::write(&path, encoded)
                    .await
                    .map_err(|_| CredentialError::Save)?;
                Ok(key.to_vec())
            }
            Err(_) => Err(CredentialError::Unreadable),
        }
    }
}

#[cfg(windows)]
fn os_protection_available() -> bool {
    // DPAPI is part of every supported Windows install; a round trip confirms it works for this user.
    os_protect(b"orbit-probe")
        .and_then(|sealed| os_unprotect(&sealed))
        .map(|plain| plain == b"orbit-probe")
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn os_protection_available() -> bool {
    false
}

#[cfg(windows)]
fn os_protect(plain: &[u8]) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN};

    let input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(plain.len()).ok()?,
        pbData: plain.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: `input` borrows `plain` for the call; DPAPI writes into `output`, which we copy out and free.
    unsafe {
        CryptProtectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output).ok()?;
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as *mut _)));
        Some(bytes)
    }
}

#[cfg(windows)]
fn os_unprotect(sealed: &[u8]) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN};

    let input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(sealed.len()).ok()?,
        pbData: sealed.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: as in `os_protect`.
    unsafe {
        CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output).ok()?;
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as *mut _)));
        Some(bytes)
    }
}

#[cfg(not(windows))]
fn os_protect(_plain: &[u8]) -> Option<Vec<u8>> {
    None
}

#[cfg(not(windows))]
fn os_unprotect(_sealed: &[u8]) -> Option<Vec<u8>> {
    None
}
