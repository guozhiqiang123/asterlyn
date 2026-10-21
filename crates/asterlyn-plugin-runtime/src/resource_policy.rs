use std::process::{Child, Command};

#[cfg(any(target_os = "linux", target_os = "macos", windows))]
pub(crate) const PROCESS_MEMORY_LIMIT_BYTES: u64 = 768 * 1024 * 1024;
pub(crate) const PROCESS_CPU_LIMIT_SECONDS: u64 = 60;
#[cfg(windows)]
const PROCESS_LIMIT: u32 = 16;

#[cfg(target_os = "linux")]
type Resource = libc::__rlimit_resource_t;
#[cfg(all(unix, not(target_os = "linux")))]
type Resource = libc::c_int;

#[cfg(unix)]
pub(crate) fn configure(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    // SAFETY: pre_exec performs only async-signal-safe setrlimit calls and constructs no shared
    // Rust state in the child. Failure aborts the spawn before untrusted plugin code can run.
    unsafe {
        command.pre_exec(|| {
            #[cfg(target_os = "linux")]
            lower_soft_limit(libc::RLIMIT_AS, PROCESS_MEMORY_LIMIT_BYTES)?;
            // macOS packaged memory enforcement requires a tested sandbox/ledger mechanism;
            // RLIMIT_DATA does not cover JavaScript engine mappings and is intentionally not claimed.
            lower_soft_limit(libc::RLIMIT_CPU, PROCESS_CPU_LIMIT_SECONDS)?;
            Ok(())
        });
    }
}

#[cfg(unix)]
fn lower_soft_limit(resource: Resource, limit: u64) -> std::io::Result<()> {
    let mut current = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    // SAFETY: pointers reference initialized process-local storage for the duration of each call.
    unsafe {
        if libc::getrlimit(resource, &mut current) != 0 {
            return Err(std::io::Error::last_os_error());
        }
        let requested = limit as libc::rlim_t;
        let cpu = libc::rlimit {
            rlim_cur: current.rlim_cur.min(requested),
            rlim_max: current.rlim_max,
        };
        if libc::setrlimit(resource, &cpu) != 0 {
            return Err(std::io::Error::last_os_error());
        }
    }
    Ok(())
}

#[cfg(not(unix))]
pub(crate) fn configure(_command: &mut Command) {
    // Windows limits are attached to the concrete child handle immediately after spawn.
}

#[cfg(not(windows))]
pub(crate) struct ProcessResourceGuard;

#[cfg(all(not(windows), not(target_os = "macos")))]
pub(crate) fn attach(_child: &Child) -> std::io::Result<ProcessResourceGuard> {
    Ok(ProcessResourceGuard)
}

#[cfg(target_os = "macos")]
pub(crate) fn attach(child: &Child) -> std::io::Result<ProcessResourceGuard> {
    process_memory_bytes(child.id())?;
    Ok(ProcessResourceGuard)
}

#[cfg(target_os = "macos")]
pub(crate) fn limit_violation(pid: u32) -> std::io::Result<Option<&'static str>> {
    Ok((process_memory_bytes(pid)? > PROCESS_MEMORY_LIMIT_BYTES)
        .then_some("plugin helper exceeded the 768 MiB resident-memory policy"))
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn limit_violation(_pid: u32) -> std::io::Result<Option<&'static str>> {
    Ok(None)
}

#[cfg(target_os = "macos")]
fn process_memory_bytes(pid: u32) -> std::io::Result<u64> {
    // SAFETY: rusage_info_v2 is a plain C integer structure; zero is a valid initialization
    // before proc_pid_rusage overwrites it.
    let mut usage: libc::rusage_info_v2 = unsafe { std::mem::zeroed() };
    // SAFETY: the kernel writes the requested v2 structure into initialized local storage.
    let status = unsafe {
        libc::proc_pid_rusage(
            pid as libc::c_int,
            libc::RUSAGE_INFO_V2,
            std::ptr::from_mut(&mut usage).cast(),
        )
    };
    if status != 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(usage.ri_phys_footprint)
}

#[cfg(windows)]
pub(crate) struct ProcessResourceGuard {
    job: usize,
}

#[cfg(windows)]
pub(crate) fn attach(child: &Child) -> std::io::Result<ProcessResourceGuard> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_ACTIVE_PROCESS,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
        JOB_OBJECT_LIMIT_PROCESS_TIME, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JobObjectExtendedLimitInformation, SetInformationJobObject,
    };

    // SAFETY: all handles are checked, the information buffer has the exact documented layout,
    // and the returned job handle is closed exactly once by ProcessResourceGuard.
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            | JOB_OBJECT_LIMIT_PROCESS_MEMORY
            | JOB_OBJECT_LIMIT_PROCESS_TIME
            | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
        limits.BasicLimitInformation.PerProcessUserTimeLimit =
            (PROCESS_CPU_LIMIT_SECONDS * 10_000_000) as i64;
        limits.BasicLimitInformation.ActiveProcessLimit = PROCESS_LIMIT;
        limits.ProcessMemoryLimit = PROCESS_MEMORY_LIMIT_BYTES as usize;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            std::ptr::from_ref(&limits).cast(),
            std::mem::size_of_val(&limits) as u32,
        ) == 0
        {
            let error = std::io::Error::last_os_error();
            CloseHandle(job);
            return Err(error);
        }
        if AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE) == 0 {
            let error = std::io::Error::last_os_error();
            CloseHandle(job);
            return Err(error);
        }
        Ok(ProcessResourceGuard { job: job as usize })
    }
}

#[cfg(windows)]
impl Drop for ProcessResourceGuard {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};

        // SAFETY: this guard owns the job handle and drops it once. KILL_ON_JOB_CLOSE ensures no
        // plugin-owned descendant survives a host cleanup path.
        unsafe {
            CloseHandle(self.job as HANDLE);
        }
    }
}
