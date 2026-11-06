use super::*;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
    time::Instant,
};

/// Native owner for reviewed managed-language installation work. It is safe to
/// clone into a blocking worker; plugin and renderer callers never receive it.
#[derive(Clone)]
pub struct ManagedInstallationExecutor {
    root: PathBuf,
    coordinator: Arc<Mutex<ManagedInstallationCoordinator>>,
}

impl ManagedInstallationExecutor {
    /// Recover the private content/index transaction before exposing a snapshot.
    pub fn open(root: PathBuf, epoch: String) -> Result<Self, ManagedInstallError> {
        let mut store = ManagedInstallationContentStore::new(root.clone());
        let index = store.load_and_recover()?;
        let coordinator = ManagedInstallationCoordinator::restore(epoch, index)?;
        Ok(Self {
            root,
            coordinator: Arc::new(Mutex::new(coordinator)),
        })
    }

    pub fn snapshot(&self) -> Result<ManagedInstallationSnapshot, ManagedInstallError> {
        self.lock()?.snapshot()
    }

    pub fn prepare_install(
        &self,
        authority: &ManagementAuthority,
        recipe: &ManagedInstallRecipe,
        now: Instant,
    ) -> Result<ManagedInstallReview, ManagedInstallError> {
        self.lock()?.prepare_install(authority, recipe.plan(), now)
    }

    pub fn prepare_remove(
        &self,
        authority: &ManagementAuthority,
        artifact_id: &str,
        now: Instant,
    ) -> Result<ManagedInstallReview, ManagedInstallError> {
        self.lock()?.prepare_remove(authority, artifact_id, now)
    }

    pub fn confirm(
        &self,
        authority: &ManagementAuthority,
        review_id: &str,
        now: Instant,
    ) -> Result<ManagedOperationTicket, ManagedInstallError> {
        self.lock()?.confirm(authority, review_id, now)
    }

    pub fn cancel(
        &self,
        authority: &ManagementAuthority,
        ticket: &ManagedOperationTicket,
    ) -> Result<(), ManagedInstallError> {
        self.lock()?.cancel(authority, ticket)
    }

    /// Blocking production path. The host must call this from a bounded worker
    /// after `confirm`; it performs no UI or plugin callbacks itself.
    pub fn execute_confirmed_install_blocking(
        &self,
        authority: &ManagementAuthority,
        ticket: &ManagedOperationTicket,
        recipe: &ManagedInstallRecipe,
    ) -> Result<ManagedContentInventory, ManagedInstallError> {
        let artifact = recipe.artifact();
        let extraction = recipe.extraction();
        self.execute_confirmed_install_with(
            authority,
            ticket,
            artifact,
            extraction,
            |store, is_cancelled, progress| {
                download_and_stage_managed_archive_blocking(
                    store,
                    artifact,
                    extraction,
                    recipe.policy(),
                    is_cancelled,
                    progress,
                )
            },
        )
    }

    /// Complete a confirmed removal when no use lease remains. `InUse` leaves
    /// the operation waiting so a host scheduler can retry after lease release.
    pub fn execute_confirmed_remove_blocking(
        &self,
        authority: &ManagementAuthority,
        ticket: &ManagedOperationTicket,
    ) -> Result<(), ManagedInstallError> {
        let mut store = ManagedInstallationContentStore::new(self.root.clone());
        let result = self.lock()?.complete_remove(authority, ticket, &mut store);
        match result {
            Ok(()) => Ok(()),
            Err(ManagedInstallError::InUse) => Err(ManagedInstallError::InUse),
            Err(error) => self.record_failure(ticket, error),
        }
    }

