use std::env;
use std::time::Duration;
use std::time::Instant;

use asterlyn_language_service::{LanguageServiceProcess, TypeScriptServerProfile};
use serde_json::json;

/// Runs the production transport against the sibling plugin's pinned server when the local
/// checkout is available. CI without the sibling package skips explicitly rather than pretending
/// metadata-only coverage is an operational language-service test.
#[test]
fn real_typescript_hover_uses_unsaved_unicode_crlf_buffer() {
    let Some(root) = env::var_os("ASTERLYN_LSP_PACKAGE_ROOT") else {
        eprintln!("skipping real TypeScript server test: ASTERLYN_LSP_PACKAGE_ROOT is not set");
        return;
    };
    let root = root.into_string().expect("UTF-8 package root");
    let node = env::var_os("ASTERLYN_LANGUAGE_SERVICE_NODE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(std::env::current_exe().expect("current executable")).parent().expect("node parent").join("node"));
    if !node.is_file() {
        eprintln!("skipping real TypeScript server test: trusted Node path is missing: {}", node.display());
        return;
    }
    let profile = TypeScriptServerProfile { package_root: root.into(), node };
    let started = Instant::now();
    let mut process = LanguageServiceProcess::start(&profile).expect("start pinned server");
    process.initialize("file:///tmp/asterlyn-language-service-test").expect("initialize");
    let uri = "file:///tmp/asterlyn-language-service-test/emoji.ts";
    let js_uri = "file:///tmp/asterlyn-language-service-test/use.mjs";
    process.notify("textDocument/didOpen", Some(json!({"textDocument":{"uri":uri,"languageId":"typescript","version":1,"text":"export const emojiValue = 1; // 😀\r\nemojiValue;\r\n"}}))).expect("open");
    process.notify("textDocument/didOpen", Some(json!({"textDocument":{"uri":js_uri,"languageId":"javascript","version":1,"text":"const emojiValue = 1; // 😀\r\nemojiValue;\r\n"}}))).expect("open js");
    let mut diagnostics_seen = false;
    for _ in 0..20 { if let Some(event) = process.poll_event().expect("poll diagnostics") { if matches!(event, asterlyn_language_service::ServerEvent::Message(asterlyn_language_service::JsonRpcMessage::Notification(ref notification)) if notification.method == "textDocument/publishDiagnostics") { diagnostics_seen = true; break; } } std::thread::sleep(Duration::from_millis(25)); }
    assert!(diagnostics_seen, "expected a bounded publishDiagnostics event");
    let response = process.request_wait("textDocument/hover", Some(json!({"textDocument":{"uri":uri},"position":{"line":1,"character":0}})), Duration::from_secs(10)).expect("hover response");
    assert!(response.error.is_none(), "server returned error: {:?}", response.error);
    assert!(response.result.is_some(), "hover result was unexpectedly absent");
    let completion = process.request_wait("textDocument/completion", Some(json!({"textDocument":{"uri":js_uri},"position":{"line":1,"character":0}})), Duration::from_secs(10)).expect("completion response");
    assert!(completion.error.is_none() && completion.result.is_some(), "completion result was absent");
    let definition = process.request_wait("textDocument/definition", Some(json!({"textDocument":{"uri":js_uri},"position":{"line":1,"character":0}})), Duration::from_secs(10)).expect("definition response");
    assert!(definition.error.is_none(), "definition returned error: {:?}", definition.error);
    process.notify("textDocument/didChange", Some(json!({"textDocument":{"uri":uri,"version":2},"contentChanges":[{"text":"export const emojiValue = ; // 😀\r\nemojiValue;\r\n"}]}))).expect("change");
    assert!(started.elapsed() < Duration::from_secs(10), "cold startup exceeded bound");
    process.stop().expect("finite stop");
}
