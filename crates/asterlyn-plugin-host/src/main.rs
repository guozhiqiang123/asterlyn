use std::env;
use std::io::{self, BufReader, BufWriter};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use asterlyn_plugin_host::{ExpectedRuntimeIdentity, PluginEngine};
use asterlyn_plugin_runtime_protocol::{
    ActivationReady, ExpectedPluginIdentity, Hello, OperationError, OperationResult,
    PluginHostMessage, ProtocolEnvelope, RemoteFailure, ShutdownAck, read_frame, write_frame,
};

struct HostConfig {
    plugin_root: PathBuf,
    plugin_id: String,
    plugin_version: String,
    package_digest: String,
    runtime_entry: String,
}

fn main() -> ExitCode {
    match HostConfig::parse().and_then(run) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("asterlyn-plugin-host: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(config: HostConfig) -> Result<(), String> {
    let (root, entry) = resolve_entry(&config.plugin_root, &config.runtime_entry)?;
    let hello = Hello {
        plugin_id: config.plugin_id,
        plugin_version: config.plugin_version,
        package_digest: config.package_digest,
        runtime_entry: config.runtime_entry,
    };
    hello
        .matches(&ExpectedPluginIdentity {
            plugin_id: &hello.plugin_id,
            plugin_version: &hello.plugin_version,
            package_digest: &hello.package_digest,
            runtime_entry: &hello.runtime_entry,
        })
        .map_err(|error| error.to_string())?;

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = BufWriter::new(stdout.lock());
    let mut outgoing_sequence = 1_u64;
    let mut incoming_sequence = 0_u64;

    send(
        &mut writer,
        &mut outgoing_sequence,
        PluginHostMessage::Hello(hello.clone()),
    )?;
    let ack = receive(&mut reader, &mut incoming_sequence)?;
    let PluginHostMessage::HelloAck(ack) = ack.message else {
        return Err("expected helloAck after hello".to_owned());
    };
    let activation = receive(&mut reader, &mut incoming_sequence)?;
    let PluginHostMessage::Activate(activation) = activation.message else {
        return Err("expected activate after helloAck".to_owned());
    };
    if activation.session_id != ack.session_id {
        return Err("activation session does not match helloAck".to_owned());
    }

    let expected = ExpectedRuntimeIdentity {
        plugin_id: &hello.plugin_id,
        plugin_version: &hello.plugin_version,
    };
    let (mut engine, ready) = match PluginEngine::activate(&entry, &expected, &activation) {
        Ok(activated) => activated,
        Err(error) => {
            send(
                &mut writer,
                &mut outgoing_sequence,
                PluginHostMessage::ActivationFailed(RemoteFailure {
                    code: "runtime.activation".to_owned(),
                    message: bounded_error(&error.to_string()),
                    retryable: false,
                }),
            )?;
            return Err(format!(
                "activation failed for {} in {}: {error}",
                hello.plugin_id,
                root.display()
            ));
        }
    };
    send_ready(&mut writer, &mut outgoing_sequence, ready)?;

    loop {
        let Some(envelope) = read_optional(&mut reader, &mut incoming_sequence)? else {
            return Err("host pipe closed without shutdown".to_owned());
        };
        match envelope.message {
            PluginHostMessage::Invoke(request) => match engine.invoke(&request) {
                Ok(payload) => send(
                    &mut writer,
                    &mut outgoing_sequence,
                    PluginHostMessage::InvocationResult(OperationResult {
                        request_id: request.request_id,
                        payload,
                    }),
                )?,
                Err(error) => send(
                    &mut writer,
                    &mut outgoing_sequence,
                    PluginHostMessage::InvocationError(OperationError {
                        request_id: request.request_id,
                        error: RemoteFailure {
                            code: "runtime.callback".to_owned(),
                            message: bounded_error(&error.to_string()),
                            retryable: false,
                        },
                    }),
                )?,
            },
            PluginHostMessage::Cancel(_) => {
                // EPR2 callbacks are completed on the engine turn. The EPR3 supervisor owns
                // cancellation of host capability requests once those can remain in flight.
            }
            PluginHostMessage::Shutdown(_) => {
                send(
                    &mut writer,
                    &mut outgoing_sequence,
                    PluginHostMessage::ShutdownAck(ShutdownAck {
                        session_id: ack.session_id,
                    }),
                )?;
                return Ok(());
            }
            _ => return Err("message is invalid while plugin runtime is active".to_owned()),
        }
    }
}

fn resolve_entry(root: &Path, runtime_entry: &str) -> Result<(PathBuf, PathBuf), String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("resolve plugin root {}: {error}", root.display()))?;
    if !root.is_dir() {
        return Err(format!(
            "plugin root is not a directory: {}",
            root.display()
        ));
    }
    let entry = root
        .join(runtime_entry)
        .canonicalize()
        .map_err(|error| format!("resolve runtime entry {runtime_entry}: {error}"))?;
    if !entry.starts_with(&root) {
        return Err("runtime entry escapes the admitted plugin root".to_owned());
    }
    if !entry.is_file() {
        return Err(format!(
            "runtime entry is not a regular file: {}",
            entry.display()
        ));
    }
    Ok((root, entry))
}

