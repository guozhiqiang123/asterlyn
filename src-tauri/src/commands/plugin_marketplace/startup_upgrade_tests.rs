use super::*;

fn seed_previous(root: &std::path::Path) -> PluginInstallationStore {
    let store = PluginInstallationStore::open(root.join("installation-state")).unwrap();
    for (id, repository, version, bytes) in [
        (BUNDLED_ANDROID_PLUGIN_ID, BUILT_IN_ANDROID_REPOSITORY, "0.5.10", include_bytes!("../../../resources/plugins/asterlyn-plugin-android-gradle-0.5.10.asterlyn-plugin.tgz").as_slice()),
        (bundled::BUNDLED_LSP_PLUGIN_ID, bundled::BUNDLED_LSP_REPOSITORY, "0.2.1", include_bytes!("../../../resources/plugins/asterlyn-plugin-lsp-0.2.1.asterlyn-plugin.tgz").as_slice()),
    ] {
        let report = inspect_package(bytes, &admission_context(repository, version)).unwrap();
        let digest = format!("sha256:{:x}", Sha256::digest(bytes));
        store.record_bundled_with_dependencies(AdmittedPluginIdentity {plugin_id:id,repository,version,package_digest:&digest,content_digest:&report.content_digest},1,report.management_manifest.dependencies).unwrap();
        store.recover_interrupted_activations().unwrap();
        store.begin_activation(id,version,&digest).unwrap();
        store.promote_healthy(id,version,&digest).unwrap();
    }
    store
}

#[test]
fn complete_previous_installation_upgrades_through_normal_health_checkpoints() {
    let root = tempfile::tempdir().unwrap();
    let store = seed_previous(root.path());
    // Also reproduce the partial pending producer state left by the failed old startup order.
    ensure_bundled_android_package(root.path(), BUNDLED_ANDROID_PACKAGE).unwrap();
    let staged = bundled::ensure_bundled_packages(
        root.path(),
        BUNDLED_ANDROID_PACKAGE,
        bundled::BUNDLED_LSP_PACKAGE,
    )
    .unwrap();
    for plugin in staged.plugins.iter().filter(|p| p.enabled) {
        asterlyn_plugin_marketplace::ensure_enabled_dependencies(
            &staged.plugins,
            &plugin.plugin_id,
        )
        .unwrap();
    }
    for id in [BUNDLED_ANDROID_PLUGIN_ID, bundled::BUNDLED_LSP_PLUGIN_ID] {
        store.ensure_dependencies_available(id).unwrap();
    }
    assert_eq!(
        staged
            .plugins
            .iter()
            .find(|p| p.plugin_id == BUNDLED_ANDROID_PLUGIN_ID)
            .unwrap()
            .known_good_version
            .as_deref(),
        Some("0.5.10")
    );
    store.recover_interrupted_activations().unwrap();
    for (id, version, digest) in [
        (
            BUNDLED_ANDROID_PLUGIN_ID,
            BUNDLED_ANDROID_PLUGIN_VERSION,
            BUNDLED_ANDROID_PACKAGE_DIGEST,
        ),
        (
            bundled::BUNDLED_LSP_PLUGIN_ID,
            bundled::BUNDLED_LSP_PLUGIN_VERSION,
            bundled::BUNDLED_LSP_PACKAGE_DIGEST,
        ),
    ] {
        store.begin_activation(id, version, digest).unwrap();
        store.promote_healthy(id, version, digest).unwrap();
    }
    let healthy = store.snapshot().unwrap();
    let repeat = bundled::ensure_bundled_packages(
        root.path(),
        BUNDLED_ANDROID_PACKAGE,
        bundled::BUNDLED_LSP_PACKAGE,
    )
    .unwrap();
    assert_eq!(healthy, repeat, "same healthy bundle is idempotent");
}

#[test]
fn bundled_startup_preserves_disabled_choices() {
    let root = tempfile::tempdir().unwrap();
    let store = seed_previous(root.path());
    store
        .set_plugin_enabled(bundled::BUNDLED_LSP_PLUGIN_ID, false)
        .unwrap();
    store
        .set_plugin_enabled(BUNDLED_ANDROID_PLUGIN_ID, false)
        .unwrap();
    let result = bundled::ensure_bundled_packages(
        root.path(),
        BUNDLED_ANDROID_PACKAGE,
        bundled::BUNDLED_LSP_PACKAGE,
    )
    .unwrap();
    assert!(result.plugins.iter().all(|p| !p.enabled));
}

#[test]
fn incompatible_enabled_third_party_rejects_the_entire_startup_upgrade() {
    let root = tempfile::tempdir().unwrap();
    let store = seed_previous(root.path());
    let digest = format!("sha256:{}", "a".repeat(64));
    store
        .record_admitted_with_dependencies(
            AdmittedPluginIdentity {
                plugin_id: "dev.example.consumer",
                repository: "example/consumer",
                version: "1.0.0",
                package_digest: &digest,
                content_digest: &digest,
            },
            1,
            false,
            vec![asterlyn_plugin_marketplace::PluginDependency {
                id: BUNDLED_ANDROID_PLUGIN_ID.into(),
                minimum: "0.5.10".into(),
                maximum_exclusive: Some("0.6.0".into()),
            }],
        )
        .unwrap();
    store
        .set_plugin_enabled("dev.example.consumer", true)
        .unwrap();
    let before = store.snapshot().unwrap();
    assert!(
        bundled::ensure_bundled_packages(
            root.path(),
            BUNDLED_ANDROID_PACKAGE,
            bundled::BUNDLED_LSP_PACKAGE
        )
        .is_err()
    );
    assert_eq!(
        store.snapshot().unwrap(),
        before,
        "failed transaction keeps the old compatible graph"
    );
    for plugin in before.plugins.iter().filter(|p| p.enabled) {
        asterlyn_plugin_marketplace::ensure_enabled_dependencies(
            &before.plugins,
            &plugin.plugin_id,
        )
        .unwrap();
    }
}
