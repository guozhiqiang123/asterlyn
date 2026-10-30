use std::fs;
use std::path::{Path, PathBuf};

use asterlyn_plugin_runtime::{
    PluginActivation, PluginHostSupervisor, PluginRuntimeIdentity, PluginSessionTerminationReason,
};
use asterlyn_plugin_runtime_protocol::{HostTheme, ShutdownReason};
use serde_json::json;
use tempfile::TempDir;

#[cfg(unix)]
mod cpu_soak;

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_asterlyn-plugin-runtime-fixture"))
}

fn activation(root: &Path) -> PluginActivation {
    PluginActivation {
        owner: "window-main".to_owned(),
        plugin_root: root.to_path_buf(),
        identity: PluginRuntimeIdentity {
            plugin_id: "dev.asterlyn.fixture".to_owned(),
            plugin_version: "1.0.0".to_owned(),
            package_digest: format!("sha256:{}", "a".repeat(64)),
            runtime_entry: "runtime/plugin.js".to_owned(),
        },
        capabilities: vec!["workspace.read".to_owned()],
        permissions: vec!["workspace.read".to_owned()],
        workspace_id: "workspace-1".to_owned(),
        workspace_generation: 1,
        workspace_root: "/workspace".to_owned(),
        evidence: json!({"files": []}),
        locale: "en-US".to_owned(),
        theme: HostTheme::Dark,
    }
}

#[cfg(unix)]
#[test]
fn long_lived_helper_inherits_cpu_policy_without_a_sixty_second_expiry() {
    let fixture = fixture_path().canonicalize().expect("fixture path");
    let supervisor =
        PluginHostSupervisor::from_verified_helper(&fixture, fixture.parent().unwrap()).unwrap();
    let plugin = TempDir::new().unwrap();
    fs::create_dir(plugin.path().join("runtime")).unwrap();
    fs::write(plugin.path().join("runtime/plugin.js"), b"fixture").unwrap();
    let mut inherited = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    // SAFETY: initialized local buffer of the required kernel layout.
    assert_eq!(
        unsafe { libc::getrlimit(libc::RLIMIT_CPU, &mut inherited) },
        0
    );
    supervisor.activate(activation(plugin.path())).unwrap();
    let policy = supervisor
        .invoke(
            "window-main",
            "dev.asterlyn.fixture",
            "callback-1",
            "resource-policy",
            json!({}),
        )
        .unwrap();
    assert_eq!(policy["cpuSoft"], inherited.rlim_cur.to_string());
    assert_eq!(policy["cpuHard"], inherited.rlim_max.to_string());
    supervisor.cancel_owner("window-main", ShutdownReason::WindowClosed);
}

#[test]
fn activates_invokes_and_shuts_down_an_isolated_session() {
    let fixture = fixture_path().canonicalize().expect("fixture path");
    let installation = fixture.parent().expect("fixture parent");
    let supervisor =
        PluginHostSupervisor::from_verified_helper(&fixture, installation).expect("supervisor");
    let plugin = TempDir::new().expect("plugin root");
    fs::create_dir(plugin.path().join("runtime")).expect("runtime directory");
    fs::write(plugin.path().join("runtime/plugin.js"), b"fixture").expect("runtime entry");

    let activated = supervisor
        .activate(activation(plugin.path()))
        .expect("activate");
    assert_eq!(activated.contributions.len(), 1);
    assert_eq!(supervisor.active_count(), 1);
    supervisor
        .assert_active_session(
            "window-main",
            "dev.asterlyn.fixture",
            "1.0.0",
            &format!("sha256:{}", "a".repeat(64)),
            &activated.session_id,
        )
        .expect("exact session health identity");
    assert!(
        supervisor
            .assert_active_session(
                "window-main",
                "dev.asterlyn.fixture",
                "1.0.0",
                &format!("sha256:{}", "b".repeat(64)),
                &activated.session_id,
            )
            .is_err()
    );
    let payload = json!({"arguments": ["hello"]});
    let result = supervisor
        .invoke(
            "window-main",
            "dev.asterlyn.fixture",
            "callback-1",
            "execute",
            payload.clone(),
        )
        .expect("invoke");
    assert_eq!(result, payload);

    let subscribed = supervisor
        .invoke_with_events(
            "window-main",
            "dev.asterlyn.fixture",
            "callback-2",
            "subscribe",
            json!({"arguments": [{"$asterlynListener": {"subscriptionHandle": "subscription-1"}}]}),
        )
        .expect("subscribe");
    assert_eq!(subscribed.events.len(), 1);
    assert_eq!(subscribed.events[0].subscription_handle, "subscription-1");
    assert_eq!(
        subscribed.events[0].payload,
        json!({"arguments": [{"revision": 1}]})
    );

    supervisor.cancel_owner("window-main", ShutdownReason::WindowClosed);
    assert_eq!(supervisor.active_count(), 0);
}

