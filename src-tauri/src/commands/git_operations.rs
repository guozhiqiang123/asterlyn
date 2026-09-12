use super::super::*;

#[tauri::command]
pub(crate) async fn stage_paths(
    repository_root: String,
    paths: Vec<String>,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<WorkingTreeMutationOutcome, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(repository_root, "stage paths", move |repository| {
            repository.stage(&paths)?;
            repository
                .tracked_changes()
                .map(|tracked| working_tree_outcome(tracked, &[RepositoryStateSlice::WorkingTree]))
        })
        .await
}

#[tauri::command]
pub(crate) async fn unstage_paths(
    repository_root: String,
    paths: Vec<String>,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<WorkingTreeMutationOutcome, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(repository_root, "unstage paths", move |repository| {
            repository.unstage(&paths)?;
            repository
                .tracked_changes()
                .map(|tracked| working_tree_outcome(tracked, &[RepositoryStateSlice::WorkingTree]))
        })
        .await
}

#[tauri::command]
pub(crate) async fn commit_changes(
    repository_root: String,
    message: String,
    selected: Vec<FileChange>,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<CommitSelectedResult, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(
            repository_root,
            "create selected commit",
            move |repository| {
                let committed = repository.commit_selected(&message, &selected)?;
                match repository.tracked_snapshot(COMMIT_LIMIT) {
                    Ok(snapshot) => Ok(CommitSelectedResult {
                        oid: committed.oid,
                        snapshot: Some(snapshot),
                        invalidated_slices: vec![
                            RepositoryStateSlice::WorkingTree,
                            RepositoryStateSlice::Head,
                            RepositoryStateSlice::Refs,
                            RepositoryStateSlice::History,
                        ],
                        refresh_error: None,
                        verification_warning: committed.verification_warning,
                    }),
                    Err(error) => Ok(CommitSelectedResult {
                        oid: committed.oid,
                        snapshot: None,
                        invalidated_slices: vec![
                            RepositoryStateSlice::WorkingTree,
                            RepositoryStateSlice::Head,
                            RepositoryStateSlice::Refs,
                            RepositoryStateSlice::History,
                        ],
                        refresh_error: Some(error.to_string()),
                        verification_warning: committed.verification_warning,
                    }),
                }
            },
        )
        .await
}

#[tauri::command]
pub(crate) async fn revert_changes(
    repository_root: String,
    selected: Vec<FileChange>,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<WorkingTreeMutationOutcome, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(
            repository_root,
            "revert selected changes",
            move |repository| {
                repository.revert_selected(&selected)?;
                repository.tracked_changes().map(|tracked| {
                    working_tree_outcome(
                        tracked,
                        &[
                            RepositoryStateSlice::OpenDocuments,
                            RepositoryStateSlice::WorkingTree,
                        ],
                    )
                })
            },
        )
        .await
}

#[tauri::command]
pub(crate) async fn switch_branch(
    repository_root: String,
    target_full_name: String,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RepositoryMutationOutcome, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(repository_root, "switch branch", move |repository| {
            repository.switch_branch(&target_full_name)?;
            repository
                .tracked_snapshot(COMMIT_LIMIT)
                .map(|snapshot| mutation_outcome(snapshot, &complete_repository_slices()))
        })
        .await
}

#[tauri::command]
pub(crate) async fn create_branch(
    repository_root: String,
    name: String,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RepositoryMutationOutcome, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(repository_root, "create branch", move |repository| {
            repository.create_branch(&name)?;
            repository
                .tracked_snapshot(COMMIT_LIMIT)
                .map(|snapshot| mutation_outcome(snapshot, &complete_repository_slices()))
        })
        .await
}

#[tauri::command]
pub(crate) async fn fetch_remote(
    repository_root: String,
    remote: String,
    operation_id: String,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RepositoryMutationOutcome, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_remote(
            repository_root,
            operation_id,
            "fetch",
            COMMIT_LIMIT,
            move |repository, cancellation| repository.fetch_remote(&remote, cancellation),
        )
        .await
        .map(|snapshot| {
            mutation_outcome(
                snapshot,
                &[
                    RepositoryStateSlice::Head,
                    RepositoryStateSlice::Refs,
                    RepositoryStateSlice::History,
                ],
            )
        })
}

#[tauri::command]
pub(crate) async fn read_push_preview(
    repository_root: String,
    remote: String,
    tag_mode: PushTagMode,
    offset: usize,
    page_size: usize,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<PushPreview, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read push preview", move || {
        GitRepository::open(root)?.push_preview_with_tags(&remote, tag_mode, offset, page_size)
    })
    .await
}

#[tauri::command]
pub(crate) async fn read_push_file_commit(
    repository_root: String,
    remote: String,
    tag_mode: PushTagMode,
    preview_token: String,
    path: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<Option<CommitDetails>, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read pushed file commit", move || {
        GitRepository::open(root)?.push_file_commit(&remote, tag_mode, &preview_token, &path)
    })
    .await
}

