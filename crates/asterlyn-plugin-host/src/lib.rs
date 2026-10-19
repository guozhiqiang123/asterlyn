use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs;
use std::path::Path;

use asterlyn_plugin_runtime_protocol::{
    Activate, ActivationReady, ContributionKind, Invoke, MAX_CONTRIBUTIONS, PluginHostMessage,
    ProtocolEnvelope, RuntimeContribution,
};
use boa_engine::builtins::promise::PromiseState;
use boa_engine::gc::{Gc, GcRefCell};
use boa_engine::object::builtins::JsPromise;
use boa_engine::object::{JsObject, ObjectInitializer};
use boa_engine::property::{Attribute, PropertyKey};
use boa_engine::{
    Context, JsError, JsNativeError, JsString, JsValue, Module, NativeFunction, Source, js_string,
};
use serde_json::{Map as JsonMap, Value as JsonValue, json};

const MAX_RUNTIME_SOURCE_BYTES: u64 = 32 * 1024 * 1024;
const LOOP_ITERATION_LIMIT: u64 = 5_000_000;
const RECURSION_LIMIT: usize = 256;
const STACK_SIZE_LIMIT: usize = 8 * 1024;
const BACKTRACE_LIMIT: usize = 20;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExpectedRuntimeIdentity<'a> {
    pub plugin_id: &'a str,
    pub plugin_version: &'a str,
}

#[derive(Debug)]
pub enum PluginEngineError {
    Source(String),
    JavaScript(String),
    Contract(String),
    Callback(String),
}

impl fmt::Display for PluginEngineError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Source(message) => write!(formatter, "plugin runtime source rejected: {message}"),
            Self::JavaScript(message) => {
                write!(formatter, "plugin JavaScript execution failed: {message}")
            }
            Self::Contract(message) => {
                write!(formatter, "plugin runtime contract rejected: {message}")
            }
            Self::Callback(message) => write!(formatter, "plugin callback failed: {message}"),
        }
    }
}

impl std::error::Error for PluginEngineError {}

struct RuntimeCallback {
    operation: String,
    function: JsObject,
    receiver: JsObject,
}

pub struct PluginEngine {
    context: Context,
    callbacks: BTreeMap<String, RuntimeCallback>,
}

impl PluginEngine {
    pub fn activate(
        entry: &Path,
        expected: &ExpectedRuntimeIdentity<'_>,
        activation: &Activate,
    ) -> Result<(Self, ActivationReady), PluginEngineError> {
        let source = read_bounded_source(entry)?;
        let mut context = Context::default();
        configure_limits(&mut context);

        let module = Module::parse(Source::from_bytes(&source), None, &mut context)
            .map_err(|error| js_error("parse module", error, &mut context))?;
        let evaluation = module.load_link_evaluate(&mut context);
        context
            .run_jobs()
            .map_err(|error| js_error("evaluate module jobs", error, &mut context))?;
        match evaluation.state() {
            PromiseState::Fulfilled(_) => {}
            PromiseState::Rejected(reason) => {
                return Err(PluginEngineError::JavaScript(format!(
                    "module evaluation rejected: {}",
                    js_value_message(&reason, &mut context)
                )));
            }
            PromiseState::Pending => {
                return Err(PluginEngineError::Contract(
                    "module evaluation did not settle".to_owned(),
                ));
            }
        }

        let plugin = find_plugin_export(&module, expected, &mut context)?;
        let captured = Gc::new(GcRefCell::new(Vec::<JsObject>::new()));
        let activation_context =
            build_activation_context(activation, captured.clone(), &mut context)?;
        call_activate(&plugin, activation_context, &mut context)?;
        context
            .run_jobs()
            .map_err(|error| js_error("drain activation jobs", error, &mut context))?;

        let contributions = captured.borrow().clone();
        let (contributions, callbacks) = project_contributions(&contributions, &mut context)?;
        let ready = ActivationReady { contributions };
        ProtocolEnvelope::new(1, PluginHostMessage::ActivationReady(ready.clone()))
            .validate()
            .map_err(|error| PluginEngineError::Contract(error.to_string()))?;

        Ok((Self { context, callbacks }, ready))
    }

