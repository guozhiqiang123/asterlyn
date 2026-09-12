use super::super::*;

#[tauri::command]
pub(crate) async fn list_project_files(
    repository_root: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<ProjectFileList, WorkspaceError> {
    let root = active_workspaces.resolve(window.label(), &repository_root)?;
    run_workspace_blocking("list project files", move || load_project_catalog(&root)).await
}

#[tauri::command]
pub(crate) async fn search_workspace_text(
    repository_root: String,
    request_id: String,
    query: String,
    options: Option<SearchOptions>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    searches: State<'_, WorkspaceSearchRegistry>,
) -> Result<WorkspaceTextSearchReport, WorkspaceError> {
    let window_label = window.label().to_string();
    let root = active_workspaces.resolve(&window_label, &repository_root)?;
    let cancellation = searches.register(&window_label, &repository_root, &request_id)?;
    let task_root = root.clone();
    let task_request_id = request_id.clone();
    let task_cancellation = cancellation.clone();
    let task_options = options.unwrap_or_default();
    let result = run_workspace_blocking("search workspace text", move || {
        search_authorized_workspace(
            &task_root,
            &task_request_id,
            &query,
            &task_options,
            &task_cancellation,
        )
    })
    .await;
    searches.finish(&window_label, &repository_root, &request_id, &cancellation)?;
    result
}

#[tauri::command]
pub(crate) fn cancel_workspace_text_search(
    repository_root: String,
    request_id: String,
    window: tauri::WebviewWindow,
    searches: State<'_, WorkspaceSearchRegistry>,
) -> Result<(), WorkspaceError> {
    searches.cancel(window.label().to_string(), repository_root, request_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn preview_workspace_replacement(
    repository_root: String,
    plan_id: String,
    query: String,
    replacement: String,
    options: SearchOptions,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    replacements: State<'_, WorkspaceReplacementRegistry>,
) -> Result<WorkspaceReplacementPreview, WorkspaceError> {
    let window_label = window.label().to_string();
    let root = active_workspaces.resolve(&window_label, &repository_root)?;
    let cancellation = replacements.register(&window_label, &repository_root, &plan_id)?;
    let task_root = root.clone();
    let task_plan_id = plan_id.clone();
    let task_cancellation = cancellation.clone();
    let result = run_workspace_blocking("preview workspace replacement", move || {
        prepare_authorized_replacement(
            &task_root,
            &task_plan_id,
            &query,
            &replacement,
            &options,
            &task_cancellation,
        )
    })
    .await;
    match result {
        Ok((stored, preview)) => {
            replacements.finish_preview(
                &window_label,
                &repository_root,
                &plan_id,
                &cancellation,
                Some(stored),
            )?;
            Ok(preview)
        }
        Err(error) => {
            replacements.finish_preview(
                &window_label,
                &repository_root,
                &plan_id,
                &cancellation,
                None,
            )?;
            Err(error)
        }
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn apply_workspace_replacement(
    repository_root: String,
    plan_id: String,
    selected_paths: Vec<String>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    writes: State<'_, WorkspaceWriteRegistry>,
    replacements: State<'_, WorkspaceReplacementRegistry>,
    app: tauri::AppHandle,
) -> Result<ReplacementApplyResult, WorkspaceError> {
    let window_label = window.label().to_string();
    let root = active_workspaces.resolve(&window_label, &repository_root)?;
    let (stored, cancellation) =
        replacements.start_application(&window_label, &repository_root, &root, &plan_id)?;
    let write_lock = writes.lock_for(root.to_string_lossy().to_string())?;
    let recovery_root = replacement_recovery_root(&app)?;
    let task_plan = stored.plan.clone();
    let task_stored = stored.clone();
    let task_cancellation = cancellation.clone();
    let result = run_workspace_blocking("apply workspace replacement", move || {
        let _guard = write_lock.lock().map_err(|_| WorkspaceError::Io {
            operation: "serialize workspace writes".to_string(),
            message: "workspace-write lock was poisoned".to_string(),
        })?;
        authorize_replacement_selection(&root, &task_stored, &selected_paths)?;
        Workspace::open(&root)?.apply_replacement_plan(
            &recovery_root,
            &task_plan,
            &selected_paths,
            &task_cancellation,
        )
    })
    .await;
    replacements.finish_application(&window_label, &repository_root, &plan_id, &cancellation)?;
    result
}

#[tauri::command]
pub(crate) fn cancel_workspace_replacement(
    repository_root: String,
    operation_id: String,
    window: tauri::WebviewWindow,
    replacements: State<'_, WorkspaceReplacementRegistry>,
) -> Result<(), WorkspaceError> {
    replacements.cancel(window.label().to_string(), repository_root, operation_id)
}

#[tauri::command]
pub(crate) async fn list_workspace_replacement_recoveries(
    repository_root: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    app: tauri::AppHandle,
) -> Result<Vec<ReplacementRecoverySummary>, WorkspaceError> {
    let root = active_workspaces.resolve(window.label(), &repository_root)?;
    let recovery_root = replacement_recovery_root(&app)?;
    run_workspace_blocking("list replacement recoveries", move || {
        Workspace::open(root)?.list_replacement_recoveries(&recovery_root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn rollback_workspace_replacement(
    repository_root: String,
    recovery_id: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    writes: State<'_, WorkspaceWriteRegistry>,
    app: tauri::AppHandle,
) -> Result<ReplacementApplyResult, WorkspaceError> {
    let root = active_workspaces.resolve(window.label(), &repository_root)?;
    let write_lock = writes.lock_for(root.to_string_lossy().to_string())?;
    let recovery_root = replacement_recovery_root(&app)?;
    run_workspace_blocking("rollback workspace replacement", move || {
        let _guard = write_lock.lock().map_err(|_| WorkspaceError::Io {
            operation: "serialize workspace writes".to_string(),
            message: "workspace-write lock was poisoned".to_string(),
        })?;
        Workspace::open(root)?.rollback_replacement(&recovery_root, &recovery_id)
    })
    .await
}

#[tauri::command]
pub(crate) async fn finalize_workspace_replacement(
    repository_root: String,
    recovery_id: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    writes: State<'_, WorkspaceWriteRegistry>,
    app: tauri::AppHandle,
) -> Result<(), WorkspaceError> {
    let root = active_workspaces.resolve(window.label(), &repository_root)?;
    let write_lock = writes.lock_for(root.to_string_lossy().to_string())?;
    let recovery_root = replacement_recovery_root(&app)?;
    run_workspace_blocking("finalize workspace replacement", move || {
        let _guard = write_lock.lock().map_err(|_| WorkspaceError::Io {
            operation: "serialize workspace writes".to_string(),
            message: "workspace-write lock was poisoned".to_string(),
        })?;
        Workspace::open(root)?.finalize_replacement(&recovery_root, &recovery_id)
    })
    .await
}

#[tauri::command]
pub(crate) async fn read_text_file(
    repository_root: String,
    repository_id: String,
    path: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<TextFileSnapshot, WorkspaceError> {
    let root = active_workspaces.resolve(window.label(), &repository_root)?;
    run_workspace_blocking("read text file", move || {
        read_authorized_text_file(&root, &repository_id, &path)
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn save_text_file(
    repository_root: String,
    repository_id: String,
    path: String,
    expected_revision: String,
    content: String,
    utf8_bom: bool,
    request_id: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    writes: State<'_, WorkspaceWriteRegistry>,
) -> Result<SaveTextFileResult, WorkspaceError> {
    let root = active_workspaces.resolve(window.label(), &repository_root)?;
    let write_lock = writes.lock_for(root.to_string_lossy().to_string())?;
    run_workspace_blocking("save text file", move || {
        let _guard = write_lock.lock().map_err(|_| WorkspaceError::Io {
            operation: "serialize workspace writes".to_string(),
            message: "workspace-write lock was poisoned".to_string(),
        })?;
        save_authorized_text_file(
            &root,
            &repository_id,
            &path,
            expected_revision,
            content,
            utf8_bom,
            request_id,
        )
    })
    .await
}
