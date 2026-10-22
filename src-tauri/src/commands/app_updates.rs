use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::{
    cmp::Ordering,
    env, fs,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering as AtomicOrdering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;

const RELEASE_REPOSITORY_URL: &str = "https://github.com/guozhiqiang123/asterlyn";
const RELEASES_API_URL: &str =
    "https://api.github.com/repos/guozhiqiang123/asterlyn/releases/latest";
const LATEST_RELEASE_URL: &str = "https://github.com/guozhiqiang123/asterlyn/releases/latest";
const RELEASE_DOWNLOAD_PREFIX: &str =
    "https://github.com/guozhiqiang123/asterlyn/releases/download/";
const MAX_RELEASE_METADATA_BYTES: usize = 2 * 1024 * 1024;
const MAX_UPDATE_BYTES: u64 = 512 * 1024 * 1024;
static UPDATE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    draft: bool,
    prerelease: bool,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

#[derive(Clone, Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateCheckResult {
    ok: bool,
    current_version: String,
    latest_version: Option<String>,
    has_update: bool,
    release_url: String,
    checked_at_epoch_ms: u64,
    asset_name: Option<String>,
    asset_size_bytes: Option<u64>,
    can_install: bool,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateInstallResult {
    ok: bool,
    message: String,
    error: Option<String>,
}

struct DownloadedUpdate {
    path: PathBuf,
}

#[derive(Clone, Copy)]
enum LinuxInstallerKind {
    #[cfg(any(target_os = "linux", test))]
    AppImage,
    #[cfg(any(target_os = "linux", test))]
    Debian,
    #[cfg(any(target_os = "linux", test))]
    Rpm,
    Unsupported,
}

struct UpdateGuard;

impl UpdateGuard {
    fn acquire() -> Result<Self, String> {
        UPDATE_IN_PROGRESS
            .compare_exchange(false, true, AtomicOrdering::SeqCst, AtomicOrdering::SeqCst)
            .map(|_| Self)
            .map_err(|_| "An application update is already in progress.".to_string())
    }
}

impl Drop for UpdateGuard {
    fn drop(&mut self) {
        UPDATE_IN_PROGRESS.store(false, AtomicOrdering::SeqCst);
    }
}

#[tauri::command]
pub(crate) async fn check_for_app_updates() -> AppUpdateCheckResult {
    match tauri::async_runtime::spawn_blocking(check_for_app_updates_blocking).await {
        Ok(result) => result,
        Err(error) => failed_check(format!("Update check task failed: {error}")),
    }
}

#[tauri::command]
pub(crate) async fn install_app_update(app: AppHandle) -> AppUpdateInstallResult {
    let result = match tauri::async_runtime::spawn_blocking(prepare_app_update_installation).await {
        Ok(Ok(())) => AppUpdateInstallResult {
            ok: true,
            message: "The verified installer is ready. Asterlyn will exit, replace the installed application, and reopen.".to_string(),
            error: None,
        },
        Ok(Err(error)) => failed_install(error),
        Err(error) => failed_install(format!("Update installation task failed: {error}")),
    };
    if result.ok {
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(700));
            app.exit(0);
        });
    }
    result
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
        Ok(release) => {
            let latest_version = normalize_version(&release.tag_name).to_string();
            let has_update =
                compare_versions(&latest_version, &current_version) == Ordering::Greater;
            let (asset_name, asset_size_bytes) = select_current_asset(&release)
                .map(|asset| (Some(asset.name.clone()), Some(asset.size)))
                .unwrap_or((None, None));
            AppUpdateCheckResult {
                ok: true,
                current_version,
                latest_version: Some(latest_version),
                has_update,
                release_url: release.html_url,
                checked_at_epoch_ms: now_ms(),
                can_install: has_update && asset_name.is_some(),
                asset_name,
                asset_size_bytes,
                error: None,
            }
        }
        Err(error) => failed_check_with_version(current_version, error),
    }
}