    fn execute_confirmed_install_with<F>(
        &self,
        authority: &ManagementAuthority,
        ticket: &ManagedOperationTicket,
        artifact: &ManagedArtifact,
        extraction: &ManagedArchiveExtraction,
        acquire: F,
    ) -> Result<ManagedContentInventory, ManagedInstallError>
    where
        F: FnOnce(
            &mut ManagedInstallationContentStore,
            &mut dyn FnMut() -> bool,
            &mut dyn FnMut(u64) -> Result<(), ManagedInstallError>,
        ) -> Result<ManagedContentInventory, ManagedInstallError>,
    {
        if let Err(error) = artifact.validate().and_then(|()| extraction.validate()) {
            return self.record_failure(ticket, error);
        }
        let validation = {
            self.lock()?.validate_install_execution(
                ticket,
                artifact,
                extraction.download_bytes,
                extraction.expanded_bytes,
            )
        };
        if let Err(error) = validation {
            return self.record_failure(ticket, error);
        }

        let mut store = ManagedInstallationContentStore::new(self.root.clone());
        let mut verification_started = false;
        let mut is_cancelled = || ticket.is_cancelled();
        let mut progress = |completed_bytes| {
            let mut coordinator = self.lock()?;
            coordinator.progress(ticket, completed_bytes)?;
            if completed_bytes == extraction.download_bytes {
                coordinator.begin_verification(ticket)?;
                verification_started = true;
            }
            Ok(())
        };
        let acquired = acquire(&mut store, &mut is_cancelled, &mut progress);
        let inventory = match acquired {
            Ok(inventory) if verification_started => inventory,
            Ok(_) => {
                return self.record_failure(ticket, ManagedInstallError::InvalidTransition);
            }
            Err(error) => return self.record_failure(ticket, error),
        };
        if ticket.is_cancelled() {
            return Err(ManagedInstallError::Cancelled);
        }

        let verified = match verify_managed_artifact(artifact, &mut store) {
            Ok(verified) => verified,
            Err(error) => return self.record_failure(ticket, error),
        };
        let result = self
            .lock()?
            .complete_install(authority, ticket, &verified, &mut store);
        match result {
            Ok(()) => Ok(inventory),
            Err(error) => self.record_failure(ticket, error),
        }
    }

    fn record_failure<T>(
        &self,
        ticket: &ManagedOperationTicket,
        error: ManagedInstallError,
    ) -> Result<T, ManagedInstallError> {
        let _ = self.lock()?.fail(ticket, error);
        Err(error)
    }

    fn lock(&self) -> Result<MutexGuard<'_, ManagedInstallationCoordinator>, ManagedInstallError> {
        self.coordinator
            .lock()
            .map_err(|_| ManagedInstallError::StorageFailed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{Compression, write::GzEncoder};
    use sha2::{Digest, Sha256};
    use std::{fs, io::Cursor, io::Write};

    fn hash(bytes: &[u8]) -> String {
        format!("sha256:{:x}", Sha256::digest(bytes))
    }

    fn authority() -> ManagementAuthority {
        ManagementAuthority {
            window_id: "window-one".into(),
            activation: 1,
            plugin_id: "dev.example.lsp".into(),
            plugin_version: "1.0.0".into(),
            package_digest: hash(b"plugin"),
            enabled: true,
            may_manage: true,
        }
    }

    struct Fixture {
        _directory: tempfile::TempDir,
        executor: ManagedInstallationExecutor,
        authority: ManagementAuthority,
        ticket: ManagedOperationTicket,
        artifact: ManagedArtifact,
        extraction: ManagedArchiveExtraction,
        archive: Vec<u8>,
        root: PathBuf,
    }

    fn fixture() -> Fixture {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("managed-language");
        let payload = b"managed server";
        let source = directory.path().join("source");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("server"), payload).unwrap();
        let content = inventory_managed_content(&source, payload.len() as u64).unwrap();
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(payload).unwrap();
        let archive = encoder.finish().unwrap();
        let mut recipe_spec = ManagedInstallRecipeSpec {
            schema_version: MANAGED_INSTALL_RECIPE_SCHEMA_VERSION,
            server: ManagedServerId {
                plugin_id: "dev.example.lsp".into(),
                server_id: "fixture".into(),
            },
            version: "1.0.0".into(),
            target: "aarch64-apple-darwin".into(),
            recipe_digest: hash(b"placeholder"),
            archive_digest: hash(&archive),
            content_digest: content.digest,
            source: "https://downloads.example.com/server.gz".into(),
            allowed_redirect_origins: vec![],
            format: ManagedArchiveFormat::Gzip {
                output_path: "server".into(),
                executable: false,
            },
            download_bytes: archive.len() as u64,
            expanded_bytes: payload.len() as u64,
            license: ManagedRecipeLicense {
                expression: "MIT".into(),
                notice_url: "https://github.com/example/server/blob/v1/LICENSE".into(),
                notice_digest: hash(b"license"),
            },
        };
        recipe_spec.recipe_digest = recipe_spec.calculated_digest().unwrap();
        let recipe = recipe_spec.admit().unwrap();
        let artifact = recipe.artifact().clone();
        let extraction = recipe.extraction().clone();
        let authority = authority();
        let executor =
            ManagedInstallationExecutor::open(root.clone(), "fixture-epoch".into()).unwrap();
        let now = Instant::now();
        let review = executor.prepare_install(&authority, &recipe, now).unwrap();
        let ticket = executor.confirm(&authority, &review.id, now).unwrap();
        Fixture {
            _directory: directory,
            executor,
            authority,
            ticket,
            artifact,
            extraction,
            archive,
            root,
        }
    }

