use super::*;
use std::time::{Duration, Instant};

fn setup(mode: &str) -> (PluginHostSupervisor, TempDir) {
    let fixture = fixture_path().canonicalize().unwrap();
    let supervisor =
        PluginHostSupervisor::from_verified_helper(&fixture, fixture.parent().unwrap()).unwrap();
    let plugin = TempDir::new().unwrap();
    fs::create_dir(plugin.path().join("runtime")).unwrap();
    fs::write(plugin.path().join("runtime/plugin.js"), b"fixture").unwrap();
    let mut request = activation(plugin.path());
    request.evidence = json!({"cpuFixture": mode});
    supervisor.activate(request).unwrap();
    (supervisor, plugin)
}

#[test]
#[ignore = "real OS CPU soak: consumes 65 CPU seconds over more than two minutes"]
fn actual_helper_remains_usable_beyond_the_old_lifetime_cpu_limit() {
    let (supervisor, plugin) = setup("lifetime");
    let started = Instant::now();
    let completed = plugin.path().join("cpu-completed.json");
    while !completed.exists() && started.elapsed() < Duration::from_secs(240) {
        assert_eq!(
            supervisor.active_count(),
            1,
            "healthy low-rate helper expired"
        );
        std::thread::sleep(Duration::from_millis(100));
    }
    let result: serde_json::Value =
        serde_json::from_slice(&fs::read(completed).expect("CPU soak completed")).unwrap();
    assert!(result["cpuMillis"].as_u64().unwrap() >= 65_000);
    let echo = supervisor
        .invoke(
            "window-main",
            "dev.asterlyn.fixture",
            "callback-1",
            "execute",
            json!({"afterCpuSoak": true}),
        )
        .unwrap();
    assert_eq!(echo["afterCpuSoak"], true);
    println!(
        "CPU lifetime soak: {} ms CPU, {} ms wall; post-soak invocation passed",
        result["cpuMillis"],
        started.elapsed().as_millis()
    );
    supervisor.cancel_owner("window-main", ShutdownReason::WindowClosed);
}

#[test]
#[ignore = "real OS runaway CPU containment: consumes 60 CPU seconds"]
fn actual_idle_cpu_excess_is_contained_without_an_active_request() {
    let (supervisor, _plugin) = setup("excess");
    let events = supervisor.observe_terminations();
    let started = Instant::now();
    let event = events
        .recv_timeout(Duration::from_secs(90))
        .expect("runaway helper contained");
    assert_eq!(event.reason, PluginSessionTerminationReason::ResourceLimit);
    assert!(event.detail.contains("rolling 60-second"));
    assert_eq!(supervisor.active_count(), 0);
    println!(
        "CPU runaway contained in {} ms: {}",
        started.elapsed().as_millis(),
        event.detail
    );
}
