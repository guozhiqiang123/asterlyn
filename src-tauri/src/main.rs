fn main() {
    configure_linux_webview();
    asterlyn_lib::run();
}

#[cfg(not(target_os = "linux"))]
fn configure_linux_webview() {}

#[cfg(target_os = "linux")]
fn configure_linux_webview() {
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_some() || !is_deepin() {
        return;
    }

    // Deepin 23 can expose a render node while denying WebKitGTK's KMS dumb-buffer ioctl,
    // producing an otherwise healthy but unpainted window. This must run before Tauri starts
    // threads; changing process environment after that point would be unsafe.
    unsafe {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
}

#[cfg(target_os = "linux")]
fn is_deepin() -> bool {
    std::fs::read_to_string("/etc/os-release")
        .map(|contents| {
            contents
                .lines()
                .any(|line| line.trim().eq_ignore_ascii_case("ID=deepin"))
        })
        .unwrap_or(false)
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::is_deepin;

    #[test]
    fn current_distribution_detection_is_stable() {
        let expected = std::fs::read_to_string("/etc/os-release")
            .map(|contents| {
                contents
                    .lines()
                    .any(|line| line.trim().eq_ignore_ascii_case("ID=deepin"))
            })
            .unwrap_or(false);
        assert_eq!(is_deepin(), expected);
    }
}
