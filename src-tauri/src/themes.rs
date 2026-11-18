//! Open VSX colour themes: search, and reading the colours of one. Nothing from a package is run; the package is
//! only unzipped far enough to read its JSON theme files. Ported from `themes/open-vsx.ts`, `vscode-theme.ts`
//! and `zip.ts`.

use flate2::read::DeflateDecoder;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::Read;
use std::time::Duration;

const BASE: &str = "https://open-vsx.org";
const RESULT_LIMIT: u32 = 20;
const QUERY_LIMIT: usize = 80;
const TIMEOUT: Duration = Duration::from_secs(20);
/// A search answers quickly or not at all, so it gives up sooner than a download does.
const SEARCH_TIMEOUT: Duration = Duration::from_secs(8);
/// Recent searches are kept this long, so going back to a tab or a query is instant.
const SEARCH_CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const SEARCH_CACHE_ENTRIES: usize = 32;
const MAX_PACKAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_JSON_BYTES: usize = 2 * 1024 * 1024;
const MAX_THEME_FILES: usize = 8;
const MAX_ICON_BYTES: usize = 256 * 1024;
const MAX_ENTRY_BYTES: usize = 5 * 1024 * 1024;
const CUSTOM_THEME_NAME_LENGTH: usize = 40;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSearchResult {
    pub namespace: String,
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub downloads: u64,
    pub verified: bool,
    pub icon: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeImportDraft {
    pub name: String,
    pub source: String,
    /// The variant's workbench colours, as written in the theme file. The renderer maps them to Orbit's roles.
    pub dark: Option<HashMap<String, String>>,
    pub light: Option<HashMap<String, String>>,
}

fn client() -> Result<reqwest::Client, String> {
    client_with_timeout(TIMEOUT)
}

fn client_with_timeout(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .user_agent("Orbit")
        .build()
        .map_err(|e| e.to_string())
}

fn is_safe_part(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 100
        && bytes[0].is_ascii_alphanumeric()
        && bytes.iter().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'))
}

fn is_open_vsx_url(url: &str) -> bool {
    url::Url::parse(url)
        .map(|u| u.scheme() == "https" && u.host_str() == Some("open-vsx.org"))
        .unwrap_or(false)
}

/// The image type of PNG, JPEG and WebP data, from its first bytes. Anything else, SVG included, is None.
pub fn sniff_image_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 8 && bytes[..8] == [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] {
        return Some("image/png");
    }
    if bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff {
        return Some("image/jpeg");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    None
}

type SearchCache = HashMap<String, (std::time::Instant, Vec<ThemeSearchResult>)>;
static SEARCH_CACHE: std::sync::Mutex<Option<SearchCache>> = std::sync::Mutex::new(None);

fn cached_search(key: &str) -> Option<Vec<ThemeSearchResult>> {
    let mut guard = SEARCH_CACHE.lock().ok()?;
    let cache = guard.get_or_insert_with(HashMap::new);
    cache.retain(|_, (at, _)| at.elapsed() < SEARCH_CACHE_TTL);
    cache.get(key).map(|(_, results)| results.clone())
}

fn store_search(key: String, results: Vec<ThemeSearchResult>) {
    let Ok(mut guard) = SEARCH_CACHE.lock() else { return };
    let cache = guard.get_or_insert_with(HashMap::new);
    cache.insert(key, (std::time::Instant::now(), results));
    while cache.len() > SEARCH_CACHE_ENTRIES {
        let oldest = cache.iter().min_by_key(|(_, (at, _))| *at).map(|(k, _)| k.clone());
        match oldest {
            Some(k) => {
                cache.remove(&k);
            }
            None => break,
        }
    }
}

pub async fn search(query: &str, sort: &str) -> Result<Vec<ThemeSearchResult>, String> {
    let text: String = query.trim().chars().take(QUERY_LIMIT).collect();
    let sort_by = if sort == "timestamp" { "timestamp" } else { "downloadCount" };
    let key = format!("{sort_by}|{text}");
    if let Some(hit) = cached_search(&key) {
        return Ok(hit);
    }
    let mut url = url::Url::parse(&format!("{BASE}/api/-/search")).map_err(|e| e.to_string())?;
    {
        let mut params = url.query_pairs_mut();
        params
            .append_pair("category", "Themes")
            .append_pair("size", &RESULT_LIMIT.to_string())
            .append_pair("sortBy", sort_by)
            .append_pair("sortOrder", "desc");
        if !text.is_empty() {
            params.append_pair("query", &text);
        }
    }
    let http = client_with_timeout(SEARCH_TIMEOUT)?;
    let body = get_json(&http, url.as_str()).await?;
    let list = body.get("extensions").and_then(Value::as_array).cloned().unwrap_or_default();

    let mut found: Vec<(ThemeSearchResult, Option<String>)> = Vec::new();
    for entry in &list {
        let (Some(namespace), Some(name)) = (entry.get("namespace").and_then(Value::as_str), entry.get("name").and_then(Value::as_str)) else {
            continue;
        };
        if !is_safe_part(namespace) || !is_safe_part(name) {
            continue;
        }
        let display = string_or(entry.get("displayName"), name);
        let files = entry.get("files");
        let icon_url = files.and_then(|f| f.get("icon")).and_then(Value::as_str).map(str::to_string);
        found.push((
            ThemeSearchResult {
                namespace: namespace.to_string(),
                name: name.to_string(),
                display_name: display.chars().take(CUSTOM_THEME_NAME_LENGTH).collect(),
                description: string_or(entry.get("description"), "").chars().take(200).collect(),
                downloads: entry.get("downloadCount").and_then(Value::as_u64).unwrap_or(0),
                verified: entry.get("verified").and_then(Value::as_bool) == Some(true),
                icon: None,
            },
            icon_url,
        ));
    }

    let mut results = Vec::with_capacity(found.len());
    for (mut result, icon_url) in found {
        result.icon = fetch_icon(&http, icon_url.as_deref()).await;
        results.push(result);
    }
    store_search(key, results.clone());
    Ok(results)
}

/// An icon as a data URL, when it is a PNG, JPEG or WebP under the size limit. Anything else gives None.
async fn fetch_icon(http: &reqwest::Client, url: Option<&str>) -> Option<String> {
    let url = url?;
    if !is_open_vsx_url(url) {
        return None;
    }
    let response = http.get(url).header("accept", "image/*").send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let bytes = response.bytes().await.ok()?;
    if bytes.len() > MAX_ICON_BYTES {
        return None;
    }
    // Open VSX often labels icons as application/octet-stream, so the type comes from the file's own signature.
    let kind = sniff_image_type(&bytes)?;
    use base64::Engine;
    Some(format!(
        "data:{kind};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

pub async fn import(namespace: &str, name: &str) -> Result<ThemeImportDraft, String> {
    if !is_safe_part(namespace) || !is_safe_part(name) {
        return Err("That is not an Open VSX extension.".into());
    }
    let http = client()?;
    let meta = get_json(&http, &format!("{BASE}/api/{namespace}/{name}")).await?;
    let download = meta
        .get("files")
        .and_then(|f| f.get("download"))
        .and_then(Value::as_str)
        .filter(|u| is_open_vsx_url(u))
        .ok_or("Open VSX did not give a package this app will download.")?
        .to_string();

    let archive = get_bytes(&http, &download, MAX_PACKAGE_BYTES).await?;
    let manifest_entries = read_zip_entries(&archive, |n| n == "extension/package.json")?;
    let manifest_text = manifest_entries
        .get("extension/package.json")
        .ok_or("The extension has no package.json.")?;
    let manifest: Value = serde_json::from_slice(manifest_text).map_err(|e| e.to_string())?;
    let declared = manifest
        .get("contributes")
        .and_then(|c| c.get("themes"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let theme_paths: Vec<String> = declared
        .iter()
        .filter_map(|entry| entry.get("path").and_then(Value::as_str))
        .filter_map(extension_path)
        .take(MAX_THEME_FILES)
        .collect();
    if theme_paths.is_empty() {
        return Err("This extension does not contribute a colour theme.".into());
    }

    let wanted: Vec<String> = theme_paths.clone();
    let files = read_zip_entries(&archive, |n| wanted.iter().any(|w| w == n))?;
    let mut themes: Vec<(VsCodeTheme, Option<VsCodeTheme>)> = Vec::new();
    for path in &theme_paths {
        let Some(text) = files.get(path) else { continue };
        let file = parse_vscode_theme(utf8(text)?)?;
        let base = match &file.include {
            Some(include) => read_include(&archive, path, include)?,
            None => None,
        };
        themes.push((file, base));
    }

    let dark = pick_variant(&themes, true);
    let light = pick_variant(&themes, false);
    if dark.is_none() && light.is_none() {
        return Err("This extension has no theme Orbit can read.".into());
    }
    let name_text = string_or(
        meta.get("displayName"),
        &string_or(meta.get("name"), name),
    );
    Ok(ThemeImportDraft {
        name: name_text.chars().take(CUSTOM_THEME_NAME_LENGTH).collect(),
        source: format!("{namespace}.{name}"),
        dark,
        light,
    })
}

fn read_include(archive: &[u8], theme_path: &str, include: &str) -> Result<Option<VsCodeTheme>, String> {
    // The include is relative to the theme file, and must stay inside the extension folder.
    let base = join_relative(theme_path, include);
    if !base.starts_with("extension/") || base.split('/').any(|p| p == "..") {
        return Ok(None);
    }
    let entries = read_zip_entries(archive, |n| n == base)?;
    match entries.get(&base) {
        Some(text) => parse_vscode_theme(utf8(text)?).map(Some),
        None => Ok(None),
    }
}

fn pick_variant(themes: &[(VsCodeTheme, Option<VsCodeTheme>)], dark: bool) -> Option<HashMap<String, String>> {
    for (file, base) in themes {
        if is_dark_ui_theme(file.ui_theme.as_deref()) != dark {
            continue;
        }
        let mut colors: HashMap<String, Value> = HashMap::new();
        if let Some(base) = base {
            colors.extend(base.colors.clone());
        }
        colors.extend(file.colors.clone());
        if let Some(workbench) = workbench_colors(&colors) {
            return Some(workbench);
        }
    }
    None
}

fn extension_path(path: &str) -> Option<String> {
    let cleaned = path.strip_prefix("./").unwrap_or(path);
    if cleaned.is_empty() || cleaned.starts_with('/') || cleaned.split('/').any(|p| p == "..") {
        return None;
    }
    Some(format!("extension/{cleaned}"))
}

fn join_relative(theme_path: &str, include: &str) -> String {
    let directory = theme_path.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    let joined = if directory.is_empty() {
        include.to_string()
    } else {
        format!("{directory}/{include}")
    };
    joined.replace("/./", "/")
}

fn string_or(value: Option<&Value>, fallback: &str) -> String {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

async fn get_json(http: &reqwest::Client, url: &str) -> Result<Value, String> {
    let bytes = get_bytes(http, url, MAX_JSON_BYTES).await?;
    let parsed: Value = serde_json::from_slice(&bytes).map_err(|_| "Open VSX sent something Orbit did not expect.".to_string())?;
    if !parsed.is_object() {
        return Err("Open VSX sent something Orbit did not expect.".into());
    }
    Ok(parsed)
}

async fn get_bytes(http: &reqwest::Client, url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let response = http
        .get(url)
        .header("accept", "*/*")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "Open VSX took too long to answer. Try again.".to_string()
            } else {
                "Open VSX could not be reached. Check the connection and try again.".to_string()
            }
        })?;
    if !response.status().is_success() {
        return Err(format!("Open VSX answered {}.", response.status().as_u16()));
    }
    if response.content_length().map(|n| n as usize > limit).unwrap_or(false) {
        return Err("That download is larger than Orbit reads.".into());
    }
    let bytes = response.bytes().await.map_err(|_| "Open VSX could not be reached.".to_string())?;
    if bytes.len() > limit {
        return Err("That download is larger than Orbit reads.".into());
    }
    Ok(bytes.to_vec())
}

// ---- VS Code theme files. ----

#[derive(Clone, Debug, Default)]
pub struct VsCodeTheme {
    pub ui_theme: Option<String>,
    pub colors: HashMap<String, Value>,
    pub include: Option<String>,
}

/// Removes // and block comments, and trailing commas, from a JSON-with-comments document. Strings are left alone.
pub fn strip_json_comments(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut in_string = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if in_string {
            out.push(c);
            if c == '\\' {
                if let Some(n) = next {
                    out.push(n);
                }
                i += 2;
                continue;
            } else if c == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        if c == '"' {
            in_string = true;
            out.push(c);
            i += 1;
        } else if c == '/' && next == Some('/') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            out.push('\n');
        } else if c == '/' && next == Some('*') {
            i += 2;
            while i < chars.len() && !(chars[i] == '*' && chars.get(i + 1) == Some(&'/')) {
                i += 1;
            }
            i += 2;
        } else {
            out.push(c);
            i += 1;
        }
    }
    // Trailing commas before a closing brace or bracket are allowed in theme files.
    let re = regex_lite::Regex::new(r",(\s*[}\]])").expect("valid trailing comma pattern");
    re.replace_all(&out, "$1").into_owned()
}

pub fn parse_vscode_theme(text: &str) -> Result<VsCodeTheme, String> {
    let parsed: Value = serde_json::from_str(&strip_json_comments(text)).map_err(|e| e.to_string())?;
    if !parsed.is_object() {
        return Err("The theme file is not an object.".into());
    }
    let colors = parsed
        .get("colors")
        .and_then(Value::as_object)
        .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();
    Ok(VsCodeTheme {
        ui_theme: parsed.get("type").and_then(Value::as_str).map(str::to_string),
        colors,
        include: parsed.get("include").and_then(Value::as_str).map(str::to_string),
    })
}

/// Light themes are 'vs' and 'hc-light'; every other kind reads as dark.
pub fn is_dark_ui_theme(ui_theme: Option<&str>) -> bool {
    !matches!(ui_theme, Some("vs") | Some("hc-light"))
}

/// The string colours of a theme, without values that are not strings. None without an editor background, which
/// every palette is built from.
pub fn workbench_colors(colors: &HashMap<String, Value>) -> Option<HashMap<String, String>> {
    let workbench: HashMap<String, String> = colors
        .iter()
        .filter_map(|(key, value)| {
            let text = value.as_str()?.trim();
            (key.len() <= 80 && !text.is_empty() && text.len() <= 64).then(|| (key.clone(), text.to_string()))
        })
        .take(2000)
        .collect();
    let has_background = ["editor.background", "editorPane.background"]
        .iter()
        .any(|key| workbench.contains_key(*key));
    has_background.then_some(workbench)
}

// ---- Zip reading: only the wanted entries, sizes checked before inflating. ----

const END_OF_CENTRAL_DIRECTORY: u32 = 0x0605_4b50;
const CENTRAL_HEADER: u32 = 0x0201_4b50;
const LOCAL_HEADER: u32 = 0x0403_4b50;

fn u16_at(data: &[u8], at: usize) -> Result<u16, String> {
    data.get(at..at + 2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
        .ok_or_else(damaged)
}

fn u32_at(data: &[u8], at: usize) -> Result<u32, String> {
    data.get(at..at + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .ok_or_else(damaged)
}

fn utf8(bytes: &[u8]) -> Result<&str, String> {
    std::str::from_utf8(bytes).map_err(|_| "The theme file is not UTF-8 text.".to_string())
}

fn damaged() -> String {
    "This archive is damaged or not a zip file.".into()
}

/// Reads the wanted files out of a zip archive. Only stored and deflated entries are supported.
pub fn read_zip_entries(archive: &[u8], wanted: impl Fn(&str) -> bool) -> Result<HashMap<String, Vec<u8>>, String> {
    let directory = find_end_of_central_directory(archive)?;
    let count = u16_at(archive, directory + 10)?;
    let mut offset = u32_at(archive, directory + 16)? as usize;
    let mut entries = HashMap::new();

    for _ in 0..count {
        if u32_at(archive, offset)? != CENTRAL_HEADER {
            return Err(damaged());
        }
        let method = u16_at(archive, offset + 10)?;
        let compressed = u32_at(archive, offset + 20)? as usize;
        let uncompressed = u32_at(archive, offset + 24)? as usize;
        let name_len = u16_at(archive, offset + 28)? as usize;
        let extra_len = u16_at(archive, offset + 30)? as usize;
        let comment_len = u16_at(archive, offset + 32)? as usize;
        let local_offset = u32_at(archive, offset + 42)? as usize;
        let name = String::from_utf8_lossy(
            archive.get(offset + 46..offset + 46 + name_len).ok_or_else(damaged)?,
        )
        .into_owned();
        offset += 46 + name_len + extra_len + comment_len;

        if !wanted(&name) || name.ends_with('/') {
            continue;
        }
        if uncompressed > MAX_ENTRY_BYTES || compressed > archive.len() {
            return Err(damaged());
        }
        if u32_at(archive, local_offset)? != LOCAL_HEADER {
            return Err(damaged());
        }
        let data_start = local_offset + 30 + u16_at(archive, local_offset + 26)? as usize + u16_at(archive, local_offset + 28)? as usize;
        let raw = archive.get(data_start..data_start + compressed).ok_or_else(damaged)?;
        match method {
            0 => {
                entries.insert(name, raw.to_vec());
            }
            8 => {
                let mut out = Vec::new();
                DeflateDecoder::new(raw)
                    .take(MAX_ENTRY_BYTES as u64 + 1)
                    .read_to_end(&mut out)
                    .map_err(|_| damaged())?;
                if out.len() > MAX_ENTRY_BYTES {
                    return Err(damaged());
                }
                entries.insert(name, out);
            }
            _ => return Err("This archive uses a compression method Orbit does not read.".into()),
        }
    }
    Ok(entries)
}

fn find_end_of_central_directory(archive: &[u8]) -> Result<usize, String> {
    if archive.len() < 22 {
        return Err("This file is not a zip archive.".into());
    }
    let earliest = archive.len().saturating_sub(22 + 0xffff);
    for at in (earliest..=archive.len() - 22).rev() {
        if u32_at(archive, at)? == END_OF_CENTRAL_DIRECTORY {
            return Ok(at);
        }
    }
    Err("This file is not a zip archive.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comments_and_trailing_commas_are_removed() {
        let text = "{ // note\n \"type\": \"vs-dark\", /* block */ \"colors\": {\"a\": \"#fff\",}, }";
        let parsed = parse_vscode_theme(text).unwrap();
        assert_eq!(parsed.ui_theme.as_deref(), Some("vs-dark"));
        assert!(parsed.colors.contains_key("a"));
    }

    #[test]
    fn workbench_colours_keep_strings_and_need_a_background() {
        let mut colors: HashMap<String, Value> = HashMap::new();
        colors.insert("editor.background".into(), Value::from("#191724"));
        colors.insert("sideBar.background".into(), Value::from("#1f1d2e"));
        colors.insert("editor.lineHighlightBorder".into(), Value::Null);
        let workbench = workbench_colors(&colors).expect("has a background");
        assert_eq!(workbench.get("sideBar.background").map(String::as_str), Some("#1f1d2e"));
        assert!(!workbench.contains_key("editor.lineHighlightBorder"));
        colors.remove("editor.background");
        assert!(workbench_colors(&colors).is_none());
    }

    #[test]
    fn image_signatures_are_sniffed() {
        assert_eq!(sniff_image_type(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Some("image/png"));
        assert_eq!(sniff_image_type(b"<svg></svg>"), None);
    }

    #[test]
    fn include_paths_stay_inside_the_extension() {
        assert_eq!(join_relative("extension/themes/a.json", "./b.json"), "extension/themes/b.json");
        assert!(read_include(&[], "extension/themes/a.json", "../../x").unwrap().is_none());
    }
}

#[cfg(test)]
mod search_cache_tests {
    use super::*;

    fn result(name: &str) -> ThemeSearchResult {
        ThemeSearchResult {
            namespace: "ns".into(),
            name: name.into(),
            display_name: name.into(),
            description: String::new(),
            downloads: 0,
            verified: false,
            icon: None,
        }
    }

    #[test]
    fn a_stored_search_is_returned_until_the_cache_is_full() {
        store_search("downloadCount|dracula".into(), vec![result("dracula")]);
        let hit = cached_search("downloadCount|dracula").expect("stored search");
        assert_eq!(hit[0].name, "dracula");

        for index in 0..SEARCH_CACHE_ENTRIES + 5 {
            store_search(format!("downloadCount|q{index}"), vec![result("x")]);
        }
        let len = SEARCH_CACHE.lock().unwrap().as_ref().map(HashMap::len).unwrap_or(0);
        assert!(len <= SEARCH_CACHE_ENTRIES);
    }
}
