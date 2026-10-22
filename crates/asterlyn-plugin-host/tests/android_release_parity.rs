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
const CACHE_ENTRY_ENV: &str = "ASTERLYN_ANDROID_CACHE_ENTRY";
const GRADLE_OUTPUT_ENV: &str = "ASTERLYN_ANDROID_GRADLE_OUTPUT";

struct AndroidParityCapabilities {
    cache_payload_base64: String,
    ready_fingerprint: bool,
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
                "status": if self.ready_fingerprint { "ready" } else { "unavailable" },
                "workspaceRoot": context.workspace_root,
                "algorithm": "sha256",
                "digest": if self.ready_fingerprint { Some("a".repeat(64)) } else { None },
                "files": [],
                "truncated": false,
                "reason": if self.ready_fingerprint { None } else { Some("parity fixture") },
                "os": "unknown",
                "arch": "unknown",
                "javaHomeDigest": null,
            })),
            ("taskCache", "write" | "markDirty") => Ok(json!({
                "protocolVersion": 1,
                "status": if self.ready_fingerprint { "stored" } else { "unavailable" },
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
            ready_fingerprint: false,
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

#[test]
#[ignore = "requires the released Android plugin package and explicit plugin/host versions"]
fn released_android_plugin_applies_filesrecovery_scale_task_refresh() {
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
    let helper = PathBuf::from(env!("CARGO_BIN_EXE_asterlyn-plugin-host"))
        .canonicalize()
        .expect("plugin host helper");
    let ready_fingerprint = env::var("ASTERLYN_ANDROID_READY_FINGERPRINT").as_deref() != Ok("0");
    let supervisor = PluginHostSupervisor::from_verified_helper_with_capabilities(
        &helper,
        helper.parent().expect("helper installation root"),
        Arc::new(AndroidParityCapabilities {
            cache_payload_base64: String::new(),
            ready_fingerprint,
        }),
    )
    .expect("create plugin supervisor");
    let package_digest = format!("sha256:{:x}", Sha256::digest(&package));
    let activated = supervisor
        .activate(PluginActivation {
            owner: "window-android-refresh".to_owned(),
            plugin_root: extracted,
            identity: PluginRuntimeIdentity {
                plugin_id: report.plugin_id,
                plugin_version: report.plugin_version,
                package_digest,
                runtime_entry: report.runtime_entry,
            },
            capabilities: report.capabilities,
            permissions: report.permissions,
            workspace_id: "workspace-android-refresh".to_owned(),
            workspace_generation: 7,
            workspace_root: "/workspace/android".to_owned(),
            evidence: json!([{
                "kind": "workspace-catalog",
                "values": {
                    "platform": "posix",
                    "truncated": false,
                    "files": ["gradlew", "settings.gradle", "build.gradle"]
                }
            }]),
            locale: "en-US".to_owned(),
            theme: HostTheme::Dark,
        })
        .expect("activate released Android plugin");
    let tasks = contribution(&activated.contributions, "gradle-tasks");
    let plan = invoke_for_owner(
        &supervisor,
        "window-android-refresh",
        tasks,
        "refresh",
        json!({"arguments": []}),
    );
    let apply = plan["apply"]["$asterlynCallback"]["handle"]
        .as_str()
        .expect("refresh apply handle");
    let task_count = env::var("ASTERLYN_ANDROID_TASK_COUNT")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(15_980);
    let output = env::var_os(GRADLE_OUTPUT_ENV)
        .map(|path| fs::read(path).expect("read real Gradle task output"))
        .unwrap_or_else(|| synthetic_gradle_tasks(task_count).into_bytes());
    let chunk_bytes = env::var("ASTERLYN_ANDROID_OUTPUT_CHUNK_BYTES")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(output.len().max(1));
    let outputs = output
        .chunks(chunk_bytes)
        .map(|chunk| json!({"stream": "stdout", "dataBase64": BASE64.encode(chunk)}))
        .collect::<Vec<_>>();
    supervisor
        .invoke(
            "window-android-refresh",
            PLUGIN_ID,
            apply,
            "apply",
            json!({"arguments": [{
                "status": "succeeded",
                "outputs": outputs,
                "truncated": false
            }]}),
        )
        .expect("apply Gradle task refresh");
    let snapshot = invoke_for_owner(
        &supervisor,
        "window-android-refresh",
        tasks,
        "snapshot",
        json!({"arguments": []}),
    );
    assert_eq!(snapshot["tasks"].as_array().map(Vec::len), Some(task_count));
    assert_eq!(
        snapshot["cache"]["status"],
        if ready_fingerprint { "ready" } else { "stale" }
    );
    assert_eq!(snapshot["tasks"][0]["runnable"], ready_fingerprint);
    // The renderer suppresses remote custom collections above this bound and projects the
    // validated provider snapshot directly. Keep the parity test on that production path.
    if task_count <= 4_096 {
        let collections = invoke_for_owner(
            &supervisor,
            "window-android-refresh",
            tasks,
            "collections",
            json!({"arguments": []}),
        );
        assert!(collections[0]["nodes"].as_array().is_some());
    }
}

fn synthetic_gradle_tasks(count: usize) -> String {
    let mut output =
        String::from("Tasks runnable from root project 'superboost'\n\nBuild tasks\n-----------\n");
    for index in 0..count {
        output.push_str(&format!("task{index:04} - Generated task {index}\n"));
    }
    output
}

fn invoke_for_owner(
    supervisor: &PluginHostSupervisor,
    owner: &str,
    contribution: &asterlyn_plugin_runtime_protocol::RuntimeContribution,
    operation: &str,
    payload: JsonValue,
) -> JsonValue {
    let handle = contribution
        .callbacks
        .get(operation)
        .expect("callback handle");
    supervisor
        .invoke(owner, PLUGIN_ID, handle, operation, payload)
        .expect("invoke callback")
}

fn filesrecovery_scale_cache_payload(plugin_version: &str) -> String {
    if let Some(path) = env::var_os(CACHE_ENTRY_ENV) {
        let entry = fs::read(path).expect("read Android task cache entry");
        let entry: JsonValue =
            serde_json::from_slice(&entry).expect("parse Android task cache entry");
        let encoded = entry["payloadBase64"]
            .as_str()
            .expect("Android task cache payloadBase64");
        let payload = BASE64
            .decode(encoded)
            .expect("decode Android task cache payload");
        let mut payload: JsonValue =
            serde_json::from_slice(&payload).expect("parse Android task cache payload");
        payload["pluginVersion"] = JsonValue::String(plugin_version.to_owned());
        assert_eq!(
            payload["tasks"].as_array().map(Vec::len),
            Some(15_980),
            "real cache fixture must retain the FilesRecovery task scale"
        );
        if payload["schemaVersion"] == 1 {
            payload = compact_v1_cache_payload(payload, plugin_version);
        }
        return BASE64.encode(
            serde_json::to_vec(&payload).expect("serialize version-adjusted Android task cache"),
        );
    }
    let tasks = (0..15_980)
        .map(|index| {
            json!([
                format!(":feature-module-{index:05}:generatedTask{index:05}"),
                0,
                format!("Generated FilesRecovery-scale task description for module {index:05}")
            ])
        })
        .collect::<Vec<_>>();
    let payload = serde_json::to_vec(&json!({
        "schemaVersion": 2,
        "pluginId": PLUGIN_ID,
        "pluginVersion": plugin_version,
        "providerId": "gradle-tasks",
        "parserVersion": 1,
        "discoveryProtocolVersion": 1,
        "groups": ["Other tasks"],
        "tasks": tasks,
    }))
    .expect("serialize FilesRecovery-scale cache fixture");
    assert!(payload.len() > 1024 * 1024, "fixture must cross one frame");
    BASE64.encode(payload)
}

fn compact_v1_cache_payload(payload: JsonValue, plugin_version: &str) -> JsonValue {
    let source = payload["tasks"].as_array().expect("v1 task array");
    let mut groups = Vec::<String>::new();
    let tasks = source
        .iter()
        .map(|task| {
            let id = task["id"].as_str().expect("v1 task id");
            let group = task["group"].as_str().expect("v1 task group");
            let group_index = groups
                .iter()
                .position(|candidate| candidate == group)
                .unwrap_or_else(|| {
                    groups.push(group.to_owned());
                    groups.len() - 1
                });
            match task["description"].as_str() {
                Some(description) => json!([id, group_index, description]),
                None => json!([id, group_index]),
            }
        })
        .collect::<Vec<_>>();
    json!({
        "schemaVersion": 2,
        "pluginId": PLUGIN_ID,
        "pluginVersion": plugin_version,
        "providerId": "gradle-tasks",
        "parserVersion": 1,
        "discoveryProtocolVersion": 1,
        "groups": groups,
        "tasks": tasks,
    })
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
