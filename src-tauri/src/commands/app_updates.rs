use serde::Serialize;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::{
    cmp::Ordering,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

const RELEASE_REPOSITORY_URL: &str = "https://github.com/guozhiqiang123/asterlyn";
const LATEST_RELEASE_URL: &str = "https://github.com/guozhiqiang123/asterlyn/releases/latest";
const FINAL_URL_MARKER: &str = "\n__ASTERLYN_FINAL_URL__:";

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateCheckResult {
    ok: bool,
    current_version: String,
    latest_version: Option<String>,
    has_update: bool,
    release_url: String,
    checked_at_epoch_ms: u64,
    error: Option<String>,
}

#[tauri::command]
pub(crate) async fn check_for_app_updates() -> AppUpdateCheckResult {
    match tauri::async_runtime::spawn_blocking(check_for_app_updates_blocking).await {
        Ok(result) => result,
        Err(error) => failed_check(format!("Update check task failed: {error}")),
    }
}

#[tauri::command]
pub(crate) fn open_app_update_release(release_url: String) -> Result<(), String> {
    if !is_allowed_release_url(release_url.trim()) {
        return Err("Only Asterlyn GitHub Release links may be opened.".to_string());
    }
    open_url(release_url.trim())
}

fn check_for_app_updates_blocking() -> AppUpdateCheckResult {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    match latest_release() {
        Ok((latest_version, release_url)) => AppUpdateCheckResult {
            ok: true,
            has_update: compare_versions(&latest_version, &current_version) == Ordering::Greater,
            current_version,
            latest_version: Some(latest_version),
            release_url,
            checked_at_epoch_ms: now_ms(),
            error: None,
        },
        Err(error) => failed_check_with_version(current_version, error),
    }
}

fn failed_check(error: String) -> AppUpdateCheckResult {
    failed_check_with_version(env!("CARGO_PKG_VERSION").to_string(), error)
}

fn failed_check_with_version(current_version: String, error: String) -> AppUpdateCheckResult {
    AppUpdateCheckResult {
        ok: false,
        current_version,
        latest_version: None,
        has_update: false,
        release_url: LATEST_RELEASE_URL.to_string(),
        checked_at_epoch_ms: now_ms(),
        error: Some(error),
    }
}

fn latest_release() -> Result<(String, String), String> {
    let write_out = format!("{FINAL_URL_MARKER}%{{url_effective}}");
    let output = hidden_command("curl")
        .args([
            "-fsSL",
            "--http1.1",
            "--connect-timeout",
            "8",
            "--max-time",
            "15",
            "--retry",
            "1",
            "--retry-delay",
            "1",
            "-A",
            concat!("Asterlyn/", env!("CARGO_PKG_VERSION")),
            "-w",
        ])
        .arg(write_out)
        .arg(LATEST_RELEASE_URL)
        .output()
        .map_err(|error| format!("Could not run curl: {error}"))?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            format!("GitHub returned curl exit code {:?}.", output.status.code())
        } else {
            format!("GitHub request failed: {detail}")
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let marker = stdout
        .rfind(FINAL_URL_MARKER)
        .ok_or_else(|| "GitHub did not return a final Release URL.".to_string())?;
    let release_url = stdout[marker + FINAL_URL_MARKER.len()..].trim().to_string();
    let latest_version = release_tag(&release_url)
        .ok_or_else(|| "Could not determine the latest GitHub Release version.".to_string())?;
    if !is_allowed_release_url(&release_url) {
        return Err("GitHub redirected outside the Asterlyn Release page.".to_string());
    }
    Ok((latest_version, release_url))
}

fn release_tag(url: &str) -> Option<String> {
    let tail = url.split_once("/releases/tag/")?.1;
    let end = tail.find(['?', '#', '/']).unwrap_or(tail.len());
    let tag = &tail[..end];
    (!tag.is_empty()).then(|| tag.to_string())
}

fn compare_versions(left: &str, right: &str) -> Ordering {
    let left = version_parts(left);
    let right = version_parts(right);
    for index in 0..left.len().max(right.len()) {
        match left
            .get(index)
            .copied()
            .unwrap_or(0)
            .cmp(&right.get(index).copied().unwrap_or(0))
        {
            Ordering::Equal => continue,
            ordering => return ordering,
        }
    }
    Ordering::Equal
}

fn version_parts(version: &str) -> Vec<u64> {
    version
        .trim()
        .trim_start_matches(['v', 'V'])
        .chars()
        .take_while(|character| character.is_ascii_digit() || *character == '.')
        .collect::<String>()
        .split('.')
        .filter_map(|part| part.parse().ok())
        .collect()
}

fn is_allowed_release_url(url: &str) -> bool {
    url == LATEST_RELEASE_URL || url.starts_with(&format!("{RELEASE_REPOSITORY_URL}/releases/tag/"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn hidden_command(program: &str) -> Command {
    let command = Command::new(program);
    #[cfg(target_os = "windows")]
    let mut command = command;
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

fn open_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = hidden_command("explorer.exe");
    #[cfg(target_os = "linux")]
    let mut command = Command::new("xdg-open");

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    return command
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open the Release page: {error}"));

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    Err("Opening the Release page is unsupported on this platform.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_release_tag_from_github_url() {
        assert_eq!(
            release_tag("https://github.com/guozhiqiang123/asterlyn/releases/tag/v1.2.3"),
            Some("v1.2.3".to_string())
        );
    }

    #[test]
    fn compares_numeric_release_versions() {
        assert_eq!(compare_versions("v1.10.0", "1.9.9"), Ordering::Greater);
        assert_eq!(compare_versions("v1.2", "1.2.0"), Ordering::Equal);
        assert_eq!(compare_versions("0.9.9", "v1.0.0"), Ordering::Less);
    }

    #[test]
    fn release_url_allowlist_is_repository_scoped() {
        assert!(is_allowed_release_url(LATEST_RELEASE_URL));
        assert!(is_allowed_release_url(
            "https://github.com/guozhiqiang123/asterlyn/releases/tag/v0.2.0"
        ));
        assert!(!is_allowed_release_url(
            "https://github.com/other/project/releases/tag/v0.2.0"
        ));
    }
}
