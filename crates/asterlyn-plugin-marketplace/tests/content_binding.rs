use std::fs;

use asterlyn_plugin_marketplace::{
    AdmittedPluginIdentity, INSTALLATION_SCHEMA_VERSION, PluginInstallationStore,
};

const CURRENT: &str = "installations.v1.json";

#[test]
fn legacy_installation_requires_reinstall_and_exact_readmission_binds_content() {
    let directory = tempfile::tempdir().unwrap();
    let package_digest = format!("sha256:{}", "a".repeat(64));
    let legacy = serde_json::json!({
        "schemaVersion": 1,
        "generation": 1,
        "plugins": [{
            "pluginId": "dev.asterlyn.example",
            "repository": "asterlyn/example",
            "enabled": true,
            "bundledFallback": false,
            "activeVersion": null,
            "knownGoodVersion": null,
            "pendingVersion": "1.2.3",
            "versions": [{
                "version": "1.2.3",
                "packageDigest": package_digest,
                "admittedAtEpochMs": 1,
                "runtimeStatus": "pendingRuntime"
            }]
        }]
    });
    fs::write(
        directory.path().join(CURRENT),
        serde_json::to_vec_pretty(&legacy).unwrap(),
    )
    .unwrap();
    let store = PluginInstallationStore::open(directory.path()).unwrap();
    assert_eq!(
        store.snapshot().unwrap().schema_version,
        INSTALLATION_SCHEMA_VERSION
    );
    assert!(
        store
            .begin_activation("dev.asterlyn.example", "1.2.3", &package_digest)
            .unwrap_err()
            .to_string()
            .contains("reinstall")
    );

    let content_digest = format!("sha256:{}", "c".repeat(64));
    let migrated = store
        .record_admitted(
            AdmittedPluginIdentity {
                plugin_id: "dev.asterlyn.example",
                repository: "asterlyn/example",
                version: "1.2.3",
                package_digest: &package_digest,
                content_digest: &content_digest,
            },
            2,
            false,
        )
        .unwrap();
    assert_eq!(
        migrated.plugins[0].versions[0].content_digest.as_deref(),
        Some(content_digest.as_str())
    );
}
