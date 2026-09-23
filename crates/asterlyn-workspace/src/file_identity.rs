use std::fs::{File, Metadata};
use std::io;
use std::path::Path;

/// Confirms that the metadata captured before opening and the opened handle still describe the
/// same file, and on Windows that the path still resolves to that handle's file identity.
pub(crate) fn opened_file_matches_path(
    path: &Path,
    expected: &Metadata,
    opened: &File,
    opened_metadata: &Metadata,
) -> io::Result<bool> {
    platform::opened_file_matches_path(path, expected, opened, opened_metadata)
}

/// Returns a stable platform file identity after confirming that the pre-open metadata, opened
/// handle, and current path still name the same file. Platforms without a stable identity return
/// `None`, allowing callers to fall back to content hashing.
pub(crate) fn opened_file_identity_token(
    path: &Path,
    expected: &Metadata,
    opened: &File,
    opened_metadata: &Metadata,
) -> io::Result<Option<[u64; 2]>> {
    platform::opened_file_identity_token(path, expected, opened, opened_metadata)
}

#[cfg(unix)]
mod platform {
    use super::*;
    use std::os::unix::fs::MetadataExt;

    pub(super) fn opened_file_matches_path(
        path: &Path,
        expected: &Metadata,
        _opened: &File,
        opened_metadata: &Metadata,
    ) -> io::Result<bool> {
        let current = std::fs::symlink_metadata(path)?;
        Ok(expected.dev() == opened_metadata.dev()
            && expected.ino() == opened_metadata.ino()
            && current.dev() == opened_metadata.dev()
            && current.ino() == opened_metadata.ino())
    }

    pub(super) fn opened_file_identity_token(
        path: &Path,
        expected: &Metadata,
        opened: &File,
        opened_metadata: &Metadata,
    ) -> io::Result<Option<[u64; 2]>> {
        if !opened_file_matches_path(path, expected, opened, opened_metadata)? {
            return Err(io::Error::other(
                "file identity changed while it was inspected",
            ));
        }
        Ok(Some([opened_metadata.dev(), opened_metadata.ino()]))
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::mem::MaybeUninit;
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
    };

    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    struct WindowsFileIdentity {
        volume_serial_number: u32,
        file_index: u64,
    }

    pub(super) fn opened_file_matches_path(
        path: &Path,
        expected: &Metadata,
        opened: &File,
        opened_metadata: &Metadata,
    ) -> io::Result<bool> {
        if !same_metadata_snapshot(expected, opened_metadata) {
            return Ok(false);
        }
        let current = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?;
        Ok(file_identity(opened)? == file_identity(&current)?)
    }

    pub(super) fn opened_file_identity_token(
        path: &Path,
        expected: &Metadata,
        opened: &File,
        opened_metadata: &Metadata,
    ) -> io::Result<Option<[u64; 2]>> {
        if !same_metadata_snapshot(expected, opened_metadata) {
            return Err(io::Error::other(
                "file metadata changed while it was inspected",
            ));
        }
        let current = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?;
        let opened_identity = file_identity(opened)?;
        if opened_identity != file_identity(&current)? {
            return Err(io::Error::other(
                "file identity changed while it was inspected",
            ));
        }
        Ok(Some([
            u64::from(opened_identity.volume_serial_number),
            opened_identity.file_index,
        ]))
    }

    fn same_metadata_snapshot(left: &Metadata, right: &Metadata) -> bool {
        left.file_attributes() == right.file_attributes()
            && left.creation_time() == right.creation_time()
            && left.last_write_time() == right.last_write_time()
            && left.file_size() == right.file_size()
    }

    fn file_identity(file: &File) -> io::Result<WindowsFileIdentity> {
        let mut information = MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::zeroed();
        // SAFETY: the handle belongs to a live `File`; Windows initializes the complete output
        // structure when the call succeeds, and failure is converted from the thread's OS error.
        let succeeded = unsafe {
            GetFileInformationByHandle(file.as_raw_handle() as HANDLE, information.as_mut_ptr())
        };
        if succeeded == 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: a successful `GetFileInformationByHandle` initialized the structure above.
        let information = unsafe { information.assume_init() };
        Ok(WindowsFileIdentity {
            volume_serial_number: information.dwVolumeSerialNumber,
            file_index: (u64::from(information.nFileIndexHigh) << 32)
                | u64::from(information.nFileIndexLow),
        })
    }
}

#[cfg(not(any(unix, windows)))]
mod platform {
    use super::*;

    pub(super) fn opened_file_matches_path(
        _path: &Path,
        expected: &Metadata,
        _opened: &File,
        opened_metadata: &Metadata,
    ) -> io::Result<bool> {
        Ok(expected.len() == opened_metadata.len()
            && expected.permissions().readonly() == opened_metadata.permissions().readonly())
    }

    pub(super) fn opened_file_identity_token(
        path: &Path,
        expected: &Metadata,
        opened: &File,
        opened_metadata: &Metadata,
    ) -> io::Result<Option<[u64; 2]>> {
        if !opened_file_matches_path(path, expected, opened, opened_metadata)? {
            return Err(io::Error::other(
                "file identity changed while it was inspected",
            ));
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::opened_file_matches_path;
    use std::fs;

    #[test]
    fn unchanged_opened_file_matches_its_path() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("source.txt");
        fs::write(&path, "first").unwrap();
        let expected = fs::symlink_metadata(&path).unwrap();
        let opened = fs::File::open(&path).unwrap();
        let opened_metadata = opened.metadata().unwrap();

        assert!(opened_file_matches_path(&path, &expected, &opened, &opened_metadata).unwrap());
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn replaced_path_does_not_match_the_opened_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("source.txt");
        let retained = directory.path().join("retained.txt");
        fs::write(&path, "first").unwrap();
        let expected = fs::symlink_metadata(&path).unwrap();
        let opened = fs::File::open(&path).unwrap();
        let opened_metadata = opened.metadata().unwrap();
        fs::rename(&path, retained).unwrap();
        fs::write(&path, "second").unwrap();

        assert!(!opened_file_matches_path(&path, &expected, &opened, &opened_metadata).unwrap());
    }
}
