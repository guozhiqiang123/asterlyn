//! Read-only component receipts. Installation/download is an explicit operation, never activation.
use asterlyn_plugin_package::AnalysisComponent;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComponentReceipt {
    pub schema: u32,
    pub id: String,
    pub version: String,
    pub archive_digest: String,
    pub content_digest: String,
    pub files: Vec<ComponentFile>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComponentFile {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}
pub struct VerifiedComponent {
    pub root: PathBuf,
    pub content_digest: String,
}

pub fn inventory_digest(files: &[ComponentFile]) -> Result<String, String> {
    let bytes = serde_json::to_vec(files).map_err(|_| "invalid component inventory")?;
    let mut hash = Sha256::new();
    hash.update(b"analysis-component-v1\0");
    hash.update(bytes);
    Ok(format!("sha256:{:x}", hash.finalize()))
}
pub fn verify_component(
    base: &Path,
    expected: &AnalysisComponent,
) -> Result<VerifiedComponent, String> {
    if !asterlyn_plugin_dependencies::valid_plugin_id(&expected.id)
        || expected.version.is_empty()
        || expected.version.len() > 128
        || matches!(expected.version.as_str(), "." | "..")
        || !expected
            .version
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b'+'))
    {
        return Err("invalid analysis component identity".into());
    }
    let digest = expected
        .archive_digest
        .strip_prefix("sha256:")
        .filter(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or("invalid analysis component digest")?;
    let directory = base.join(&expected.id).join(&expected.version).join(digest);
    let receipt_path = directory.join("receipt.json");
    let metadata = fs::symlink_metadata(&receipt_path).map_err(|_| {
        format!(
            "analysis component is not installed: {} {}",
            expected.id, expected.version
        )
    })?;
    if !metadata.is_file() || metadata.len() > 8 * 1024 * 1024 {
        return Err("invalid component receipt".into());
    }
    let receipt: ComponentReceipt = serde_json::from_reader(
        fs::File::open(receipt_path).map_err(|_| "component receipt unavailable")?,
    )
    .map_err(|_| "invalid component receipt")?;
    if receipt.schema != 1
        || receipt.id != expected.id
        || receipt.version != expected.version
        || receipt.archive_digest != expected.archive_digest
        || receipt.content_digest != expected.content_digest
        || receipt.files.is_empty()
        || receipt.files.len() > 20000
    {
        return Err("component receipt does not match the declared component".into());
    }
    let root = directory.join("content");
    let canonical = root
        .canonicalize()
        .map_err(|_| "component content unavailable")?;
    if canonical != root
        || !canonical.starts_with(
            base.canonicalize()
                .map_err(|_| "component store unavailable")?,
        )
    {
        return Err("component root uses a path alias".into());
    }
    let mut expected_paths = BTreeSet::new();
    let mut total = 0u64;
    let mut previous = "";
    for file in &receipt.files {
        if file.path.len() > 1024
            || file.path.is_empty()
            || file.path.as_str() <= previous
            || file.path.contains(['\\', '\0'])
            || Path::new(&file.path)
                .components()
                .any(|part| !matches!(part, Component::Normal(_)))
            || file.bytes > 256 * 1024 * 1024
        {
            return Err("invalid component inventory path or bound".into());
        }
        previous = &file.path;
        expected_paths.insert(file.path.clone());
        total = total
            .checked_add(file.bytes)
            .ok_or("component size bound")?;
        if total > 1024 * 1024 * 1024 {
            return Err("component size bound".into());
        }
    }
    if inventory_digest(&receipt.files)? != expected.content_digest {
        return Err("component inventory digest changed".into());
    }
    let mut actual_paths = BTreeMap::new();
    let mut directories = vec![root.clone()];
    let mut entries = 0;
    while let Some(directory) = directories.pop() {
        for entry in fs::read_dir(directory).map_err(|_| "component content unavailable")? {
            let entry = entry.map_err(|_| "component content unavailable")?;
            entries += 1;
            if entries > 40000 {
                return Err("component inventory bound".into());
            }
            let metadata =
                fs::symlink_metadata(entry.path()).map_err(|_| "component content unavailable")?;
            if metadata.file_type().is_symlink() {
                return Err("component contains an unadmitted path alias".into());
            }
            if metadata.is_dir() {
                directories.push(entry.path());
            } else if metadata.is_file() {
                let relative = entry
                    .path()
                    .strip_prefix(&root)
                    .map_err(|_| "component path escaped")?
                    .to_string_lossy()
                    .replace('\\', "/");
                if !expected_paths.contains(&relative) || !metadata.permissions().readonly() {
                    return Err("component contains extra or writable files".into());
                }
                actual_paths.insert(relative, entry.path());
            } else {
                return Err("unsupported component entry".into());
            }
        }
    }
    if actual_paths.len() != receipt.files.len() {
        return Err("component inventory is incomplete".into());
    }
    for expected_file in &receipt.files {
        let path = &actual_paths[&expected_file.path];
        let mut file = fs::File::open(path).map_err(|_| "component file unavailable")?;
        if file
            .metadata()
            .map_err(|_| "component file unavailable")?
            .len()
            != expected_file.bytes
        {
            return Err("component file size changed".into());
        }
        let mut hash = Sha256::new();
        let mut bytes = 0u64;
        let mut buffer = [0u8; 65536];
        loop {
            let count = file
                .read(&mut buffer)
                .map_err(|_| "component file unavailable")?;
            if count == 0 {
                break;
            }
            bytes += count as u64;
            if bytes > expected_file.bytes {
                return Err("component file changed".into());
            }
            hash.update(&buffer[..count]);
        }
        if format!("sha256:{:x}", hash.finalize()) != expected_file.sha256 {
            return Err("component file digest changed".into());
        }
    }
    Ok(VerifiedComponent {
        root,
        content_digest: expected.content_digest.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn complete_component_receipt_rejects_writable_changed_and_unlisted_files() {
        let store = tempfile::tempdir().unwrap();
        let base = store.path().canonicalize().unwrap();
        let archive_digest = format!("sha256:{}", "a".repeat(64));
        let directory = base.join("fixture/1.0.0").join("a".repeat(64));
        let content = directory.join("content");
        fs::create_dir_all(&content).unwrap();
        let file = content.join("server.jar");
        fs::write(&file, b"server").unwrap();
        let mut permission = fs::metadata(&file).unwrap().permissions();
        permission.set_readonly(true);
        fs::set_permissions(&file, permission).unwrap();
        let files = vec![ComponentFile {
            path: "server.jar".into(),
            bytes: 6,
            sha256: format!("sha256:{:x}", Sha256::digest(b"server")),
        }];
        let content_digest = inventory_digest(&files).unwrap();
        let expected = AnalysisComponent {
            id: "fixture".into(),
            version: "1.0.0".into(),
            archive_digest: archive_digest.clone(),
            content_digest: content_digest.clone(),
        };
        fs::write(
            directory.join("receipt.json"),
            serde_json::to_vec(&ComponentReceipt {
                schema: 1,
                id: "fixture".into(),
                version: "1.0.0".into(),
                archive_digest,
                content_digest,
                files,
            })
            .unwrap(),
        )
        .unwrap();
        assert!(verify_component(&base, &expected).is_ok());
        fs::write(content.join("unlisted.jar"), b"unexpected").unwrap();
        assert!(verify_component(&base, &expected).is_err());
        fs::remove_file(content.join("unlisted.jar")).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        }
        #[cfg(windows)]
        {
            let mut permissions = fs::metadata(&file).unwrap().permissions();
            permissions.set_readonly(false);
            fs::set_permissions(&file, permissions).unwrap();
        }
        assert!(verify_component(&base, &expected).is_err());
        fs::write(&file, b"tamper").unwrap();
        let mut permission = fs::metadata(&file).unwrap().permissions();
        permission.set_readonly(true);
        fs::set_permissions(&file, permission).unwrap();
        assert!(verify_component(&base, &expected).is_err());
        #[cfg(windows)]
        {
            let mut permissions = fs::metadata(&file).unwrap().permissions();
            permissions.set_readonly(false);
            fs::set_permissions(&file, permissions).unwrap();
        }
    }
}
