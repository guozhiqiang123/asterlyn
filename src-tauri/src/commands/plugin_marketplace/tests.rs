use super::*;

#[test]
fn bundled_android_package_is_admitted_enabled_and_content_bound_offline() {
    let directory = tempfile::tempdir().unwrap();
    let snapshot =
        ensure_bundled_android_package(directory.path(), BUNDLED_ANDROID_PACKAGE).unwrap();
    let plugin = snapshot
        .plugins
        .iter()
        .find(|plugin| plugin.plugin_id == BUNDLED_ANDROID_PLUGIN_ID)
        .unwrap();
    assert!(plugin.enabled);
    assert!(plugin.bundled_fallback);
    assert_eq!(
        plugin.pending_version.as_deref(),
        Some(BUNDLED_ANDROID_PLUGIN_VERSION)
    );
    let version = plugin
        .versions
        .iter()
        .find(|version| version.version == BUNDLED_ANDROID_PLUGIN_VERSION)
        .unwrap();
    assert_eq!(version.package_digest, BUNDLED_ANDROID_PACKAGE_DIGEST);
    assert!(version.content_digest.is_some());

    let repeated =
        ensure_bundled_android_package(directory.path(), BUNDLED_ANDROID_PACKAGE).unwrap();
    assert_eq!(repeated.generation, snapshot.generation);
    assert!(
        directory
            .path()
            .join("packages")
            .join(BUNDLED_ANDROID_PLUGIN_ID)
            .join(BUNDLED_ANDROID_PLUGIN_VERSION)
            .join(BUNDLED_ANDROID_PACKAGE_DIGEST.trim_start_matches("sha256:"))
            .join("runtime/plugin.js")
            .is_file()
    );
}

#[test]
fn bundled_android_package_rejects_bytes_outside_the_host_binding() {
    let directory = tempfile::tempdir().unwrap();
    assert!(ensure_bundled_android_package(directory.path(), b"not the bundled package").is_err());
    assert!(!directory.path().join("packages").exists());
}

#[test]
fn bundled_lsp_package_is_admitted_enabled_and_sealed_offline() {
    let directory = tempfile::tempdir().unwrap();
    ensure_bundled_android_package(directory.path(), BUNDLED_ANDROID_PACKAGE).unwrap();
    let snapshot = ensure_bundled_lsp_package(directory.path(), BUNDLED_LSP_PACKAGE).unwrap();
    let plugin = snapshot
        .plugins
        .iter()
        .find(|plugin| plugin.plugin_id == BUNDLED_LSP_PLUGIN_ID)
        .unwrap();
    assert!(plugin.enabled);
    assert!(plugin.bundled_fallback);
    let version = plugin
        .versions
        .iter()
        .find(|version| version.version == BUNDLED_LSP_PLUGIN_VERSION)
        .unwrap();
    assert_eq!(version.package_digest, BUNDLED_LSP_PACKAGE_DIGEST);
    assert!(version.content_digest.is_some());
    let root = directory
        .path()
        .join("packages")
        .join(BUNDLED_LSP_PLUGIN_ID)
        .join(BUNDLED_LSP_PLUGIN_VERSION)
        .join(BUNDLED_LSP_PACKAGE_DIGEST.trim_start_matches("sha256:"));
    assert!(root.join("runtime/plugin.js").is_file());
    assert!(root.join("servers/typescript/server.mjs").is_file());
    assert!(
        root.join("servers/typescript/typescript/lib/tsserver.js")
            .is_file()
    );
    assert_eq!(
        ensure_bundled_lsp_package(directory.path(), BUNDLED_LSP_PACKAGE)
            .unwrap()
            .generation,
        snapshot.generation
    );
}

#[test]
fn bundled_lsp_package_rejects_bytes_outside_the_host_binding() {
    let directory = tempfile::tempdir().unwrap();
    assert!(ensure_bundled_lsp_package(directory.path(), b"bad bytes").is_err());
    assert!(!directory.path().join("packages").exists());
}

