use super::super::*;

#[tauri::command]
pub(crate) fn initial_repository(
    window: tauri::WebviewWindow,
    pending: State<'_, PendingRepositoryWindows>,
) -> Result<Option<String>, GitError> {
    if let Some(path) = pending.take(window.label())? {
        return Ok(Some(path));
    }
    Ok(std::env::args_os()
        .skip(1)
        .find(|argument| !argument.to_string_lossy().starts_with('-'))
        .map(|argument| argument.to_string_lossy().into_owned()))
}

#[tauri::command]
pub(crate) fn window_chrome_mode() -> &'static str {
    window_chrome_mode_for(cfg!(target_os = "macos"))
}

#[tauri::command]
pub(crate) async fn open_project(
    path: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<OpenedProject, WorkspaceError> {
    let project = run_workspace_blocking("open project", move || {
        let workspace = Workspace::open(path)?;
        let root = workspace.root().to_path_buf();
        let repository = exact_git_repository(&root)?
            .map(|repository| {
                repository
                    .tracked_snapshot(COMMIT_LIMIT)
                    .map_err(|error| WorkspaceError::Io {
                        operation: "read Git project".to_string(),
                        message: error.to_string(),
                    })
            })
            .transpose()?;
        Ok(OpenedProject {
            root: root.to_string_lossy().into_owned(),
            repository,
        })
    })
    .await?;
    active_workspaces.activate(
        window.label(),
        Path::new(&project.root),
        project
            .repository
            .as_ref()
            .map(|repository| Path::new(&repository.git_dir)),
    )?;
    Ok(project)
}

#[tauri::command]
pub(crate) fn open_repository_window(
    path: String,
    app: tauri::AppHandle,
    pending: State<'_, PendingRepositoryWindows>,
) -> Result<String, GitError> {
    let canonical = std::fs::canonicalize(&path).map_err(|error| GitError::Io {
        operation: "open repository window".to_string(),
        message: error.to_string(),
    })?;
    Workspace::open(&canonical).map_err(|error| GitError::InvalidInput {
        field: "project path".to_string(),
        message: error.to_string(),
    })?;
    let label = pending.reserve(canonical.clone())?;
    let title = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| format!("Asterlyn — {name}"))
        .unwrap_or_else(|| "Asterlyn".to_string());
    let result = build_project_window(&app, label.clone(), title);
    if let Err(error) = result {
        pending.remove(&label);
        return Err(GitError::Io {
            operation: "open repository window".to_string(),
            message: error.to_string(),
        });
    }
    Ok(label)
}
