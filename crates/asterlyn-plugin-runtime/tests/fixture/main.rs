use std::env;
#[cfg(unix)]
use std::fs;
use std::io::{self, BufReader, BufWriter};
#[cfg(unix)]
use std::path::PathBuf;
use std::process::ExitCode;
#[cfg(unix)]
use std::process::{Command, Stdio};

use asterlyn_plugin_runtime_protocol::{
    ActivationReady, ContributionKind, Hello, OperationResult, PluginHostMessage, ProtocolEnvelope,
    RuntimeContribution, ShutdownAck, read_frame, write_frame,
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
                callbacks: [("execute".to_owned(), "callback-1".to_owned())]
                    .into_iter()
                    .collect(),
            }],
        }),
    )?;
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
            PluginHostMessage::Invoke(request) => send(
                &mut writer,
                &mut sequence,
                PluginHostMessage::InvocationResult(OperationResult {
                    request_id: request.request_id,
                    payload: request.payload,
                }),
            )?,
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
