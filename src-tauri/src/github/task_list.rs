//! Task-list checkboxes in an issue's Markdown source. Only the checkbox character of one task changes, so every
//! other byte of the body is preserved. Ported from `task-list.ts`.
//!
//! The original finds tasks with the GFM parser. This port matches the same list-item form line by line, outside
//! fenced code blocks, which covers the forms GitHub renders as checkboxes.

/// Byte offsets of the `[` of each task marker, in document order.
fn task_marker_starts(source: &str) -> Vec<usize> {
    let mut starts = Vec::new();
    let mut offset = 0usize;
    let mut fence: Option<&str> = None;
    for line in source.split_inclusive('\n') {
        let trimmed = line.trim_start();
        let is_fence = trimmed.starts_with("```") || trimmed.starts_with("~~~");
        if is_fence {
            let marker = if trimmed.starts_with("```") { "```" } else { "~~~" };
            match fence {
                None => fence = Some(marker),
                Some(open) if open == marker => fence = None,
                _ => {}
            }
        } else if fence.is_none() {
            if let Some(bracket) = task_bracket(line) {
                starts.push(offset + bracket);
            }
        }
        offset += line.len();
    }
    starts
}

/// The position of `[` in a list item that starts with `[ ]`, `[x]`, or `[X]`, or None.
fn task_bracket(line: &str) -> Option<usize> {
    let indent = line.len() - line.trim_start().len();
    let rest = &line[indent..];
    let after_marker = if let Some(r) = rest.strip_prefix("- ")
        .or_else(|| rest.strip_prefix("* "))
        .or_else(|| rest.strip_prefix("+ "))
    {
        r
    } else {
        // Ordered items: digits, then `.` or `)`, then a space.
        let digits = rest.chars().take_while(|c| c.is_ascii_digit()).count();
        if digits == 0 || digits > 9 {
            return None;
        }
        let after = &rest[digits..];
        after
            .strip_prefix(". ")
            .or_else(|| after.strip_prefix(") "))?
    };
    let bytes = after_marker.as_bytes();
    if bytes.len() >= 3
        && bytes[0] == b'['
        && (bytes[1] == b' ' || bytes[1] == b'x' || bytes[1] == b'X')
        && bytes[2] == b']'
    {
        let before_bracket = line.len() - after_marker.len();
        return Some(before_bracket);
    }
    None
}

/// How many task items the source contains.
#[cfg(test)]
pub fn count_task_items(source: &str) -> usize {
    task_marker_starts(source).len()
}

/// Sets the checkbox of the `index`th task item (0-based) to `checked`. Errors when there is no such item, so a
/// stale index can never edit a different line.
pub fn set_task_item_checked(source: &str, index: usize, checked: bool) -> Result<String, String> {
    let start = *task_marker_starts(source)
        .get(index)
        .ok_or_else(|| format!("There is no task item {index} in this text."))?;
    // The marker is `[`, the box character, then `]`.
    let mut out = String::with_capacity(source.len());
    out.push_str(&source[..start + 1]);
    out.push(if checked { 'x' } else { ' ' });
    out.push_str(&source[start + 2..]);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ticks_only_the_chosen_box() {
        let body = "- [ ] one\n- [x] two\n";
        assert_eq!(set_task_item_checked(body, 0, true).unwrap(), "- [x] one\n- [x] two\n");
        assert_eq!(set_task_item_checked(body, 1, false).unwrap(), "- [ ] one\n- [ ] two\n");
    }

    #[test]
    fn skips_code_fences() {
        let body = "```\n- [ ] not a task\n```\n- [ ] real\n";
        assert_eq!(count_task_items(body), 1);
        assert_eq!(
            set_task_item_checked(body, 0, true).unwrap(),
            "```\n- [ ] not a task\n```\n- [x] real\n"
        );
    }

    #[test]
    fn stale_index_is_refused() {
        assert!(set_task_item_checked("- [ ] a\n", 3, true).is_err());
    }

    #[test]
    fn supports_ordered_items() {
        assert_eq!(count_task_items("1. [ ] first\n2) [X] second\n"), 2);
    }
}
