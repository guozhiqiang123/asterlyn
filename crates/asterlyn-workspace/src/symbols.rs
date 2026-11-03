//! Bounded syntax candidates. Rules belong to admitted plugins; these are never semantic answers.
use serde::{Deserialize, Serialize};
#[path = "symbol_cache.rs"]
mod cache;
#[path = "symbol_lexer.rs"]
mod lexer;
#[path = "symbol_scope.rs"]
mod scope;
pub use cache::{SymbolCache, SymbolQuery, SymbolScope, fact_matches, source_revision};
pub use scope::{ModelScopeProjection, ModuleSourceGraph};
pub const ENGINE_VERSION: &str = "tokens-v1";
pub const MAX_SOURCE_BYTES: usize = 256 * 1024;
pub const MAX_SYMBOLS_PER_FILE: usize = 512;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "kebab-case")]
pub enum SymbolKind {
    Class,
    Interface,
    Enum,
    Struct,
    Object,
    Function,
    Constant,
    Variable,
    Module,
    Type,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SymbolPosition {
    pub line: u32,
    pub character: u32,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SymbolRange {
    pub start: SymbolPosition,
    pub end: SymbolPosition,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SymbolFact {
    pub name: String,
    pub kind: SymbolKind,
    pub range: SymbolRange,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct SymbolCandidate {
    pub name: String,
    pub kind: SymbolKind,
    pub range: SymbolRange,
    pub workspace_path: String,
    pub revision: String,
    pub overlay: bool,
    pub extractor_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SymbolOverlay {
    pub workspace_path: String,
    pub text: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct SymbolQueryReport {
    pub identity: String,
    pub matches: Vec<SymbolCandidate>,
    pub files_scanned: usize,
    pub files_total: usize,
    pub reused_files: usize,
    pub skipped_files: usize,
    pub partial: bool,
    pub reasons: Vec<String>,
    pub scope_token: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SymbolRuleSet {
    pub schema: u32,
    pub engine: String,
    pub profiles: Vec<SymbolProfile>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SymbolProfile {
    pub id: String,
    pub server_id: String,
    pub extensions: Vec<String>,
    pub comments: Vec<[String; 2]>,
    pub strings: Vec<String>,
    #[serde(default)]
    pub character_literals: bool,
    #[serde(default)]
    pub method_tail_markers: Vec<String>,
    #[serde(default)]
    pub nested_comments: bool,
    #[serde(default)]
    pub raw_strings: Vec<RawStringRule>,
    #[serde(default)]
    pub quoted_identifiers: Vec<String>,
    #[serde(default)]
    pub regex_literals: bool,
    #[serde(default)]
    pub regex_start_after: Vec<String>,
    #[serde(default)]
    pub compound_tokens: Vec<String>,
    pub declarations: Vec<DeclarationRule>,
    #[serde(default)]
    pub methods: bool,
    #[serde(default)]
    pub excluded_names: Vec<String>,
    #[serde(default)]
    pub rejected_method_prefixes: Vec<String>,
    #[serde(default)]
    pub model_scope: Option<ModelScopeProjection>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RawStringRule {
    pub prefix: String,
    pub marker: String,
    pub quote: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NameMode {
    NextIdentifier,
    BeforeParameters,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeclarationRule {
    pub keyword: String,
    pub kind: SymbolKind,
    pub name_mode: NameMode,
    #[serde(default)]
    pub opens_type: bool,
}
fn word(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '$' || c == '-')
}
impl SymbolRuleSet {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema != 1
            || self.engine != ENGINE_VERSION
            || self.profiles.is_empty()
            || self.profiles.len() > 16
        {
            return Err("unsupported-symbol-rules".into());
        }
        let mut ids = std::collections::HashSet::new();
        for p in &self.profiles {
            if !word(&p.id)
                || !word(&p.server_id)
                || !ids.insert(&p.id)
                || p.extensions.is_empty()
                || p.extensions.len() > 16
                || p.extensions.iter().any(|e| {
                    !e.starts_with('.')
                        || e.len() > 16
                        || !e[1..].bytes().all(|c| c.is_ascii_alphanumeric())
                })
                || p.declarations.is_empty()
                || p.declarations.len() > 64
                || p.declarations.iter().any(|d| !word(&d.keyword))
                || p.comments.len() > 8
                || p.strings.len() > 8
                || p.raw_strings.len() > 8
                || p.quoted_identifiers.len() > 4
                || p.compound_tokens.len() > 16
                || p.excluded_names.len() > 128
                || p.method_tail_markers.len() > 16
                || p.method_tail_markers
                    .iter()
                    .any(|s| s.is_empty() || s.len() > 16 || !s.is_ascii())
                || p.regex_start_after.len() > 32
                || p.rejected_method_prefixes.len() > 32
                || p.excluded_names.iter().any(|s| !word(s))
                || p.regex_start_after
                    .iter()
                    .chain(&p.rejected_method_prefixes)
                    .any(|s| s.is_empty() || s.len() > 128 || !s.is_ascii())
            {
                return Err("invalid-symbol-rules".into());
            }
            let marker = |value: &str| !value.is_empty() && value.len() <= 8 && value.is_ascii();
            if p.comments.iter().flatten().any(|s| !marker(s))
                || p.strings
                    .iter()
                    .chain(&p.quoted_identifiers)
                    .chain(&p.compound_tokens)
                    .any(|s| !marker(s))
                || p.raw_strings.iter().any(|r| {
                    !word(&r.prefix)
                        || r.marker.len() != 1
                        || r.quote.len() != 1
                        || !marker(&r.marker)
                        || !marker(&r.quote)
                })
            {
                return Err("invalid-symbol-markers".into());
            }
            if let Some(projection) = &p.model_scope {
                projection.validate()?;
            }
        }
        Ok(())
    }
}
pub fn extract_symbols(text: &str, profile: &SymbolProfile) -> (Vec<SymbolFact>, bool) {
    lexer::extract(text, profile)
}