#[test]
fn large_operation_payload_round_trips_through_the_isolated_helper() {
    let fixture = fixture_path().canonicalize().expect("fixture path");
    let installation = fixture.parent().expect("fixture parent");
    let supervisor =
        PluginHostSupervisor::from_verified_helper(&fixture, installation).expect("supervisor");
    let plugin = TempDir::new().expect("plugin root");
    fs::create_dir(plugin.path().join("runtime")).expect("runtime directory");
    fs::write(plugin.path().join("runtime/plugin.js"), b"fixture").expect("runtime entry");
    supervisor
        .activate(activation(plugin.path()))
        .expect("activate");

    let payload = json!({"payloadBase64": "a".repeat(6 * 1024 * 1024)});
    let result = supervisor
        .invoke(
            "window-main",
            "dev.asterlyn.fixture",
            "callback-1",
            "execute",
            payload.clone(),
        )
        .expect("large segmented invoke");
    assert_eq!(result, payload);

    supervisor.cancel_owner("window-main", ShutdownReason::WindowClosed);
    assert_eq!(supervisor.active_count(), 0);
}

#[test]
fn disabling_plugin_stops_its_sessions_in_every_window() {
    let fixture = fixture_path().canonicalize().expect("fixture path");
    let installation = fixture.parent().expect("fixture parent");
    let supervisor =
        PluginHostSupervisor::from_verified_helper(&fixture, installation).expect("supervisor");
    let plugin = TempDir::new().expect("plugin root");
    fs::create_dir(plugin.path().join("runtime")).expect("runtime directory");
    fs::write(plugin.path().join("runtime/plugin.js"), b"fixture").expect("runtime entry");
    supervisor
        .activate(activation(plugin.path()))
        .expect("first window activation");
    let mut second = activation(plugin.path());
    second.owner = "window-second".to_owned();
    supervisor
        .activate(second)
        .expect("second window activation");
    assert_eq!(supervisor.active_count(), 2);

    supervisor.stop_plugin_all("dev.asterlyn.fixture", ShutdownReason::Disabled);
    assert_eq!(supervisor.active_count(), 0);
}

#[test]
fn fatal_identity_stop_evicts_every_window_and_reports_each_exact_session_once() {
    use std::collections::BTreeMap;
    use std::sync::mpsc::RecvTimeoutError;
    use std::time::Duration;

    let fixture = fixture_path().canonicalize().expect("fixture path");
    let installation = fixture.parent().expect("fixture parent");
    let supervisor =
        PluginHostSupervisor::from_verified_helper(&fixture, installation).expect("supervisor");
    let terminations = supervisor.observe_terminations();
    let plugin = TempDir::new().expect("plugin root");
    fs::create_dir(plugin.path().join("runtime")).expect("runtime directory");
    fs::write(plugin.path().join("runtime/plugin.js"), b"fixture").expect("runtime entry");
    let first = supervisor
        .activate(activation(plugin.path()))
        .expect("first window activation");
    let mut second_request = activation(plugin.path());
    second_request.owner = "window-second".to_owned();
    let second = supervisor
        .activate(second_request)
        .expect("second window activation");

    supervisor.terminate_plugin_identity_all(
        "dev.asterlyn.fixture",
        "1.0.0",
        &format!("sha256:{}", "a".repeat(64)),
        "peer runtime crashed",
    );

    let mut events = BTreeMap::new();
    for _ in 0..2 {
        let event = terminations
            .recv_timeout(Duration::from_secs(2))
            .expect("every window receives an exact termination");
        assert_eq!(
            event.reason,
            PluginSessionTerminationReason::PeerSessionFailure
        );
        assert_eq!(event.detail, "peer runtime crashed");
        events.insert(event.owner, event.session_id);
    }
    assert_eq!(events.get("window-main"), Some(&first.session_id));
    assert_eq!(events.get("window-second"), Some(&second.session_id));
    assert_eq!(supervisor.active_count(), 0);
    assert_eq!(
        terminations.recv_timeout(Duration::from_millis(200)),
        Err(RecvTimeoutError::Timeout),
        "the peer stop must not publish duplicate terminal events"
    );
}

