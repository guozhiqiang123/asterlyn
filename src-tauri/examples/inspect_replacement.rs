use std::env;
use std::process::ExitCode;
use std::time::Instant;

use asterlyn_git::GitRepository;
use asterlyn_lib::{WORKSPACE_REPLACEMENT_LIMITS, WORKSPACE_SEARCH_LIMITS};
use asterlyn_workspace::{
    SearchCancellationToken, SearchCandidate, SearchMode, SearchOptions, Workspace,
};

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let mut arguments = env::args().skip(1);
    let usage = "usage: inspect_replacement <repository> <query> <replacement> [iterations] [--regex] [--include <glob>] [--exclude <glob>] [--context <0-3>]";
    let path = arguments.next().ok_or_else(|| usage.to_string())?;
    let query = arguments.next().ok_or_else(|| usage.to_string())?;
    let replacement = arguments.next().ok_or_else(|| usage.to_string())?;
    let mut remaining = arguments.collect::<Vec<_>>().into_iter().peekable();
    let iterations = if remaining
        .peek()
        .is_some_and(|value| !value.starts_with("--"))
    {
        remaining
            .next()
            .expect("peeked argument exists")
            .parse::<usize>()
            .map_err(|error| format!("invalid iteration count: {error}"))?
            .clamp(1, 100)
    } else {
        10
    };
    let mut options = SearchOptions::default();
    while let Some(argument) = remaining.next() {
        match argument.as_str() {
            "--regex" => options.mode = SearchMode::Regex,
            "--include" => options
                .include_globs
                .push(remaining.next().ok_or_else(|| usage.to_string())?),
            "--exclude" => options
                .exclude_globs
                .push(remaining.next().ok_or_else(|| usage.to_string())?),
            "--context" => {
                options.context_lines = remaining
                    .next()
                    .ok_or_else(|| usage.to_string())?
                    .parse::<usize>()
                    .map_err(|error| format!("invalid context line count: {error}"))?;
            }
            _ => return Err(format!("unknown argument '{argument}'\n{usage}")),
        }
    }

    let mut catalog_micros = Vec::with_capacity(iterations);
    let mut plan_micros = Vec::with_capacity(iterations);
    let mut total_micros = Vec::with_capacity(iterations);
    let mut last_catalog_count = 0;
    let mut last_catalog_truncated = false;
    let mut last_preview = None;

    for iteration in 0..iterations {
        let total_started = Instant::now();
        let catalog_started = Instant::now();
        let catalog = GitRepository::open(&path)
            .and_then(|repository| {
                repository.authorized_project_files(WORKSPACE_SEARCH_LIMITS.max_candidates)
            })
            .map_err(|error| error.to_string())?;
        catalog_micros.push(catalog_started.elapsed().as_micros());
        let candidates = catalog
            .files
            .iter()
            .map(|file| SearchCandidate {
                workspace_path: file.workspace_path.clone(),
            })
            .collect::<Vec<_>>();

        let plan_started = Instant::now();
        let plan = Workspace::open(&path)
            .map_err(|error| error.to_string())?
            .plan_text_replacement(
                &format!("inspect-replacement-{iteration}"),
                &candidates,
                catalog.truncated,
                &query,
                &replacement,
                &options,
                &SearchCancellationToken::new(),
                WORKSPACE_SEARCH_LIMITS,
                WORKSPACE_REPLACEMENT_LIMITS,
            )
            .map_err(|error| error.to_string())?;
        plan_micros.push(plan_started.elapsed().as_micros());
        total_micros.push(total_started.elapsed().as_micros());
        last_catalog_count = catalog.files.len();
        last_catalog_truncated = catalog.truncated;
        last_preview = Some(plan.preview().clone());
    }

    catalog_micros.sort_unstable();
    plan_micros.sort_unstable();
    total_micros.sort_unstable();
    let preview = last_preview.expect("at least one iteration is required");
    println!("iterations={iterations}");
    println!("catalog_candidates={last_catalog_count}");
    println!("catalog_truncated={last_catalog_truncated}");
    println!("replacement_files={}", preview.files.len());
    println!("replacement_matches={}", preview.total_matches);
    println!("skipped={}", preview.skipped_count);
    println!("coverage_reasons={:?}", preview.coverage_reasons);
    print_timings("catalog", &catalog_micros);
    print_timings("plan", &plan_micros);
    print_timings("total", &total_micros);
    Ok(())
}

fn print_timings(label: &str, timings: &[u128]) {
    println!("{label}_min_ms={:.3}", milliseconds(timings[0]));
    println!(
        "{label}_median_ms={:.3}",
        milliseconds(percentile(timings, 0.50))
    );
    println!(
        "{label}_p95_ms={:.3}",
        milliseconds(percentile(timings, 0.95))
    );
    println!(
        "{label}_max_ms={:.3}",
        milliseconds(*timings.last().expect("timings exist"))
    );
}

fn percentile(values: &[u128], percentile: f64) -> u128 {
    let index = ((values.len() - 1) as f64 * percentile).ceil() as usize;
    values[index]
}

fn milliseconds(microseconds: u128) -> f64 {
    microseconds as f64 / 1_000.0
}
