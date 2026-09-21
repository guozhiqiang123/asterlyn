use std::fs::{self, File, Metadata};
use std::io::Read;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use glob::{MatchOptions, Pattern};
use memchr::memmem::Finder;
use regex::{Regex, RegexBuilder};

use super::{UTF8_BOM, Workspace, WorkspaceError, revision};

const CANCELLATION_CHUNK_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Default)]
pub struct SearchCancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl SearchCancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub fn refers_to(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.cancelled, &other.cancelled)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchCandidate {
    pub workspace_path: String,
}

#[derive(Debug, Clone, Copy, Default, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SearchMode {
    #[default]
    Literal,
    Regex,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchOptions {
    pub mode: SearchMode,
    pub new_line: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub exclude_ignored: bool,
    pub include_globs: Vec<String>,
    pub exclude_globs: Vec<String>,
    pub context_lines: usize,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            mode: SearchMode::Literal,
            new_line: false,
            case_sensitive: false,
            whole_word: false,
            exclude_ignored: true,
            include_globs: Vec::new(),
            exclude_globs: Vec::new(),
            context_lines: 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SearchLimits {
    pub max_candidates: usize,
    pub max_total_bytes: usize,
    pub max_matches: usize,
    pub max_preview_utf16: usize,
    pub max_reported_skips: usize,
    pub max_query_bytes: usize,
    pub max_path_patterns_per_kind: usize,
    pub max_path_pattern_bytes: usize,
    pub max_context_lines: usize,
    pub max_regex_size_bytes: usize,
    pub max_regex_dfa_size_bytes: usize,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SearchCoverageReason {
    CatalogTruncated,
    CandidateLimit,
    ByteLimit,
    MatchLimit,
    SkippedFiles,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SearchSkipReason {
    TooLarge,
    InvalidUtf8,
    BinaryNul,
    NotFound,
    PermissionDenied,
    UnsafePath,
    UnsupportedType,
    ChangedDuringRead,
    Io,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchSkippedFile {
    pub candidate_index: usize,
    pub workspace_path: String,
    pub reason: SearchSkipReason,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchMatch {
    pub candidate_index: usize,
    pub workspace_path: String,
    pub revision: String,
    pub from_utf16: usize,
    pub to_utf16: usize,
    pub line: usize,
    pub column_utf16: usize,
    pub preview: String,
    pub preview_from_utf16: usize,
    pub preview_to_utf16: usize,
    pub leading_clipped: bool,
    pub trailing_clipped: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchReport {
    pub request_id: String,
    pub matches: Vec<WorkspaceSearchMatch>,
    pub catalog_candidates: usize,
    pub eligible_candidates: usize,
    pub files_searched: usize,
    pub bytes_read: usize,
    pub skipped_count: usize,
    pub skipped_files: Vec<SearchSkippedFile>,
    pub coverage_reasons: Vec<SearchCoverageReason>,
}

impl WorkspaceSearchReport {
    pub fn complete(&self) -> bool {
        self.coverage_reasons.is_empty()
    }
}

impl Workspace {
    pub fn search_literal_text(
        &self,
        request_id: &str,
        candidates: &[SearchCandidate],
        catalog_truncated: bool,
        query: &str,
        cancellation: &SearchCancellationToken,
        limits: SearchLimits,
    ) -> Result<WorkspaceSearchReport, WorkspaceError> {
        self.search_text(
            request_id,
            candidates,
            catalog_truncated,
            query,
            &SearchOptions::default(),
            cancellation,
            limits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn search_text(
        &self,
        request_id: &str,
        candidates: &[SearchCandidate],
        catalog_truncated: bool,
        query: &str,
        options: &SearchOptions,
        cancellation: &SearchCancellationToken,
        limits: SearchLimits,
    ) -> Result<WorkspaceSearchReport, WorkspaceError> {
        validate_search(request_id, query, options, limits)?;
        check_cancelled(cancellation)?;
        let path_filters = PathFilters::compile(options, cancellation)?;
        let effective_query = if options.new_line && options.mode == SearchMode::Literal {
            decode_search_escapes(query)
        } else {
            query.to_string()
        };
        let matcher = SearchMatcher::compile(
            &effective_query,
            options.mode,
            options.case_sensitive,
            options.whole_word,
            options.new_line,
            cancellation,
            limits,
        )?;
        let eligible_candidates = if path_filters.is_empty() {
            candidates.len()
        } else {
            let mut count = 0;
            for candidate in candidates {
                check_cancelled(cancellation)?;
                if path_filters.matches(&candidate.workspace_path) {
                    count += 1;
                }
            }
            count
        };

        let mut report = WorkspaceSearchReport {
            request_id: request_id.to_string(),
            matches: Vec::new(),
            catalog_candidates: candidates.len(),
            eligible_candidates,
            files_searched: 0,
            bytes_read: 0,
            skipped_count: 0,
            skipped_files: Vec::new(),
            coverage_reasons: Vec::new(),
        };
        if catalog_truncated {
            push_coverage(&mut report, SearchCoverageReason::CatalogTruncated);
        }
        if candidates.len() > limits.max_candidates {
            push_coverage(&mut report, SearchCoverageReason::CandidateLimit);
        }

        for (candidate_index, candidate) in
            candidates.iter().take(limits.max_candidates).enumerate()
        {
            check_cancelled(cancellation)?;
            if !path_filters.matches(&candidate.workspace_path) {
                continue;
            }
            let remaining = limits.max_total_bytes.saturating_sub(report.bytes_read);
            if remaining == 0 {
                push_coverage(&mut report, SearchCoverageReason::ByteLimit);
                break;
            }
            let (path, metadata) = match self.resolve_regular_file(&candidate.workspace_path) {
                Ok(resolved) => resolved,
                Err(error) => {
                    record_skip(
                        &mut report,
                        candidate_index,
                        candidate,
                        skip_reason(&error),
                        limits.max_reported_skips,
                    );
                    continue;
                }
            };
            let read_limit = self.text_limit_bytes.saturating_add(1).min(remaining);
            let bytes = match read_search_bytes(&path, read_limit) {
                Ok(bytes) => bytes,
                Err(error) => {
                    record_skip(
                        &mut report,
                        candidate_index,
                        candidate,
                        io_skip_reason(&error),
                        limits.max_reported_skips,
                    );
                    continue;
                }
            };
            report.bytes_read = report.bytes_read.saturating_add(bytes.len());
            if bytes.len() == remaining
                && metadata.len() > bytes.len() as u64
                && remaining <= self.text_limit_bytes
            {
                push_coverage(&mut report, SearchCoverageReason::ByteLimit);
                break;
            }
            if bytes.len() > self.text_limit_bytes {
                record_skip(
                    &mut report,
                    candidate_index,
                    candidate,
                    SearchSkipReason::TooLarge,
                    limits.max_reported_skips,
                );
                continue;
            }
            if bytes.contains(&0) {
                record_skip(
                    &mut report,
                    candidate_index,
                    candidate,
                    SearchSkipReason::BinaryNul,
                    limits.max_reported_skips,
                );
                continue;
            }
            let text_bytes = bytes.strip_prefix(UTF8_BOM).unwrap_or(&bytes);
            let Ok(content) = std::str::from_utf8(text_bytes) else {
                record_skip(
                    &mut report,
                    candidate_index,
                    candidate,
                    SearchSkipReason::InvalidUtf8,
                    limits.max_reported_skips,
                );
                continue;
            };
            let rechecked = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) => {
                    record_skip(
                        &mut report,
                        candidate_index,
                        candidate,
                        io_skip_reason(&error),
                        limits.max_reported_skips,
                    );
                    continue;
                }
            };
            if !stable_metadata(&metadata, &rechecked) {
                record_skip(
                    &mut report,
                    candidate_index,
                    candidate,
                    SearchSkipReason::ChangedDuringRead,
                    limits.max_reported_skips,
                );
                continue;
            }

            report.files_searched += 1;
            let normalized = normalize_newlines(content);
            let source_revision = revision(&bytes, &metadata);
            if (if options.new_line {
                append_document_matches(
                    &mut report,
                    candidate_index,
                    candidate,
                    &source_revision,
                    &normalized,
                    &matcher,
                    cancellation,
                    limits,
                )
            } else {
                append_matches(
                    &mut report,
                    candidate_index,
                    candidate,
                    &source_revision,
                    &normalized,
                    &matcher,
                    options.context_lines,
                    cancellation,
                    limits,
                )
            })? {
                push_coverage(&mut report, SearchCoverageReason::MatchLimit);
                break;
            }
        }
        if report.skipped_count > 0 {
            push_coverage(&mut report, SearchCoverageReason::SkippedFiles);
        }
        Ok(report)
    }
}

fn validate_search(
    request_id: &str,
    query: &str,
    options: &SearchOptions,
    limits: SearchLimits,
) -> Result<(), WorkspaceError> {
    if request_id.is_empty()
        || request_id.len() > 128
        || request_id.chars().any(char::is_whitespace)
    {
        return Err(WorkspaceError::InvalidSearch {
            message: "search request IDs must contain 1 to 128 non-whitespace bytes".to_string(),
        });
    }
    if query.is_empty()
        || query.contains('\0')
        || (!options.new_line && query.contains(['\r', '\n']))
        || query.len() > limits.max_query_bytes
    {
        return Err(WorkspaceError::InvalidSearch {
            message: format!(
                "search text must be one non-empty line of at most {} UTF-8 bytes",
                limits.max_query_bytes
            ),
        });
    }
    if limits.max_candidates == 0
        || limits.max_total_bytes == 0
        || limits.max_matches == 0
        || limits.max_preview_utf16 == 0
        || limits.max_reported_skips == 0
        || limits.max_query_bytes == 0
        || limits.max_path_patterns_per_kind == 0
        || limits.max_path_pattern_bytes == 0
        || limits.max_regex_size_bytes == 0
        || limits.max_regex_dfa_size_bytes == 0
    {
        return Err(WorkspaceError::InvalidSearch {
            message: "search limits must be positive".to_string(),
        });
    }
    if options.context_lines > limits.max_context_lines {
        return Err(WorkspaceError::InvalidSearch {
            message: format!(
                "search context must be between 0 and {} lines",
                limits.max_context_lines
            ),
        });
    }
    validate_glob_list(
        "include",
        &options.include_globs,
        limits.max_path_patterns_per_kind,
        limits.max_path_pattern_bytes,
    )?;
    validate_glob_list(
        "exclude",
        &options.exclude_globs,
        limits.max_path_patterns_per_kind,
        limits.max_path_pattern_bytes,
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn append_matches(
    report: &mut WorkspaceSearchReport,
    candidate_index: usize,
    candidate: &SearchCandidate,
    source_revision: &str,
    normalized: &str,
    matcher: &SearchMatcher,
    context_lines: usize,
    cancellation: &SearchCancellationToken,
    limits: SearchLimits,
) -> Result<bool, WorkspaceError> {
    let mut document_utf16 = 0;
    let lines: Vec<_> = normalized.split('\n').collect();
    for (line_index, line) in lines.iter().enumerate() {
        check_cancelled(cancellation)?;
        let remaining_matches = limits.max_matches.saturating_sub(report.matches.len());
        for (from_byte, to_byte) in
            matcher.ranges(line, cancellation, remaining_matches.saturating_add(1))?
        {
            if report.matches.len() == limits.max_matches {
                return Ok(true);
            }
            let from_in_line = line[..from_byte].encode_utf16().count();
            let match_utf16 = line[from_byte..to_byte].encode_utf16().count();
            let preview = context_preview(
                &lines,
                line_index,
                from_byte,
                to_byte,
                context_lines,
                limits.max_preview_utf16,
            );
            report.matches.push(WorkspaceSearchMatch {
                candidate_index,
                workspace_path: candidate.workspace_path.clone(),
                revision: source_revision.to_string(),
                from_utf16: document_utf16 + from_in_line,
                to_utf16: document_utf16 + from_in_line + match_utf16,
                line: line_index + 1,
                column_utf16: from_in_line + 1,
                preview: preview.text,
                preview_from_utf16: preview.from_utf16,
                preview_to_utf16: preview.to_utf16,
                leading_clipped: preview.leading_clipped,
                trailing_clipped: preview.trailing_clipped,
            });
        }
        document_utf16 += line.encode_utf16().count();
        if line_index + 1 < lines.len() {
            document_utf16 += 1;
        }
    }
    Ok(false)
}

#[allow(clippy::too_many_arguments)]
fn append_document_matches(
    report: &mut WorkspaceSearchReport,
    candidate_index: usize,
    candidate: &SearchCandidate,
    source_revision: &str,
    normalized: &str,
    matcher: &SearchMatcher,
    cancellation: &SearchCancellationToken,
    limits: SearchLimits,
) -> Result<bool, WorkspaceError> {
    let remaining = limits.max_matches.saturating_sub(report.matches.len());
    let ranges = matcher.ranges(normalized, cancellation, remaining.saturating_add(1))?;
    let mut previous_byte = 0;
    let mut previous_utf16 = 0;
    let mut line_index = 0;
    let mut line_start = 0;
    for (from_byte, to_byte) in ranges {
        if report.matches.len() == limits.max_matches {
            return Ok(true);
        }
        check_cancelled(cancellation)?;
        while let Some(relative) = normalized[line_start..from_byte].find('\n') {
            line_start += relative + 1;
            line_index += 1;
        }
        let from_utf16 =
            previous_utf16 + normalized[previous_byte..from_byte].encode_utf16().count();
        let match_utf16 = normalized[from_byte..to_byte].encode_utf16().count();
        let found_preview = preview(normalized, from_byte, to_byte, limits.max_preview_utf16);
        report.matches.push(WorkspaceSearchMatch {
            candidate_index,
            workspace_path: candidate.workspace_path.clone(),
            revision: source_revision.to_string(),
            from_utf16,
            to_utf16: from_utf16 + match_utf16,
            line: line_index + 1,
            column_utf16: normalized[line_start..from_byte].encode_utf16().count() + 1,
            preview: found_preview.text,
            preview_from_utf16: found_preview.from_utf16,
            preview_to_utf16: found_preview.to_utf16,
            leading_clipped: found_preview.leading_clipped,
            trailing_clipped: found_preview.trailing_clipped,
        });
        previous_byte = to_byte;
        previous_utf16 = from_utf16 + match_utf16;
    }
    Ok(false)
}

enum SearchMatcher {
    Literal(String),
    Regex {
        expression: Regex,
        whole_word: bool,
        expand_captures: bool,
    },
}

pub(crate) fn replace_text_line_local(
    content: &str,
    query: &str,
    replacement: &str,
    options: &SearchOptions,
    cancellation: &SearchCancellationToken,
    limits: SearchLimits,
) -> Result<(String, usize), WorkspaceError> {
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
    let mut match_count = 0;

    for line in source_lines(content) {
        check_cancelled(cancellation)?;
        let (replaced, count) = matcher.replace_all(line.text, &file_replacement, cancellation)?;
        match_count += count;
        output.push_str(&replaced);
        output.push_str(line.separator);
    }
    check_cancelled(cancellation)?;
    Ok((output, match_count))
}

struct SourceLine<'source> {
    text: &'source str,
    separator: &'source str,
}

fn source_lines(content: &str) -> Vec<SourceLine<'_>> {
    let bytes = content.as_bytes();
    let mut lines = Vec::new();
    let mut start = 0;
    let mut cursor = 0;
    while cursor < bytes.len() {
        let separator_length = match bytes[cursor] {
            b'\r' if bytes.get(cursor + 1) == Some(&b'\n') => 2,
            b'\r' | b'\n' => 1,
            _ => {
                cursor += 1;
                continue;
            }
        };
        lines.push(SourceLine {
            text: &content[start..cursor],
            separator: &content[cursor..cursor + separator_length],
        });
        cursor += separator_length;
        start = cursor;
    }
    lines.push(SourceLine {
        text: &content[start..],
        separator: "",
    });
    lines
}

fn dominant_separator(content: &str) -> &'static str {
    let mut crlf = 0;
    let mut lf = 0;
    let mut cr = 0;
    let bytes = content.as_bytes();
    let mut cursor = 0;
    while cursor < bytes.len() {
        match bytes[cursor] {
            b'\r' if bytes.get(cursor + 1) == Some(&b'\n') => {
                crlf += 1;
                cursor += 2;
            }
            b'\r' => {
                cr += 1;
                cursor += 1;
            }
            b'\n' => {
                lf += 1;
                cursor += 1;
            }
            _ => cursor += 1,
        }
    }
    if crlf >= lf && crlf >= cr && crlf > 0 {
        "\r\n"
    } else if cr > lf && cr > 0 {
        "\r"
    } else {
        "\n"
    }
}

impl SearchMatcher {
    fn compile(
        query: &str,
        mode: SearchMode,
        case_sensitive: bool,
        whole_word: bool,
        new_line: bool,
        cancellation: &SearchCancellationToken,
        limits: SearchLimits,
    ) -> Result<Self, WorkspaceError> {
        check_cancelled(cancellation)?;
        let matcher = match mode {
            SearchMode::Literal if case_sensitive && !whole_word => {
                Self::Literal(query.to_string())
            }
            SearchMode::Literal => {
                let expression = RegexBuilder::new(&regex::escape(query))
                    .unicode(true)
                    .case_insensitive(!case_sensitive)
                    .dot_matches_new_line(new_line)
                    .size_limit(limits.max_regex_size_bytes)
                    .dfa_size_limit(limits.max_regex_dfa_size_bytes)
                    .build()
                    .map_err(|error| WorkspaceError::InvalidSearch {
                        message: format!("invalid literal search: {error}"),
                    })?;
                Self::Regex {
                    expression,
                    whole_word,
                    expand_captures: false,
                }
            }
            SearchMode::Regex => {
                let expression = RegexBuilder::new(query)
                    .unicode(true)
                    .case_insensitive(!case_sensitive)
                    .dot_matches_new_line(new_line)
                    .size_limit(limits.max_regex_size_bytes)
                    .dfa_size_limit(limits.max_regex_dfa_size_bytes)
                    .build()
                    .map_err(|error| WorkspaceError::InvalidSearch {
                        message: format!("invalid regular expression: {error}"),
                    })?;
                Self::Regex {
                    expression,
                    whole_word,
                    expand_captures: true,
                }
            }
        };
        check_cancelled(cancellation)?;
        Ok(matcher)
    }

    fn ranges(
        &self,
        line: &str,
        cancellation: &SearchCancellationToken,
        max_ranges: usize,
    ) -> Result<Vec<(usize, usize)>, WorkspaceError> {
        match self {
            Self::Literal(query) => literal_ranges(line, query, cancellation, max_ranges),
            Self::Regex {
                expression,
                whole_word,
                ..
            } => {
                let mut ranges = Vec::new();
                for found in expression.find_iter(line) {
                    check_cancelled(cancellation)?;
                    if *whole_word && !whole_word_match(line, found.start(), found.end()) {
                        continue;
                    }
                    ranges.push((found.start(), found.end()));
                    if ranges.len() == max_ranges {
                        break;
                    }
                }
                check_cancelled(cancellation)?;
                Ok(ranges)
            }
        }
    }

    fn replace_all(
        &self,
        text: &str,
        replacement: &str,
        cancellation: &SearchCancellationToken,
    ) -> Result<(String, usize), WorkspaceError> {
        let mut output = String::with_capacity(text.len());
        let mut cursor = 0;
        let mut count = 0;
        match self {
            Self::Literal(query) => {
                for (from, to) in literal_ranges(text, query, cancellation, usize::MAX)? {
                    output.push_str(&text[cursor..from]);
                    output.push_str(replacement);
                    cursor = to;
                    count += 1;
                }
            }
            Self::Regex {
                expression,
                whole_word,
                expand_captures,
            } => {
                for captures in expression.captures_iter(text) {
                    check_cancelled(cancellation)?;
                    let found = captures
                        .get(0)
                        .expect("regex capture zero is always present");
                    if *whole_word && !whole_word_match(text, found.start(), found.end()) {
                        continue;
                    }
                    output.push_str(&text[cursor..found.start()]);
                    if *expand_captures {
                        captures.expand(replacement, &mut output);
                    } else {
                        output.push_str(replacement);
                    }
                    cursor = found.end();
                    count += 1;
                }
            }
        }
        output.push_str(&text[cursor..]);
        Ok((output, count))
    }
}

fn whole_word_match(text: &str, from: usize, to: usize) -> bool {
    let matched = &text[from..to];
    let first_is_word = matched.chars().next().is_some_and(is_word_character);
    let last_is_word = matched.chars().next_back().is_some_and(is_word_character);
    (!first_is_word
        || !text[..from]
            .chars()
            .next_back()
            .is_some_and(is_word_character))
        && (!last_is_word || !text[to..].chars().next().is_some_and(is_word_character))
}

fn is_word_character(character: char) -> bool {
    character == '_' || character.is_alphanumeric()
}

fn decode_search_escapes(query: &str) -> String {
    let mut decoded = String::with_capacity(query.len());
    let mut characters = query.chars().peekable();
    while let Some(character) = characters.next() {
        if character != '\\' {
            decoded.push(character);
            continue;
        }
        match characters.peek().copied() {
            Some('n') => {
                characters.next();
                decoded.push('\n');
            }
            Some('r') => {
                characters.next();
                decoded.push('\r');
            }
            Some('t') => {
                characters.next();
                decoded.push('\t');
            }
            Some('\\') => {
                characters.next();
                decoded.push('\\');
            }
            _ => decoded.push('\\'),
        }
    }
    decoded
}

struct PathFilters {
    include: Vec<Pattern>,
    exclude: Vec<Pattern>,
}

impl PathFilters {
    fn compile(
        options: &SearchOptions,
        cancellation: &SearchCancellationToken,
    ) -> Result<Self, WorkspaceError> {
        Ok(Self {
            include: compile_globs("include", &options.include_globs, cancellation)?,
            exclude: compile_globs("exclude", &options.exclude_globs, cancellation)?,
        })
    }

    fn is_empty(&self) -> bool {
        self.include.is_empty() && self.exclude.is_empty()
    }

    fn matches(&self, workspace_path: &str) -> bool {
        let options = MatchOptions {
            case_sensitive: true,
            require_literal_separator: true,
            require_literal_leading_dot: false,
        };
        let included = self.include.is_empty()
            || self
                .include
                .iter()
                .any(|pattern| pattern.matches_with(workspace_path, options));
        included
            && !self
                .exclude
                .iter()
                .any(|pattern| pattern.matches_with(workspace_path, options))
    }
}

fn validate_glob_list(
    kind: &str,
    patterns: &[String],
    max_patterns: usize,
    max_pattern_bytes: usize,
) -> Result<(), WorkspaceError> {
    if patterns.len() > max_patterns {
        return Err(WorkspaceError::InvalidSearch {
            message: format!("search accepts at most {max_patterns} {kind} path patterns"),
        });
    }
    for pattern in patterns {
        let invalid_component = pattern
            .split('/')
            .any(|component| component == "." || component == "..");
        if pattern.is_empty()
            || pattern.len() > max_pattern_bytes
            || pattern.starts_with('/')
            || pattern.contains(['\0', '\r', '\n', '\\', '{', '}'])
            || pattern.contains("//")
            || invalid_component
        {
            return Err(WorkspaceError::InvalidSearch {
                message: format!(
                    "{kind} path patterns must be relative '/'-separated globs of at most {max_pattern_bytes} bytes"
                ),
            });
        }
    }
    Ok(())
}

fn compile_globs(
    kind: &str,
    patterns: &[String],
    cancellation: &SearchCancellationToken,
) -> Result<Vec<Pattern>, WorkspaceError> {
    patterns
        .iter()
        .map(|source| {
            check_cancelled(cancellation)?;
            Pattern::new(source).map_err(|error| WorkspaceError::InvalidSearch {
                message: format!("invalid {kind} path pattern '{source}': {error}"),
            })
        })
        .collect()
}

fn context_preview(
    lines: &[&str],
    line_index: usize,
    from_byte: usize,
    to_byte: usize,
    context_lines: usize,
    limit: usize,
) -> Preview {
    if context_lines == 0 {
        return preview(lines[line_index], from_byte, to_byte, limit);
    }
    let first_line = line_index.saturating_sub(context_lines);
    let last_line = line_index
        .saturating_add(context_lines)
        .min(lines.len().saturating_sub(1));
    let before_match_bytes = lines[first_line..line_index]
        .iter()
        .map(|line| line.len() + 1)
        .sum::<usize>();
    let window = lines[first_line..=last_line].join("\n");
    preview(
        &window,
        before_match_bytes + from_byte,
        before_match_bytes + to_byte,
        limit,
    )
}

fn literal_ranges(
    line: &str,
    query: &str,
    cancellation: &SearchCancellationToken,
    max_ranges: usize,
) -> Result<Vec<(usize, usize)>, WorkspaceError> {
    let haystack = line.as_bytes();
    let needle = query.as_bytes();
    let finder = Finder::new(needle);
    let mut ranges = Vec::new();
    let mut chunk_start = 0;
    let mut next_allowed = 0;
    while chunk_start < haystack.len() {
        check_cancelled(cancellation)?;
        let owned_end = chunk_start
            .saturating_add(CANCELLATION_CHUNK_BYTES)
            .min(haystack.len());
        let search_end = owned_end
            .saturating_add(needle.len().saturating_sub(1))
            .min(haystack.len());
        let mut cursor = chunk_start.max(next_allowed);
        while cursor < search_end {
            let Some(relative) = finder.find(&haystack[cursor..search_end]) else {
                break;
            };
            let from = cursor + relative;
            if from >= owned_end {
                break;
            }
            let to = from + needle.len();
            ranges.push((from, to));
            if ranges.len() == max_ranges {
                return Ok(ranges);
            }
            next_allowed = to;
            cursor = to;
        }
        chunk_start = owned_end;
    }
    Ok(ranges)
}

struct Preview {
    text: String,
    from_utf16: usize,
    to_utf16: usize,
    leading_clipped: bool,
    trailing_clipped: bool,
}

fn preview(line: &str, from_byte: usize, to_byte: usize, limit: usize) -> Preview {
    let before = &line[..from_byte];
    let matched = &line[from_byte..to_byte];
    let after = &line[to_byte..];
    let match_units = matched.encode_utf16().count();
    if match_units > limit {
        let (matched, match_clipped) = prefix_utf16(matched, limit);
        return Preview {
            text: matched.to_string(),
            from_utf16: 0,
            to_utf16: matched.encode_utf16().count(),
            leading_clipped: !before.is_empty(),
            trailing_clipped: match_clipped || !after.is_empty(),
        };
    }
    let context = limit.saturating_sub(match_units);
    let before_budget = context / 2;
    let after_budget = context - before_budget;
    let (before, leading_clipped) = suffix_utf16(before, before_budget);
    let (after, trailing_clipped) = prefix_utf16(after, after_budget);
    let from_utf16 = before.encode_utf16().count();
    Preview {
        text: format!("{before}{matched}{after}"),
        from_utf16,
        to_utf16: from_utf16 + match_units,
        leading_clipped,
        trailing_clipped,
    }
}

fn suffix_utf16(value: &str, limit: usize) -> (&str, bool) {
    let total = value.encode_utf16().count();
    if total <= limit {
        return (value, false);
    }
    let mut retained = 0;
    let mut start = value.len();
    for (index, character) in value.char_indices().rev() {
        let units = character.len_utf16();
        if retained + units > limit {
            break;
        }
        retained += units;
        start = index;
    }
    (&value[start..], true)
}

fn prefix_utf16(value: &str, limit: usize) -> (&str, bool) {
    let total = value.encode_utf16().count();
    if total <= limit {
        return (value, false);
    }
    let mut retained = 0;
    let mut end = 0;
    for (index, character) in value.char_indices() {
        let units = character.len_utf16();
        if retained + units > limit {
            break;
        }
        retained += units;
        end = index + character.len_utf8();
    }
    (&value[..end], true)
}

fn normalize_newlines(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    let mut characters = value.chars().peekable();
    while let Some(character) = characters.next() {
        if character == '\r' {
            if characters.peek() == Some(&'\n') {
                characters.next();
            }
            normalized.push('\n');
        } else {
            normalized.push(character);
        }
    }
    normalized
}

fn read_search_bytes(path: &std::path::Path, limit: usize) -> std::io::Result<Vec<u8>> {
    let file = File::open(path)?;
    let mut bytes = Vec::with_capacity(limit.min(CANCELLATION_CHUNK_BYTES));
    file.take(limit as u64).read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn stable_metadata(before: &Metadata, after: &Metadata) -> bool {
    if before.len() != after.len()
        || before.permissions().readonly() != after.permissions().readonly()
        || before.modified().ok() != after.modified().ok()
    {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.dev() != after.dev()
            || before.ino() != after.ino()
            || before.mode() != after.mode()
        {
            return false;
        }
    }
    true
}

fn record_skip(
    report: &mut WorkspaceSearchReport,
    candidate_index: usize,
    candidate: &SearchCandidate,
    reason: SearchSkipReason,
    reported_limit: usize,
) {
    report.skipped_count += 1;
    if report.skipped_files.len() < reported_limit {
        report.skipped_files.push(SearchSkippedFile {
            candidate_index,
            workspace_path: candidate.workspace_path.clone(),
            reason,
        });
    }
}

fn skip_reason(error: &WorkspaceError) -> SearchSkipReason {
    match error {
        WorkspaceError::OutsideWorkspace { .. } | WorkspaceError::InvalidPath { .. } => {
            SearchSkipReason::UnsafePath
        }
        WorkspaceError::UnsupportedFile { .. } => SearchSkipReason::UnsupportedType,
        WorkspaceError::FileTooLarge { .. } => SearchSkipReason::TooLarge,
        WorkspaceError::BinaryFile { .. } => SearchSkipReason::BinaryNul,
        WorkspaceError::InvalidEncoding { .. } => SearchSkipReason::InvalidUtf8,
        WorkspaceError::Io { message, .. } => io_message_skip_reason(message),
        _ => SearchSkipReason::Io,
    }
}

fn io_skip_reason(error: &std::io::Error) -> SearchSkipReason {
    match error.kind() {
        std::io::ErrorKind::NotFound => SearchSkipReason::NotFound,
        std::io::ErrorKind::PermissionDenied => SearchSkipReason::PermissionDenied,
        _ => SearchSkipReason::Io,
    }
}

fn io_message_skip_reason(message: &str) -> SearchSkipReason {
    let lower = message.to_ascii_lowercase();
    if lower.contains("not found")
        || lower.contains("no such file")
        || raw_os_error_skip_reason(&lower) == Some(SearchSkipReason::NotFound)
    {
        SearchSkipReason::NotFound
    } else if lower.contains("permission denied")
        || lower.contains("access is denied")
        || raw_os_error_skip_reason(&lower) == Some(SearchSkipReason::PermissionDenied)
    {
        SearchSkipReason::PermissionDenied
    } else {
        SearchSkipReason::Io
    }
}

fn raw_os_error_skip_reason(message: &str) -> Option<SearchSkipReason> {
    let code = message
        .strip_suffix(')')?
        .rsplit_once("(os error ")?
        .1
        .parse::<i32>()
        .ok()?;
    match code {
        // ENOENT and ERROR_FILE_NOT_FOUND share the same numeric value.
        2 => Some(SearchSkipReason::NotFound),
        #[cfg(windows)]
        3 => Some(SearchSkipReason::NotFound),
        #[cfg(windows)]
        5 => Some(SearchSkipReason::PermissionDenied),
        #[cfg(unix)]
        1 | 13 => Some(SearchSkipReason::PermissionDenied),
        _ => None,
    }
}

fn check_cancelled(cancellation: &SearchCancellationToken) -> Result<(), WorkspaceError> {
    if cancellation.is_cancelled() {
        Err(WorkspaceError::Cancelled {
            message: "workspace search was cancelled".to_string(),
        })
    } else {
        Ok(())
    }
}

fn push_coverage(report: &mut WorkspaceSearchReport, reason: SearchCoverageReason) {
    if !report.coverage_reasons.contains(&reason) {
        report.coverage_reasons.push(reason);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn classifies_stable_raw_os_error_codes_without_localized_message_text() {
        assert_eq!(
            io_message_skip_reason("localized message (os error 2)"),
            SearchSkipReason::NotFound
        );

        #[cfg(windows)]
        {
            assert_eq!(
                io_message_skip_reason("localized message (os error 3)"),
                SearchSkipReason::NotFound
            );
            assert_eq!(
                io_message_skip_reason("localized message (os error 5)"),
                SearchSkipReason::PermissionDenied
            );
        }

        #[cfg(unix)]
        {
            assert_eq!(
                io_message_skip_reason("localized message (os error 13)"),
                SearchSkipReason::PermissionDenied
            );
        }
    }

    fn limits() -> SearchLimits {
        SearchLimits {
            max_candidates: 10,
            max_total_bytes: 1024 * 1024,
            max_matches: 20,
            max_preview_utf16: 16,
            max_reported_skips: 10,
            max_query_bytes: 256,
            max_path_patterns_per_kind: 4,
            max_path_pattern_bytes: 64,
            max_context_lines: 3,
            max_regex_size_bytes: 2 * 1024 * 1024,
            max_regex_dfa_size_bytes: 2 * 1024 * 1024,
        }
    }

    fn candidates(paths: &[&str]) -> Vec<SearchCandidate> {
        paths
            .iter()
            .map(|path| SearchCandidate {
                workspace_path: (*path).to_string(),
            })
            .collect()
    }

    #[test]
    fn reports_normalized_utf16_locations_and_non_overlapping_matches() {
        let directory = tempfile::tempdir().expect("workspace");
        fs::write(
            directory.path().join("unicode.txt"),
            "😀 first\r\nxx 😀😀\rlast",
        )
        .expect("fixture");
        let workspace = Workspace::open(directory.path()).expect("open");
        let report = workspace
            .search_literal_text(
                "search-1",
                &candidates(&["unicode.txt"]),
                false,
                "😀",
                &SearchCancellationToken::new(),
                limits(),
            )
            .expect("search");

        assert!(report.complete());
        assert_eq!(report.matches.len(), 3);
        assert_eq!(
            report
                .matches
                .iter()
                .map(|item| (item.line, item.column_utf16, item.from_utf16, item.to_utf16))
                .collect::<Vec<_>>(),
            vec![(1, 1, 0, 2), (2, 4, 12, 14), (2, 6, 14, 16)]
        );
    }

    #[test]
    fn clips_preview_on_scalar_boundaries_and_retains_the_match() {
        let directory = tempfile::tempdir().expect("workspace");
        fs::write(directory.path().join("line.txt"), "abcdef😀MATCHuvwxyz").expect("fixture");
        let workspace = Workspace::open(directory.path()).expect("open");
        let mut test_limits = limits();
        test_limits.max_preview_utf16 = 10;
        let report = workspace
            .search_literal_text(
                "search-2",
                &candidates(&["line.txt"]),
                false,
                "MATCH",
                &SearchCancellationToken::new(),
                test_limits,
            )
            .expect("search");
        let found = &report.matches[0];
        assert!(found.leading_clipped);
        assert!(found.trailing_clipped);
        assert_eq!(found.preview.encode_utf16().count(), 10);
        assert_eq!(
            found
                .preview
                .encode_utf16()
                .skip(found.preview_from_utf16)
                .take(found.preview_to_utf16 - found.preview_from_utf16)
                .collect::<Vec<_>>(),
            "MATCH".encode_utf16().collect::<Vec<_>>()
        );
    }

    #[test]
    fn literal_search_is_case_sensitive_and_preserves_combining_sequences() {
        let directory = tempfile::tempdir().expect("workspace");
        fs::write(directory.path().join("case.txt"), "Cafe\u{301} cafe CAFÉ").expect("fixture");
        let workspace = Workspace::open(directory.path()).expect("open");
        let report = workspace
            .search_literal_text(
                "search-case",
                &candidates(&["case.txt"]),
                false,
                "Cafe\u{301}",
                &SearchCancellationToken::new(),
                limits(),
            )
            .expect("search");

        assert_eq!(report.matches.len(), 1);
        assert_eq!(report.matches[0].from_utf16, 0);
        assert_eq!(report.matches[0].to_utf16, 5);
    }

    #[test]
    fn query_options_cover_case_words_and_normalized_multiline_text() {
        let directory = tempfile::tempdir().expect("workspace");
        fs::write(
            directory.path().join("options.txt"),
            "Needle needle needled\nalpha\r\nbeta",
        )
        .expect("fixture");
        let workspace = Workspace::open(directory.path()).expect("open");
        let candidates = candidates(&["options.txt"]);
        let search = |id: &str, query: &str, options: SearchOptions| {
            workspace
                .search_text(
                    id,
                    &candidates,
                    false,
                    query,
                    &options,
                    &SearchCancellationToken::new(),
                    limits(),
                )
                .expect("search")
        };

        assert_eq!(
            search("case-folded", "needle", SearchOptions::default())
                .matches
                .len(),
            3
        );
        assert_eq!(
            search(
                "case-sensitive",
                "needle",
                SearchOptions {
                    case_sensitive: true,
                    ..SearchOptions::default()
                },
            )
            .matches
            .len(),
            2,
        );
        assert_eq!(
            search(
                "whole-word",
                "needle",
                SearchOptions {
                    whole_word: true,
                    ..SearchOptions::default()
                },
            )
            .matches
            .len(),
            2,
        );
        let multiline = search(
            "multiline",
            "alpha\\nbeta",
            SearchOptions {
                new_line: true,
                ..SearchOptions::default()
            },
        );
        assert_eq!(multiline.matches.len(), 1);
        assert_eq!(
            (multiline.matches[0].line, multiline.matches[0].column_utf16),
            (2, 1)
        );
        assert_eq!(
            search(
                "multiline-regex",
                "alpha.*beta",
                SearchOptions {
                    mode: SearchMode::Regex,
                    new_line: true,
                    ..SearchOptions::default()
                },
            )
            .matches
            .len(),
            1,
        );
    }

    #[test]
    fn regex_search_is_line_local_case_sensitive_and_supports_inline_flags_and_zero_width() {
        let directory = tempfile::tempdir().expect("workspace");
        fs::write(directory.path().join("regex.txt"), "Needle needle\nabc 123").expect("fixture");
        let workspace = Workspace::open(directory.path()).expect("open");
        let regex = SearchOptions {
            mode: SearchMode::Regex,
            ..SearchOptions::default()
        };
        let report = workspace
            .search_text(
                "search-regex",
                &candidates(&["regex.txt"]),
                false,
                "(?i)needle|^abc",
                &regex,
                &SearchCancellationToken::new(),
                limits(),
            )
            .expect("regex search");
        assert_eq!(
            report
                .matches
                .iter()
                .map(|found| (found.line, found.column_utf16))
                .collect::<Vec<_>>(),
            vec![(1, 1), (1, 8), (2, 1)]
        );

        let zero_width = workspace
            .search_text(
                "search-zero-width",
                &candidates(&["regex.txt"]),
                false,
                "^",
                &regex,
                &SearchCancellationToken::new(),
                limits(),
            )
            .expect("zero-width regex search");
        assert_eq!(zero_width.matches.len(), 2);
        assert!(
            zero_width
                .matches
                .iter()
                .all(|found| found.from_utf16 == found.to_utf16)
        );
    }

    #[test]
    fn path_filters_match_full_workspace_paths_and_preserve_catalog_indices() {
        let directory = tempfile::tempdir().expect("workspace");
        for path in [
            "root.rs",
            "src/lib.rs",
            "src/generated/out.rs",
            "module/src/lib.rs",
        ] {
            let path = directory.path().join(path);
            fs::create_dir_all(path.parent().expect("parent")).expect("directory");
            fs::write(path, "needle").expect("fixture");
        }
        let workspace = Workspace::open(directory.path()).expect("open");
        let catalog = candidates(&[
            "root.rs",
            "src/lib.rs",
            "src/generated/out.rs",
            "module/src/lib.rs",
        ]);
        let filtered = SearchOptions {
            include_globs: vec!["src/**".to_string()],
            exclude_globs: vec!["src/generated/**".to_string()],
            ..SearchOptions::default()
        };
        let report = workspace
            .search_text(
                "search-paths",
                &catalog,
                false,
                "needle",
                &filtered,
                &SearchCancellationToken::new(),
                limits(),
            )
            .expect("filtered search");
        assert!(report.complete());
        assert_eq!(report.catalog_candidates, 4);
        assert_eq!(report.eligible_candidates, 1);
        assert_eq!(report.files_searched, 1);
        assert_eq!(report.matches[0].candidate_index, 1);

        let root_only = SearchOptions {
            include_globs: vec!["*.rs".to_string()],
            ..SearchOptions::default()
        };
        let report = workspace
            .search_text(
                "search-root-only",
                &catalog,
                false,
                "needle",
                &root_only,
                &SearchCancellationToken::new(),
                limits(),
            )
            .expect("root-only search");
        assert_eq!(report.eligible_candidates, 1);
        assert_eq!(report.matches[0].workspace_path, "root.rs");

        let submodule = SearchOptions {
            include_globs: vec!["module/**".to_string()],
            ..SearchOptions::default()
        };
        let report = workspace
            .search_text(
                "search-submodule",
                &catalog,
                false,
                "needle",
                &submodule,
                &SearchCancellationToken::new(),
                limits(),
            )
            .expect("submodule search");
        assert_eq!(report.matches[0].candidate_index, 3);
    }

    #[test]
    fn context_preview_expands_lines_and_clips_an_oversized_match_safely() {
        let directory = tempfile::tempdir().expect("workspace");
        fs::write(
            directory.path().join("context.txt"),
            "first\nbefore\nneedle\nafter\nlast",
        )
        .expect("fixture");
        fs::write(directory.path().join("long.txt"), "pre😀😀😀after").expect("fixture");
        let workspace = Workspace::open(directory.path()).expect("open");
        let contextual = SearchOptions {
            context_lines: 1,
            ..SearchOptions::default()
        };
        let mut contextual_limits = limits();
        contextual_limits.max_preview_utf16 = 64;
        let report = workspace
            .search_text(
                "search-context",
                &candidates(&["context.txt"]),
                false,
                "needle",
                &contextual,
                &SearchCancellationToken::new(),
                contextual_limits,
            )
            .expect("context search");
        assert_eq!(report.matches[0].preview, "before\nneedle\nafter");
        assert_eq!(report.matches[0].preview_from_utf16, 7);
        assert_eq!(report.matches[0].preview_to_utf16, 13);

        let mut short_preview = limits();
        short_preview.max_preview_utf16 = 4;
        let report = workspace
            .search_literal_text(
                "search-long-match",
                &candidates(&["long.txt"]),
                false,
                "😀😀😀",
                &SearchCancellationToken::new(),
                short_preview,
            )
            .expect("long match search");
        let found = &report.matches[0];
        assert_eq!(found.preview, "😀😀");
        assert_eq!(found.preview_from_utf16, 0);
        assert_eq!(found.preview_to_utf16, 4);
        assert_eq!(found.to_utf16 - found.from_utf16, 6);
        assert!(found.leading_clipped);
        assert!(found.trailing_clipped);
    }

    #[test]
    fn rejects_invalid_regex_globs_and_context_bounds() {
        let directory = tempfile::tempdir().expect("workspace");
        fs::write(directory.path().join("source.txt"), "text").expect("fixture");
        let workspace = Workspace::open(directory.path()).expect("open");
        let candidate = candidates(&["source.txt"]);
        let invalid = [
            SearchOptions {
                mode: SearchMode::Regex,
                ..SearchOptions::default()
            },
            SearchOptions {
                include_globs: vec!["../*.rs".to_string()],
                ..SearchOptions::default()
            },
            SearchOptions {
                exclude_globs: vec!["src/{one,two}.rs".to_string()],
                ..SearchOptions::default()
            },
            SearchOptions {
                context_lines: 4,
                ..SearchOptions::default()
            },
        ];
        for (index, options) in invalid.iter().enumerate() {
            let query = if index == 0 { "[" } else { "text" };
            assert!(matches!(
                workspace.search_text(
                    &format!("search-invalid-{index}"),
                    &candidate,
                    false,
                    query,
                    options,
                    &SearchCancellationToken::new(),
                    limits(),
                ),
                Err(WorkspaceError::InvalidSearch { .. })
            ));
        }
    }

    #[test]
    fn reports_partial_coverage_for_skips_catalog_and_match_limits() {
        let directory = tempfile::tempdir().expect("workspace");
        fs::write(directory.path().join("many.txt"), "x x x").expect("fixture");
        fs::write(directory.path().join("binary"), b"x\0x").expect("fixture");
        let workspace = Workspace::open(directory.path()).expect("open");
        let mut test_limits = limits();
        test_limits.max_matches = 2;
        let report = workspace
            .search_literal_text(
                "search-3",
                &candidates(&["many.txt", "binary"]),
                true,
                "x",
                &SearchCancellationToken::new(),
                test_limits,
            )
            .expect("search");
        assert_eq!(report.matches.len(), 2);
        assert!(
            report
                .coverage_reasons
                .contains(&SearchCoverageReason::CatalogTruncated)
        );
        assert!(
            report
                .coverage_reasons
                .contains(&SearchCoverageReason::MatchLimit)
        );
    }

    #[test]
    fn accounts_for_binary_invalid_utf8_large_missing_and_unsafe_files() {
        let directory = tempfile::tempdir().expect("workspace");
        fs::write(directory.path().join("binary"), b"a\0b").expect("binary");
        fs::write(directory.path().join("latin"), [0xff, 0xfe]).expect("latin");
        fs::write(directory.path().join("exact"), b"1234").expect("exact limit");
        fs::write(directory.path().join("large"), b"12345").expect("large");
        let workspace = Workspace::with_text_limit(directory.path(), 4).expect("open");
        let report = workspace
            .search_literal_text(
                "search-4",
                &candidates(&["exact", "binary", "latin", "large", "missing", "../escape"]),
                false,
                "a",
                &SearchCancellationToken::new(),
                limits(),
            )
            .expect("search");
        assert_eq!(report.skipped_count, 5);
        assert_eq!(report.files_searched, 1);
        assert_eq!(
            report
                .skipped_files
                .iter()
                .map(|item| item.reason)
                .collect::<Vec<_>>(),
            vec![
                SearchSkipReason::BinaryNul,
                SearchSkipReason::InvalidUtf8,
                SearchSkipReason::TooLarge,
                SearchSkipReason::NotFound,
                SearchSkipReason::UnsafePath,
            ]
        );
        assert!(
            report
                .coverage_reasons
                .contains(&SearchCoverageReason::SkippedFiles)
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_catalogued_symlink_without_reading_its_external_target() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().expect("workspace");
        let outside = tempfile::tempdir().expect("outside");
        fs::write(outside.path().join("secret"), "needle outside").expect("outside fixture");
        symlink(
            outside.path().join("secret"),
            directory.path().join("linked"),
        )
        .expect("symlink fixture");
        let workspace = Workspace::open(directory.path()).expect("open");
        let report = workspace
            .search_literal_text(
                "search-symlink",
                &candidates(&["linked"]),
                false,
                "needle",
                &SearchCancellationToken::new(),
                limits(),
            )
            .expect("search reports the unsupported candidate");

        assert!(report.matches.is_empty());
        assert_eq!(report.skipped_count, 1);
        assert_eq!(report.skipped_files[0].reason, SearchSkipReason::UnsafePath);
        assert!(!report.complete());
    }

    #[test]
    fn enforces_candidate_byte_and_query_limits_and_cancellation() {
        let directory = tempfile::tempdir().expect("workspace");
        fs::write(directory.path().join("a"), "abc").expect("a");
        fs::write(directory.path().join("b"), "abc").expect("b");
        let workspace = Workspace::open(directory.path()).expect("open");
        let mut candidate_limits = limits();
        candidate_limits.max_candidates = 1;
        let candidate_report = workspace
            .search_literal_text(
                "search-5",
                &candidates(&["a", "b"]),
                false,
                "a",
                &SearchCancellationToken::new(),
                candidate_limits,
            )
            .expect("candidate search");
        assert!(
            candidate_report
                .coverage_reasons
                .contains(&SearchCoverageReason::CandidateLimit)
        );

        let mut byte_limits = limits();
        byte_limits.max_total_bytes = 3;
        let byte_report = workspace
            .search_literal_text(
                "search-6",
                &candidates(&["a", "b"]),
                false,
                "a",
                &SearchCancellationToken::new(),
                byte_limits,
            )
            .expect("byte search");
        assert!(
            byte_report
                .coverage_reasons
                .contains(&SearchCoverageReason::ByteLimit)
        );

        assert!(matches!(
            workspace.search_literal_text(
                "search-7",
                &candidates(&["a"]),
                false,
                "",
                &SearchCancellationToken::new(),
                limits(),
            ),
            Err(WorkspaceError::InvalidSearch { .. })
        ));
        let exact_query = "a".repeat(256);
        fs::write(directory.path().join("query"), &exact_query).expect("query fixture");
        let mut exact_query_limits = limits();
        exact_query_limits.max_preview_utf16 = 256;
        let exact_query_report = workspace
            .search_literal_text(
                "search-query-exact",
                &candidates(&["query"]),
                false,
                &exact_query,
                &SearchCancellationToken::new(),
                exact_query_limits,
            )
            .expect("256-unit query is accepted");
        assert_eq!(exact_query_report.matches.len(), 1);
        assert!(matches!(
            workspace.search_literal_text(
                "search-query-large",
                &candidates(&["query"]),
                false,
                &"a".repeat(257),
                &SearchCancellationToken::new(),
                exact_query_limits,
            ),
            Err(WorkspaceError::InvalidSearch { .. })
        ));
        let cancellation = SearchCancellationToken::new();
        cancellation.cancel();
        assert!(matches!(
            workspace.search_literal_text(
                "search-8",
                &candidates(&["a"]),
                false,
                "a",
                &cancellation,
                limits(),
            ),
            Err(WorkspaceError::Cancelled { .. })
        ));
    }
}
