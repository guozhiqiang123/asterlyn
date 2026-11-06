use super::*;
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};

fn hash(value: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(value.as_bytes()))
}
fn artifact(server: &str, version: &str) -> ManagedArtifact {
    ManagedArtifact {
        server: ManagedServerId {
            plugin_id: "dev.example.lsp".into(),
            server_id: server.into(),
        },
        version: version.into(),
        target: "aarch64-apple-darwin".into(),
        recipe_digest: hash(&format!("recipe-{version}")),
        archive_digest: hash(&format!("archive-{version}")),
        content_digest: hash(version),
    }
}
fn authority(window: &str) -> ManagementAuthority {
    ManagementAuthority {
        window_id: window.into(),
        activation: 1,
        plugin_id: "dev.example.lsp".into(),
        plugin_version: "1.0.0".into(),
        package_digest: hash("plugin"),
        enabled: true,
        may_manage: true,
    }
}
fn scope(window: &str, session: &str) -> ManagedUseScope {
    ManagedUseScope {
        window_id: window.into(),
        workspace_digest: hash(&format!("project-{window}")),
        session_id: session.into(),
    }
}
fn plan(artifact: ManagedArtifact) -> ManagedInstallPlan {
    ManagedInstallPlan {
        artifact,
        download_bytes: 16,
        expanded_bytes: 32,
    }
}
fn manager(index: ManagedInstallationIndex) -> ManagedInstallationCoordinator {
    ManagedInstallationCoordinator::restore("test-epoch".into(), index).unwrap()
}
fn proof(artifact: &ManagedArtifact) -> VerifiedManagedArtifact {
    let mut verifier = FixtureVerifier {
        content: artifact.version.clone(),
        reject: false,
    };
    verify_managed_artifact(artifact, &mut verifier).unwrap()
}
struct FixtureVerifier {
    content: String,
    reject: bool,
}
impl ManagedArtifactVerifier for FixtureVerifier {
    fn verify(&mut self, artifact: &ManagedArtifact) -> Result<(), ManagedInstallError> {
        if self.reject || artifact.content_digest != hash(&self.content) {
            Err(ManagedInstallError::IntegrityMismatch)
        } else {
            Ok(())
        }
    }
}
#[derive(Default)]
struct FixtureStorage {
    index: ManagedInstallationIndex,
    error: Option<ManagedInstallError>,
    commits: usize,
}
impl FixtureStorage {
    fn commit(
        &mut self,
        expected: u64,
        next: &ManagedInstallationIndex,
    ) -> Result<(), ManagedInstallError> {
        if expected != self.index.revision {
            return Err(ManagedInstallError::StateChanged);
        }
        if let Some(error) = self.error {
            return Err(error);
        }
        next.validate()?;
        assert_eq!(next.revision, expected + 1);
        self.index = next.clone();
        self.commits += 1;
        Ok(())
    }
}
impl ManagedInstallationStorage for FixtureStorage {
    fn commit_install(
        &mut self,
        expected: u64,
        next: &ManagedInstallationIndex,
        artifact: &ManagedArtifact,
    ) -> Result<(), ManagedInstallError> {
        assert!(next.artifacts.iter().any(|item| item.identity == *artifact));
        self.commit(expected, next)
    }
    fn commit_removal(
        &mut self,
        expected: u64,
        next: &ManagedInstallationIndex,
        artifact: &ManagedInstalledArtifact,
    ) -> Result<(), ManagedInstallError> {
        assert_eq!(artifact.ownership, ManagedArtifactOwnership::Managed);
        assert!(!next.artifacts.iter().any(|item| item.id == artifact.id));
        self.commit(expected, next)
    }
}
fn start(
    manager: &mut ManagedInstallationCoordinator,
    owner: &ManagementAuthority,
    artifact: &ManagedArtifact,
) -> ManagedOperationTicket {
    let now = Instant::now();
    let review = manager
        .prepare_install(owner, plan(artifact.clone()), now)
        .unwrap();
    manager.confirm(owner, &review.id, now).unwrap()
}
fn acquired(manager: &mut ManagedInstallationCoordinator, ticket: &ManagedOperationTicket) {
    manager.progress(ticket, 16).unwrap();
    manager.begin_verification(ticket).unwrap();
}
fn install(
    manager: &mut ManagedInstallationCoordinator,
    owner: &ManagementAuthority,
    storage: &mut FixtureStorage,
    artifact: &ManagedArtifact,
) {
    let ticket = start(manager, owner, artifact);
    acquired(manager, &ticket);
    manager
        .complete_install(owner, &ticket, &proof(artifact), storage)
        .unwrap();
    manager.snapshot().unwrap().validate().unwrap();
}

