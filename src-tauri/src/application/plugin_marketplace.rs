use std::collections::HashMap;
use std::path::PathBuf;

use asterlyn_plugin_package::AdmissionReport;

#[derive(Debug, Clone)]
pub(crate) struct PendingPluginAdmission {
    pub(crate) token: String,
    pub(crate) repository: String,
    pub(crate) source_generation: u64,
    pub(crate) version: String,
    pub(crate) asset_name: String,
    pub(crate) asset_size_bytes: u64,
    pub(crate) digest: String,
    pub(crate) staging_path: PathBuf,
    pub(crate) report: AdmissionReport,
}

#[derive(Default)]
pub(crate) struct PluginMarketplaceCoordinator {
    operation: std::sync::Mutex<()>,
    admissions: std::sync::Mutex<HashMap<String, PendingPluginAdmission>>,
}

impl PluginMarketplaceCoordinator {
    pub(crate) fn run<T>(
        &self,
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| "plugin marketplace coordinator is unavailable".to_string())?;
        operation()
    }

    pub(crate) fn insert_admission(&self, admission: PendingPluginAdmission) -> Result<(), String> {
        let mut admissions = self
            .admissions
            .lock()
            .map_err(|_| "plugin admission registry is unavailable".to_string())?;
        if admissions.len() >= 8 {
            return Err("Finish or cancel an existing plugin review first.".into());
        }
        admissions.insert(admission.token.clone(), admission);
        Ok(())
    }

    pub(crate) fn take_admission(&self, token: &str) -> Result<PendingPluginAdmission, String> {
        self.admissions
            .lock()
            .map_err(|_| "plugin admission registry is unavailable".to_string())?
            .remove(token)
            .ok_or_else(|| {
                "Plugin review expired; download and inspect the package again.".to_string()
            })
    }

    pub(crate) fn cancel_admission(
        &self,
        token: &str,
    ) -> Result<Option<PendingPluginAdmission>, String> {
        Ok(self
            .admissions
            .lock()
            .map_err(|_| "plugin admission registry is unavailable".to_string())?
            .remove(token))
    }
}