#[test]
fn idle_helper_exit_is_evicted_and_reported_exactly_once() {
    use std::sync::mpsc::RecvTimeoutError;
    use std::time::Duration;

    let fixture = fixture_path().canonicalize().expect("fixture path");
    let installation = fixture.parent().expect("fixture parent");
    let supervisor =
        PluginHostSupervisor::from_verified_helper(&fixture, installation).expect("supervisor");
    let terminations = supervisor.observe_terminations();
    let plugin = TempDir::new().expect("plugin root");
    fs::create_dir(plugin.path().join("runtime")).expect("runtime directory");
    fs::write(plugin.path().join("runtime/plugin.js"), b"fixture").expect("runtime entry");
    let mut request = activation(plugin.path());
    request.evidence = json!({"idleCrashAfterMs": 75});
    let activated = supervisor
        .activate(request)
        .expect("activate crash fixture");

    let termination = terminations
        .recv_timeout(Duration::from_secs(2))
        .expect("idle crash is reported without an invocation");
    assert_eq!(termination.owner, "window-main");
    assert_eq!(termination.plugin_id, "dev.asterlyn.fixture");
    assert_eq!(termination.plugin_version, "1.0.0");
    assert_eq!(termination.session_id, activated.session_id);
    assert_eq!(
        termination.reason,
        PluginSessionTerminationReason::UnexpectedExit
    );
    assert!(termination.detail.contains("17"));
    assert_eq!(supervisor.active_count(), 0);
    supervisor
        .consume_termination(
            "window-main",
            "dev.asterlyn.fixture",
            "1.0.0",
            &format!("sha256:{}", "a".repeat(64)),
            &activated.session_id,
        )
        .expect("exact termination receipt is consumed");
    assert!(
        supervisor
            .consume_termination(
                "window-main",
                "dev.asterlyn.fixture",
                "1.0.0",
                &format!("sha256:{}", "a".repeat(64)),
                &activated.session_id,
            )
            .is_err(),
        "a termination receipt cannot be replayed"
    );
    assert_eq!(
        terminations.recv_timeout(Duration::from_millis(200)),
        Err(RecvTimeoutError::Timeout),
        "one process exit must produce only one terminal event"
    );
}

#[test]
fn invoke_crash_evicts_only_the_faulty_helper_and_keeps_the_peer_usable() {
    use std::sync::mpsc::RecvTimeoutError;
    use std::time::Duration;

    let fixture = fixture_path().canonicalize().expect("fixture path");
    let installation = fixture.parent().expect("fixture parent");
    let supervisor =
        PluginHostSupervisor::from_verified_helper(&fixture, installation).expect("supervisor");
    let terminations = supervisor.observe_terminations();
    let plugin = TempDir::new().expect("plugin root");
    fs::create_dir(plugin.path().join("runtime")).expect("runtime directory");
    fs::write(plugin.path().join("runtime/plugin.js"), b"fixture").expect("runtime entry");

    let mut faulty = activation(plugin.path());
    faulty.evidence = json!({"crashOnInvoke": true});
    let faulty_session = supervisor.activate(faulty).expect("faulty activation");
    let mut peer = activation(plugin.path());
    peer.owner = "window-peer".to_owned();
    supervisor.activate(peer).expect("peer activation");

    let error = supervisor
        .invoke(
            "window-main",
            "dev.asterlyn.fixture",
            "callback-1",
            "execute",
            json!({"arguments": []}),
        )
        .expect_err("invoke crash must fail");
    assert!(error.to_string().contains("crashed"));
    let termination = terminations
        .recv_timeout(Duration::from_secs(2))
        .expect("invoke crash termination");
    assert_eq!(termination.session_id, faulty_session.session_id);
    assert_eq!(
        termination.reason,
        PluginSessionTerminationReason::UnexpectedExit
    );
    let expected_status = if cfg!(windows) {
        "exit code: 23"
    } else {
        "exit status: 23"
    };
    assert!(
        termination.detail.ends_with(expected_status),
        "EOF termination must preserve the fixture's original exit status: {}",
        termination.detail
    );
    assert_eq!(supervisor.active_count(), 1);
    let peer_result = supervisor
        .invoke(
            "window-peer",
            "dev.asterlyn.fixture",
            "callback-1",
            "execute",
            json!({"peer": "still-alive"}),
        )
        .expect("unrelated peer remains usable");
    assert_eq!(peer_result, json!({"peer": "still-alive"}));
    assert_eq!(
        terminations.recv_timeout(Duration::from_millis(200)),
        Err(RecvTimeoutError::Timeout),
        "one invoke crash emits one terminal event"
    );
}

