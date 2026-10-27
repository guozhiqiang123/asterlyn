//! Bounded, product-neutral required-plugin contracts. No filesystem or process authority.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

pub const MAX_PLUGINS: usize = 64;
pub const MAX_DEPENDENCIES: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginDependency {
    pub id: String,
    pub minimum: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_maximum"
    )]
    pub maximum_exclusive: Option<String>,
}

fn present_maximum<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    String::deserialize(deserializer).map(Some)
}

/// Versions may contain both active and pending selections during a restart transition.
/// Their dependency constraints must all remain satisfied until the previous process is gone.
#[derive(Debug, Clone)]
pub struct DependencyNode {
    pub id: String,
    pub versions: Vec<String>,
    pub enabled: bool,
    pub available: bool,
    pub dependencies: Vec<PluginDependency>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DependencyError {
    InvalidDeclaration,
    Limit,
    Cycle,
    Missing(String),
    Unavailable(String),
    Disabled(String),
    Incompatible(String),
    RequiredBy(Vec<String>),
}
impl fmt::Display for DependencyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDeclaration => write!(f, "invalid plugin dependency declaration"),
            Self::Limit => write!(f, "plugin dependency graph exceeds its bound"),
            Self::Cycle => write!(f, "plugin dependency cycle"),
            Self::Missing(id) => write!(f, "required plugin is not installed: {id}"),
            Self::Unavailable(id) => write!(f, "required plugin is unavailable: {id}"),
            Self::Disabled(id) => write!(f, "required plugin is disabled: {id}"),
            Self::Incompatible(id) => write!(f, "required plugin version is incompatible: {id}"),
            Self::RequiredBy(ids) => write!(
                f,
                "plugin is required by enabled plugins: {}",
                ids.join(", ")
            ),
        }
    }
}
impl std::error::Error for DependencyError {}

pub fn valid_plugin_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
}

// C1 deliberately supports stable numeric bounds only, without npm ranges or prerelease promotion.
fn version(value: &str) -> Result<[u64; 3], DependencyError> {
    if value.len() > 64 {
        return Err(DependencyError::InvalidDeclaration);
    }
    let parts = value.split('.').collect::<Vec<_>>();
    if parts.len() != 3 {
        return Err(DependencyError::InvalidDeclaration);
    }
    let mut result = [0; 3];
    for (index, part) in parts.into_iter().enumerate() {
        if part.is_empty()
            || (part.len() > 1 && part.starts_with('0'))
            || !part.bytes().all(|b| b.is_ascii_digit())
        {
            return Err(DependencyError::InvalidDeclaration);
        }
        result[index] = part
            .parse()
            .map_err(|_| DependencyError::InvalidDeclaration)?;
    }
    Ok(result)
}

pub fn validate_declarations(
    owner: &str,
    dependencies: &[PluginDependency],
) -> Result<(), DependencyError> {
    if dependencies.len() > MAX_DEPENDENCIES {
        return Err(DependencyError::Limit);
    }
    let mut ids = BTreeSet::new();
    for dependency in dependencies {
        if dependency.id == owner || !valid_plugin_id(&dependency.id) || !ids.insert(&dependency.id)
        {
            return Err(DependencyError::InvalidDeclaration);
        }
        let minimum = version(&dependency.minimum)?;
        if let Some(maximum) = &dependency.maximum_exclusive
            && version(maximum)? <= minimum
        {
            return Err(DependencyError::InvalidDeclaration);
        }
    }
    Ok(())
}

fn compatible(node: &DependencyNode, requirement: &PluginDependency) -> bool {
    !node.versions.is_empty()
        && node.versions.iter().all(|candidate| {
            version(candidate).is_ok_and(|candidate| {
                candidate >= version(&requirement.minimum).unwrap_or([u64::MAX; 3])
                    && requirement
                        .maximum_exclusive
                        .as_ref()
                        .is_none_or(|maximum| {
                            version(maximum).is_ok_and(|maximum| candidate < maximum)
                        })
            })
        })
}

