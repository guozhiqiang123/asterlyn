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
use serde_json::{Value as JsonValue, json};
use sha2::{Digest, Sha256};
use tempfile::TempDir;

const PLUGIN_ID: &str = "dev.asterlyn.hello";
const PACKAGE_ENV: &str = "ASTERLYN_HELLO_PLUGIN_PACKAGE";
const PLUGIN_VERSION_ENV: &str = "ASTERLYN_HELLO_PLUGIN_VERSION";
const HOST_VERSION_ENV: &str = "ASTERLYN_HOST_VERSION";

struct NoCapabilities;

impl CapabilityHandler for NoCapabilities {
    fn execute(
        &self,
        _context: &CapabilityContext<'_>,
        request: &CapabilityRequest,
    ) -> Result<JsonValue, RemoteFailure> {
        Err(RemoteFailure {
            code: "hello.unexpected-capability".to_owned(),
            message: format!(
                "zero-authority Hello fixture requested {} / {}",
                request.capability, request.operation
            ),
            retryable: false,
        })
    }
}

#[test]
#[ignore = "requires the released Hello plugin package and explicit plugin/host versions"]
fn released_hello_plugin_activates_invokes_and_disposes() {
    let package_path = PathBuf::from(env::var_os(PACKAGE_ENV).expect(PACKAGE_ENV));
    let plugin_version = env::var(PLUGIN_VERSION_ENV).expect(PLUGIN_VERSION_ENV);
    let host_version = env::var(HOST_VERSION_ENV).expect(HOST_VERSION_ENV);
    let package = fs::read(&package_path).expect("read Hello plugin package");
    let extracted_parent = TempDir::new().expect("extraction parent");
    let extracted = extracted_parent.path().join("hello-plugin");
    let report = extract_admitted_package(
        &package,
        &AdmissionContext {
            repository: "guozhiqiang123/asterlyn-plugin-hello",
            release_version: &plugin_version,
            host_version: &host_version,
            sdk_major: 1,
            runtime_protocol: 1,
            supported_capabilities: SUPPORTED_CAPABILITIES,
            supported_permissions: SUPPORTED_PERMISSIONS,
        },
        &extracted,
    )
    .expect("admit and extract Hello plugin package");
    assert_eq!(report.plugin_id, PLUGIN_ID);
    assert_eq!(report.plugin_version, plugin_version);
    assert!(report.capabilities.is_empty());
    assert!(report.permissions.is_empty());

    let helper = PathBuf::from(env!("CARGO_BIN_EXE_asterlyn-plugin-host"))
        .canonicalize()
        .expect("plugin host helper");
    let installation = helper.parent().expect("helper installation root");
    let supervisor = PluginHostSupervisor::from_verified_helper_with_capabilities(
        &helper,
        installation,
        Arc::new(NoCapabilities),
    )
    .expect("create plugin supervisor");
    let package_digest = format!("sha256:{:x}", Sha256::digest(&package));
    let activated = supervisor
        .activate(PluginActivation {
            owner: "window-hello-parity".to_owned(),
            plugin_root: extracted,
            identity: PluginRuntimeIdentity {
                plugin_id: report.plugin_id,
                plugin_version: report.plugin_version,
                package_digest,
                runtime_entry: report.runtime_entry,
            },
            capabilities: report.capabilities,
            permissions: report.permissions,
            workspace_id: "workspace-hello-parity".to_owned(),
            workspace_generation: 1,
            workspace_root: "/workspace/hello".to_owned(),
            evidence: json!([]),
            locale: "en-US".to_owned(),
            theme: HostTheme::Dark,
        })
        .expect("activate released Hello plugin");

    assert_eq!(activated.contributions.len(), 1);
    let command = &activated.contributions[0];
    assert_eq!(command.id, "hello.sayHello");
    assert_eq!(command.kind, ContributionKind::Command);
    assert_eq!(
        invoke(&supervisor, command, "title"),
        json!("Hello from plugin")
    );
    assert_eq!(invoke(&supervisor, command, "execute"), JsonValue::Null);

    supervisor.cancel_owner("window-hello-parity", ShutdownReason::WindowClosed);
    assert_eq!(supervisor.active_count(), 0);
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
            "window-hello-parity",
            PLUGIN_ID,
            handle,
            operation,
            json!({"arguments": []}),
        )
        .unwrap_or_else(|error| panic!("invoke {}.{operation}: {error}", contribution.id))
}
