use crate::application::language_service::{
    LanguagePackage, LanguageServiceResult, LanguageSubject,
};
use crate::application::{ActiveWorkspaces, DiagnosticsLog, LanguageServiceManager};
use crate::commands::{
    admission_context, installation_store, installed_package_root, select_installed_plugin,
    verify_installed_package_archive,
};
use asterlyn_language_service::{TextChange, TextPosition, TextRange};
use asterlyn_plugin_package::inspect_extracted_package;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

const PLUGIN_ID: &str = "dev.asterlyn.lsp";
const EVENT: &str = "asterlyn://language-service-event";
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LanguageServiceReview {
    pub review_id: String,
    pub plugin_id: String,
    pub server_id: String,
    pub plugin_version: String,
    pub package_digest: String,
    pub resource_digest: String,
    pub executable_identity: String,
    pub expires_at: u64,
    pub remembered: bool,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LanguageServiceChange {
    pub range: Option<TextRangeWire>,
    pub text: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TextRangeWire {
    pub start: TextPositionWire,
    pub end: TextPositionWire,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TextPositionWire {
    pub line: u32,
    pub character: u32,
}

fn subject(
    active: &ActiveWorkspaces,
    window: &WebviewWindow,
    root: &str,
) -> Result<LanguageSubject, String> {
    Ok(LanguageSubject {
        owner: window.label().into(),
        root: active
            .resolve(window.label(), root)
            .map_err(|_| "workspace is no longer active")?,
        activation: active
            .activation_token(window.label())
            .map_err(|_| "workspace activation ended")?,
    })
}
fn installed_package(
    app: &AppHandle,
    workspace: &Path,
    server_id: &str,
) -> Result<LanguagePackage, String> {
    if !["typescript", "rust-analyzer"].contains(&server_id) {
        let node = trusted_node(workspace)?;
        let digest = hash_file(&node)?;
        return super::packaged_analysis::installed(app, workspace, server_id, node, digest);
    }
    let snapshot = installation_store(app)?
        .snapshot()
        .map_err(|_| "plugin installation state unavailable")?;
    let selected = select_installed_plugin(&snapshot, PLUGIN_ID)?;
    if selected.repository != "guozhiqiang123/asterlyn-plugin-lsp" {
        return Err("language plugin repository is not approved for this profile".into());
    }
    verify_installed_package_archive(app, PLUGIN_ID, &selected.version, &selected.package_digest)?;
    let root = installed_package_root(app, PLUGIN_ID, &selected.version, &selected.package_digest)?;
    let report = inspect_extracted_package(
        &root,
        &admission_context(&selected.repository, &selected.version),
    )
    .map_err(|_| "installed language plugin failed integrity verification")?;
    if report.plugin_id != PLUGIN_ID
        || report.plugin_version != selected.version
        || report.content_digest != selected.content_digest
        || !report.capabilities.iter().any(|v| v == "languageServices")
        || !report
            .permissions
            .iter()
            .any(|v| v == "host.language-services.execute")
        || !(if server_id == "rust-analyzer" {
            vec!["servers/rust-analyzer/profile.json"]
        } else {
            vec![
                "servers/typescript/server.mjs",
                "servers/typescript/typescript/lib/tsserver.js",
            ]
        })
        .iter()
        .all(|name| report.files.iter().any(|f| f.path == *name))
    {
        return Err("installed language plugin identity, authority or resources changed".into());
    }
    let (node, node_digest, rust) = match server_id {
        "typescript" => {
            let node = trusted_node(workspace)?;
            let digest = hash_file(&node)?;
            (node, digest, None)
        }
        "rust-analyzer" => {
            let (rust, digest) = super::language_rust::resolve_rust(&root, workspace)?;
            (rust.analyzer.clone(), digest, Some(rust))
        }
        _ => return Err("unsupported language profile".into()),
    };
    Ok(LanguagePackage {
        version: selected.version,
        digest: selected.package_digest,
        content_digest: selected.content_digest,
        root,
        node,
        node_digest,
        rust,
        packaged: None,
    })
}
pub(super) fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|_| "cannot inspect language executable")?;
    if file
        .metadata()
        .map_err(|_| "cannot inspect language executable")?
        .len()
        > 256 * 1024 * 1024
    {
        return Err("language executable exceeds inspection bound".into());
    }
    let mut hash = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|_| "cannot read language executable")?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Ok(format!("sha256:{:x}", hash.finalize()))
}
fn trusted_node(workspace: &Path) -> Result<PathBuf, String> {
    #[cfg(unix)]
    let candidates = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ]
    .iter()
    .map(PathBuf::from)
    .collect::<Vec<_>>();
    #[cfg(windows)]
    let candidates = std::env::var_os("ProgramFiles")
        .map(|root| vec![PathBuf::from(root).join("nodejs/node.exe")])
        .unwrap_or_default();
    for candidate in candidates {
        let Ok(node) = candidate.canonicalize() else {
            continue;
        };
        if node.starts_with(workspace) || !node.is_file() {
            continue;
        }
        let Ok(mut child) = Command::new(&node)
            .arg("--version")
            .env_clear()
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        else {
            continue;
        };
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut success = false;
        while Instant::now() < deadline {
            match child.try_wait() {
                Ok(Some(status)) => {
                    success = status.success();
                    break;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(10)),
                Err(_) => break,
            }
        }
        if !success {
            let _ = child.kill();
            let _ = child.wait();
            continue;
        }
        let mut version = String::new();
        if let Some(out) = child.stdout.take() {
            let _ = out.take(128).read_to_string(&mut version);
        }
        let parts = version
            .trim()
            .trim_start_matches('v')
            .split('.')
            .map(str::parse::<u32>)
            .collect::<Result<Vec<_>, _>>();
        if let Ok(parts) = parts
            && parts.len() == 3
            && (parts[0], parts[1], parts[2]) >= (22, 22, 2)
        {
            return Ok(node);
        }
    }
    Err("TypeScript language services require Node.js 22.22.2 or newer installed in a standard system location".into())
}