    pub fn invoke(&mut self, request: &Invoke) -> Result<JsonValue, PluginEngineError> {
        ProtocolEnvelope::new(1, PluginHostMessage::Invoke(request.clone()))
            .validate()
            .map_err(|error| PluginEngineError::Callback(error.to_string()))?;
        let callback = self
            .callbacks
            .get(&request.callback_handle)
            .ok_or_else(|| {
                PluginEngineError::Callback(format!(
                    "unknown callback handle: {}",
                    request.callback_handle
                ))
            })?;
        if callback.operation != request.operation {
            return Err(PluginEngineError::Callback(format!(
                "callback operation mismatch: expected {}, received {}",
                callback.operation, request.operation
            )));
        }
        let args = invocation_arguments(&request.payload, &mut self.context)?;
        let value = callback
            .function
            .call(&callback.receiver.clone().into(), &args, &mut self.context)
            .map_err(|error| js_error("invoke callback", error, &mut self.context))?;
        let value = settle_value(value, &mut self.context)?;
        value
            .to_json(&mut self.context)
            .map_err(|error| js_error("serialize callback result", error, &mut self.context))
            .map(|value| value.unwrap_or(JsonValue::Null))
    }

    pub fn callback_count(&self) -> usize {
        self.callbacks.len()
    }
}

fn read_bounded_source(entry: &Path) -> Result<Vec<u8>, PluginEngineError> {
    let metadata = fs::metadata(entry).map_err(|error| {
        PluginEngineError::Source(format!("read {} metadata: {error}", entry.display()))
    })?;
    if !metadata.is_file() {
        return Err(PluginEngineError::Source(format!(
            "runtime entry is not a regular file: {}",
            entry.display()
        )));
    }
    if metadata.len() > MAX_RUNTIME_SOURCE_BYTES {
        return Err(PluginEngineError::Source(format!(
            "runtime entry exceeds {MAX_RUNTIME_SOURCE_BYTES} bytes"
        )));
    }
    fs::read(entry)
        .map_err(|error| PluginEngineError::Source(format!("read {}: {error}", entry.display())))
}

fn configure_limits(context: &mut Context) {
    let limits = context.runtime_limits_mut();
    limits.set_loop_iteration_limit(LOOP_ITERATION_LIMIT);
    limits.set_recursion_limit(RECURSION_LIMIT);
    limits.set_stack_size_limit(STACK_SIZE_LIMIT);
    limits.set_backtrace_limit(BACKTRACE_LIMIT);
}

fn find_plugin_export(
    module: &Module,
    expected: &ExpectedRuntimeIdentity<'_>,
    context: &mut Context,
) -> Result<JsObject, PluginEngineError> {
    let namespace = module.namespace(context);
    let keys = namespace
        .own_property_keys(context)
        .map_err(|error| js_error("enumerate module exports", error, context))?;
    let mut matches = Vec::new();
    for key in keys {
        if matches!(key, PropertyKey::Symbol(_)) {
            continue;
        }
        let value = namespace
            .get(key, context)
            .map_err(|error| js_error("read module export", error, context))?;
        let Some(candidate) = value.as_object() else {
            continue;
        };
        let id = read_required_string(&candidate, "id", context)?;
        if id.as_deref() != Some(expected.plugin_id) {
            continue;
        }
        let activate = candidate
            .get(js_string!("activate"), context)
            .map_err(|error| js_error("read plugin activate", error, context))?;
        if !activate.is_callable() {
            continue;
        }
        let version = read_required_string(&candidate, "version", context)?;
        if version.as_deref() != Some(expected.plugin_version) {
            return Err(PluginEngineError::Contract(format!(
                "plugin version mismatch: expected {}, received {}",
                expected.plugin_version,
                version.as_deref().unwrap_or("<missing>")
            )));
        }
        matches.push(candidate.clone());
    }
    match matches.len() {
        1 => Ok(matches.remove(0)),
        0 => Err(PluginEngineError::Contract(format!(
            "module must export exactly one plugin object with id {}",
            expected.plugin_id
        ))),
        _ => Err(PluginEngineError::Contract(format!(
            "module exports multiple plugin objects with id {}",
            expected.plugin_id
        ))),
    }
}

