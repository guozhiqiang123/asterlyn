//! Durable project approval. Never a replacement for fresh reviews and launch revalidation.
use super::language_service::LanguagePackage;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::Manager;

const MAX_BYTES: u64 = 256 * 1024;
const MAX_GRANTS: usize = 512;
static LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Store {
    version: u8,
    grants: BTreeMap<String, Grant>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Grant {
    workspace: String,
    fingerprint: String,
}

pub(crate) fn app_store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|root| root.join("language-service-consent-v1.json"))
        .map_err(|_| "language approval directory unavailable".into())
}
fn hash(bytes: impl AsRef<[u8]>) -> String {
    format!("{:x}", Sha256::digest(bytes.as_ref()))
}
fn workspace(root: &Path) -> Result<String, String> {
    let root = root
        .canonicalize()
        .map_err(|_| "language approval workspace unavailable")?;
    let meta = fs::metadata(&root).map_err(|_| "language approval workspace unavailable")?;
    if !meta.is_dir() {
        return Err("language approval requires a directory".into());
    }
    #[cfg(unix)]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        format!("{}:{}", meta.dev(), meta.ino())
    };
    #[cfg(not(unix))]
    let identity = format!(
        "{:?}",
        meta.created()
            .map_err(|_| "workspace creation identity unavailable")?
    );
    Ok(hash(format!("{}\0{identity}", root.to_string_lossy())))
}
fn fingerprint(package: &LanguagePackage) -> String {
    // content_digest includes the model producer, JDKs and managed components for packaged profiles.
    hash(
        serde_json::to_vec(&(
            &package.version,
            &package.digest,
            &package.content_digest,
            &package.node,
            &package.node_digest,
        ))
        .expect("serializable language identities"),
    )
}
pub(super) fn cache_identity(root: &Path, package: &LanguagePackage) -> Result<String, String> {
    Ok(hash(format!(
        "{}\0{}\0{}",
        workspace(root)?,
        package.server_id(),
        fingerprint(package)
    )))
}