#[tauri::command]
pub(crate) async fn prepare_language_service(
    workspace_root: String,
    plugin_id: String,
    server_id: Option<String>,
    app: AppHandle,
    window: WebviewWindow,
    active: State<'_, ActiveWorkspaces>,
) -> Result<LanguageServiceReview, String> {
    if plugin_id != PLUGIN_ID {
        return Err("unsupported language provider".into());
    }
    let server_id = server_id.unwrap_or_else(|| "typescript".into());
    if server_id.is_empty() || server_id.len() > 128 {
        return Err("unsupported language profile".into());
    }
    let owner = subject(&active, &window, &workspace_root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let package = installed_package(&app, &owner.root, &server_id)?;
        let store = crate::application::language_consent::app_store_path(&app)?;
        let remembered = crate::application::language_consent::matches(&store, &owner.root, &package).unwrap_or(false);
        let review_id = app
            .state::<LanguageServiceManager>()
            .prepare(owner, package.clone())?;
        Ok(LanguageServiceReview {
            review_id,
            remembered,
            plugin_id,
            server_id: package.server_id().into(),
            plugin_version: package.version,
            package_digest: package.digest,
            resource_digest: package.content_digest,
            executable_identity: format!("{} ({})", package.node.display(), package.node_digest),
            expires_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64
                + 60000,
        })
    })
    .await
    .map_err(|_| "language review task failed")?
}
#[tauri::command]
pub(crate) async fn start_language_service(
    workspace_root: String,
    review_id: String,
    server_id: Option<String>,
    remember: Option<bool>,
    app: AppHandle,
    window: WebviewWindow,
    active: State<'_, ActiveWorkspaces>,
) -> Result<String, String> {
    let server_id = server_id.unwrap_or_else(|| "typescript".into());
    let owner = subject(&active, &window, &workspace_root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let package = installed_package(&app, &owner.root, &server_id)?;
        let authority = app.state::<LanguageServiceManager>()
            .consume(&review_id, &owner, &package)?;
        if remember == Some(true) {
            crate::application::language_consent::remember(
                &crate::application::language_consent::app_store_path(&app)?, &owner.root, &package)?;
        }
        let permitted_app = app.clone();
        let permitted_owner = owner.clone();
        let digest = package.digest.clone();
        let version = package.version.clone();
        let model_binding=package.packaged.as_ref().and_then(|profile|profile.initialization_options.pointer("/analysis/model")).cloned();
        let allowed = Arc::new(move || {
            let active = permitted_app.state::<ActiveWorkspaces>();
            active.activation_token(&permitted_owner.owner).ok() == Some(permitted_owner.activation)
                && active
                    .resolve(
                        &permitted_owner.owner,
                        permitted_owner.root.to_string_lossy().as_ref(),
                    )
                    .ok()
                    .as_ref()
                    == Some(&permitted_owner.root)
                && installation_store(&permitted_app)
                    .ok()
                    .and_then(|store| store.snapshot().ok())
                    .and_then(|snap| select_installed_plugin(&snap, PLUGIN_ID).ok())
                    .is_some_and(|selected| {
                        selected.version == version && selected.package_digest == digest && model_binding.as_ref().is_none_or(|binding| {
                            let Some(producer)=binding["producer"].as_str() else{return false};
                            installation_store(&permitted_app).ok().and_then(|store|store.snapshot().ok()).and_then(|snapshot|select_installed_plugin(&snapshot,producer).ok()).is_some_and(|selected|Some(selected.package_digest.as_str())==binding["packageDigest"].as_str()&&Some(selected.version.as_str())==binding["version"].as_str())
                        })
                    })
        });
        let event_app = app.clone();
        let label = owner.owner.clone();
        let emit = Arc::new(
            move |event: crate::application::language_service::LanguageServiceEvent| {
                if event.kind == "terminated" { event_app.state::<LanguageServiceManager>().finished(&event.session_id); }
            event_app.state::<DiagnosticsLog>().info("language.service", match event.kind { "terminated"=>"session.terminated", "indexing"=>"workspace.indexing", "ready"=>"workspace.ready", "degraded"=>"workspace.degraded", "backend-log"=>"backend.failed", _=>"diagnostics.completed" }, None,
                serde_json::json!({"sessionId":event.session_id,"code":event.code,"version":event.version,"diagnosticCount":event.diagnostics.as_ref().and_then(Value::as_array).map(Vec::len),"documentHash":event.uri.as_ref().map(|uri|event_app.state::<DiagnosticsLog>().hash_identifier(uri))}));
            let _ = event_app.emit_to(&label, EVENT, event);
            },
        );
        let models=super::packaged_analysis::model_access(&app,&owner,&package)?;
        let session = app
            .state::<LanguageServiceManager>()
            .start_with_models(owner, package, authority, allowed, emit, models)?;
        app.state::<DiagnosticsLog>().info(
            "language.service",
            "session.started",
            None,
            serde_json::json!({"sessionId":session,"providerId":PLUGIN_ID,"serverId":server_id}),
        );
        Ok(session)
    })
    .await
    .map_err(|_| "language startup task failed")?
}
async fn reply(rx: std::sync::mpsc::Receiver<Result<Value, String>>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(32))
            .map_err(|_| "language operation deadline exceeded".to_owned())?
    })
    .await
    .map_err(|_| "language operation task failed")?
}

