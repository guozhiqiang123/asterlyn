use std::io::Write;

use flate2::Compression;
use flate2::write::GzEncoder;
use serde_json::json;
use tar::{Builder, EntryType, Header};

use super::*;

const RUNTIME: &[u8] = b"export function activate() {}";
const LICENSE: &[u8] = b"MIT License";

fn context<'a>() -> AdmissionContext<'a> {
    AdmissionContext {
        repository: "asterlyn/example-plugin",
        release_version: "1.2.3",
        host_version: "0.1.11",
        sdk_major: 1,
        runtime_protocol: 1,
        supported_capabilities: &["tasks", "processQueries", "toolOperations"],
        supported_permissions: &[
            "host.tasks.execute",
            "host.process.query",
            "host.tool.execute",
        ],
    }
}

fn digest(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn manifest(overrides: impl FnOnce(&mut serde_json::Value)) -> Vec<u8> {
    let mut value = json!({
        "schemaVersion": 3,
        "sdkMajor": 1,
        "id": "dev.asterlyn.example",
        "version": "1.2.3",
        "nameKey": "name",
        "descriptionKey": "description",
        "localization": { "defaultLocale": "en-US", "locales": { "en-US": { "name": "Example", "description": "Example plugin" } } },
        "settings": [],
        "capabilities": ["tasks"],
        "permissions": ["host.tasks.execute"],
        "distribution": {
            "repository": "asterlyn/example-plugin",
            "runtime": { "protocol": 1, "entry": "runtime/plugin.js" },
            "hostCompatibility": { "minimum": "0.1.0", "maximumExclusive": "0.2.0" },
            "license": { "expression": "MIT", "file": "LICENSE" },
            "integrity": {
                "LICENSE": digest(LICENSE),
                "runtime/plugin.js": digest(RUNTIME)
            }
        }
    });
    overrides(&mut value);
    serde_json::to_vec_pretty(&value).unwrap()
}

fn archive(entries: &[(&str, &[u8], EntryType)]) -> Vec<u8> {
    let encoder = GzEncoder::new(Vec::new(), Compression::default());
    let mut builder = Builder::new(encoder);
    for (path, bytes, kind) in entries {
        let mut header = Header::new_gnu();
        header.set_entry_type(*kind);
        header.set_mode(0o644);
        header.set_size(bytes.len() as u64);
        header.set_cksum();
        builder.append_data(&mut header, path, *bytes).unwrap();
    }
    builder.into_inner().unwrap().finish().unwrap()
}

fn valid_package() -> Vec<u8> {
    let manifest = manifest(|_| {});
    archive(&[
        (MANIFEST_PATH, &manifest, EntryType::Regular),
        ("runtime/plugin.js", RUNTIME, EntryType::Regular),
        ("LICENSE", LICENSE, EntryType::Regular),
    ])
}

#[test]
fn required_plugin_contract_is_admitted_and_rejects_missing_capability_or_invalid_declarations() {
    let declaration = serde_json::json!({"id":"dev.asterlyn.android-gradle","minimum":"0.5.10","maximumExclusive":"1.0.0"});
    let bytes = manifest(|value| {
        value["dependencies"] = serde_json::json!([declaration.clone()]);
        value["capabilities"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!("pluginDependencies"));
    });
    let package = |manifest: &[u8]| {
        archive(&[
            (MANIFEST_PATH, manifest, EntryType::Regular),
            ("runtime/plugin.js", RUNTIME, EntryType::Regular),
            ("LICENSE", LICENSE, EntryType::Regular),
        ])
    };
    let mut current = context();
    current.supported_capabilities = SUPPORTED_CAPABILITIES;
    let report = inspect_package(&package(&bytes), &current).unwrap();
    assert_eq!(
        report.management_manifest.dependencies[0].id,
        "dev.asterlyn.android-gradle"
    );
    let old_capabilities = SUPPORTED_CAPABILITIES
        .iter()
        .copied()
        .filter(|c| *c != "pluginDependencies")
        .collect::<Vec<_>>();
    let mut old = context();
    old.supported_capabilities = &old_capabilities;
    assert!(inspect_package(&package(&bytes), &old).is_err());
    for dependencies in [
        serde_json::json!([declaration.clone()]),
        serde_json::json!([declaration.clone(), declaration]),
        serde_json::json!([{"id":"../bad","minimum":"0.5.10"}]),
    ] {
        let bytes = manifest(|value| value["dependencies"] = dependencies);
        assert!(inspect_package(&package(&bytes), &current).is_err());
    }
}

#[test]
fn extracts_only_after_admission_into_a_new_directory() {
    let directory = tempfile::tempdir().unwrap();
    let destination = directory.path().join("admitted");
    let report = extract_admitted_package(&valid_package(), &context(), &destination).unwrap();
    assert_eq!(report.plugin_id, "dev.asterlyn.example");
    assert_eq!(report.management_manifest.name_key, "name");
    assert_eq!(
        report.management_manifest.localization.locales["en-US"]["name"],
        "Example"
    );
    assert_eq!(
        fs::read(destination.join("runtime/plugin.js")).unwrap(),
        RUNTIME
    );
    assert!(extract_admitted_package(&valid_package(), &context(), &destination).is_err());
}

#[test]
fn rejects_invalid_host_rendered_manifest_metadata() {
    let missing_copy = manifest(|value| {
        value["localization"]["locales"]["en-US"]
            .as_object_mut()
            .unwrap()
            .remove("name");
    });
    let package = archive(&[
        (MANIFEST_PATH, &missing_copy, EntryType::Regular),
        ("runtime/plugin.js", RUNTIME, EntryType::Regular),
        ("LICENSE", LICENSE, EntryType::Regular),
    ]);
    assert!(matches!(
        inspect_package(&package, &context()),
        Err(AdmissionError::Contract(message))
            if message.contains("referenced message")
    ));

    let invalid_setting = manifest(|value| {
        value["settings"] = json!([{
            "id": "mode",
            "kind": "enum",
            "labelKey": "name",
            "defaultValue": "missing",
            "options": [{ "value": "compact", "labelKey": "name" }]
        }]);
    });
    let package = archive(&[
        (MANIFEST_PATH, &invalid_setting, EntryType::Regular),
        ("runtime/plugin.js", RUNTIME, EntryType::Regular),
        ("LICENSE", LICENSE, EntryType::Regular),
    ]);
    assert!(matches!(
        inspect_package(&package, &context()),
        Err(AdmissionError::Contract(message))
            if message.contains("default is not an option")
    ));
}

#[test]
fn retains_schema_two_declarations_only_for_the_legacy_compatibility_gate() {
    let declared = manifest(|value| {
        value["schemaVersion"] = json!(2);
        value["capabilities"] = json!(["tasks", "processQueries", "toolOperations"]);
        value["permissions"] = json!([
            "host.tasks.execute",
            "host.process.query",
            "host.tool.execute"
        ]);
        value["processQueries"] = json!([{
            "id": "fixture.version",
            "args": ["--version"],
            "timeoutMs": 1000,
            "maxOutputBytes": 1024,
            "executables": [{ "type": "path", "name": "fixture-tool" }]
        }]);
        value["toolOperations"] = json!([{
            "id": "fixture.inspect",
            "intent": "query",
            "args": [
                { "type": "literal", "value": "inspect" },
                { "type": "parameter", "name": "artifact" }
            ],
            "parameters": [{
                "name": "artifact",
                "kind": "workspaceArtifact",
                "suffixes": [".apk"]
            }],
            "timeoutMs": 1000,
            "maxOutputBytes": 1024,
            "executables": [{ "type": "path", "name": "fixture-tool" }]
        }]);
    });
    let package = archive(&[
        (MANIFEST_PATH, &declared, EntryType::Regular),
        ("runtime/plugin.js", RUNTIME, EntryType::Regular),
        ("LICENSE", LICENSE, EntryType::Regular),
    ]);
    let report = inspect_package(&package, &context()).unwrap();
    assert_eq!(
        report.management_manifest.process_queries[0].id,
        "fixture.version"
    );
    assert_eq!(
        report.management_manifest.tool_operations[0].id,
        "fixture.inspect"
    );

    let undeclared_permission = manifest(|value| {
        value["schemaVersion"] = json!(2);
        value["capabilities"] = json!(["tasks", "processQueries"]);
        value["processQueries"] = json!([{
            "id": "fixture.version",
            "args": [],
            "timeoutMs": 1000,
            "maxOutputBytes": 1024,
            "executables": [{ "type": "path", "name": "fixture-tool" }]
        }]);
    });
    let package = archive(&[
        (MANIFEST_PATH, &undeclared_permission, EntryType::Regular),
        ("runtime/plugin.js", RUNTIME, EntryType::Regular),
        ("LICENSE", LICENSE, EntryType::Regular),
    ]);
    assert!(matches!(
        inspect_package(&package, &context()),
        Err(AdmissionError::Contract(message)) if message.contains("host.process.query")
    ));
}

#[test]
fn schema_three_admits_only_semantic_host_operation_ids() {
    let declared = manifest(|value| {
        value["capabilities"] = json!(["tasks", "processQueries", "toolOperations"]);
        value["permissions"] = json!([
            "host.tasks.execute",
            "host.process.query",
            "host.tool.execute"
        ]);
        value["hostOperations"] = json!([
            { "id": "adb.devices" },
            { "id": "android.adb.install" }
        ]);
    });
    let package = archive(&[
        (MANIFEST_PATH, &declared, EntryType::Regular),
        ("runtime/plugin.js", RUNTIME, EntryType::Regular),
        ("LICENSE", LICENSE, EntryType::Regular),
    ]);
    let report = inspect_package(&package, &context()).unwrap();
    assert_eq!(report.management_manifest.schema_version, 3);
    assert_eq!(
        report.management_manifest.host_operations[0].id,
        "adb.devices"
    );
    assert!(report.management_manifest.process_queries.is_empty());

    let raw = manifest(|value| {
        value["capabilities"] = json!(["processQueries"]);
        value["permissions"] = json!(["host.process.query"]);
        value["processQueries"] = json!([{
            "id": "fixture.version",
            "args": [],
            "timeoutMs": 1000,
            "maxOutputBytes": 1024,
            "executables": [{ "type": "path", "name": "fixture-tool" }]
        }]);
    });
    let package = archive(&[
        (MANIFEST_PATH, &raw, EntryType::Regular),
        ("runtime/plugin.js", RUNTIME, EntryType::Regular),
        ("LICENSE", LICENSE, EntryType::Regular),
    ]);
    assert!(matches!(
        inspect_package(&package, &context()),
        Err(AdmissionError::Contract(message)) if message.contains("forbids package-authored")
    ));
}

#[test]
fn revalidates_extracted_packages_and_rejects_local_tampering() {
    let directory = tempfile::tempdir().unwrap();
    let destination = directory.path().join("admitted");
    let admitted = extract_admitted_package(&valid_package(), &context(), &destination).unwrap();
    let report = inspect_extracted_package(&destination, &context()).unwrap();
    assert_eq!(report.plugin_id, "dev.asterlyn.example");
    assert_eq!(report.content_digest, admitted.content_digest);

    fs::write(
        destination.join("runtime/plugin.js"),
        b"export const compromised = true;",
    )
    .unwrap();
    assert!(
        inspect_extracted_package(&destination, &context())
            .unwrap_err()
            .to_string()
            .contains("SHA-256 mismatch")
    );
}

#[test]
fn canonical_content_digest_detects_coordinated_manifest_and_runtime_tampering() {
    let directory = tempfile::tempdir().unwrap();
    let destination = directory.path().join("admitted");
    let admitted = extract_admitted_package(&valid_package(), &context(), &destination).unwrap();
    let changed_runtime = b"export function activate() { return 'changed'; }";
    fs::write(destination.join("runtime/plugin.js"), changed_runtime).unwrap();
    let manifest_path = destination.join(MANIFEST_PATH);
    let mut changed_manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    changed_manifest["distribution"]["integrity"]["runtime/plugin.js"] =
        serde_json::Value::String(digest(changed_runtime));
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&changed_manifest).unwrap(),
    )
    .unwrap();

    let self_consistent = inspect_extracted_package(&destination, &context()).unwrap();
    assert_ne!(self_consistent.content_digest, admitted.content_digest);
}

