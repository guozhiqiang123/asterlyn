//! Process groups for host-owned subprocesses, shared by language and auxiliary programs.
use std::process::Command;

pub fn configure_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x00000200 | 0x08000000);
    }
}

/// Caller must own the process and have launched it in a fresh process group.
pub fn signal_process_tree(pid: u32, force: bool) {
    if pid == 0 || pid == std::process::id() {
        return;
    }
    #[cfg(unix)]
    unsafe {
        libc::kill(
            -(pid as i32),
            if force { libc::SIGKILL } else { libc::SIGTERM },
        );
    }
    #[cfg(windows)]
    {
        use std::{path::PathBuf, process::Stdio};
        if let Some(root) = std::env::var_os("SystemRoot") {
            let _ = Command::new(PathBuf::from(root).join("System32/taskkill.exe"))
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        let _ = force;
    }
}
pub fn terminate_process_tree(pid: u32) {
    signal_process_tree(pid, true);
}
