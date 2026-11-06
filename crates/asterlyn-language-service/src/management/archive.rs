use super::{MAX_CONTENT_ENTRIES, MAX_DOWNLOAD_BYTES, MAX_EXPANDED_BYTES, ManagedInstallError};
use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

const MAX_ARCHIVE_PATH_BYTES: usize = 16_384;
const MAX_ARCHIVE_DEPTH: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ManagedArchiveFormat {
    TarGzip,
    Zip,
    Gzip {
        output_path: String,
        executable: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedArchiveExtraction {
    pub format: ManagedArchiveFormat,
    pub download_bytes: u64,
    pub expanded_bytes: u64,
}

impl ManagedArchiveExtraction {
    pub fn validate(&self) -> Result<(), ManagedInstallError> {
        if self.download_bytes == 0
            || self.download_bytes > MAX_DOWNLOAD_BYTES
            || self.expanded_bytes == 0
            || self.expanded_bytes > MAX_EXPANDED_BYTES
        {
            return Err(ManagedInstallError::ResourceLimit);
        }
        if let ManagedArchiveFormat::Gzip { output_path, .. } = &self.format {
            validated_archive_path(output_path, false)?;
        }
        Ok(())
    }
}

pub(super) fn extract_verified_archive(
    archive_path: &Path,
    destination: &Path,
    expected_digest: &str,
    extraction: &ManagedArchiveExtraction,
) -> Result<(), ManagedInstallError> {
    extraction.validate()?;
    let mut archive_file = open_file_no_follow(archive_path)?;
    let metadata = archive_file
        .metadata()
        .map_err(|_| ManagedInstallError::StorageFailed)?;
    if !metadata.is_file() || metadata.len() != extraction.download_bytes {
        return Err(ManagedInstallError::IntegrityMismatch);
    }
    let digest = hash_archive(&mut archive_file, extraction.download_bytes)?;
    if digest != expected_digest {
        return Err(ManagedInstallError::IntegrityMismatch);
    }
    archive_file
        .seek(SeekFrom::Start(0))
        .map_err(|_| ManagedInstallError::StorageFailed)?;

    let mut state = ExtractionState::new(destination, extraction.expanded_bytes)?;
    match &extraction.format {
        ManagedArchiveFormat::TarGzip => extract_tar_gzip(&mut archive_file, &mut state)?,
        ManagedArchiveFormat::Zip => extract_zip(&mut archive_file, &mut state)?,
        ManagedArchiveFormat::Gzip {
            output_path,
            executable,
        } => {
            let mut decoder = GzDecoder::new(&mut archive_file);
            state.write_file(output_path, &mut decoder, *executable, None)?;
        }
    }
    state.finish()
}

fn hash_archive(file: &mut File, expected_bytes: u64) -> Result<String, ManagedInstallError> {
    let mut hash = Sha256::new();
    let mut read_bytes = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| ManagedInstallError::StorageFailed)?;
        if count == 0 {
            break;
        }
        read_bytes = read_bytes
            .checked_add(count as u64)
            .filter(|bytes| *bytes <= expected_bytes)
            .ok_or(ManagedInstallError::IntegrityMismatch)?;
        hash.update(&buffer[..count]);
    }
    if read_bytes != expected_bytes {
        return Err(ManagedInstallError::IntegrityMismatch);
    }
    Ok(format!("sha256:{:x}", hash.finalize()))
}

fn extract_tar_gzip(
    archive_file: &mut File,
    state: &mut ExtractionState<'_>,
) -> Result<(), ManagedInstallError> {
    let decoder = GzDecoder::new(archive_file);
    let mut archive = tar::Archive::new(decoder);
    let entries = archive
        .entries()
        .map_err(|_| ManagedInstallError::IntegrityMismatch)?;
    for entry in entries {
        state.consume_archive_entry()?;
        let mut entry = entry.map_err(|_| ManagedInstallError::IntegrityMismatch)?;
        let path_bytes = entry.path_bytes().into_owned();
        let path = std::str::from_utf8(&path_bytes)
            .map_err(|_| ManagedInstallError::IntegrityMismatch)?
            .to_owned();
        let entry_type = entry.header().entry_type();
        if entry_type.is_dir() {
            state.create_directory(&path)?;
        } else if entry_type.is_file() {
            let size = entry.size();
            let executable = entry
                .header()
                .mode()
                .map_err(|_| ManagedInstallError::IntegrityMismatch)?
                & 0o111
                != 0;
            state.write_file(&path, &mut entry, executable, Some(size))?;
        } else {
            return Err(ManagedInstallError::IntegrityMismatch);
        }
    }
    Ok(())
}

