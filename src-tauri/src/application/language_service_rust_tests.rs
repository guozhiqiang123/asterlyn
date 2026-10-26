//! Opt-in acceptance of the production multi-profile actor, separate from the rendered transport probe.
use super::*;

#[test]
fn actual_rust_and_typescript_keep_independent_sessions() {
    let (Ok(root), Ok(sysroot), Ok(package_root)) = (
        std::env::var("ASTERLYN_RUST_WORKSPACE"),
        std::env::var("ASTERLYN_RUST_SYSROOT"),
        std::env::var("ASTERLYN_LSP_PACKAGE_ROOT"),
    ) else {
        return;
    };
    let root = PathBuf::from(root).canonicalize().unwrap();
    let sysroot = PathBuf::from(sysroot).canonicalize().unwrap();
    let bin = sysroot.join("bin");
    let rust = RustServerProfile {
        analyzer: bin.join("rust-analyzer"),
        cargo: bin.join("cargo"),
        rustc: bin.join("rustc"),
        rust_src: sysroot.join("lib/rustlib/src/rust/library"),
        sysroot,
        workspace: root.clone(),
    };
    let typescript = LanguagePackage {
        version: "0.2.0".into(),
        digest: "fixture".into(),
        content_digest: "fixture".into(),
        root: package_root.into(),
        node: std::env::var("ASTERLYN_LANGUAGE_SERVICE_NODE")
            .unwrap_or_else(|_| "/opt/homebrew/bin/node".into())
            .into(),
        node_digest: "fixture".into(),
        rust: None,
    };
    let rust_package = LanguagePackage {
        node: rust.analyzer.clone(),
        rust: Some(rust),
        ..typescript.clone()
    };
    let subject = LanguageSubject {
        owner: "mixed-project".into(),
        root: root.clone(),
        activation: 1,
    };
    let manager = LanguageServiceManager::default();
    let review = manager
        .prepare(subject.clone(), typescript.clone())
        .unwrap();
    assert!(
        manager.consume(&review, &subject, &rust_package).is_err(),
        "TS review cannot launch Rust"
    );
    manager.consume(&review, &subject, &typescript).unwrap();
    let (tx, events) = mpsc::channel();
    let emit: Arc<dyn Fn(LanguageServiceEvent) + Send + Sync> = Arc::new(move |event| {
        let _ = tx.send(event);
    });
    let ts = manager
        .start(subject.clone(), typescript, Arc::new(|| true), emit.clone())
        .unwrap();
    let rs = manager
        .start(subject.clone(), rust_package, Arc::new(|| true), emit)
        .unwrap();
    assert_eq!(manager.sessions.lock().unwrap().len(), 2);
    let wait = |rx: Receiver<Result<Value, String>>| {
        rx.recv_timeout(Duration::from_secs(32)).unwrap().unwrap()
    };
    let path = root.join("src-tauri/src/application/language_service.rs");
    let uri = url::Url::from_file_path(&path).unwrap().to_string();
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(
        manager
            .open(
                &rs,
                &subject,
                uri.clone(),
                "typescript".into(),
                1,
                text.clone()
            )
            .unwrap()
            .recv()
            .unwrap()
            .is_err()
    );
    wait(
        manager
            .open(&rs, &subject, uri.clone(), "rust".into(), 1, text.clone())
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut ready = false;
    while Instant::now() < deadline {
        if let Ok(event) = events.recv_timeout(Duration::from_millis(100))
            && event.session_id == rs
            && event.kind == "ready"
        {
            ready = true;
            break;
        }
    }
    assert!(
        ready,
        "production actor must publish Rust workspace readiness"
    );
    let offset = text.find("start(&TypeScriptServerProfile").unwrap() + 2;
    let prefix = &text[..offset];
    let target = wait(
        manager
            .request(
                &rs,
                &subject,
                uri,
                1,
                "definition".into(),
                "definition".into(),
                TextPosition {
                    line: prefix.bytes().filter(|b| *b == b'\n').count() as u32,
                    character: prefix.rsplit('\n').next().unwrap().encode_utf16().count() as u32,
                },
            )
            .unwrap(),
    );
    assert!(
        target[0]["uri"]
            .as_str()
            .unwrap()
            .ends_with("crates/asterlyn-language-service/src/lib.rs")
    );
    wait(
        manager
            .change(
                &rs,
                &subject,
                url::Url::from_file_path(&path).unwrap().to_string(),
                2,
                vec![TextChange {
                    range: None,
                    text: format!("{text}\nfn broken( {{\n"),
                }],
            )
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(32);
    let mut diagnosed = false;
    while Instant::now() < deadline {
        if let Ok(event) = events.recv_timeout(Duration::from_millis(100))
            && event.session_id == rs
            && event.kind == "diagnostics"
            && event.version == Some(2)
        {
            diagnosed = event
                .diagnostics
                .unwrap()
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["source"] == "rust-analyzer");
            if diagnosed {
                break;
            }
        }
    }
    assert!(
        diagnosed,
        "production Rust diagnostics must bind the new unsaved version"
    );
    let ts_uri = url::Url::from_file_path(root.join("src/app.ts"))
        .unwrap()
        .to_string();
    wait(
        manager
            .open(
                &ts,
                &subject,
                ts_uri.clone(),
                "typescript".into(),
                1,
                "const value = 1;\nvalue;\n".into(),
            )
            .unwrap(),
    );
    manager.stop(&rs, &subject).unwrap();
    assert_eq!(manager.sessions.lock().unwrap().len(), 1);
    let hover = wait(
        manager
            .request(
                &ts,
                &subject,
                ts_uri,
                1,
                "hover".into(),
                "hover".into(),
                TextPosition {
                    line: 1,
                    character: 2,
                },
            )
            .unwrap(),
    );
    assert!(
        hover.get("contents").is_some(),
        "stopping Rust must leave TypeScript working"
    );
    manager.stop(&ts, &subject).unwrap();
    assert!(manager.sessions.lock().unwrap().is_empty());
}

#[test]
fn rust_diagnostics_are_bounded_and_validate_utf16_positions() {
    assert!(rust_diagnostic_item("😀", &json!({"range":{"start":{"line":0,"character":1},"end":{"line":0,"character":2}},"message":"bad"})).is_none());
    let item=rust_diagnostic_item("let x = 1;", &json!({"range":{"start":{"line":0,"character":4},"end":{"line":0,"character":5}},"message":"x".repeat(9000),"severity":1,"relatedInformation":[{"secret":"discard"}]})).unwrap();
    assert_eq!(item["message"].as_str().unwrap().len(), 8192);
    assert!(item.get("relatedInformation").is_none());
}
