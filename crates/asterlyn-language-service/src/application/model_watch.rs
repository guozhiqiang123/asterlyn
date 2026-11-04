//! Observe identity only: never execute an analysis program to discover whether it changed.
use super::*;

pub(super) struct ModelWatch {
    observer: Option<ModelObserver>,
    sender: mpsc::Sender<Result<ModelInputs, ()>>,
    receiver: Receiver<Result<ModelInputs, ()>>,
    pending: bool,
    next: Instant,
    previous: Option<Result<ModelInputs, ()>>,
}
impl ModelWatch {
    pub fn new(observer: Option<ModelObserver>) -> Self {
        let (sender, receiver) = mpsc::channel();
        Self { observer, sender, receiver, pending: false, next: Instant::now(), previous: None }
    }
    pub fn poll(&mut self, alive: &Arc<AtomicBool>, now: Instant) -> Option<&'static str> {
        let mut changed = None;
        if let Ok(value) = self.receiver.try_recv() {
            self.pending = false;
            if let Some(previous) = self.previous.replace(value.clone()) {
                if previous != value {
                    changed = Some(match (&previous, &value) {
                        (_, Err(())) => "inputs-unavailable",
                        (Err(()), Ok(_)) => "inputs-available",
                        (Ok(old), Ok(new)) if old.selection != new.selection => "selection-changed",
                        _ => "inputs-changed",
                    });
                }
            }
        }
        if !self.pending && now >= self.next && alive.load(Ordering::SeqCst) {
            if let Some(observer) = self.observer.clone() {
                self.pending = true;
                self.next = now + Duration::from_secs(2);
                let sender = self.sender.clone();
                let alive = alive.clone();
                std::thread::spawn(move || {
                    if !alive.load(Ordering::SeqCst) { return; }
                    let value = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| observer()))
                        .unwrap_or_else(|_| Err("model observation failed".into())).map_err(|_| ());
                    let _ = sender.send(value);
                });
            }
        }
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn value(input: &str, selection: &str) -> Result<ModelInputs, ()> {
        Ok(ModelInputs { inputs: input.into(), selection: selection.into() })
    }
    #[test]
    fn failed_model_keeps_observing_without_repeated_invalidations() {
        let alive = Arc::new(AtomicBool::new(false));
        let mut watch = ModelWatch::new(None);
        let now = Instant::now();
        for (value, expected) in [
            (value("a", "old"), None), (value("a", "old"), None),
            (value("a", "new"), Some("selection-changed")),
            (value("b", "new"), Some("inputs-changed")),
            (Err(()), Some("inputs-unavailable")), (Err(()), None),
            (value("b", "new"), Some("inputs-available")),
        ] {
            watch.sender.send(value).unwrap();
            assert_eq!(watch.poll(&alive, now), expected);
        }
    }
    #[test]
    fn only_one_probe_can_run_and_unchanged_polling_does_not_start_model_work() {
        let calls = Arc::new(AtomicU64::new(0));
        let count = calls.clone();
        let (release, wait) = mpsc::channel();
        let wait = Mutex::new(wait);
        let mut watch = ModelWatch::new(Some(Arc::new(move || {
            count.fetch_add(1, Ordering::SeqCst);
            wait.lock().unwrap().recv().unwrap();
            Ok(ModelInputs { inputs: "a".into(), selection: "b".into() })
        })));
        let alive = Arc::new(AtomicBool::new(true));
        let now = Instant::now();
        for i in 0..100 { watch.poll(&alive, now + Duration::from_secs(i)); }
        release.send(()).unwrap();
        let until = Instant::now() + Duration::from_secs(2);
        while watch.previous.is_none() && Instant::now() < until {
            watch.poll(&alive, now);
            std::thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(watch.previous.is_some());
        alive.store(false, Ordering::SeqCst);
        watch.poll(&alive, now + Duration::from_secs(200));
        assert!(!watch.pending);
    }
}