#[test]
fn installation_is_not_visible_until_verified_and_durably_committed() {
    let (mut manager, mut storage, owner, artifact) = (
        manager(Default::default()),
        FixtureStorage::default(),
        authority("one"),
        artifact("rust", "1.0.0"),
    );
    let ticket = start(&mut manager, &owner, &artifact);
    assert!(manager.snapshot().unwrap().artifacts.is_empty());
    assert_eq!(
        manager.complete_install(&owner, &ticket, &proof(&artifact), &mut storage),
        Err(ManagedInstallError::InvalidTransition)
    );
    acquired(&mut manager, &ticket);
    manager
        .complete_install(&owner, &ticket, &proof(&artifact), &mut storage)
        .unwrap();
    let snapshot = manager.snapshot().unwrap();
    snapshot.validate().unwrap();
    assert_eq!(
        snapshot.artifacts[0].verification,
        ManagedArtifactVerification::Verified
    );
    assert_eq!(snapshot.selections[0].current, Some(artifact.id()));
    assert_eq!(
        snapshot.operations[0].phase,
        ManagedOperationPhase::Completed
    );
    assert_eq!(storage.commits, 1);
    // No execution grant, session or process is produced by this API.
    assert_eq!(snapshot.artifacts[0].use_count, 0);
}

#[test]
fn review_requires_management_authority_and_is_bound_to_exact_window_package_and_activation() {
    let now = Instant::now();
    let owner = authority("one");
    let artifact = artifact("rust", "1");
    let mut manager = manager(Default::default());
    let review = manager
        .prepare_install(&owner, plan(artifact.clone()), now)
        .unwrap();
    let mut variants = vec![authority("two")];
    for change in 0..5 {
        let mut changed = owner.clone();
        match change {
            0 => changed.activation += 1,
            1 => changed.plugin_version = "2.0.0".into(),
            2 => changed.package_digest = hash("new"),
            3 => changed.enabled = false,
            _ => changed.may_manage = false,
        }
        variants.push(changed);
    }
    for changed in variants {
        assert!(manager.confirm(&changed, &review.id, now).is_err());
    }
    assert!(manager.confirm(&owner, &review.id, now).is_ok());
    assert!(manager.confirm(&owner, &review.id, now).is_err());
    let mut denied = owner.clone();
    denied.may_manage = false;
    assert_eq!(
        manager
            .prepare_install(&denied, plan(artifact), now)
            .unwrap_err(),
        ManagedInstallError::PermissionDenied
    );
}

#[test]
fn reviews_expire_and_index_changes_require_a_new_review() {
    let now = Instant::now();
    let owner = authority("one");
    let mut manager = manager(Default::default());
    let review = manager
        .prepare_install(&owner, plan(artifact("rust", "1")), now)
        .unwrap();
    assert_eq!(
        manager
            .confirm(&owner, &review.id, now + MANAGEMENT_REVIEW_TTL)
            .unwrap_err(),
        ManagedInstallError::ExpiredReview
    );
    let review = manager
        .prepare_install(&owner, plan(artifact("rust", "1")), now)
        .unwrap();
    install(
        &mut manager,
        &owner,
        &mut FixtureStorage::default(),
        &artifact("other", "1"),
    );
    assert_eq!(
        manager.confirm(&owner, &review.id, now).unwrap_err(),
        ManagedInstallError::StaleReview
    );
}