fn send(
    writer: &mut impl io::Write,
    sequence: &mut u64,
    message: PluginHostMessage,
) -> Result<(), String> {
    let envelope = ProtocolEnvelope::new(*sequence, message);
    write_frame(writer, &envelope).map_err(|error| error.to_string())?;
    *sequence = sequence
        .checked_add(1)
        .ok_or_else(|| "outgoing protocol sequence overflow".to_owned())?;
    Ok(())
}

fn send_ready(
    writer: &mut impl io::Write,
    sequence: &mut u64,
    ready: ActivationReady,
) -> Result<(), String> {
    send(writer, sequence, PluginHostMessage::ActivationReady(ready))
}

fn receive(
    reader: &mut impl io::Read,
    previous_sequence: &mut u64,
) -> Result<ProtocolEnvelope, String> {
    read_optional(reader, previous_sequence)?
        .ok_or_else(|| "host pipe closed before the required message".to_owned())
}

fn read_optional(
    reader: &mut impl io::Read,
    previous_sequence: &mut u64,
) -> Result<Option<ProtocolEnvelope>, String> {
    let envelope = read_frame(reader).map_err(|error| error.to_string())?;
    if let Some(envelope) = &envelope {
        if envelope.sequence <= *previous_sequence {
            return Err(format!(
                "incoming protocol sequence must increase: previous {}, received {}",
                *previous_sequence, envelope.sequence
            ));
        }
        *previous_sequence = envelope.sequence;
    }
    Ok(envelope)
}

fn bounded_error(message: &str) -> String {
    const LIMIT: usize = 4 * 1024;
    const ELLIPSIS: &str = "…";
    if message.len() <= LIMIT {
        return message.to_owned();
    }
    let mut end = LIMIT - ELLIPSIS.len();
    while !message.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{ELLIPSIS}", &message[..end])
}

impl HostConfig {
    fn parse() -> Result<Self, String> {
        let mut arguments = env::args_os();
        let executable = arguments
            .next()
            .unwrap_or_else(|| "asterlyn-plugin-host".into());
        let mut plugin_root = None;
        let mut plugin_id = None;
        let mut plugin_version = None;
        let mut package_digest = None;
        let mut runtime_entry = None;

        while let Some(argument) = arguments.next() {
            let name = argument
                .to_str()
                .ok_or_else(|| "argument name is not valid UTF-8".to_owned())?;
            let value = arguments
                .next()
                .ok_or_else(|| format!("missing value for {name}"))?;
            match name {
                "--plugin-root" => plugin_root = Some(PathBuf::from(value)),
                "--plugin-id" => plugin_id = Some(utf8_argument(name, value)?),
                "--plugin-version" => plugin_version = Some(utf8_argument(name, value)?),
                "--package-digest" => package_digest = Some(utf8_argument(name, value)?),
                "--runtime-entry" => runtime_entry = Some(utf8_argument(name, value)?),
                _ => return Err(format!("unknown argument: {name}")),
            }
        }

        Ok(Self {
            plugin_root: plugin_root.ok_or_else(|| {
                format!(
                    "{} requires --plugin-root",
                    PathBuf::from(executable).display()
                )
            })?,
            plugin_id: plugin_id.ok_or_else(|| "missing --plugin-id".to_owned())?,
            plugin_version: plugin_version.ok_or_else(|| "missing --plugin-version".to_owned())?,
            package_digest: package_digest.ok_or_else(|| "missing --package-digest".to_owned())?,
            runtime_entry: runtime_entry.ok_or_else(|| "missing --runtime-entry".to_owned())?,
        })
    }
}

fn utf8_argument(name: &str, value: std::ffi::OsString) -> Result<String, String> {
    value
        .into_string()
        .map_err(|_| format!("{name} value is not valid UTF-8"))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    #[test]
    fn bounded_error_preserves_utf8_and_protocol_limit() {
        let message = "失".repeat(2_000);
        let bounded = bounded_error(&message);
        assert!(bounded.len() <= 4 * 1024);
        assert!(bounded.ends_with('…'));
    }

    #[test]
    fn runtime_entry_cannot_escape_admitted_root() {
        let parent = TempDir::new().expect("parent");
        let root = parent.path().join("plugin");
        fs::create_dir(&root).expect("plugin root");
        fs::write(parent.path().join("outside.js"), "export {};").expect("outside file");

        let error = resolve_entry(&root, "../outside.js").expect_err("escape rejected");
        assert!(error.contains("escapes the admitted plugin root"));
    }
}