#[test]
fn offline_and_rate_limited_discovery_preserve_only_stale_bound_release_metadata() {
    let source = source_with_cached_release();

    let offline = resolve_release_result(&source, Err("network unavailable".to_owned()));
    assert_eq!(offline.status, PluginSourceCatalogStatus::Error);
    assert!(offline.stale);
    assert_eq!(offline.version.as_deref(), Some("1.2.3"));
    assert_eq!(
        offline.asset_download_url.as_deref(),
        Some(
            "https://github.com/asterlyn/example/releases/download/v1.2.3/example-1.2.3.asterlyn-plugin.tgz"
        )
    );
    assert_eq!(offline.error.as_deref(), Some("network unavailable"));
    assert_eq!(offline.rate_limit_reset_epoch_ms, None);

    let reset = 9_876_000;
    let limited = resolve_release_result(
        &source,
        Ok(HttpReleaseResponse {
            status: 403,
            body: Vec::new(),
            etag: None,
            last_modified: None,
            rate_limit_remaining: Some(0),
            rate_limit_reset_epoch_ms: Some(reset),
        }),
    );
    assert_eq!(limited.status, PluginSourceCatalogStatus::RateLimited);
    assert!(limited.stale);
    assert_eq!(limited.version.as_deref(), Some("1.2.3"));
    assert_eq!(limited.rate_limit_reset_epoch_ms, Some(reset));
    assert!(
        limited
            .error
            .as_deref()
            .is_some_and(|error| error.contains("rate limit"))
    );
}

#[test]
fn unavailable_discovery_without_a_cached_release_never_invents_installable_metadata() {
    let source = PluginSource {
        repository: "asterlyn/example".to_owned(),
        name: "Example".to_owned(),
        description: "Fixture".to_owned(),
        built_in: false,
        enabled: true,
        catalog: None,
    };
    let catalog = resolve_release_result(&source, Err("offline".to_owned()));
    assert_eq!(catalog.status, PluginSourceCatalogStatus::Error);
    assert!(!catalog.stale);
    assert_eq!(catalog.version, None);
    assert_eq!(catalog.asset_download_url, None);
    assert_eq!(catalog.digest, None);
}

#[test]
fn admitted_package_generation_and_retained_archive_are_sealed_read_only() {
    let directory = tempfile::tempdir().unwrap();
    let package = directory.path().join("package");
    fs::create_dir_all(package.join("runtime")).unwrap();
    fs::write(package.join("manifest.json"), b"manifest").unwrap();
    fs::write(package.join("runtime/plugin.js"), b"runtime").unwrap();

    seal_package_tree(&package).unwrap();
    assert!(fs::metadata(&package).unwrap().permissions().readonly());
    assert!(
        fs::metadata(package.join("runtime/plugin.js"))
            .unwrap()
            .permissions()
            .readonly()
    );

    let archive = directory.path().join("package.asterlyn-plugin.tgz");
    let bytes = b"verified archive";
    let digest = format!("sha256:{:x}", Sha256::digest(bytes));
    retain_package_archive(&archive, bytes, &digest).unwrap();
    assert!(fs::metadata(&archive).unwrap().permissions().readonly());
    assert_eq!(fs::read(&archive).unwrap(), bytes);
    assert!(retain_package_archive(&archive, b"replacement", &digest).is_ok());

    remove_marketplace_entry(&package).unwrap();
    remove_marketplace_entry(&archive).unwrap();
}

