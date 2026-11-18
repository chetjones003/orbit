//! Merge conflicts on a pull request. Reading compares the three git trees (merge base, head, base branch) path by path,
//! so no file-count cap applies. The renderer merges the text of files both branches changed; committing builds the
//! resolving commit on the head with the base branch as its second parent. Merging itself never happens here.

use std::collections::{BTreeMap, BTreeSet};

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::client::WriteOptions;
use super::util::*;
use super::write::ApiError;
use super::{get_json, Ctx, Session};

/// Text is read for merging only up to this size. Larger files are settled by taking one branch's whole file.
const TEXT_LIMIT: u64 = 25_000_000;
/// Files read at once when a pull request has many conflicting paths.
const READ_CONCURRENCY: usize = 12;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PathTexts {
    pub ancestor: Option<String>,
    pub head: Option<String>,
    pub base: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictPath {
    pub path: String,
    pub changed_on_head: bool,
    pub changed_on_base: bool,
    /// Why Orbit cannot merge this path's text. Null when it can, or when the path needs no merge.
    pub unsupported: Option<String>,
    pub ancestor_blob: Option<String>,
    pub head_blob: Option<String>,
    pub head_mode: Option<String>,
    pub base_blob: Option<String>,
    pub base_mode: Option<String>,
    /// Text of the three versions. Read only for paths both sides changed and that differ.
    pub texts: Option<PathTexts>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictSet {
    pub head_ref: String,
    pub head_sha: String,
    pub head_in_repo: bool,
    pub base_ref: String,
    pub base_sha: String,
    pub merge_base_sha: String,
    pub paths: Vec<ConflictPath>,
}

/// One change written into the resolving commit.
#[derive(Deserialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResolvedFile {
    /// Text the reader produced. Null content deletes the file.
    Text { path: String, content: Option<String>, mode: String },
    /// A blob already in the repo, copied as it is (a base-branch change). Null sha deletes the file.
    Blob { path: String, sha: Option<String>, mode: String },
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConflictCommitInput {
    pub expected_head_sha: String,
    pub expected_base_sha: String,
    pub files: Vec<ResolvedFile>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConflictCommitResult {
    pub sha: String,
}

/// One path in a git tree: its mode, object type (blob, commit for submodules), and object id.
#[derive(Clone, Debug)]
struct Entry {
    mode: String,
    kind: String,
    sha: String,
}

fn same(left: Option<&Entry>, right: Option<&Entry>) -> bool {
    match (left, right) {
        (None, None) => true,
        (Some(a), Some(b)) => a.sha == b.sha && a.mode == b.mode,
        _ => false,
    }
}

fn blob_of(entry: Option<&Entry>) -> Option<String> {
    entry.map(|e| e.sha.clone())
}

fn mode_of(entry: Option<&Entry>) -> Option<String> {
    entry.map(|e| e.mode.clone())
}

fn content_path(path: &str) -> String {
    path.split('/').map(enc).collect::<Vec<_>>().join("/")
}

/// The tree id of a commit.
async fn commit_tree(ctx: &Ctx, session: &Session, repo_root: &str, commit_sha: &str) -> Result<String, ApiError> {
    let commit = get_json(ctx, session, &format!("{repo_root}/git/commits/{}", enc(commit_sha))).await?;
    commit
        .get("tree")
        .and_then(|t| s(t, "sha"))
        .ok_or_else(|| ApiError::msg("GitHub returned an invalid commit."))
}

/// The entries of one directory, by name. A directory is listed one level at a time, so no listing is truncated.
type Listing = BTreeMap<String, Entry>;

async fn list_tree(ctx: &Ctx, session: &Session, repo_root: &str, tree_sha: Option<&str>) -> Result<Listing, ApiError> {
    let Some(tree_sha) = tree_sha else { return Ok(Listing::new()) };
    let raw = get_json(ctx, session, &format!("{repo_root}/git/trees/{}", enc(tree_sha))).await?;
    let mut out = Listing::new();
    for item in raw.get("tree").and_then(Value::as_array).cloned().unwrap_or_default() {
        let (Some(name), Some(sha)) = (s(&item, "path"), s(&item, "sha")) else { continue };
        out.insert(
            name,
            Entry {
                mode: s(&item, "mode").unwrap_or_else(|| "100644".into()),
                kind: s(&item, "type").unwrap_or_default(),
                sha,
            },
        );
    }
    Ok(out)
}

/// One path in the three trees: the merge base, the head, and the base branch. None where the path is absent.
struct Sides {
    ancestor: Option<Entry>,
    head: Option<Entry>,
    base: Option<Entry>,
}

/// A directory still to compare: its tree id in each of the three trees, None where the directory is absent.
struct Frame {
    prefix: String,
    ancestor: Option<String>,
    head: Option<String>,
    base: Option<String>,
}

/// The entry at a name when it is a file (or submodule or link), not a directory.
fn file_at(entry: Option<&Entry>) -> Option<Entry> {
    entry.filter(|e| e.kind != "tree").cloned()
}

/// The tree id at a name when it is a directory.
fn tree_at(entry: Option<&Entry>) -> Option<String> {
    entry.filter(|e| e.kind == "tree").map(|e| e.sha.clone())
}

async fn list_frame<'a>(
    ctx: &'a Ctx,
    session: &'a Session,
    repo_root: &'a str,
    frame: &'a Frame,
) -> Result<(Listing, Listing, Listing), ApiError> {
    futures::try_join!(
        list_tree(ctx, session, repo_root, frame.ancestor.as_deref()),
        list_tree(ctx, session, repo_root, frame.head.as_deref()),
        list_tree(ctx, session, repo_root, frame.base.as_deref()),
    )
}

/// Every file that differs between the merge base and the base branch, with its entry in each of the three trees. A
/// directory is opened only when its tree id differs between the merge base and the base branch, so the walk stays
/// small on a large repository. Files the base branch did not change are not needed, so they are not collected.
async fn changed_files(
    ctx: &Ctx,
    session: &Session,
    repo_root: &str,
    roots: [String; 3],
) -> Result<BTreeMap<String, Sides>, ApiError> {
    let [ancestor, head, base] = roots;
    let mut files = BTreeMap::new();
    let mut frames = vec![Frame { prefix: String::new(), ancestor: Some(ancestor), head: Some(head), base: Some(base) }];
    while !frames.is_empty() {
        let level = std::mem::take(&mut frames);
        let mut pending = Vec::with_capacity(level.len());
        for frame in &level {
            pending.push(list_frame(ctx, session, repo_root, frame));
        }
        let listed = futures::future::try_join_all(pending).await?;
        for (frame, (a, h, bs)) in level.iter().zip(listed) {
            let names: BTreeSet<&String> = a.keys().chain(h.keys()).chain(bs.keys()).collect();
            for name in names {
                let (ea, eh, eb) = (a.get(name), h.get(name), bs.get(name));
                let path = format!("{}{name}", frame.prefix);
                let sides = Sides { ancestor: file_at(ea), head: file_at(eh), base: file_at(eb) };
                if sides.ancestor.is_some() || sides.head.is_some() || sides.base.is_some() {
                    files.insert(path.clone(), sides);
                }
                let (da, db) = (tree_at(ea), tree_at(eb));
                if da == db {
                    continue;
                }
                frames.push(Frame { prefix: format!("{path}/"), ancestor: da, head: tree_at(eh), base: db });
            }
        }
    }
    Ok(files)
}

/// The text of one version of a file. The outer error is an API failure; the inner one says Orbit cannot read it.
async fn blob_text(
    ctx: &Ctx,
    session: &Session,
    repo_root: &str,
    entry: Option<&Entry>,
) -> Result<Result<Option<String>, String>, ApiError> {
    let Some(entry) = entry else { return Ok(Ok(None)) };
    if entry.kind != "blob" || entry.mode == "120000" {
        return Ok(Err("it is a submodule or link, not a regular file".into()));
    }
    let raw = get_json(ctx, session, &format!("{repo_root}/git/blobs/{}", enc(&entry.sha))).await?;
    if raw.get("size").and_then(Value::as_u64).unwrap_or(0) > TEXT_LIMIT {
        return Ok(Err("it is larger than 25 MB".into()));
    }
    let encoded = s(&raw, "content").unwrap_or_default().replace('\n', "");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| ApiError::msg("GitHub returned a file Orbit could not read."))?;
    Ok(match String::from_utf8(bytes) {
        Ok(text) => Ok(Some(text)),
        Err(_) => Err("it is a binary file".into()),
    })
}

/// Reads the pull request's conflicts: every path the base branch changed since the merge base. Paths both sides
/// changed also carry the text of each version, for the merge.
pub async fn read_conflicts(ctx: &Ctx, repo_full_name: &str, number: u64) -> Result<ConflictSet, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    let session = ctx.session().await?;
    let repo_root = repo_path(&owner, &repo);
    let pull = get_json(ctx, &session, &item_path(&owner, &repo, "pulls", number)).await?;
    if b(&pull, "merged") {
        return Err(ApiError::msg("This pull request is already merged."));
    }
    if s(&pull, "state").as_deref() != Some("open") {
        return Err(ApiError::msg("This pull request is closed."));
    }
    let head = pull.get("head");
    let head_sha = head
        .and_then(|h| s(h, "sha"))
        .ok_or_else(|| ApiError::msg("GitHub returned an invalid pull request."))?;
    let head_ref = head.and_then(|h| s(h, "ref")).unwrap_or_default();
    let head_in_repo = head
        .and_then(|h| h.get("repo"))
        .and_then(|r| s(r, "full_name"))
        .map(|name| name.eq_ignore_ascii_case(&format!("{owner}/{repo}")))
        .unwrap_or(false);
    let base_ref = pull.get("base").and_then(|h| s(h, "ref")).unwrap_or_default();
    let base_sha = branch_sha(ctx, &session, &repo_root, &base_ref).await?;

    // The comparison's merge base is reliable even when its file list is truncated, so only that field is used.
    let compare = get_json(ctx, &session, &format!("{repo_root}/compare/{base_sha}...{head_sha}")).await?;
    let merge_base_sha = compare
        .get("merge_base_commit")
        .and_then(|c| s(c, "sha"))
        .ok_or_else(|| ApiError::msg("GitHub did not report the merge base."))?;

    let (ancestor_tree, head_tree, base_tree) = futures::try_join!(
        commit_tree(ctx, &session, &repo_root, &merge_base_sha),
        commit_tree(ctx, &session, &repo_root, &head_sha),
        commit_tree(ctx, &session, &repo_root, &base_sha),
    )?;
    let files = changed_files(ctx, &session, &repo_root, [ancestor_tree, head_tree, base_tree]).await?;

    let mut paths = Vec::new();
    // Paths whose text must be read, with the index of their row in `paths`.
    let mut to_read: Vec<(usize, Option<&Entry>, Option<&Entry>, Option<&Entry>)> = Vec::new();
    for (path, sides) in &files {
        let (a, h, bs) = (sides.ancestor.as_ref(), sides.head.as_ref(), sides.base.as_ref());
        let changed_on_base = !same(a, bs);
        if !changed_on_base {
            continue;
        }
        let changed_on_head = !same(a, h);
        let needs_merge = changed_on_head && !same(h, bs);
        if needs_merge {
            to_read.push((paths.len(), a, h, bs));
        }
        paths.push(ConflictPath {
            path: path.clone(),
            changed_on_head,
            changed_on_base,
            unsupported: None,
            ancestor_blob: blob_of(a),
            head_blob: blob_of(h),
            head_mode: mode_of(h),
            base_blob: blob_of(bs),
            base_mode: mode_of(bs),
            texts: None,
        });
    }

    // Each file's three versions are read together, a few files at a time, so a large pull request does not wait on
    // every request in turn.
    for chunk in to_read.chunks(READ_CONCURRENCY) {
        let mut pending = Vec::with_capacity(chunk.len());
        for (index, a, h, bs) in chunk.iter().copied() {
            pending.push(read_versions(ctx, &session, &repo_root, index, a, h, bs));
        }
        for (index, versions) in futures::future::try_join_all(pending).await? {
            apply_versions(&mut paths[index], versions);
        }
    }
    Ok(ConflictSet {
        head_ref,
        head_sha,
        head_in_repo,
        base_ref,
        base_sha,
        merge_base_sha,
        paths,
    })
}