#[test]
fn duplicate_work_and_progress_regression_are_rejected() {
    let owner = authority("one");
    let artifact = artifact("rust", "1");
    let mut manager = manager(Default::default());
    let ticket = start(&mut manager, &owner, &artifact);
    assert_eq!(
        manager
            .prepare_install(&authority("two"), plan(artifact), Instant::now())
            .unwrap_err(),
        ManagedInstallError::Busy
    );
    manager.progress(&ticket, 8).unwrap();
    assert_eq!(
        manager.progress(&ticket, 7),
        Err(ManagedInstallError::InvalidTransition)
    );
    assert_eq!(
        manager.progress(&ticket, 17),
        Err(ManagedInstallError::InvalidTransition)
    );
    assert_eq!(
        manager.begin_verification(&ticket),
        Err(ManagedInstallError::InvalidTransition)
    );
    acquired(&mut manager, &ticket);
    assert_eq!(
        manager.progress(&ticket, 16),
        Err(ManagedInstallError::InvalidTransition)
    );
    manager.snapshot().unwrap().validate().unwrap();
}

#[test]
fn cancellation_and_authority_revocation_reject_late_worker_completion() {
    let owner = authority("one");
    let artifact = artifact("rust", "1");
    let mut manager = manager(Default::default());
    let mut storage = FixtureStorage::default();
    let ticket = start(&mut manager, &owner, &artifact);
    acquired(&mut manager, &ticket);
    assert!(manager.cancel(&authority("two"), &ticket).is_err());
    manager.cancel(&owner, &ticket).unwrap();
    assert!(ticket.is_cancelled());
    assert_eq!(
        manager.complete_install(&owner, &ticket, &proof(&artifact), &mut storage),
        Err(ManagedInstallError::Cancelled)
    );
    let ticket = start(&mut manager, &owner, &artifact);
    acquired(&mut manager, &ticket);
    let mut disabled = owner.clone();
    disabled.enabled = false;
    manager.reconcile_authority(&disabled).unwrap();
    assert!(ticket.is_cancelled());
    assert_eq!(
        manager.complete_install(&owner, &ticket, &proof(&artifact), &mut storage),
        Err(ManagedInstallError::Cancelled)
    );
    assert_eq!(storage.commits, 0);
    assert!(manager.snapshot().unwrap().artifacts.is_empty());
}

#[test]
fn a_new_package_cannot_complete_work_approved_for_old_bytes() {
    let owner = authority("one");
    let artifact = artifact("rust", "1");
    let mut manager = manager(Default::default());
    let ticket = start(&mut manager, &owner, &artifact);
    acquired(&mut manager, &ticket);
    let mut updated = owner.clone();
    updated.package_digest = hash("updated package");
    let mut storage = FixtureStorage::default();
    assert_eq!(
        manager.complete_install(&updated, &ticket, &proof(&artifact), &mut storage),
        Err(ManagedInstallError::StaleReview)
    );
    manager.reconcile_authority(&updated).unwrap();
    assert!(ticket.is_cancelled());
    assert_eq!(storage.commits, 0);
}

#[test]
fn verification_and_storage_failures_preserve_current_and_rollback() {
    let owner = authority("one");
    let mut manager = manager(Default::default());
    let mut storage = FixtureStorage::default();
    install(&mut manager, &owner, &mut storage, &artifact("rust", "1"));
    install(&mut manager, &owner, &mut storage, &artifact("rust", "2"));
    let before = storage.index.clone();
    let next = artifact("rust", "3");
    let ticket = start(&mut manager, &owner, &next);
    acquired(&mut manager, &ticket);
    assert_eq!(
        manager.complete_install(
            &owner,
            &ticket,
            &proof(&artifact("rust", "wrong")),
            &mut storage
        ),
        Err(ManagedInstallError::IntegrityMismatch)
    );
    assert_eq!(storage.index, before);
    let ticket = start(&mut manager, &owner, &next);
    acquired(&mut manager, &ticket);
    storage.error = Some(ManagedInstallError::StorageFailed);
    assert_eq!(
        manager.complete_install(&owner, &ticket, &proof(&next), &mut storage),
        Err(ManagedInstallError::StorageFailed)
    );
    assert_eq!(storage.index, before);
    assert_eq!(manager.snapshot().unwrap().selections, before.selections);
    assert_eq!(manager.snapshot().unwrap().artifacts.len(), 2);
    storage.error = None;
    install(&mut manager, &owner, &mut storage, &next);
    assert_eq!(
        storage.index.selections[0].rollback,
        Some(artifact("rust", "2").id())
    );
}

