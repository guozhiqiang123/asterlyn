use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use asterlyn_plugin_marketplace::BUILT_IN_ANDROID_REPOSITORY;
use asterlyn_plugin_package::{
    HostOperationDeclaration, PACKAGE_SCHEMA_VERSION, ProcessExecutableCandidate, ProcessQuery,
    ToolOperation,
};

use super::{
    ToolOperationParameterKind, bundled_query, bundled_tool_operation, validate_tool_parameter,
};

const ANDROID_PLUGIN_ID: &str = "dev.asterlyn.android-gradle";

#[derive(Debug, Clone)]
pub(super) struct AdmittedQuery {
    pub(super) args: Vec<String>,
    pub(super) timeout: Duration,
    pub(super) max_output_bytes: usize,
    pub(super) executables: Vec<ProcessExecutableCandidate>,
}

#[derive(Debug, Clone)]
pub(super) struct AdmittedToolOperation {
    pub(super) args: Vec<ToolOperationArgument>,
    pub(super) parameters: Vec<ToolOperationParameter>,
    pub(super) timeout: Duration,
    pub(super) max_output_bytes: usize,
    pub(super) executables: Vec<ProcessExecutableCandidate>,
}

#[derive(Debug, Clone)]
pub(super) enum ToolOperationArgument {
    Literal(String),
    Parameter(String),
}

#[derive(Debug, Clone)]
pub(super) struct ToolOperationParameter {
    pub(super) name: String,
    pub(super) kind: ToolOperationParameterKind,
}

impl AdmittedToolOperation {
    pub(super) fn resolve_arguments(
        &self,
        root: &Path,
        values: &HashMap<String, String>,
    ) -> Result<Vec<String>, String> {
        if values.len() != self.parameters.len() {
            return Err("tool-operation parameters do not match the admitted declaration".into());
        }
        let mut resolved = HashMap::new();
        for parameter in &self.parameters {
            let value = values
                .get(parameter.name.as_str())
                .ok_or_else(|| format!("missing tool-operation parameter: {}", parameter.name))?;
            let value = validate_tool_parameter(root, &parameter.kind, value)?;
            resolved.insert(parameter.name.as_str(), value);
        }
        self.args
            .iter()
            .map(|argument| match argument {
                ToolOperationArgument::Literal(value) => Ok(value.clone()),
                ToolOperationArgument::Parameter(name) => resolved
                    .get(name.as_str())
                    .cloned()
                    .ok_or_else(|| format!("unresolved tool-operation parameter: {name}")),
            })
            .collect()
    }
}

#[derive(Debug, Clone)]
pub(super) struct PluginToolAuthority {
    pub(super) plugin_version: String,
    pub(super) package_digest: String,
    pub(super) queries: HashMap<String, AdmittedQuery>,
    pub(super) operations: HashMap<String, AdmittedToolOperation>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct PluginToolAuthorityIdentity<'a> {
    pub(crate) repository: &'a str,
    pub(crate) plugin_id: &'a str,
    pub(crate) plugin_version: &'a str,
    pub(crate) package_digest: &'a str,
}

impl PluginToolAuthority {
    pub(super) fn from_external_package(
        identity: PluginToolAuthorityIdentity<'_>,
        schema_version: u32,
        host_operations: &[HostOperationDeclaration],
        queries: &[ProcessQuery],
        operations: &[ToolOperation],
    ) -> Result<Self, String> {
        if schema_version != PACKAGE_SCHEMA_VERSION {
            return Err("legacy plugin package authority is blocked; publish package schema 3 with host-owned semantic operations".into());
        }
        if !queries.is_empty() || !operations.is_empty() {
            return Err(
                "schema-3 plugin packages cannot supply executable or argv authority".into(),
            );
        }
        semantic_authority(identity, host_operations)
    }
}

pub(crate) fn validate_external_tool_authority(
    identity: PluginToolAuthorityIdentity<'_>,
    schema_version: u32,
    host_operations: &[HostOperationDeclaration],
    queries: &[ProcessQuery],
    operations: &[ToolOperation],
) -> Result<(), String> {
    PluginToolAuthority::from_external_package(
        identity,
        schema_version,
        host_operations,
        queries,
        operations,
    )
    .map(|_| ())
}