fn prepare_app_update_installation() -> Result<(), String> {
    let guard = UpdateGuard::acquire()?;
    let release = latest_release()?;
    if compare_versions(&release.tag_name, env!("CARGO_PKG_VERSION")) != Ordering::Greater {
        return Err("The installed version is already current.".to_string());
    }
    let asset = select_current_asset(&release).ok_or_else(|| {
        "The latest Release has no verified installer for this platform and architecture."
            .to_string()
    })?;
    let downloaded = download_and_verify(asset)?;
    launch_update_installer(&downloaded.path)?;
    std::mem::forget(guard);
    Ok(())
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
        asset_name: None,
        asset_size_bytes: None,
        can_install: false,
        error: Some(error),
    }
}

fn failed_install(error: String) -> AppUpdateInstallResult {
    AppUpdateInstallResult {
        ok: false,
        message: "Asterlyn could not install the update.".to_string(),
        error: Some(error),
    }
}

fn latest_release() -> Result<GitHubRelease, String> {
    let output = hidden_command("curl")
        .args([
            "-fsSL",
            "--http1.1",
            "--connect-timeout",
            "8",
            "--max-time",
            "20",
            "--retry",
            "1",
            "--retry-delay",
            "1",
            "-H",
            "Accept: application/vnd.github+json",
            "-H",
            "X-GitHub-Api-Version: 2022-11-28",
            "-A",
            concat!("Asterlyn/", env!("CARGO_PKG_VERSION")),
            RELEASES_API_URL,
        ])
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
    if output.stdout.len() > MAX_RELEASE_METADATA_BYTES {
        return Err("GitHub returned oversized Release metadata.".to_string());
    }
    let release: GitHubRelease = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("GitHub returned an unrecognized Release response: {error}"))?;
    if release.draft || release.prerelease || release_version_parts(&release.tag_name).is_none() {
        return Err("GitHub did not return a stable versioned Release.".to_string());
    }
    if !is_allowed_release_url(&release.html_url) {
        return Err("GitHub returned a Release outside the Asterlyn repository.".to_string());
    }
    Ok(release)
}

fn select_current_asset(release: &GitHubRelease) -> Option<&GitHubAsset> {
    select_release_asset(
        &release.assets,
        env::consts::OS,
        env::consts::ARCH,
        current_linux_installer(),
    )
}

fn select_release_asset<'a>(
    assets: &'a [GitHubAsset],
    os: &str,
    arch: &str,
    linux_installer: LinuxInstallerKind,
) -> Option<&'a GitHubAsset> {
    let suffix = match (os, arch) {
        ("macos", "aarch64") => "_aarch64.dmg",
        ("macos", "x86_64") => "_x64.dmg",
        ("windows", "x86_64") => "_x64-setup.exe",
        ("linux", "x86_64") => match linux_installer {
            #[cfg(any(target_os = "linux", test))]
            LinuxInstallerKind::AppImage => "_amd64.AppImage",
            #[cfg(any(target_os = "linux", test))]
            LinuxInstallerKind::Debian => "_amd64.deb",
            #[cfg(any(target_os = "linux", test))]
            LinuxInstallerKind::Rpm => ".x86_64.rpm",
            LinuxInstallerKind::Unsupported => return None,
        },
        _ => return None,
    };
    let mut matches = assets
        .iter()
        .filter(|asset| asset.name.ends_with(suffix) && valid_asset(asset));
    let selected = matches.next()?;
    matches.next().is_none().then_some(selected)
}

fn current_linux_installer() -> LinuxInstallerKind {
    #[cfg(target_os = "linux")]
    {
        if env::var_os("APPIMAGE").is_some() {
            return LinuxInstallerKind::AppImage;
        }
        if command_succeeds("dpkg") {
            return LinuxInstallerKind::Debian;
        }
        if command_succeeds("rpm") {
            return LinuxInstallerKind::Rpm;
        }
    }
    LinuxInstallerKind::Unsupported
}