#[test]
fn staged_proof_is_bound_to_all_artifact_fields() {
    let original = artifact("rust", "1");
    for field in 0..7 {
        let mut changed = original.clone();
        match field {
            0 => changed.server.plugin_id = "other.plugin".into(),
            1 => changed.server.server_id = "other".into(),
            2 => changed.version = "2".into(),
            3 => changed.target = "x86_64-unknown-linux-gnu".into(),
            4 => changed.recipe_digest = hash("r"),
            5 => changed.archive_digest = hash("a"),
            _ => changed.content_digest = hash("c"),
        }
        assert_ne!(changed.id(), original.id());
    }
    let mut verifier = FixtureVerifier {
        content: "wrong bytes".into(),
        reject: false,
    };
    assert!(matches!(
        verify_managed_artifact(&original, &mut verifier),
        Err(ManagedInstallError::IntegrityMismatch)
    ));
}

#[test]
fn remove_waits_for_all_window_uses_and_blocks_new_uses() {
    let owner = authority("one");
    let artifact = artifact("rust", "1");
    let mut manager = manager(Default::default());
    let mut storage = FixtureStorage::default();
    install(&mut manager, &owner, &mut storage, &artifact);
    let first = manager
        .acquire_use(&artifact.id(), scope("one", "session-1"))
        .unwrap();
    let second = manager
        .acquire_use(&artifact.id(), scope("two", "session-2"))
        .unwrap();
    let now = Instant::now();
    let review = manager.prepare_remove(&owner, &artifact.id(), now).unwrap();
    assert_eq!(review.uses.len(), 2);
    let ticket = manager.confirm(&owner, &review.id, now).unwrap();
    assert_eq!(
        manager
            .acquire_use(&artifact.id(), scope("three", "session-3"))
            .unwrap_err(),
        ManagedInstallError::Busy
    );
    assert_eq!(
        manager.complete_remove(&owner, &ticket, &mut storage),
        Err(ManagedInstallError::InUse)
    );
    manager.release_use(&first).unwrap();
    assert_eq!(
        manager.complete_remove(&owner, &ticket, &mut storage),
        Err(ManagedInstallError::InUse)
    );
    manager.release_use(&second).unwrap();
    manager
        .complete_remove(&owner, &ticket, &mut storage)
        .unwrap();
    assert!(storage.index.artifacts.is_empty());
    assert!(storage.index.selections.is_empty());
    manager.snapshot().unwrap().validate().unwrap();
}

#[test]
fn new_uses_after_review_require_reviewing_the_affected_sessions_again() {
    let owner = authority("one");
    let artifact = artifact("rust", "1");
    let mut manager = manager(Default::default());
    let mut storage = FixtureStorage::default();
    install(&mut manager, &owner, &mut storage, &artifact);
    let now = Instant::now();
    let review = manager.prepare_remove(&owner, &artifact.id(), now).unwrap();
    let usage = manager
        .acquire_use(&artifact.id(), scope("two", "new-session"))
        .unwrap();
    assert_eq!(
        manager.confirm(&owner, &review.id, now).unwrap_err(),
        ManagedInstallError::StaleReview
    );
    manager.release_use(&usage).unwrap();
}

