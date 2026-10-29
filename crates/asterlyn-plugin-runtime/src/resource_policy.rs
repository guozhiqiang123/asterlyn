use std::process::{Child, Command};
use std::time::{Duration, Instant};

use crate::cpu_budget::{CpuBudget, SAMPLE_INTERVAL};

pub(crate) const PROCESS_MEMORY_LIMIT_BYTES: u64 = 768 * 1024 * 1024;
#[cfg(windows)]
const PROCESS_LIMIT: u32 = 16;

#[cfg(target_os = "linux")]
pub(crate) fn configure(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    // SAFETY: pre_exec performs only async-signal-safe setrlimit calls and constructs no shared
    // Rust state in the child. Failure aborts the spawn before untrusted plugin code can run.
    unsafe {
        command.pre_exec(|| {
            lower_soft_limit(libc::RLIMIT_AS, PROCESS_MEMORY_LIMIT_BYTES)?;
            Ok(())
        });
    }
}

#[cfg(target_os = "linux")]
fn lower_soft_limit(resource: libc::__rlimit_resource_t, limit: u64) -> std::io::Result<()> {
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

#[cfg(not(target_os = "linux"))]
pub(crate) fn configure(_command: &mut Command) {
    // Windows memory/process limits attach after spawn; macOS memory is sampled.
    // CPU is supervised in a rolling window on every supported platform. A
    // host-imposed RLIMIT_CPU/job lifetime limit would eventually kill healthy
    // long-lived helpers. Inherited OS limits are never raised or removed.
}

#[cfg(not(windows))]
pub(crate) struct ProcessResourceGuard;

#[cfg(all(not(windows), not(target_os = "macos")))]
pub(crate) fn attach(_child: &Child) -> std::io::Result<ProcessResourceGuard> {
    Ok(ProcessResourceGuard)
}

#[cfg(target_os = "macos")]
pub(crate) fn attach(child: &Child) -> std::io::Result<ProcessResourceGuard> {
    process_usage(child.id())?;
    Ok(ProcessResourceGuard)
}

pub(crate) struct ResourceMonitor {
    started: Instant,
    last_sample: Option<Duration>,
    cpu: CpuBudget,
}

impl ResourceMonitor {
    pub(crate) fn new() -> Self {
        Self {
            started: Instant::now(),
            last_sample: None,
            cpu: CpuBudget::new(),
        }
    }

    pub(crate) fn limit_violation(&mut self, pid: u32) -> std::io::Result<Option<&'static str>> {
        let at = self.started.elapsed();
        if self
            .last_sample
            .is_some_and(|last| at.saturating_sub(last) < SAMPLE_INTERVAL)
        {
            return Ok(None);
        }
        let (cpu, memory) = process_usage(pid)?;
        self.last_sample = Some(at);
        if memory.is_some_and(|bytes| bytes > PROCESS_MEMORY_LIMIT_BYTES) {
            return Ok(Some(
                "plugin helper exceeded the 768 MiB resident-memory policy",
            ));
        }
        Ok(self.cpu.observe(at, cpu)?.then_some(
            "plugin helper exceeded 60 CPU seconds in the rolling 60-second resource window",
        ))
    }
}

#[cfg(target_os = "macos")]
fn process_usage(pid: u32) -> std::io::Result<(Duration, Option<u64>)> {
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
    Ok((
        mach_cpu_duration(usage.ri_user_time.saturating_add(usage.ri_system_time))?,
        Some(usage.ri_phys_footprint),
    ))
}

#[cfg(target_os = "macos")]
fn mach_cpu_duration(ticks: u64) -> std::io::Result<Duration> {
    use std::sync::OnceLock;
    // Minimal binding to the stable macOS SDK API; libc moved this binding to
    // another crate, but no Mach task/thread API or additional dependency is needed.
    #[repr(C)]
    struct MachTimebaseInfo {
        numer: u32,
        denom: u32,
    }
    unsafe extern "C" {
        fn mach_timebase_info(info: *mut MachTimebaseInfo) -> i32;
    }
    static TIMEBASE: OnceLock<Result<(u32, u32), i32>> = OnceLock::new();
    let (numer, denom) = TIMEBASE
        .get_or_init(|| {
            let mut info = MachTimebaseInfo { numer: 0, denom: 0 };
            // SAFETY: initialized local output buffer; timebase is immutable per boot.
            let status = unsafe { mach_timebase_info(&mut info) };
            if status != 0 || info.denom == 0 || info.numer == 0 {
                Err(status)
            } else {
                Ok((info.numer, info.denom))
            }
        })
        .as_ref()
        .map_err(|status| std::io::Error::other(format!("read Mach CPU timebase: {status}")))?;
    // XNU fill_task_rusage returns Mach time, not nanoseconds. ARM timebases
    // commonly differ from 1:1; a u128 intermediate avoids multiplication overflow.
    let nanos = u128::from(ticks) * u128::from(*numer) / u128::from(*denom);
    let nanos =
        u64::try_from(nanos).map_err(|_| std::io::Error::other("plugin CPU counter overflow"))?;
    Ok(Duration::from_nanos(nanos))
}