fn semantic_authority(
    identity: PluginToolAuthorityIdentity<'_>,
    declarations: &[HostOperationDeclaration],
) -> Result<PluginToolAuthority, String> {
    if !declarations.is_empty()
        && (identity.plugin_id != ANDROID_PLUGIN_ID
            || identity.repository != BUILT_IN_ANDROID_REPOSITORY)
    {
        return Err("host operations are not registered for this plugin repository".into());
    }
    let mut queries = HashMap::new();
    let mut operations = HashMap::new();
    for declaration in declarations {
        if let Some(query) = bundled_query(identity.plugin_id, &declaration.id) {
            queries.insert(declaration.id.clone(), query);
            continue;
        }
        if let Some(operation) = bundled_tool_operation(identity.plugin_id, &declaration.id) {
            operations.insert(declaration.id.clone(), operation);
            continue;
        }
        return Err(format!(
            "host operation is not registered for {}: {}",
            identity.plugin_id, declaration.id
        ));
    }
    Ok(PluginToolAuthority {
        plugin_version: identity.plugin_version.to_owned(),
        package_digest: identity.package_digest.to_owned(),
        queries,
        operations,
    })
}

#[cfg(test)]
mod tests {
    use asterlyn_plugin_package::{
        LEGACY_PACKAGE_SCHEMA_VERSION, ToolOperationArgument as PackageToolArgument,
    };

    use super::*;

    const ANDROID_OPERATION_IDS: &[&str] = &[
        "android.apk.inspect",
        "android.adb.install",
        "android.adb.uninstall",
        "android.adb.launch",
    ];

    fn package_declarations(executable: &str) -> (Vec<ProcessQuery>, Vec<ToolOperation>) {
        let candidate = ProcessExecutableCandidate::Path {
            name: executable.into(),
        };
        let queries = vec![ProcessQuery {
            id: "adb.devices".into(),
            args: vec!["package-controlled-query-argument".into()],
            timeout_ms: 1,
            max_output_bytes: 1,
            executables: vec![candidate.clone()],
        }];
        let operations = ANDROID_OPERATION_IDS
            .iter()
            .map(|operation_id| ToolOperation {
                id: (*operation_id).into(),
                intent: "query".into(),
                args: vec![PackageToolArgument::Literal {
                    value: "package-controlled-operation-argument".into(),
                }],
                parameters: vec![],
                timeout_ms: 1,
                max_output_bytes: 1,
                executables: vec![candidate.clone()],
            })
            .collect();
        (queries, operations)
    }

    #[test]
    fn external_packages_cannot_admit_package_selected_interpreters_or_arguments() {
        for executable in ["sh", "bash", "cmd", "powershell", "pwsh"] {
            let (queries, operations) = package_declarations(executable);
            let query_error = validate_external_tool_authority(
                PluginToolAuthorityIdentity {
                    repository: "example/untrusted",
                    plugin_id: "dev.example.untrusted",
                    plugin_version: "1.0.0",
                    package_digest: "sha256:untrusted",
                },
                LEGACY_PACKAGE_SCHEMA_VERSION,
                &[],
                &queries,
                &[],
            )
            .unwrap_err();
            assert!(query_error.contains("legacy plugin package authority is blocked"));
            let operation_error = validate_external_tool_authority(
                PluginToolAuthorityIdentity {
                    repository: "example/untrusted",
                    plugin_id: "dev.example.untrusted",
                    plugin_version: "1.0.0",
                    package_digest: "sha256:untrusted",
                },
                LEGACY_PACKAGE_SCHEMA_VERSION,
                &[],
                &[],
                &operations,
            )
            .unwrap_err();
            assert!(operation_error.contains("legacy plugin package authority is blocked"));
        }
    }