#[test]
fn rollback_and_external_artifacts_are_never_deleted_by_normal_remove() {
    let owner = authority("one");
    let mut manager = manager(Default::default());
    let mut storage = FixtureStorage::default();
    install(&mut manager, &owner, &mut storage, &artifact("rust", "1"));
    install(&mut manager, &owner, &mut storage, &artifact("rust", "2"));
    assert_eq!(
        manager
            .prepare_remove(&owner, &artifact("rust", "1").id(), Instant::now())
            .unwrap_err(),
        ManagedInstallError::ProtectedArtifact
    );
    storage.index.artifacts[1].ownership = ManagedArtifactOwnership::External;
    let mut external =
        ManagedInstallationCoordinator::restore("external".into(), storage.index).unwrap();
    assert_eq!(
        external
            .prepare_remove(&owner, &artifact("rust", "2").id(), Instant::now())
            .unwrap_err(),
        ManagedInstallError::ExternalArtifact
    );
}

#[test]
fn failed_or_cancelled_remove_keeps_the_old_installation_and_buffers_out_of_scope() {
    let owner = authority("one");
    let artifact = artifact("rust", "1");
    let mut manager = manager(Default::default());
    let mut storage = FixtureStorage::default();
    install(&mut manager, &owner, &mut storage, &artifact);
    let before = storage.index.clone();
    let now = Instant::now();
    let review = manager.prepare_remove(&owner, &artifact.id(), now).unwrap();
    let ticket = manager.confirm(&owner, &review.id, now).unwrap();
    storage.error = Some(ManagedInstallError::StorageFailed);
    assert_eq!(
        manager.complete_remove(&owner, &ticket, &mut storage),
        Err(ManagedInstallError::StorageFailed)
    );
    assert_eq!(storage.index, before);
    let review = manager.prepare_remove(&owner, &artifact.id(), now).unwrap();
    let ticket = manager.confirm(&owner, &review.id, now).unwrap();
    manager.cancel(&owner, &ticket).unwrap();
    assert_eq!(
        manager.complete_remove(&owner, &ticket, &mut storage),
        Err(ManagedInstallError::Cancelled)
    );
    assert_eq!(storage.index, before);
    assert!(manager
        .acquire_use(&artifact.id(), scope("one", "still-installed"))
        .is_ok());
}

#[test]
fn disabling_management_never_releases_live_process_uses_early() {
    let owner = authority("one");
    let artifact = artifact("rust", "1");
    let mut manager = manager(Default::default());
    let mut storage = FixtureStorage::default();
    install(&mut manager, &owner, &mut storage, &artifact);
    let usage = manager
        .acquire_use(&artifact.id(), scope("one", "session"))
        .unwrap();
    let now = Instant::now();
    let review = manager.prepare_remove(&owner, &artifact.id(), now).unwrap();
    let ticket = manager.confirm(&owner, &review.id, now).unwrap();
    let mut disabled = owner.clone();
    disabled.enabled = false;
    manager.reconcile_authority(&disabled).unwrap();
    assert!(ticket.is_cancelled());
    assert_eq!(manager.snapshot().unwrap().artifacts[0].use_count, 1);
    manager.release_use(&usage).unwrap();
    assert_eq!(manager.snapshot().unwrap().artifacts[0].use_count, 0);
}

#[test]
fn restart_discards_reviews_jobs_verification_and_uses_but_preserves_choices() {
    let owner = authority("one");
    let artifact = artifact("rust", "1");
    let mut first = manager(Default::default());
    let mut storage = FixtureStorage::default();
    install(&mut first, &owner, &mut storage, &artifact);
    let usage = first
        .acquire_use(&artifact.id(), scope("one", "session"))
        .unwrap();
    let ticket = start(&mut first, &owner, &super::tests::artifact("other", "1"));
    let mut restarted =
        ManagedInstallationCoordinator::restore("new-epoch".into(), storage.index.clone()).unwrap();
    let snapshot = restarted.snapshot().unwrap();
    assert!(snapshot.operations.is_empty());
    assert_eq!(
        snapshot.artifacts[0].verification,
        ManagedArtifactVerification::Required
    );
    assert_eq!(snapshot.artifacts[0].use_count, 0);
    assert_eq!(snapshot.selections, storage.index.selections);
    assert_eq!(
        restarted
            .acquire_use(&artifact.id(), scope("one", "new-session"))
            .unwrap_err(),
        ManagedInstallError::Unverified
    );
    assert!(restarted.release_use(&usage).is_err());
    assert!(restarted.progress(&ticket, 1).is_err());
    restarted
        .verify_existing(&artifact.id(), &proof(&artifact))
        .unwrap();
    assert!(restarted
        .acquire_use(&artifact.id(), scope("one", "new-session"))
        .is_ok());
    restarted.invalidate_artifact(&artifact.id()).unwrap();
    assert_eq!(
        restarted
            .acquire_use(&artifact.id(), scope("two", "another"))
            .unwrap_err(),
        ManagedInstallError::Unverified
    );
}