type Versions = (Result<Option<String>, String>, Result<Option<String>, String>, Result<Option<String>, String>);

/// The ancestor, head and base text of one path, read together.
async fn read_versions<'a>(
    ctx: &'a Ctx,
    session: &'a Session,
    repo_root: &'a str,
    index: usize,
    a: Option<&'a Entry>,
    h: Option<&'a Entry>,
    bs: Option<&'a Entry>,
) -> Result<(usize, Versions), ApiError> {
    let versions = futures::try_join!(
        blob_text(ctx, session, repo_root, a),
        blob_text(ctx, session, repo_root, h),
        blob_text(ctx, session, repo_root, bs),
    )?;
    Ok((index, versions))
}

fn apply_versions(row: &mut ConflictPath, (ancestor, head, base): Versions) {
    match (ancestor, head, base) {
        (Ok(ancestor), Ok(head), Ok(base)) => row.texts = Some(PathTexts { ancestor, head, base }),
        (Err(reason), _, _) | (_, Err(reason), _) | (_, _, Err(reason)) => {
            row.unsupported = Some(format!("Orbit cannot merge this file: {reason}."));
        }
    }
}

async fn branch_sha(ctx: &Ctx, session: &Session, repo_root: &str, branch: &str) -> Result<String, ApiError> {
    let raw = get_json(ctx, session, &format!("{repo_root}/git/ref/heads/{}", content_path(branch))).await?;
    raw.get("object")
        .and_then(|o| s(o, "sha"))
        .ok_or_else(|| ApiError::msg("GitHub returned an invalid branch."))
}