pub fn validate_graph(nodes: &[DependencyNode]) -> Result<(), DependencyError> {
    if nodes.len() > MAX_PLUGINS {
        return Err(DependencyError::Limit);
    }
    let index = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<BTreeMap<_, _>>();
    if index.len() != nodes.len() {
        return Err(DependencyError::InvalidDeclaration);
    }
    for node in nodes {
        if !valid_plugin_id(&node.id)
            || node.dependencies.len() > MAX_DEPENDENCIES * 3
            || node.versions.len() > 2
        {
            return Err(DependencyError::Limit);
        }
        // Active/pending declarations are independently validated; duplicates across them are intentional.
        for dependency in &node.dependencies {
            validate_declarations(&node.id, std::slice::from_ref(dependency))?;
        }
    }
    fn visit<'a>(
        id: &'a str,
        index: &BTreeMap<&'a str, &'a DependencyNode>,
        visiting: &mut BTreeSet<&'a str>,
        done: &mut BTreeSet<&'a str>,
    ) -> Result<(), DependencyError> {
        if done.contains(id) {
            return Ok(());
        }
        if !visiting.insert(id) {
            return Err(DependencyError::Cycle);
        }
        if let Some(node) = index.get(id) {
            for dependency in &node.dependencies {
                if index.contains_key(dependency.id.as_str()) {
                    visit(&dependency.id, index, visiting, done)?;
                }
            }
        }
        visiting.remove(id);
        done.insert(id);
        Ok(())
    }
    let mut done = BTreeSet::new();
    for node in nodes {
        visit(&node.id, &index, &mut BTreeSet::new(), &mut done)?;
    }
    Ok(())
}

pub fn enable_closure(nodes: &[DependencyNode], id: &str) -> Result<Vec<String>, DependencyError> {
    validate_graph(nodes)?;
    fn visit(
        nodes: &[DependencyNode],
        id: &str,
        done: &mut BTreeSet<String>,
        order: &mut Vec<String>,
    ) -> Result<(), DependencyError> {
        if done.contains(id) {
            return Ok(());
        }
        let node = nodes
            .iter()
            .find(|node| node.id == id)
            .ok_or_else(|| DependencyError::Missing(id.into()))?;
        if !node.available {
            return Err(DependencyError::Unavailable(id.into()));
        }
        for requirement in &node.dependencies {
            let dependency = nodes
                .iter()
                .find(|candidate| candidate.id == requirement.id)
                .ok_or_else(|| DependencyError::Missing(requirement.id.clone()))?;
            if !compatible(dependency, requirement) {
                return Err(DependencyError::Incompatible(requirement.id.clone()));
            }
            visit(nodes, &dependency.id, done, order)?;
        }
        done.insert(id.into());
        order.push(id.into());
        Ok(())
    }
    let mut order = Vec::new();
    visit(nodes, id, &mut BTreeSet::new(), &mut order)?;
    Ok(order)
}

pub fn validate_enabled(nodes: &[DependencyNode]) -> Result<(), DependencyError> {
    validate_graph(nodes)?;
    for node in nodes.iter().filter(|node| node.enabled) {
        for requirement in &node.dependencies {
            let dependency = nodes
                .iter()
                .find(|candidate| candidate.id == requirement.id)
                .ok_or_else(|| DependencyError::Missing(requirement.id.clone()))?;
            if !dependency.enabled {
                return Err(DependencyError::Disabled(requirement.id.clone()));
            }
            if !dependency.available {
                return Err(DependencyError::Unavailable(requirement.id.clone()));
            }
            if !compatible(dependency, requirement) {
                return Err(DependencyError::Incompatible(requirement.id.clone()));
            }
        }
    }
    Ok(())
}

