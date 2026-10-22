use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use asterlyn_plugin_package::{
    AdmissionContext, SUPPORTED_CAPABILITIES, SUPPORTED_PERMISSIONS, extract_admitted_package,
};
use asterlyn_plugin_runtime::{
    CapabilityContext, CapabilityHandler, PluginActivation, PluginHostSupervisor,
    PluginRuntimeIdentity,
};
use asterlyn_plugin_runtime_protocol::{
    CapabilityRequest, ContributionKind, HostTheme, RemoteFailure, ShutdownReason,
};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde_json::{Value as JsonValue, json};
use sha2::{Digest, Sha256};
use tempfile::TempDir;

const PLUGIN_ID: &str = "dev.asterlyn.android-gradle";
const PACKAGE_ENV: &str = "ASTERLYN_ANDROID_PLUGIN_PACKAGE";
const PLUGIN_VERSION_ENV: &str = "ASTERLYN_ANDROID_PLUGIN_VERSION";
const HOST_VERSION_ENV: &str = "ASTERLYN_HOST_VERSION";

struct AndroidParityCapabilities {
    cache_payload_base64: String,
}

impl CapabilityHandler for AndroidParityCapabilities {
    fn execute(
        &self,
        context: &CapabilityContext<'_>,
        request: &CapabilityRequest,
    ) -> Result<JsonValue, RemoteFailure> {
        assert_eq!(context.plugin_id, PLUGIN_ID);
        assert_eq!(context.workspace_generation, 7);
        match (request.capability.as_str(), request.operation.as_str()) {
            ("workspaceState", "read" | "write") => Ok(JsonValue::Null),
            ("processQueries", "execute") => Ok(json!({
                "status": "succeeded",
                "stdout": "List of devices attached\nserial-1\tdevice product:pixel model:Pixel_8 device:husky transport_id:1\n",
                "stderr": "",
                "truncated": false,
                "error": null,
            })),
            ("taskCache", "read") => Ok(json!({
                "protocolVersion": 1,
                "status": "stale",
                "pluginId": PLUGIN_ID,
                "providerId": "gradle-tasks",
                "fingerprint": null,
                "payloadBase64": self.cache_payload_base64,
                "updatedAtEpochMs": 1_792_000_000_000_u64,
                "lastAccessEpochMs": 1_792_000_000_000_u64,
                "staleReason": "expired",
                "dirtyReason": null,
            })),
            ("taskCache", "computeFingerprint") => Ok(json!({
                "protocolVersion": 1,
                "status": "unavailable",
                "workspaceRoot": context.workspace_root,
                "algorithm": "sha256",
                "digest": null,
                "files": [],
                "truncated": false,
                "reason": "parity fixture",
                "os": "unknown",
                "arch": "unknown",
                "javaHomeDigest": null,
            })),
            ("taskCache", "write" | "markDirty") => Ok(json!({
                "protocolVersion": 1,
                "status": "unavailable",
                "pluginId": PLUGIN_ID,
                "providerId": "gradle-tasks",
                "fingerprint": null,
                "updatedAtEpochMs": null,
                "lastAccessEpochMs": null,
                "dirtyReason": null,
            })),
            _ => Err(RemoteFailure {
                code: "parity.unsupported".to_owned(),
                message: format!(
                    "unexpected parity capability: {} / {}",
                    request.capability, request.operation
                ),
                retryable: false,
            }),
        }
    }
}

