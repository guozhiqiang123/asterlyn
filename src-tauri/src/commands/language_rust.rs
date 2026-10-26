use asterlyn_language_service::RustServerProfile;
use serde::Deserialize;
use std::{
    io::Read,
    path::{Path, PathBuf},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RustDeclaration {
    server_id: String,
    toolchain: String,
    policy: String,
}

/// A sealed package declares only this fixed profile, never binary paths or arbitrary arguments.
pub(super) fn resolve_rust(
    package: &Path,
    workspace: &Path,
) -> Result<(RustServerProfile, String), String> {
    let mut bytes = Vec::with_capacity(1025);
    std::fs::File::open(package.join("servers/rust-analyzer/profile.json"))
        .map_err(|_| "Rust profile is not declared by this package")?
        .take(1025)
        .read_to_end(&mut bytes)
        .map_err(|_| "Rust profile cannot be read")?;
    if bytes.len() > 1024 {
        return Err("Rust profile declaration exceeds bound".into());
    }
    let declaration: RustDeclaration =
        serde_json::from_slice(&bytes).map_err(|_| "Rust profile declaration invalid")?;
    if declaration.server_id != "rust-analyzer"
        || declaration.toolchain != "1.98.1"
        || declaration.policy != "cargo-offline-no-build-v1"
    {
        return Err("Rust profile is not admitted".into());
    }
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or("Rust user home is unavailable")?;
    let suffix = match std::env::consts::OS {
        "macos" => "apple-darwin",
        "linux" => "unknown-linux-gnu",
        "windows" => "pc-windows-msvc",
        _ => return Err("Rust platform unsupported".into()),
    };
    let root = PathBuf::from(home)
        .join(".rustup/toolchains")
        .join(format!("1.98.1-{}-{suffix}", std::env::consts::ARCH))
        .canonicalize()
        .map_err(
            |_| "Rust 1.98.1 toolchain is missing; install rust-analyzer and rust-src components",
        )?;
    let executable = |name: &str| -> Result<PathBuf, String> {
        let name = if cfg!(windows) {
            format!("{name}.exe")
        } else {
            name.into()
        };
        let path = root.join("bin").join(name).canonicalize().map_err(
            |_| "Rust toolchain component missing; install rust-analyzer and rust-src for 1.98.1",
        )?;
        if path.starts_with(workspace) || !path.starts_with(&root) || !path.is_file() {
            return Err("Rust executable is outside its trusted toolchain".into());
        }
        Ok(path)
    };
    let profile = RustServerProfile {
        analyzer: executable("rust-analyzer")?,
        cargo: executable("cargo")?,
        rustc: executable("rustc")?,
        rust_src: root
            .join("lib/rustlib/src/rust/library")
            .canonicalize()
            .map_err(|_| "Rust 1.98.1 rust-src component missing")?,
        sysroot: root.clone(),
        workspace: workspace.to_path_buf(),
    };
    if root.starts_with(workspace) || !profile.rust_src.starts_with(&root) {
        return Err("Rust toolchain/source cannot belong to the workspace".into());
    }
    profile
        .validate()
        .map_err(|_| "Rust Cargo.toml or rust-src is missing")?;
    let identity = format!(
        "{}:{}:{}:cargo-offline-no-build-v1",
        super::language_service::hash_file(&profile.analyzer)?,
        super::language_service::hash_file(&profile.cargo)?,
        super::language_service::hash_file(&profile.rustc)?
    );
    use sha2::{Digest, Sha256};
    Ok((
        profile,
        format!("sha256:{:x}", Sha256::digest(identity.as_bytes())),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sealed_declaration_rejects_paths_toolchain_changes_and_oversize() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("servers/rust-analyzer");
        std::fs::create_dir_all(&path).unwrap();
        for value in [
            r#"{"serverId":"rust-analyzer","toolchain":"nightly","policy":"cargo-offline-no-build-v1"}"#,
            r#"{"serverId":"rust-analyzer","toolchain":"1.98.1","policy":"cargo-offline-no-build-v1","executable":"/tmp/server"}"#,
        ] {
            std::fs::write(path.join("profile.json"), value).unwrap();
            assert!(resolve_rust(temp.path(), temp.path()).is_err());
        }
        std::fs::write(path.join("profile.json"), " ".repeat(1025)).unwrap();
        assert_eq!(
            resolve_rust(temp.path(), temp.path()).unwrap_err(),
            "Rust profile declaration exceeds bound"
        );
    }
}
