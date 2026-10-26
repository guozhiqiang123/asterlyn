use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use asterlyn_language_service::{LanguageServiceProcess, TypeScriptServerProfile};

pub(crate) struct LanguageServiceManager {
    sessions: Mutex<HashMap<String, LanguageServiceProcess>>,
    reviews: Mutex<HashMap<String, String>>,
}

impl Default for LanguageServiceManager {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            reviews: Mutex::new(HashMap::new()),
        }
    }
}

impl LanguageServiceManager {
    pub(crate) fn start(
        &self,
        session_id: String,
        profile: TypeScriptServerProfile,
    ) -> Result<(), String> {
        let process =
            LanguageServiceProcess::start(&profile).map_err(|error| format!("{error:?}"))?;
        self.sessions
            .lock()
            .map_err(|_| "language service lock poisoned".to_owned())?
            .insert(session_id, process);
        Ok(())
    }
    pub(crate) fn review(&self, id: String, workspace: String) -> Result<(), String> {
        self.reviews
            .lock()
            .map_err(|_| "language service lock poisoned".to_owned())?
            .insert(id, workspace);
        Ok(())
    }
    pub(crate) fn consume_review(&self, id: &str, workspace: &str) -> Result<(), String> {
        let mut reviews = self
            .reviews
            .lock()
            .map_err(|_| "language service lock poisoned".to_owned())?;
        if reviews.get(id).map(String::as_str) != Some(workspace) {
            return Err("language-service review is invalid or expired".into());
        }
        reviews.remove(id);
        Ok(())
    }
    pub(crate) fn with<F, T>(&self, id: &str, callback: F) -> Result<T, String>
    where
        F: FnOnce(&mut LanguageServiceProcess) -> Result<T, String>,
    {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "language service lock poisoned".to_owned())?;
        let process = sessions
            .get_mut(id)
            .ok_or_else(|| "unknown language-service session".to_owned())?;
        callback(process)
    }
    pub(crate) fn stop(&self, id: &str) -> Result<bool, String> {
        let Some(mut process) = self
            .sessions
            .lock()
            .map_err(|_| "language service lock poisoned".to_owned())?
            .remove(id)
        else {
            return Ok(false);
        };
        process.stop().map_err(|error| format!("{error:?}"))?;
        Ok(true)
    }
}

pub(crate) fn package_profile(app_data: PathBuf) -> TypeScriptServerProfile {
    TypeScriptServerProfile {
        package_root: app_data.join("plugins/dev.asterlyn.lsp/0.1.0"),
        node: PathBuf::from("/usr/bin/node"),
    }
}
