use std::ffi::OsString;
use std::path::Path;
use std::process::{Command, Stdio};

use asterlyn_workspace::{WorkspaceEntryKind, WorkspaceError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RevealWorkspaceEntryResult {
    pub selected: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
enum DesktopPlatform {
    Macos,
    Windows,
    Freedesktop,
}

#[derive(Debug, PartialEq, Eq)]
struct RevealInvocation {
    program: OsString,
    args: Vec<OsString>,
    selected: bool,
}

pub fn reveal_workspace_entry(
    path: &Path,
    kind: WorkspaceEntryKind,
) -> Result<RevealWorkspaceEntryResult, WorkspaceError> {
    let invocation = reveal_invocation(current_platform()?, path, kind)?;
    Command::new(&invocation.program)
        .args(&invocation.args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| WorkspaceError::Io {
            operation: "show workspace entry in system file manager".to_string(),
            message: error.to_string(),
        })?;
    Ok(RevealWorkspaceEntryResult {
        selected: invocation.selected,
    })
}

fn current_platform() -> Result<DesktopPlatform, WorkspaceError> {
    #[cfg(target_os = "macos")]
    return Ok(DesktopPlatform::Macos);
    #[cfg(target_os = "windows")]
    return Ok(DesktopPlatform::Windows);
    #[cfg(all(unix, not(target_os = "macos")))]
    return Ok(DesktopPlatform::Freedesktop);
    #[allow(unreachable_code)]
    Err(WorkspaceError::UnsupportedFile {
        message: "the current platform has no supported system file manager adapter".to_string(),
    })
}

fn reveal_invocation(
    platform: DesktopPlatform,
    path: &Path,
    kind: WorkspaceEntryKind,
) -> Result<RevealInvocation, WorkspaceError> {
    match (platform, kind) {
        (DesktopPlatform::Macos, WorkspaceEntryKind::File) => Ok(RevealInvocation {
            program: OsString::from("open"),
            args: vec![OsString::from("-R"), path.as_os_str().to_owned()],
            selected: true,
        }),
        (DesktopPlatform::Macos, WorkspaceEntryKind::Directory) => Ok(RevealInvocation {
            program: OsString::from("open"),
            args: vec![path.as_os_str().to_owned()],
            selected: false,
        }),
        (DesktopPlatform::Windows, WorkspaceEntryKind::File) => {
            let mut selection = OsString::from("/select,");
            selection.push(path.as_os_str());
            Ok(RevealInvocation {
                program: OsString::from("explorer.exe"),
                args: vec![selection],
                selected: true,
            })
        }
        (DesktopPlatform::Windows, WorkspaceEntryKind::Directory) => Ok(RevealInvocation {
            program: OsString::from("explorer.exe"),
            args: vec![path.as_os_str().to_owned()],
            selected: false,
        }),
        (DesktopPlatform::Freedesktop, WorkspaceEntryKind::File) => Ok(RevealInvocation {
            program: OsString::from("xdg-open"),
            args: vec![parent(path)?.to_owned().into_os_string()],
            selected: false,
        }),
        (DesktopPlatform::Freedesktop, WorkspaceEntryKind::Directory) => Ok(RevealInvocation {
            program: OsString::from("xdg-open"),
            args: vec![path.as_os_str().to_owned()],
            selected: false,
        }),
    }
}

fn parent(path: &Path) -> Result<&Path, WorkspaceError> {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| WorkspaceError::InvalidPath {
            message: "a workspace file must have a parent directory".to_string(),
        })
}

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;

    use super::*;

    #[test]
    fn platform_invocations_are_argument_safe_and_linux_is_honest_about_selection() {
        let file = Path::new("/workspace/a file.txt");
        let macos =
            reveal_invocation(DesktopPlatform::Macos, file, WorkspaceEntryKind::File).unwrap();
        assert_eq!(macos.program, OsStr::new("open"));
        assert_eq!(
            macos.args,
            [OsString::from("-R"), file.as_os_str().to_owned()]
        );
        assert!(macos.selected);

        let windows =
            reveal_invocation(DesktopPlatform::Windows, file, WorkspaceEntryKind::File).unwrap();
        assert_eq!(windows.program, OsStr::new("explorer.exe"));
        assert_eq!(
            windows.args,
            [OsString::from("/select,/workspace/a file.txt")]
        );
        assert!(windows.selected);

        let linux = reveal_invocation(DesktopPlatform::Freedesktop, file, WorkspaceEntryKind::File)
            .unwrap();
        assert_eq!(linux.program, OsStr::new("xdg-open"));
        assert_eq!(linux.args, [OsString::from("/workspace")]);
        assert!(!linux.selected);
    }

    #[test]
    fn directories_open_directly_on_every_supported_platform() {
        let directory = Path::new("/workspace/folder");
        for platform in [
            DesktopPlatform::Macos,
            DesktopPlatform::Windows,
            DesktopPlatform::Freedesktop,
        ] {
            let invocation =
                reveal_invocation(platform, directory, WorkspaceEntryKind::Directory).unwrap();
            assert_eq!(invocation.args, [directory.as_os_str()]);
            assert!(!invocation.selected);
        }
    }
}
