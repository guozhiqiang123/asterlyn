use std::path::{Path, PathBuf};
use std::sync::Arc;

use asterlyn_plugin_runtime::{
    CapabilityContext, CapabilityHandler, PluginHostSupervisor, PluginRuntimeError,
};
use asterlyn_plugin_runtime_protocol::{CapabilityRequest, RemoteFailure};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde_json::{Value as JsonValue, json};
use tauri::{Emitter, Manager};

use super::plugin_process_query::{PluginProcessQueryResult, PluginProcessQueryStatus};
use super::plugin_task_cache::{self, CacheMutationStatus, CacheReadStatus};
use super::plugin_workspace_state;
use super::{ActiveWorkspaces, PluginProcessQueryManager};

pub(crate) const PLUGIN_NOTIFICATION_EVENT: &str = "asterlyn://plugin-notification";

const TASK_CACHE_PERMISSION: &str = "host.tasks.cache";
const PROCESS_QUERY_PERMISSION: &str = "host.process.query";
const WORKSPACE_STATE_PERMISSION: &str = "host.workspace.state";
const NOTIFICATION_PERMISSION: &str = "host.notifications.publish";

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginNotificationEvent<'a> {
    plugin_id: &'a str,
    kind: &'a str,
    message_key: &'a str,
}

pub(crate) fn build_plugin_host_supervisor(
    app: tauri::AppHandle,
) -> Result<PluginHostSupervisor, PluginRuntimeError> {
    let current_executable = std::env::current_exe().map_err(|error| {
        PluginRuntimeError::InvalidConfiguration(format!(
            "resolve current application executable: {error}"
        ))
    })?;
    #[cfg(debug_assertions)]
    let development_binaries = Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries"));
    #[cfg(not(debug_assertions))]
    let development_binaries: Option<PathBuf> = None;
    let helper = resolve_plugin_host_helper(&current_executable, development_binaries.as_deref())?;
    let installation_root = helper.parent().ok_or_else(|| {
        PluginRuntimeError::InvalidConfiguration(
            "plugin helper has no installation directory".to_owned(),
        )
    })?;
    PluginHostSupervisor::from_verified_helper_with_capabilities(
        &helper,
        installation_root,
        Arc::new(NativePluginCapabilityHandler { app }),
    )
}

struct NativePluginCapabilityHandler {
    app: tauri::AppHandle,
}

