use super::*;
use asterlyn_process::configure_process_group;
use std::path::Path;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PackagedServerProfile {
    pub id: String,
    pub node: PathBuf,
    pub package_root: PathBuf,
    pub entry: String,
    pub initialization_options: Value,
    pub selectors: Vec<(String, Vec<String>)>,
    pub cache_parent: PathBuf,
}
impl PackagedServerProfile {
    pub fn validate(&self) -> Result<(), SessionError> {
        if self.id.is_empty()
            || self.id.len() > 128
            || self.entry.len() > 512
            || !self.entry.ends_with(".mjs")
            || self.entry.contains(['\\', ':', '\0'])
            || self
                .entry
                .split('/')
                .any(|part| part.is_empty() || matches!(part, "." | ".."))
            || self.selectors.is_empty()
            || self.selectors.len() > 16
        {
            return Err(SessionError::InvalidMessage(
                "invalid packaged language profile".into(),
            ));
        }
        let root = self
            .package_root
            .canonicalize()
            .map_err(|_| SessionError::Process("language package unavailable".into()))?;
        let file = root.join(&self.entry);
        let canonical = file
            .canonicalize()
            .map_err(|_| SessionError::Process("language entry unavailable".into()))?;
        if canonical != file
            || !canonical.starts_with(&root)
            || !canonical.is_file()
            || !self.node.is_file()
            || serde_json::to_vec(&self.initialization_options)
                .map_err(|_| SessionError::InvalidMessage("invalid language options".into()))?
                .len()
                > 65536
        {
            return Err(SessionError::InvalidMessage(
                "packaged language resource or options changed".into(),
            ));
        }
        Ok(())
    }
    pub fn language_for_path(&self, path: &Path) -> Option<&str> {
        let name = path.file_name()?.to_str()?;
        self.selectors
            .iter()
            .flat_map(|(language, extensions)| {
                extensions
                    .iter()
                    .map(move |extension| (language, extension))
            })
            .filter(|(_, extension)| name.ends_with(extension.as_str()))
            .max_by_key(|(_, extension)| extension.len())
            .map(|(language, _)| language.as_str())
    }
}
impl LanguageServiceProcess {
    pub fn start_packaged(profile: &PackagedServerProfile) -> Result<Self, SessionError> {
        profile.validate()?;
        let mut command = Command::new(&profile.node);
        command.env_clear();
        for key in ["HOME", "USERPROFILE", "TMPDIR", "TEMP", "SystemRoot"] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        if let Some(parent) = profile.node.parent() {
            command.env("PATH", parent);
        }
        configure_process_group(&mut command);
        command
            .arg(profile.package_root.join(&profile.entry))
            .current_dir(&profile.package_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        Self::spawn_command(command, "packaged", profile.initialization_options.clone())
    }
    pub fn reply_to_server(
        &mut self,
        id: JsonRpcId,
        result: Result<Value, String>,
    ) -> Result<(), SessionError> {
        let reply = match result {
            Ok(value) => serde_json::json!({"jsonrpc":"2.0","id":id,"result":value}),
            Err(_) => {
                serde_json::json!({"jsonrpc":"2.0","id":id,"error":{"code":-32603,"message":"The reviewed workspace model could not be prepared."}})
            }
        };
        let bytes = serde_json::to_vec(&reply)
            .map_err(|_| SessionError::InvalidMessage("invalid model reply".into()))?;
        if bytes.len() > 65536 {
            return Err(SessionError::InvalidMessage(
                "model reference reply exceeds its bound".into(),
            ));
        }
        write_frame(self.session.writer_mut(), &bytes)
            .map_err(|_| SessionError::Process("language model reply failed".into()))
    }
}
