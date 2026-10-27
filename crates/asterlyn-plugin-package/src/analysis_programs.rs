//! Static declarations only. Executables and command-line arguments are never plugin request data.
use super::{AdmissionError, PluginDependency};
use asterlyn_plugin_dependencies::valid_plugin_id;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisTool {
    pub id: String,
    pub kind: AnalysisToolKind,
    pub minimum_major: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximum_major_exclusive: Option<u16>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AnalysisToolKind {
    Java,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisComponent {
    pub id: String,
    pub version: String,
    pub archive_digest: String,
    pub content_digest: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisProgram {
    pub entry: String,
    #[serde(default)]
    pub tools: Vec<AnalysisTool>,
    #[serde(default)]
    pub components: Vec<AnalysisComponent>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelConsumer {
    pub plugin_id: String,
    pub service_id: String,
    pub schema: u32,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelStateBinding {
    pub key: String,
    pub contribution_id: String,
    pub pointer: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelProvider {
    pub id: String,
    pub schema: u32,
    pub program: AnalysisProgram,
    pub input_globs: Vec<String>,
    #[serde(default)]
    pub state_keys: Vec<String>,
    #[serde(default)]
    pub state_bindings: Vec<ModelStateBinding>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LanguageSelector {
    pub language_id: String,
    pub extensions: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackagedLanguageServer {
    pub id: String,
    pub program: AnalysisProgram,
    pub selectors: Vec<LanguageSelector>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<ModelConsumer>,
}

fn invalid() -> AdmissionError {
    AdmissionError::Contract("invalid packaged analysis declaration".into())
}
fn unique(values: impl Iterator<Item = String>, max: usize) -> Result<(), AdmissionError> {
    let mut seen = BTreeSet::new();
    for value in values {
        if !valid_plugin_id(&value) || !seen.insert(value) || seen.len() > max {
            return Err(invalid());
        }
    }
    Ok(())
}
fn digest(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value.as_bytes()[7..]
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}
fn relative(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && !value.starts_with('/')
        && !value.contains(['\\', ':', '\0'])
        && value
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}
fn program(
    value: &AnalysisProgram,
    file_exists: &impl Fn(&str) -> bool,
) -> Result<(), AdmissionError> {
    if !relative(&value.entry)
        || !value.entry.ends_with(".mjs")
        || !file_exists(&value.entry)
        || value.tools.len() > 8
        || value.components.len() > 8
    {
        return Err(invalid());
    }
    unique(value.tools.iter().map(|tool| tool.id.clone()), 8)?;
    unique(
        value
            .components
            .iter()
            .map(|component| component.id.clone()),
        8,
    )?;
    for tool in &value.tools {
        if tool.minimum_major < 17
            || tool.minimum_major > 100
            || tool
                .maximum_major_exclusive
                .is_some_and(|max| max <= tool.minimum_major || max > 101)
        {
            return Err(invalid());
        }
    }
    for component in &value.components {
        if component.version.is_empty()
            || component.version.len() > 128
            || !component.version.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b'+')
            })
            || matches!(component.version.as_str(), "." | "..")
            || !digest(&component.archive_digest)
            || !digest(&component.content_digest)
        {
            return Err(invalid());
        }
    }
    Ok(())
}

pub(super) fn validate(
    capabilities: &[String],
    permissions: &[String],
    dependencies: &[PluginDependency],
    providers: &[ModelProvider],
    servers: &[PackagedLanguageServer],
    file_exists: impl Fn(&str) -> bool,
) -> Result<(), AdmissionError> {
    let models = capabilities.iter().any(|cap| cap == "workspaceModels");
    let execute = permissions
        .iter()
        .any(|permission| permission == "host.workspace-models.execute");
    let language = capabilities
        .iter()
        .any(|cap| cap == "packagedLanguageServices");
    if models != execute
        || (!providers.is_empty() && !models)
        || (!servers.is_empty() && !language)
        || (language && !capabilities.iter().any(|cap| cap == "languageServices"))
        || providers.len() > 8
        || servers.len() > 8
    {
        return Err(invalid());
    }
    unique(providers.iter().map(|provider| provider.id.clone()), 8)?;
    unique(servers.iter().map(|server| server.id.clone()), 8)?;
    for provider in providers {
        program(&provider.program, &file_exists)?;
        if provider.schema == 0
            || provider.input_globs.is_empty()
            || provider.input_globs.len() > 32
            || provider
                .input_globs
                .iter()
                .any(|glob| !relative(glob) || glob.chars().any(char::is_control))
        {
            return Err(invalid());
        }
        unique(
            provider.state_keys.clone().into_iter().chain(
                provider
                    .state_bindings
                    .iter()
                    .map(|binding| binding.key.clone()),
            ),
            16,
        )?;
        if provider.state_bindings.len() > 16
            || provider.state_bindings.iter().any(|binding| {
                !valid_plugin_id(&binding.contribution_id)
                    || binding.pointer.len() > 256
                    || !binding.pointer.starts_with('/')
                    || binding.pointer.chars().any(char::is_control)
            })
        {
            return Err(invalid());
        }
    }
    for server in servers {
        program(&server.program, &file_exists)?;
        if server.selectors.is_empty() || server.selectors.len() > 16 {
            return Err(invalid());
        }
        unique(
            server
                .selectors
                .iter()
                .map(|selector| selector.language_id.clone()),
            16,
        )?;
        let mut extensions = BTreeSet::new();
        for selector in &server.selectors {
            if selector.extensions.is_empty() || selector.extensions.len() > 16 {
                return Err(invalid());
            }
            for extension in &selector.extensions {
                if extension.len() > 32
                    || !extension.starts_with('.')
                    || extension.len() < 2
                    || !extension.bytes().all(|byte| {
                        byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'.'
                    })
                    || !extensions.insert(extension)
                {
                    return Err(invalid());
                }
            }
        }
        if let Some(model) = &server.model
            && (model.schema == 0
                || !valid_plugin_id(&model.service_id)
                || !dependencies
                    .iter()
                    .any(|dependency| dependency.id == model.plugin_id))
        {
            return Err(invalid());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn declarations_require_real_resources_capabilities_and_dependency_authority() {
        let program = AnalysisProgram {
            entry: "services/model.mjs".into(),
            tools: vec![],
            components: vec![],
        };
        let provider = ModelProvider {
            id: "model".into(),
            schema: 1,
            program: program.clone(),
            input_globs: vec!["**/*.gradle".into()],
            state_keys: vec![],
            state_bindings: vec![],
        };
        assert!(
            validate(&[], &[], &[], std::slice::from_ref(&provider), &[], |_| {
                true
            })
            .is_err()
        );
        let capabilities = vec!["workspaceModels".into()];
        let permissions = vec!["host.workspace-models.execute".into()];
        assert!(
            validate(
                &capabilities,
                &permissions,
                &[],
                std::slice::from_ref(&provider),
                &[],
                |_| true
            )
            .is_ok()
        );
        assert!(
            validate(
                &capabilities,
                &permissions,
                &[],
                std::slice::from_ref(&provider),
                &[],
                |_| false
            )
            .is_err()
        );
        let mut escaped = provider;
        escaped.program.entry = "../model.mjs".into();
        assert!(validate(&capabilities, &permissions, &[], &[escaped], &[], |_| true).is_err());
        let server = PackagedLanguageServer {
            id: "android".into(),
            program,
            selectors: vec![LanguageSelector {
                language_id: "java".into(),
                extensions: vec![".java".into()],
            }],
            model: Some(ModelConsumer {
                plugin_id: "producer".into(),
                service_id: "model".into(),
                schema: 1,
            }),
        };
        let capabilities = vec!["packagedLanguageServices".into(), "languageServices".into()];
        assert!(
            validate(
                &capabilities,
                &[],
                &[],
                &[],
                std::slice::from_ref(&server),
                |_| true
            )
            .is_err()
        );
        let dependencies = vec![PluginDependency {
            id: "producer".into(),
            minimum: "1.0.0".into(),
            maximum_exclusive: None,
        }];
        assert!(validate(&capabilities, &[], &dependencies, &[], &[server], |_| true).is_ok());
    }
    #[test]
    fn runtime_argv_unknown_tools_and_unknown_fields_are_rejected() {
        for value in [
            r#"{"entry":"service.mjs","arguments":["sh"]}"#,
            r#"{"entry":"service.mjs","tools":[{"id":"shell","kind":"shell","minimumMajor":17}]}"#,
        ] {
            assert!(serde_json::from_str::<AnalysisProgram>(value).is_err());
        }
    }
}