fn read_required_string(
    object: &JsObject,
    key: &str,
    context: &mut Context,
) -> Result<Option<String>, PluginEngineError> {
    let value = object
        .get(JsString::from(key), context)
        .map_err(|error| js_error("read plugin identity", error, context))?;
    Ok(value
        .as_string()
        .map(|string| string.to_std_string_escaped()))
}

fn build_activation_context(
    activation: &Activate,
    captured: Gc<GcRefCell<Vec<JsObject>>>,
    context: &mut Context,
) -> Result<JsObject, PluginEngineError> {
    let identity = JsValue::from_json(
        &json!({
            "id": activation.workspace_id,
            "root": activation.workspace_root,
            "generation": activation.workspace_generation,
        }),
        context,
    )
    .map_err(|error| js_error("create workspace identity", error, context))?;
    let evidence = JsValue::from_json(&activation.evidence, context)
        .map_err(|error| js_error("create workspace evidence", error, context))?;
    let contribute = NativeFunction::from_copy_closure_with_captures(
        |_, arguments, captured, context| {
            let Some(contribution) = arguments.first().and_then(JsValue::as_object) else {
                return Err(JsNativeError::typ()
                    .with_message("context.contribute requires an object")
                    .into());
            };
            if captured.borrow().len() >= MAX_CONTRIBUTIONS {
                return Err(JsNativeError::range()
                    .with_message("plugin contribution limit exceeded")
                    .into());
            }
            captured.borrow_mut().push(contribution.clone());
            let disposable = ObjectInitializer::new(context)
                .function(
                    NativeFunction::from_fn_ptr(|_, _, _| Ok(JsValue::undefined())),
                    js_string!("dispose"),
                    0,
                )
                .build();
            Ok(disposable.into())
        },
        captured,
    );

    let activation_context = ObjectInitializer::new(context)
        .property(js_string!("identity"), identity, Attribute::READONLY)
        .property(js_string!("evidence"), evidence, Attribute::READONLY)
        .property(
            js_string!("locale"),
            JsString::from(activation.locale.as_str()),
            Attribute::READONLY,
        )
        .function(contribute, js_string!("contribute"), 1)
        .build();
    Ok(activation_context)
}

fn call_activate(
    plugin: &JsObject,
    activation_context: JsObject,
    context: &mut Context,
) -> Result<(), PluginEngineError> {
    let activate = plugin
        .get(js_string!("activate"), context)
        .map_err(|error| js_error("read plugin activate", error, context))?;
    let Some(activate) = activate.as_callable() else {
        return Err(PluginEngineError::Contract(
            "plugin activate export must be callable".to_owned(),
        ));
    };
    let value = activate
        .call(
            &plugin.clone().into(),
            &[activation_context.into()],
            context,
        )
        .map_err(|error| js_error("activate plugin", error, context))?;
    settle_value(value, context).map(|_| ())
}

