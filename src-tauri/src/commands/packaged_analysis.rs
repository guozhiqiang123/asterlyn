//! Generic admitted package programs. No Android, AGP, Eclipse or compiler-specific behavior.
mod inputs;
mod tools;
use super::*;
use crate::application::language_service::{
    LanguagePackage, LanguageSubject, ModelAccess, ModelReply, ModelResource,
};
use crate::application::{ActiveWorkspaces, DiagnosticsLog};
use asterlyn_language_service::PackagedServerProfile;
use asterlyn_plugin_analysis::{AdmittedProgram, AnalysisRuntime, AuthoritySnapshot, ModelHandle};
use asterlyn_plugin_models::{ModelGrant, ModelKey, PackageIdentity, ProvidedService, Scope};
use asterlyn_plugin_package::{
    AdmissionReport, AnalysisProgram, ModelProvider, inspect_extracted_package,
};
use asterlyn_plugin_runtime::{PluginHostSupervisor, PluginRuntimeIdentity};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, atomic::Ordering},
    time::Instant,
};
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub(crate) struct AnalysisManager(Mutex<Option<Arc<AnalysisRuntime>>>);
impl AnalysisManager {
    fn runtime(&self, path: &Path) -> Result<Arc<AnalysisRuntime>, String> {
        let mut slot = self.0.lock().map_err(|_| "analysis state unavailable")?;
        if slot.is_none() {
            *slot = Some(Arc::new(AnalysisRuntime::new(path)?));
        }
        Ok(slot.as_ref().unwrap().clone())
    }
    pub(crate) fn cancel_all(&self) {
        if let Ok(slot) = self.0.lock()
            && let Some(runtime) = slot.as_ref()
        {
            runtime.cancel_all();
        }
    }
}
fn digest(value: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(value))
}
fn package(
    app: &AppHandle,
    id: &str,
) -> Result<(PathBuf, AdmissionReport, PackageIdentity), String> {
    let snapshot = installation_store(app)?
        .snapshot()
        .map_err(|_| "plugin state unavailable")?;
    let selected = select_installed_plugin(&snapshot, id)?;
    verify_installed_package_archive(app, id, &selected.version, &selected.package_digest)?;
    let root = installed_package_root(app, id, &selected.version, &selected.package_digest)?;
    let report = inspect_extracted_package(
        &root,
        &admission_context(&selected.repository, &selected.version),
    )
    .map_err(|_| "analysis package verification failed")?;
    if report.plugin_id != id
        || report.plugin_version != selected.version
        || report.content_digest != selected.content_digest
    {
        return Err("analysis package identity changed".into());
    }
    let identity = PackageIdentity {
        id: id.into(),
        version: selected.version,
        archive_digest: selected.package_digest,
        content_digest: selected.content_digest,
    };
    Ok((root, report, identity))
}
fn cache(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|root| root.join("analysis"))
        .map_err(|_| "analysis cache unavailable".into())
}
pub(super) fn startup_profiles(app: &AppHandle) -> Result<Vec<String>, String> {
    let (_, report, _) = package(app, "dev.asterlyn.lsp")?;
    Ok(report
        .management_manifest
        .language_servers
        .iter()
        .filter(|server| server.model.is_some())
        .map(|server| server.id.clone())
        .collect())
}
fn resources(
    app: &AppHandle,
    workspace: &Path,
    declaration: &AnalysisProgram,
) -> Result<(Value, String), String> {
    let tools = tools::resolve(workspace, &declaration.tools)?;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|_| "analysis component directory unavailable")?
        .join("analysis-components");
    std::fs::create_dir_all(&base).map_err(|_| "analysis component directory unavailable")?;
    let base = base
        .canonicalize()
        .map_err(|_| "analysis component directory unavailable")?;
    let mut components = BTreeMap::new();
    for expected in &declaration.components {
        let verified = asterlyn_plugin_analysis::components::verify_component(&base, expected)?;
        components.insert(
            expected.id.clone(),
            json!({"root":verified.root,"digest":verified.content_digest}),
        );
    }
    let value = json!({"tools":tools,"components":components});
    let identity = digest(&serde_json::to_vec(&value).map_err(|_| "invalid analysis resources")?);
    Ok((value, identity))
}

