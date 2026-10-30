//! Generic storage only. Language plugins own artifact schemas and invalidation.
use std::{
    fs,
    path::{Path, PathBuf},
};

pub(super) fn directory(parent: &Path, identity: &str) -> Result<PathBuf, String> {
    if identity.len() != 64 || !identity.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("invalid language cache identity".into());
    }
    let base = parent.join("persistent-v1");
    let target = base.join(identity);
    for path in [parent, base.as_path(), target.as_path()] {
        match fs::symlink_metadata(path) {
            Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => {}
            Ok(_) => return Err("unsafe language cache directory".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let mut builder = fs::DirBuilder::new();
                #[cfg(unix)]
                {
                    use std::os::unix::fs::DirBuilderExt;
                    builder.mode(0o700);
                }
                if let Err(error) = builder.create(path) {
                    if error.kind() != std::io::ErrorKind::AlreadyExists {
                        return Err("language cache directory unavailable".into());
                    }
                }
                let meta = fs::symlink_metadata(path)
                    .map_err(|_| "language cache directory unavailable")?;
                if !meta.is_dir() || meta.file_type().is_symlink() {
                    return Err("unsafe language cache directory".into());
                }
            }
            Err(_) => return Err("language cache directory unavailable".into()),
        }
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_survives_session_cleanup_and_is_identity_scoped() {
        let parent = tempfile::tempdir().unwrap();
        let first = directory(parent.path(), &"a".repeat(64)).unwrap();
        fs::write(first.join("artifact"), "verified").unwrap();
        let session = tempfile::tempdir_in(parent.path()).unwrap();
        drop(session);
        assert_eq!(directory(parent.path(), &"a".repeat(64)).unwrap(), first);
        assert!(first.join("artifact").exists());
        assert_ne!(first, directory(parent.path(), &"b".repeat(64)).unwrap());
        assert!(directory(parent.path(), "../escape").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn rejects_redirected_cache_namespace() {
        let parent = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), parent.path().join("persistent-v1")).unwrap();
        assert!(directory(parent.path(), &"a".repeat(64)).is_err());
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
    }
}
