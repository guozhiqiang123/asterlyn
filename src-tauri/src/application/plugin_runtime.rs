use std::path::{Path, PathBuf};

use asterlyn_plugin_runtime::{PluginHostSupervisor, PluginRuntimeError};

pub(crate) fn build_plugin_host_supervisor() -> Result<PluginHostSupervisor, PluginRuntimeError> {
    let current_executable = std::env::current_exe().map_err(|error| {
        PluginRuntimeError::InvalidConfiguration(format!(
            "resolve current application executable: {error}"
        ))
    })?;
    #[cfg(debug_assertions)]
    let development_binaries = Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries"));
    #[cfg(not(debug_assertions))]
    let development_binaries: Option<PathBuf> = None;
    let helper = resolve_plugin_host_helper(&current_executable, development_binaries.as_deref())?;
    let installation_root = helper.parent().ok_or_else(|| {
        PluginRuntimeError::InvalidConfiguration(
            "plugin helper has no installation directory".to_owned(),
        )
    })?;
    PluginHostSupervisor::from_verified_helper(&helper, installation_root)
}

fn resolve_plugin_host_helper(
    current_executable: &Path,
    development_binaries: Option<&Path>,
) -> Result<PathBuf, PluginRuntimeError> {
    let application_directory = current_executable.parent().ok_or_else(|| {
        PluginRuntimeError::InvalidConfiguration(
            "application executable has no installation directory".to_owned(),
        )
    })?;
    let packaged = application_directory.join(packaged_helper_name());
    if packaged.is_file() {
        return Ok(packaged);
    }
    if let Some(development_binaries) = development_binaries {
        let development = development_binaries.join(development_helper_name()?);
        if development.is_file() {
            return Ok(development);
        }
    }
    Err(PluginRuntimeError::InvalidConfiguration(format!(
        "packaged plugin helper is missing beside {}",
        current_executable.display()
    )))
}

fn packaged_helper_name() -> &'static str {
    if cfg!(windows) {
        "asterlyn-plugin-host.exe"
    } else {
        "asterlyn-plugin-host"
    }
}

fn development_helper_name() -> Result<String, PluginRuntimeError> {
    let architecture = match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        "x86_64" => "x86_64",
        architecture => {
            return Err(PluginRuntimeError::InvalidConfiguration(format!(
                "unsupported development sidecar architecture: {architecture}"
            )));
        }
    };
    let target = match std::env::consts::OS {
        "macos" => format!("{architecture}-apple-darwin"),
        "windows" => format!("{architecture}-pc-windows-msvc"),
        "linux" => format!("{architecture}-unknown-linux-gnu"),
        operating_system => {
            return Err(PluginRuntimeError::InvalidConfiguration(format!(
                "unsupported development sidecar operating system: {operating_system}"
            )));
        }
    };
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    Ok(format!("asterlyn-plugin-host-{target}{suffix}"))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    #[test]
    fn packaged_helper_takes_precedence_over_development_sidecar() {
        let application = TempDir::new().expect("application directory");
        let development = TempDir::new().expect("development directory");
        let executable = application.path().join("asterlyn");
        fs::write(&executable, b"application").expect("application executable");
        let packaged = application.path().join(packaged_helper_name());
        fs::write(&packaged, b"packaged helper").expect("packaged helper");
        fs::write(
            development
                .path()
                .join(development_helper_name().expect("development helper name")),
            b"development helper",
        )
        .expect("development helper");

        let resolved = resolve_plugin_host_helper(&executable, Some(development.path()))
            .expect("resolve helper");
        assert_eq!(resolved, packaged);
    }

    #[test]
    fn development_resolution_requires_the_exact_target_filename() {
        let application = TempDir::new().expect("application directory");
        let development = TempDir::new().expect("development directory");
        let executable = application.path().join("asterlyn");
        fs::write(&executable, b"application").expect("application executable");
        fs::write(
            development.path().join("asterlyn-plugin-host-attacker"),
            b"bad",
        )
        .expect("untrusted helper");
        assert!(resolve_plugin_host_helper(&executable, Some(development.path())).is_err());

        let expected = development
            .path()
            .join(development_helper_name().expect("development helper name"));
        fs::write(&expected, b"development helper").expect("development helper");
        let resolved = resolve_plugin_host_helper(&executable, Some(development.path()))
            .expect("resolve development helper");
        assert_eq!(resolved, expected);
    }
}