fn extract_zip(
    archive_file: &mut File,
    state: &mut ExtractionState<'_>,
) -> Result<(), ManagedInstallError> {
    let mut archive =
        zip::ZipArchive::new(archive_file).map_err(|_| ManagedInstallError::IntegrityMismatch)?;
    if archive.len() > MAX_CONTENT_ENTRIES as usize {
        return Err(ManagedInstallError::ResourceLimit);
    }
    for index in 0..archive.len() {
        state.consume_archive_entry()?;
        let mut entry = archive
            .by_index(index)
            .map_err(|_| ManagedInstallError::IntegrityMismatch)?;
        let path = std::str::from_utf8(entry.name_raw())
            .map_err(|_| ManagedInstallError::IntegrityMismatch)?
            .to_owned();
        let unix_mode = entry.unix_mode().unwrap_or(0);
        let file_type = unix_mode & 0o170000;
        if entry.is_dir() {
            if !matches!(file_type, 0 | 0o040000) {
                return Err(ManagedInstallError::IntegrityMismatch);
            }
            state.create_directory(&path)?;
        } else if entry.is_file() && matches!(file_type, 0 | 0o100000) {
            let size = entry.size();
            state.write_file(&path, &mut entry, unix_mode & 0o111 != 0, Some(size))?;
        } else {
            return Err(ManagedInstallError::IntegrityMismatch);
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClaimedPathKind {
    Directory,
    File,
}

#[derive(Debug)]
struct ClaimedPath {
    path: String,
    kind: ClaimedPathKind,
}

struct ExtractionState<'a> {
    root: &'a Path,
    expanded_limit: u64,
    expanded_bytes: u64,
    archive_entries: u32,
    claimed: BTreeMap<String, ClaimedPath>,
    explicit: BTreeSet<String>,
    directories: Vec<PathBuf>,
}

impl<'a> ExtractionState<'a> {
    fn new(root: &'a Path, expanded_limit: u64) -> Result<Self, ManagedInstallError> {
        require_owned_directory(root)?;
        Ok(Self {
            root,
            expanded_limit,
            expanded_bytes: 0,
            archive_entries: 0,
            claimed: BTreeMap::new(),
            explicit: BTreeSet::new(),
            directories: vec![root.to_path_buf()],
        })
    }

    fn consume_archive_entry(&mut self) -> Result<(), ManagedInstallError> {
        self.archive_entries = self
            .archive_entries
            .checked_add(1)
            .filter(|count| *count <= MAX_CONTENT_ENTRIES)
            .ok_or(ManagedInstallError::ResourceLimit)?;
        Ok(())
    }

    fn create_directory(&mut self, archive_path: &str) -> Result<(), ManagedInstallError> {
        let relative = validated_archive_path(archive_path, true)?;
        self.claim_explicit(&relative)?;
        self.ensure_directory_path(&relative)
    }

    fn write_file(
        &mut self,
        archive_path: &str,
        input: &mut impl Read,
        executable: bool,
        expected_size: Option<u64>,
    ) -> Result<(), ManagedInstallError> {
        let relative = validated_archive_path(archive_path, false)?;
        self.claim_explicit(&relative)?;
        let (parent, _) = relative.rsplit_once('/').unwrap_or(("", relative.as_str()));
        if !parent.is_empty() {
            self.ensure_directory_path(parent)?;
        }
        self.claim(&relative, ClaimedPathKind::File)?;
        if expected_size.is_some_and(|size| {
            self.expanded_bytes
                .checked_add(size)
                .is_none_or(|total| total > self.expanded_limit)
        }) {
            return Err(ManagedInstallError::ResourceLimit);
        }

        let destination = self.root.join(&relative);
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|_| ManagedInstallError::StorageFailed)?;
        let remaining = self.expanded_limit.saturating_sub(self.expanded_bytes);
        let mut copied = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = input
                .read(&mut buffer)
                .map_err(|_| ManagedInstallError::IntegrityMismatch)?;
            if count == 0 {
                break;
            }
            copied = copied
                .checked_add(count as u64)
                .filter(|bytes| *bytes <= remaining)
                .ok_or(ManagedInstallError::ResourceLimit)?;
            output
                .write_all(&buffer[..count])
                .map_err(|_| ManagedInstallError::StorageFailed)?;
        }
        if expected_size.is_some_and(|size| size != copied) {
            return Err(ManagedInstallError::IntegrityMismatch);
        }
        self.expanded_bytes = self
            .expanded_bytes
            .checked_add(copied)
            .ok_or(ManagedInstallError::ResourceLimit)?;
        set_private_file_permissions(&destination, executable)?;
        output
            .flush()
            .and_then(|()| output.sync_all())
            .map_err(|_| ManagedInstallError::StorageFailed)
    }

    fn ensure_directory_path(&mut self, relative: &str) -> Result<(), ManagedInstallError> {
        let mut current = String::new();
        for component in relative.split('/') {
            if !current.is_empty() {
                current.push('/');
            }
            current.push_str(component);
            let added = self.claim(&current, ClaimedPathKind::Directory)?;
            if !added {
                continue;
            }
            let destination = self.root.join(&current);
            fs::create_dir(&destination).map_err(|_| ManagedInstallError::StorageFailed)?;
            set_private_directory_permissions(&destination)?;
            self.directories.push(destination);
        }
        Ok(())
    }

    fn claim_explicit(&mut self, relative: &str) -> Result<(), ManagedInstallError> {
        if !self.explicit.insert(relative.to_lowercase()) {
            return Err(ManagedInstallError::IntegrityMismatch);
        }
        Ok(())
    }

    fn claim(
        &mut self,
        relative: &str,
        kind: ClaimedPathKind,
    ) -> Result<bool, ManagedInstallError> {
        let identity = relative.to_lowercase();
        if let Some(existing) = self.claimed.get(&identity) {
            if existing.path != relative || existing.kind != kind {
                return Err(ManagedInstallError::IntegrityMismatch);
            }
            return Ok(false);
        }
        if self.claimed.len() >= MAX_CONTENT_ENTRIES as usize {
            return Err(ManagedInstallError::ResourceLimit);
        }
        self.claimed.insert(
            identity,
            ClaimedPath {
                path: relative.to_owned(),
                kind,
            },
        );
        Ok(true)
    }

    fn finish(self) -> Result<(), ManagedInstallError> {
        if self.expanded_bytes == 0 || self.claimed.is_empty() {
            return Err(ManagedInstallError::IntegrityMismatch);
        }
        for directory in self.directories.iter().rev() {
            sync_directory(directory)?;
        }
        Ok(())
    }
}

