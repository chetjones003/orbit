//! Uploads for comments and issue bodies in personal repos. The file's type and size are checked before any request
//! is sent. Ported from `shared/attachments.ts` and `IssueService.uploadAttachment`.

use serde::Serialize;

use super::util::{enc, repo_path, s};
use super::write::ApiError;
use super::{get_json, Ctx};
use crate::github::client::{Base, WriteOptions};

pub const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_VIDEO_BYTES_FREE: usize = 10 * 1024 * 1024;
pub const MAX_VIDEO_BYTES_PAID: usize = 100 * 1024 * 1024;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AttachmentKind {
    Image,
    Video,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AccountPlan {
    Free,
    Paid,
}

#[derive(Debug, PartialEq, Eq)]
pub struct AllowedType {
    pub kind: AttachmentKind,
    pub content_type: &'static str,
}

/// Decides from the extension and size whether a file may be uploaded. The file's own MIME type is not trusted.
pub fn check_attachment(name: &str, size: usize, plan: AccountPlan) -> Result<AllowedType, String> {
    let extension = name
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_lowercase())
        .unwrap_or_default();
    let allowed = match extension.as_str() {
        "png" => AllowedType { kind: AttachmentKind::Image, content_type: "image/png" },
        "jpg" | "jpeg" => AllowedType { kind: AttachmentKind::Image, content_type: "image/jpeg" },
        "gif" => AllowedType { kind: AttachmentKind::Image, content_type: "image/gif" },
        "webp" => AllowedType { kind: AttachmentKind::Image, content_type: "image/webp" },
        "svg" => AllowedType { kind: AttachmentKind::Image, content_type: "image/svg+xml" },
        "mp4" => AllowedType { kind: AttachmentKind::Video, content_type: "video/mp4" },
        "mov" => AllowedType { kind: AttachmentKind::Video, content_type: "video/quicktime" },
        "webm" => AllowedType { kind: AttachmentKind::Video, content_type: "video/webm" },
        _ => return Err("Attach a PNG, JPG, GIF, WebP, SVG, MP4, MOV, or WebM file.".into()),
    };
    if size == 0 {
        return Err("That file is empty.".into());
    }
    if allowed.kind == AttachmentKind::Image && size > MAX_IMAGE_BYTES {
        return Err("Images can be at most 10 MB.".into());
    }
    if allowed.kind == AttachmentKind::Video {
        let limit = match plan {
            AccountPlan::Paid => MAX_VIDEO_BYTES_PAID,
            AccountPlan::Free => MAX_VIDEO_BYTES_FREE,
        };
        if size > limit {
            return Err(match plan {
                AccountPlan::Paid => "Videos can be at most 100 MB.".into(),
                AccountPlan::Free => "Videos can be at most 10 MB on a free plan.".into(),
            });
        }
    }
    Ok(allowed)
}

/// An upload URL is inserted into Markdown, so it must be https with no characters that would break the link.
pub fn is_safe_attachment_url(url: &str) -> bool {
    let shape_ok = url.starts_with("https://")
        && url.len() > "https://".len()
        && !url.chars().any(|c| c.is_whitespace() || matches!(c, '(' | ')' | '[' | ']' | '<' | '>'));
    shape_ok && url::Url::parse(url).map(|u| u.scheme() == "https").unwrap_or(false)
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum AttachmentUploadResult {
    Uploaded { url: String },
    PublicNotice,
}

pub struct UploadOutcome {
    pub result: AttachmentUploadResult,
    /// True when the user accepted the public-upload notice on this call, so it should be persisted.
    pub acknowledge_now: bool,
}

/// Uploads one file. `already_acknowledged` comes from settings; a public repo waits for acknowledgement first.
pub async fn upload(
    ctx: &Ctx,
    repo_full_name: &str,
    name: &str,
    bytes: Vec<u8>,
    acknowledged_public: bool,
    already_acknowledged: bool,
) -> Result<UploadOutcome, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    if name.is_empty() || name.len() > 255 {
        return Err(ApiError::msg("Choose a file to attach."));
    }
    // Type and size first, with the most generous video limit, so nothing is requested for a file that can never upload.
    let preliminary = check_attachment(name, bytes.len(), AccountPlan::Paid).map_err(ApiError::msg)?;
    ctx.writes.assert_can_write()?;
    let session = ctx.session().await?;

    let access = get_json(ctx, &session, &repo_path(&owner, &repo)).await?;
    let repo_id = access
        .get("id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| ApiError::msg("GitHub returned an invalid repo."))?;
    let is_private = access.get("private").and_then(|v| v.as_bool()) == Some(true);
    let can_push = access
        .get("permissions")
        .and_then(|p| p.get("push"))
        .and_then(|v| v.as_bool())
        == Some(true);
    if !can_push {
        return Err(ApiError::msg("You need write access to this repo to attach files."));
    }

    let plan = if preliminary.kind == AttachmentKind::Video {
        account_plan(ctx, &session).await?
    } else {
        AccountPlan::Free
    };
    let checked = check_attachment(name, bytes.len(), plan).map_err(ApiError::msg)?;

    let mut acknowledge_now = false;
    if !is_private {
        if acknowledged_public {
            if !already_acknowledged {
                acknowledge_now = true;
            }
        } else if !already_acknowledged {
            return Ok(UploadOutcome {
                result: AttachmentUploadResult::PublicNotice,
                acknowledge_now: false,
            });
        }
    }

    let path = format!(
        "/user-attachments/assets?name={}&content_type={}&repository_id={repo_id}",
        enc(name),
        enc(checked.content_type)
    );
    let response = ctx
        .client
        .send(
            reqwest::Method::POST,
            &path,
            &session.token,
            WriteOptions {
                base: Some(Base::Uploads),
                raw: Some((bytes, checked.content_type)),
                accept: Some("application/json"),
                ..Default::default()
            },
        )
        .await?;
    let href = s(&response, "href")
        .filter(|h| is_safe_attachment_url(h))
        .ok_or_else(|| ApiError::msg("GitHub did not return an attachment link."))?;
    Ok(UploadOutcome {
        result: AttachmentUploadResult::Uploaded { url: href },
        acknowledge_now,
    })
}

/// The account plan decides the video limit. An unknown plan gets the free limit, the lower one.
async fn account_plan(ctx: &Ctx, session: &super::Session) -> Result<AccountPlan, ApiError> {
    let me = get_json(ctx, session, "/user").await?;
    let name = me.get("plan").and_then(|p| p.get("name")).and_then(|n| n.as_str());
    Ok(match name {
        Some(n) if n != "free" => AccountPlan::Paid,
        _ => AccountPlan::Free,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn images_and_videos_have_separate_limits() {
        assert!(check_attachment("a.png", 1_000, AccountPlan::Free).is_ok());
        assert!(check_attachment("a.png", MAX_IMAGE_BYTES + 1, AccountPlan::Free).is_err());
        assert!(check_attachment("a.mp4", 50 * 1024 * 1024, AccountPlan::Free).is_err());
        assert!(check_attachment("a.mp4", 50 * 1024 * 1024, AccountPlan::Paid).is_ok());
        assert!(check_attachment("a.exe", 10, AccountPlan::Paid).is_err());
    }

    #[test]
    fn only_https_urls_are_inserted() {
        assert!(is_safe_attachment_url("https://user-images.githubusercontent.com/a.png"));
        assert!(!is_safe_attachment_url("http://x/a.png"));
        assert!(!is_safe_attachment_url("https://x/a)b"));
    }
}
