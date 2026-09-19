use super::super::*;
use crate::adapters::system_file_manager::{
    RevealWorkspaceEntryResult, reveal_workspace_entry as reveal_in_system_file_manager,
};
use crate::adapters::system_trash::move_to_system_trash;
use asterlyn_workspace::WorkspaceEntryKind;

#[tauri::command]
pub(crate) async fn list_project_files(
    repository_root: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<ProjectFileList, WorkspaceError> {
    let token = active_workspaces.activation_token(window.label())?;
    let root = active_workspaces.resolve(window.label(), &repository_root)?;
    let task_root = root.clone();
    let catalog = run_workspace_blocking("list project files", move || {
        load_project_catalog(&task_root)
    })
    .await?;
    active_workspaces.install_catalog(window.label(), token, &root, &catalog)?;
    Ok(catalog)
}

#[tauri::command]
pub(crate) fn reveal_workspace_entry(
    repository_root: String,
    workspace_path: String,
    kind: WorkspaceEntryKind,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RevealWorkspaceEntryResult, WorkspaceError> {
    let root = active_workspaces.resolve(window.label(), &repository_root)?;
    let target = resolve_workspace_entry(&root, &workspace_path, kind)?;
    reveal_in_system_file_manager(&target, kind)
}

#[tauri::command]
pub(crate) async fn inspect_workspace_entry(
    repository_root: String,
    workspace_path: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<WorkspaceEntryInspection, WorkspaceError> {
    let root = active_workspaces.resolve(window.label(), &repository_root)?;
    run_workspace_blocking("inspect workspace entry", move || {
        inspect_workspace_entry_inventory(&root, &workspace_path)
    })
    .await
}

#[tauri::command]
pub(crate) async fn plan_workspace_mutation(
    repository_root: String,
    plan_id: String,
    operation: WorkspaceMutationOperation,
    collision_policy: WorkspaceCollisionPolicy,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    mutations: State<'_, WorkspaceMutationCoordinator>,
) -> Result<WorkspaceMutationPreview, WorkspaceError> {
    let window_label = window.label().to_string();
    let root = active_workspaces.resolve(&window_label, &repository_root)?;
    let plan_token = mutations.begin_plan(&window_label, &repository_root, &plan_id)?;
    let task_root = root.clone();
    let task_plan_id = plan_id.clone();
    let result = run_workspace_blocking("plan workspace mutation", move || {
        prepare_workspace_mutation_plan(&task_root, &task_plan_id, operation, collision_policy)
    })
    .await;
    match result {
        Ok((preview, stored)) => {
            mutations.finish_plan(
                &window_label,
                &repository_root,
                &plan_id,
                plan_token,
                stored,
            )?;
            Ok(preview)
        }
        Err(error) => {
            match mutations.finish_plan(&window_label, &repository_root, &plan_id, plan_token, None)
            {
                Ok(()) => Err(error),
                Err(stale) => Err(stale),
            }
        }
    }
}

#[tauri::command]
pub(crate) async fn execute_workspace_mutation(
    repository_root: String,
    plan_id: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    mutations: State<'_, WorkspaceMutationCoordinator>,
    app: tauri::AppHandle,
) -> Result<WorkspaceMutationOutcome, WorkspaceError> {
    let window_label = window.label().to_string();
    let root = active_workspaces.resolve(&window_label, &repository_root)?;
    let execution = mutations.start_execution(&window_label, &repository_root, &root, &plan_id)?;
    let cancellation = execution.cancellation();
    let recovery_root = workspace_mutation_recovery_root(&app)?;
    let task_root = root.clone();
    let result = run_workspace_blocking("execute workspace mutation", move || {
        execute_workspace_mutation_plan(&task_root, &recovery_root, execution, move_to_system_trash)
    })
    .await;
    mutations.finish_execution(&window_label, &repository_root, &plan_id, &cancellation)?;
    result
}

#[tauri::command]
pub(crate) fn cancel_workspace_mutation(
    repository_root: String,
    plan_id: String,
    window: tauri::WebviewWindow,
    mutations: State<'_, WorkspaceMutationCoordinator>,
) -> Result<(), WorkspaceError> {
    mutations.cancel(window.label().to_string(), repository_root, plan_id)
}

#[tauri::command]
pub(crate) async fn list_workspace_mutation_recoveries(
    repository_root: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    app: tauri::AppHandle,
) -> Result<Vec<WorkspaceMutationRecoverySummary>, WorkspaceError> {
    let root = active_workspaces.resolve(window.label(), &repository_root)?;
    let recovery_root = workspace_mutation_recovery_root(&app)?;
    run_workspace_blocking("list workspace mutation recoveries", move || {
        load_workspace_mutation_recoveries(&root, &recovery_root)
    })
    .await
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
    let writes = writes.inner().clone();
    let recovery_root = replacement_recovery_root(&app)?;
    let task_cancellation = cancellation.clone();
    let result = run_workspace_blocking("apply workspace replacement", move || {
        apply_authorized_replacement(
            &root,
            &recovery_root,
            stored,
            &selected_paths,
            &task_cancellation,
            &writes,
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
        list_replacement_recoveries(&root, &recovery_root)
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
    let writes = writes.inner().clone();
    let recovery_root = replacement_recovery_root(&app)?;
    run_workspace_blocking("rollback workspace replacement", move || {
        rollback_replacement(&root, &recovery_root, &recovery_id, &writes)
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
    let writes = writes.inner().clone();
    let recovery_root = replacement_recovery_root(&app)?;
    run_workspace_blocking("finalize workspace replacement", move || {
        finalize_replacement(&root, &recovery_root, &recovery_id, &writes)
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
    let authorized = active_workspaces.authorize_catalogued_file(
        window.label(),
        &root,
        &repository_id,
        &path,
    )?;
    run_workspace_blocking("read text file", move || {
        read_session_text_file(&root, &authorized)
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
    let authorized = active_workspaces.authorize_catalogued_file(
        window.label(),
        &root,
        &repository_id,
        &path,
    )?;
    let writes = writes.inner().clone();
    run_workspace_blocking("save text file", move || {
        save_session_text_file(
            &root,
            &authorized,
            expected_revision,
            content,
            utf8_bom,
            request_id,
            &writes,
        )
    })
    .await
}