#[test]
fn uncertain_storage_closes_facts_and_new_mutations_instead_of_claiming_missing() {
    let owner = authority("one");
    let artifact = artifact("rust", "1");
    let mut manager = manager(Default::default());
    let mut storage = FixtureStorage::default();
    let ticket = start(&mut manager, &owner, &artifact);
    acquired(&mut manager, &ticket);
    storage.error = Some(ManagedInstallError::StateChanged);
    assert_eq!(
        manager.complete_install(&owner, &ticket, &proof(&artifact), &mut storage),
        Err(ManagedInstallError::StateChanged)
    );
    assert_eq!(
        manager.snapshot().unwrap_err(),
        ManagedInstallError::StateChanged
    );
    assert_eq!(
        manager
            .prepare_install(&owner, plan(artifact), Instant::now())
            .unwrap_err(),
        ManagedInstallError::StateChanged
    );
}

#[test]
fn independently_confirmed_servers_merge_into_the_latest_index_without_lost_updates() {
    let owner = authority("one");
    let mut manager = manager(Default::default());
    let mut storage = FixtureStorage::default();
    let first = artifact("one", "1");
    let second = artifact("two", "1");
    let first_ticket = start(&mut manager, &owner, &first);
    let second_ticket = start(&mut manager, &authority("two"), &second);
    acquired(&mut manager, &first_ticket);
    acquired(&mut manager, &second_ticket);
    manager
        .complete_install(&owner, &first_ticket, &proof(&first), &mut storage)
        .unwrap();
    manager
        .complete_install(
            &authority("two"),
            &second_ticket,
            &proof(&second),
            &mut storage,
        )
        .unwrap();
    assert_eq!(storage.index.artifacts.len(), 2);
    assert_eq!(storage.index.revision, 2);
}

#[test]
fn review_job_and_terminal_history_limits_never_evict_active_state() {
    let owner = authority("one");
    let now = Instant::now();
    let mut manager = manager(Default::default());
    for _ in 0..MAX_REVIEWS {
        manager
            .prepare_install(&owner, plan(artifact("one", "1")), now)
            .unwrap();
    }
    assert_eq!(
        manager
            .prepare_install(&owner, plan(artifact("one", "1")), now)
            .unwrap_err(),
        ManagedInstallError::ResourceLimit
    );
    assert!(manager
        .prepare_install(
            &owner,
            plan(artifact("one", "1")),
            now + MANAGEMENT_REVIEW_TTL + Duration::from_secs(1)
        )
        .is_ok());
    let mut manager = super::tests::manager(Default::default());
    let mut tickets = Vec::new();
    for index in 0..MAX_OPERATIONS {
        tickets.push(start(
            &mut manager,
            &owner,
            &artifact(&format!("server-{index}"), "1"),
        ));
    }
    let review = manager
        .prepare_install(&owner, plan(artifact("overflow", "1")), now)
        .unwrap();
    assert_eq!(
        manager.confirm(&owner, &review.id, now).unwrap_err(),
        ManagedInstallError::ResourceLimit
    );
    for ticket in &tickets {
        manager.cancel(&owner, ticket).unwrap();
    }
    for _ in 0..MAX_FINISHED_OPERATIONS + 5 {
        let ticket = start(&mut manager, &owner, &artifact("repeat", "1"));
        manager.cancel(&owner, &ticket).unwrap();
    }
    assert_eq!(
        manager.snapshot().unwrap().operations.len(),
        MAX_FINISHED_OPERATIONS
    );
    manager.snapshot().unwrap().validate().unwrap();
}