pub(super) fn installed(
    app: &AppHandle,
    workspace: &Path,
    id: &str,
    node: PathBuf,
    node_digest: String,
) -> Result<LanguagePackage, String> {
    let (root, report, identity) = package(app, "dev.asterlyn.lsp")?;
    let declaration = report
        .management_manifest
        .language_servers
        .iter()
        .find(|server| server.id == id)
        .ok_or("unsupported language profile")?;
    let (mut analysis, server_resources) = resources(app, workspace, &declaration.program)?;
    let mut identity_parts = vec![
        identity.content_digest.clone(),
        node_digest.clone(),
        server_resources,
    ];
    if let Some(binding) = &declaration.model {
        let (_, producer, producer_identity) = package(app, &binding.plugin_id)?;
        let provider = producer
            .management_manifest
            .model_providers
            .iter()
            .find(|service| service.id == binding.service_id && service.schema == binding.schema)
            .ok_or("required workspace model is unavailable")?;
        let (_, tool_digest) = resources(app, workspace, &provider.program)?;
        identity_parts.extend([
            producer_identity.archive_digest.clone(),
            producer_identity.content_digest.clone(),
            tool_digest,
        ]);
        analysis["model"] = json!({"producer":binding.plugin_id,"service":binding.service_id,"schema":binding.schema,"packageDigest":producer_identity.archive_digest,"version":producer_identity.version});
    }
    let chain_digest =
        digest(&serde_json::to_vec(&identity_parts).map_err(|_| "invalid analysis identity")?);
    Ok(LanguagePackage {
        version: identity.version,
        digest: identity.archive_digest,
        content_digest: chain_digest,
        root: root.clone(),
        node: node.clone(),
        node_digest,
        rust: None,
        packaged: Some(PackagedServerProfile {
            id: id.into(),
            node,
            package_root: root,
            entry: declaration.program.entry.clone(),
            initialization_options: json!({"analysis":analysis}),
            selectors: declaration
                .selectors
                .iter()
                .map(|selector| (selector.language_id.clone(), selector.extensions.clone()))
                .collect(),
            cache_parent: cache(app)?,
        }),
    })
}
impl ModelResource for ModelHandle {
    fn is_current(&self) -> bool {
        self.is_current()
    }
    fn generation(&self) -> u64 {
        self.reference.generation()
    }
}
fn current(
    app: &AppHandle,
    owner: &LanguageSubject,
    _consumer: &PackageIdentity,
    producer: &PackageIdentity,
    provider: &ModelProvider,
) -> Result<AuthoritySnapshot, String> {
    let active = app.state::<ActiveWorkspaces>();
    if active.activation_token(&owner.owner).ok() != Some(owner.activation)
        || active
            .resolve(&owner.owner, &owner.root.to_string_lossy())
            .ok()
            .as_ref()
            != Some(&owner.root)
    {
        return Err("analysis workspace ended".into());
    }
    let snapshot = installation_store(app)?
        .snapshot()
        .map_err(|_| "analysis plugin state unavailable")?;
    // A worker belongs to all its leases. A reader created by one consumer must still expose
    // the other enabled consumers after the first consumer stops or is replaced.
    let packages = snapshot
        .plugins
        .iter()
        .filter_map(|plugin| {
            let selected = select_installed_plugin(&snapshot, &plugin.plugin_id).ok()?;
            Some(PackageIdentity {
                id: plugin.plugin_id.clone(),
                version: selected.version,
                archive_digest: selected.package_digest,
                content_digest: selected.content_digest,
            })
        })
        .collect::<Vec<_>>();
    let services = if packages.contains(producer) {
        vec![ProvidedService {
            producer: producer.clone(),
            id: provider.id.clone(),
            schema: provider.schema,
        }]
    } else {
        vec![]
    };
    Ok(AuthoritySnapshot {
        nodes: asterlyn_plugin_marketplace::dependency_nodes(&snapshot.plugins),
        packages,
        scope: Scope {
            owner: owner.owner.clone(),
            workspace_digest: digest(owner.root.to_string_lossy().as_bytes()),
            activation: owner.activation,
        },
        services,
    })
}
fn selection(
    app: &AppHandle,
    owner: &LanguageSubject,
    producer: &PackageIdentity,
    provider: &ModelProvider,
    runtime_entry: &str,
) -> Result<BTreeMap<String, Value>, String> {
    let mut state = BTreeMap::new();
    for binding in &provider.state_bindings {
        let snapshot = app
            .state::<PluginHostSupervisor>()
            .snapshot_contribution(
                &owner.owner,
                &PluginRuntimeIdentity {
                    plugin_id: producer.id.clone(),
                    plugin_version: producer.version.clone(),
                    package_digest: producer.archive_digest.clone(),
                    runtime_entry: runtime_entry.into(),
                },
                &owner.root.to_string_lossy(),
                &binding.contribution_id,
            )
            .map_err(|_| "workspace model selection is unavailable")?;
        let value = snapshot
            .pointer(&binding.pointer)
            .ok_or("workspace model selection is unavailable")?
            .clone();
        if serde_json::to_vec(&value)
            .map_err(|_| "invalid model selection")?
            .len()
            > 16384
        {
            return Err("model selection exceeds its bound".into());
        }
        state.insert(binding.key.clone(), value);
    }
    for key in &provider.state_keys {
        let path = app
            .path()
            .app_data_dir()
            .map_err(|_| "analysis state unavailable")?
            .join("plugin-workspace-state-v1");
        state.insert(
            key.clone(),
            json!(crate::application::plugin_workspace_state::read(
                &path,
                &owner.root,
                &producer.id,
                key
            )?),
        );
    }
    Ok(state)
}