    #[test]
    fn confirmed_install_streams_verifies_and_commits_as_one_host_transaction() {
        let fixture = fixture();
        let inventory = fixture
            .executor
            .execute_confirmed_install_with(
                &fixture.authority,
                &fixture.ticket,
                &fixture.artifact,
                &fixture.extraction,
                |store, is_cancelled, progress| {
                    store.stage_archive_stream(
                        &fixture.artifact,
                        &fixture.extraction,
                        &mut Cursor::new(&fixture.archive),
                        is_cancelled,
                        progress,
                    )
                },
            )
            .unwrap();
        assert_eq!(inventory.digest, fixture.artifact.content_digest);
        let snapshot = fixture.executor.snapshot().unwrap();
        assert_eq!(snapshot.index_revision, 1);
        assert_eq!(snapshot.artifacts.len(), 1);
        assert_eq!(
            snapshot.operations[0].phase,
            ManagedOperationPhase::Completed
        );
        let content = ManagedInstallationContentStore::new(fixture.root)
            .artifact_path(&fixture.artifact.id())
            .unwrap();
        assert!(content.join("server").is_file());

        let now = Instant::now();
        let review = fixture
            .executor
            .prepare_remove(&fixture.authority, &fixture.artifact.id(), now)
            .unwrap();
        let removal = fixture
            .executor
            .confirm(&fixture.authority, &review.id, now)
            .unwrap();
        fixture
            .executor
            .execute_confirmed_remove_blocking(&fixture.authority, &removal)
            .unwrap();
        let snapshot = fixture.executor.snapshot().unwrap();
        assert_eq!(snapshot.index_revision, 2);
        assert!(snapshot.artifacts.is_empty());
        assert!(!content.exists());
    }

    #[test]
    fn acquisition_failure_is_terminal_and_preserves_the_empty_index() {
        let fixture = fixture();
        assert_eq!(
            fixture.executor.execute_confirmed_install_with(
                &fixture.authority,
                &fixture.ticket,
                &fixture.artifact,
                &fixture.extraction,
                |_, _, progress| {
                    progress(fixture.extraction.download_bytes)?;
                    Err(ManagedInstallError::IntegrityMismatch)
                },
            ),
            Err(ManagedInstallError::IntegrityMismatch)
        );
        let snapshot = fixture.executor.snapshot().unwrap();
        assert!(snapshot.artifacts.is_empty());
        assert_eq!(snapshot.index_revision, 0);
        assert_eq!(snapshot.operations[0].phase, ManagedOperationPhase::Failed);
        assert_eq!(
            snapshot.operations[0].failure,
            Some(ManagedInstallError::IntegrityMismatch)
        );
    }

    #[test]
    fn confirmed_sizes_are_rechecked_before_acquisition_and_cancel_stays_terminal() {
        let mut mismatched = fixture();
        mismatched.extraction.expanded_bytes += 1;
        assert_eq!(
            mismatched.executor.execute_confirmed_install_with(
                &mismatched.authority,
                &mismatched.ticket,
                &mismatched.artifact,
                &mismatched.extraction,
                |_, _, _| panic!("acquisition must not start"),
            ),
            Err(ManagedInstallError::InvalidTransition)
        );
        assert_eq!(
            mismatched.executor.snapshot().unwrap().operations[0].phase,
            ManagedOperationPhase::Failed
        );

        let fixture = fixture();
        fixture
            .executor
            .cancel(&fixture.authority, &fixture.ticket)
            .unwrap();
        assert_eq!(
            fixture.executor.execute_confirmed_install_with(
                &fixture.authority,
                &fixture.ticket,
                &fixture.artifact,
                &fixture.extraction,
                |_, _, _| panic!("cancelled acquisition must not start"),
            ),
            Err(ManagedInstallError::Cancelled)
        );
        assert_eq!(
            fixture.executor.snapshot().unwrap().operations[0].phase,
            ManagedOperationPhase::Cancelled
        );
    }
}
