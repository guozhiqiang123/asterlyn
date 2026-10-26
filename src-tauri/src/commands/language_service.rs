use crate::application::{ActiveWorkspaces, LanguageServiceManager};
use crate::commands::{
    admission_context, installation_store, installed_package_root, select_installed_plugin,
    verify_installed_package_archive,
};
use asterlyn_plugin_package::inspect_extracted_package;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, Window};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LanguageServiceReview {
    pub review_id: String,
    pub plugin_id: String,
    pub server_id: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LanguageServiceChange {
    pub range: Option<TextRangeWire>,
    pub text: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextRangeWire {
    pub start: TextPositionWire,
    pub end: TextPositionWire,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextPositionWire {
    pub line: u32,
    pub character: u32,
}

#[tauri::command]
pub(crate) fn prepare_language_service(
    workspace_root: String,
    plugin_id: String,
    app: AppHandle,
    window: Window,
    active: State<'_, ActiveWorkspaces>,
    manager: State<'_, LanguageServiceManager>,
) -> Result<LanguageServiceReview, String> {
    if plugin_id != "dev.asterlyn.lsp" || workspace_root.trim().is_empty() {
        return Err("language-service provider is not admitted".into());
    }
    let canonical = active
        .resolve(window.label(), &workspace_root)
        .map_err(|error| format!("workspace is not active: {error}"))?;
    let _ = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let review_id = format!("ls-review-{}-{}", window.label(), std::process::id());
    manager.review(review_id.clone(), canonical.to_string_lossy().into_owned())?;
    Ok(LanguageServiceReview {
        review_id,
        plugin_id,
        server_id: "typescript",
    })
}

#[tauri::command]
pub(crate) fn start_language_service(
    workspace_root: String,
    review_id: String,
    app: AppHandle,
    window: Window,
    active: State<'_, ActiveWorkspaces>,
    manager: State<'_, LanguageServiceManager>,
) -> Result<String, String> {
    let canonical = active
        .resolve(window.label(), &workspace_root)
        .map_err(|error| format!("workspace is not active: {error}"))?;
    manager.consume_review(&review_id, canonical.to_string_lossy().as_ref())?;
    let snapshot = installation_store(&app)?
        .snapshot()
        .map_err(|error| error.to_string())?;
    let selection = select_installed_plugin(&snapshot, "dev.asterlyn.lsp")?;
    verify_installed_package_archive(
        &app,
        "dev.asterlyn.lsp",
        &selection.version,
        &selection.package_digest,
    )?;
    let package_root = installed_package_root(
        &app,
        "dev.asterlyn.lsp",
        &selection.version,
        &selection.package_digest,
    )?;
    let report = inspect_extracted_package(
        &package_root,
        &admission_context(&selection.repository, &selection.version),
    )
    .map_err(|error| format!("installed language-service package failed revalidation: {error}"))?;
    if report.content_digest != selection.content_digest
        || report.plugin_id != "dev.asterlyn.lsp"
        || !report
            .capabilities
            .iter()
            .any(|value| value == "languageServices")
        || !report
            .permissions
            .iter()
            .any(|value| value == "host.language-services.execute")
        || !report
            .files
            .iter()
            .any(|file| file.path == "servers/typescript/server.mjs")
        || !report
            .files
            .iter()
            .any(|file| file.path == "servers/typescript/typescript/lib/tsserver.js")
    {
        return Err(
            "installed language-service package identity, authority, or resources changed".into(),
        );
    }
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let session_id = format!("ls-session-{}-{}", window.label(), std::process::id());
    let mut profile = crate::application::language_service::package_profile(root);
    profile.package_root = package_root;
    manager.start(session_id.clone(), profile)?;
    Ok(session_id)
}

#[tauri::command]
pub(crate) fn open_language_document(
    _workspace_root: String,
    session_id: String,
    uri: String,
    language_id: String,
    version: i64,
    text: String,
    manager: State<'_, LanguageServiceManager>,
) -> Result<(), String> {
    if !uri.starts_with("file://") || version < 1 || language_id.is_empty() {
        return Err("invalid language document".into());
    }
    manager.with(&session_id, |process| { process.request("textDocument/didOpen", Some(serde_json::json!({"textDocument":{"uri":uri,"languageId":language_id,"version":version,"text":text}}))).map(|_| ()).map_err(|e| format!("{e:?}")) })
}

#[tauri::command]
pub(crate) fn change_language_document(
    _workspace_root: String,
    session_id: String,
    uri: String,
    version: i64,
    changes: Vec<LanguageServiceChange>,
    manager: State<'_, LanguageServiceManager>,
) -> Result<(), String> {
    if !uri.starts_with("file://") || version < 1 {
        return Err("invalid language document".into());
    }
    let edits = changes.into_iter().map(|change| serde_json::json!({"range":change.range.map(|range| serde_json::json!({"start": {"line":range.start.line,"character":range.start.character}, "end": {"line":range.end.line,"character":range.end.character}})), "text":change.text})).collect::<Vec<_>>();
    manager.with(&session_id, |process| process.request("textDocument/didChange", Some(serde_json::json!({"textDocument":{"uri":uri,"version":version},"contentChanges":edits}))).map(|_| ()).map_err(|e| format!("{e:?}")))
}

#[tauri::command]
pub(crate) fn close_language_document(
    _workspace_root: String,
    session_id: String,
    uri: String,
    manager: State<'_, LanguageServiceManager>,
) -> Result<(), String> {
    manager.with(&session_id, |process| {
        process
            .request(
                "textDocument/didClose",
                Some(serde_json::json!({"textDocument":{"uri":uri}})),
            )
            .map(|_| ())
            .map_err(|e| format!("{e:?}"))
    })
}

#[tauri::command]
pub(crate) fn request_language_service(
    _workspace_root: String,
    session_id: String,
    uri: String,
    feature: String,
    line: u32,
    character: u32,
    manager: State<'_, LanguageServiceManager>,
) -> Result<u64, String> {
    let method = match feature.as_str() {
        "hover" => "textDocument/hover",
        "definition" => "textDocument/definition",
        "completion" => "textDocument/completion",
        _ => return Err("unsupported language-service feature".into()),
    };
    manager.with(&session_id, |process| process.request(method, Some(serde_json::json!({"textDocument":{"uri":uri},"position":{"line":line,"character":character}}))).map_err(|e| format!("{e:?}")))
}

#[tauri::command]
pub(crate) fn cancel_language_request(
    session_id: String,
    request_id: u64,
    manager: State<'_, LanguageServiceManager>,
) -> Result<bool, String> {
    manager.with(&session_id, |process| {
        process.cancel(request_id).map_err(|e| format!("{e:?}"))
    })
}

#[tauri::command]
pub(crate) fn stop_language_service(
    session_id: String,
    manager: State<'_, LanguageServiceManager>,
) -> Result<bool, String> {
    manager.stop(&session_id)
}
