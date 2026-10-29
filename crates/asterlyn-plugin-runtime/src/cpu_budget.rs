use std::collections::VecDeque;
use std::io;
use std::time::Duration;

pub(crate) const WINDOW: Duration = Duration::from_secs(60);
pub(crate) const SAMPLE_INTERVAL: Duration = Duration::from_millis(250);
const CPU_ALLOWANCE: Duration = Duration::from_secs(60);

/// A bounded history of cumulative OS CPU counters, never a process lifetime allowance.
pub(crate) struct CpuBudget {
    samples: VecDeque<(Duration, Duration)>,
    last: (Duration, Duration),
}

impl CpuBudget {
    pub(crate) fn new() -> Self {
        Self {
            samples: VecDeque::from([(Duration::ZERO, Duration::ZERO)]),
            last: (Duration::ZERO, Duration::ZERO),
        }
    }

    pub(crate) fn observe(&mut self, at: Duration, cpu: Duration) -> io::Result<bool> {
        if at < self.last.0 || cpu < self.last.1 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "plugin CPU or monotonic time counter moved backwards",
            ));
        }
        // A suspended/unscheduled host has no samples covering this window. Do not
        // attribute work before that gap to the current window.
        if at.saturating_sub(self.last.0) > WINDOW {
            self.samples.clear();
            self.samples.push_back((at, cpu));
            self.last = (at, cpu);
            return Ok(false);
        }
        self.last = (at, cpu);
        let cutoff = at.saturating_sub(WINDOW);
        // Keep one sample at/before the boundary, allowing at most one sample's
        // conservative overcount, rather than losing the oldest partial interval.
        while self.samples.len() > 1 && self.samples[1].0 <= cutoff {
            self.samples.pop_front();
        }
        let baseline = self.samples.front().expect("CPU baseline").1;
        let exceeded = cpu.saturating_sub(baseline) >= CPU_ALLOWANCE;
        if at.saturating_sub(self.samples.back().expect("CPU sample").0) >= SAMPLE_INTERVAL {
            self.samples.push_back((at, cpu));
        }
        Ok(exceeded)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legitimate_work_never_expires_after_sixty_lifetime_cpu_seconds() {
        let mut budget = CpuBudget::new();
        for second in 0..=7_200 {
            // 1,440 lifetime CPU seconds over two hours, 12 per current window.
            assert!(
                !budget
                    .observe(
                        Duration::from_secs(second),
                        Duration::from_millis(second * 200)
                    )
                    .unwrap()
            );
            assert!(budget.samples.len() <= 62);
        }
    }

    #[test]
    fn sustained_excess_is_stopped_and_old_work_expires() {
        let mut budget = CpuBudget::new();
        for second in 0..30 {
            assert!(
                !budget
                    .observe(Duration::from_secs(second), Duration::from_secs(second * 2))
                    .unwrap()
            );
        }
        assert!(
            budget
                .observe(Duration::from_secs(30), Duration::from_secs(60))
                .unwrap()
        );
        for second in 31..=91 {
            budget
                .observe(Duration::from_secs(second), Duration::from_secs(60))
                .unwrap();
        }
        assert!(
            !budget
                .observe(Duration::from_secs(92), Duration::from_secs(61))
                .unwrap()
        );
    }

    #[test]
    fn suspend_gap_does_not_charge_old_cpu_to_a_new_window() {
        let mut budget = CpuBudget::new();
        assert!(
            !budget
                .observe(Duration::from_secs(30), Duration::from_secs(50))
                .unwrap()
        );
        assert!(
            !budget
                .observe(Duration::from_secs(300), Duration::from_secs(65))
                .unwrap()
        );
        assert!(
            !budget
                .observe(Duration::from_secs(301), Duration::from_secs(66))
                .unwrap()
        );
    }

    #[test]
    fn counter_regressions_fail_closed() {
        let mut budget = CpuBudget::new();
        budget
            .observe(Duration::from_secs(10), Duration::from_secs(5))
            .unwrap();
        assert!(
            budget
                .observe(Duration::from_secs(9), Duration::from_secs(6))
                .is_err()
        );
        assert!(
            budget
                .observe(Duration::from_secs(11), Duration::from_secs(4))
                .is_err()
        );
    }

    #[test]
    fn high_frequency_observations_have_bounded_storage() {
        let mut budget = CpuBudget::new();
        for ms in 0..=180_000 {
            assert!(
                !budget
                    .observe(Duration::from_millis(ms), Duration::from_millis(ms / 10))
                    .unwrap()
            );
            assert!(budget.samples.len() <= 242);
        }
    }
}
