//! Opt-in real toolchain acceptance. Does not change the workspace on disk.
use asterlyn_language_service::{
    JsonRpcMessage, LanguageServiceProcess, RustServerProfile, ServerEvent,
};
use serde_json::{Value, json};
use std::{
    env, fs,
    path::PathBuf,
    time::{Duration, Instant},
};

fn position(text: &str, needle: &str) -> Value {
    let prefix = &text[..text.find(needle).unwrap() + 2];
    json!({"line":prefix.bytes().filter(|v| *v == b'\n').count(), "character":prefix.rsplit('\n').next().unwrap().encode_utf16().count()})
}
fn ready(process: &mut LanguageServiceProcess) {
    let deadline = Instant::now() + Duration::from_secs(60);
    while Instant::now() < deadline {
        match process.next_event(Duration::from_secs(30)).unwrap() {
            ServerEvent::Message(JsonRpcMessage::Notification(event))
                if event.method == "experimental/serverStatus" =>
            {
                if event
                    .params
                    .as_ref()
                    .is_some_and(|p| p["quiescent"] == true && p["health"] == "ok")
                {
                    return;
                }
            }
            ServerEvent::Message(JsonRpcMessage::Request(request)) => {
                process.reject_request(&request).unwrap()
            }
            ServerEvent::Message(_) => {}
            other => panic!("server stopped: {other:?}"),
        }
    }
    panic!("Rust project model did not become ready");
}
#[test]
fn real_rust_workspace_navigation_unsaved_buffers_and_diagnostics() {
    let (Ok(root), Ok(sysroot)) = (
        env::var("ASTERLYN_RUST_WORKSPACE"),
        env::var("ASTERLYN_RUST_SYSROOT"),
    ) else {
        return;
    };
    let root = PathBuf::from(root).canonicalize().unwrap();
    let sysroot = PathBuf::from(sysroot).canonicalize().unwrap();
    let bin = sysroot.join("bin");
    let mut process = LanguageServiceProcess::start_rust(&RustServerProfile {
        analyzer: bin.join("rust-analyzer"),
        cargo: bin.join("cargo"),
        rustc: bin.join("rustc"),
        rust_src: sysroot.join("lib/rustlib/src/rust/library"),
        sysroot,
        workspace: root.clone(),
    })
    .unwrap();
    let file = root.join("src-tauri/src/application/language_service.rs");
    let target = root.join("crates/asterlyn-language-service/src/lib.rs");
    let original = fs::read_to_string(&file).unwrap();
    let target_original = fs::read_to_string(&target).unwrap();
    let uri = format!("file://{}", file.display());
    let target_uri = format!("file://{}", target.display());
    let call = position(&original, "start(&TypeScriptServerProfile");
    let started = Instant::now();
    process
        .initialize(&format!("file://{}/", root.display()))
        .unwrap();
    process
        .notify(
            "textDocument/didOpen",
            Some(
                json!({"textDocument":{"uri":uri,"languageId":"rust","version":1,"text":original}}),
            ),
        )
        .unwrap();
    ready(&mut process);
    let response = process
        .request_wait(
            "textDocument/definition",
            Some(json!({"textDocument":{"uri":uri},"position":call})),
            Duration::from_secs(30),
        )
        .unwrap();
    let found = response.result.unwrap();
    assert_eq!(
        found[0]["uri"], target_uri,
        "actual Rust call must resolve across workspace crates"
    );
    let original_line = found[0]["range"]["start"]["line"].as_u64().unwrap();
    let symbol = position(&original, "LanguageServiceProcess,");
    let hover = process
        .request_wait(
            "textDocument/hover",
            Some(json!({"textDocument":{"uri":uri},"position":symbol})),
            Duration::from_secs(30),
        )
        .unwrap();
    assert!(hover.result.is_some_and(|value| !value.is_null()));
    let references = process.request_wait("textDocument/references",Some(json!({"textDocument":{"uri":uri},"position":symbol,"context":{"includeDeclaration":false}})),Duration::from_secs(30)).unwrap();
    assert!(references.result.unwrap().as_array().unwrap().len() > 1);
    let completions = process
        .request_wait(
            "textDocument/completion",
            Some(json!({"textDocument":{"uri":uri},"position":call})),
            Duration::from_secs(30),
        )
        .unwrap()
        .result
        .unwrap();
    let items = completions
        .as_array()
        .or_else(|| completions["items"].as_array())
        .unwrap();
    assert!(
        items.iter().any(|item| item["label"]
            .as_str()
            .is_some_and(|label| label.starts_with("start"))),
        "real Rust completion must resolve the current type's start method"
    );
    process.notify("textDocument/didOpen",Some(json!({"textDocument":{"uri":target_uri,"languageId":"rust","version":1,"text":target_original}}))).unwrap();
    process.notify("textDocument/didChange",Some(json!({"textDocument":{"uri":target_uri,"version":2},"contentChanges":[{"text":format!("// unsaved 😀\n{target_original}")}]}))).unwrap();
    let changed = process
        .request_wait(
            "textDocument/definition",
            Some(json!({"textDocument":{"uri":uri},"position":call})),
            Duration::from_secs(30),
        )
        .unwrap();
    assert_eq!(
        changed.result.unwrap()[0]["range"]["start"]["line"],
        original_line + 1,
        "navigation must resolve the unsaved target buffer"
    );
    process.notify("textDocument/didChange",Some(json!({"textDocument":{"uri":uri,"version":2},"contentChanges":[{"text":format!("{original}\nfn broken( {{\n")}]}))).unwrap();
    if process.supports_diagnostic_pull() {
        let diagnostics = process
            .request_wait(
                "textDocument/diagnostic",
                Some(json!({"textDocument":{"uri":uri},"identifier":"rust-analyzer"})),
                Duration::from_secs(30),
            )
            .unwrap();
        assert!(
            diagnostics.result.unwrap()["items"]
                .as_array()
                .is_some_and(|items| !items.is_empty()),
            "pull diagnostics must reflect the synchronized unsaved syntax error"
        );
    } else {
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut diagnosed = false;
        while Instant::now() < deadline {
            match process.next_event(Duration::from_secs(10)).unwrap() {
                ServerEvent::Message(JsonRpcMessage::Notification(event))
                    if event.method == "textDocument/publishDiagnostics" =>
                {
                    if event.params.is_some_and(|p| {
                        p["uri"] == uri
                            && p["version"] == 2
                            && p["diagnostics"]
                                .as_array()
                                .is_some_and(|items| !items.is_empty())
                    }) {
                        diagnosed = true;
                        break;
                    }
                }
                ServerEvent::Message(JsonRpcMessage::Request(request)) => {
                    process.reject_request(&request).unwrap()
                }
                ServerEvent::Message(_) => {}
                other => panic!("server stopped: {other:?}"),
            }
        }
        assert!(diagnosed, "push diagnostics must bind the unsaved version");
    }
    eprintln!(
        "real Rust workspace: cross-crate definition, hover, multiple references, completion, unsaved target +1 line and versioned diagnostics passed in {}ms",
        started.elapsed().as_millis()
    );
    process.stop().unwrap();
    assert_eq!(fs::read_to_string(file).unwrap(), original);
    assert_eq!(fs::read_to_string(target).unwrap(), target_original);
}
