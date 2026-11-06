//! Declarative upstream metadata. Admission grants no download or execution authority.

use std::collections::BTreeSet;
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

use super::{AdmissionError, contract};

pub const CAPABILITY: &str = "languageServerCatalog";
pub const SCHEMA_VERSION: u32 = 1;
pub const MAX_LANGUAGES: usize = 16;
pub const MAX_SERVERS: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LanguageServerCatalog {
    #[cfg_attr(feature = "bindings", schemars(range(min = 1, max = 1)))]
    pub schema_version: u32,
    #[cfg_attr(feature = "bindings", schemars(length(min = 1, max = 16)))]
    pub languages: Vec<CatalogLanguage>,
    #[cfg_attr(feature = "bindings", schemars(length(max = 16)))]
    pub servers: Vec<CatalogServer>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogLanguage {
    pub id: String,
    pub label_key: String,
    #[cfg_attr(feature = "bindings", schemars(length(max = 16)))]
    pub extensions: Vec<String>,
    #[cfg_attr(feature = "bindings", schemars(length(max = 16)))]
    pub file_names: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogServer {
    pub id: String,
    pub label_key: String,
    #[cfg_attr(feature = "bindings", schemars(length(min = 1, max = 16)))]
    pub language_ids: Vec<String>,
    pub upstream: CatalogUpstream,
    #[cfg_attr(feature = "bindings", schemars(length(min = 1, max = 6)))]
    pub platforms: Vec<CatalogPlatform>,
    #[cfg_attr(feature = "bindings", schemars(length(max = 8)))]
    pub root_markers: Vec<String>,
    pub require_root_marker: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogUpstream {
    pub repository: String,
    pub affiliation: CatalogAffiliation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "kebab-case")]
pub enum CatalogAffiliation {
    LanguageOfficial,
    Community,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "kebab-case")]
pub enum CatalogPlatform {
    MacosArm64,
    MacosX64,
    LinuxArm64,
    LinuxX64,
    WindowsArm64,
    WindowsX64,
}

// Exported alongside the serde schema: the front end uses exactly these patterns.
pub const PATTERNS: &[(&str, &str)] = &[
    ("languageId", r"^[a-z][a-z0-9-]{0,63}$"),
    ("serverId", r"^[a-z][a-z0-9.-]{0,127}$"),
    (
        "labelKey",
        r"^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,158}[A-Za-z0-9])?$",
    ),
    ("extension", r"^\.[a-z0-9]+(?:\.[a-z0-9]+)*$"),
    ("fileName", r"^[A-Za-z0-9._-]+$"),
    (
        "repository",
        r"^https://github\.com/[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$",
    ),
];

static RULES: LazyLock<Vec<(&str, Regex)>> = LazyLock::new(|| {
    PATTERNS
        .iter()
        .map(|(name, pattern)| (*name, Regex::new(pattern).expect("catalog pattern")))
        .collect()
});

fn matches(rule: &str, value: &str) -> bool {
    RULES
        .iter()
        .find(|(name, _)| *name == rule)
        .is_some_and(|(_, pattern)| pattern.is_match(value))
}

fn unique<T: Ord>(items: &[T]) -> bool {
    items.iter().collect::<BTreeSet<_>>().len() == items.len()
}

fn file_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value != "."
        && value != ".."
        && matches("fileName", value)
}

impl LanguageServerCatalog {
    /// Validate bounded metadata and references before exposing it to any consumer.
    pub fn validate(&self) -> Result<(), AdmissionError> {
        let invalid = || contract("invalid language server catalog");
        if self.schema_version != SCHEMA_VERSION
            || self.languages.is_empty()
            || self.languages.len() > MAX_LANGUAGES
            || self.servers.len() > MAX_SERVERS
        {
            return Err(invalid());
        }
        let mut language_ids = BTreeSet::new();
        for language in &self.languages {
            if !matches("languageId", &language.id)
                || !language_ids.insert(&language.id)
                || !matches("labelKey", &language.label_key)
                || language.extensions.len() > 16
                || language.file_names.len() > 16
                || language.extensions.is_empty() && language.file_names.is_empty()
                || !unique(&language.extensions)
                || !unique(&language.file_names)
                || language
                    .extensions
                    .iter()
                    .any(|value| value.len() > 32 || !matches("extension", value))
                || language.file_names.iter().any(|value| !file_name(value))
            {
                return Err(invalid());
            }
        }
        let mut server_ids = BTreeSet::new();
        for server in &self.servers {
            if !matches("serverId", &server.id)
                || !server_ids.insert(&server.id)
                || !matches("labelKey", &server.label_key)
                || !matches("repository", &server.upstream.repository)
                || server.language_ids.is_empty()
                || server.language_ids.len() > 16
                || !unique(&server.language_ids)
                || server
                    .language_ids
                    .iter()
                    .any(|id| !language_ids.contains(id))
                || server.platforms.is_empty()
                || server.platforms.len() > 6
                || !unique(&server.platforms)
                || server.root_markers.len() > 8
                || !unique(&server.root_markers)
                || server.root_markers.iter().any(|value| !file_name(value))
                || server.require_root_marker && server.root_markers.is_empty()
            {
                return Err(invalid());
            }
        }
        Ok(())
    }

    pub fn label_keys(&self) -> impl Iterator<Item = &str> {
        self.languages
            .iter()
            .map(|value| value.label_key.as_str())
            .chain(self.servers.iter().map(|value| value.label_key.as_str()))
    }
}

pub(super) fn validate_authority(
    catalog: Option<&LanguageServerCatalog>,
    capabilities: &[String],
) -> Result<(), AdmissionError> {
    if catalog.is_some() != capabilities.iter().any(|value| value == CAPABILITY) {
        return Err(contract(
            "languageServerCatalog requires exactly one static languageServerCatalog declaration",
        ));
    }
    if let Some(catalog) = catalog {
        catalog.validate()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_catalog_corpus_is_admitted_or_rejected_without_repair() {
        let corpus: serde_json::Value = serde_json::from_str(include_str!(
            "../../../protocol/fixtures/language-server-catalog.json"
        ))
        .unwrap();
        for (kind, expected) in [("valid", true), ("invalid", false)] {
            for case in corpus[kind].as_array().unwrap() {
                let accepted =
                    serde_json::from_value::<LanguageServerCatalog>(case["catalog"].clone())
                        .is_ok_and(|catalog| catalog.validate().is_ok());
                assert_eq!(accepted, expected, "{}", case["name"]);
            }
        }
    }
}