fn valid_asset(asset: &GitHubAsset) -> bool {
    asset.size > 0
        && asset.size <= MAX_UPDATE_BYTES
        && expected_sha256(asset).is_some()
        && allowed_download_url(&asset.browser_download_url, &asset.name)
        && sanitize_file_name(&asset.name).as_deref() == Some(asset.name.as_str())
}

fn expected_sha256(asset: &GitHubAsset) -> Option<String> {
    let digest = asset.digest.as_deref()?.strip_prefix("sha256:")?;
    (digest.len() == 64
        && digest
            .chars()
            .all(|character| character.is_ascii_hexdigit()))
    .then(|| digest.to_ascii_lowercase())
}

fn allowed_download_url(url: &str, asset_name: &str) -> bool {
    let Some(remainder) = url.strip_prefix(RELEASE_DOWNLOAD_PREFIX) else {
        return false;
    };
    let Some((tag, file_name)) = remainder.split_once('/') else {
        return false;
    };
    release_version_parts(tag).is_some()
        && !tag.contains(['?', '#'])
        && file_name == asset_name
        && !file_name.contains(['/', '\\', '?', '#'])
}

fn download_and_verify(asset: &GitHubAsset) -> Result<DownloadedUpdate, String> {
    if !valid_asset(asset) {
        return Err(
            "The Release installer has invalid size, SHA-256, name, or download metadata."
                .to_string(),
        );
    }
    let update_directory = env::temp_dir().join("asterlyn-updates");
    cleanup_update_directory(&update_directory);
    fs::create_dir_all(&update_directory)
        .map_err(|error| format!("Could not create the update directory: {error}"))?;
    let destination = update_directory.join(&asset.name);
    let partial = update_directory.join(format!("{}.download", asset.name));
    let max_update_bytes = MAX_UPDATE_BYTES.to_string();
    let output = hidden_command("curl")
        .args([
            "-fsSL",
            "--http1.1",
            "--connect-timeout",
            "10",
            "--max-time",
            "900",
            "--retry",
            "2",
            "--retry-delay",
            "1",
            "--max-filesize",
            &max_update_bytes,
            "-A",
            concat!("Asterlyn/", env!("CARGO_PKG_VERSION")),
            "--output",
        ])
        .arg(&partial)
        .arg(&asset.browser_download_url)
        .output()
        .map_err(|error| format!("Could not start the installer download: {error}"))?;
    if !output.status.success() {
        let _ = fs::remove_file(&partial);
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "The installer download failed.".to_string()
        } else {
            format!("The installer download failed: {detail}")
        });
    }
    verify_downloaded_file(asset, &partial)?;
    fs::rename(&partial, &destination)
        .map_err(|error| format!("Could not finalize the downloaded installer: {error}"))?;
    Ok(DownloadedUpdate { path: destination })
}

fn verify_downloaded_file(asset: &GitHubAsset, path: &Path) -> Result<(), String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not inspect the downloaded installer: {error}"))?;
    if metadata.len() != asset.size || metadata.len() > MAX_UPDATE_BYTES {
        let _ = fs::remove_file(path);
        return Err("The downloaded installer size does not match the GitHub Release.".to_string());
    }
    let expected = expected_sha256(asset).ok_or_else(|| {
        "The GitHub Release does not contain a valid installer SHA-256.".to_string()
    })?;
    let mut file = File::open(path)
        .map_err(|error| format!("Could not read the downloaded installer: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("Could not verify the downloaded installer: {error}"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected {
        let _ = fs::remove_file(path);
        return Err(
            "The installer SHA-256 does not match the GitHub Release; installation was cancelled."
                .to_string(),
        );
    }
    Ok(())
}

