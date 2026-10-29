use std::path::Path;
use std::time::{Duration, Instant};

fn process_cpu() -> Duration {
    // SAFETY: initialized local rusage buffer, read for this fixture only.
    let mut usage: libc::rusage = unsafe { std::mem::zeroed() };
    assert_eq!(unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut usage) }, 0);
    let micros = |time: libc::timeval| time.tv_sec as u64 * 1_000_000 + time.tv_usec as u64;
    Duration::from_micros(micros(usage.ru_utime) + micros(usage.ru_stime))
}

fn burn_for(duration: Duration) {
    let until = Instant::now() + duration;
    let mut n = 1_u64;
    while Instant::now() < until {
        n = std::hint::black_box(n.wrapping_mul(3).wrapping_add(1));
    }
}

pub(super) fn start(evidence: &serde_json::Value, root: &Path) {
    match evidence
        .get("cpuFixture")
        .and_then(serde_json::Value::as_str)
    {
        Some("lifetime") => {
            let completed = root.join("cpu-completed.json");
            std::thread::spawn(move || {
                while process_cpu() < Duration::from_secs(65) {
                    burn_for(Duration::from_millis(25));
                    std::thread::sleep(Duration::from_millis(25));
                }
                std::fs::write(
                    completed,
                    serde_json::json!({"cpuMillis": process_cpu().as_millis()}).to_string(),
                )
                .unwrap();
            });
        }
        Some("excess") => {
            for _ in 0..4 {
                std::thread::spawn(|| {
                    loop {
                        burn_for(Duration::from_secs(1));
                    }
                });
            }
        }
        _ => {}
    }
}