#[test]
fn protocol_fault_with_stderr_flood_is_bounded_and_evicts_the_session() {
    use std::time::Duration;

    let fixture = fixture_path().canonicalize().expect("fixture path");
    let installation = fixture.parent().expect("fixture parent");
    let supervisor =
        PluginHostSupervisor::from_verified_helper(&fixture, installation).expect("supervisor");
    let terminations = supervisor.observe_terminations();
    let plugin = TempDir::new().expect("plugin root");
    fs::create_dir(plugin.path().join("runtime")).expect("runtime directory");
    fs::write(plugin.path().join("runtime/plugin.js"), b"fixture").expect("runtime entry");
    let mut request = activation(plugin.path());
    request.evidence = json!({
        "mismatchOnInvoke": true,
        "stderrFloodOnInvokeBytes": 384 * 1024,
    });
    supervisor
        .activate(request)
        .expect("activate flood fixture");

    let error = supervisor
        .invoke(
            "window-main",
            "dev.asterlyn.fixture",
            "callback-1",
            "execute",
            json!({"arguments": []}),
        )
        .expect_err("mismatched response must fail closed");
    assert!(error.to_string().contains("protocol"));
    let termination = terminations
        .recv_timeout(Duration::from_secs(2))
        .expect("protocol termination");
    assert_eq!(
        termination.reason,
        PluginSessionTerminationReason::ProtocolViolation
    );
    assert!(termination.diagnostics.stderr_truncated);
    assert_eq!(termination.diagnostics.stderr.len(), 256 * 1024);
    assert_eq!(supervisor.active_count(), 0);
}

#[test]
fn malformed_frame_is_a_protocol_fault_and_evicts_the_session() {
    use std::time::Duration;

    let fixture = fixture_path().canonicalize().expect("fixture path");
    let installation = fixture.parent().expect("fixture parent");
    let supervisor =
        PluginHostSupervisor::from_verified_helper(&fixture, installation).expect("supervisor");
    let terminations = supervisor.observe_terminations();
    let plugin = TempDir::new().expect("plugin root");
    fs::create_dir(plugin.path().join("runtime")).expect("runtime directory");
    fs::write(plugin.path().join("runtime/plugin.js"), b"fixture").expect("runtime entry");
    let mut request = activation(plugin.path());
    request.evidence = json!({"malformedFrameOnInvoke": true});
    supervisor
        .activate(request)
        .expect("activate malformed fixture");

    let error = supervisor
        .invoke(
            "window-main",
            "dev.asterlyn.fixture",
            "callback-1",
            "execute",
            json!({"arguments": []}),
        )
        .expect_err("malformed frame must fail closed");
    assert!(error.to_string().contains("protocol"));
    let termination = terminations
        .recv_timeout(Duration::from_secs(2))
        .expect("malformed-frame termination");
    assert_eq!(
        termination.reason,
        PluginSessionTerminationReason::ProtocolViolation
    );
    assert_eq!(supervisor.active_count(), 0);
}

#[test]
fn non_contiguous_plugin_sequence_is_rejected() {
    use std::time::Duration;

    let fixture = fixture_path().canonicalize().expect("fixture path");
    let installation = fixture.parent().expect("fixture parent");
    let supervisor =
        PluginHostSupervisor::from_verified_helper(&fixture, installation).expect("supervisor");
    let terminations = supervisor.observe_terminations();
    let plugin = TempDir::new().expect("plugin root");
    fs::create_dir(plugin.path().join("runtime")).expect("runtime directory");
    fs::write(plugin.path().join("runtime/plugin.js"), b"fixture").expect("runtime entry");
    let mut request = activation(plugin.path());
    request.evidence = json!({"mismatchSequenceOnInvoke": true});
    supervisor
        .activate(request)
        .expect("activate sequence fixture");

    let error = supervisor
        .invoke(
            "window-main",
            "dev.asterlyn.fixture",
            "callback-1",
            "execute",
            json!({"arguments": []}),
        )
        .expect_err("sequence gap must fail closed");
    assert!(error.to_string().contains("sequence mismatch"));
    let termination = terminations
        .recv_timeout(Duration::from_secs(2))
        .expect("sequence termination");
    assert_eq!(
        termination.reason,
        PluginSessionTerminationReason::ProtocolViolation
    );
    assert_eq!(supervisor.active_count(), 0);
}

