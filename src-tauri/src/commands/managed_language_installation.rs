use asterlyn_language_service::management::ManagedInstallError;
use tauri::State;

use crate::application::{ManagedLanguageEnvironment, ManagedLanguageInstallationState};

#[tauri::command]
pub(crate) fn read_managed_language_environment(
    state: State<'_, ManagedLanguageInstallationState>,
) -> Result<ManagedLanguageEnvironment, ManagedInstallError> {
    state.environment()
}