impl CapabilityHandler for NativePluginCapabilityHandler {
    fn execute(
        &self,
        context: &CapabilityContext<'_>,
        request: &CapabilityRequest,
    ) -> Result<JsonValue, RemoteFailure> {
        let permission = required_permission(&request.capability, &request.operation)?;
        if !context.admitted_permissions.contains(permission) {
            return Err(failure(
                "capability.permission-denied",
                format!("capability permission is not admitted: {permission}"),
            ));
        }
        let root = self
            .app
            .state::<ActiveWorkspaces>()
            .resolve(context.owner, context.workspace_root)
            .map_err(|error| failure("capability.workspace-stale", error.to_string()))?;
        let arguments = capability_arguments(&request.payload)?;
        match (request.capability.as_str(), request.operation.as_str()) {
            ("taskCache", "computeFingerprint") => {
                expect_count(arguments, 1)?;
                let paths = string_array(&arguments[0], "fingerprint paths")?;
                serialize(plugin_task_cache::compute_fingerprint(&root, &paths))
            }
            ("taskCache", "read") => {
                expect_count(arguments, 1)?;
                let provider_id = string_argument(&arguments[0], "provider ID")?;
                let cache_root = self.plugin_task_cache_root()?;
                let value = plugin_task_cache::read_cache(
                    &cache_root,
                    &root,
                    context.plugin_id,
                    provider_id,
                );
                Ok(json!({
                    "protocolVersion": 1,
                    "status": cache_read_status(value.status),
                    "pluginId": value.plugin_id,
                    "providerId": value.provider_id,
                    "fingerprint": value.fingerprint,
                    "payloadBase64": value.payload_base64,
                    "updatedAtEpochMs": value.updated_at_epoch_ms,
                    "lastAccessEpochMs": value.last_access_epoch_ms,
                    "staleReason": value.stale_reason,
                    "dirtyReason": value.dirty_reason,
                }))
            }
            ("taskCache", "write") => {
                expect_count(arguments, 3)?;
                let provider_id = string_argument(&arguments[0], "provider ID")?;
                let fingerprint =
                    serde_json::from_value(arguments[1].clone()).map_err(|error| {
                        failure(
                            "capability.invalid-arguments",
                            format!("fingerprint is invalid: {error}"),
                        )
                    })?;
                let payload = string_argument(&arguments[2], "cache payload")?;
                let value = plugin_task_cache::write_cache(
                    &self.plugin_task_cache_root()?,
                    &root,
                    context.plugin_id,
                    provider_id,
                    fingerprint,
                    payload,
                );
                Ok(cache_mutation_value(value))
            }
            ("taskCache", "markDirty") => {
                expect_count(arguments, 2)?;
                let provider_id = string_argument(&arguments[0], "provider ID")?;
                let reason = string_argument(&arguments[1], "dirty reason")?;
                let value = plugin_task_cache::mark_dirty(
                    &self.plugin_task_cache_root()?,
                    &root,
                    context.plugin_id,
                    provider_id,
                    reason,
                );
                Ok(cache_mutation_value(value))
            }
            ("processQueries", "execute") => {
                expect_count(arguments, 1)?;
                let query_id = string_argument(&arguments[0], "query ID")?;
                let result = self.app.state::<PluginProcessQueryManager>().execute_exact(
                    context.owner,
                    &root,
                    context.plugin_id,
                    context.plugin_version,
                    context.package_digest,
                    query_id,
                );
                Ok(process_query_value(result))
            }
            ("workspaceState", "read") => {
                expect_count(arguments, 1)?;
                let key = string_argument(&arguments[0], "workspace-state key")?;
                let value = plugin_workspace_state::read(
                    &self.plugin_workspace_state_root()?,
                    &root,
                    context.plugin_id,
                    key,
                )
                .map_err(|error| failure("capability.workspace-state", error))?;
                Ok(value.map(JsonValue::String).unwrap_or(JsonValue::Null))
            }
            ("workspaceState", "write") => {
                expect_count(arguments, 2)?;
                let key = string_argument(&arguments[0], "workspace-state key")?;
                let value = string_argument(&arguments[1], "workspace-state value")?;
                plugin_workspace_state::write(
                    &self.plugin_workspace_state_root()?,
                    &root,
                    context.plugin_id,
                    key,
                    value,
                )
                .map_err(|error| failure("capability.workspace-state", error))?;
                Ok(JsonValue::Null)
            }
            ("notifications", "publish") => {
                expect_count(arguments, 1)?;
                let request = arguments[0].as_object().ok_or_else(|| {
                    failure(
                        "capability.invalid-arguments",
                        "notification request must be an object",
                    )
                })?;
                if request.len() != 2 {
                    return Err(failure(
                        "capability.invalid-arguments",
                        "notification request has an invalid shape",
                    ));
                }
                let kind = request
                    .get("kind")
                    .and_then(JsonValue::as_str)
                    .filter(|kind| matches!(*kind, "info" | "success" | "warning" | "error"))
                    .ok_or_else(|| {
                        failure(
                            "capability.invalid-arguments",
                            "notification kind is invalid",
                        )
                    })?;
                let message_key = request
                    .get("messageKey")
                    .and_then(JsonValue::as_str)
                    .filter(|key| valid_message_key(key))
                    .ok_or_else(|| {
                        failure(
                            "capability.invalid-arguments",
                            "notification message key is invalid",
                        )
                    })?;
                self.app
                    .emit_to(
                        context.owner,
                        PLUGIN_NOTIFICATION_EVENT,
                        PluginNotificationEvent {
                            plugin_id: context.plugin_id,
                            kind,
                            message_key,
                        },
                    )
                    .map_err(|error| {
                        failure(
                            "capability.notification-unavailable",
                            format!("publish plugin notification: {error}"),
                        )
                    })?;
                Ok(JsonValue::Null)
            }
            _ => Err(failure(
                "capability.unsupported-operation",
                format!(
                    "unsupported capability operation: {} / {}",
                    request.capability, request.operation
                ),
            )),
        }
    }
}