fn cleanup_update_directory(directory: &Path) {
    if let Ok(entries) = fs::read_dir(directory) {
        for entry in entries.flatten() {
            if entry.path().is_file() {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

fn launch_update_installer(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return launch_macos_installer(path);
    #[cfg(target_os = "windows")]
    return launch_windows_installer(path);
    #[cfg(target_os = "linux")]
    return launch_linux_installer(path);
    #[allow(unreachable_code)]
    Err("In-app installation is unsupported on this platform.".to_string())
}

#[cfg(target_os = "macos")]
fn launch_macos_installer(path: &Path) -> Result<(), String> {
    if path.extension().and_then(|value| value.to_str()) != Some("dmg") {
        return Err("The macOS update package is not a DMG.".to_string());
    }
    let app_path = current_app_bundle_path().ok_or_else(|| {
        "The running executable is not inside an Asterlyn application bundle.".to_string()
    })?;
    let script_path = path
        .parent()
        .unwrap_or_else(|| Path::new("/tmp"))
        .join(format!("install-asterlyn-{}.sh", std::process::id()));
    fs::write(&script_path, macos_install_script(path, &app_path))
        .map_err(|error| format!("Could not create the macOS update script: {error}"))?;
    Command::new("sh")
        .arg(&script_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not start the macOS update script: {error}"))
}

#[cfg(target_os = "macos")]
fn current_app_bundle_path() -> Option<PathBuf> {
    let mut path = env::current_exe().ok()?;
    while path.pop() {
        if path.extension().and_then(|value| value.to_str()) == Some("app") {
            return Some(path);
        }
    }
    None
}

#[cfg(any(target_os = "macos", test))]
fn macos_install_script(dmg_path: &Path, app_path: &Path) -> String {
    format!(
        r#"#!/bin/sh
set -eu
DMG_PATH={dmg_path}
APP_PATH={app_path}
SCRIPT_PATH="$0"
MOUNT_DIR="$(mktemp -d "${{TMPDIR:-/tmp/}}asterlyn-update.XXXXXX")"
APP_PARENT="$(dirname "$APP_PATH")"
STAGED_APP="$APP_PARENT/.Asterlyn.update.app"
BACKUP_ROOT="$(mktemp -d "${{TMPDIR:-/tmp/}}asterlyn-update-backup.XXXXXX")"
BACKUP_APP="$BACKUP_ROOT/Asterlyn.backup"
cleanup() {{
  hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
  rmdir "$MOUNT_DIR" >/dev/null 2>&1 || true
}}
trap cleanup EXIT
hdiutil attach -nobrowse -quiet -readonly -mountpoint "$MOUNT_DIR" "$DMG_PATH"
SOURCE_APP="$MOUNT_DIR/Asterlyn.app"
[ -d "$SOURCE_APP" ]
codesign --verify --deep --strict "$SOURCE_APP"
rm -rf "$STAGED_APP"
ditto "$SOURCE_APP" "$STAGED_APP"
codesign --verify --deep --strict "$STAGED_APP"
while pgrep -x asterlyn >/dev/null 2>&1; do sleep 0.3; done
if [ -d "$APP_PATH" ]; then
  ditto "$APP_PATH" "$BACKUP_APP"
  rm -rf "$APP_PATH"
fi
if ! mv "$STAGED_APP" "$APP_PATH"; then
  if [ -d "$BACKUP_APP" ]; then mv "$BACKUP_APP" "$APP_PATH"; fi
  exit 1
fi
if ! codesign --verify --deep --strict "$APP_PATH"; then
  rm -rf "$APP_PATH"
  if [ -d "$BACKUP_APP" ]; then mv "$BACKUP_APP" "$APP_PATH"; fi
  exit 1
fi
rm -rf "$BACKUP_ROOT"
open "$APP_PATH" >/dev/null 2>&1 || true
rm -f "$DMG_PATH" "$SCRIPT_PATH" >/dev/null 2>&1 || true
"#,
        dmg_path = shell_single_quote(&dmg_path.to_string_lossy()),
        app_path = shell_single_quote(&app_path.to_string_lossy()),
    )
}

#[cfg(target_os = "windows")]
fn launch_windows_installer(path: &Path) -> Result<(), String> {
    if path.extension().and_then(|value| value.to_str()) != Some("exe") {
        return Err("The Windows update package is not an executable installer.".to_string());
    }
    let current_executable = env::current_exe()
        .map_err(|error| format!("Could not locate the installed Asterlyn executable: {error}"))?;
    let script_path = env::temp_dir().join(format!("install-asterlyn-{}.cmd", std::process::id()));
    fs::write(
        &script_path,
        windows_install_script(path, &current_executable),
    )
    .map_err(|error| format!("Could not create the Windows update script: {error}"))?;
    hidden_command("cmd")
        .arg("/C")
        .arg("call")
        .arg(&script_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not start the Windows update script: {error}"))
}

#[cfg(any(target_os = "windows", test))]
fn windows_install_script(installer: &Path, current_executable: &Path) -> String {
    format!(
        r#"@echo off
setlocal
set "INSTALLER={installer}"
set "ASTERLYN_EXE={current_executable}"
:wait_app
tasklist /FI "IMAGENAME eq asterlyn.exe" 2>NUL | find /I "asterlyn.exe" >NUL
if not errorlevel 1 (
  timeout /T 1 /NOBREAK >NUL
  goto wait_app
)
start "" /WAIT "%INSTALLER%" /S
if exist "%ASTERLYN_EXE%" start "" "%ASTERLYN_EXE%"
del /F /Q "%INSTALLER%" >NUL 2>NUL
del /F /Q "%~f0" >NUL 2>NUL
"#,
        installer = windows_batch_value(installer),
        current_executable = windows_batch_value(current_executable),
    )
}

#[cfg(any(target_os = "windows", test))]
fn windows_batch_value(path: &Path) -> String {
    path.to_string_lossy().replace('%', "%%").replace('"', "")
}

#[cfg(target_os = "linux")]
fn launch_linux_installer(path: &Path) -> Result<(), String> {
    let is_app_image = path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("AppImage"));
    let extension = path.extension().and_then(|value| value.to_str());
    let script_path = env::temp_dir().join(format!("install-asterlyn-{}.sh", std::process::id()));
    let script = if is_app_image {
        let target = env::var("APPIMAGE")
            .map_err(|_| "Could not locate the running AppImage.".to_string())?;
        linux_app_image_script(path, Path::new(&target))
    } else if extension == Some("deb") {
        require_linux_package_tools("dpkg")?;
        linux_deb_script(path)
    } else if extension == Some("rpm") {
        require_linux_package_tools("rpm")?;
        linux_rpm_script(path)
    } else {
        return Err("The Linux update package format is unsupported.".to_string());
    };
    fs::write(&script_path, script)
        .map_err(|error| format!("Could not create the Linux update script: {error}"))?;
    Command::new("sh")
        .arg(&script_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not start the Linux update script: {error}"))
}

#[cfg(target_os = "linux")]
fn command_succeeds(program: &str) -> bool {
    hidden_command(program)
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn require_linux_package_tools(package_manager: &str) -> Result<(), String> {
    if !command_succeeds(package_manager) {
        return Err(format!(
            "The required Linux package manager ({package_manager}) is unavailable."
        ));
    }
    if !command_succeeds("pkexec") {
        return Err("The graphical privilege helper (pkexec) is unavailable.".to_string());
    }
    Ok(())
}

#[cfg(any(target_os = "linux", test))]
fn linux_app_image_script(package: &Path, target: &Path) -> String {
    format!(
        r#"#!/bin/sh
set -eu
PACKAGE={package}
TARGET={target}
SCRIPT_PATH="$0"
STAGED="$TARGET.asterlyn-update"
BACKUP="$TARGET.asterlyn-previous"
cp "$PACKAGE" "$STAGED"
chmod 755 "$STAGED"
while pgrep -x asterlyn >/dev/null 2>&1; do sleep 0.3; done
rm -f "$BACKUP"
if [ -f "$TARGET" ]; then mv "$TARGET" "$BACKUP"; fi
if ! mv "$STAGED" "$TARGET"; then
  if [ -f "$BACKUP" ]; then mv "$BACKUP" "$TARGET"; fi
  exit 1
fi
chmod 755 "$TARGET"
rm -f "$BACKUP" "$PACKAGE" "$SCRIPT_PATH" >/dev/null 2>&1 || true
"$TARGET" >/dev/null 2>&1 &
"#,
        package = shell_single_quote(&package.to_string_lossy()),
        target = shell_single_quote(&target.to_string_lossy()),
    )
}

#[cfg(any(target_os = "linux", test))]
fn linux_deb_script(package: &Path) -> String {
    format!(
        r#"#!/bin/sh
set -eu
PACKAGE={package}
SCRIPT_PATH="$0"
while pgrep -x asterlyn >/dev/null 2>&1; do sleep 0.3; done
pkexec dpkg -i "$PACKAGE"
rm -f "$PACKAGE" "$SCRIPT_PATH" >/dev/null 2>&1 || true
asterlyn >/dev/null 2>&1 &
"#,
        package = shell_single_quote(&package.to_string_lossy()),
    )
}

#[cfg(any(target_os = "linux", test))]
fn linux_rpm_script(package: &Path) -> String {
    format!(
        r#"#!/bin/sh
set -eu
PACKAGE={package}
SCRIPT_PATH="$0"
while pgrep -x asterlyn >/dev/null 2>&1; do sleep 0.3; done
pkexec rpm -U --replacepkgs "$PACKAGE"
rm -f "$PACKAGE" "$SCRIPT_PATH" >/dev/null 2>&1 || true
asterlyn >/dev/null 2>&1 &
"#,
        package = shell_single_quote(&package.to_string_lossy()),
    )
}

#[cfg(any(target_os = "macos", target_os = "linux", test))]
fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn sanitize_file_name(name: &str) -> Option<String> {
    let sanitized = name
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(*character, '.' | '-' | '_')
        })
        .collect::<String>();
    (!sanitized.is_empty()).then_some(sanitized)
}

fn normalize_version(version: &str) -> &str {
    version.trim().trim_start_matches(['v', 'V'])
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
    normalize_version(version)
        .chars()
        .take_while(|character| character.is_ascii_digit() || *character == '.')
        .collect::<String>()
        .split('.')
        .filter_map(|part| part.parse().ok())
        .collect()
}

fn release_version_parts(version: &str) -> Option<Vec<u64>> {
    let parts = normalize_version(version)
        .split('.')
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    (parts.len() == 3).then_some(parts)
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

    fn asset(name: &str, size: u64, digest: Option<&str>) -> GitHubAsset {
        GitHubAsset {
            name: name.to_string(),
            browser_download_url: format!("{RELEASE_DOWNLOAD_PREFIX}v1.2.3/{name}"),
            size,
            digest: digest.map(str::to_string),
        }
    }

    fn digest() -> &'static str {
        "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    }

    #[test]
    fn compares_numeric_release_versions() {
        assert_eq!(compare_versions("v1.10.0", "1.9.9"), Ordering::Greater);
        assert_eq!(compare_versions("v1.2", "1.2.0"), Ordering::Equal);
        assert_eq!(compare_versions("0.9.9", "v1.0.0"), Ordering::Less);
    }

    #[test]
    fn selects_exact_platform_assets_and_rejects_ambiguity() {
        let assets = vec![
            asset("Asterlyn_1.2.3_aarch64.dmg", 20, Some(digest())),
            asset("Asterlyn_1.2.3_x64.dmg", 20, Some(digest())),
            asset("Asterlyn_1.2.3_x64-setup.exe", 20, Some(digest())),
            asset("Asterlyn_1.2.3_amd64.AppImage", 20, Some(digest())),
            asset("Asterlyn_1.2.3_amd64.deb", 20, Some(digest())),
            asset("Asterlyn-1.2.3-1.x86_64.rpm", 20, Some(digest())),
        ];
        assert_eq!(
            select_release_asset(&assets, "macos", "aarch64", LinuxInstallerKind::Unsupported,)
                .map(|item| item.name.as_str()),
            Some("Asterlyn_1.2.3_aarch64.dmg")
        );
        assert_eq!(
            select_release_asset(&assets, "linux", "x86_64", LinuxInstallerKind::AppImage,)
                .map(|item| item.name.as_str()),
            Some("Asterlyn_1.2.3_amd64.AppImage")
        );
        assert_eq!(
            select_release_asset(&assets, "linux", "x86_64", LinuxInstallerKind::Rpm)
                .map(|item| item.name.as_str()),
            Some("Asterlyn-1.2.3-1.x86_64.rpm")
        );
        assert!(
            select_release_asset(&assets, "linux", "aarch64", LinuxInstallerKind::Debian,)
                .is_none()
        );
        let duplicates = vec![
            asset("Asterlyn_1.2.3_x64.dmg", 20, Some(digest())),
            asset("Copy_Asterlyn_1.2.3_x64.dmg", 20, Some(digest())),
        ];
        assert!(
            select_release_asset(
                &duplicates,
                "macos",
                "x86_64",
                LinuxInstallerKind::Unsupported,
            )
            .is_none()
        );
    }

    #[test]
    fn installer_metadata_is_repository_scoped_and_bounded() {
        assert!(valid_asset(&asset(
            "Asterlyn_1.2.3_aarch64.dmg",
            20,
            Some(digest())
        )));
        let mut external = asset("Asterlyn_1.2.3_aarch64.dmg", 20, Some(digest()));
        external.browser_download_url = "https://example.com/Asterlyn.dmg".to_string();
        assert!(!valid_asset(&external));
        assert!(!valid_asset(&asset("../Asterlyn.dmg", 20, Some(digest()))));
        assert!(!valid_asset(&asset(
            "Asterlyn_1.2.3_aarch64.dmg",
            MAX_UPDATE_BYTES + 1,
            Some(digest())
        )));
        assert!(!valid_asset(&asset("Asterlyn_1.2.3_aarch64.dmg", 20, None)));
    }

    #[test]
    fn platform_scripts_wait_replace_and_reopen() {
        let mac = macos_install_script(
            Path::new("/tmp/Asterlyn update.dmg"),
            Path::new("/Applications/Asterlyn.app"),
        );
        assert!(mac.contains("hdiutil attach -nobrowse"));
        assert!(mac.contains("codesign --verify --deep --strict"));
        assert!(mac.contains("Asterlyn.backup"));
        assert!(mac.contains("ditto \"$APP_PATH\" \"$BACKUP_APP\""));
        assert!(mac.contains("rm -rf \"$APP_PATH\""));
        assert!(!mac.contains("mv \"$APP_PATH\" \"$BACKUP_APP\""));
        assert!(mac.contains("open \"$APP_PATH\""));
        let windows = windows_install_script(
            Path::new(r"C:\Temp\Asterlyn_setup.exe"),
            Path::new(r"C:\Users\person\AppData\Local\Asterlyn\asterlyn.exe"),
        );
        assert!(windows.contains("/WAIT \"%INSTALLER%\" /S"));
        assert!(windows.contains("%ASTERLYN_EXE%"));
        let linux = linux_app_image_script(
            Path::new("/tmp/Asterlyn.AppImage"),
            Path::new("/home/person/Asterlyn.AppImage"),
        );
        assert!(linux.contains("$TARGET.asterlyn-previous"));
        assert!(linux.contains("mv \"$STAGED\" \"$TARGET\""));
        assert!(linux.contains("\"$TARGET\" >/dev/null"));
        let debian = linux_deb_script(Path::new("/tmp/Asterlyn.deb"));
        assert!(debian.contains("pkexec dpkg -i \"$PACKAGE\""));
        assert!(debian.contains("asterlyn >/dev/null"));
        let rpm = linux_rpm_script(Path::new("/tmp/Asterlyn.rpm"));
        assert!(rpm.contains("pkexec rpm -U --replacepkgs \"$PACKAGE\""));
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