fn valid_repo_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.ends_with('/')
        && !path.split('/').any(|segment| segment.is_empty() || segment == "." || segment == "..")
        && !path.contains('\0')
}

const VALID_MODES: &[&str] = &["100644", "100755", "120000", "160000"];

fn tree_entry(file: &ResolvedFile) -> Result<Value, ApiError> {
    let (path, mode) = match file {
        ResolvedFile::Text { path, mode, .. } | ResolvedFile::Blob { path, mode, .. } => (path, mode),
    };
    if !valid_repo_path(path) {
        return Err(ApiError::msg(format!("{path} is not a path Orbit can write.")));
    }
    if !VALID_MODES.contains(&mode.as_str()) {
        return Err(ApiError::msg(format!("{path} has a file mode Orbit does not write.")));
    }
    let kind = if mode == "160000" { "commit" } else { "blob" };
    Ok(match file {
        ResolvedFile::Text { content: Some(content), .. } => {
            json!({ "path": path, "mode": mode, "type": kind, "content": content })
        }
        ResolvedFile::Text { content: None, .. } => json!({ "path": path, "mode": mode, "type": kind, "sha": null }),
        ResolvedFile::Blob { sha: Some(sha), .. } => {
            validate_sha(sha).map_err(ApiError::msg)?;
            json!({ "path": path, "mode": mode, "type": kind, "sha": sha })
        }
        ResolvedFile::Blob { sha: None, .. } => json!({ "path": path, "mode": mode, "type": kind, "sha": null }),
    })
}

