#[derive(Default)]
pub(crate) struct PluginMarketplaceCoordinator {
    operation: std::sync::Mutex<()>,
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
}