fn validated_archive_path(value: &str, directory: bool) -> Result<String, ManagedInstallError> {
    let path = if directory {
        value.trim_end_matches('/')
    } else {
        value
    };
    if path.is_empty()
        || path.len() > MAX_ARCHIVE_PATH_BYTES
        || path.starts_with('/')
        || path.starts_with("//")
        || path.contains(['\0', '\\'])
        || path.as_bytes().get(1) == Some(&b':')
        || !directory && path.ends_with('/')
    {
        return Err(ManagedInstallError::IntegrityMismatch);
    }
    let components: Vec<_> = path.split('/').collect();
    if components.len() > MAX_ARCHIVE_DEPTH
        || components.iter().any(|component| {
            component.is_empty()
                || *component == "."
                || *component == ".."
                || component.len() > 255
                || component.chars().any(char::is_control)
        })
    {
        return Err(ManagedInstallError::IntegrityMismatch);
    }
    Ok(path.to_owned())
}

fn open_file_no_follow(path: &Path) -> Result<File, ManagedInstallError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    options
        .open(path)
        .map_err(|_| ManagedInstallError::StorageFailed)
}

fn require_owned_directory(path: &Path) -> Result<(), ManagedInstallError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| ManagedInstallError::StorageFailed)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ManagedInstallError::StorageFailed);
    }
    Ok(())
}

