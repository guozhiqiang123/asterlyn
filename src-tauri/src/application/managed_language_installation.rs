use asterlyn_language_service::management::{
    ManagedInstallError, ManagedInstallationCoordinator, ManagedInstallationIndexStore,
    ManagedInstallationSnapshot,
};
use serde::Serialize;
use std::{
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const STORE_DIRECTORY: &str = "managed-language-tools-v1";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedLanguageEnvironment {
    protocol_version: u32,
    platform: &'static str,
    target: &'static str,
    installation: ManagedInstallationSnapshot,
}

pub(crate) struct ManagedLanguageInstallationState {
    state: ManagedLanguageInstallationAvailability,
}

enum ManagedLanguageInstallationAvailability {
    Available {
        coordinator: Box<Mutex<ManagedInstallationCoordinator>>,
        _store: ManagedInstallationIndexStore,
        platform: &'static str,
        target: &'static str,
    },
    Unavailable(ManagedInstallError),
}

impl ManagedLanguageInstallationState {
    pub(crate) fn open(app: &tauri::AppHandle) -> Self {
        Self {
            state: Self::open_available(app)
                .unwrap_or_else(ManagedLanguageInstallationAvailability::Unavailable),
        }
    }

    fn open_available(
        app: &tauri::AppHandle,
    ) -> Result<ManagedLanguageInstallationAvailability, ManagedInstallError> {
        let root = app
            .path()
            .app_local_data_dir()
            .map_err(|_| ManagedInstallError::StorageFailed)?
            .join(STORE_DIRECTORY);
        let store = ManagedInstallationIndexStore::new(root);
        let index = store.load()?;
        let (platform, target) = native_environment(std::env::consts::OS, std::env::consts::ARCH)
            .ok_or(ManagedInstallError::InvalidRequest)?;
        let epoch = format!(
            "host-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        );
        let coordinator = ManagedInstallationCoordinator::restore(epoch, index)?;
        Ok(ManagedLanguageInstallationAvailability::Available {
            coordinator: Box::new(Mutex::new(coordinator)),
            _store: store,
            platform,
            target,
        })
    }

    pub(crate) fn environment(&self) -> Result<ManagedLanguageEnvironment, ManagedInstallError> {
        match &self.state {
            ManagedLanguageInstallationAvailability::Available {
                coordinator,
                platform,
                target,
                ..
            } => {
                let installation = coordinator
                    .lock()
                    .map_err(|_| ManagedInstallError::StorageFailed)?
                    .snapshot()?;
                Ok(ManagedLanguageEnvironment {
                    protocol_version: 1,
                    platform,
                    target,
                    installation,
                })
            }
            ManagedLanguageInstallationAvailability::Unavailable(error) => Err(*error),
        }
    }
}

fn native_environment(os: &str, architecture: &str) -> Option<(&'static str, &'static str)> {
    match (os, architecture) {
        ("macos", "aarch64") => Some(("macos-arm64", "aarch64-apple-darwin")),
        ("macos", "x86_64") => Some(("macos-x64", "x86_64-apple-darwin")),
        ("linux", "aarch64") => Some(("linux-arm64", "aarch64-unknown-linux-gnu")),
        ("linux", "x86_64") => Some(("linux-x64", "x86_64-unknown-linux-gnu")),
        ("windows", "aarch64") => Some(("windows-arm64", "aarch64-pc-windows-msvc")),
        ("windows", "x86_64") => Some(("windows-x64", "x86_64-pc-windows-msvc")),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ManagedInstallError, ManagedLanguageInstallationAvailability,
        ManagedLanguageInstallationState, native_environment,
    };

    #[test]
    fn maps_only_catalog_supported_native_targets() {
        assert_eq!(
            native_environment("macos", "aarch64"),
            Some(("macos-arm64", "aarch64-apple-darwin"))
        );
        assert_eq!(
            native_environment("windows", "x86_64"),
            Some(("windows-x64", "x86_64-pc-windows-msvc"))
        );
        assert_eq!(native_environment("freebsd", "x86_64"), None);
        assert_eq!(native_environment("linux", "riscv64"), None);
    }

    #[test]
    fn unavailable_installation_facts_do_not_require_a_coordinator() {
        let state = ManagedLanguageInstallationState {
            state: ManagedLanguageInstallationAvailability::Unavailable(
                ManagedInstallError::StorageFailed,
            ),
        };
        assert_eq!(
            state.environment().unwrap_err(),
            ManagedInstallError::StorageFailed
        );
    }
}
