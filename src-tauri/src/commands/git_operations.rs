use super::super::*;
use super::git_recovery::git_recovery_root;
use crate::adapters::system_trash::move_to_system_trash;
use crate::application::git_worktree_transactions::{self, RestoreChangesPlan};

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
pub(crate) async fn trash_untracked_paths(
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
        .run_local(
            repository_root,
            "trash untracked paths",
            move |repository| {
                let targets = repository.resolve_untracked_paths_for_trash(&paths)?;
                for target in targets {
                    move_to_system_trash(&target).map_err(|error| GitError::Io {
                        operation: "move untracked files to system Trash".to_string(),
                        message: error.to_string(),
                    })?;
                }
                repository.tracked_changes().map(|tracked| {
                    working_tree_outcome(tracked, &[RepositoryStateSlice::WorkingTree])
                })
            },
        )
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
    plan: RestoreChangesPlan,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    app: tauri::AppHandle,
) -> Result<WorkingTreeMutationOutcome, GitError> {
    let recovery_root = git_recovery_root(&app)?;
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(
            repository_root,
            "revert selected changes",
            move |repository| {
                git_worktree_transactions::restore_changes(repository, &recovery_root, &plan)?;
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
pub(crate) async fn prepare_branch_mutation(
    repository_root: String,
    request: BranchMutationRequest,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<BranchMutationPlan, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(
            repository_root,
            "prepare branch mutation",
            move |repository| repository.prepare_branch_mutation(&request),
        )
        .await
}

#[tauri::command]
pub(crate) async fn execute_branch_mutation(
    repository_root: String,
    plan: BranchMutationPlan,
    operation_id: String,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RepositoryMutationOutcome, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    if plan.delete_remote {
        git_operations
            .run_remote(
                repository_root,
                operation_id,
                "delete local and remote branches",
                COMMIT_LIMIT,
                move |repository, cancellation| {
                    repository.execute_branch_mutation_with_remote(&plan, cancellation)
                },
            )
            .await
            .map(|snapshot| mutation_outcome(snapshot, &complete_repository_slices()))
    } else {
        git_operations
            .run_local(
                repository_root,
                "execute branch mutation",
                move |repository| {
                    repository.execute_branch_mutation(&plan)?;
                    repository
                        .tracked_snapshot(COMMIT_LIMIT)
                        .map(|snapshot| mutation_outcome(snapshot, &complete_repository_slices()))
                },
            )
            .await
    }
}

#[tauri::command]
pub(crate) async fn prepare_remote_mutation(
    repository_root: String,
    request: RemoteMutationRequest,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RemoteMutationPlan, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(
            repository_root,
            "prepare remote mutation",
            move |repository| repository.prepare_remote_mutation(&request),
        )
        .await
}

#[tauri::command]
pub(crate) async fn execute_remote_mutation(
    repository_root: String,
    plan: RemoteMutationPlan,
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
            "execute remote mutation",
            move |repository| {
                repository.execute_remote_mutation(&plan)?;
                repository
                    .tracked_snapshot(COMMIT_LIMIT)
                    .map(|snapshot| mutation_outcome(snapshot, &complete_repository_slices()))
            },
        )
        .await
}

#[tauri::command]
pub(crate) async fn prepare_git_reset(
    repository_root: String,
    target_oid: String,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<GitResetPlan, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(repository_root, "prepare Git reset", move |repository| {
            repository.prepare_git_reset(&target_oid)
        })
        .await
}

#[tauri::command]
pub(crate) async fn execute_git_reset(
    repository_root: String,
    plan: GitResetPlan,
    mode: GitResetMode,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RepositoryMutationOutcome, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(repository_root, "execute Git reset", move |repository| {
            repository.execute_git_reset(&plan, mode)?;
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
pub(crate) async fn read_remote_authentication(
    repository_root: String,
    remote: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RemoteAuthenticationStatus, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read remote authentication", move || {
        GitRepository::open(root)?.remote_authentication_status(&remote)
    })
    .await
}

#[tauri::command]
pub(crate) async fn store_remote_https_credential(
    repository_root: String,
    remote: String,
    username: String,
    token: String,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RemoteAuthenticationStatus, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(
            repository_root,
            "store remote credential",
            move |repository| repository.store_remote_https_credential(&remote, &username, &token),
        )
        .await
}

#[tauri::command]
pub(crate) async fn configure_remote_ssh(
    repository_root: String,
    remote: String,
    ssh_url: String,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RemoteAuthenticationStatus, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(
            repository_root,
            "configure SSH push URL",
            move |repository| repository.configure_remote_ssh(&remote, &ssh_url),
        )
        .await
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
                GitOperationKind::Revert => repository.prepare_reverts(&target_refs),
                GitOperationKind::Bisect => Err(GitError::InvalidInput {
                    field: "operation kind".to_string(),
                    message: "Asterlyn cannot start this operation kind".to_string(),
                }),
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

// Tauri injects four host handles alongside the four protocol arguments.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub(crate) async fn resolve_conflict(
    repository_root: String,
    path: String,
    expected_revision_token: String,
    content: Option<String>,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    app: tauri::AppHandle,
) -> Result<GitOperationMutationOutcome, GitError> {
    let recovery_root = git_recovery_root(&app)?;
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(repository_root, "resolve Git conflict", move |repository| {
            let operation = git_worktree_transactions::resolve_conflict(
                repository,
                &recovery_root,
                &path,
                &expected_revision_token,
                content.as_deref(),
            )?;
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

pub(super) fn mutation_outcome(
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

pub(super) fn complete_repository_slices() -> Vec<RepositoryStateSlice> {
    vec![
        RepositoryStateSlice::WorkspaceCatalog,
        RepositoryStateSlice::OpenDocuments,
        RepositoryStateSlice::RepositoryCapability,
        RepositoryStateSlice::WorkingTree,
        RepositoryStateSlice::Head,
        RepositoryStateSlice::Refs,
        RepositoryStateSlice::History,
        RepositoryStateSlice::Operation,
    ]
}
