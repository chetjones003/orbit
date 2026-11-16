//! Whether a review anchor names a line the file's patch shows on that side. Ported from `review-anchor.ts`.

use crate::model::issues::ReviewAnchor;

/// True when the anchor names a line the patch shows on its side: a new-side line that is added or kept, or an
/// old-side line that is removed or kept. Lines outside every hunk are not anchors.
pub fn anchor_in_patch(patch: &str, anchor: &ReviewAnchor) -> bool {
    let want = anchor.line;
    let mut old_line: u64 = 0;
    let mut new_line: u64 = 0;
    for text in patch.split('\n') {
        if let Some((old_start, new_start)) = parse_hunk_header(text) {
            old_line = old_start;
            new_line = new_start;
            continue;
        }
        match text.chars().next() {
            Some(' ') => {
                if anchor.side == "RIGHT" && new_line == want {
                    return true;
                }
                if anchor.side == "LEFT" && old_line == want {
                    return true;
                }
                old_line += 1;
                new_line += 1;
            }
            Some('-') => {
                if anchor.side == "LEFT" && old_line == want {
                    return true;
                }
                old_line += 1;
            }
            Some('+') => {
                if anchor.side == "RIGHT" && new_line == want {
                    return true;
                }
                new_line += 1;
            }
            _ => {}
        }
    }
    false
}

/// Parses `@@ -a[,b] +c[,d] @@`, returning the old and new start lines.
fn parse_hunk_header(text: &str) -> Option<(u64, u64)> {
    let rest = text.strip_prefix("@@ -")?;
    let (old, rest) = take_number(rest)?;
    let rest = rest.strip_prefix(|c: char| c == ',').map_or(rest, |_| skip_count(rest));
    let rest = rest.strip_prefix(" +")?;
    let (new, _) = take_number(rest)?;
    Some((old, new))
}

fn take_number(text: &str) -> Option<(u64, &str)> {
    let digits = text.chars().take_while(|c| c.is_ascii_digit()).count();
    if digits == 0 {
        return None;
    }
    Some((text[..digits].parse().ok()?, &text[digits..]))
}

/// Skips the `,count` part of a hunk range that follows the start line.
fn skip_count(text: &str) -> &str {
    let after_comma = &text[1..];
    let digits = after_comma.chars().take_while(|c| c.is_ascii_digit()).count();
    &after_comma[digits..]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn anchor(side: &str, line: u64) -> ReviewAnchor {
        ReviewAnchor {
            path: "a.rs".into(),
            side: side.into(),
            line,
        }
    }

    const PATCH: &str = "@@ -1,3 +1,4 @@\n keep\n-old\n+new\n+added\n tail";

    #[test]
    fn finds_lines_on_each_side() {
        assert!(anchor_in_patch(PATCH, &anchor("RIGHT", 2)));
        assert!(anchor_in_patch(PATCH, &anchor("LEFT", 2)));
        assert!(anchor_in_patch(PATCH, &anchor("RIGHT", 3)));
        assert!(!anchor_in_patch(PATCH, &anchor("RIGHT", 9)));
    }

    #[test]
    fn parses_hunk_headers_without_counts() {
        assert_eq!(parse_hunk_header("@@ -5 +7 @@ fn"), Some((5, 7)));
        assert_eq!(parse_hunk_header("@@ -5,2 +7,3 @@"), Some((5, 7)));
    }
}
