//! Native adapter for root Gradle wrappers; no subprocess/version probing or SDK changes.
use super::java_installations;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};

const CONFIG_LIMIT: u64 = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GradleTaskRuntime {
    pub(crate) home: PathBuf,
    pub(crate) java_major: u16,
    pub(crate) gradle_version: String,
    pub(crate) selection_reason: &'static str,
    pub(crate) digest: String,
}

impl GradleTaskRuntime {
    pub(crate) fn metadata(&self) -> serde_json::Value {
        serde_json::json!({"gradleVersion": self.gradle_version, "javaMajor": self.java_major,
            "selectionReason": self.selection_reason, "runtimeDigest": self.digest})
    }
}

#[derive(Default)]
struct Environment {
    java_home: Option<PathBuf>,
    gradle_home: Option<PathBuf>,
    candidates: Vec<PathBuf>,
}

pub(crate) fn resolve(
    root: &Path,
    executable: &str,
    args: &[String],
) -> Result<Option<GradleTaskRuntime>, String> {
    if !matches!(executable, "gradlew" | "gradlew.bat") {
        return Ok(None);
    }
    let environment = Environment {
        java_home: std::env::var_os("JAVA_HOME").map(PathBuf::from),
        gradle_home: std::env::var_os("GRADLE_USER_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                    .map(|home| PathBuf::from(home).join(".gradle"))
            }),
        candidates: java_installations::candidates(),
    };
    resolve_with(root, args, environment)
}

pub(crate) fn cache_identity(root: &Path) -> Result<Option<String>, String> {
    if !root.join("gradlew").is_file() && !root.join("gradlew.bat").is_file() {
        return Ok(None);
    }
    resolve(root, "gradlew", &[]).map(|runtime| runtime.map(|runtime| runtime.digest))
}