#[test]
fn rejects_files_added_after_package_admission() {
    let directory = tempfile::tempdir().unwrap();
    let destination = directory.path().join("admitted");
    extract_admitted_package(&valid_package(), &context(), &destination).unwrap();
    fs::write(destination.join("injected.js"), b"injected").unwrap();
    assert!(
        inspect_extracted_package(&destination, &context())
            .unwrap_err()
            .to_string()
            .contains("integrity table must cover")
    );
}

#[test]
fn admits_a_bounded_schema_two_package() {
    let report = inspect_package(&valid_package(), &context()).unwrap();
    assert_eq!(report.plugin_id, "dev.asterlyn.example");
    assert_eq!(report.repository, "asterlyn/example-plugin");
    assert_eq!(report.runtime_entry, "runtime/plugin.js");
    assert_eq!(report.files.len(), 3);
}

#[test]
fn rejects_schema_one_and_source_identity_drift() {
    let old = manifest(|value| value["schemaVersion"] = json!(1));
    let package = archive(&[
        (MANIFEST_PATH, &old, EntryType::Regular),
        ("runtime/plugin.js", RUNTIME, EntryType::Regular),
        ("LICENSE", LICENSE, EntryType::Regular),
    ]);
    assert!(
        inspect_package(&package, &context())
            .unwrap_err()
            .to_string()
            .contains("schema 2")
    );

    let drifted =
        manifest(|value| value["distribution"]["repository"] = json!("other/example-plugin"));
    let package = archive(&[
        (MANIFEST_PATH, &drifted, EntryType::Regular),
        ("runtime/plugin.js", RUNTIME, EntryType::Regular),
        ("LICENSE", LICENSE, EntryType::Regular),
    ]);
    assert!(
        inspect_package(&package, &context())
            .unwrap_err()
            .to_string()
            .contains("configured source")
    );
}

