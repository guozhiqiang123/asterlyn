use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs;
use std::path::Path;

use asterlyn_plugin_runtime_protocol::{
    Activate, ActivationReady, ContributionKind, Invoke, MAX_CALLBACKS_PER_RESULT,
    MAX_CONTRIBUTIONS, MAX_RUNTIME_VALUE_DEPTH, PluginHostMessage, ProtocolEnvelope,
    RuntimeContribution, remote_callback_value,
};
use boa_engine::builtins::promise::{PromiseState, ResolvingFunctions};
use boa_engine::gc::{Finalize, Gc, GcRefCell, Trace};
use boa_engine::object::builtins::{JsArray, JsPromise};
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
const MAX_CAPABILITY_REQUESTS_PER_TURN: usize = 64;

const CAPABILITY_METHODS: &[(&str, &[&str])] = &[
    (
        "taskCache",
        &["computeFingerprint", "read", "write", "markDirty"],
    ),
    ("notifications", &["publish"]),
    ("processQueries", &["execute"]),
    ("workspaceState", &["read", "write"]),
];

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
    Capability(String),
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
            Self::Capability(message) => write!(formatter, "plugin capability failed: {message}"),
        }
    }
}

impl std::error::Error for PluginEngineError {}

struct RuntimeCallback {
    operation: String,
    function: JsObject,
    receiver: JsObject,
}

type ContributionProjection = (
    Vec<RuntimeContribution>,
    BTreeMap<String, RuntimeCallback>,
    u64,
);

#[derive(Debug, Clone, PartialEq)]
pub struct CapabilityCall {
    pub capability: String,
    pub operation: String,
    pub payload: JsonValue,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CapabilityOutcome {
    Success(JsonValue),
    Failure(String),
}

#[derive(Debug, Trace, Finalize)]
struct PendingCapability {
    #[unsafe_ignore_trace]
    call: CapabilityCall,
    resolvers: ResolvingFunctions,
}

#[derive(Debug, Trace, Finalize)]
struct CapabilityBinding {
    queue: Gc<GcRefCell<Vec<PendingCapability>>>,
    #[unsafe_ignore_trace]
    capability: String,
    #[unsafe_ignore_trace]
    operation: String,
}

pub struct PluginEngine {
    context: Context,
    callbacks: BTreeMap<String, RuntimeCallback>,
    next_callback_index: u64,
    capability_queue: Gc<GcRefCell<Vec<PendingCapability>>>,
}

impl PluginEngine {
    pub fn activate(
        entry: &Path,
        expected: &ExpectedRuntimeIdentity<'_>,
        activation: &Activate,
    ) -> Result<(Self, ActivationReady), PluginEngineError> {
        Self::activate_with_capabilities(entry, expected, activation, &[], &mut |call| {
            Err(format!(
                "capability exchange is unavailable for {}.{}",
                call.capability, call.operation
            ))
        })
    }

    pub fn activate_with_capabilities(
        entry: &Path,
        expected: &ExpectedRuntimeIdentity<'_>,
        activation: &Activate,
        admitted_capabilities: &[String],
        exchange: &mut impl FnMut(&CapabilityCall) -> Result<CapabilityOutcome, String>,
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
        let capability_queue = Gc::new(GcRefCell::new(Vec::<PendingCapability>::new()));
        let activation_context = build_activation_context(
            activation,
            admitted_capabilities,
            captured.clone(),
            capability_queue.clone(),
            &mut context,
        )?;
        call_activate(
            &plugin,
            activation_context,
            &capability_queue,
            exchange,
            &mut context,
        )?;
        drain_capabilities(&capability_queue, exchange, &mut context)?;

        let contributions = captured.borrow().clone();
        let (contributions, callbacks, next_callback_index) =
            project_contributions(&contributions, &mut context)?;
        let ready = ActivationReady { contributions };
        ProtocolEnvelope::new(1, PluginHostMessage::ActivationReady(ready.clone()))
            .validate()
            .map_err(|error| PluginEngineError::Contract(error.to_string()))?;

        Ok((
            Self {
                context,
                callbacks,
                next_callback_index,
                capability_queue,
            },
            ready,
        ))
    }

