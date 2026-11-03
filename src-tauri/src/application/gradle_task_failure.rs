//! Bounded, body-free classification. Raw output remains only in the existing task output path.
use asterlyn_task::OutputStream;

#[derive(Default)]
pub(crate) struct GradleTaskFailure {
    tails: [Vec<u8>; 2],
    inspected: usize,
    java: bool,
    tls: bool,
    dependencies: bool,
    lock: bool,
    storage: bool,
}

impl GradleTaskFailure {
    pub(crate) fn observe(&mut self, stream: &OutputStream, bytes: &[u8]) {
        const MAX_INSPECTED: usize = 2 * 1024 * 1024;
        let allowed = bytes
            .len()
            .min(MAX_INSPECTED.saturating_sub(self.inspected));
        if allowed == 0 {
            return;
        }
        self.inspected += allowed;
        let index = if matches!(stream, OutputStream::Stdout) {
            0
        } else {
            1
        };
        let mut window = std::mem::take(&mut self.tails[index]);
        // Collectors read at most 64 KiB per frame; bound even direct/test callers.
        for chunk in bytes[..allowed].chunks(64 * 1024) {
            window.extend(chunk.iter().map(u8::to_ascii_lowercase));
            let contains = |text: &[u8]| window.windows(text.len()).any(|part| part == text);
            self.java |= [
                b"type t not present".as_slice(),
                b"unsupported class file major version",
                b"unsupported java",
                b"requires java",
            ]
            .iter()
            .any(|text| contains(text));
            self.tls |= [
                b"sslhandshakeexception".as_slice(),
                b"pkix path",
                b"remote host terminated the handshake",
            ]
            .iter()
            .any(|text| contains(text));
            self.dependencies |= contains(b"could not resolve") || contains(b"could not find ");
            self.lock |=
                contains(b"timeout waiting to lock") || contains(b"could not acquire lock");
            self.storage |= contains(b"no space left on device");
            let keep = window.len().min(256);
            window.drain(..window.len() - keep);
        }
        // Detach the small retained tail from the frame's allocation as well as its bytes.
        self.tails[index] = window.to_vec();
    }

    pub(crate) fn message(&self) -> String {
        if self.java { "gradle.failure.java: Gradle could not run with this Java version. Check the project's Gradle Java configuration." }
        else if self.tls { "gradle.failure.tls: Gradle could not establish a secure connection to a dependency repository. Check the task output for the repository and certificate error." }
        else if self.storage { "gradle.failure.storage: Gradle ran out of disk space. Free space and retry." }
        else if self.lock { "gradle.failure.lock: Gradle could not acquire a required cache lock. Check for another Gradle process before retrying." }
        else if self.dependencies { "gradle.failure.dependencies: Gradle could not resolve project dependencies. Check the task output for the missing dependency or repository." }
        else { "gradle.failure.build: Gradle failed while configuring or running the project. Check the task output for details." }.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn classifies_across_frame_boundaries_without_retaining_bodies() {
        let mut failure = GradleTaskFailure::default();
        failure.observe(
            &OutputStream::Stderr,
            b"Could not resolve secret dependency: SSLHandshakeExcep",
        );
        failure.observe(&OutputStream::Stderr, b"tion token=private-value");
        assert!(failure.message().starts_with("gradle.failure.tls:"));
        assert!(!failure.message().contains("private-value"));
        failure.observe(&OutputStream::Stdout, &vec![b'x'; 4 * 1024 * 1024]);
        assert_eq!(failure.inspected, 2 * 1024 * 1024);
        assert!(failure.tails.iter().all(|tail| tail.len() <= 256));
        assert!(failure.tails.iter().all(|tail| tail.capacity() <= 256));
    }
    #[test]
    fn streams_are_not_spliced_and_specific_errors_beat_generic_dependencies() {
        let mut failure = GradleTaskFailure::default();
        failure.observe(&OutputStream::Stdout, b"Type T ");
        failure.observe(&OutputStream::Stderr, b"not present");
        assert!(failure.message().starts_with("gradle.failure.build:"));
        failure.observe(
            &OutputStream::Stderr,
            b"Could not resolve x; Type T not present",
        );
        assert!(failure.message().starts_with("gradle.failure.java:"));
    }
}
