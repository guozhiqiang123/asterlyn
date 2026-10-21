use std::env;
#[cfg(unix)]
use std::fs;
use std::io::{self, BufReader, BufWriter, Write};
#[cfg(unix)]
use std::path::PathBuf;
use std::process::ExitCode;
#[cfg(unix)]
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use asterlyn_plugin_runtime_protocol::{
    ActivationReady, ContributionKind, Event, Hello, OperationResult, PluginHostMessage,
    ProtocolEnvelope, RuntimeContribution, ShutdownAck, read_frame, write_frame,
};
use serde_json::json;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("fixture: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let args = env::args().collect::<Vec<_>>();
    let argument = |name: &str| {
        args.iter()
            .position(|value| value == name)
            .and_then(|index| args.get(index + 1))
            .cloned()
            .ok_or_else(|| format!("missing {name}"))
    };
    let hello = Hello {
        plugin_id: argument("--plugin-id")?,
        plugin_version: argument("--plugin-version")?,
        package_digest: argument("--package-digest")?,
        runtime_entry: argument("--runtime-entry")?,
    };
    #[cfg(unix)]
    let tree_mode = hello.plugin_id == "dev.asterlyn.fixture.tree";
    #[cfg(unix)]
    let plugin_root = argument("--plugin-root")?;
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = BufWriter::new(stdout.lock());
    let mut sequence = 1_u64;
    send(&mut writer, &mut sequence, PluginHostMessage::Hello(hello))?;
    let ack = receive(&mut reader)?;
    let PluginHostMessage::HelloAck(ack) = ack.message else {
        return Err("expected helloAck".to_owned());
    };
    let activate = receive(&mut reader)?;
    let PluginHostMessage::Activate(activate) = activate.message else {
        return Err("expected activate".to_owned());
    };
    if activate.session_id != ack.session_id {
        return Err("session mismatch".to_owned());
    }
    send(
        &mut writer,
        &mut sequence,
        PluginHostMessage::ActivationReady(ActivationReady {
            contributions: vec![RuntimeContribution {
                kind: ContributionKind::Command,
                id: "fixture.echo".to_owned(),
                payload: json!({"label": "Echo"}),
                callbacks: [
                    ("execute".to_owned(), "callback-1".to_owned()),
                    ("subscribe".to_owned(), "callback-2".to_owned()),
                ]
                .into_iter()
                .collect(),
            }],
        }),
    )?;
    if let Some(delay) = activate
        .evidence
        .get("idleCrashAfterMs")
        .and_then(serde_json::Value::as_u64)
    {
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(delay));
            eprintln!("fixture: intentional idle crash");
            std::process::exit(17);
        });
    }
    let crash_on_invoke = activate
        .evidence
        .get("crashOnInvoke")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let mismatch_on_invoke = activate
        .evidence
        .get("mismatchOnInvoke")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let mismatch_sequence_on_invoke = activate
        .evidence
        .get("mismatchSequenceOnInvoke")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let malformed_frame_on_invoke = activate
        .evidence
        .get("malformedFrameOnInvoke")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let stderr_flood_on_invoke = activate
        .evidence
        .get("stderrFloodOnInvokeBytes")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    #[cfg(unix)]
    let _descendant = if tree_mode {
        let child = Command::new("/bin/sleep")
            .arg("60")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("spawn descendant: {error}"))?;
        fs::write(
            PathBuf::from(plugin_root).join("descendant.pid"),
            child.id().to_string(),
        )
        .map_err(|error| format!("write descendant pid: {error}"))?;
        Some(child)
    } else {
        None
    };
    loop {
        let envelope = receive(&mut reader)?;
        match envelope.message {
            PluginHostMessage::Invoke(request) => {
                if stderr_flood_on_invoke > 0 {
                    let mut stderr = io::stderr().lock();
                    let chunk = [b'x'; 8 * 1024];
                    let mut remaining = stderr_flood_on_invoke;
                    while remaining > 0 {
                        let count = remaining.min(chunk.len() as u64) as usize;
                        stderr
                            .write_all(&chunk[..count])
                            .map_err(|error| format!("write stderr flood: {error}"))?;
                        remaining -= count as u64;
                    }
                    stderr
                        .flush()
                        .map_err(|error| format!("flush stderr flood: {error}"))?;
                }
                if crash_on_invoke {
                    eprintln!("fixture: intentional invoke crash");
                    std::process::exit(23);
                }
                if malformed_frame_on_invoke {
                    writer
                        .write_all(&(3_u32.to_be_bytes()))
                        .and_then(|_| writer.write_all(b"bad"))
                        .and_then(|_| writer.flush())
                        .map_err(|error| format!("write malformed frame: {error}"))?;
                    continue;
                }
                let payload = if request.operation == "subscribe" {
                    send(
                        &mut writer,
                        &mut sequence,
                        PluginHostMessage::Event(Event {
                            subscription_handle: "subscription-1".to_owned(),
                            payload: json!({"arguments": [{"revision": 1}]}),
                        }),
                    )?;
                    serde_json::Value::Null
                } else {
                    request.payload
                };
                if mismatch_sequence_on_invoke {
                    sequence += 1;
                }
                send(
                    &mut writer,
                    &mut sequence,
                    PluginHostMessage::InvocationResult(OperationResult {
                        request_id: if mismatch_on_invoke {
                            format!("{}-mismatched", request.request_id)
                        } else {
                            request.request_id
                        },
                        payload,
                    }),
                )?
            }
            PluginHostMessage::Shutdown(_) => {
                send(
                    &mut writer,
                    &mut sequence,
                    PluginHostMessage::ShutdownAck(ShutdownAck {
                        session_id: ack.session_id,
                    }),
                )?;
                return Ok(());
            }
            _ => return Err("unexpected message".to_owned()),
        }
    }
}

fn receive(reader: &mut impl io::Read) -> Result<ProtocolEnvelope, String> {
    read_frame(reader)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "pipe closed".to_owned())
}

fn send(
    writer: &mut impl io::Write,
    sequence: &mut u64,
    message: PluginHostMessage,
) -> Result<(), String> {
    write_frame(writer, &ProtocolEnvelope::new(*sequence, message))
        .map_err(|error| error.to_string())?;
    *sequence += 1;
    Ok(())
}
