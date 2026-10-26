use crate::{LanguageServiceProcess, SessionError};
use std::{
    path::PathBuf,
    process::{Command, Stdio},
};

/// Constructed only by the host's reviewed, fixed-toolchain resolver; never by plugin argv.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RustServerProfile {
    pub analyzer: PathBuf,
    pub cargo: PathBuf,
    pub rustc: PathBuf,
    pub sysroot: PathBuf,
    pub rust_src: PathBuf,
    pub workspace: PathBuf,
}
impl RustServerProfile {
    pub fn validate(&self) -> Result<(), SessionError> {
        for file in [&self.analyzer, &self.cargo, &self.rustc] {
            if !file.is_absolute() || !file.is_file() {
                return Err(SessionError::Process(
                    "Rust toolchain executable missing".into(),
                ));
            }
        }
        if !self.workspace.is_absolute()
            || !self.workspace.join("Cargo.toml").is_file()
            || !self.rust_src.join("core/src/lib.rs").is_file()
        {
            return Err(SessionError::Process(
                "Rust Cargo workspace or rust-src is missing".into(),
            ));
        }
        Ok(())
    }
}
impl LanguageServiceProcess {
    pub fn start_rust(profile: &RustServerProfile) -> Result<Self, SessionError> {
        profile.validate()?;
        let mut command = Command::new(&profile.analyzer);
        command.env_clear();
        for key in ["HOME", "USERPROFILE", "TMPDIR", "TEMP", "SystemRoot"] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        let bin = profile
            .cargo
            .parent()
            .ok_or_else(|| SessionError::Process("Rust bin directory missing".into()))?;
        let mut paths = vec![bin.to_path_buf()];
        #[cfg(unix)]
        paths.extend([PathBuf::from("/usr/bin"), PathBuf::from("/bin")]);
        command
            .env(
                "PATH",
                std::env::join_paths(paths)
                    .map_err(|_| SessionError::Process("Rust PATH invalid".into()))?,
            )
            .env("RUSTC", &profile.rustc)
            .env("CARGO", &profile.cargo)
            .env(
                "RUSTUP_TOOLCHAIN",
                profile.sysroot.file_name().unwrap_or_default(),
            )
            .env("RUSTUP_AUTO_INSTALL", "0")
            .env("CARGO_NET_OFFLINE", "true")
            .env("RUSTC_WRAPPER", "")
            .env("RUSTC_WORKSPACE_WRAPPER", "")
            .current_dir(&profile.workspace)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let options = serde_json::json!({
            "cargo": {"buildScripts":{"enable":false},"autoreload":true,"extraArgs":["--offline","--locked"],"sysroot":profile.sysroot,"sysrootSrc":profile.rust_src},
            "procMacro":{"enable":false},"completion":{"autoimport":{"enable":false},"limit":200,"callable":{"snippets":"none"}},"checkOnSave":false,"cachePriming":{"enable":false},"numThreads":2,
            "linkedProjects":[profile.workspace.join("Cargo.toml")]
        });
        Self::spawn_command(command, "rust-analyzer", options)
    }
}
