//! Bounded inspection of installed Java homes. Never executes a discovered binary.
use std::{collections::BTreeSet, fs, path::PathBuf};

pub(crate) fn candidates() -> Vec<PathBuf> {
    let mut roots = vec![
        PathBuf::from("/Library/Java/JavaVirtualMachines"),
        PathBuf::from("/usr/lib/jvm"),
    ];
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        roots.extend([
            home.join("Library/Java/JavaVirtualMachines"),
            home.join(".sdkman/candidates/java"),
            home.join(".jdks"),
        ]);
    }
    #[cfg(windows)]
    if let Some(programs) = std::env::var_os("ProgramFiles").map(PathBuf::from) {
        roots.extend([
            programs.join("Java"),
            programs.join("Eclipse Adoptium"),
            programs.join("Microsoft"),
        ]);
    }
    let mut homes = BTreeSet::new();
    for root in roots {
        if let Ok(entries) = fs::read_dir(root) {
            let mut paths: Vec<_> = entries
                .take(128)
                .flatten()
                .map(|entry| entry.path())
                .collect();
            paths.sort();
            for path in paths {
                homes.insert(if path.join("Contents/Home").is_dir() {
                    path.join("Contents/Home")
                } else {
                    path
                });
            }
        }
    }
    if let Some(home) = std::env::var_os("JAVA_HOME") {
        homes.insert(home.into());
    }
    homes.into_iter().collect()
}

#[cfg(test)]
pub(crate) fn major(release: &str) -> Option<u16> {
    asterlyn_process::toolchain::java_version(release).map(|(_, major)| major)
}
