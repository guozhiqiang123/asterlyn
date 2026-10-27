//! Opt-in real Android adapter acceptance through the production native actor.
use super::*;
#[test]
fn actual_packaged_java_keeps_documents_responsive_during_model_work() {
    let (Ok(model), Ok(package), Ok(component), Ok(java)) = (
        std::env::var("ASTERLYN_ANDROID_MODEL"),
        std::env::var("ASTERLYN_ANDROID_LSP_ROOT"),
        std::env::var("ASTERLYN_JDT_COMPONENT"),
        std::env::var("ASTERLYN_JAVA25_HOME"),
    ) else {
        return;
    };
    let bytes = std::fs::read(&model).unwrap();
    let data: Value = serde_json::from_slice(&bytes).unwrap();
    let root = PathBuf::from(data["buildRoot"].as_str().unwrap())
        .canonicalize()
        .unwrap();
    let subject = LanguageSubject {
        owner: "android-acceptance".into(),
        root: root.clone(),
        activation: 1,
    };
    let cache = tempfile::tempdir().unwrap();
    let node = PathBuf::from("/opt/homebrew/bin/node");
    let package = PathBuf::from(package).canonicalize().unwrap();
    let language = LanguagePackage {
        version: "fixture".into(),
        digest: "fixture".into(),
        content_digest: "fixture".into(),
        node: node.clone(),
        node_digest: "fixture".into(),
        root: package.clone(),
        rust: None,
        packaged: Some(PackagedServerProfile {
            id: "android-jvm".into(),
            node,
            package_root: package,
            entry: "server-programs/android-server.mjs".into(),
            initialization_options: json!({"analysis":{"tools":{"serverJava":{"java":PathBuf::from(&java).join("bin/java"),"home":java}},"components":{"jdtls":{"root":component}}}}),
            selectors: vec![("java".into(), vec![".java".into()])],
            cache_parent: cache.path().into(),
        }),
    };
    struct Lease;
    impl ModelResource for Lease {
        fn is_current(&self) -> bool {
            true
        }
        fn generation(&self) -> u64 {
            1
        }
    }
    use sha2::{Digest, Sha256};
    let reference = json!({"path":PathBuf::from(model).canonicalize().unwrap(),"bytes":bytes.len(),"digest":format!("sha256:{:x}",Sha256::digest(&bytes)),"generation":1,"schema":1});
    let access: ModelAccess = Arc::new(move |alive, _| {
        eprintln!("model access called");
        std::thread::sleep(Duration::from_millis(750));
        if !alive.load(Ordering::SeqCst) {
            return Err("ended".into());
        }
        Ok(ModelReply {
            value: reference.clone(),
            resource: Box::new(Lease),
        })
    });
    let manager = LanguageServiceManager::default();
    let (tx, events) = mpsc::channel();
    let emit = Arc::new(move |event: LanguageServiceEvent| {
        eprintln!("actor event {} {:?}", event.kind, event.code);
        let _ = tx.send(event);
    });
    let began = Instant::now();
    let id = manager
        .start_with_models(
            subject.clone(),
            language,
            0,
            Arc::new(|| true),
            emit,
            Some(access),
        )
        .unwrap();
    assert!(
        began.elapsed() < Duration::from_secs(2),
        "startup must not wait for Gradle"
    );
    let path = root.join(
        std::env::var("ASTERLYN_ANDROID_SOURCE").unwrap_or_else(|_| {
            "common/src/main/java/com/swiftcleaner/lib/storage/RecommendConfig.java".into()
        }),
    );
    let text = std::fs::read_to_string(&path).unwrap();
    let uri = url::Url::from_file_path(&path).unwrap().to_string();
    let open = Instant::now();
    manager
        .open(&id, &subject, uri.clone(), "java".into(), 1, text.clone())
        .unwrap()
        .recv_timeout(Duration::from_millis(300))
        .unwrap()
        .unwrap();
    assert!(open.elapsed() < Duration::from_millis(300));
    let deadline = Instant::now() + Duration::from_secs(100);
    let mut ready = false;
    while Instant::now() < deadline {
        if let Ok(event) = events.recv_timeout(Duration::from_millis(100))
            && event.kind == "ready"
        {
            ready = true;
            break;
        }
    }
    assert!(ready, "actual Android backend must become ready");
    let prefix = &text[..text
        .find(
            &std::env::var("ASTERLYN_ANDROID_SYMBOL")
                .unwrap_or_else(|_| "SharedPref.getInt".into()),
        )
        .unwrap()
        + 2];
    let position = TextPosition {
        line: prefix.bytes().filter(|b| *b == b'\n').count() as u32,
        character: prefix.rsplit('\n').next().unwrap().encode_utf16().count() as u32,
    };
    let result = manager
        .request(
            &id,
            &subject,
            uri.clone(),
            1,
            "definition".into(),
            "definition".into(),
            position,
        )
        .unwrap()
        .recv_timeout(Duration::from_secs(32))
        .unwrap()
        .unwrap();
    assert!(result[0]["uri"].as_str().unwrap().ends_with(
        &std::env::var("ASTERLYN_ANDROID_TARGET").unwrap_or_else(|_| "SharedPref.java".into())
    ));
    manager
        .change(
            &id,
            &subject,
            uri,
            2,
            vec![TextChange {
                range: None,
                text: format!("{text}\nclass InvalidSyntax {{ int x = ; }}"),
            }],
        )
        .unwrap()
        .recv_timeout(Duration::from_secs(2))
        .unwrap()
        .unwrap();
    let mut diagnosed = false;
    let deadline = Instant::now() + Duration::from_secs(35);
    while Instant::now() < deadline {
        if let Ok(event) = events.recv_timeout(Duration::from_millis(100))
            && event.kind == "diagnostics"
            && event.version == Some(2)
            && event
                .diagnostics
                .as_ref()
                .is_some_and(|items| items.as_array().is_some_and(|items| !items.is_empty()))
        {
            diagnosed = true;
            break;
        }
    }
    manager.stop(&id, &subject).unwrap();
    assert!(diagnosed, "unsaved Java diagnostics must be version-bound");
}
