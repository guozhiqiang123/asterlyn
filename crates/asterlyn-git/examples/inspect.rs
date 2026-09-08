use std::env;
use std::process::ExitCode;
use std::time::Instant;

use asterlyn_git::{CancellationToken, GitRepository, UntrackedState};

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
    let path = arguments
        .next()
        .ok_or_else(|| "usage: inspect <repository> [iterations]".to_string())?;
    let iterations = arguments
        .next()
        .map(|value| value.parse::<usize>())
        .transpose()
        .map_err(|error| format!("invalid iteration count: {error}"))?
        .unwrap_or(10)
        .clamp(1, 100);

    let repository = GitRepository::open(&path).map_err(|error| error.to_string())?;
    let mut snapshot_micros = Vec::with_capacity(iterations);
    let mut tracked_micros = Vec::with_capacity(iterations);
    let mut untracked_micros = Vec::with_capacity(iterations);
    let mut last_snapshot = None;

    for _ in 0..iterations {
        let snapshot_started = Instant::now();
        let tracked_started = Instant::now();
        let mut snapshot = repository
            .tracked_snapshot(150)
            .map_err(|error| error.to_string())?;
        tracked_micros.push(tracked_started.elapsed().as_micros());

        let untracked_started = Instant::now();
        let untracked = repository
            .untracked_changes(&CancellationToken::new())
            .map_err(|error| error.to_string())?;
        untracked_micros.push(untracked_started.elapsed().as_micros());
        snapshot.changes.extend(untracked.changes);
        snapshot
            .changes
            .sort_by(|left, right| left.path.cmp(&right.path));
        snapshot.untracked_state = UntrackedState::Complete;

        snapshot_micros.push(snapshot_started.elapsed().as_micros());
        last_snapshot = Some(snapshot);
    }

    snapshot_micros.sort_unstable();
    tracked_micros.sort_unstable();
    untracked_micros.sort_unstable();
    let snapshot = last_snapshot.expect("at least one iteration is required");
    println!("root={}", snapshot.root);
    println!("changes={}", snapshot.changes.len());
    println!("commits={}", snapshot.commits.len());
    println!("refs={}", snapshot.branches.len());
    println!("iterations={iterations}");
    println!("snapshot_min_ms={:.3}", milliseconds(snapshot_micros[0]));
    println!(
        "snapshot_median_ms={:.3}",
        milliseconds(percentile(&snapshot_micros, 0.50))
    );
    println!(
        "snapshot_p95_ms={:.3}",
        milliseconds(percentile(&snapshot_micros, 0.95))
    );
    println!(
        "snapshot_max_ms={:.3}",
        milliseconds(*snapshot_micros.last().expect("timings exist"))
    );
    print_timings("tracked", &tracked_micros);
    print_timings("untracked", &untracked_micros);

    if let Some(change) = snapshot.changes.first() {
        let staged = change.has_staged_change();
        let started = Instant::now();
        let diff = repository
            .diff(&change.path, staged)
            .map_err(|error| error.to_string())?;
        println!("sample_diff_path={}", diff.path);
        println!("sample_diff_bytes={}", diff.patch.len());
        println!(
            "sample_diff_ms={:.3}",
            started.elapsed().as_secs_f64() * 1000.0
        );
    }

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
    microseconds as f64 / 1000.0
}