impl NativePluginCapabilityHandler {
    fn plugin_task_cache_root(&self) -> Result<PathBuf, RemoteFailure> {
        self.app
            .path()
            .app_cache_dir()
            .map(|path| path.join("plugin-task-cache-v1"))
            .map_err(|error| {
                failure(
                    "capability.storage-unavailable",
                    format!("resolve plugin task cache location: {error}"),
                )
            })
    }

    fn plugin_workspace_state_root(&self) -> Result<PathBuf, RemoteFailure> {
        self.app
            .path()
            .app_data_dir()
            .map(|path| path.join("plugin-workspace-state-v1"))
            .map_err(|error| {
                failure(
                    "capability.storage-unavailable",
                    format!("resolve plugin workspace-state location: {error}"),
                )
            })
    }
}

fn required_permission(capability: &str, operation: &str) -> Result<&'static str, RemoteFailure> {
    match (capability, operation) {
        ("taskCache", "computeFingerprint" | "read" | "write" | "markDirty") => {
            Ok(TASK_CACHE_PERMISSION)
        }
        ("processQueries", "execute") => Ok(PROCESS_QUERY_PERMISSION),
        ("workspaceState", "read" | "write") => Ok(WORKSPACE_STATE_PERMISSION),
        ("notifications", "publish") => Ok(NOTIFICATION_PERMISSION),
        _ => Err(failure(
            "capability.unsupported-operation",
            format!("unsupported capability operation: {capability} / {operation}"),
        )),
    }
}

fn capability_arguments(payload: &JsonValue) -> Result<&[JsonValue], RemoteFailure> {
    let object = payload.as_object().ok_or_else(|| {
        failure(
            "capability.invalid-arguments",
            "capability payload must be an object",
        )
    })?;
    if object.len() != 1 {
        return Err(failure(
            "capability.invalid-arguments",
            "capability payload has an invalid shape",
        ));
    }
    object
        .get("arguments")
        .and_then(JsonValue::as_array)
        .map(Vec::as_slice)
        .ok_or_else(|| {
            failure(
                "capability.invalid-arguments",
                "capability arguments must be an array",
            )
        })
}

fn expect_count(arguments: &[JsonValue], count: usize) -> Result<(), RemoteFailure> {
    if arguments.len() == count {
        Ok(())
    } else {
        Err(failure(
            "capability.invalid-arguments",
            format!("capability expects exactly {count} argument(s)"),
        ))
    }
}

fn string_argument<'a>(value: &'a JsonValue, name: &str) -> Result<&'a str, RemoteFailure> {
    value.as_str().ok_or_else(|| {
        failure(
            "capability.invalid-arguments",
            format!("{name} must be a string"),
        )
    })
}

fn string_array(value: &JsonValue, name: &str) -> Result<Vec<String>, RemoteFailure> {
    let values = value.as_array().ok_or_else(|| {
        failure(
            "capability.invalid-arguments",
            format!("{name} must be an array"),
        )
    })?;
    values
        .iter()
        .map(|value| {
            value.as_str().map(str::to_owned).ok_or_else(|| {
                failure(
                    "capability.invalid-arguments",
                    format!("{name} must contain only strings"),
                )
            })
        })
        .collect()
}