    pub fn invoke(&mut self, request: &Invoke) -> Result<JsonValue, PluginEngineError> {
        self.invoke_with_capabilities(request, &mut |call| {
            Err(format!(
                "capability exchange is unavailable for {}.{}",
                call.capability, call.operation
            ))
        })
    }

    pub fn invoke_with_capabilities(
        &mut self,
        request: &Invoke,
        exchange: &mut impl FnMut(&CapabilityCall) -> Result<CapabilityOutcome, String>,
    ) -> Result<JsonValue, PluginEngineError> {
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
        let function = callback.function.clone();
        let receiver = callback.receiver.clone();
        let args = invocation_arguments(&request.payload, &mut self.context)?;
        let value = function
            .call(&receiver.clone().into(), &args, &mut self.context)
            .map_err(|error| js_error("invoke callback", error, &mut self.context))?;
        let value = settle_value(value, &self.capability_queue, exchange, &mut self.context)?;
        let mut projected_callbacks = BTreeMap::new();
        let mut seen = Vec::new();
        let mut projected_callback_count = 0;
        let projected = project_runtime_value(
            &value,
            &receiver,
            &request.operation,
            &mut projected_callbacks,
            &mut self.next_callback_index,
            &mut projected_callback_count,
            &mut seen,
            0,
            &mut self.context,
        )?;
        self.callbacks.extend(projected_callbacks);
        Ok(projected)
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
    admitted_capabilities: &[String],
    captured: Gc<GcRefCell<Vec<JsObject>>>,
    capability_queue: Gc<GcRefCell<Vec<PendingCapability>>>,
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

    let capability_proxies = CAPABILITY_METHODS
        .iter()
        .filter(|(capability, _)| {
            admitted_capabilities
                .iter()
                .any(|admitted| admitted == capability)
        })
        .map(|(capability, operations)| {
            (
                *capability,
                build_capability_proxy(capability, operations, capability_queue.clone(), context),
            )
        })
        .collect::<Vec<_>>();
    let mut activation_context = ObjectInitializer::new(context);
    activation_context
        .property(js_string!("identity"), identity, Attribute::READONLY)
        .property(js_string!("evidence"), evidence, Attribute::READONLY)
        .property(
            js_string!("locale"),
            JsString::from(activation.locale.as_str()),
            Attribute::READONLY,
        )
        .function(contribute, js_string!("contribute"), 1);
    for (capability, proxy) in capability_proxies {
        activation_context.property(JsString::from(capability), proxy, Attribute::READONLY);
    }
    Ok(activation_context.build())
}

fn build_capability_proxy(
    capability: &str,
    operations: &[&str],
    queue: Gc<GcRefCell<Vec<PendingCapability>>>,
    context: &mut Context,
) -> JsObject {
    let mut proxy = ObjectInitializer::new(context);
    for operation in operations {
        let binding = CapabilityBinding {
            queue: queue.clone(),
            capability: capability.to_owned(),
            operation: (*operation).to_owned(),
        };
        proxy.function(
            NativeFunction::from_copy_closure_with_captures(
                |_, arguments, binding, context| {
                    if binding.queue.borrow().len() >= MAX_CAPABILITY_REQUESTS_PER_TURN {
                        return Err(JsNativeError::range()
                            .with_message("plugin capability request limit exceeded")
                            .into());
                    }
                    let arguments = arguments
                        .iter()
                        .map(|argument| {
                            argument
                                .to_json(context)
                                .map(|value| value.unwrap_or(JsonValue::Null))
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    let (promise, resolvers) = JsPromise::new_pending(context);
                    binding.queue.borrow_mut().push(PendingCapability {
                        call: CapabilityCall {
                            capability: binding.capability.clone(),
                            operation: binding.operation.clone(),
                            payload: json!({ "arguments": arguments }),
                        },
                        resolvers,
                    });
                    Ok(promise.into())
                },
                binding,
            ),
            JsString::from(*operation),
            0,
        );
    }
    proxy.build()
}

fn call_activate(
    plugin: &JsObject,
    activation_context: JsObject,
    capability_queue: &Gc<GcRefCell<Vec<PendingCapability>>>,
    exchange: &mut impl FnMut(&CapabilityCall) -> Result<CapabilityOutcome, String>,
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
    settle_value(value, capability_queue, exchange, context).map(|_| ())
}

fn project_contributions(
    contributions: &[JsObject],
    context: &mut Context,
) -> Result<ContributionProjection, PluginEngineError> {
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
    Ok((projected, callbacks, callback_index))
}

#[allow(clippy::too_many_arguments)]
fn project_runtime_value(
    value: &JsValue,
    receiver: &JsObject,
    operation: &str,
    callbacks: &mut BTreeMap<String, RuntimeCallback>,
    next_callback_index: &mut u64,
    callback_count: &mut usize,
    seen: &mut Vec<JsObject>,
    depth: usize,
    context: &mut Context,
) -> Result<JsonValue, PluginEngineError> {
    if depth > MAX_RUNTIME_VALUE_DEPTH {
        return Err(PluginEngineError::Callback(
            "callback result nesting is too deep".to_owned(),
        ));
    }
    if let Some(function) = value.as_callable() {
        if *callback_count >= MAX_CALLBACKS_PER_RESULT {
            return Err(PluginEngineError::Callback(
                "callback result contains too many functions".to_owned(),
            ));
        }
        *next_callback_index = next_callback_index
            .checked_add(1)
            .ok_or_else(|| PluginEngineError::Callback("callback handle overflow".to_owned()))?;
        *callback_count += 1;
        let handle = format!("callback-{next_callback_index}");
        callbacks.insert(
            handle.clone(),
            RuntimeCallback {
                operation: operation.to_owned(),
                function,
                receiver: receiver.clone(),
            },
        );
        return Ok(remote_callback_value(handle, operation.to_owned()));
    }
    let Some(object) = value.as_object() else {
        return value
            .to_json(context)
            .map_err(|error| js_error("serialize callback result", error, context))
            .map(|value| value.unwrap_or(JsonValue::Null));
    };
    if seen
        .iter()
        .any(|candidate| JsObject::equals(candidate, &object))
    {
        return Err(PluginEngineError::Callback(
            "callback result contains a cyclic object".to_owned(),
        ));
    }
    seen.push(object.clone());
    let result = if object.is_array() {
        let array = JsArray::from_object(object.clone())
            .map_err(|error| js_error("read callback result array", error, context))?;
        let length = array
            .length(context)
            .map_err(|error| js_error("read callback result array length", error, context))?;
        let mut projected = Vec::with_capacity(length as usize);
        for index in 0..length {
            let item = array
                .get(index, context)
                .map_err(|error| js_error("read callback result array item", error, context))?;
            projected.push(project_runtime_value(
                &item,
                &object,
                operation,
                callbacks,
                next_callback_index,
                callback_count,
                seen,
                depth + 1,
                context,
            )?);
        }
        Ok(JsonValue::Array(projected))
    } else {
        let mut projected = JsonMap::new();
        for key in object
            .own_property_keys(context)
            .map_err(|error| js_error("enumerate callback result", error, context))?
        {
            let property = match &key {
                PropertyKey::String(value) => value.to_std_string_escaped(),
                PropertyKey::Index(value) => value.get().to_string(),
                PropertyKey::Symbol(_) => {
                    return Err(PluginEngineError::Callback(
                        "callback result contains a symbol property".to_owned(),
                    ));
                }
            };
            if property == asterlyn_plugin_runtime_protocol::REMOTE_CALLBACK_MARKER {
                return Err(PluginEngineError::Callback(
                    "callback result uses the reserved remote callback marker".to_owned(),
                ));
            }
            let item = object
                .get(key, context)
                .map_err(|error| js_error("read callback result property", error, context))?;
            if item.is_undefined() {
                continue;
            }
            let item = project_runtime_value(
                &item,
                &object,
                &property,
                callbacks,
                next_callback_index,
                callback_count,
                seen,
                depth + 1,
                context,
            )?;
            projected.insert(property, item);
        }
        Ok(JsonValue::Object(projected))
    };
    seen.pop();
    result
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

fn settle_value(
    value: JsValue,
    capability_queue: &Gc<GcRefCell<Vec<PendingCapability>>>,
    exchange: &mut impl FnMut(&CapabilityCall) -> Result<CapabilityOutcome, String>,
    context: &mut Context,
) -> Result<JsValue, PluginEngineError> {
    let Some(object) = value.as_object() else {
        return Ok(value);
    };
    let Ok(promise) = JsPromise::from_object(object) else {
        return Ok(value);
    };
    for _ in 0..=MAX_CAPABILITY_REQUESTS_PER_TURN {
        context
            .run_jobs()
            .map_err(|error| js_error("drain promise jobs", error, context))?;
        match promise.state() {
            PromiseState::Fulfilled(value) => return Ok(value),
            PromiseState::Rejected(reason) => {
                return Err(PluginEngineError::JavaScript(format!(
                    "promise rejected: {}",
                    js_value_message(&reason, context)
                )));
            }
            PromiseState::Pending => {}
        }
        if !drain_one_capability(capability_queue, exchange, context)? {
            return Err(PluginEngineError::Contract(
                "plugin promise remained pending without a host request".to_owned(),
            ));
        }
    }
    Err(PluginEngineError::Capability(
        "plugin capability request limit exceeded while settling promise".to_owned(),
    ))
}

fn drain_capabilities(
    capability_queue: &Gc<GcRefCell<Vec<PendingCapability>>>,
    exchange: &mut impl FnMut(&CapabilityCall) -> Result<CapabilityOutcome, String>,
    context: &mut Context,
) -> Result<(), PluginEngineError> {
    for _ in 0..=MAX_CAPABILITY_REQUESTS_PER_TURN {
        context
            .run_jobs()
            .map_err(|error| js_error("drain capability jobs", error, context))?;
        if !drain_one_capability(capability_queue, exchange, context)? {
            return Ok(());
        }
    }
    Err(PluginEngineError::Capability(
        "plugin capability request limit exceeded during activation".to_owned(),
    ))
}

fn drain_one_capability(
    capability_queue: &Gc<GcRefCell<Vec<PendingCapability>>>,
    exchange: &mut impl FnMut(&CapabilityCall) -> Result<CapabilityOutcome, String>,
    context: &mut Context,
) -> Result<bool, PluginEngineError> {
    let pending = {
        let mut queue = capability_queue.borrow_mut();
        if queue.is_empty() {
            return Ok(false);
        }
        queue.remove(0)
    };
    let outcome = exchange(&pending.call).map_err(PluginEngineError::Capability)?;
    let (function, value) = match outcome {
        CapabilityOutcome::Success(payload) => {
            let value = JsValue::from_json(&payload, context)
                .map_err(|error| js_error("convert capability result", error, context))?;
            (pending.resolvers.resolve.clone(), value)
        }
        CapabilityOutcome::Failure(message) => (
            pending.resolvers.reject.clone(),
            JsString::from(message.as_str()).into(),
        ),
    };
    function
        .call(&JsValue::undefined(), &[value], context)
        .map_err(|error| js_error("settle capability promise", error, context))?;
    Ok(true)
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
    fn capability_proxies_round_trip_during_activation_and_async_callbacks() {
        let (_directory, entry) = write_fixture(
            r#"
            let restored = null;
            export const FIXTURE = Object.freeze({
              id: "dev.asterlyn.fixture",
              version: "1.0.0",
              activate(context) {
                context.workspaceState.read("selected").then((value) => { restored = value; });
                context.contribute({
                  kind: "command",
                  id: "fixture.query",
                  async execute() {
                    const result = await context.processQueries.execute("fixture.query");
                    return { restored, result };
                  },
                });
              },
            });
            "#,
        );
        let mut activation_calls = Vec::new();
        let (mut engine, ready) = PluginEngine::activate_with_capabilities(
            &entry,
            &ExpectedRuntimeIdentity {
                plugin_id: "dev.asterlyn.fixture",
                plugin_version: "1.0.0",
            },
            &activation(),
            &["workspaceState".to_owned(), "processQueries".to_owned()],
            &mut |call| {
                activation_calls.push(call.clone());
                Ok(CapabilityOutcome::Success(json!("restored-id")))
            },
        )
        .expect("activate fixture with capability proxy");
        assert_eq!(activation_calls.len(), 1);
        assert_eq!(activation_calls[0].capability, "workspaceState");
        assert_eq!(activation_calls[0].operation, "read");
        assert_eq!(
            activation_calls[0].payload,
            json!({"arguments": ["selected"]})
        );

        let callback = ready.contributions[0].callbacks["execute"].clone();
        let mut callback_calls = Vec::new();
        let result = engine
            .invoke_with_capabilities(
                &Invoke {
                    request_id: "request-1".to_owned(),
                    callback_handle: callback,
                    operation: "execute".to_owned(),
                    payload: json!({"arguments": []}),
                },
                &mut |call| {
                    callback_calls.push(call.clone());
                    Ok(CapabilityOutcome::Success(json!({"status": "succeeded"})))
                },
            )
            .expect("invoke fixture with capability proxy");
        assert_eq!(callback_calls.len(), 1);
        assert_eq!(callback_calls[0].capability, "processQueries");
        assert_eq!(callback_calls[0].operation, "execute");
        assert_eq!(
            result,
            json!({"restored": "restored-id", "result": {"status": "succeeded"}})
        );
    }

    #[test]
    fn invocation_results_project_nested_functions_as_session_callbacks() {
        let (_directory, entry) = write_fixture(
            r#"
            export const FIXTURE = Object.freeze({
              id: "dev.asterlyn.fixture",
              version: "1.0.0",
              activate(context) {
                context.contribute({
                  kind: "command",
                  id: "fixture.plan",
                  execute() {
                    return {
                      request: { executable: "gradlew" },
                      prefix: "applied",
                      apply(value) { return `${this.prefix}:${value}`; },
                      staged: {
                        inspect() { return { status: "succeeded" }; },
                      },
                    };
                  },
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
        let execute = ready.contributions[0].callbacks["execute"].clone();
        let plan = engine
            .invoke(&Invoke {
                request_id: "request-1".to_owned(),
                callback_handle: execute,
                operation: "execute".to_owned(),
                payload: json!({"arguments": []}),
            })
            .expect("project plan");
        let apply = &plan["apply"][asterlyn_plugin_runtime_protocol::REMOTE_CALLBACK_MARKER];
        assert_eq!(apply["operation"], "apply");
        let inspect =
            &plan["staged"]["inspect"][asterlyn_plugin_runtime_protocol::REMOTE_CALLBACK_MARKER];
        assert_eq!(inspect["operation"], "inspect");
        assert_eq!(engine.callback_count(), 3);

        let applied = engine
            .invoke(&Invoke {
                request_id: "request-2".to_owned(),
                callback_handle: apply["handle"].as_str().expect("apply handle").to_owned(),
                operation: "apply".to_owned(),
                payload: json!({"arguments": ["value"]}),
            })
            .expect("invoke projected apply callback");
        assert_eq!(applied, json!("applied:value"));
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
