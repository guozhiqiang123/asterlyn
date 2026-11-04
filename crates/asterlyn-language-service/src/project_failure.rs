//! User-actionable project metadata. Never carries exception text or repository addresses.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "kebab-case")]
pub enum ProjectFailureKind {
    DependencyOffline,
    DependencyUnavailable,
    DependencyTls,
    DependencyDns,
    RepositoryCredentialsMissing,
    AndroidSdkMissing,
    ProjectConfigurationFailed,
    ProjectScriptFailed,
    ModelSelectedVariantMissing,
    ModelDependencyVariantMissing,
    ModelDependencyVariantAmbiguous,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectFailure {
    pub kind: ProjectFailureKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub module: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dependency: Option<String>,
    #[serde(default)]
    pub remaining: u32,
}

impl ProjectFailure {
    pub fn validated(self) -> Option<Self> {
        let token = |s: &str| !s.is_empty() && !s.contains("..") && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b,b':'|b'.'|b'-'|b'_'|b'+'|b'$'));
        if self.remaining > 9999 || self.module.as_ref().is_some_and(|s| s.len() > 80 || !s.starts_with(':') || !token(s)) || self.dependency.as_ref().is_some_and(|s| s.len() > 160 || s.split(':').count() != 3 || s.split(':').any(str::is_empty) || !token(s) || s.contains('$')) { return None; }
        Some(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_identifiers_exclude_paths_urls_and_private_messages() {
        let value = serde_json::json!({"kind":"dependency-offline","module":":feature-push","dependency":"org.example:library:1.2.3","remaining":0});
        assert!(serde_json::from_value::<ProjectFailure>(value.clone()).unwrap().validated().is_some());
        for dependency in ["https://user:secret@host/file", "/private/source", "a::b", "a:b:../../secret", "source text", "a:b:$TOKEN"] {
            let mut invalid=value.clone();invalid["dependency"]=dependency.into();
            assert!(serde_json::from_value::<ProjectFailure>(invalid).unwrap().validated().is_none());
        }
        let mut invalid=value;invalid["rawException"]="secret".into();
        assert!(serde_json::from_value::<ProjectFailure>(invalid).is_err());
    }
}