#[test]
fn rejects_links_case_collisions_and_digest_mismatch() {
    let package_manifest = manifest(|_| {});
    let linked = archive(&[
        (MANIFEST_PATH, &package_manifest, EntryType::Regular),
        ("runtime/plugin.js", RUNTIME, EntryType::Symlink),
        ("LICENSE", LICENSE, EntryType::Regular),
    ]);
    assert!(matches!(
        inspect_package(&linked, &context()),
        Err(AdmissionError::UnsupportedEntry(_))
    ));

    let collision = archive(&[
        (MANIFEST_PATH, &package_manifest, EntryType::Regular),
        ("runtime/plugin.js", RUNTIME, EntryType::Regular),
        ("RUNTIME/PLUGIN.JS", RUNTIME, EntryType::Regular),
        ("LICENSE", LICENSE, EntryType::Regular),
    ]);
    assert!(matches!(
        inspect_package(&collision, &context()),
        Err(AdmissionError::DuplicatePath(_))
    ));

    let bad_manifest = manifest(|value| {
        value["distribution"]["integrity"]["runtime/plugin.js"] = json!("sha256:0000")
    });
    let package = archive(&[
        (MANIFEST_PATH, &bad_manifest, EntryType::Regular),
        ("runtime/plugin.js", RUNTIME, EntryType::Regular),
        ("LICENSE", LICENSE, EntryType::Regular),
    ]);
    assert!(matches!(
        inspect_package(&package, &context()),
        Err(AdmissionError::Integrity(_))
    ));
}