fn resolve_with(
    root: &Path,
    args: &[String],
    environment: Environment,
) -> Result<Option<GradleTaskRuntime>, String> {
    let mut identity = Sha256::new();
    identity.update(b"gradle-task-java-v1\0");
    let wrapper = read_config(
        &root.join("gradle/wrapper/gradle-wrapper.properties"),
        Some(root),
        &mut identity,
    )?;
    // Non-Gradle scripts with this name retain their existing execution semantics.
    let Some(wrapper) = wrapper else {
        return Ok(None);
    };
    let url = property(&wrapper, "distributionUrl")?
        .ok_or("gradle.runtime.configuration: Gradle wrapper distributionUrl is missing.")?;
    let version = wrapper_version(&url)?;
    let (minimum, maximum) = java_range(version)?;
    let gradle_version = format_version(version);
    let criteria = read_config(
        &root.join("gradle/gradle-daemon-jvm.properties"),
        Some(root),
        &mut identity,
    )?;
    if criteria.as_deref().is_some_and(|text| {
        text.lines()
            .any(|line| !line.trim().is_empty() && !line.trim_start().starts_with(['#', '!']))
    }) {
        return Err("gradle.runtime.daemonCriteria: This project declares Gradle daemon JVM criteria. Reviewed task execution does not support those criteria yet; configure an explicit Gradle Java home instead.".into());
    }
    let project = read_config(&root.join("gradle.properties"), Some(root), &mut identity)?
        .unwrap_or_default();
    let mut gradle_home = environment.gradle_home;
    let mut explicit = None;
    for (index, argument) in args.iter().enumerate() {
        if let Some(home) = argument.strip_prefix("-Dorg.gradle.java.home=") {
            explicit = Some((PathBuf::from(home), "command-line"));
        } else if let Some(home) = argument.strip_prefix("--gradle-user-home=") {
            gradle_home = Some(PathBuf::from(home));
        } else if matches!(argument.as_str(), "--gradle-user-home" | "-g") {
            gradle_home = Some(PathBuf::from(args.get(index + 1).ok_or(
                "gradle.runtime.configuration: Gradle user home argument is missing.",
            )?));
        } else if let Some(home) = argument.strip_prefix("-g").filter(|home| !home.is_empty()) {
            gradle_home = Some(PathBuf::from(home));
        } else if argument == "-D"
            || argument.starts_with("--system-prop")
            || argument.starts_with("-Dgradle.user.home")
            || argument.starts_with("-Duser.home")
            || argument.starts_with("-p")
            || argument.starts_with("--project-dir")
            || argument.starts_with("-c")
            || argument.starts_with("--settings-file")
            || argument.starts_with("-b")
            || argument.starts_with("--build-file")
        {
            return Err("gradle.runtime.configuration: This Gradle argument changes the reviewed runtime or project context; use project Gradle configuration instead.".into());
        }
    }
    let user = if let Some(home) = &gradle_home {
        if !home.is_absolute() {
            return Err(
                "gradle.runtime.configuration: Gradle user home must be an absolute path.".into(),
            );
        }
        feed(&mut identity, home.to_string_lossy().as_bytes());
        read_config(&home.join("gradle.properties"), None, &mut identity)?.unwrap_or_default()
    } else {
        String::new()
    };
    if explicit.is_none() {
        explicit = property(&user, "org.gradle.java.home")?
            .map(|home| (PathBuf::from(home), "user-properties"))
            .or(property(&project, "org.gradle.java.home")?
                .map(|home| (PathBuf::from(home), "project-properties")));
    }
    let compatible = |major| major >= minimum && major <= maximum;
    let (home, java_major, selection_reason) = if let Some((home, reason)) = explicit {
        let (home, major) = inspect(&home, root).ok_or("gradle.runtime.javaMissing: The configured Gradle Java home is not an available standalone JDK outside this project.")?;
        if !compatible(major) {
            return Err(format!(
                "gradle.runtime.javaIncompatible: Configured JDK {major} cannot run Gradle {gradle_version}. Select JDK {minimum}–{maximum} in org.gradle.java.home."
            ));
        }
        (home, major, reason)
    } else if let Some((home, major)) = environment
        .java_home
        .as_deref()
        .and_then(|home| inspect(home, root))
        .filter(|(_, major)| compatible(*major))
    {
        (home, major, "compatible-environment")
    } else {
        let mut available: Vec<_> = environment
            .candidates
            .iter()
            .filter_map(|home| inspect(home, root))
            .filter(|(_, major)| compatible(*major))
            .collect();
        // Prefer the lowest installed modern LTS-compatible runtime, then older supported Java.
        available.sort_by(|a, b| {
            (a.1 < 17, if a.1 >= 17 { a.1 } else { u16::MAX - a.1 }, &a.0).cmp(&(
                b.1 < 17,
                if b.1 >= 17 { b.1 } else { u16::MAX - b.1 },
                &b.0,
            ))
        });
        let (home, major) = available.into_iter().next().ok_or_else(|| format!("gradle.runtime.javaMissing: No installed standalone JDK {minimum}–{maximum} can run Gradle {gradle_version}. Install a compatible JDK or configure org.gradle.java.home."))?;
        (
            home,
            major,
            if environment.java_home.is_some() {
                "replaced-incompatible-environment"
            } else {
                "compatible-installed"
            },
        )
    };
    feed(&mut identity, home.to_string_lossy().as_bytes());
    for relative in [
        "release",
        if cfg!(windows) {
            "bin/java.exe"
        } else {
            "bin/java"
        },
        if cfg!(windows) {
            "bin/javac.exe"
        } else {
            "bin/javac"
        },
    ] {
        let path = home.join(relative).canonicalize().map_err(
            |_| "gradle.runtime.javaChanged: Selected Java installation changed; retry discovery.",
        )?;
        if !path.starts_with(&home) {
            return Err("gradle.runtime.javaMissing: Selected Java files must remain inside their installation.".into());
        }
        let mut file = File::open(path).map_err(
            |_| "gradle.runtime.javaMissing: Cannot inspect the selected Java installation.",
        )?;
        let mut bytes = Vec::new();
        file.by_ref()
            .take(64 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(
                |_| "gradle.runtime.javaMissing: Cannot read the selected Java installation.",
            )?;
        if bytes.len() > 64 * 1024 * 1024 {
            return Err("gradle.runtime.javaMissing: Selected Java executable exceeds the inspection limit.".into());
        }
        feed(&mut identity, &bytes);
    }
    Ok(Some(GradleTaskRuntime {
        home,
        java_major,
        gradle_version,
        selection_reason,
        digest: format!("{:x}", identity.finalize()),
    }))
}

fn inspect(home: &Path, workspace: &Path) -> Option<(PathBuf, u16)> {
    if !home.is_absolute() {
        return None;
    }
    let home = home.canonicalize().ok()?;
    if home.starts_with(workspace) {
        return None;
    }
    let release = home.join("release").canonicalize().ok()?;
    if !release.starts_with(&home) || fs::metadata(&release).ok()?.len() > CONFIG_LIMIT {
        return None;
    }
    let mut bytes = Vec::new();
    File::open(release)
        .ok()?
        .take(CONFIG_LIMIT + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > CONFIG_LIMIT {
        return None;
    }
    let major = java_installations::major(std::str::from_utf8(&bytes).ok()?)?;
    if !home
        .join(if cfg!(windows) {
            "bin/java.exe"
        } else {
            "bin/java"
        })
        .is_file()
        || !home
            .join(if cfg!(windows) {
                "bin/javac.exe"
            } else {
                "bin/javac"
            })
            .is_file()
    {
        return None;
    }
    Some((home, major))
}

fn feed(hash: &mut Sha256, bytes: &[u8]) {
    hash.update((bytes.len() as u64).to_be_bytes());
    hash.update(bytes);
}

fn read_config(
    path: &Path,
    root: Option<&Path>,
    hash: &mut Sha256,
) -> Result<Option<String>, String> {
    feed(hash, path.to_string_lossy().as_bytes());
    let canonical = match path.canonicalize() {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            feed(hash, b"absent");
            return Ok(None);
        }
        Err(_) => {
            return Err(
                "gradle.runtime.configuration: Cannot inspect Gradle Java configuration.".into(),
            );
        }
    };
    if root.is_some_and(|root| !canonical.starts_with(root)) {
        return Err(
            "gradle.runtime.configuration: Gradle configuration escapes the reviewed project."
                .into(),
        );
    }
    if !fs::metadata(&canonical).is_ok_and(|metadata| metadata.is_file()) {
        return Err(
            "gradle.runtime.configuration: Gradle configuration must be a regular file.".into(),
        );
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options
        .open(&canonical)
        .map_err(|_| "gradle.runtime.configuration: Cannot read Gradle Java configuration.")?;
    if !file
        .metadata()
        .map_err(|_| "gradle.runtime.configuration: Cannot inspect Gradle configuration.")?
        .is_file()
    {
        return Err(
            "gradle.runtime.configuration: Gradle configuration must be a regular file.".into(),
        );
    }
    let mut bytes = Vec::new();
    file.take(CONFIG_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "gradle.runtime.configuration: Cannot read Gradle configuration.")?;
    if bytes.len() as u64 > CONFIG_LIMIT {
        return Err("gradle.runtime.configuration: Gradle configuration exceeds the 64 KiB inspection limit.".into());
    }
    feed(hash, canonical.to_string_lossy().as_bytes());
    feed(hash, &bytes);
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| "gradle.runtime.configuration: Gradle configuration must use UTF-8.".into())
}

fn property(text: &str, wanted: &str) -> Result<Option<String>, String> {
    let mut result = None;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with(['#', '!']) {
            continue;
        }
        let end = line.find(['=', ':', ' ', '\t']).unwrap_or(line.len());
        if &line[..end] != wanted {
            continue;
        }
        let value = line[end..]
            .trim_start()
            .trim_start_matches(['=', ':'])
            .trim_start();
        // Reject ambiguous Java-properties continuations/escapes instead of misreading an override.
        let value = value
            .replace("\\:", ":")
            .replace("\\\\", "\\")
            .replace("\\ ", " ");
        if value.is_empty() || value.ends_with('\\') || value.contains("\\u") {
            return Err("gradle.runtime.configuration: Gradle Java configuration contains an unsupported or empty property value.".into());
        }
        result = Some(value);
    }
    Ok(result)
}

