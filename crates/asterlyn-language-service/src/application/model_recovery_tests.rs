use super::*;

#[test]
fn selection_change_recovers_failed_model_without_reopening_the_document() {
    let node = std::env::var("ASTERLYN_LANGUAGE_SERVICE_NODE").expect("explicit Node fixture");
    let package = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    std::fs::write(package.path().join("server.mjs"), r#"
let buffer=Buffer.alloc(0),id=100,modelId,opened=0,uri;
const send=m=>{const b=Buffer.from(JSON.stringify({jsonrpc:'2.0',...m}));process.stdout.write('Content-Length: '+b.length+'\r\n\r\n');process.stdout.write(b);};
const load=()=>{modelId=++id;send({id:modelId,method:'asterlyn/workspaceModel',params:{refresh:false}});};
process.stdin.on('data',c=>{buffer=Buffer.concat([buffer,c]);for(;;){const i=buffer.indexOf('\r\n\r\n');if(i<0)return;const n=Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0,i).toString())[1]);if(buffer.length<i+4+n)return;const m=JSON.parse(buffer.subarray(i+4,i+4+n));buffer=buffer.subarray(i+4+n);
if(m.method==='initialize')send({id:m.id,result:{capabilities:{positionEncoding:'utf-16'}}});
else if(m.method==='initialized'||m.method==='asterlyn/modelInvalidated')load();
else if(m.id===modelId&&!m.method)send({method:'experimental/serverStatus',params:{health:m.error?'error':'ok',quiescent:!m.error,code:m.error?'model-selection-unavailable':undefined,progress:{phase:m.error?'failed':'ready'}}});
else if(m.method==='textDocument/didOpen'){opened++;uri=m.params.textDocument.uri;}
else if(m.method==='textDocument/definition')send({id:m.id,result:opened===1?[{uri,range:{start:{line:0,character:0},end:{line:0,character:1}}}]:[]});
}});
"#).unwrap();
    let root = workspace.path().canonicalize().unwrap();
    std::fs::write(root.join("Source.java"), "class Source {}\n").unwrap();
    let uri = url::Url::from_file_path(root.join("Source.java")).unwrap().to_string();
    let subject = LanguageSubject { owner: "model-recovery".into(), root, activation: 1 };
    let language = LanguagePackage {
        version: "test".into(), digest: "test".into(), content_digest: "test".into(),
        root: package.path().into(), node: node.clone().into(), node_digest: "test".into(), rust: None,
        packaged: Some(PackagedServerProfile { id: "android-jvm".into(), node: node.into(),
            package_root: package.path().into(), entry: "server.mjs".into(), initialization_options: json!({}),
            selectors: vec![("java".into(), vec![".java".into()])], cache_parent: cache.path().into() }),
    };
    struct Lease;
    impl ModelResource for Lease { fn is_current(&self) -> bool { true } fn generation(&self) -> u64 { 2 } }
    let revision = Arc::new(AtomicU64::new(1));
    let calls = Arc::new(AtomicU64::new(0));
    let probes = Arc::new(AtomicU64::new(0));
    let load_revision = revision.clone(); let load_calls = calls.clone();
    let observe_revision = revision.clone(); let observe_calls = probes.clone();
    let access = ModelAccess::new(Arc::new(move |_, _| {
        load_calls.fetch_add(1, Ordering::SeqCst);
        if load_revision.load(Ordering::SeqCst) == 1 { return Err("model-selection-unavailable".into()); }
        Ok(ModelReply { value: json!({"generation":2}), resource: Box::new(Lease) })
    })).with_observer(Arc::new(move || {
        let selection = observe_revision.load(Ordering::SeqCst).to_string();
        observe_calls.fetch_add(1, Ordering::SeqCst);
        Ok(ModelInputs { inputs: "unchanged".into(), selection })
    }));
    let manager = LanguageServiceManager::default();
    let (sender, events) = mpsc::channel();
    let id = manager.start_with_models(subject.clone(), language, 0, Arc::new(|| true),
        Arc::new(move |event| { let _ = sender.send(event); }), Some(access)).unwrap();
    let wait = |kind: &str| {
        let until = Instant::now() + Duration::from_secs(8);
        while Instant::now() < until {
            if let Ok(event) = events.recv_timeout(Duration::from_millis(100)) {
                if event.kind == kind { return; }
            }
        }
        panic!("missing {kind} event");
    };
    wait("degraded");
    manager.open(&id, &subject, uri.clone(), "java".into(), 1, "class Source {}\n".into())
        .unwrap().recv_timeout(Duration::from_secs(1)).unwrap().unwrap();
    std::thread::sleep(Duration::from_millis(2300));
    assert!(probes.load(Ordering::SeqCst) >= 1);
    assert_eq!(calls.load(Ordering::SeqCst), 1, "failed model observation does not run Gradle repeatedly");
    revision.store(2, Ordering::SeqCst);
    wait("ready");
    let result = manager.request(&id, &subject, uri, 1, "navigation".into(), "definition".into(),
        TextPosition { line: 0, character: 6 }).unwrap().recv_timeout(Duration::from_secs(2)).unwrap().unwrap();
    assert_eq!(result.as_array().unwrap().len(), 1, "open documents survived recovery exactly once");
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    manager.stop(&id, &subject).unwrap();
}