/// Writes the resolving commit: the head's tree with the resolved files applied, parents head and base. The branch
/// moves only if the head and base are still the ones the resolver showed.
pub async fn commit_resolution(
    ctx: &Ctx,
    repo_full_name: &str,
    number: u64,
    input: ConflictCommitInput,
) -> Result<ConflictCommitResult, ApiError> {
    let (owner, repo) = ctx.personal_repo(repo_full_name)?;
    validate_item_number(number).map_err(ApiError::msg)?;
    validate_sha(&input.expected_head_sha).map_err(ApiError::msg)?;
    validate_sha(&input.expected_base_sha).map_err(ApiError::msg)?;
    if input.files.is_empty() {
        return Err(ApiError::msg("There is nothing to commit."));
    }
    let entries = input.files.iter().map(tree_entry).collect::<Result<Vec<Value>, ApiError>>()?;
    ctx.writes.assert_can_write()?;
    let session = ctx.session().await?;
    let repo_root = repo_path(&owner, &repo);
    let pull = get_json(ctx, &session, &item_path(&owner, &repo, "pulls", number)).await?;
    if b(&pull, "merged") || s(&pull, "state").as_deref() != Some("open") {
        return Err(ApiError::msg("This pull request is no longer open."));
    }
    let head = pull.get("head");
    let head_sha = head.and_then(|h| s(h, "sha")).unwrap_or_default();
    if head_sha != input.expected_head_sha {
        return Err(ApiError::msg(
            "The pull request changed since you opened the resolver. Reload it and resolve again.",
        ));
    }
    let in_repo = head
        .and_then(|h| h.get("repo"))
        .and_then(|r| s(r, "full_name"))
        .map(|name| name.eq_ignore_ascii_case(&format!("{owner}/{repo}")))
        .unwrap_or(false);
    let head_ref = head.and_then(|h| s(h, "ref")).unwrap_or_default();
    if !in_repo || head_ref.is_empty() {
        return Err(ApiError::msg("The head branch is in another repo, so Orbit cannot push to it."));
    }
    let base_ref = pull.get("base").and_then(|h| s(h, "ref")).unwrap_or_default();
    let base_sha = branch_sha(ctx, &session, &repo_root, &base_ref).await?;
    if base_sha != input.expected_base_sha {
        return Err(ApiError::msg("The base branch moved since you opened the resolver. Reload it and resolve again."));
    }

    let head_commit = get_json(ctx, &session, &format!("{repo_root}/git/commits/{head_sha}")).await?;
    let base_tree = head_commit
        .get("tree")
        .and_then(|t| s(t, "sha"))
        .ok_or_else(|| ApiError::msg("GitHub returned an invalid commit."))?;

    let tree = ctx
        .client
        .send(
            reqwest::Method::POST,
            &format!("{repo_root}/git/trees"),
            &session.token,
            WriteOptions {
                body: Some(json!({ "base_tree": base_tree, "tree": entries })),
                ..Default::default()
            },
        )
        .await?;
    let tree_sha = s(&tree, "sha").ok_or_else(|| ApiError::msg("GitHub returned an invalid tree."))?;

    let message = format!("Merge {base_ref} into {head_ref}\n\nResolve merge conflicts in Orbit.");
    let commit = ctx
        .client
        .send(
            reqwest::Method::POST,
            &format!("{repo_root}/git/commits"),
            &session.token,
            WriteOptions {
                body: Some(json!({ "message": message, "tree": tree_sha, "parents": [head_sha, base_sha] })),
                ..Default::default()
            },
        )
        .await?;
    let commit_sha = s(&commit, "sha").ok_or_else(|| ApiError::msg("GitHub returned an invalid commit."))?;

    // Not forced: if the branch moved since the check above, GitHub refuses and nothing is overwritten.
    ctx.client
        .send(
            reqwest::Method::PATCH,
            &format!("{repo_root}/git/refs/heads/{}", content_path(&head_ref)),
            &session.token,
            WriteOptions {
                body: Some(json!({ "sha": commit_sha, "force": false })),
                ..Default::default()
            },
        )
        .await?;
    Ok(ConflictCommitResult { sha: commit_sha })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_must_stay_inside_the_repo() {
        assert!(valid_repo_path("src/a.cpp"));
        assert!(valid_repo_path("docs/My File.md"));
        assert!(!valid_repo_path(""));
        assert!(!valid_repo_path("/etc/passwd"));
        assert!(!valid_repo_path("src/../secret"));
        assert!(!valid_repo_path("src//a"));
        assert!(!valid_repo_path("./a"));
    }

    #[test]
    fn content_paths_keep_slashes_and_escape_segments() {
        assert_eq!(content_path("src/my file.cpp"), "src/my%20file.cpp");
    }

    #[test]
    fn a_file_is_the_same_only_when_object_and_mode_match() {
        let blob = |sha: &str, mode: &str| Entry { mode: mode.into(), kind: "blob".into(), sha: sha.into() };
        assert!(same(None, None));
        assert!(same(Some(&blob("a", "100644")), Some(&blob("a", "100644"))));
        assert!(!same(Some(&blob("a", "100644")), Some(&blob("b", "100644"))));
        assert!(!same(Some(&blob("a", "100644")), Some(&blob("a", "100755"))));
        assert!(!same(Some(&blob("a", "100644")), None));
    }

    #[test]
    fn a_name_is_either_a_file_or_a_directory() {
        let file = Entry { mode: "100644".into(), kind: "blob".into(), sha: "a".into() };
        let dir = Entry { mode: "040000".into(), kind: "tree".into(), sha: "b".into() };
        assert!(file_at(Some(&file)).is_some() && tree_at(Some(&file)).is_none());
        assert!(file_at(Some(&dir)).is_none());
        assert_eq!(tree_at(Some(&dir)).as_deref(), Some("b"));
    }

    #[test]
    fn resolved_files_become_tree_entries_and_bad_modes_are_refused() {
        let text = ResolvedFile::Text { path: "a.cpp".into(), content: Some("x".into()), mode: "100644".into() };
        assert_eq!(tree_entry(&text).unwrap()["content"], "x");
        let deleted = ResolvedFile::Blob { path: "old.txt".into(), sha: None, mode: "100644".into() };
        assert!(tree_entry(&deleted).unwrap()["sha"].is_null());
        let odd = ResolvedFile::Text { path: "a".into(), content: Some("x".into()), mode: "777".into() };
        assert!(tree_entry(&odd).is_err());
    }
}