#[tauri::command]
pub(crate) async fn forget_language_service_consent(
    workspace_root: String, app: AppHandle, window: WebviewWindow, active: State<'_, ActiveWorkspaces>,
) -> Result<(), String> {
    let owner = subject(&active, &window, &workspace_root)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::application::language_consent::forget(
            &crate::application::language_consent::app_store_path(&app)?, &owner.root)?;
        app.state::<LanguageServiceManager>().cancel_workspace(&owner.root);
        Ok(())
    }).await.map_err(|_| "language approval reset failed")?
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn open_language_document(
    workspace_root: String,
    session_id: String,
    uri: String,
    language_id: String,
    version: i64,
    text: String,
    window: WebviewWindow,
    active: State<'_, ActiveWorkspaces>,
    manager: State<'_, LanguageServiceManager>,
) -> Result<(), String> {
    if text.len() > 2 * 1024 * 1024 || uri.len() > 16384 {
        return Err("language document exceeds input limits".into());
    }
    let owner = subject(&active, &window, &workspace_root)?;
    let rx = manager.open(&session_id, &owner, uri, language_id, version, text)?;
    reply(rx).await.map(|_| ())
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn change_language_document(
    workspace_root: String,
    session_id: String,
    uri: String,
    version: i64,
    changes: Vec<LanguageServiceChange>,
    window: WebviewWindow,
    active: State<'_, ActiveWorkspaces>,
    manager: State<'_, LanguageServiceManager>,
) -> Result<(), String> {
    if changes.len() > 128 {
        return Err("too many document changes".into());
    }
    let owner = subject(&active, &window, &workspace_root)?;
    let changes = changes
        .into_iter()
        .map(|c| TextChange {
            text: c.text,
            range: c.range.map(|r| TextRange {
                start: TextPosition {
                    line: r.start.line,
                    character: r.start.character,
                },
                end: TextPosition {
                    line: r.end.line,
                    character: r.end.character,
                },
            }),
        })
        .collect();
    let rx = manager.change(&session_id, &owner, uri, version, changes)?;
    reply(rx).await.map(|_| ())
}
#[tauri::command]
pub(crate) async fn close_language_document(
    workspace_root: String,
    session_id: String,
    uri: String,
    window: WebviewWindow,
    active: State<'_, ActiveWorkspaces>,
    manager: State<'_, LanguageServiceManager>,
) -> Result<(), String> {
    let owner = subject(&active, &window, &workspace_root)?;
    let rx = manager.close(&session_id, &owner, uri)?;
    reply(rx).await.map(|_| ())
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn request_language_service(
    workspace_root: String,
    session_id: String,
    uri: String,
    version: i64,
    request_id: String,
    feature: String,
    line: u32,
    character: u32,
    window: WebviewWindow,
    active: State<'_, ActiveWorkspaces>,
    manager: State<'_, LanguageServiceManager>,
) -> Result<LanguageServiceResult, String> {
    let owner = subject(&active, &window, &workspace_root)?;
    let rx = manager.request(
        &session_id,
        &owner,
        uri.clone(),
        version,
        request_id,
        feature,
        TextPosition { line, character },
    )?;
    let result = reply(rx).await?;
    if subject(&active, &window, &workspace_root)? != owner {
        return Err("language result belongs to an obsolete workspace activation".into());
    }
    Ok(LanguageServiceResult {
        session_id,
        uri,
        version,
        result,
    })
}
#[tauri::command]
pub(crate) async fn cancel_language_request(
    workspace_root: String,
    session_id: String,
    request_id: String,
    window: WebviewWindow,
    active: State<'_, ActiveWorkspaces>,
    manager: State<'_, LanguageServiceManager>,
) -> Result<bool, String> {
    let owner = subject(&active, &window, &workspace_root)?;
    let rx = manager.cancel(&session_id, &owner, request_id)?;
    Ok(reply(rx).await?.as_bool().unwrap_or(false))
}
#[tauri::command]
pub(crate) fn stop_language_service(
    workspace_root: String,
    session_id: String,
    window: WebviewWindow,
    active: State<'_, ActiveWorkspaces>,
    manager: State<'_, LanguageServiceManager>,
) -> Result<bool, String> {
    let owner = subject(&active, &window, &workspace_root)?;
    manager.stop(&session_id, &owner)
}
