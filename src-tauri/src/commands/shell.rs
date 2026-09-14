use super::super::*;

const MAX_RECENT_PROJECT_DIRECTORIES: usize = 8;
const MAX_PROJECT_DIRECTORY_PATH_BYTES: usize = 4_096;

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
pub(crate) async fn existing_project_directories(
    paths: Vec<String>,
) -> Result<Vec<String>, WorkspaceError> {
    run_workspace_blocking("check recent project directories", move || {
        filter_existing_project_directories(paths)
    })
    .await
}

fn filter_existing_project_directories(paths: Vec<String>) -> Result<Vec<String>, WorkspaceError> {
    if paths.len() > MAX_RECENT_PROJECT_DIRECTORIES {
        return Err(WorkspaceError::InvalidPath {
            message: format!(
                "recent-project validation accepts at most {MAX_RECENT_PROJECT_DIRECTORIES} paths"
            ),
        });
    }

    let mut seen = HashSet::new();
    let mut existing = Vec::with_capacity(paths.len());
    for path in paths {
        if path.is_empty() || path.len() > MAX_PROJECT_DIRECTORY_PATH_BYTES {
            return Err(WorkspaceError::InvalidPath {
                message: "recent-project path is empty or exceeds the supported length".to_string(),
            });
        }
        if !seen.insert(path.clone()) {
            continue;
        }
        match std::fs::metadata(&path) {
            Ok(metadata) if metadata.is_dir() => existing.push(path),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => existing.push(path),
        }
    }
    Ok(existing)
}

#[tauri::command]
pub(crate) async fn open_project(
    path: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    pending: State<'_, PendingRepositoryWindows>,
    terminal_sessions: State<'_, asterlyn_terminal::TerminalSessions>,
) -> Result<OpenedProject, WorkspaceError> {
    let token = active_workspaces.begin_activation(window.label())?;
    let project = match read_project(path).await {
        Ok(project) => project,
        Err(error) => {
            pending.remove(window.label());
            return Err(error);
        }
    };
    let activation = active_workspaces.activate_current(
        window.label(),
        token,
        Path::new(&project.root),
        project
            .repository
            .as_ref()
            .map(|repository| Path::new(&repository.git_dir)),
    );
    pending.remove(window.label());
    activation?;
    terminal_sessions.remove_owner_if_root_changed(window.label(), Path::new(&project.root));
    Ok(project)
}

