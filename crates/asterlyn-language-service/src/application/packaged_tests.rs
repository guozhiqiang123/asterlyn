//! Opt-in real Android adapter acceptance through the production native actor.
use super::*;
#[cfg(feature = "process-fixtures")]
#[test]
fn internal_backend_recovery_invalidates_pending_results_without_reopening_documents() {
    let node = std::env::var("ASTERLYN_LANGUAGE_SERVICE_NODE")
        .expect("explicit fixture requires ASTERLYN_LANGUAGE_SERVICE_NODE");
    let package = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let entry = package.path().join("server.mjs");
    std::fs::write(&entry,r#"let b=Buffer.alloc(0),first=true;function send(m){const out=Buffer.from(JSON.stringify({jsonrpc:'2.0',...m}));process.stdout.write('Content-Length: '+out.length+'\r\n\r\n');process.stdout.write(out);}function status(code){send({method:'experimental/serverStatus',params:{health:code?'warning':'ok',quiescent:true,code,progress:{phase:code?'backend':'ready'}}});}process.stdin.on('data',c=>{b=Buffer.concat([b,c]);for(;;){const i=b.indexOf('\r\n\r\n');if(i<0)return;const n=Number(/Content-Length: (\d+)/i.exec(b.subarray(0,i).toString())[1]);if(b.length<i+4+n)return;const m=JSON.parse(b.subarray(i+4,i+4+n));b=b.subarray(i+4+n);if(m.method==='initialize')send({id:m.id,result:{capabilities:{positionEncoding:'utf-16'}}});else if(m.method==='initialized')status();else if(m.method==='textDocument/definition'){if(first){first=false;status('kotlin-backend-recovering');setTimeout(()=>status(),50);}send({id:m.id,result:[{uri:m.params.textDocument.uri,range:{start:{line:0,character:0},end:{line:0,character:1}}}]});}}});"#).unwrap();
    let root = workspace.path().canonicalize().unwrap();
    let source = root.join("Source.java");
    std::fs::write(&source, "class Source {}\n").unwrap();
    let uri = url::Url::from_file_path(source).unwrap().to_string();
    let subject = LanguageSubject {
        owner: "internal-recovery-test".into(),
        root,
        activation: 1,
    };
    let language = LanguagePackage {
        version: "test".into(),
        digest: "test".into(),
        content_digest: "test".into(),
        root: package.path().to_owned(),
        node: node.clone().into(),
        node_digest: "test".into(),
        rust: None,
        packaged: Some(PackagedServerProfile {
            id: "android-jvm".into(),
            node: node.into(),
            package_root: package.path().to_owned(),
            entry: "server.mjs".into(),
            initialization_options: json!({}),
            selectors: vec![("java".into(), vec![".java".into()])],
            cache_parent: cache.path().to_owned(),
        }),
    };
    let manager = LanguageServiceManager::default();
    let (sender, events) = mpsc::channel();
    let id = manager
        .start_with_models(
            subject.clone(),
            language,
            0,
            Arc::new(|| true),
            Arc::new(move |event| {
                let _ = sender.send(event);
            }),
            None,
        )
        .unwrap();
    let ready = || {
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if let Ok(event) = events.recv_timeout(Duration::from_millis(100))
                && event.kind == "ready"
            {
                return;
            }
        }
        panic!("fixture never ready");
    };
    ready();
    manager
        .open(
            &id,
            &subject,
            uri.clone(),
            "java".into(),
            1,
            "class Source {}\n".into(),
        )
        .unwrap()
        .recv_timeout(Duration::from_secs(1))
        .unwrap()
        .unwrap();
    let ask = |request: &str| {
        manager
            .request(
                &id,
                &subject,
                uri.clone(),
                1,
                request.into(),
                "definition".into(),
                TextPosition {
                    line: 0,
                    character: 6,
                },
            )
            .unwrap()
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
    };
    assert!(ask("old").unwrap_err().contains("stale"));
    ready();
    assert_eq!(ask("fresh").unwrap().as_array().unwrap().len(), 1);
    manager.stop(&id, &subject).unwrap();
}
#[cfg(feature = "android-fixtures")]
#[test]
fn actual_packaged_java_keeps_documents_responsive_during_model_work() {
    let model = std::env::var("ASTERLYN_ANDROID_MODEL")
        .expect("android fixture requires ASTERLYN_ANDROID_MODEL");
    let package = std::env::var("ASTERLYN_ANDROID_LSP_ROOT")
        .expect("android fixture requires ASTERLYN_ANDROID_LSP_ROOT");
    let component = std::env::var("ASTERLYN_JDT_COMPONENT")
        .expect("android fixture requires ASTERLYN_JDT_COMPONENT");
    let java = std::env::var("ASTERLYN_JAVA25_HOME")
        .expect("android fixture requires ASTERLYN_JAVA25_HOME");
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
    let access = ModelAccess::new(Arc::new(move |alive, _| {
        eprintln!("model access called");
        std::thread::sleep(Duration::from_millis(750));
        if !alive.load(Ordering::SeqCst) {
            return Err("ended".into());
        }
        Ok(ModelReply {
            value: reference.clone(),
            resource: Box::new(Lease),
        })
    }));
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

#[cfg(feature = "process-fixtures")]
#[test]
fn private_resource_channel_validates_bounds_and_cancellation_releases_grants() {
    let node=std::env::var("ASTERLYN_LANGUAGE_SERVICE_NODE").expect("explicit Node fixture");
    let package=tempfile::tempdir().unwrap();let workspace=tempfile::tempdir().unwrap();let cache=tempfile::tempdir().unwrap();
    std::fs::write(package.path().join("resource.mjs"),r#"
let b=Buffer.alloc(0),lease;function send(m){const out=Buffer.from(JSON.stringify({jsonrpc:'2.0',...m}));process.stdout.write('Content-Length: '+out.length+'\r\n\r\n');process.stdout.write(out);}
function request(id,n){send({id,method:'asterlyn/analysisResources.reserve',params:{memoryMiB:n}});}
process.stdin.on('data',c=>{b=Buffer.concat([b,c]);for(;;){const i=b.indexOf('\r\n\r\n');if(i<0)return;const n=Number(/Content-Length: (\d+)/i.exec(b.subarray(0,i).toString())[1]);if(b.length<i+4+n)return;const m=JSON.parse(b.subarray(i+4,i+4+n));b=b.subarray(i+4+n);
if(m.method==='initialize'){if(m.params.initializationOptions.analysis.resourcePolicy.schema!==1)process.exit(11);send({id:m.id,result:{capabilities:{positionEncoding:'utf-16'}}});}
else if(m.method==='initialized')request('bad',-1);
else if(m.id==='bad'){if(m.error?.message!=='analysis-resource-request-invalid')process.exit(12);request('one',512);}
else if(m.id==='one'){if(!/^resource-/.test(m.result?.leaseId))process.exit(13);lease=m.result.leaseId;send({method:'$/cancelRequest',params:{id:'one'}});request('two',512);}
else if(m.id==='two'){send({method:'asterlyn/analysisResources.release',params:{leaseId:m.result.leaseId}});send({method:'experimental/serverStatus',params:{health:'ok',quiescent:true,code:'resource-fixture-ok',progress:{phase:'ready'}}});}
}});
"#).unwrap();
    let subject=LanguageSubject{owner:"resources-fixture".into(),root:workspace.path().canonicalize().unwrap(),activation:1};
    let language=LanguagePackage{version:"test".into(),digest:"test".into(),content_digest:"test".into(),root:package.path().into(),node:node.clone().into(),node_digest:"test".into(),rust:None,packaged:Some(PackagedServerProfile{id:"android-jvm".into(),node:node.into(),package_root:package.path().into(),entry:"resource.mjs".into(),initialization_options:json!({}),selectors:vec![("java".into(),vec![".java".into()])],cache_parent:cache.path().into()})};
    let manager=LanguageServiceManager::default();let (tx,rx)=mpsc::channel();
    let id=manager.start_with_models(subject.clone(),language,0,Arc::new(||true),Arc::new(move|event|{let _=tx.send(event);}),None).unwrap();
    let deadline=Instant::now()+Duration::from_secs(3);let mut ready=false;
    while Instant::now()<deadline{if let Ok(event)=rx.recv_timeout(Duration::from_millis(50))&&event.code.as_deref()==Some("resource-fixture-ok"){ready=true;break;}}
    manager.stop(&id,&subject).unwrap();assert!(ready,"resource protocol fixture did not finish");
}