#[test]
fn lease_limit_and_cross_coordinator_token_identity_are_enforced() {
    let owner = authority("one");
    let artifact = artifact("rust", "1");
    let mut first = manager(Default::default());
    let mut storage = FixtureStorage::default();
    install(&mut first, &owner, &mut storage, &artifact);
    let mut leases = Vec::new();
    for n in 0..MAX_USES {
        leases.push(
            first
                .acquire_use(&artifact.id(), scope("one", &format!("session-{n}")))
                .unwrap(),
        );
    }
    assert_eq!(
        first
            .acquire_use(&artifact.id(), scope("one", "overflow"))
            .unwrap_err(),
        ManagedInstallError::ResourceLimit
    );
    assert_eq!(
        first.snapshot().unwrap().artifacts[0].use_count,
        MAX_USES as u32
    );
    let mut second = manager(storage.index);
    second
        .verify_existing(&artifact.id(), &proof(&artifact))
        .unwrap();
    let foreign = second
        .acquire_use(&artifact.id(), scope("one", "foreign"))
        .unwrap();
    assert!(first.release_use(&foreign).is_err());
    first.release_use(&leases[0]).unwrap();
    assert!(first.release_use(&leases[0]).is_err());
}

#[test]
fn durable_index_rejects_changed_identity_duplicate_and_foreign_selections() {
    let first = artifact("rust", "1");
    let second = artifact("other", "1");
    let index = ManagedInstallationIndex {
        schema_version: 1,
        revision: 2,
        artifacts: vec![
            ManagedInstalledArtifact {
                id: first.id(),
                identity: first.clone(),
                ownership: ManagedArtifactOwnership::Managed,
            },
            ManagedInstalledArtifact {
                id: second.id(),
                identity: second.clone(),
                ownership: ManagedArtifactOwnership::Managed,
            },
        ],
        selections: vec![ManagedServerSelection {
            server: first.server.clone(),
            current: Some(first.id()),
            rollback: None,
        }],
    };
    index.validate().unwrap();
    let mut invalid = index.clone();
    invalid.artifacts[0].identity.recipe_digest = hash("changed");
    assert!(invalid.validate().is_err());
    let mut invalid = index.clone();
    invalid.artifacts.push(invalid.artifacts[0].clone());
    assert!(invalid.validate().is_err());
    let mut invalid = index.clone();
    invalid.selections[0].rollback = Some(second.id());
    assert!(invalid.validate().is_err());
    let mut invalid = index.clone();
    invalid.selections[0].rollback = Some(first.id());
    assert!(invalid.validate().is_err());
    let mut invalid = index.clone();
    invalid.revision = MAX_SAFE_INTEGER + 1;
    assert!(invalid.validate().is_err());
    let mut invalid = index;
    invalid.schema_version = 2;
    assert_eq!(
        invalid.validate(),
        Err(ManagedInstallError::UnsupportedSchema)
    );
}

