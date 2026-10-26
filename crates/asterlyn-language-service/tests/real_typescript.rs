use std::env;
use std::time::Duration;

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
    let mut process = LanguageServiceProcess::start(&profile).expect("start pinned server");
    process.initialize("file:///tmp/asterlyn-language-service-test").expect("initialize");
    let uri = "file:///tmp/asterlyn-language-service-test/emoji.ts";
    process.notify("textDocument/didOpen", Some(json!({"textDocument":{"uri":uri,"languageId":"typescript","version":1,"text":"const 😀 = 1;\r\n😀;\r\n"}}))).expect("open");
    let response = process.request_wait("textDocument/hover", Some(json!({"textDocument":{"uri":uri},"position":{"line":1,"character":0}})), Duration::from_secs(10)).expect("hover response");
    assert!(response.error.is_none(), "server returned error: {:?}", response.error);
    process.stop().expect("finite stop");
}
