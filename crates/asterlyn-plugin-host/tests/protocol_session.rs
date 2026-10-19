use std::fs;
use std::process::{Command, Stdio};

use asterlyn_plugin_runtime_protocol::{
    Activate, HelloAck, HostTheme, Invoke, OperationResult, PluginHostMessage, ProtocolEnvelope,
    Shutdown, ShutdownReason, read_frame, write_frame,
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
        let restored = null;
        export const FIXTURE = {
          id: "dev.asterlyn.fixture",
          version: "1.0.0",
          async activate(context) {
            restored = await context.workspaceState.read("selected");
            context.contribute({
              kind: "command",
              id: "fixture.echo",
              async execute(value) {
                const query = await context.processQueries.execute("fixture.query");
                return {
                  value,
                  restored,
                  query,
                  isolated: typeof process === "undefined",
                  prefix: "applied",
                  apply(next) { return `${this.prefix}:${next}`; },
                };
              },
              subscribe(listener) {
                listener({ revision: 1 });
                return { dispose() { return "disposed"; } };
              },
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
                capabilities: vec!["processQueries".to_owned(), "workspaceState".to_owned()],
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

    let activation_request = read_frame(&mut output)
        .expect("read activation")
        .expect("activation frame");
    let PluginHostMessage::CapabilityRequest(activation_request) = activation_request.message
    else {
        panic!("expected activation capability request")
    };
    assert_eq!(activation_request.capability, "workspaceState");
    assert_eq!(activation_request.operation, "read");
    assert_eq!(
        activation_request.payload,
        json!({"arguments": ["selected"]})
    );
    write_frame(
        &mut input,
        &ProtocolEnvelope::new(
            3,
            PluginHostMessage::CapabilityResult(OperationResult {
                request_id: activation_request.request_id,
                payload: json!("restored-id"),
            }),
        ),
    )
    .expect("write activation capability result");

    let ready = read_frame(&mut output)
        .expect("read activation ready")
        .expect("activation ready frame");
    let PluginHostMessage::ActivationReady(ready) = ready.message else {
        panic!("expected activationReady")
    };
    assert_eq!(ready.contributions.len(), 1);
    let callback = ready.contributions[0].callbacks["execute"].clone();

    write_frame(
        &mut input,
        &ProtocolEnvelope::new(
            4,
            PluginHostMessage::Invoke(Invoke {
                request_id: "request-1".to_owned(),
                callback_handle: callback,
                operation: "execute".to_owned(),
                payload: json!({"arguments": ["hello"]}),
            }),
        ),
    )
    .expect("write invocation");
    let callback_request = read_frame(&mut output)
        .expect("read result")
        .expect("result frame");
    let PluginHostMessage::CapabilityRequest(callback_request) = callback_request.message else {
        panic!("expected callback capability request")
    };
    assert_eq!(callback_request.capability, "processQueries");
    assert_eq!(callback_request.operation, "execute");
    write_frame(
        &mut input,
        &ProtocolEnvelope::new(
            5,
            PluginHostMessage::CapabilityResult(OperationResult {
                request_id: callback_request.request_id,
                payload: json!({"status": "succeeded"}),
            }),
        ),
    )
    .expect("write callback capability result");

    let result = read_frame(&mut output)
        .expect("read invocation result")
        .expect("invocation result frame");
    let PluginHostMessage::InvocationResult(result) = result.message else {
        panic!("expected invocationResult")
    };
    assert_eq!(result.payload["value"], "hello");
    assert_eq!(result.payload["restored"], "restored-id");
    assert_eq!(result.payload["query"], json!({"status": "succeeded"}));
    assert_eq!(result.payload["isolated"], true);
    let apply = &result.payload["apply"]["$asterlynCallback"];
    assert_eq!(apply["operation"], "apply");

    write_frame(
        &mut input,
        &ProtocolEnvelope::new(
            6,
            PluginHostMessage::Invoke(Invoke {
                request_id: "request-2".to_owned(),
                callback_handle: apply["handle"].as_str().expect("apply handle").to_owned(),
                operation: "apply".to_owned(),
                payload: json!({"arguments": ["value"]}),
            }),
        ),
    )
    .expect("write projected callback invocation");
    let applied = read_frame(&mut output)
        .expect("read projected callback result")
        .expect("projected callback result frame");
    let PluginHostMessage::InvocationResult(applied) = applied.message else {
        panic!("expected projected callback invocation result")
    };
    assert_eq!(applied.payload, json!("applied:value"));

    write_frame(
        &mut input,
        &ProtocolEnvelope::new(
            7,
            PluginHostMessage::Invoke(Invoke {
                request_id: "request-3".to_owned(),
                callback_handle: ready.contributions[0].callbacks["subscribe"].clone(),
                operation: "subscribe".to_owned(),
                payload: json!({
                    "arguments": [asterlyn_plugin_runtime_protocol::remote_listener_value(
                        "subscription-1".to_owned()
                    )]
                }),
            }),
        ),
    )
    .expect("write subscription invocation");
    let event = read_frame(&mut output)
        .expect("read subscription event")
        .expect("subscription event frame");
    let PluginHostMessage::Event(event) = event.message else {
        panic!("expected subscription event")
    };
    assert_eq!(event.subscription_handle, "subscription-1");
    assert_eq!(event.payload, json!({"arguments": [{"revision": 1}]}));
    let subscription = read_frame(&mut output)
        .expect("read subscription result")
        .expect("subscription result frame");
    let PluginHostMessage::InvocationResult(subscription) = subscription.message else {
        panic!("expected subscription result")
    };
    assert_eq!(
        subscription.payload["dispose"]["$asterlynCallback"]["operation"],
        "dispose"
    );

    write_frame(
        &mut input,
        &ProtocolEnvelope::new(
            8,
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
