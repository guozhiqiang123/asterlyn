use super::*;

fn fixture() -> (tempfile::TempDir, PathBuf, Environment) {
    let temporary = tempfile::tempdir().unwrap();
    let base = temporary.path().canonicalize().unwrap();
    let root = base.join("project");
    fs::create_dir_all(root.join("gradle/wrapper")).unwrap();
    fs::write(
        root.join("gradle/wrapper/gradle-wrapper.properties"),
        "distributionUrl=https\\://services.gradle.org/distributions/gradle-8.13-bin.zip\n",
    )
    .unwrap();
    fs::write(root.join("gradlew"), "wrapper").unwrap();
    let jdk17 = jdk(&base, "jdk17", 17);
    let jdk25 = jdk(&base, "jdk25", 25);
    let environment = Environment {
        java_home: Some(jdk25.clone()),
        candidates: vec![jdk25, jdk17],
        gradle_home: Some(base.join("gradle-user")),
    };
    (temporary, root, environment)
}

fn jdk(base: &Path, name: &str, version: u16) -> PathBuf {
    let home = base.join(name);
    fs::create_dir_all(home.join("bin")).unwrap();
    fs::write(
        home.join("release"),
        format!("JAVA_VERSION=\"{version}.0.1\"\n"),
    )
    .unwrap();
    for binary in [
        if cfg!(windows) { "java.exe" } else { "java" },
        if cfg!(windows) { "javac.exe" } else { "javac" },
    ] {
        fs::write(home.join("bin").join(binary), b"verified fixture binary").unwrap();
    }
    home
}

#[test]
fn supported_java_boundaries_follow_the_reviewed_gradle_table() {
    for (version, range) in [
        ((7, 2, 0), (8, 16)),
        ((7, 3, 0), (8, 17)),
        ((8, 4, 0), (8, 20)),
        ((8, 5, 0), (8, 21)),
        ((8, 13, 0), (8, 23)),
        ((8, 14, 0), (8, 24)),
        ((9, 0, 0), (17, 24)),
        ((9, 1, 0), (17, 25)),
        ((9, 4, 0), (17, 26)),
    ] {
        assert_eq!(java_range(version).unwrap(), range);
    }
    for version in [(1, 0, 0), (8, 99, 0), (9, 9, 0), (10, 0, 0)] {
        assert!(java_range(version).is_err());
    }
    for url in [
        "gradle-8.13-rc-1-bin.zip",
        "gradle-8.13-bin.zip?secret=1",
        "gradle-8.13.0.1-all.zip",
        "gradle-eight-bin.zip",
    ] {
        assert!(wrapper_version(url).is_err());
    }
    assert_eq!(
        wrapper_version("file:///downloads/gradle-8.13-all.zip").unwrap(),
        (8, 13, 0)
    );
    assert_eq!(
        java_installations::major("JAVA_VERSION=\"1.8.0_400\""),
        Some(8)
    );
}

#[test]
fn incompatible_environment_falls_back_deterministically_without_executing_java() {
    let (_temporary, root, environment) = fixture();
    let runtime = resolve_with(&root, &[], environment).unwrap().unwrap();
    assert_eq!(runtime.java_major, 17);
    assert_eq!(runtime.gradle_version, "8.13");
    assert_eq!(
        runtime.selection_reason,
        "replaced-incompatible-environment"
    );
    assert!(runtime.metadata().get("home").is_none());
    assert_eq!(runtime.metadata()["toolchainRole"], "build-runtime");
    assert_eq!(runtime.toolchain.requirement.minimum_major, 8);
    assert_eq!(runtime.toolchain.source, ToolchainSource::Installed);
    assert!(
        !runtime
            .metadata()
            .to_string()
            .contains(&runtime.home.to_string_lossy().to_string())
    );
}

#[test]
fn respects_explicit_user_and_command_line_precedence_and_rejects_incompatible_override() {
    let (temporary, root, mut environment) = fixture();
    let jdk21 = jdk(temporary.path(), "jdk21", 21).canonicalize().unwrap();
    fs::write(
        root.join("gradle.properties"),
        format!(
            "org.gradle.java.home={}\n",
            environment.candidates[1].display()
        ),
    )
    .unwrap();
    fs::create_dir_all(environment.gradle_home.as_ref().unwrap()).unwrap();
    fs::write(
        environment
            .gradle_home
            .as_ref()
            .unwrap()
            .join("gradle.properties"),
        format!("org.gradle.java.home={}\n", jdk21.display()),
    )
    .unwrap();
    let runtime = resolve_with(&root, &[], environment).unwrap().unwrap();
    assert_eq!(runtime.java_major, 21);
    assert_eq!(runtime.selection_reason, "user-properties");
    environment = Environment {
        java_home: None,
        candidates: vec![],
        gradle_home: None,
    };
    let args = vec![format!("-Dorg.gradle.java.home={}", runtime.home.display())];
    assert_eq!(
        resolve_with(&root, &args, environment)
            .unwrap()
            .unwrap()
            .selection_reason,
        "command-line"
    );
    let environment = Environment {
        java_home: None,
        candidates: vec![],
        gradle_home: None,
    };
    fs::write(
        root.join("gradle.properties"),
        format!(
            "org.gradle.java.home={}\n",
            root.parent().unwrap().join("jdk25").display()
        ),
    )
    .unwrap();
    assert!(
        resolve_with(&root, &[], environment)
            .unwrap_err()
            .contains("javaIncompatible")
    );
}