fn serialize(value: impl serde::Serialize) -> Result<JsonValue, RemoteFailure> {
    serde_json::to_value(value).map_err(|error| {
        failure(
            "capability.serialization-failed",
            format!("serialize capability result: {error}"),
        )
    })
}

fn cache_read_status(status: CacheReadStatus) -> &'static str {
    match status {
        CacheReadStatus::Miss => "miss",
        CacheReadStatus::Fresh => "fresh",
        CacheReadStatus::Stale => "stale",
        CacheReadStatus::Dirty => "dirty",
        CacheReadStatus::Corrupt => "corrupt",
        CacheReadStatus::Unavailable => "unavailable",
    }
}

fn cache_mutation_value(value: plugin_task_cache::CacheMutation) -> JsonValue {
    json!({
        "protocolVersion": 1,
        "status": match value.status {
            CacheMutationStatus::Stored => "stored",
            CacheMutationStatus::Rejected => "rejected",
            CacheMutationStatus::LimitExceeded => "limitExceeded",
            CacheMutationStatus::Dirty => "dirty",
            CacheMutationStatus::Unavailable => "unavailable",
        },
        "pluginId": value.plugin_id,
        "providerId": value.provider_id,
        "fingerprint": value.fingerprint,
        "updatedAtEpochMs": value.updated_at_epoch_ms,
        "lastAccessEpochMs": value.last_access_epoch_ms,
        "dirtyReason": value.dirty_reason,
    })
}

fn process_query_value(value: PluginProcessQueryResult) -> JsonValue {
    let stdout = decode_output(&value.stdout_base64);
    let stderr = decode_output(&value.stderr_base64);
    let status = match value.status {
        PluginProcessQueryStatus::Succeeded => "succeeded",
        PluginProcessQueryStatus::Failed => "failed",
        PluginProcessQueryStatus::TimedOut => "timed-out",
        PluginProcessQueryStatus::Cancelled => "cancelled",
        PluginProcessQueryStatus::Unavailable | PluginProcessQueryStatus::Crashed => "failed",
    };
    json!({
        "status": status,
        "stdout": stdout,
        "stderr": stderr,
        "truncated": value.truncated,
        "error": value.error,
    })
}

fn decode_output(value: &str) -> String {
    BASE64
        .decode(value)
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default()
}

fn valid_message_key(key: &str) -> bool {
    if key.is_empty() || key.len() > 128 {
        return false;
    }
    let bytes = key.as_bytes();
    bytes.first().is_some_and(u8::is_ascii_alphanumeric)
        && bytes.last().is_some_and(u8::is_ascii_alphanumeric)
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn failure(code: &str, message: impl Into<String>) -> RemoteFailure {
    RemoteFailure {
        code: code.to_owned(),
        message: message.into(),
        retryable: false,
    }
}

fn resolve_plugin_host_helper(
    current_executable: &Path,
    development_binaries: Option<&Path>,
) -> Result<PathBuf, PluginRuntimeError> {
    let application_directory = current_executable.parent().ok_or_else(|| {
        PluginRuntimeError::InvalidConfiguration(
            "application executable has no installation directory".to_owned(),
        )
    })?;
    let packaged = application_directory.join(packaged_helper_name());
    if packaged.is_file() {
        return Ok(packaged);
    }
    if let Some(development_binaries) = development_binaries {
        let development = development_binaries.join(development_helper_name()?);
        if development.is_file() {
            return Ok(development);
        }
    }
    Err(PluginRuntimeError::InvalidConfiguration(format!(
        "packaged plugin helper is missing beside {}",
        current_executable.display()
    )))
}

fn packaged_helper_name() -> &'static str {
    if cfg!(windows) {
        "asterlyn-plugin-host.exe"
    } else {
        "asterlyn-plugin-host"
    }
}