#[test]
#[ignore = "requires the released Android plugin package and explicit plugin/host versions"]
fn released_android_plugin_activates_with_first_party_parity() {
    let package_path = PathBuf::from(env::var_os(PACKAGE_ENV).expect(PACKAGE_ENV));
    let plugin_version = env::var(PLUGIN_VERSION_ENV).expect(PLUGIN_VERSION_ENV);
    let host_version = env::var(HOST_VERSION_ENV).expect(HOST_VERSION_ENV);
    let package = fs::read(&package_path).expect("read Android plugin package");
    let extracted_parent = TempDir::new().expect("extraction parent");
    let extracted = extracted_parent.path().join("android-plugin");
    let report = extract_admitted_package(
        &package,
        &AdmissionContext {
            repository: "guozhiqiang123/asterlyn-plugin-android-gradle",
            release_version: &plugin_version,
            host_version: &host_version,
            sdk_major: 1,
            runtime_protocol: 1,
            supported_capabilities: SUPPORTED_CAPABILITIES,
            supported_permissions: SUPPORTED_PERMISSIONS,
        },
        &extracted,
    )
    .expect("admit and extract Android plugin package");
    assert_eq!(report.plugin_id, PLUGIN_ID);
    assert_eq!(report.plugin_version, plugin_version);

    let helper = PathBuf::from(env!("CARGO_BIN_EXE_asterlyn-plugin-host"))
        .canonicalize()
        .expect("plugin host helper");
    let installation = helper.parent().expect("helper installation root");
    let supervisor = PluginHostSupervisor::from_verified_helper_with_capabilities(
        &helper,
        installation,
        Arc::new(AndroidParityCapabilities {
            cache_payload_base64: filesrecovery_scale_cache_payload(&plugin_version),
        }),
    )
    .expect("create plugin supervisor");
    let package_digest = format!("sha256:{:x}", Sha256::digest(&package));
    let activated = supervisor
        .activate(PluginActivation {
            owner: "window-android-parity".to_owned(),
            plugin_root: extracted,
            identity: PluginRuntimeIdentity {
                plugin_id: report.plugin_id,
                plugin_version: report.plugin_version,
                package_digest,
                runtime_entry: report.runtime_entry,
            },
            capabilities: report.capabilities,
            permissions: report.permissions,
            workspace_id: "workspace-android-parity".to_owned(),
            workspace_generation: 7,
            workspace_root: "/workspace/android".to_owned(),
            evidence: json!([{
                "kind": "workspace-catalog",
                "values": {
                    "platform": "posix",
                    "truncated": false,
                    "files": [
                        "gradlew",
                        "settings.gradle.kts",
                        "build.gradle.kts",
                        "app/build.gradle.kts",
                        "gradle/wrapper/gradle-wrapper.properties"
                    ]
                }
            }]),
            locale: "en-US".to_owned(),
            theme: HostTheme::Dark,
        })
        .expect("activate released Android plugin");

    let contributions = &activated.contributions;
    assert_eq!(contributions.len(), 4);
    assert!(contributions.iter().any(|entry| {
        entry.id == "gradle-tasks" && entry.kind == ContributionKind::TaskProvider
    }));
    assert!(contributions.iter().any(|entry| {
        entry.id == "refresh-gradle-tasks" && entry.kind == ContributionKind::Command
    }));
    assert!(contributions.iter().any(|entry| {
        entry.id == "android-devices" && entry.kind == ContributionKind::ExecutionTargetProvider
    }));
    assert!(contributions.iter().any(|entry| {
        entry.id == "android-run-configurations"
            && entry.kind == ContributionKind::RunConfigurationProvider
    }));

    let tasks = contribution(contributions, "gradle-tasks");
    let task_snapshot = invoke(&supervisor, tasks, "snapshot");
    assert_eq!(task_snapshot["status"], "ready");
    assert_eq!(task_snapshot["cache"]["status"], "stale");
    assert_eq!(
        task_snapshot["tasks"].as_array().map(Vec::len),
        Some(15_980)
    );

    let devices = contribution(contributions, "android-devices");
    let device_snapshot = invoke(&supervisor, devices, "snapshot");
    assert_eq!(device_snapshot["status"], "ready", "{device_snapshot}");
    assert_eq!(device_snapshot["targets"][0]["id"], "serial-1");
    assert_eq!(device_snapshot["selectedTargetId"], "serial-1");

    let configurations = contribution(contributions, "android-run-configurations");
    let run_snapshot = invoke(&supervisor, configurations, "snapshot");
    assert_eq!(run_snapshot["status"], "ready");
    assert_eq!(run_snapshot["configurations"], json!([]));

    supervisor.cancel_owner("window-android-parity", ShutdownReason::WindowClosed);
    assert_eq!(supervisor.active_count(), 0);
}

fn filesrecovery_scale_cache_payload(plugin_version: &str) -> String {
    let tasks = (0..15_980)
        .map(|index| {
            let id = format!(":app:generatedTask{index:05}");
            json!({
                "id": id,
                "label": id,
                "group": "Other tasks",
                "projectPath": ":app",
                "runnable": false,
            })
        })
        .collect::<Vec<_>>();
    let payload = serde_json::to_vec(&json!({
        "schemaVersion": 1,
        "pluginId": PLUGIN_ID,
        "pluginVersion": plugin_version,
        "providerId": "gradle-tasks",
        "parserVersion": 1,
        "discoveryProtocolVersion": 1,
        "tasks": tasks,
    }))
    .expect("serialize FilesRecovery-scale cache fixture");
    assert!(payload.len() > 1024 * 1024, "fixture must cross one frame");
    BASE64.encode(payload)
}

fn contribution<'a>(
    contributions: &'a [asterlyn_plugin_runtime_protocol::RuntimeContribution],
    id: &str,
) -> &'a asterlyn_plugin_runtime_protocol::RuntimeContribution {
    contributions
        .iter()
        .find(|entry| entry.id == id)
        .unwrap_or_else(|| panic!("missing contribution: {id}"))
}

fn invoke(
    supervisor: &PluginHostSupervisor,
    contribution: &asterlyn_plugin_runtime_protocol::RuntimeContribution,
    operation: &str,
) -> JsonValue {
    let handle = contribution
        .callbacks
        .get(operation)
        .unwrap_or_else(|| panic!("missing callback: {}.{operation}", contribution.id));
    supervisor
        .invoke(
            "window-android-parity",
            PLUGIN_ID,
            handle,
            operation,
            json!({"arguments": []}),
        )
        .unwrap_or_else(|error| panic!("invoke {}.{operation}: {error}", contribution.id))
}
