//! Local rendered-test adapter for the production Rust transport; never bundled in the app.
use asterlyn_language_service::{
    JsonRpcMessage, LanguageServiceProcess, RustServerProfile, ServerEvent,
};
use serde_json::{Value, json};
use std::{
    io::{self, BufRead, Write},
    path::PathBuf,
    time::{Duration, Instant},
};

fn main() {
    let root = PathBuf::from(std::env::var("ASTERLYN_RUST_WORKSPACE").expect("workspace"))
        .canonicalize()
        .unwrap();
    let sysroot = PathBuf::from(std::env::var("ASTERLYN_RUST_SYSROOT").expect("sysroot"))
        .canonicalize()
        .unwrap();
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
    println!("{}", json!({"serverPid":process.pid()}));
    io::stdout().flush().unwrap();
    process
        .initialize(&format!("file://{}/", root.display()))
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        assert!(Instant::now() < deadline, "project readiness deadline");
        match process.next_event(Duration::from_secs(30)).unwrap() {
            ServerEvent::Message(JsonRpcMessage::Notification(e))
                if e.method == "experimental/serverStatus"
                    && e.params
                        .as_ref()
                        .is_some_and(|p| p["quiescent"] == true && p["health"] == "ok") =>
            {
                break;
            }
            ServerEvent::Message(JsonRpcMessage::Request(r)) => process.reject_request(&r).unwrap(),
            ServerEvent::Message(_) => {}
            other => panic!("server ended: {other:?}"),
        }
    }
    println!("{}", json!({"ready":true}));
    io::stdout().flush().unwrap();
    for line in io::stdin().lock().lines() {
        let line = line.unwrap();
        assert!(line.len() < 3 * 1024 * 1024);
        let message: Value = serde_json::from_str(&line).unwrap();
        let method = message["method"].as_str().unwrap();
        assert!(
            [
                "textDocument/didOpen",
                "textDocument/didChange",
                "textDocument/didClose",
                "textDocument/definition",
                "textDocument/references",
                "textDocument/hover",
                "textDocument/completion"
            ]
            .contains(&method)
        );
        let params = message["params"].clone();
        let uri = params["textDocument"]["uri"].as_str().unwrap();
        assert!(uri.starts_with(&format!("file://{}/", root.display())));
        while let Ok(Some(event)) = process.poll_event() {
            if let ServerEvent::Message(JsonRpcMessage::Request(r)) = event {
                process.reject_request(&r).unwrap();
            }
        }
        let result = if method.starts_with("textDocument/did") {
            process.notify(method, Some(params)).unwrap();
            Value::Null
        } else {
            let response = process
                .request_wait(method, Some(params), Duration::from_secs(30))
                .unwrap();
            assert!(response.error.is_none(), "request failed");
            response.result.unwrap_or(Value::Null)
        };
        println!("{}", json!({"id":message["id"],"result":result}));
        io::stdout().flush().unwrap();
    }
    process.stop().unwrap();
}
