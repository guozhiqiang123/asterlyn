use super::{
    SearchCancellationToken, SearchLimits, SearchMatcher, SearchOptions, check_cancelled,
    dominant_separator, preview, source_lines,
};
use crate::WorkspaceError;

pub(crate) struct LineReplacementPreview {
    pub line: usize,
    pub before: String,
    pub after: String,
}

pub(crate) fn replace_text_line_local(
    content: &str,
    query: &str,
    replacement: &str,
    options: &SearchOptions,
    cancellation: &SearchCancellationToken,
    limits: SearchLimits,
    max_preview_utf16: usize,
) -> Result<(String, Vec<LineReplacementPreview>), WorkspaceError> {
    if options.new_line {
        return Err(WorkspaceError::InvalidReplacement {
            message:
                "multi-line search is read-only; turn off New line before previewing replacement"
                    .to_string(),
        });
    }
    let matcher = SearchMatcher::compile(
        query,
        options.mode,
        options.case_sensitive,
        options.whole_word,
        false,
        cancellation,
        limits,
    )?;
    let normalized_replacement = replacement.replace("\r\n", "\n").replace('\r', "\n");
    let separator = dominant_separator(content);
    let file_replacement = normalized_replacement.replace('\n', separator);
    let mut output = String::with_capacity(content.len());
    let mut previews = Vec::new();

    for (line_index, line) in source_lines(content).into_iter().enumerate() {
        check_cancelled(cancellation)?;
        let (replaced, matches) =
            matcher.replace_all(line.text, &file_replacement, cancellation)?;
        previews.extend(matches.into_iter().map(|found| {
            LineReplacementPreview {
                line: line_index + 1,
                before: preview(
                    line.text,
                    found.before_from,
                    found.before_to,
                    max_preview_utf16,
                )
                .text,
                after: preview(
                    &replaced,
                    found.after_from,
                    found.after_to,
                    max_preview_utf16,
                )
                .text,
            }
        }));
        output.push_str(&replaced);
        output.push_str(line.separator);
    }
    check_cancelled(cancellation)?;
    Ok((output, previews))
}
