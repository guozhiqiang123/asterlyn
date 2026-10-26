use std::env;
use std::time::Duration;
use std::time::Instant;

use asterlyn_language_service::{LanguageServiceProcess, TypeScriptServerProfile};
use serde_json::json;

fn tsserver_diagnostics(process: &mut LanguageServiceProcess, file: &str, command: &str) -> usize {
    process
        .request_wait(
            "workspace/executeCommand",
            Some(json!({"command":"typescript.tsserverRequest","arguments":[command,{"file":file,"includeLinePosition":true},{"isAsync":false,"expectsResult":true}]})),
            Duration::from_secs(10),
        )
        .expect("tsserver diagnostics response")
        .result
        .as_ref()
        .and_then(|result| result.get("body").or(Some(result)))
        .and_then(serde_json::Value::as_array)
        .map_or(0, |items| items.len())
}

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
        .unwrap_or_else(|| {
            std::path::PathBuf::from(std::env::current_exe().expect("current executable"))
                .parent()
                .expect("node parent")
                .join("node")
        });
    if !node.is_file() {
        eprintln!(
            "skipping real TypeScript server test: trusted Node path is missing: {}",
            node.display()
        );
        return;
    }
    let profile = TypeScriptServerProfile {
        package_root: root.into(),
        node,
    };
    let started = Instant::now();
    let mut process = LanguageServiceProcess::start(&profile).expect("start pinned server");
    process
        .initialize("file:///tmp/asterlyn-language-service-test")
        .expect("initialize");
    let uri = "file:///tmp/asterlyn-language-service-test/emoji.ts";
    let js_uri = "file:///tmp/asterlyn-language-service-test/use.mjs";
    process.notify("textDocument/didOpen", Some(json!({"textDocument":{"uri":uri,"languageId":"typescript","version":1,"text":"export const emojiValue = 1; // 😀\r\nemojiValue;\r\n"}}))).expect("open");
    process.notify("textDocument/didOpen", Some(json!({"textDocument":{"uri":js_uri,"languageId":"javascript","version":1,"text":"const emojiValue = 1; // 😀\r\nemojiValue;\r\n"}}))).expect("open js");
    let response = process
        .request_wait(
            "textDocument/hover",
            Some(json!({"textDocument":{"uri":uri},"position":{"line":1,"character":0}})),
            Duration::from_secs(10),
        )
        .expect("hover response");
    assert!(
        response.error.is_none(),
        "server returned error: {:?}",
        response.error
    );
    let hover = response.result.as_ref().expect("hover result was unexpectedly absent");
    assert!(!hover.is_null() && serde_json::to_string(hover).expect("hover JSON").contains("emojiValue"), "hover result lacked symbol contents: {hover}");
    let completion = process
        .request_wait(
            "textDocument/completion",
            Some(json!({"textDocument":{"uri":js_uri},"position":{"line":1,"character":10}})),
            Duration::from_secs(10),
        )
        .expect("completion response");
    let completion_result = completion.result.as_ref().expect("completion result was absent");
    assert!(completion.error.is_none() && completion_result.get("items").and_then(serde_json::Value::as_array).is_some_and(|items| !items.is_empty()), "completion items were absent: {completion_result}");
    let definition = process
        .request_wait(
            "textDocument/definition",
            Some(json!({"textDocument":{"uri":js_uri},"position":{"line":1,"character":0}})),
            Duration::from_secs(10),
        )
        .expect("definition response");
    let definitions = definition.result.as_ref().expect("definition result was absent");
    assert!(definition.error.is_none() && definitions.as_array().is_some_and(|items| !items.is_empty()), "definition locations were absent: {definitions}");
    process.notify("textDocument/didChange", Some(json!({"textDocument":{"uri":uri,"version":2},"contentChanges":[{"text":"export const emojiValue = ; // 😀\r\nemojiValue;\r\n"}]}))).expect("invalid change");
    let invalid_diagnostics = tsserver_diagnostics(&mut process, "/tmp/asterlyn-language-service-test/emoji.ts", "semanticDiagnosticsSync")
        + tsserver_diagnostics(&mut process, "/tmp/asterlyn-language-service-test/emoji.ts", "syntacticDiagnosticsSync");
    assert!(invalid_diagnostics > 0, "didChange invalid buffer produced no diagnostics");
    process.notify("textDocument/didChange", Some(json!({"textDocument":{"uri":uri,"version":3},"contentChanges":[{"text":"export const emojiValue = 1; // 😀\r\nemojiValue;\r\n"}]}))).expect("fixed change");
    let fixed_diagnostics = tsserver_diagnostics(&mut process, "/tmp/asterlyn-language-service-test/emoji.ts", "semanticDiagnosticsSync")
        + tsserver_diagnostics(&mut process, "/tmp/asterlyn-language-service-test/emoji.ts", "syntacticDiagnosticsSync");
    assert_eq!(fixed_diagnostics, 0, "fixed buffer still has diagnostics");
    assert!(started.elapsed() < Duration::from_secs(10), "cold startup exceeded bound");
    let stop_started = Instant::now();
    process.stop().expect("finite stop");
    assert!(stop_started.elapsed() < Duration::from_secs(3), "process tree cleanup exceeded bound");
}