fn set_private_directory_permissions(path: &Path) -> Result<(), ManagedInstallError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| ManagedInstallError::StorageFailed)?;
    }
    Ok(())
}

fn set_private_file_permissions(path: &Path, executable: bool) -> Result<(), ManagedInstallError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = if executable { 0o700 } else { 0o600 };
        fs::set_permissions(path, fs::Permissions::from_mode(mode))
            .map_err(|_| ManagedInstallError::StorageFailed)?;
    }
    Ok(())
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), ManagedInstallError> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| ManagedInstallError::StorageFailed)
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), ManagedInstallError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::management::{
        ManagedArtifact, ManagedInstallationContentStore, ManagedServerId,
        inventory_managed_content,
    };
    use flate2::{Compression, write::GzEncoder};
    use std::io::Cursor;
    use tar::{Builder, EntryType, Header};
    use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

    fn digest(bytes: &[u8]) -> String {
        format!("sha256:{:x}", Sha256::digest(bytes))
    }

    fn archive_file(bytes: &[u8]) -> tempfile::NamedTempFile {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(bytes).unwrap();
        file.flush().unwrap();
        file
    }

    fn extraction(
        format: ManagedArchiveFormat,
        bytes: &[u8],
        expanded_bytes: u64,
    ) -> ManagedArchiveExtraction {
        ManagedArchiveExtraction {
            format,
            download_bytes: bytes.len() as u64,
            expanded_bytes,
        }
    }

    fn gzip(bytes: &[u8]) -> Vec<u8> {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(bytes).unwrap();
        encoder.finish().unwrap()
    }

    fn tar_gzip(entries: &[(&str, &[u8], EntryType, u32)]) -> Vec<u8> {
        let encoder = GzEncoder::new(Vec::new(), Compression::default());
        let mut builder = Builder::new(encoder);
        for (path, bytes, entry_type, mode) in entries {
            let mut header = Header::new_gnu();
            header.set_entry_type(*entry_type);
            header.set_mode(*mode);
            header.set_size(bytes.len() as u64);
            header.set_cksum();
            builder
                .append_data(&mut header, path, Cursor::new(*bytes))
                .unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    fn zip(entries: &[(&str, &[u8], u32)]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (path, bytes, mode) in entries {
            let options = SimpleFileOptions::default()
                .compression_method(CompressionMethod::Deflated)
                .unix_permissions(*mode);
            if path.ends_with('/') {
                writer.add_directory(*path, options).unwrap();
            } else {
                writer.start_file(*path, options).unwrap();
                writer.write_all(bytes).unwrap();
            }
        }
        writer.finish().unwrap().into_inner()
    }

    fn new_destination() -> (tempfile::TempDir, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let destination = root.path().join("destination");
        fs::create_dir(&destination).unwrap();
        (root, destination)
    }

    #[test]
    fn extracts_gzip_tar_gzip_and_zip_with_private_executable_files() {
        let gzip_bytes = gzip(b"gzip-server");
        let gzip_file = archive_file(&gzip_bytes);
        let (_root, gzip_destination) = new_destination();
        extract_verified_archive(
            gzip_file.path(),
            &gzip_destination,
            &digest(&gzip_bytes),
            &extraction(
                ManagedArchiveFormat::Gzip {
                    output_path: "bin/server".into(),
                    executable: true,
                },
                &gzip_bytes,
                64,
            ),
        )
        .unwrap();
        assert_eq!(
            fs::read(gzip_destination.join("bin/server")).unwrap(),
            b"gzip-server"
        );

        let tar_bytes = tar_gzip(&[
            ("bin/", b"", EntryType::Directory, 0o755),
            ("bin/server", b"tar-server", EntryType::Regular, 0o755),
            ("NOTICE", b"notice", EntryType::Regular, 0o644),
        ]);
        let tar_file = archive_file(&tar_bytes);
        let (_root, tar_destination) = new_destination();
        extract_verified_archive(
            tar_file.path(),
            &tar_destination,
            &digest(&tar_bytes),
            &extraction(ManagedArchiveFormat::TarGzip, &tar_bytes, 64),
        )
        .unwrap();
        assert_eq!(
            fs::read(tar_destination.join("bin/server")).unwrap(),
            b"tar-server"
        );

        let zip_bytes = zip(&[
            ("bin/", b"", 0o755),
            ("bin/server", b"zip-server", 0o755),
            ("NOTICE", b"notice", 0o644),
        ]);
        let zip_file = archive_file(&zip_bytes);
        let (_root, zip_destination) = new_destination();
        extract_verified_archive(
            zip_file.path(),
            &zip_destination,
            &digest(&zip_bytes),
            &extraction(ManagedArchiveFormat::Zip, &zip_bytes, 64),
        )
        .unwrap();
        assert_eq!(
            fs::read(zip_destination.join("bin/server")).unwrap(),
            b"zip-server"
        );

        #[cfg(unix)]
        for server in [
            gzip_destination.join("bin/server"),
            tar_destination.join("bin/server"),
            zip_destination.join("bin/server"),
        ] {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(server).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
    }

    #[test]
    fn rejects_unsafe_paths_links_and_case_collisions() {
        for path in [
            "../escape",
            "./server",
            "/absolute",
            "C:/windows",
            "bin\\server",
            "bin//server",
        ] {
            assert_eq!(
                validated_archive_path(path, false),
                Err(ManagedInstallError::IntegrityMismatch)
            );
        }

        let linked = tar_gzip(&[("bin/server", b"target", EntryType::Symlink, 0o755)]);
        let linked_file = archive_file(&linked);
        let (_root, linked_destination) = new_destination();
        assert_eq!(
            extract_verified_archive(
                linked_file.path(),
                &linked_destination,
                &digest(&linked),
                &extraction(ManagedArchiveFormat::TarGzip, &linked, 64),
            ),
            Err(ManagedInstallError::IntegrityMismatch)
        );

        let mut symlink_writer = ZipWriter::new(Cursor::new(Vec::new()));
        symlink_writer
            .add_symlink(
                "bin/server",
                "../target",
                SimpleFileOptions::default().unix_permissions(0o777),
            )
            .unwrap();
        let zip_symlink = symlink_writer.finish().unwrap().into_inner();
        let zip_symlink_file = archive_file(&zip_symlink);
        let (_root, zip_symlink_destination) = new_destination();
        assert_eq!(
            extract_verified_archive(
                zip_symlink_file.path(),
                &zip_symlink_destination,
                &digest(&zip_symlink),
                &extraction(ManagedArchiveFormat::Zip, &zip_symlink, 64),
            ),
            Err(ManagedInstallError::IntegrityMismatch)
        );

        let collision = zip(&[("bin/server", b"one", 0o755), ("BIN/server", b"two", 0o755)]);
        let collision_file = archive_file(&collision);
        let (_root, collision_destination) = new_destination();
        assert_eq!(
            extract_verified_archive(
                collision_file.path(),
                &collision_destination,
                &digest(&collision),
                &extraction(ManagedArchiveFormat::Zip, &collision, 64),
            ),
            Err(ManagedInstallError::IntegrityMismatch)
        );
    }

    #[test]
    fn rejects_archive_digest_size_and_expansion_mismatches() {
        let bytes = gzip(b"expanded-server");
        let file = archive_file(&bytes);
        let (_root, destination) = new_destination();
        assert_eq!(
            extract_verified_archive(
                file.path(),
                &destination,
                &digest(b"different"),
                &extraction(
                    ManagedArchiveFormat::Gzip {
                        output_path: "server".into(),
                        executable: true,
                    },
                    &bytes,
                    64,
                ),
            ),
            Err(ManagedInstallError::IntegrityMismatch)
        );

        let (_root, destination) = new_destination();
        let mut wrong_size = extraction(
            ManagedArchiveFormat::Gzip {
                output_path: "server".into(),
                executable: true,
            },
            &bytes,
            64,
        );
        wrong_size.download_bytes += 1;
        assert_eq!(
            extract_verified_archive(file.path(), &destination, &digest(&bytes), &wrong_size),
            Err(ManagedInstallError::IntegrityMismatch)
        );

        let (_root, destination) = new_destination();
        assert_eq!(
            extract_verified_archive(
                file.path(),
                &destination,
                &digest(&bytes),
                &extraction(
                    ManagedArchiveFormat::Gzip {
                        output_path: "server".into(),
                        executable: true,
                    },
                    &bytes,
                    1,
                ),
            ),
            Err(ManagedInstallError::ResourceLimit)
        );

        for format in [ManagedArchiveFormat::TarGzip, ManagedArchiveFormat::Zip] {
            let malformed = b"not-an-archive";
            let malformed_file = archive_file(malformed);
            let (_root, malformed_destination) = new_destination();
            assert_eq!(
                extract_verified_archive(
                    malformed_file.path(),
                    &malformed_destination,
                    &digest(malformed),
                    &extraction(format, malformed, 64),
                ),
                Err(ManagedInstallError::IntegrityMismatch)
            );
        }
        let malformed = b"not-gzip";
        let malformed_file = archive_file(malformed);
        let (_root, malformed_destination) = new_destination();
        assert_eq!(
            extract_verified_archive(
                malformed_file.path(),
                &malformed_destination,
                &digest(malformed),
                &extraction(
                    ManagedArchiveFormat::Gzip {
                        output_path: "server".into(),
                        executable: true,
                    },
                    malformed,
                    64,
                ),
            ),
            Err(ManagedInstallError::IntegrityMismatch)
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let link_root = tempfile::tempdir().unwrap();
            let link = link_root.path().join("archive-link");
            symlink(file.path(), &link).unwrap();
            let (_root, linked_destination) = new_destination();
            assert_eq!(
                extract_verified_archive(
                    &link,
                    &linked_destination,
                    &digest(&bytes),
                    &extraction(
                        ManagedArchiveFormat::Gzip {
                            output_path: "server".into(),
                            executable: true,
                        },
                        &bytes,
                        64,
                    ),
                ),
                Err(ManagedInstallError::StorageFailed)
            );
        }
    }

    #[test]
    fn verified_archive_stages_only_when_archive_and_content_identities_match() {
        let source = tempfile::tempdir().unwrap();
        fs::create_dir(source.path().join("bin")).unwrap();
        fs::write(source.path().join("bin/server"), b"server").unwrap();
        fs::write(source.path().join("NOTICE"), b"notice").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(
                source.path().join("bin/server"),
                fs::Permissions::from_mode(0o755),
            )
            .unwrap();
        }
        let expected = inventory_managed_content(source.path(), MAX_EXPANDED_BYTES).unwrap();
        let bytes = tar_gzip(&[
            ("bin/", b"", EntryType::Directory, 0o755),
            ("bin/server", b"server", EntryType::Regular, 0o755),
            ("NOTICE", b"notice", EntryType::Regular, 0o644),
        ]);
        let file = archive_file(&bytes);
        let artifact = ManagedArtifact {
            server: ManagedServerId {
                plugin_id: "dev.asterlyn.lsp".into(),
                server_id: "fixture".into(),
            },
            version: "1.0.0".into(),
            target: "aarch64-apple-darwin".into(),
            recipe_digest: digest(b"recipe"),
            archive_digest: digest(&bytes),
            content_digest: expected.digest.clone(),
        };
        let root = tempfile::tempdir().unwrap();
        let mut store = ManagedInstallationContentStore::new(root.path().join("managed"));
        assert_eq!(
            store
                .stage_archive(
                    &artifact,
                    file.path(),
                    &extraction(
                        ManagedArchiveFormat::TarGzip,
                        &bytes,
                        expected.expanded_bytes
                    ),
                )
                .unwrap(),
            expected
        );

        let mut mismatched_artifact = artifact.clone();
        mismatched_artifact.content_digest = digest(b"different-content");
        let mismatched_root = tempfile::tempdir().unwrap();
        let mut mismatched_store =
            ManagedInstallationContentStore::new(mismatched_root.path().join("managed"));
        assert_eq!(
            mismatched_store.stage_archive(
                &mismatched_artifact,
                file.path(),
                &extraction(
                    ManagedArchiveFormat::TarGzip,
                    &bytes,
                    expected.expanded_bytes
                ),
            ),
            Err(ManagedInstallError::IntegrityMismatch)
        );
        assert_eq!(
            fs::read_dir(mismatched_root.path().join("managed/content-staging-v1"))
                .unwrap()
                .count(),
            0
        );
    }
}