fn development_helper_name() -> Result<String, PluginRuntimeError> {
    let architecture = match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        "x86_64" => "x86_64",
        architecture => {
            return Err(PluginRuntimeError::InvalidConfiguration(format!(
                "unsupported development sidecar architecture: {architecture}"
            )));
        }
    };
    let target = match std::env::consts::OS {
        "macos" => format!("{architecture}-apple-darwin"),
        "windows" => format!("{architecture}-pc-windows-msvc"),
        "linux" => format!("{architecture}-unknown-linux-gnu"),
        operating_system => {
            return Err(PluginRuntimeError::InvalidConfiguration(format!(
                "unsupported development sidecar operating system: {operating_system}"
            )));
        }
    };
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    Ok(format!("asterlyn-plugin-host-{target}{suffix}"))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    #[test]
    fn packaged_helper_takes_precedence_over_development_sidecar() {
        let application = TempDir::new().expect("application directory");
        let development = TempDir::new().expect("development directory");
        let executable = application.path().join("asterlyn");
        fs::write(&executable, b"application").expect("application executable");
        let packaged = application.path().join(packaged_helper_name());
        fs::write(&packaged, b"packaged helper").expect("packaged helper");
        fs::write(
            development
                .path()
                .join(development_helper_name().expect("development helper name")),
            b"development helper",
        )
        .expect("development helper");

        let resolved = resolve_plugin_host_helper(&executable, Some(development.path()))
            .expect("resolve helper");
        assert_eq!(resolved, packaged);
    }

    #[test]
    fn development_resolution_requires_the_exact_target_filename() {
        let application = TempDir::new().expect("application directory");
        let development = TempDir::new().expect("development directory");
        let executable = application.path().join("asterlyn");
        fs::write(&executable, b"application").expect("application executable");
        fs::write(
            development.path().join("asterlyn-plugin-host-attacker"),
            b"bad",
        )
        .expect("untrusted helper");
        assert!(resolve_plugin_host_helper(&executable, Some(development.path())).is_err());

        let expected = development
            .path()
            .join(development_helper_name().expect("development helper name"));
        fs::write(&expected, b"development helper").expect("development helper");
        let resolved = resolve_plugin_host_helper(&executable, Some(development.path()))
            .expect("resolve development helper");
        assert_eq!(resolved, expected);
    }

    #[test]
    fn capability_contract_maps_only_known_operations_to_permissions() {
        assert_eq!(
            required_permission("taskCache", "write").expect("task cache permission"),
            TASK_CACHE_PERMISSION
        );
        assert_eq!(
            required_permission("processQueries", "execute").expect("query permission"),
            PROCESS_QUERY_PERMISSION
        );
        assert_eq!(
            required_permission("workspaceState", "read").expect("state permission"),
            WORKSPACE_STATE_PERMISSION
        );
        assert_eq!(
            required_permission("notifications", "publish").expect("notification permission"),
            NOTIFICATION_PERMISSION
        );
        assert!(required_permission("processQueries", "spawn").is_err());
        assert!(required_permission("filesystem", "read").is_err());
    }

    #[test]
    fn capability_arguments_require_the_exact_protocol_shape() {
        let payload = json!({ "arguments": ["adb.devices"] });
        assert_eq!(
            capability_arguments(&payload).expect("arguments"),
            &[JsonValue::String("adb.devices".to_owned())]
        );
        assert!(capability_arguments(&json!(["adb.devices"])).is_err());
        assert!(capability_arguments(&json!({ "arguments": [], "extra": true })).is_err());
        assert!(capability_arguments(&json!({ "arguments": "bad" })).is_err());
    }

    #[test]
    fn notification_keys_are_plain_bounded_identifiers() {
        assert!(valid_message_key("run.failed"));
        assert!(valid_message_key("android_run-success"));
        assert!(!valid_message_key("<b>failed</b>"));
        assert!(!valid_message_key(""));
        assert!(!valid_message_key(&"x".repeat(129)));
    }
}