#[test]
fn byte_bounds_and_last_artifact_capacity_are_checked_again_at_commit() {
    let owner = authority("one");
    let mut manager = manager(Default::default());
    for (download_bytes, expanded_bytes) in [
        (0, 1),
        (MAX_DOWNLOAD_BYTES + 1, 1),
        (1, 0),
        (1, MAX_EXPANDED_BYTES + 1),
    ] {
        assert_eq!(
            manager
                .prepare_install(
                    &owner,
                    ManagedInstallPlan {
                        artifact: artifact("rust", "1"),
                        download_bytes,
                        expanded_bytes
                    },
                    Instant::now()
                )
                .unwrap_err(),
            ManagedInstallError::ResourceLimit
        );
    }
    let mut storage = FixtureStorage::default();
    for n in 0..MAX_ARTIFACTS - 1 {
        install(
            &mut manager,
            &owner,
            &mut storage,
            &artifact(&format!("server-{n}"), "1"),
        );
    }
    let first = artifact("last", "1");
    let second = artifact("overflow", "1");
    let first_ticket = start(&mut manager, &owner, &first);
    let second_ticket = start(&mut manager, &owner, &second);
    acquired(&mut manager, &first_ticket);
    acquired(&mut manager, &second_ticket);
    manager
        .complete_install(&owner, &first_ticket, &proof(&first), &mut storage)
        .unwrap();
    assert_eq!(
        manager.complete_install(&owner, &second_ticket, &proof(&second), &mut storage),
        Err(ManagedInstallError::ResourceLimit)
    );
    assert!(second_ticket.is_cancelled());
    assert_eq!(storage.index.artifacts.len(), MAX_ARTIFACTS);
    manager.snapshot().unwrap().validate().unwrap();
}

#[test]
fn install_after_current_removal_keeps_the_existing_rollback() {
    let (mut manager, mut storage, owner) = (
        manager(Default::default()),
        FixtureStorage::default(),
        authority("one"),
    );
    let first = artifact("rust", "1");
    let second = artifact("rust", "2");
    install(&mut manager, &owner, &mut storage, &first);
    install(&mut manager, &owner, &mut storage, &second);
    let now = Instant::now();
    let review = manager.prepare_remove(&owner, &second.id(), now).unwrap();
    let ticket = manager.confirm(&owner, &review.id, now).unwrap();
    manager
        .complete_remove(&owner, &ticket, &mut storage)
        .unwrap();
    install(&mut manager, &owner, &mut storage, &artifact("rust", "3"));
    assert_eq!(storage.index.selections[0].rollback, Some(first.id()));
    assert_eq!(
        manager
            .prepare_remove(&owner, &first.id(), now)
            .unwrap_err(),
        ManagedInstallError::ProtectedArtifact
    );
}

#[test]
fn native_and_frontend_share_snapshot_contract_cases() {
    let corpus: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../protocol/fixtures/managed-language-installation.json"
    ))
    .unwrap();
    for case in corpus["cases"].as_array().unwrap() {
        let mut value = corpus["base"].clone();
        for edit in case["edits"].as_array().unwrap() {
            let (parent, key) = edit["path"].as_str().unwrap().rsplit_once('/').unwrap();
            let target = value.pointer_mut(parent).unwrap();
            if let Some(items) = target.as_array_mut() {
                items[key.parse::<usize>().unwrap()] = edit["value"].clone();
            } else {
                target
                    .as_object_mut()
                    .unwrap()
                    .insert(key.into(), edit["value"].clone());
            }
        }
        let accepted = serde_json::from_value::<ManagedInstallationSnapshot>(value)
            .is_ok_and(|snapshot| snapshot.validate().is_ok());
        assert_eq!(
            accepted,
            case["valid"].as_bool().unwrap(),
            "{}",
            case["name"]
        );
    }
}

#[test]
fn exhausted_index_revision_fails_the_job_without_touching_storage() {
    let index = ManagedInstallationIndex {
        revision: MAX_SAFE_INTEGER,
        ..Default::default()
    };
    let mut manager = manager(index.clone());
    let mut storage = FixtureStorage {
        index,
        ..Default::default()
    };
    let owner = authority("one");
    let artifact = artifact("rust", "1");
    let ticket = start(&mut manager, &owner, &artifact);
    acquired(&mut manager, &ticket);
    assert_eq!(
        manager.complete_install(&owner, &ticket, &proof(&artifact), &mut storage),
        Err(ManagedInstallError::ResourceLimit)
    );
    assert!(ticket.is_cancelled());
    assert_eq!(storage.commits, 0);
    assert_eq!(
        manager.snapshot().unwrap().operations[0].phase,
        ManagedOperationPhase::Failed
    );
}
