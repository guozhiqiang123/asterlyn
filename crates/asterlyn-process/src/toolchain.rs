//! Bounded standalone JDK facts. Callers own compatibility policy, approval and execution.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

const RELEASE_LIMIT: u64 = 64 * 1024;
const LAUNCHER_LIMIT: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolchainRole {
    BuildRuntime,
    BuildModel,
    LanguageServer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolchainSource {
    Installed,
    Environment,
    Project,
    User,
    CommandLine,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaRequirement {
    pub minimum_major: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maximum_major_exclusive: Option<u16>,
}
impl JavaRequirement {
    pub fn accepts(&self, major: u16) -> bool {
        self.minimum_major > 0
            && major >= self.minimum_major
            && self.maximum_major_exclusive.is_none_or(|max| major < max)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolchainSnapshot {
    pub id: String,
    pub role: ToolchainRole,
    pub source: ToolchainSource,
    pub version: String,
    pub major: u16,
    pub home: PathBuf,
    pub executable: PathBuf,
    pub identity: String,
    pub requirement: JavaRequirement,
    pub selection_reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolchainFailure {
    Unavailable,
    OutsideInstallation,
    Oversized,
    InvalidVersion,
    Incompatible,
}
impl ToolchainFailure {
    pub fn code(self) -> &'static str {
        match self {
            Self::Unavailable => "toolchain-unavailable",
            Self::OutsideInstallation => "toolchain-outside-installation",
            Self::Oversized => "toolchain-inspection-limit",
            Self::InvalidVersion => "toolchain-invalid-version",
            Self::Incompatible => "toolchain-incompatible",
        }
    }
}

#[derive(Debug)]
pub struct JdkInstallation {
    pub home: PathBuf,
    pub java: PathBuf,
    pub javac: PathBuf,
    pub major: u16,
    pub version: String,
    release: Vec<u8>,
}

pub fn java_version(release: &str) -> Option<(String, u16)> {
    let raw = release
        .lines()
        .find_map(|line| line.strip_prefix("JAVA_VERSION="))?;
    let value = if raw.starts_with('"') {
        raw.strip_prefix('"')?.strip_suffix('"')?
    } else {
        raw
    };
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._+-".contains(&c))
    {
        return None;
    }
    let mut parts = value.split(['.', '-', '+']);
    let first: u16 = parts.next()?.parse().ok()?;
    let major = if first == 1 {
        parts.next()?.parse().ok()?
    } else {
        first
    };
    (major > 0).then(|| (value.to_owned(), major))
}

fn bounded_file(path: &Path, limit: u64) -> Result<Vec<u8>, ToolchainFailure> {
    let mut file = File::open(path).map_err(|_| ToolchainFailure::Unavailable)?;
    let metadata = file.metadata().map_err(|_| ToolchainFailure::Unavailable)?;
    if !metadata.is_file() {
        return Err(ToolchainFailure::Unavailable);
    }
    if metadata.len() > limit {
        return Err(ToolchainFailure::Oversized);
    }
    let mut bytes = Vec::new();
    file.by_ref()
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ToolchainFailure::Unavailable)?;
    if bytes.len() as u64 > limit {
        return Err(ToolchainFailure::Oversized);
    }
    Ok(bytes)
}
fn contained(home: &Path, relative: &str) -> Result<PathBuf, ToolchainFailure> {
    let path = home
        .join(relative)
        .canonicalize()
        .map_err(|_| ToolchainFailure::Unavailable)?;
    if !path.starts_with(home) {
        return Err(ToolchainFailure::OutsideInstallation);
    }
    if !path.is_file() {
        return Err(ToolchainFailure::Unavailable);
    }
    Ok(path)
}
pub fn inspect_jdk(home: &Path, workspace: &Path) -> Result<JdkInstallation, ToolchainFailure> {
    if !home.is_absolute() {
        return Err(ToolchainFailure::Unavailable);
    }
    let workspace = workspace
        .canonicalize()
        .map_err(|_| ToolchainFailure::Unavailable)?;
    let home = home
        .canonicalize()
        .map_err(|_| ToolchainFailure::Unavailable)?;
    if home.starts_with(workspace) {
        return Err(ToolchainFailure::OutsideInstallation);
    }
    let release = bounded_file(&contained(&home, "release")?, RELEASE_LIMIT)?;
    let (version, major) =
        java_version(std::str::from_utf8(&release).map_err(|_| ToolchainFailure::InvalidVersion)?)
            .ok_or(ToolchainFailure::InvalidVersion)?;
    let java = contained(
        &home,
        if cfg!(windows) {
            "bin/java.exe"
        } else {
            "bin/java"
        },
    )?;
    let javac = contained(
        &home,
        if cfg!(windows) {
            "bin/javac.exe"
        } else {
            "bin/javac"
        },
    )?;
    Ok(JdkInstallation {
        home,
        java,
        javac,
        major,
        version,
        release,
    })
}
impl JdkInstallation {
    pub fn snapshot(
        &self,
        id: &str,
        role: ToolchainRole,
        requirement: JavaRequirement,
        source: ToolchainSource,
        reason: &str,
    ) -> Result<ToolchainSnapshot, ToolchainFailure> {
        if !requirement.accepts(self.major) {
            return Err(ToolchainFailure::Incompatible);
        }
        // Reinspect selected files at the identity boundary; a replaced symlink cannot escape home.
        let release = bounded_file(&contained(&self.home, "release")?, RELEASE_LIMIT)?;
        if release != self.release {
            return Err(ToolchainFailure::Unavailable);
        }
        let java = contained(
            &self.home,
            if cfg!(windows) {
                "bin/java.exe"
            } else {
                "bin/java"
            },
        )?;
        let javac = contained(
            &self.home,
            if cfg!(windows) {
                "bin/javac.exe"
            } else {
                "bin/javac"
            },
        )?;
        let mut hash = Sha256::new();
        hash.update(b"jdk-launcher-identity-v1\0");
        let home_text = self.home.to_string_lossy();
        for bytes in [home_text.as_bytes(), release.as_slice()] {
            hash.update((bytes.len() as u64).to_be_bytes());
            hash.update(bytes);
        }
        for path in [&java, &javac] {
            let path_text = path.to_string_lossy();
            hash.update((path_text.len() as u64).to_be_bytes());
            hash.update(path_text.as_bytes());
            let mut file = File::open(path).map_err(|_| ToolchainFailure::Unavailable)?;
            let length = file
                .metadata()
                .map_err(|_| ToolchainFailure::Unavailable)?
                .len();
            if length > LAUNCHER_LIMIT {
                return Err(ToolchainFailure::Oversized);
            }
            hash.update(length.to_be_bytes());
            let mut total = 0u64;
            let mut buffer = [0u8; 65536];
            loop {
                let count = file
                    .read(&mut buffer)
                    .map_err(|_| ToolchainFailure::Unavailable)?;
                if count == 0 {
                    break;
                }
                total += count as u64;
                if total > LAUNCHER_LIMIT {
                    return Err(ToolchainFailure::Oversized);
                }
                hash.update(&buffer[..count]);
            }
            if total != length {
                return Err(ToolchainFailure::Unavailable);
            }
        }
        Ok(ToolchainSnapshot {
            id: id.into(),
            role,
            source,
            version: self.version.clone(),
            major: self.major,
            home: self.home.clone(),
            executable: java,
            identity: format!("sha256:{:x}", hash.finalize()),
            requirement,
            selection_reason: reason.into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().canonicalize().unwrap();
        let workspace = base.join("workspace");
        let jdk = base.join("jdk");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(jdk.join("bin")).unwrap();
        std::fs::write(jdk.join("release"), "JAVA_VERSION=\"17.0.14+7\"\n").unwrap();
        for p in ["java", "javac"] {
            std::fs::write(
                jdk.join("bin").join(if cfg!(windows) {
                    format!("{p}.exe")
                } else {
                    p.into()
                }),
                b"launcher",
            )
            .unwrap();
        }
        (dir, workspace, jdk)
    }
    fn snapshot(jdk: &Path, workspace: &Path) -> ToolchainSnapshot {
        inspect_jdk(jdk, workspace)
            .unwrap()
            .snapshot(
                "serverJava",
                ToolchainRole::LanguageServer,
                JavaRequirement {
                    minimum_major: 17,
                    maximum_major_exclusive: Some(25),
                },
                ToolchainSource::Installed,
                "lowest-compatible",
            )
            .unwrap()
    }
    #[test]
    fn versions_and_requirement_boundaries() {
        assert_eq!(
            java_version("JAVA_VERSION=\"1.8.0_400\""),
            Some(("1.8.0_400".into(), 8))
        );
        for v in ["0", "x", "17\n", "17/../../"] {
            assert!(java_version(&format!("JAVA_VERSION=\"{v}\"")).is_none());
        }
        let r = JavaRequirement {
            minimum_major: 17,
            maximum_major_exclusive: Some(25),
        };
        assert!(r.accepts(17));
        assert!(!r.accepts(25));
    }
    #[test]
    fn identity_tracks_location_and_launcher_changes() {
        let (_d, w, j) = fixture();
        let a = snapshot(&j, &w);
        std::fs::write(
            j.join(if cfg!(windows) {
                "bin/java.exe"
            } else {
                "bin/java"
            }),
            b"replacement",
        )
        .unwrap();
        assert_ne!(a.identity, snapshot(&j, &w).identity);
        let other = j.with_file_name("other-jdk");
        std::fs::rename(&j, &other).unwrap();
        assert_ne!(a.identity, snapshot(&other, &w).identity);
    }
    #[test]
    fn project_and_relative_tools_are_rejected() {
        let (_d, w, j) = fixture();
        assert!(inspect_jdk(Path::new("jdk"), &w).is_err());
        std::fs::rename(&j, w.join("jdk")).unwrap();
        assert_eq!(
            inspect_jdk(&w.join("jdk"), &w).unwrap_err(),
            ToolchainFailure::OutsideInstallation
        );
    }
    #[test]
    fn bounded_release_and_launcher() {
        let (_d, w, j) = fixture();
        let file = File::options().write(true).open(j.join("release")).unwrap();
        file.set_len(RELEASE_LIMIT + 1).unwrap();
        assert_eq!(
            inspect_jdk(&j, &w).unwrap_err(),
            ToolchainFailure::Oversized
        );
        std::fs::write(j.join("release"), "JAVA_VERSION=\"17\"").unwrap();
        File::options()
            .write(true)
            .open(j.join(if cfg!(windows) {
                "bin/java.exe"
            } else {
                "bin/java"
            }))
            .unwrap()
            .set_len(LAUNCHER_LIMIT + 1)
            .unwrap();
        assert_eq!(
            inspect_jdk(&j, &w)
                .unwrap()
                .snapshot(
                    "x",
                    ToolchainRole::BuildRuntime,
                    JavaRequirement {
                        minimum_major: 17,
                        maximum_major_exclusive: None
                    },
                    ToolchainSource::Installed,
                    "test"
                )
                .unwrap_err(),
            ToolchainFailure::Oversized
        );
    }
    #[cfg(unix)]
    #[test]
    fn symlink_escape_and_replacement_are_rejected() {
        use std::os::unix::fs::symlink;
        let (_d, w, j) = fixture();
        let selected = inspect_jdk(&j, &w).unwrap();
        std::fs::remove_file(j.join("bin/java")).unwrap();
        symlink(w.join("outside"), j.join("bin/java")).unwrap();
        std::fs::write(w.join("outside"), b"outside").unwrap();
        assert_eq!(
            inspect_jdk(&j, &w).unwrap_err(),
            ToolchainFailure::OutsideInstallation
        );
        assert_eq!(
            selected
                .snapshot(
                    "x",
                    ToolchainRole::BuildRuntime,
                    JavaRequirement {
                        minimum_major: 17,
                        maximum_major_exclusive: None
                    },
                    ToolchainSource::Project,
                    "test"
                )
                .unwrap_err(),
            ToolchainFailure::OutsideInstallation
        );
    }
}
