use std::{collections::BTreeSet, fs, path::Path};
/// Bound traversal before hashing. Conventional dependency/output trees cannot be model inputs.
pub(super) fn fingerprint(root: &Path, globs: &[String]) -> Result<String, String> {
    let patterns = globs
        .iter()
        .map(|pattern| glob::Pattern::new(pattern).map_err(|_| "invalid analysis input pattern"))
        .collect::<Result<Vec<_>, _>>()?;
    let mut paths = BTreeSet::new();
    let mut remaining = 100_000usize;
    fn walk(
        root: &Path,
        relative: &Path,
        patterns: &[glob::Pattern],
        paths: &mut BTreeSet<String>,
        remaining: &mut usize,
        depth: usize,
    ) -> Result<(), String> {
        if depth > 32 {
            return Err("model input directory depth exceeds its bound".into());
        }
        for entry in fs::read_dir(root.join(relative)).map_err(|_| "model inputs unavailable")? {
            let entry = entry.map_err(|_| "model inputs unavailable")?;
            *remaining = remaining
                .checked_sub(1)
                .ok_or("model input catalog exceeds its bound")?;
            let kind = entry.file_type().map_err(|_| "model inputs unavailable")?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            let path = relative.join(name);
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if ![
                    ".git",
                    ".gradle",
                    ".idea",
                    "node_modules",
                    "target",
                    "build",
                    "out",
                ]
                .contains(&name)
                {
                    walk(root, &path, patterns, paths, remaining, depth + 1)?;
                }
            } else if kind.is_file() {
                let path = path.to_string_lossy().replace('\\', "/");
                if patterns.iter().any(|pattern| pattern.matches(&path)) {
                    paths.insert(path);
                    if paths.len() > 4096 {
                        return Err("model input count exceeds its bound".into());
                    }
                }
            }
        }
        Ok(())
    }
    walk(
        root,
        Path::new(""),
        &patterns,
        &mut paths,
        &mut remaining,
        0,
    )?;
    // Missing explicit inputs matter too (for example a subsequently created local configuration).
    paths.extend(
        globs
            .iter()
            .filter(|pattern| !pattern.contains(['*', '?', '[']))
            .cloned(),
    );
    let result = crate::application::plugin_task_cache::compute_fingerprint(
        root,
        &paths.into_iter().collect::<Vec<_>>(),
    );
    result.digest.ok_or_else(|| {
        result
            .reason
            .unwrap_or_else(|| "model inputs unavailable".into())
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn content_and_new_inputs_invalidate_without_scanning_outputs() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("build.gradle"), "a").unwrap();
        fs::create_dir(root.path().join("build")).unwrap();
        fs::write(root.path().join("build/ignored.gradle"), "x").unwrap();
        let patterns = vec!["*.gradle".into(), "local.properties".into()];
        let a = fingerprint(root.path(), &patterns).unwrap();
        fs::write(root.path().join("build/ignored.gradle"), "y").unwrap();
        assert_eq!(a, fingerprint(root.path(), &patterns).unwrap());
        fs::write(root.path().join("local.properties"), "b").unwrap();
        assert_ne!(a, fingerprint(root.path(), &patterns).unwrap());
    }
}