pub fn required_by(nodes: &[DependencyNode], id: &str) -> Result<Vec<String>, DependencyError> {
    validate_graph(nodes)?;
    fn reaches(
        nodes: &[DependencyNode],
        from: &str,
        target: &str,
        seen: &mut BTreeSet<String>,
    ) -> bool {
        if !seen.insert(from.into()) {
            return false;
        }
        nodes
            .iter()
            .find(|node| node.id == from)
            .is_some_and(|node| {
                node.dependencies.iter().any(|dependency| {
                    dependency.id == target || reaches(nodes, &dependency.id, target, seen)
                })
            })
    }
    Ok(nodes
        .iter()
        .filter(|node| {
            node.enabled && node.id != id && reaches(nodes, &node.id, id, &mut BTreeSet::new())
        })
        .map(|node| node.id.clone())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn requirement(id: &str) -> PluginDependency {
        PluginDependency {
            id: id.into(),
            minimum: "1.0.0".into(),
            maximum_exclusive: Some("2.0.0".into()),
        }
    }
    fn node(id: &str, enabled: bool, deps: &[&str]) -> DependencyNode {
        DependencyNode {
            id: id.into(),
            versions: vec!["1.1.0".into()],
            enabled,
            available: true,
            dependencies: deps.iter().map(|id| requirement(id)).collect(),
        }
    }
    #[test]
    fn enabled_lsp_protects_transitive_dependency_independent_of_activation() {
        let mut nodes = vec![
            node("dev.lsp", true, &["dev.android"]),
            node("dev.other", true, &["dev.android"]),
            node("dev.android", true, &["dev.model"]),
            node("dev.model", true, &[]),
        ];
        assert_eq!(
            required_by(&nodes, "dev.model").unwrap(),
            vec!["dev.lsp", "dev.other", "dev.android"]
        );
        nodes[0].enabled = false;
        assert_eq!(
            required_by(&nodes, "dev.android").unwrap(),
            vec!["dev.other"]
        );
        nodes[1].enabled = false;
        assert!(required_by(&nodes, "dev.android").unwrap().is_empty());
        nodes[2].enabled = false;
        validate_enabled(&nodes).unwrap();
    }
    #[test]
    fn enabling_resolves_installed_closure_without_changing_input() {
        let nodes = vec![
            node("dev.lsp", false, &["dev.android"]),
            node("dev.android", false, &[]),
        ];
        assert_eq!(
            enable_closure(&nodes, "dev.lsp").unwrap(),
            vec!["dev.android", "dev.lsp"]
        );
        assert!(!nodes[1].enabled);
        let mut missing = nodes.clone();
        missing.pop();
        assert_eq!(
            enable_closure(&missing, "dev.lsp"),
            Err(DependencyError::Missing("dev.android".into()))
        );
    }
    #[test]
    fn version_bounds_prereleases_and_pending_incompatible_updates_fail() {
        let mut nodes = vec![
            node("dev.lsp", true, &["dev.android"]),
            node("dev.android", true, &[]),
        ];
        for candidate in ["2.0.0", "1.0.0-beta", "01.0.0"] {
            nodes[1].versions = vec![candidate.into()];
            assert!(validate_enabled(&nodes).is_err());
        }
        nodes[1].versions = vec!["1.1.0".into(), "2.0.0".into()];
        assert!(validate_enabled(&nodes).is_err());
        nodes[1].versions = vec!["1.0.0".into()];
        validate_enabled(&nodes).unwrap();
    }
    #[test]
    fn cycles_invalid_duplicate_declarations_and_limits_fail_closed() {
        let cyclic = vec![
            node("dev.lsp", false, &["dev.android"]),
            node("dev.android", false, &["dev.lsp"]),
        ];
        assert_eq!(validate_graph(&cyclic), Err(DependencyError::Cycle));
        for deps in [
            vec![requirement("dev.lsp")],
            vec![requirement("dev.android"), requirement("dev.android")],
            vec![requirement("../android")],
        ] {
            assert!(validate_declarations("dev.lsp", &deps).is_err());
        }
        assert!(validate_graph(&vec![node("dev.lsp", false, &[]); MAX_PLUGINS + 1]).is_err());
        assert!(
            serde_json::from_str::<PluginDependency>(
                r#"{"id":"dev.android","minimum":"1.0.0","extra":true}"#
            )
            .is_err()
        );
    }
    #[test]
    fn crashed_consumer_keeps_dependency_lock_and_unavailable_provider_blocks_execution() {
        let mut nodes = vec![
            node("dev.lsp", true, &["dev.android"]),
            node("dev.android", true, &[]),
        ];
        nodes[0].available = false;
        assert_eq!(required_by(&nodes, "dev.android").unwrap(), vec!["dev.lsp"]);
        nodes[1].available = false;
        assert!(validate_enabled(&nodes).is_err());
    }
}
