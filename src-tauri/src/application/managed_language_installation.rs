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
    coordinator: Mutex<ManagedInstallationCoordinator>,
    _store: ManagedInstallationIndexStore,
    platform: &'static str,
    target: &'static str,
}

impl ManagedLanguageInstallationState {
    pub(crate) fn open(app: &tauri::AppHandle) -> Result<Self, ManagedInstallError> {
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
        Ok(Self {
            coordinator: Mutex::new(coordinator),
            _store: store,
            platform,
            target,
        })
    }

    pub(crate) fn environment(&self) -> Result<ManagedLanguageEnvironment, ManagedInstallError> {
        let installation = self
            .coordinator
            .lock()
            .map_err(|_| ManagedInstallError::StorageFailed)?
            .snapshot()?;
        Ok(ManagedLanguageEnvironment {
            protocol_version: 1,
            platform: self.platform,
            target: self.target,
            installation,
        })
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
    use super::native_environment;

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
}
