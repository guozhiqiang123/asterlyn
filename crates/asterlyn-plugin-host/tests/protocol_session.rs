use std::fs;
use std::process::{Command, Stdio};

use asterlyn_plugin_runtime_protocol::{
    Activate, HelloAck, HostTheme, Invoke, PluginHostMessage, ProtocolEnvelope, Shutdown,
    ShutdownReason, read_frame, write_frame,
};
use serde_json::json;
use tempfile::TempDir;

#[test]
fn helper_completes_handshake_activation_callback_and_shutdown() {
    let plugin_root = TempDir::new().expect("plugin root");
    let runtime_directory = plugin_root.path().join("runtime");
    fs::create_dir(&runtime_directory).expect("runtime directory");
    fs::write(
        runtime_directory.join("plugin.js"),
        r#"
        export const FIXTURE = {
          id: "dev.asterlyn.fixture",
          version: "1.0.0",
          activate(context) {
            context.contribute({
              kind: "command",
              id: "fixture.echo",
              execute(value) { return { value, isolated: typeof process === "undefined" }; },
            });
          },
        };
        "#,
    )
    .expect("runtime fixture");

    let mut child = Command::new(env!("CARGO_BIN_EXE_asterlyn-plugin-host"))
        .args([
            "--plugin-root",
            plugin_root.path().to_str().expect("root utf-8"),
            "--plugin-id",
            "dev.asterlyn.fixture",
            "--plugin-version",
            "1.0.0",
            "--package-digest",
            &format!("sha256:{}", "a".repeat(64)),
            "--runtime-entry",
            "runtime/plugin.js",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn plugin host");
    let mut input = child.stdin.take().expect("child stdin");
    let mut output = child.stdout.take().expect("child stdout");

    let hello = read_frame(&mut output)
        .expect("read hello")
        .expect("hello frame");
    assert!(matches!(hello.message, PluginHostMessage::Hello(_)));

    write_frame(
        &mut input,
        &ProtocolEnvelope::new(
            1,
            PluginHostMessage::HelloAck(HelloAck {
                session_id: "session-1".to_owned(),
                capabilities: vec!["commands".to_owned()],
                permissions: vec![],
            }),
        ),
    )
    .expect("write hello ack");
    write_frame(
        &mut input,
        &ProtocolEnvelope::new(
            2,
            PluginHostMessage::Activate(Activate {
                session_id: "session-1".to_owned(),
                workspace_id: "workspace-1".to_owned(),
                workspace_generation: 1,
                workspace_root: "/workspace".to_owned(),
                evidence: json!({}),
                locale: "en-US".to_owned(),
                theme: HostTheme::Dark,
            }),
        ),
    )
    .expect("write activation");

    let ready = read_frame(&mut output)
        .expect("read activation")
        .expect("activation frame");
    let PluginHostMessage::ActivationReady(ready) = ready.message else {
        panic!("expected activationReady")
    };
    assert_eq!(ready.contributions.len(), 1);
    let callback = ready.contributions[0].callbacks["execute"].clone();

    write_frame(
        &mut input,
        &ProtocolEnvelope::new(
            3,
            PluginHostMessage::Invoke(Invoke {
                request_id: "request-1".to_owned(),
                callback_handle: callback,
                operation: "execute".to_owned(),
                payload: json!({"arguments": ["hello"]}),
            }),
        ),
    )
    .expect("write invocation");
    let result = read_frame(&mut output)
        .expect("read result")
        .expect("result frame");
    let PluginHostMessage::InvocationResult(result) = result.message else {
        panic!("expected invocationResult")
    };
    assert_eq!(result.payload, json!({"value": "hello", "isolated": true}));

    write_frame(
        &mut input,
        &ProtocolEnvelope::new(
            4,
            PluginHostMessage::Shutdown(Shutdown {
                reason: ShutdownReason::ApplicationExit,
            }),
        ),
    )
    .expect("write shutdown");
    let shutdown = read_frame(&mut output)
        .expect("read shutdown ack")
        .expect("shutdown frame");
    assert!(matches!(
        shutdown.message,
        PluginHostMessage::ShutdownAck(_)
    ));

    drop(input);
    let result = child.wait_with_output().expect("wait for plugin host");
    assert!(
        result.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(result.stderr.is_empty());
}