#[tauri::command]
pub(crate) async fn pull_current(
    repository_root: String,
    operation_id: String,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RepositoryMutationOutcome, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_remote(
            repository_root,
            operation_id,
            "pull",
            COMMIT_LIMIT,
            move |repository, cancellation| repository.pull_ff_only(cancellation),
        )
        .await
        .map(|snapshot| mutation_outcome(snapshot, &complete_repository_slices()))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn push_current(
    repository_root: String,
    remote: String,
    mode: PushMode,
    tag_mode: PushTagMode,
    preview_token: String,
    operation_id: String,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RepositoryMutationOutcome, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_remote(
            repository_root,
            operation_id,
            "push",
            COMMIT_LIMIT,
            move |repository, cancellation| {
                repository.push_current_with_options(
                    &remote,
                    mode,
                    tag_mode,
                    &preview_token,
                    cancellation,
                )
            },
        )
        .await
        .map(|snapshot| {
            mutation_outcome(
                snapshot,
                &[
                    RepositoryStateSlice::Head,
                    RepositoryStateSlice::Refs,
                    RepositoryStateSlice::History,
                ],
            )
        })
}

#[tauri::command]
pub(crate) fn cancel_remote_operation(
    repository_root: String,
    operation_id: String,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<(), GitError> {
    active_workspaces.require_git(window.label(), &repository_root)?;
    git_operations.cancel_remote(repository_root, operation_id)
}

#[tauri::command]
pub(crate) async fn read_git_operation(
    repository_root: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<Option<GitOperationSnapshot>, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read Git operation", move || {
        GitRepository::open(root)?.operation_snapshot()
    })
    .await
}

#[tauri::command]
pub(crate) async fn prepare_git_operation(
    repository_root: String,
    kind: GitOperationKind,
    target_refs: Vec<String>,
    message: Option<String>,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<GitOperationPlan, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(
            repository_root,
            "prepare Git operation",
            move |repository| match kind {
                GitOperationKind::Merge => repository.prepare_merge(single_target(&target_refs)?),
                GitOperationKind::CherryPick => repository.prepare_cherry_pick(&target_refs),
                GitOperationKind::Rebase => repository.prepare_rebase(single_target(&target_refs)?),
                GitOperationKind::Squash => repository.prepare_squash(
                    single_target(&target_refs)?,
                    message.as_deref().unwrap_or_default(),
                ),
                GitOperationKind::Revert | GitOperationKind::Bisect => {
                    Err(GitError::InvalidInput {
                        field: "operation kind".to_string(),
                        message: "Asterlyn cannot start this operation kind".to_string(),
                    })
                }
            },
        )
        .await
}

#[tauri::command]
pub(crate) async fn execute_git_operation(
    repository_root: String,
    plan: GitOperationPlan,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RepositoryMutationOutcome, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(
            repository_root,
            "execute Git operation",
            move |repository| {
                repository.execute_operation_plan(&plan)?;
                repository
                    .tracked_snapshot(COMMIT_LIMIT)
                    .map(|snapshot| mutation_outcome(snapshot, &complete_repository_slices()))
            },
        )
        .await
}

#[tauri::command]
pub(crate) async fn run_git_operation_action(
    repository_root: String,
    action: GitOperationAction,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RepositoryMutationOutcome, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(repository_root, "resume Git operation", move |repository| {
            repository.run_operation_action(action)?;
            repository
                .tracked_snapshot(COMMIT_LIMIT)
                .map(|snapshot| mutation_outcome(snapshot, &complete_repository_slices()))
        })
        .await
}

#[tauri::command]
pub(crate) async fn read_conflict_content(
    repository_root: String,
    path: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<GitConflictContent, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read conflict content", move || {
        GitRepository::open(root)?.read_conflict_content(&path)
    })
    .await
}

#[tauri::command]
pub(crate) async fn resolve_conflict(
    repository_root: String,
    path: String,
    expected_revision_token: String,
    content: Option<String>,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<GitOperationMutationOutcome, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(repository_root, "resolve Git conflict", move |repository| {
            let operation =
                repository.resolve_conflict(&path, &expected_revision_token, content.as_deref())?;
            let tracked = repository.tracked_changes()?;
            Ok(GitOperationMutationOutcome {
                tracked,
                operation,
                invalidated_slices: vec![
                    RepositoryStateSlice::OpenDocuments,
                    RepositoryStateSlice::WorkingTree,
                    RepositoryStateSlice::Operation,
                ],
            })
        })
        .await
}

fn single_target(targets: &[String]) -> Result<&str, GitError> {
    if targets.len() == 1 {
        Ok(&targets[0])
    } else {
        Err(GitError::InvalidInput {
            field: "operation targets".to_string(),
            message: "exactly one target is required".to_string(),
        })
    }
}

fn mutation_outcome(
    snapshot: RepositorySnapshot,
    invalidated_slices: &[RepositoryStateSlice],
) -> RepositoryMutationOutcome {
    RepositoryMutationOutcome {
        snapshot,
        invalidated_slices: invalidated_slices.to_vec(),
    }
}

fn working_tree_outcome(
    tracked: TrackedChangeScan,
    invalidated_slices: &[RepositoryStateSlice],
) -> WorkingTreeMutationOutcome {
    WorkingTreeMutationOutcome {
        tracked,
        invalidated_slices: invalidated_slices.to_vec(),
    }
}

fn complete_repository_slices() -> Vec<RepositoryStateSlice> {
    vec![
        RepositoryStateSlice::WorkspaceCatalog,
        RepositoryStateSlice::OpenDocuments,
        RepositoryStateSlice::WorkingTree,
        RepositoryStateSlice::Head,
        RepositoryStateSlice::Refs,
        RepositoryStateSlice::History,
        RepositoryStateSlice::Operation,
    ]
}