fn project_contributions(
    contributions: &[JsObject],
    context: &mut Context,
) -> Result<(Vec<RuntimeContribution>, BTreeMap<String, RuntimeCallback>), PluginEngineError> {
    let mut projected = Vec::with_capacity(contributions.len());
    let mut callbacks = BTreeMap::new();
    let mut callback_index = 0_u64;
    let mut contribution_ids = BTreeSet::new();

    for contribution in contributions {
        let kind = contribution
            .get(js_string!("kind"), context)
            .map_err(|error| js_error("read contribution kind", error, context))?
            .as_string()
            .map(|value| value.to_std_string_escaped())
            .ok_or_else(|| {
                PluginEngineError::Contract("contribution kind must be a string".to_owned())
            })?;
        let kind = match kind.as_str() {
            "command" => ContributionKind::Command,
            "provider" => ContributionKind::TaskProvider,
            "execution-target-provider" => ContributionKind::ExecutionTargetProvider,
            "run-configuration-provider" => ContributionKind::RunConfigurationProvider,
            _ => {
                return Err(PluginEngineError::Contract(format!(
                    "unsupported contribution kind: {kind}"
                )));
            }
        };
        let id = contribution
            .get(js_string!("id"), context)
            .map_err(|error| js_error("read contribution id", error, context))?
            .as_string()
            .map(|value| value.to_std_string_escaped())
            .ok_or_else(|| {
                PluginEngineError::Contract("contribution id must be a string".to_owned())
            })?;
        if !contribution_ids.insert(id.clone()) {
            return Err(PluginEngineError::Contract(format!(
                "duplicate contribution id: {id}"
            )));
        }

        let mut payload = JsonMap::new();
        let mut contribution_callbacks = BTreeMap::new();
        for key in contribution
            .own_property_keys(context)
            .map_err(|error| js_error("enumerate contribution", error, context))?
        {
            let operation = match &key {
                PropertyKey::String(value) => value.to_std_string_escaped(),
                PropertyKey::Index(value) => value.get().to_string(),
                PropertyKey::Symbol(_) => continue,
            };
            let value = contribution
                .get(key, context)
                .map_err(|error| js_error("read contribution property", error, context))?;
            if let Some(function) = value.as_callable() {
                callback_index += 1;
                let handle = format!("callback-{callback_index}");
                callbacks.insert(
                    handle.clone(),
                    RuntimeCallback {
                        operation: operation.clone(),
                        function,
                        receiver: contribution.clone(),
                    },
                );
                contribution_callbacks.insert(operation, handle);
            } else if let Some(value) = value
                .to_json(context)
                .map_err(|error| js_error("serialize contribution property", error, context))?
            {
                payload.insert(operation, value);
            }
        }
        projected.push(RuntimeContribution {
            kind,
            id,
            payload: JsonValue::Object(payload),
            callbacks: contribution_callbacks,
        });
    }
    Ok((projected, callbacks))
}

fn invocation_arguments(
    payload: &JsonValue,
    context: &mut Context,
) -> Result<Vec<JsValue>, PluginEngineError> {
    let arguments = payload
        .as_object()
        .and_then(|object| object.get("arguments"))
        .and_then(JsonValue::as_array)
        .ok_or_else(|| {
            PluginEngineError::Callback("invoke payload must contain an arguments array".to_owned())
        })?;
    arguments
        .iter()
        .map(|argument| {
            JsValue::from_json(argument, context)
                .map_err(|error| js_error("convert callback argument", error, context))
        })
        .collect()
}

fn settle_value(value: JsValue, context: &mut Context) -> Result<JsValue, PluginEngineError> {
    let Some(object) = value.as_object() else {
        return Ok(value);
    };
    let Ok(promise) = JsPromise::from_object(object) else {
        return Ok(value);
    };
    context
        .run_jobs()
        .map_err(|error| js_error("drain promise jobs", error, context))?;
    match promise.state() {
        PromiseState::Fulfilled(value) => Ok(value),
        PromiseState::Rejected(reason) => Err(PluginEngineError::JavaScript(format!(
            "promise rejected: {}",
            js_value_message(&reason, context)
        ))),
        PromiseState::Pending => Err(PluginEngineError::Contract(
            "plugin promise remained pending without a host request".to_owned(),
        )),
    }
}

fn js_error(operation: &str, error: JsError, _context: &mut Context) -> PluginEngineError {
    PluginEngineError::JavaScript(format!("{operation}: {error}"))
}