#[test]
fn rejects_unknown_authority_and_missing_license_text() {
    let unknown = manifest(|value| value["permissions"] = json!(["host.everything"]));
    let package = archive(&[
        (MANIFEST_PATH, &unknown, EntryType::Regular),
        ("runtime/plugin.js", RUNTIME, EntryType::Regular),
        ("LICENSE", LICENSE, EntryType::Regular),
    ]);
    assert!(
        inspect_package(&package, &context())
            .unwrap_err()
            .to_string()
            .contains("unsupported required permission")
    );

    let manifest = manifest(|_| {});
    let package = archive(&[
        (MANIFEST_PATH, &manifest, EntryType::Regular),
        ("runtime/plugin.js", RUNTIME, EntryType::Regular),
    ]);
    assert!(
        inspect_package(&package, &context())
            .unwrap_err()
            .to_string()
            .contains("license text")
    );
}

#[test]
fn rejects_parent_and_windows_paths_before_manifest_parsing() {
    assert!(matches!(
        validate_archive_path("../escape"),
        Err(AdmissionError::InvalidPath(_))
    ));
    assert!(matches!(
        validate_archive_path("C:/escape"),
        Err(AdmissionError::InvalidPath(_))
    ));
    assert!(matches!(
        validate_archive_path("runtime\\plugin.js"),
        Err(AdmissionError::InvalidPath(_))
    ));
}

#[test]
fn malformed_gzip_fails_closed() {
    let mut bytes = Vec::new();
    bytes.write_all(b"not a package").unwrap();
    assert!(inspect_package(&bytes, &context()).is_err());
}
