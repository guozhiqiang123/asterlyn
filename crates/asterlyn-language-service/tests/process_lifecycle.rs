#![cfg(feature = "process-fixtures")]
use asterlyn_language_service::{
    JsonRpcMessage, LanguageServiceProcess, PackagedServerProfile, ServerEvent, SessionError,
};
use serde_json::{Value, json};
use std::{path::PathBuf, time::Duration};

fn peer() -> (tempfile::TempDir, LanguageServiceProcess) {
    let node=PathBuf::from(std::env::var_os("ASTERLYN_LANGUAGE_SERVICE_NODE").expect("process-fixtures requires an explicit trusted ASTERLYN_LANGUAGE_SERVICE_NODE; run scripts/run-core-language-gates.mjs"));
    assert!(
        node.is_absolute() && node.is_file(),
        "fixture Node must be an existing absolute executable"
    );
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    std::fs::write(root.join("peer.mjs"), include_str!("fixtures/peer.mjs")).unwrap();
    let mut process = LanguageServiceProcess::start_packaged(&PackagedServerProfile {
        id: "portable-fixture".into(),
        node,
        package_root: root.clone(),
        entry: "peer.mjs".into(),
        initialization_options: Value::Null,
        selectors: vec![("typescript".into(), vec![".ts".into()])],
        cache_parent: root,
    })
    .unwrap();
    process.initialize("file:///portable-fixture").unwrap();
    (directory, process)
}

#[test]
fn real_stdio_sync_unicode_cancel_and_late_response() {
    let (_directory, mut process) = peer();
    process.notify("textDocument/didOpen",Some(json!({"textDocument":{"uri":"file:///portable-fixture/main.ts","languageId":"typescript","version":1,"text":"const value = '初始😀';"}}))).unwrap();
    process.notify("textDocument/didChange",Some(json!({"textDocument":{"uri":"file:///portable-fixture/main.ts","version":2},"contentChanges":[{"text":"const value = '未保存😀';"}]}))).unwrap();
    let response = process
        .request_wait(
            "fixture/text",
            Some(json!({"uri":"file:///portable-fixture/main.ts"})),
            Duration::from_secs(3),
        )
        .unwrap();
    assert_eq!(response.result, Some(json!("const value = '未保存😀';")));
    let id = process.request("fixture/delayed", None).unwrap();
    assert!(process.cancel(id).unwrap());
    match process.next_event(Duration::from_secs(3)).unwrap() {
        ServerEvent::Message(JsonRpcMessage::Response(response)) => assert!(
            !process.accept_response(&response),
            "cancelled results must remain stale"
        ),
        other => panic!("expected late response: {other:?}"),
    }
    process.stop().unwrap();
}

#[test]
fn real_unexpected_eof_is_closed_and_fresh_process_works() {
    let (_directory, mut process) = peer();
    let old = process.pid();
    process.notify("fixture/exit", None).unwrap();
    assert!(matches!(
        process.next_event(Duration::from_secs(3)).unwrap(),
        ServerEvent::Eof
    ));
    assert!(matches!(
        process.request("fixture/text", None),
        Err(SessionError::Closed)
    ));
    drop(process);
    let (_replacement, mut fresh) = peer();
    assert_ne!(old, fresh.pid());
    fresh.stop().unwrap();
}

#[test]
fn malformed_frame_is_protocol_io_not_a_silent_timeout() {
    let (_directory, mut process) = peer();
    process.notify("fixture/protocol", None).unwrap();
    assert!(matches!(
        process.next_event(Duration::from_secs(3)).unwrap(),
        ServerEvent::Io(_)
    ));
    drop(process);
}