fn js_value_message(value: &JsValue, context: &mut Context) -> String {
    value
        .to_string(context)
        .map(|value| value.to_std_string_escaped())
        .unwrap_or_else(|_| "<unprintable JavaScript error>".to_owned())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use asterlyn_plugin_runtime_protocol::HostTheme;
    use tempfile::TempDir;

    use super::*;

    fn activation() -> Activate {
        Activate {
            session_id: "session-1".to_owned(),
            workspace_id: "workspace-1".to_owned(),
            workspace_generation: 1,
            workspace_root: "/workspace".to_owned(),
            evidence: json!({
                "kind": "workspace-catalog",
                "platform": "posix",
                "truncated": false,
                "files": [{"workspacePath": "gradlew"}],
            }),
            locale: "en-US".to_owned(),
            theme: HostTheme::Dark,
        }
    }

    fn write_fixture(source: &str) -> (TempDir, std::path::PathBuf) {
        let directory = TempDir::new().expect("temp directory");
        let entry = directory.path().join("plugin.js");
        fs::write(&entry, source).expect("write fixture");
        (directory, entry)
    }

    #[test]
    fn activates_self_contained_module_without_ambient_desktop_authority() {
        let (_directory, entry) = write_fixture(
            r#"
            export const FIXTURE = Object.freeze({
              id: "dev.asterlyn.fixture",
              version: "1.0.0",
              activate(context) {
                for (const name of ["fetch", "WebSocket", "document", "window", "process", "require", "__TAURI__"]) {
                  if (typeof globalThis[name] !== "undefined") throw new Error(`ambient authority exposed: ${name}`);
                }
                context.contribute({
                  kind: "command",
                  id: "fixture.echo",
                  label: "Fixture",
                  execute(value) { return { echoed: value }; },
                });
              },
            });
            "#,
        );
        let (mut engine, ready) = PluginEngine::activate(
            &entry,
            &ExpectedRuntimeIdentity {
                plugin_id: "dev.asterlyn.fixture",
                plugin_version: "1.0.0",
            },
            &activation(),
        )
        .expect("activate fixture");

        assert_eq!(ready.contributions.len(), 1);
        assert_eq!(ready.contributions[0].id, "fixture.echo");
        assert_eq!(ready.contributions[0].payload["label"], "Fixture");
        assert_eq!(engine.callback_count(), 1);
        let handle = ready.contributions[0].callbacks["execute"].clone();
        let result = engine
            .invoke(&Invoke {
                request_id: "request-1".to_owned(),
                callback_handle: handle,
                operation: "execute".to_owned(),
                payload: json!({"arguments": ["hello"]}),
            })
            .expect("invoke fixture");
        assert_eq!(result, json!({"echoed": "hello"}));
    }

    #[test]
    fn rejects_identity_mismatch_and_ambiguous_exports() {
        let (_directory, entry) = write_fixture(
            r#"
            const plugin = { id: "dev.asterlyn.fixture", version: "2.0.0", activate() {} };
            export const ONE = plugin;
            export const TWO = plugin;
            "#,
        );
        let error = PluginEngine::activate(
            &entry,
            &ExpectedRuntimeIdentity {
                plugin_id: "dev.asterlyn.fixture",
                plugin_version: "2.0.0",
            },
            &activation(),
        )
        .err()
        .expect("ambiguous export rejected");
        assert!(error.to_string().contains("multiple plugin objects"));

        let error = PluginEngine::activate(
            &entry,
            &ExpectedRuntimeIdentity {
                plugin_id: "dev.asterlyn.fixture",
                plugin_version: "1.0.0",
            },
            &activation(),
        )
        .err()
        .expect("version mismatch rejected");
        assert!(error.to_string().contains("version mismatch"));
    }

    #[test]
    fn interrupts_infinite_javascript_loops() {
        let (_directory, entry) = write_fixture(
            r#"
            export const FIXTURE = {
              id: "dev.asterlyn.fixture",
              version: "1.0.0",
              activate() { while (true) {} },
            };
            "#,
        );
        let error = PluginEngine::activate(
            &entry,
            &ExpectedRuntimeIdentity {
                plugin_id: "dev.asterlyn.fixture",
                plugin_version: "1.0.0",
            },
            &activation(),
        )
        .err()
        .expect("loop rejected");
        assert!(error.to_string().contains("JavaScript execution failed"));
    }

    #[test]
    fn rejects_duplicate_contributions_transactionally() {
        let (_directory, entry) = write_fixture(
            r#"
            export const FIXTURE = {
              id: "dev.asterlyn.fixture",
              version: "1.0.0",
              activate(context) {
                context.contribute({ kind: "command", id: "fixture.same", execute() {} });
                context.contribute({ kind: "command", id: "fixture.same", execute() {} });
              },
            };
            "#,
        );
        let error = PluginEngine::activate(
            &entry,
            &ExpectedRuntimeIdentity {
                plugin_id: "dev.asterlyn.fixture",
                plugin_version: "1.0.0",
            },
            &activation(),
        )
        .err()
        .expect("duplicates rejected");
        assert!(error.to_string().contains("duplicate contribution id"));
    }
}