#[cfg(target_os = "linux")]
fn process_usage(pid: u32) -> std::io::Result<(Duration, Option<u64>)> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat"))?;
    // comm can contain spaces and parentheses; fields after the final ')' start
    // at field 3, so utime/stime (14/15) have indices 11/12 here.
    let tail = stat
        .rsplit_once(')')
        .ok_or_else(|| std::io::Error::other("invalid process CPU stat"))?
        .1;
    let ticks = tail
        .split_whitespace()
        .skip(11)
        .take(2)
        .map(|s| s.parse::<u64>().map_err(std::io::Error::other))
        .collect::<std::io::Result<Vec<_>>>()?;
    // SAFETY: sysconf reads a process-independent integer setting.
    let hz = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if ticks.len() != 2 || hz <= 0 {
        return Err(std::io::Error::other("invalid process CPU clock"));
    }
    let total = ticks[0].saturating_add(ticks[1]);
    Ok((
        Duration::from_secs(total / hz as u64)
            + Duration::from_nanos((total % hz as u64) * 1_000_000_000 / hz as u64),
        None,
    ))
}

#[cfg(windows)]
fn process_usage(pid: u32) -> std::io::Result<(Duration, Option<u64>)> {
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME};
    use windows_sys::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    // SAFETY: process handle and output buffers are checked and owned locally.
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let mut created = FILETIME::default();
        let mut exited = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        let result = GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user);
        let error = (result == 0).then(std::io::Error::last_os_error);
        CloseHandle(process);
        if let Some(error) = error {
            return Err(error);
        }
        let ticks = |t: FILETIME| ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64;
        Ok((
            Duration::from_nanos(
                ticks(kernel)
                    .saturating_add(ticks(user))
                    .saturating_mul(100),
            ),
            None,
        ))
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn process_usage(_pid: u32) -> std::io::Result<(Duration, Option<u64>)> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "plugin CPU supervision is unavailable on this platform",
    ))
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
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
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
            | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
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

#[cfg(all(test, any(target_os = "linux", target_os = "macos", windows)))]
mod tests {
    use super::*;

    #[test]
    fn kernel_cpu_counter_advances_with_actual_work() {
        let pid = std::process::id();
        let before = process_usage(pid).expect("initial process usage").0;
        let until = Instant::now() + Duration::from_millis(80);
        let mut n = 1_u64;
        while Instant::now() < until {
            n = std::hint::black_box(n.wrapping_mul(3).wrapping_add(1));
        }
        let after = process_usage(pid).expect("final process usage").0;
        assert!(
            after > before,
            "kernel CPU time must reflect real work: {n}"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mac_cpu_units_match_the_independent_posix_counter() {
        fn posix_cpu() -> Duration {
            // SAFETY: initialized local output buffer for this process.
            let mut usage: libc::rusage = unsafe { std::mem::zeroed() };
            assert_eq!(unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut usage) }, 0);
            let micros = |time: libc::timeval| time.tv_sec as u64 * 1_000_000 + time.tv_usec as u64;
            Duration::from_micros(micros(usage.ru_utime) + micros(usage.ru_stime))
        }
        let before = posix_cpu();
        let observed = process_usage(std::process::id()).unwrap().0;
        let after = posix_cpu();
        let tolerance = Duration::from_millis(5);
        assert!(
            observed + tolerance >= before && observed <= after + tolerance,
            "Mach conversion must agree with POSIX CPU seconds: {before:?} <= {observed:?} <= {after:?}"
        );
    }
}