pub(super) fn model_access(
    app: &AppHandle,
    owner: &LanguageSubject,
    language: &LanguagePackage,
) -> Result<Option<ModelAccess>, String> {
    let Some(profile) = language.packaged.as_ref() else {
        return Ok(None);
    };
    let (_, report, consumer) = package(app, "dev.asterlyn.lsp")?;
    let binding = report
        .management_manifest
        .language_servers
        .iter()
        .find(|server| server.id == profile.id)
        .and_then(|server| server.model.as_ref());
    let Some(binding) = binding else {
        return Ok(None);
    };
    let (producer_root, report, producer) = package(app, &binding.plugin_id)?;
    let provider = report
        .management_manifest
        .model_providers
        .iter()
        .find(|provider| provider.id == binding.service_id && provider.schema == binding.schema)
        .cloned()
        .ok_or("workspace model provider is unavailable")?;
    let runtime_entry = report.runtime_entry.clone();
    let (admitted_resources, tool_digest) = resources(app, &owner.root, &provider.program)?;
    let app = app.clone();
    let owner = owner.clone();
    let node = language.node.clone();
    let node_digest = language.node_digest.clone();
    let runtime = app.state::<AnalysisManager>().runtime(&cache(&app)?)?;
    let seen_generation = std::sync::atomic::AtomicU64::new(0);
    let failure_log = Mutex::new(None::<(String, Instant)>);
    Ok(Some(Arc::new(move |alive, refresh| {
        let began = Instant::now();
        let result: Result<ModelReply, String> = (|| {
            let authority_app = app.clone();
            let authority_owner = owner.clone();
            let authority_consumer = consumer.clone();
            let authority_producer = producer.clone();
            let authority_provider = provider.clone();
            let authority: asterlyn_plugin_analysis::AuthorityReader = Arc::new(move || {
                current(
                    &authority_app,
                    &authority_owner,
                    &authority_consumer,
                    &authority_producer,
                    &authority_provider,
                )
            });
            let alive_authority = authority.clone();
            let allowed: asterlyn_plugin_analysis::Allowed =
                Arc::new(move || alive.load(Ordering::SeqCst) && alive_authority().is_ok());
            if !allowed() {
                return Err("analysis authority ended".into());
            }
            let state = selection(&app, &owner, &producer, &provider, &runtime_entry)?;
            let fingerprint = inputs::fingerprint(&owner.root, &provider.input_globs)?;
            let snapshot = authority()?;
            let key = ModelKey {
                scope: snapshot.scope.clone(),
                producer: producer.clone(),
                service: provider.id.clone(),
                schema: provider.schema,
                build_root_digest: digest(owner.root.to_string_lossy().as_bytes()),
                input_digest: fingerprint.clone(),
                selection_digest: digest(
                    &serde_json::to_vec(&state).map_err(|_| "invalid model selection")?,
                ),
                tool_digest: tool_digest.clone(),
            };
            // Once a new selection/input identity is observed, revoke the old artifact before
            // waiting for replacement work. Its actor must not keep serving the previous variant.
            runtime.invalidate(|old| {
                old.scope == key.scope
                    && old.producer.id == key.producer.id
                    && old.service == key.service
                    && (refresh || old != &key)
            });
            let grant =
                ModelGrant::admit(&snapshot.view(), consumer.clone(), key).map_err(|error| {
                    match error {
                        asterlyn_plugin_models::ModelError::InvalidIdentity => {
                            "workspace model identity is invalid"
                        }
                        _ => "workspace model authority is unavailable",
                    }
                })?;
            let debug = app
                .state::<crate::application::language_service::LanguageServiceManager>()
                .debug_enabled();
            let input = json!({"protocolVersion":1,"workspaceRoot":owner.root,"state":state,"tools":admitted_resources["tools"],"components":admitted_resources["components"],"inputDigest":fingerprint,"debugTrace":debug});
            let mut environment = BTreeMap::new();
            for name in ["HOME", "USERPROFILE", "TMPDIR", "TEMP", "SystemRoot"] {
                if let Some(value) = std::env::var_os(name) {
                    environment.insert(name.into(), value);
                }
            }
            environment.insert(
                "PATH".into(),
                node.parent()
                    .ok_or("analysis runtime unavailable")?
                    .as_os_str()
                    .into(),
            );
            let program = AdmittedProgram::new(
                &node,
                &producer_root,
                &provider.program.entry,
                &owner.root,
                environment,
                serde_json::to_vec(&input).map_err(|_| "invalid analysis input")?,
            )?;
            let guard_app = app.clone();
            let guard_root = owner.root.clone();
            let guard_consumer = consumer.clone();
            let guard_producer = producer.clone();
            let guard_provider = provider.clone();
            let guard_tool_digest = tool_digest.clone();
            let guard_node = node.clone();
            let guard_node_digest = node_digest.clone();
            let launch_guard: Arc<dyn Fn() -> Result<(), String> + Send + Sync> =
                Arc::new(move || {
                    // Package/resource checks are intentionally at child-process launch, not
                    // on every cache lookup or actor authority tick.
                    let (_, _, current_consumer) = package(&guard_app, "dev.asterlyn.lsp")?;
                    let (_, producer_report, current_producer) =
                        package(&guard_app, &guard_producer.id)?;
                    if current_consumer != guard_consumer || current_producer != guard_producer {
                        return Err("analysis package identity changed".into());
                    }
                    let current_provider = producer_report
                        .management_manifest
                        .model_providers
                        .iter()
                        .find(|candidate| {
                            candidate.id == guard_provider.id
                                && candidate.schema == guard_provider.schema
                        })
                        .ok_or("workspace model provider is unavailable")?;
                    if current_provider != &guard_provider {
                        return Err("analysis provider declaration changed".into());
                    }
                    let (_, current_tool_digest) =
                        resources(&guard_app, &guard_root, &guard_provider.program)?;
                    if current_tool_digest != guard_tool_digest {
                        return Err("analysis tool identity changed".into());
                    }
                    let node_bytes =
                        std::fs::read(&guard_node).map_err(|_| "analysis runtime unavailable")?;
                    if digest(&node_bytes) != guard_node_digest {
                        return Err("analysis runtime identity changed".into());
                    }
                    Ok(())
                });
            let program = program.with_launch_guard(launch_guard);
            let progress_app = app.clone();
            let service = provider.id.clone();
            let error_code = Arc::new(Mutex::new(None::<String>));
            let worker_error = error_code.clone();
            let workspace_hash = app
                .state::<DiagnosticsLog>()
                .hash_identifier(owner.root.to_string_lossy().as_bytes());
            let window = owner.owner.clone();
            let progress = Arc::new(move |progress: asterlyn_plugin_analysis::Progress| {
                if progress.stage == "error" {
                    if let Ok(mut code) = worker_error.lock() {
                        *code = progress.error_code.clone();
                    }
                }
                let mut fields = json!({"window":window,"workspaceHash":workspace_hash,"serviceId":service,"stage":progress.stage,"count":progress.count,"durationMs":progress.duration_ms,"code":progress.error_code,"causeClass":progress.cause_class});
                if progress_app
                    .state::<crate::application::language_service::LanguageServiceManager>()
                    .debug_enabled()
                {
                    fields["causeChain"] = json!(progress.cause_chain);
                    fields["sourceFile"] = json!(progress.source_file);
                    fields["sourceLine"] = json!(progress.source_line);
                }
                progress_app.state::<DiagnosticsLog>().info(
                    "language.model",
                    "worker.progress",
                    None,
                    fields,
                );
            });
            let handle = runtime
                .acquire(grant, program, authority, allowed, progress)
                .map_err(|error| {
                    error_code
                        .lock()
                        .ok()
                        .and_then(|code| code.clone())
                        .unwrap_or(error)
                })?;
            if inputs::fingerprint(&owner.root, &provider.input_globs)? != fingerprint
                || selection(&app, &owner, &producer, &provider, &runtime_entry)? != state
            {
                runtime.invalidate(|key| {
                    key.scope.owner == owner.owner
                        && key.scope.activation == owner.activation
                        && key.service == provider.id
                });
                return Err("workspace model inputs changed during analysis".into());
            }
            if seen_generation.swap(handle.reference.generation(), Ordering::Relaxed)
                != handle.reference.generation()
            {
                app.state::<DiagnosticsLog>().info("language.model","model.acquired",None,json!({"serviceId":provider.id,"generation":handle.reference.generation(),"bytes":handle.reference.bytes(),"durationMs":began.elapsed().as_millis() as u64}));
            }
            let value = json!({"path":handle.artifact.path(),"digest":handle.reference.digest(),"bytes":handle.reference.bytes(),"generation":handle.reference.generation(),"schema":handle.reference.schema()});
            Ok(ModelReply {
                value,
                resource: Box::new(handle),
            })
        })();
        if let Err(error) = &result {
            let code = if error.contains("identity") {
                "identity-invalid"
            } else if error.contains("selection") {
                "selection-unavailable"
            } else if error.contains("authority") || error.contains("workspace ended") {
                "authority-revoked"
            } else if error.contains("input") || error.contains("fingerprint") {
                "inputs-unavailable"
            } else if !error.is_empty()
                && error.len() <= 80
                && error.bytes().all(|b| {
                    b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'-')
                })
            {
                error.as_str()
            } else {
                "model-unavailable"
            };
            if let Ok(mut previous) = failure_log.lock()
                && previous
                    .as_ref()
                    .is_none_or(|(last, time)| last != code || time.elapsed().as_secs() >= 30)
            {
                app.state::<DiagnosticsLog>().info("language.model","model.failed",None,json!({"serviceId":provider.id,"code":code,"durationMs":began.elapsed().as_millis() as u64}));
                *previous = Some((code.into(), Instant::now()));
            }
        }
        result
    })))
}