fn wrapper_version(url: &str) -> Result<(u16, u16, u16), String> {
    let error = "gradle.runtime.wrapperUnsupported: Cannot identify a supported stable Gradle version from distributionUrl.";
    let name = url.rsplit('/').next().ok_or(error)?;
    let version = name
        .strip_prefix("gradle-")
        .and_then(|name| {
            name.strip_suffix("-bin.zip")
                .or_else(|| name.strip_suffix("-all.zip"))
        })
        .ok_or(error)?;
    let parts: Vec<_> = version.split('.').collect();
    if !(2..=3).contains(&parts.len())
        || parts
            .iter()
            .any(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err(error.into());
    }
    Ok((
        parts[0].parse().map_err(|_| error)?,
        parts[1].parse().map_err(|_| error)?,
        parts
            .get(2)
            .map_or(Ok(0), |part| part.parse())
            .map_err(|_| error)?,
    ))
}

fn format_version((major, minor, patch): (u16, u16, u16)) -> String {
    if patch == 0 {
        format!("{major}.{minor}")
    } else {
        format!("{major}.{minor}.{patch}")
    }
}

fn java_range(version: (u16, u16, u16)) -> Result<(u16, u16), String> {
    if !((2, 0, 0)..(9, 9, 0)).contains(&version)
        || version.1
            > match version.0 {
                2 => 14,
                3 => 5,
                4 => 10,
                5 => 6,
                6 => 9,
                7 => 6,
                8 => 14,
                9 => 8,
                _ => 0,
            }
    {
        return Err("gradle.runtime.wrapperUnsupported: This Gradle version is outside the reviewed Java compatibility table. Update Asterlyn's compatibility support.".into());
    }
    let mut maximum = 8;
    for (java, required) in [
        (9, (4, 3, 0)),
        (10, (4, 7, 0)),
        (11, (5, 0, 0)),
        (12, (5, 4, 0)),
        (13, (6, 0, 0)),
        (14, (6, 3, 0)),
        (15, (6, 7, 0)),
        (16, (7, 0, 0)),
        (17, (7, 3, 0)),
        (18, (7, 5, 0)),
        (19, (7, 6, 0)),
        (20, (8, 3, 0)),
        (21, (8, 5, 0)),
        (22, (8, 8, 0)),
        (23, (8, 10, 0)),
        (24, (8, 14, 0)),
        (25, (9, 1, 0)),
        (26, (9, 4, 0)),
        (27, (9, 8, 0)),
    ] {
        if version >= required {
            maximum = java;
        }
    }
    Ok((if version >= (9, 0, 0) { 17 } else { 8 }, maximum))
}

pub(crate) fn failure_category(message: &str) -> &str {
    message
        .split_once(':')
        .map(|(code, _)| code)
        .filter(|code| {
            matches!(
                *code,
                "gradle.runtime.configuration"
                    | "gradle.runtime.daemonCriteria"
                    | "gradle.runtime.javaMissing"
                    | "gradle.runtime.javaIncompatible"
                    | "gradle.runtime.javaChanged"
                    | "gradle.runtime.wrapperUnsupported"
                    | "gradle.failure.java"
                    | "gradle.failure.tls"
                    | "gradle.failure.dependencies"
                    | "gradle.failure.storage"
                    | "gradle.failure.lock"
                    | "gradle.failure.build"
            )
        })
        .unwrap_or("task.execution.failed")
}

#[cfg(test)]
#[path = "gradle_task_runtime_tests.rs"]
mod tests;
