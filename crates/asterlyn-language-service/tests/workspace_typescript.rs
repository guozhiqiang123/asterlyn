//! Opt-in read-only acceptance against a real workspace, rather than a tiny synthetic project.
use asterlyn_language_service::{LanguageServiceProcess, TypeScriptServerProfile};
use serde_json::{Value, json};
use std::{
    env, fs,
    path::PathBuf,
    time::{Duration, Instant},
};

#[test]
fn actual_workspace_unsaved_diagnostics_hover_definition_and_completion() {
    let (Ok(workspace), Ok(package), Ok(node)) = (
        env::var("ASTERLYN_LSP_WORKSPACE_ROOT"),
        env::var("ASTERLYN_LSP_PACKAGE_ROOT"),
        env::var("ASTERLYN_LANGUAGE_SERVICE_NODE"),
    ) else {
        eprintln!(
            "real workspace acceptance requires explicit workspace/package/Node environment paths"
        );
        return;
    };
    let workspace = PathBuf::from(workspace).canonicalize().unwrap();
    // Relative path can be selected for another TS workspace. The test never saves this overlay.
    let relative = env::var("ASTERLYN_LSP_WORKSPACE_FILE")
        .unwrap_or_else(|_| "src/features/files-editor/text-blame-availability.ts".into());
    let file = workspace.join(relative).canonicalize().unwrap();
    assert!(file.starts_with(&workspace));
    let original = fs::read(&file).unwrap();
    let source = String::from_utf8(original.clone())
        .unwrap()
        .replace("\r\n", "\n");
    let text = format!("{source}\nconst __asterlynLspProbe: string = 1;\n__asterlynLspProbe;\n");
    let declaration_line = source.bytes().filter(|byte| *byte == b'\n').count() + 1;
    let uri = format!("file://{}", file.display());
    let root_uri = format!("file://{}", workspace.display());
    let mut process = LanguageServiceProcess::start(&TypeScriptServerProfile {
        package_root: PathBuf::from(package),
        node: PathBuf::from(node),
    })
    .unwrap();
    let started = Instant::now();
    process.initialize(&root_uri).unwrap();
    process.notify("textDocument/didOpen",Some(json!({"textDocument":{"uri":uri,"languageId":"typescript","version":1,"text":text}}))).unwrap();
    let diagnostics=process.request_wait("workspace/executeCommand",Some(json!({"command":"typescript.tsserverRequest","arguments":["semanticDiagnosticsSync",{"file":file,"includeLinePosition":true},{"isAsync":false,"expectsResult":true}]})),Duration::from_secs(10)).unwrap();
    assert!(diagnostics.error.is_none());
    let body = diagnostics.result.unwrap();
    assert!(
        body["body"]
            .as_array()
            .unwrap()
            .iter()
            .any(|diagnostic| diagnostic["code"] == 2322
                && diagnostic
                    .get("startLocation")
                    .unwrap_or(&diagnostic["start"])["line"]
                    == json!(declaration_line + 1)),
        "unsaved error must be diagnosed in the actual project"
    );
    let position =
        json!({"textDocument":{"uri":uri},"position":{"line":declaration_line+1,"character":4}});
    for (method, field) in [
        ("textDocument/hover", Some("contents")),
        ("textDocument/definition", None),
    ] {
        let response = process
            .request_wait(method, Some(position.clone()), Duration::from_secs(10))
            .unwrap();
        assert!(response.error.is_none());
        let result = response.result.unwrap();
        if let Some(field) = field {
            assert!(result.get(field).is_some())
        } else {
            assert!(result.as_array().is_some_and(|items| !items.is_empty()))
        }
    }
    let completion=process.request_wait("textDocument/completion",Some(json!({"textDocument":{"uri":uri},"position":{"line":declaration_line+1,"character":16}})),Duration::from_secs(10)).unwrap();
    assert!(completion.error.is_none());
    let result = completion.result.unwrap();
    let items = result
        .as_array()
        .or_else(|| result.get("items").and_then(Value::as_array))
        .unwrap();
    assert!(
        items
            .iter()
            .any(|item| item["label"] == "__asterlynLspProbe")
    );
    process.stop().unwrap();
    assert_eq!(
        fs::read(&file).unwrap(),
        original,
        "acceptance must not save its test overlay"
    );
    eprintln!(
        "actual workspace TS diagnostics/hover/definition/completion passed in {} ms; disk unchanged",
        started.elapsed().as_millis()
    );
}
