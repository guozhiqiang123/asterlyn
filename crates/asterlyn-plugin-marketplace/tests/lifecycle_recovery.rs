use std::fs;

use asterlyn_plugin_marketplace::{PluginInstallationStore, PluginRuntimeStatus};

const PLUGIN_ID: &str = "dev.asterlyn.recovery-test";
const REPOSITORY: &str = "asterlyn/recovery-test";
const CURRENT: &str = "installations.v1.json";
const PREVIOUS: &str = "installations.v1.previous.json";
const NEXT: &str = "installations.v1.next.json";
const THIRTY_DAYS_MS: u64 = 30 * 24 * 60 * 60 * 1_000;

#[test]
fn installation_index_recovers_missing_and_corrupt_current_generations() {
    let directory = tempfile::tempdir().unwrap();
    let store = PluginInstallationStore::open(directory.path()).unwrap();
    let digest = digest(1);
    admit_and_promote(&store, "1.0.0", &digest, 1);
    store.set_plugin_enabled(PLUGIN_ID, false).unwrap();

    fs::write(
        directory.path().join(CURRENT),
        b"corrupt current generation",
    )
    .unwrap();
    let repaired = store.recover_interrupted_activations().unwrap();
    assert!(repaired.plugins[0].enabled);
    assert_eq!(
        repaired.plugins[0].known_good_version.as_deref(),
        Some("1.0.0")
    );
    assert!(!store.snapshot().unwrap().recovered);

    fs::write(directory.path().join(NEXT), b"abandoned next generation").unwrap();
    store.set_plugin_enabled(PLUGIN_ID, false).unwrap();
    assert!(!directory.path().join(NEXT).exists());

    fs::remove_file(directory.path().join(CURRENT)).unwrap();
    assert!(directory.path().join(PREVIOUS).is_file());
    let recovered = store.recover_interrupted_activations().unwrap();
    assert!(recovered.plugins[0].enabled);
    assert!(!store.snapshot().unwrap().recovered);
}

#[test]
fn retention_keeps_pointers_recent_quarantine_and_bounded_known_good_history() {
    let directory = tempfile::tempdir().unwrap();
    let store = PluginInstallationStore::open(directory.path()).unwrap();
    let now = THIRTY_DAYS_MS + 10_000;

    for index in 0..8 {
        let version = format!("1.0.{index}");
        admit_and_promote(
            &store,
            &version,
            &digest(index as usize + 1),
            index as u64 + 1,
        );
    }
    for index in 0..5 {
        let version = format!("2.0.{index}");
        let admitted_at = if index == 0 {
            1
        } else {
            now - (5 - index) as u64
        };
        admit_and_quarantine(&store, &version, &digest(index as usize + 9), admitted_at);
    }

    let pruned = store.prune_retained_versions(now).unwrap();
    let plugin = &pruned.plugins[0];
    assert_eq!(plugin.versions.len(), 8);
    assert_eq!(plugin.known_good_version.as_deref(), Some("1.0.7"));
    assert!(
        plugin
            .versions
            .iter()
            .any(|version| version.version == "1.0.7")
    );
    let quarantined = plugin
        .versions
        .iter()
        .filter(|version| version.runtime_status == PluginRuntimeStatus::Quarantined)
        .map(|version| version.version.as_str())
        .collect::<Vec<_>>();
    assert_eq!(quarantined.len(), 3);
    assert!(quarantined.contains(&"2.0.4"));
    assert!(quarantined.contains(&"2.0.3"));
    assert!(quarantined.contains(&"2.0.2"));
    assert!(
        !plugin
            .versions
            .iter()
            .any(|version| version.version == "2.0.0")
    );
}

fn admit_and_promote(
    store: &PluginInstallationStore,
    version: &str,
    package_digest: &str,
    admitted_at_epoch_ms: u64,
) {
    store
        .record_admitted(
            PLUGIN_ID,
            REPOSITORY,
            version,
            package_digest,
            admitted_at_epoch_ms,
            false,
        )
        .unwrap();
    store.recover_interrupted_activations().unwrap();
    store
        .begin_activation(PLUGIN_ID, version, package_digest)
        .unwrap();
    store
        .promote_healthy(PLUGIN_ID, version, package_digest)
        .unwrap();
}

fn admit_and_quarantine(
    store: &PluginInstallationStore,
    version: &str,
    package_digest: &str,
    admitted_at_epoch_ms: u64,
) {
    store
        .record_admitted(
            PLUGIN_ID,
            REPOSITORY,
            version,
            package_digest,
            admitted_at_epoch_ms,
            false,
        )
        .unwrap();
    store.recover_interrupted_activations().unwrap();
    store
        .begin_activation(PLUGIN_ID, version, package_digest)
        .unwrap();
    store
        .mark_activation_failed(PLUGIN_ID, version, package_digest)
        .unwrap();
}

fn digest(value: usize) -> String {
    format!("sha256:{value:064x}")
}
