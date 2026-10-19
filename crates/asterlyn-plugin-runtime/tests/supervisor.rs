use std::fs;
use std::path::{Path, PathBuf};

use asterlyn_plugin_runtime::{PluginActivation, PluginHostSupervisor, PluginRuntimeIdentity};
use asterlyn_plugin_runtime_protocol::{HostTheme, ShutdownReason};
use serde_json::json;
use tempfile::TempDir;

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