    #[test]
    fn external_packages_cannot_admit_any_legacy_executable_source() {
        let candidates = [
            ProcessExecutableCandidate::Environment {
                variable: "ANDROID_HOME".into(),
                relative_path: "platform-tools/adb".into(),
            },
            ProcessExecutableCandidate::WorkspaceProperty {
                path: "local.properties".into(),
                key: "sdk.dir".into(),
                relative_path: "platform-tools/adb".into(),
            },
            ProcessExecutableCandidate::AndroidSdkBuildTools {
                name: "aapt2".into(),
            },
            ProcessExecutableCandidate::Path { name: "adb".into() },
        ];
        for candidate in candidates {
            let queries = [ProcessQuery {
                id: "example.query".into(),
                args: vec!["package-controlled-argument".into()],
                timeout_ms: 1,
                max_output_bytes: 1,
                executables: vec![candidate],
            }];
            let error = validate_external_tool_authority(
                PluginToolAuthorityIdentity {
                    repository: "example/untrusted",
                    plugin_id: "dev.example.untrusted",
                    plugin_version: "1.0.0",
                    package_digest: "sha256:untrusted",
                },
                LEGACY_PACKAGE_SCHEMA_VERSION,
                &[],
                &queries,
                &[],
            )
            .unwrap_err();
            assert!(error.contains("legacy plugin package authority is blocked"));
        }
    }

    #[test]
    fn external_package_without_process_authority_remains_admissible() {
        validate_external_tool_authority(
            PluginToolAuthorityIdentity {
                repository: "example/no-process-authority",
                plugin_id: "dev.example.no-process-authority",
                plugin_version: "1.0.0",
                package_digest: "sha256:no-process-authority",
            },
            PACKAGE_SCHEMA_VERSION,
            &[],
            &[],
            &[],
        )
        .unwrap();
    }

    #[test]
    fn previous_pinned_android_package_is_blocked_after_the_schema_three_migration() {
        let (queries, operations) = package_declarations("sh");
        let error = PluginToolAuthority::from_external_package(
            PluginToolAuthorityIdentity {
                repository: "guozhiqiang123/asterlyn-plugin-android-gradle",
                plugin_id: ANDROID_PLUGIN_ID,
                plugin_version: "0.5.7",
                package_digest:
                    "sha256:ce078cb09e7b282db6b4bb076bbd38a7fd08cbd58194bf2195b0802c422909c1",
            },
            asterlyn_plugin_package::LEGACY_PACKAGE_SCHEMA_VERSION,
            &[],
            &queries,
            &operations,
        )
        .unwrap_err();
        assert!(error.contains("legacy plugin package authority is blocked"));
    }

    #[test]
    fn schema_three_host_operations_expand_only_from_the_host_registry() {
        let authority = PluginToolAuthority::from_external_package(
            PluginToolAuthorityIdentity {
                repository: BUILT_IN_ANDROID_REPOSITORY,
                plugin_id: ANDROID_PLUGIN_ID,
                plugin_version: "1.0.0",
                package_digest: "sha256:semantic",
            },
            PACKAGE_SCHEMA_VERSION,
            &[
                HostOperationDeclaration {
                    id: "adb.devices".into(),
                },
                HostOperationDeclaration {
                    id: "android.adb.install".into(),
                },
            ],
            &[],
            &[],
        )
        .unwrap();
        assert_eq!(authority.queries["adb.devices"].args, ["devices", "-l"]);
        assert!(authority.operations.contains_key("android.adb.install"));
        let ownership_error = PluginToolAuthority::from_external_package(
            PluginToolAuthorityIdentity {
                repository: "example/android-clone",
                plugin_id: ANDROID_PLUGIN_ID,
                plugin_version: "1.0.0",
                package_digest: "sha256:semantic",
            },
            PACKAGE_SCHEMA_VERSION,
            &[HostOperationDeclaration {
                id: "adb.devices".into(),
            }],
            &[],
            &[],
        )
        .unwrap_err();
        assert!(ownership_error.contains("not registered for this plugin repository"));
        assert!(
            PluginToolAuthority::from_external_package(
                PluginToolAuthorityIdentity {
                    repository: BUILT_IN_ANDROID_REPOSITORY,
                    plugin_id: ANDROID_PLUGIN_ID,
                    plugin_version: "1.0.0",
                    package_digest: "sha256:semantic",
                },
                PACKAGE_SCHEMA_VERSION,
                &[HostOperationDeclaration {
                    id: "android.shell".into()
                }],
                &[],
                &[],
            )
            .is_err()
        );
    }
}
