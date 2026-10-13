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
fn a_warm_index_prunes_definite_misses_and_refreshes_stale_entries() {
    let directory = tempfile::tempdir().expect("workspace");
    fs::write(directory.path().join("App.kt"), "class SearchNeedle\n").expect("hit fixture");
    fs::write(directory.path().join("other.dart"), "void unrelated() {}\n").expect("miss fixture");
    let workspace = Workspace::open(directory.path()).expect("open");
    let candidates = candidates(&["App.kt", "other.dart"]);
    let mut index = SearchContentIndex::empty();

    let cold = workspace
        .search_text_with_index(
            "cold",
            &candidates,
            false,
            "SearchNeedle",
            &SearchOptions::default(),
            &SearchCancellationToken::new(),
            limits(),
            &mut index,
        )
        .expect("cold search");
    assert_eq!(cold.matches.len(), 1);
    assert_eq!(cold.files_searched, 2);
    assert_eq!(cold.index_pruned_candidates, 0);

    let warm = workspace
        .search_text_with_index(
            "warm",
            &candidates,
            false,
            "SearchNeedle",
            &SearchOptions::default(),
            &SearchCancellationToken::new(),
            limits(),
            &mut index,
        )
        .expect("warm search");
    assert_eq!(warm.matches, cold.matches);
    assert_eq!(warm.files_searched, 1);
    assert_eq!(warm.index_pruned_candidates, 1);

    fs::write(
        directory.path().join("other.dart"),
        "const value = 'SearchNeedle';\n",
    )
    .expect("change fixture");
    let refreshed = workspace
        .search_text_with_index(
            "refreshed",
            &candidates,
            false,
            "SearchNeedle",
            &SearchOptions::default(),
            &SearchCancellationToken::new(),
            limits(),
            &mut index,
        )
        .expect("refreshed search");
    assert_eq!(refreshed.matches.len(), 2);
    assert_eq!(refreshed.files_searched, 2);
    assert_eq!(refreshed.index_pruned_candidates, 0);
}

#[test]
fn regex_queries_scan_even_when_a_literal_index_exists() {
    let directory = tempfile::tempdir().expect("workspace");
    fs::write(directory.path().join("App.kt"), "class SearchNeedle\n").expect("fixture");
    let workspace = Workspace::open(directory.path()).expect("open");
    let candidates = candidates(&["App.kt"]);
    let mut index = SearchContentIndex::empty();
    workspace
        .search_text_with_index(
            "literal",
            &candidates,
            false,
            "SearchNeedle",
            &SearchOptions::default(),
            &SearchCancellationToken::new(),
            limits(),
            &mut index,
        )
        .expect("literal search");
    let regex = workspace
        .search_text_with_index(
            "regex",
            &candidates,
            false,
            "Search.*",
            &SearchOptions {
                mode: SearchMode::Regex,
                ..SearchOptions::default()
            },
            &SearchCancellationToken::new(),
            limits(),
            &mut index,
        )
        .expect("regex search");
    assert_eq!(regex.matches.len(), 1);
    assert_eq!(regex.files_searched, 1);
    assert_eq!(regex.index_pruned_candidates, 0);
}

#[test]
fn a_warm_index_reuses_typed_skips_but_rechecks_changed_files() {
    let directory = tempfile::tempdir().expect("workspace");
    let path = directory.path().join("asset.kt");
    fs::write(&path, b"binary\0payload").expect("binary fixture");
    let workspace = Workspace::open(directory.path()).expect("open");
    let candidates = candidates(&["asset.kt"]);
    let mut index = SearchContentIndex::empty();

    let cold = workspace
        .search_text_with_index(
            "binary-cold",
            &candidates,
            false,
            "SearchNeedle",
            &SearchOptions::default(),
            &SearchCancellationToken::new(),
            limits(),
            &mut index,
        )
        .expect("cold search");
    assert_eq!(cold.skipped_count, 1);
    assert!(cold.bytes_read > 0);

    let warm = workspace
        .search_text_with_index(
            "binary-warm",
            &candidates,
            false,
            "SearchNeedle",
            &SearchOptions::default(),
            &SearchCancellationToken::new(),
            limits(),
            &mut index,
        )
        .expect("warm search");
    assert_eq!(warm.skipped_count, 1);
    assert_eq!(warm.bytes_read, 0);

    fs::write(&path, "class SearchNeedleWithLongerContent\n").expect("text fixture");
    let refreshed = workspace
        .search_text_with_index(
            "binary-refreshed",
            &candidates,
            false,
            "SearchNeedle",
            &SearchOptions::default(),
            &SearchCancellationToken::new(),
            limits(),
            &mut index,
        )
        .expect("refreshed search");
    assert_eq!(refreshed.skipped_count, 0);
    assert_eq!(refreshed.matches.len(), 1);
    assert_eq!(refreshed.files_searched, 1);
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