#[tauri::command]
pub(crate) async fn read_project_snapshot(
    path: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<OpenedProject, WorkspaceError> {
    let token = active_workspaces.activation_token(window.label())?;
    let root = active_workspaces.resolve(window.label(), &path)?;
    let observation = active_workspaces.begin_repository_observation(window.label(), &root)?;
    let project = read_project(root.to_string_lossy().into_owned()).await?;
    active_workspaces.activate_repository_observation(
        window.label(),
        token,
        observation,
        Path::new(&project.root),
        project
            .repository
            .as_ref()
            .map(|repository| Path::new(&repository.git_dir)),
    )?;
    Ok(project)
}

#[tauri::command]
pub(crate) async fn read_repository_slices(
    repository_root: String,
    slices: Vec<RepositoryStateSlice>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RepositorySliceProject, WorkspaceError> {
    let unique_slices: HashSet<_> = slices.iter().copied().collect();
    if slices.is_empty()
        || unique_slices.len() != slices.len()
        || slices.len() > 6
        || slices.iter().any(|slice| {
            matches!(
                slice,
                RepositoryStateSlice::WorkspaceCatalog | RepositoryStateSlice::OpenDocuments
            )
        })
    {
        return Err(WorkspaceError::InvalidPath {
            message: "select one or more repository-owned state slices".to_string(),
        });
    }
    let token = active_workspaces.activation_token(window.label())?;
    let root = active_workspaces.resolve(window.label(), &repository_root)?;
    let observation = active_workspaces.begin_repository_observation(window.label(), &root)?;
    let plan = RepositoryReadPlan {
        working_tree: slices.contains(&RepositoryStateSlice::WorkingTree),
        head: slices.contains(&RepositoryStateSlice::Head),
        refs: slices.contains(&RepositoryStateSlice::Refs),
        history: slices.contains(&RepositoryStateSlice::History),
        operation: slices.contains(&RepositoryStateSlice::Operation),
    };
    let project = run_workspace_blocking("read repository slices", move || {
        let repository = exact_git_repository(&root)?
            .map(|repository| {
                repository
                    .read_slices(plan, COMMIT_LIMIT)
                    .map_err(|error| WorkspaceError::Io {
                        operation: "read Git project slices".to_string(),
                        message: error.to_string(),
                    })
            })
            .transpose()?;
        Ok(RepositorySliceProject {
            root: root.to_string_lossy().into_owned(),
            repository,
        })
    })
    .await?;
    active_workspaces.activate_repository_observation(
        window.label(),
        token,
        observation,
        Path::new(&project.root),
        project
            .repository
            .as_ref()
            .map(|repository| Path::new(&repository.git_dir)),
    )?;
    Ok(project)
}

async fn read_project(path: String) -> Result<OpenedProject, WorkspaceError> {
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
    Ok(project)
}

fn canonical_project_path(path: &str) -> Result<PathBuf, GitError> {
    let canonical = std::fs::canonicalize(path).map_err(|error| GitError::Io {
        operation: "open project window".to_string(),
        message: error.to_string(),
    })?;
    Workspace::open(&canonical).map_err(|error| GitError::InvalidInput {
        field: "project path".to_string(),
        message: error.to_string(),
    })?;
    Ok(canonical)
}

fn active_window_for_root(
    active_workspaces: &ActiveWorkspaces,
    root: &Path,
) -> Result<Option<String>, GitError> {
    active_workspaces
        .window_for_root(root)
        .map_err(|error| GitError::Io {
            operation: "locate open project window".to_string(),
            message: error.to_string(),
        })
}

fn focus_project_window(app: &tauri::AppHandle, label: &str) -> Result<bool, GitError> {
    let Some(window) = app.get_webview_window(label) else {
        return Ok(false);
    };
    window.show().map_err(|error| GitError::Io {
        operation: "show open project window".to_string(),
        message: error.to_string(),
    })?;
    window.unminimize().map_err(|error| GitError::Io {
        operation: "restore open project window".to_string(),
        message: error.to_string(),
    })?;
    window.set_focus().map_err(|error| GitError::Io {
        operation: "focus open project window".to_string(),
        message: error.to_string(),
    })?;
    Ok(true)
}

fn existing_project_window(
    app: &tauri::AppHandle,
    root: &Path,
    active_workspaces: &ActiveWorkspaces,
    pending: &PendingRepositoryWindows,
) -> Result<Option<String>, GitError> {
    loop {
        let label =
            active_window_for_root(active_workspaces, root)?.or(pending.window_for_root(root)?);
        let Some(label) = label else {
            return Ok(None);
        };
        if focus_project_window(app, &label)? {
            return Ok(Some(label));
        }
        active_workspaces.remove(&label);
        pending.remove(&label);
    }
}

#[tauri::command]
pub(crate) fn focus_existing_project_window(
    path: String,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    active_workspaces: State<'_, ActiveWorkspaces>,
    pending: State<'_, PendingRepositoryWindows>,
) -> Result<ProjectWindowMatch, GitError> {
    let canonical = canonical_project_path(&path)?;
    let Some(label) = existing_project_window(&app, &canonical, &active_workspaces, &pending)?
    else {
        return Ok(ProjectWindowMatch::NotOpen);
    };
    Ok(if label == window.label() {
        ProjectWindowMatch::Current
    } else {
        ProjectWindowMatch::FocusedExisting
    })
}

#[tauri::command]
pub(crate) fn open_repository_window(
    path: String,
    app: tauri::AppHandle,
    active_workspaces: State<'_, ActiveWorkspaces>,
    pending: State<'_, PendingRepositoryWindows>,
) -> Result<ProjectWindowOpenResult, GitError> {
    let canonical = canonical_project_path(&path)?;
    if let Some(label) = existing_project_window(&app, &canonical, &active_workspaces, &pending)? {
        return Ok(ProjectWindowOpenResult {
            window_label: label,
            focused_existing: true,
        });
    }
    let label = loop {
        match pending.reserve(canonical.clone())? {
            PendingRepositoryWindowReservation::Reserved(label) => break label,
            PendingRepositoryWindowReservation::Existing(label) => {
                if focus_project_window(&app, &label)? {
                    return Ok(ProjectWindowOpenResult {
                        window_label: label,
                        focused_existing: true,
                    });
                }
                pending.remove(&label);
            }
        }
    };
    let title = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| format!("Asterlyn — {name}"))
        .unwrap_or_else(|| "Asterlyn".to_string());
    let result = build_project_window(&app, label.clone(), title);
    if let Err(error) = result {
        pending.remove(&label);
        return Err(GitError::Io {
            operation: "open project window".to_string(),
            message: error.to_string(),
        });
    }
    Ok(ProjectWindowOpenResult {
        window_label: label,
        focused_existing: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_project_check_keeps_directories_and_drops_missing_or_file_paths() {
        let temporary = tempfile::tempdir().expect("temporary root");
        let directory = temporary.path().join("project");
        let file = temporary.path().join("not-a-project");
        let missing = temporary.path().join("missing");
        std::fs::create_dir(&directory).expect("project directory");
        std::fs::write(&file, "file").expect("ordinary file");

        let existing = filter_existing_project_directories(vec![
            directory.to_string_lossy().into_owned(),
            file.to_string_lossy().into_owned(),
            missing.to_string_lossy().into_owned(),
        ])
        .expect("bounded validation");

        assert_eq!(existing, vec![directory.to_string_lossy().into_owned()]);
    }

    #[test]
    fn recent_project_check_rejects_unbounded_input() {
        let error = filter_existing_project_directories(
            (0..=MAX_RECENT_PROJECT_DIRECTORIES)
                .map(|index| format!("/project-{index}"))
                .collect(),
        )
        .expect_err("unbounded validation must fail");

        assert!(matches!(error, WorkspaceError::InvalidPath { .. }));
    }
}