#[test]
fn expected_replacement_does_not_report_a_crash_or_remove_the_new_session() {
    use std::sync::mpsc::RecvTimeoutError;
    use std::time::Duration;

    let fixture = fixture_path().canonicalize().expect("fixture path");
    let installation = fixture.parent().expect("fixture parent");
    let supervisor =
        PluginHostSupervisor::from_verified_helper(&fixture, installation).expect("supervisor");
    let terminations = supervisor.observe_terminations();
    let plugin = TempDir::new().expect("plugin root");
    fs::create_dir(plugin.path().join("runtime")).expect("runtime directory");
    fs::write(plugin.path().join("runtime/plugin.js"), b"fixture").expect("runtime entry");
    let first = supervisor
        .activate(activation(plugin.path()))
        .expect("first activation");
    let second = supervisor
        .activate(activation(plugin.path()))
        .expect("replacement activation");

    assert_ne!(first.session_id, second.session_id);
    assert_eq!(supervisor.active_count(), 1);
    supervisor
        .assert_active_session(
            "window-main",
            "dev.asterlyn.fixture",
            "1.0.0",
            &format!("sha256:{}", "a".repeat(64)),
            &second.session_id,
        )
        .expect("replacement remains active");
    assert_eq!(
        terminations.recv_timeout(Duration::from_millis(200)),
        Err(RecvTimeoutError::Timeout),
        "expected replacement must not publish a crash"
    );
}

#[test]
fn rejects_runtime_entries_that_escape_the_admitted_root() {
    let fixture = fixture_path().canonicalize().expect("fixture path");
    let installation = fixture.parent().expect("fixture parent");
    let supervisor =
        PluginHostSupervisor::from_verified_helper(&fixture, installation).expect("supervisor");
    let parent = TempDir::new().expect("parent");
    fs::write(parent.path().join("outside.js"), b"fixture").expect("outside entry");
    let plugin = parent.path().join("plugin");
    fs::create_dir(&plugin).expect("plugin directory");
    let mut request = activation(&plugin);
    request.identity.runtime_entry = "../outside.js".to_owned();

    let error = supervisor.activate(request).expect_err("escape rejected");
    assert!(error.to_string().contains("runtime"));
    assert_eq!(supervisor.active_count(), 0);
}

#[cfg(unix)]
#[test]
fn window_shutdown_terminates_the_complete_plugin_process_group() {
    use std::thread;
    use std::time::{Duration, Instant};

    let fixture = fixture_path().canonicalize().expect("fixture path");
    let installation = fixture.parent().expect("fixture parent");
    let supervisor =
        PluginHostSupervisor::from_verified_helper(&fixture, installation).expect("supervisor");
    let plugin = TempDir::new().expect("plugin root");
    fs::create_dir(plugin.path().join("runtime")).expect("runtime directory");
    fs::write(plugin.path().join("runtime/plugin.js"), b"fixture").expect("runtime entry");
    let mut request = activation(plugin.path());
    request.identity.plugin_id = "dev.asterlyn.fixture.tree".to_owned();
    supervisor.activate(request).expect("activate tree fixture");
    let pid_path = plugin.path().join("descendant.pid");
    let deadline = Instant::now() + Duration::from_secs(2);
    while !pid_path.is_file() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
    let pid: i32 = fs::read_to_string(&pid_path)
        .expect("descendant pid")
        .parse()
        .expect("numeric descendant pid");
    assert_eq!(unsafe { libc::kill(pid, 0) }, 0, "descendant is running");

    supervisor.cancel_owner("window-main", ShutdownReason::WindowClosed);
    let deadline = Instant::now() + Duration::from_secs(2);
    while unsafe { libc::kill(pid, 0) } == 0 && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
    assert_ne!(
        unsafe { libc::kill(pid, 0) },
        0,
        "descendant was terminated"
    );
    assert_eq!(supervisor.active_count(), 0);
}