#[test]
fn identity_changes_with_runtime_bytes_and_both_project_and_user_configuration() {
    let (_temporary, root, environment) = fixture();
    let env = || Environment {
        java_home: environment.java_home.clone(),
        candidates: environment.candidates.clone(),
        gradle_home: environment.gradle_home.clone(),
    };
    let first = resolve_with(&root, &[], env()).unwrap().unwrap();
    assert_eq!(
        first.digest,
        resolve_with(&root, &[], env()).unwrap().unwrap().digest
    );
    fs::write(root.join("gradle.properties"), "org.gradle.parallel=true\n").unwrap();
    let second = resolve_with(&root, &[], env()).unwrap().unwrap();
    assert_ne!(first.digest, second.digest);
    fs::write(second.home.join("release"), "JAVA_VERSION=\"17.0.2\"\n").unwrap();
    let third = resolve_with(&root, &[], env()).unwrap().unwrap();
    assert_ne!(second.digest, third.digest);
    fs::write(
        third.home.join(if cfg!(windows) {
            "bin/java.exe"
        } else {
            "bin/java"
        }),
        "updated binary",
    )
    .unwrap();
    let fourth = resolve_with(&root, &[], env()).unwrap().unwrap();
    assert_ne!(third.digest, fourth.digest);
    fs::create_dir_all(environment.gradle_home.as_ref().unwrap()).unwrap();
    fs::write(
        environment
            .gradle_home
            .as_ref()
            .unwrap()
            .join("gradle.properties"),
        "org.gradle.parallel=false\n",
    )
    .unwrap();
    assert_ne!(
        fourth.digest,
        resolve_with(&root, &[], env()).unwrap().unwrap().digest
    );
}

#[test]
fn rejects_missing_java_oversized_configuration_and_unreviewed_contexts() {
    let (_temporary, root, environment) = fixture();
    let empty = || Environment::default();
    assert!(
        resolve_with(&root, &[], empty())
            .unwrap_err()
            .contains("javaMissing")
    );
    for arg in [
        "--project-dir=elsewhere",
        "--settings-file=x",
        "-Duser.home=/tmp",
        "--system-prop=org.gradle.java.home=x",
    ] {
        assert!(
            resolve_with(&root, &[arg.into()], empty())
                .unwrap_err()
                .contains("configuration")
        );
    }
    fs::write(
        root.join("gradle/gradle-daemon-jvm.properties"),
        "toolchainVersion=25\n",
    )
    .unwrap();
    assert!(
        resolve_with(&root, &[], empty())
            .unwrap_err()
            .contains("daemonCriteria")
    );
    fs::remove_file(root.join("gradle/gradle-daemon-jvm.properties")).unwrap();
    fs::write(
        root.join("gradle.properties"),
        vec![b'x'; CONFIG_LIMIT as usize + 1],
    )
    .unwrap();
    assert!(
        resolve_with(&root, &[], environment)
            .unwrap_err()
            .contains("64 KiB")
    );
}

#[test]
fn does_not_select_java_from_workspace_or_change_unrelated_tasks() {
    let (_temporary, root, _) = fixture();
    let home = jdk(&root, "malicious-java", 17);
    let environment = Environment {
        java_home: Some(home.clone()),
        candidates: vec![home],
        gradle_home: None,
    };
    assert!(
        resolve_with(&root, &[], environment)
            .unwrap_err()
            .contains("javaMissing")
    );
    assert_eq!(resolve(&root, "scripts/build", &[]).unwrap(), None);
    fs::remove_file(root.join("gradle/wrapper/gradle-wrapper.properties")).unwrap();
    assert_eq!(
        resolve_with(&root, &[], Environment::default()).unwrap(),
        None
    );
}

#[cfg(unix)]
#[test]
fn rejects_project_configuration_and_java_file_symlink_escapes() {
    use std::os::unix::fs::symlink;
    let (temporary, root, environment) = fixture();
    let external = temporary.path().join("outside.properties");
    fs::write(&external, "org.gradle.java.home=/tmp").unwrap();
    symlink(&external, root.join("gradle.properties")).unwrap();
    assert!(
        resolve_with(&root, &[], environment)
            .unwrap_err()
            .contains("escapes")
    );
    fs::remove_file(root.join("gradle.properties")).unwrap();
    let home = jdk(temporary.path(), "symlink-java", 17)
        .canonicalize()
        .unwrap();
    fs::remove_file(home.join("bin/java")).unwrap();
    symlink(&external, home.join("bin/java")).unwrap();
    let environment = Environment {
        java_home: Some(home),
        candidates: vec![],
        gradle_home: None,
    };
    assert!(
        resolve_with(&root, &[], environment)
            .unwrap_err()
            .contains("installation")
    );
}