fn key(workspace: &str, profile: &str) -> String {
    hash(format!("dev.asterlyn.lsp\0{workspace}\0{profile}"))
}
fn load(path: &Path) -> Result<Store, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Store {
                version: 1,
                ..Store::default()
            });
        }
        Err(_) => return Err("language approval store unavailable".into()),
    };
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err("language approval store exceeds bounds".into());
    }
    let bytes = fs::read(path).map_err(|_| "language approval store unreadable")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("language approval store exceeds bounds".into());
    }
    let file: Store =
        serde_json::from_slice(&bytes).map_err(|_| "language approval store is invalid")?;
    let digest = |s: &str| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit());
    if file.version != 1
        || file.grants.len() > MAX_GRANTS
        || file
            .grants
            .iter()
            .any(|(k, v)| !digest(k) || !digest(&v.workspace) || !digest(&v.fingerprint))
    {
        return Err("language approval store identity is invalid".into());
    }
    Ok(file)
}
fn save(path: &Path, store: &Store) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("language approval store has no parent")?;
    fs::create_dir_all(parent).map_err(|_| "cannot create language approval directory")?;
    let bytes = serde_json::to_vec(store).map_err(|_| "cannot encode language approval")?;
    if bytes.len() as u64 > MAX_BYTES || store.grants.len() > MAX_GRANTS {
        return Err("language approval store is full".into());
    }
    let mut file =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "cannot stage language approval")?;
    file.write_all(&bytes)
        .and_then(|()| file.as_file().sync_all())
        .map_err(|_| "cannot write language approval")?;
    file.persist(path)
        .map_err(|_| "cannot replace language approval")?;
    #[cfg(unix)]
    {
        let _ = fs::File::open(parent).and_then(|dir| dir.sync_all());
    }
    Ok(())
}
pub(crate) fn matches(path: &Path, root: &Path, package: &LanguagePackage) -> Result<bool, String> {
    let _guard = LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "language approval lock unavailable")?;
    let workspace = workspace(root)?;
    Ok(load(path)?
        .grants
        .get(&key(&workspace, package.server_id()))
        .is_some_and(|grant| {
            grant.workspace == workspace && grant.fingerprint == fingerprint(package)
        }))
}
pub(crate) fn remember(path: &Path, root: &Path, package: &LanguagePackage) -> Result<(), String> {
    let _guard = LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "language approval lock unavailable")?;
    let workspace = workspace(root)?;
    let mut store = load(path)?;
    let key = key(&workspace, package.server_id());
    let fingerprint = fingerprint(package);
    if store
        .grants
        .get(&key)
        .is_some_and(|g| g.fingerprint == fingerprint)
    {
        return Ok(());
    }
    store.grants.insert(
        key,
        Grant {
            workspace,
            fingerprint,
        },
    );
    save(path, &store)
}
pub(crate) fn forget(path: &Path, root: &Path) -> Result<(), String> {
    let _guard = LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "language approval lock unavailable")?;
    let workspace = workspace(root)?;
    let mut store = load(path)?;
    store.grants.retain(|_, grant| grant.workspace != workspace);
    save(path, &store)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn package(root: &Path) -> LanguagePackage {
        LanguagePackage {
            version: "0.3.7".into(),
            digest: "package".into(),
            content_digest: "resources".into(),
            root: root.into(),
            node: root.join("node"),
            node_digest: "tool".into(),
            rust: None,
            packaged: None,
        }
    }
    #[test]
    fn persists_but_revalidates_each_security_identity_and_project() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project");
        fs::create_dir(&root).unwrap();
        let path = dir.path().join("consent.json");
        let p = package(&root);
        assert!(!matches(&path, &root, &p).unwrap());
        remember(&path, &root, &p).unwrap();
        assert!(matches(&path, &root, &p).unwrap());
        for changed in [
            LanguagePackage {
                version: "next".into(),
                ..p.clone()
            },
            LanguagePackage {
                digest: "next".into(),
                ..p.clone()
            },
            LanguagePackage {
                content_digest: "next".into(),
                ..p.clone()
            },
            LanguagePackage {
                node_digest: "next".into(),
                ..p.clone()
            },
            LanguagePackage {
                node: root.join("other-node"),
                ..p.clone()
            },
        ] {
            assert!(!matches(&path, &root, &changed).unwrap());
        }
        let other = dir.path().join("worktree");
        fs::create_dir(&other).unwrap();
        assert!(!matches(&path, &other, &p).unwrap());
        #[cfg(unix)]
        {
            let alias = dir.path().join("alias");
            std::os::unix::fs::symlink(&root, &alias).unwrap();
            assert!(matches(&path, &alias, &p).unwrap());
        }
        forget(&path, &root).unwrap();
        assert!(!matches(&path, &root, &p).unwrap());
    }
    #[test]
    fn replaced_directory_corrupt_oversize_and_unknown_store_fail_closed() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project");
        fs::create_dir(&root).unwrap();
        let path = dir.path().join("consent.json");
        let p = package(&root);
        remember(&path, &root, &p).unwrap();
        fs::rename(&root, dir.path().join("old")).unwrap();
        fs::create_dir(&root).unwrap();
        assert!(!matches(&path, &root, &p).unwrap());
        for bytes in [
            b"broken".to_vec(),
            br#"{"version":2,"grants":{}}"#.to_vec(),
            vec![b'x'; MAX_BYTES as usize + 1],
        ] {
            fs::write(&path, bytes).unwrap();
            assert!(matches(&path, &root, &p).is_err());
            assert!(remember(&path, &root, &p).is_err());
        }
    }
    #[test]
    fn concurrent_project_grants_do_not_overwrite_each_other() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("consent.json");
        let threads: Vec<_> = (0..12)
            .map(|i| {
                let root = dir.path().join(format!("p{i}"));
                fs::create_dir(&root).unwrap();
                let path = path.clone();
                std::thread::spawn(move || remember(&path, &root, &package(&root)).unwrap())
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        assert_eq!(load(&path).unwrap().grants.len(), 12);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o077, 0);
        }
    }
}