#[test]
#[ignore = "requires live public GitHub Releases and network access"]
fn public_fixture_releases_are_discoverable_downloadable_and_admitted() {
    for (repository, version, plugin_id) in [
        (
            "guozhiqiang123/asterlyn-plugin-hello",
            "0.1.1",
            "dev.asterlyn.hello",
        ),
        (
            "guozhiqiang123/asterlyn-plugin-android-gradle",
            "0.5.7",
            "dev.asterlyn.android-gradle",
        ),
    ] {
        let source = PluginSource {
            repository: repository.to_owned(),
            name: plugin_id.to_owned(),
            description: "live marketplace acceptance fixture".to_owned(),
            built_in: false,
            enabled: true,
            catalog: None,
        };
        let catalog = discover_release(&source);
        assert_eq!(
            catalog.status,
            PluginSourceCatalogStatus::Available,
            "{repository}: {:?}",
            catalog.error
        );
        assert_eq!(catalog.version.as_deref(), Some(version));
        assert!(!catalog.stale);
        let staging = tempfile::tempdir().expect("live Release staging");
        let admission = download_and_inspect(
            ReleaseBinding::from_catalog(repository, 1, &catalog).expect("bind discovered Release"),
            staging.path().to_owned(),
        )
        .unwrap_or_else(|error| panic!("admit {repository}: {error}"));
        assert_eq!(admission.repository, repository);
        assert_eq!(admission.version, version);
        assert_eq!(admission.report.plugin_id, plugin_id);
        assert_eq!(admission.report.plugin_version, version);
        assert_eq!(admission.digest, catalog.digest.expect("Release digest"));

        let installed = tempfile::tempdir().expect("installed package root");
        let package = fs::read(&admission.staging_path).expect("read staged package");
        extract_admitted_package(
            &package,
            &admission_context(repository, version),
            &installed.path().join("package"),
        )
        .expect("extract admitted package");
        let lifecycle = PluginInstallationStore::open(installed.path().join("state"))
            .expect("installation lifecycle store");
        let recorded = lifecycle
            .record_admitted(
                AdmittedPluginIdentity {
                    plugin_id,
                    repository,
                    version,
                    package_digest: &admission.digest,
                    content_digest: &admission.report.content_digest,
                },
                now_ms(),
                false,
            )
            .expect("record admitted Release");
        assert_eq!(
            runtime_status(&recorded, plugin_id, version),
            PluginRuntimeStatus::PendingRestart
        );
        let restarted = lifecycle
            .recover_interrupted_activations()
            .expect("cross restart boundary");
        assert_eq!(
            runtime_status(&restarted, plugin_id, version),
            PluginRuntimeStatus::PendingRuntime
        );
        lifecycle
            .set_plugin_enabled(plugin_id, true)
            .expect("explicitly enable admitted package");
        let active = lifecycle
            .begin_activation(plugin_id, version, &admission.digest)
            .expect("begin installed runtime activation");
        assert_eq!(
            runtime_status(&active, plugin_id, version),
            PluginRuntimeStatus::Active
        );
        let healthy = lifecycle
            .promote_healthy(plugin_id, version, &admission.digest)
            .expect("promote healthy installed runtime");
        assert_eq!(
            runtime_status(&healthy, plugin_id, version),
            PluginRuntimeStatus::KnownGood
        );
        assert_eq!(
            healthy.plugins[0].known_good_version.as_deref(),
            Some(version)
        );
        assert_eq!(healthy.plugins[0].pending_version, None);
        let disabled = lifecycle
            .set_plugin_enabled(plugin_id, false)
            .expect("disable installed plugin");
        assert!(!disabled.plugins[0].enabled);
        let removed = lifecycle
            .remove_plugin(plugin_id)
            .expect("uninstall installed plugin");
        assert!(removed.plugins.is_empty());
    }
}

fn runtime_status(
    snapshot: &PluginInstallationSnapshot,
    plugin_id: &str,
    version: &str,
) -> PluginRuntimeStatus {
    snapshot
        .plugins
        .iter()
        .find(|plugin| plugin.plugin_id == plugin_id)
        .and_then(|plugin| {
            plugin
                .versions
                .iter()
                .find(|candidate| candidate.version == version)
        })
        .map(|candidate| candidate.runtime_status)
        .expect("installed runtime status")
}

fn source_with_cached_release() -> PluginSource {
    PluginSource {
        repository: "asterlyn/example".to_owned(),
        name: "Example".to_owned(),
        description: "Fixture".to_owned(),
        built_in: false,
        enabled: true,
        catalog: Some(PluginSourceCatalog {
            status: PluginSourceCatalogStatus::Available,
            checked_at_epoch_ms: 1,
            stale: false,
            version: Some("1.2.3".to_owned()),
            release_url: Some(
                "https://github.com/asterlyn/example/releases/tag/v1.2.3".to_owned(),
            ),
            asset_name: Some("example-1.2.3.asterlyn-plugin.tgz".to_owned()),
            asset_download_url: Some(
                "https://github.com/asterlyn/example/releases/download/v1.2.3/example-1.2.3.asterlyn-plugin.tgz".to_owned(),
            ),
            asset_size_bytes: Some(1_234),
            digest: Some(format!("sha256:{}", "a".repeat(64))),
            error: None,
            rate_limit_reset_epoch_ms: None,
            etag: Some("fixture-etag".to_owned()),
            last_modified: Some("fixture-last-modified".to_owned()),
        }),
    }
}
