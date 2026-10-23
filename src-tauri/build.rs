fn main() {
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};
    for source in [
        "src",
        "../src",
        "../dist",
        "../protocol",
        "../Cargo.lock",
        "../.git/HEAD",
        "../.git/index",
        "../.git/refs",
    ] {
        println!("cargo:rerun-if-changed={source}");
    }
    println!("cargo:rerun-if-env-changed=SOURCE_DATE_EPOCH");
    let revision = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .unwrap_or_else(|| "unknown".into());
    let dirty = Command::new("git")
        .args(["status", "--porcelain", "--untracked-files=normal"])
        .output()
        .ok()
        .is_some_and(|output| output.status.success() && !output.stdout.is_empty());
    let epoch = std::env::var("SOURCE_DATE_EPOCH").unwrap_or_else(|_| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .to_string()
    });
    println!(
        "cargo:rustc-env=ASTERLYN_BUILD_ID={revision}-{}-{epoch}",
        if dirty { "dirty" } else { "clean" }
    );
    tauri_build::build()
}
