//! Portable observations. Unavailable measurements never masquerade as zero usage.
pub fn physical_mib() -> Option<u32> {
    #[cfg(target_os = "macos")]
    {
        let mut bytes = 0u64;
        let mut size = std::mem::size_of::<u64>();
        let result = unsafe {
            libc::sysctlbyname(
                c"hw.memsize".as_ptr(),
                (&mut bytes as *mut u64).cast(),
                &mut size,
                std::ptr::null_mut(),
                0,
            )
        };
        if result == 0 && bytes > 0 {
            return u32::try_from(bytes / 1048576).ok();
        }
    }
    #[cfg(target_os = "linux")]
    {
        let pages = unsafe { libc::sysconf(libc::_SC_PHYS_PAGES) };
        let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
        if pages > 0 && page > 0 {
            return u32::try_from(pages as u64 * page as u64 / 1048576).ok();
        }
    }
    None
}
/// Processes remain in the fresh group created by configure_process_group, including JVM children.
/// ps has fixed arguments, bounded output and a one-second deadline; never uses project PATH.
pub fn group_rss_mib(pids: &[u32]) -> Option<u32> {
    #[cfg(unix)]
    {
        use std::{
            io::Read,
            process::{Command, Stdio},
            time::{Duration, Instant},
        };
        let mut child = Command::new("/bin/ps")
            .args(["-axo", "pgid=,rss="])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let pipe = child.stdout.take()?;
        let reader = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            pipe.take(2 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .ok()?;
            Some(bytes)
        });
        let started = Instant::now();
        let mut success = false;
        while started.elapsed() < Duration::from_secs(1) {
            if let Some(status) = child.try_wait().ok()? {
                success = status.success();
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        if !success {
            let _ = child.kill();
        }
        let _ = child.wait();
        let bytes = reader.join().ok()??;
        if !success || bytes.len() > 2 * 1024 * 1024 {
            return None;
        }
        parse(&bytes, pids)
    }
    #[cfg(not(unix))]
    {
        let _ = pids;
        None
    }
}
#[cfg(unix)]
fn parse(bytes: &[u8], pids: &[u32]) -> Option<u32> {
    let mut total = 0u64;
    for line in std::str::from_utf8(bytes).ok()?.lines() {
        let mut parts = line.split_whitespace();
        let group = parts.next()?.parse::<u32>().ok()?;
        let rss = parts.next()?.parse::<u64>().ok()?;
        if pids.contains(&group) {
            total = total.checked_add(rss)?;
        }
    }
    u32::try_from(total.div_ceil(1024)).ok()
}
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn sums_owned_groups_only() {
        assert_eq!(parse(b" 10 1024\n 10 512\n 20 9000\n", &[10]), Some(2));
        assert_eq!(parse(b"invalid", &[10]), None);
    }
}
