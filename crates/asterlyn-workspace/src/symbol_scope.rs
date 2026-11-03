//! Generic projection of an admitted model, not knowledge of a build system or language.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelScopeProjection {
    pub root_pointer: String,
    pub modules_pointer: String,
    pub id_pointer: String,
    pub roots_pointers: Vec<String>,
    pub dependencies_pointer: String,
    pub dependency_id_pointer: Option<String>,
}
impl ModelScopeProjection {
    pub fn validate(&self) -> Result<(), String> {
        let valid = |s: &str| {
            s.starts_with('/')
                && s.len() <= 128
                && s.split('/').count() <= 8
                && !s.chars().any(char::is_control)
        };
        if self.roots_pointers.is_empty()
            || self.roots_pointers.len() > 8
            || [
                &self.root_pointer,
                &self.modules_pointer,
                &self.id_pointer,
                &self.dependencies_pointer,
            ]
            .into_iter()
            .chain(&self.roots_pointers)
            .any(|s| !valid(s))
            || self
                .dependency_id_pointer
                .as_ref()
                .is_some_and(|s| !valid(s))
        {
            return Err("invalid-symbol-model-projection".into());
        }
        Ok(())
    }
}
#[derive(Clone)]
struct Module {
    roots: Vec<String>,
    dependencies: Vec<String>,
}
#[derive(Clone)]
pub struct ModuleSourceGraph {
    modules: BTreeMap<String, Module>,
    partial: bool,
}
fn relative(root: &Path, value: &str) -> Option<String> {
    if value.len() > 4096 || value.chars().any(char::is_control) {
        return None;
    }
    let path = Path::new(value);
    let canonical = path.canonicalize().unwrap_or_else(|_| path.into());
    let value = canonical
        .strip_prefix(root)
        .ok()?
        .to_string_lossy()
        .replace('\\', "/");
    (!value.is_empty()
        && value
            .split('/')
            .all(|s| !s.is_empty() && s != "." && s != "..")
        && !value.chars().any(char::is_control))
    .then_some(value)
}
fn contains(root: &str, path: &str) -> bool {
    path == root
        || path
            .strip_prefix(root)
            .is_some_and(|tail| tail.starts_with('/'))
}
impl ModuleSourceGraph {
    pub fn project(value: &Value, root: &Path, p: &ModelScopeProjection) -> Result<Self, String> {
        p.validate()?;
        let model_root = value
            .pointer(&p.root_pointer)
            .and_then(Value::as_str)
            .ok_or("symbol-model-root-missing")?;
        if Path::new(model_root).canonicalize().ok().as_deref() != Some(root) {
            return Err("symbol-model-root-changed".into());
        }
        let input = value
            .pointer(&p.modules_pointer)
            .and_then(Value::as_array)
            .ok_or("symbol-model-modules-missing")?;
        if input.len() > 512 {
            return Err("symbol-model-module-limit".into());
        }
        let mut modules = BTreeMap::new();
        let mut partial = false;
        let mut total = 0;
        for item in input {
            let id = item
                .pointer(&p.id_pointer)
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty() && s.len() <= 128)
                .ok_or("symbol-model-module-id")?;
            let mut roots = Vec::new();
            for pointer in &p.roots_pointers {
                let values = item
                    .pointer(pointer)
                    .and_then(Value::as_array)
                    .ok_or("symbol-model-roots-missing")?;
                for path in values {
                    total += 1;
                    if total > 4096 {
                        return Err("symbol-model-source-limit".into());
                    }
                    let path = path.as_str().ok_or("symbol-model-root-invalid")?;
                    if let Some(path) = relative(root, path) {
                        roots.push(path);
                    } else {
                        partial = true;
                    }
                }
            }
            roots.sort();
            roots.dedup();
            let values = item
                .pointer(&p.dependencies_pointer)
                .and_then(Value::as_array)
                .ok_or("symbol-model-dependencies-missing")?;
            if values.len() > 512 {
                return Err("symbol-model-dependency-limit".into());
            }
            let dependencies = values
                .iter()
                .map(|v| {
                    v.as_str()
                        .or_else(|| {
                            p.dependency_id_pointer
                                .as_ref()
                                .and_then(|pointer| v.pointer(pointer))
                                .and_then(Value::as_str)
                        })
                        .filter(|s| !s.is_empty() && s.len() <= 128)
                        .map(str::to_owned)
                        .ok_or("symbol-model-dependency-id")
                })
                .collect::<Result<Vec<_>, _>>()?;
            if modules
                .insert(
                    id.to_owned(),
                    Module {
                        roots,
                        dependencies,
                    },
                )
                .is_some()
            {
                return Err("symbol-model-duplicate-module".into());
            }
        }
        Ok(Self { modules, partial })
    }
    pub fn roots_for(&self, origin: Option<&str>) -> (Vec<String>, bool) {
        let mut wanted = BTreeSet::new();
        let mut partial = self.partial;
        if let Some(origin) = origin {
            let owners: Vec<_> = self
                .modules
                .iter()
                .flat_map(|(id, m)| {
                    m.roots
                        .iter()
                        .filter(|root| contains(root, origin))
                        .map(move |root| (root.len(), id))
                })
                .collect();
            let longest = owners.iter().map(|v| v.0).max();
            for (length, id) in owners {
                if Some(length) == longest {
                    wanted.insert(id.clone());
                }
            }
            if wanted.is_empty() {
                return (vec![], true);
            }
            let mut pending: Vec<_> = wanted.iter().cloned().collect();
            while let Some(id) = pending.pop() {
                if let Some(module) = self.modules.get(&id) {
                    for dependency in &module.dependencies {
                        if !self.modules.contains_key(dependency) {
                            partial = true;
                            continue;
                        }
                        if wanted.insert(dependency.clone()) {
                            pending.push(dependency.clone());
                        }
                    }
                }
            }
        } else {
            wanted.extend(self.modules.keys().cloned());
        }
        let mut roots = Vec::new();
        for id in wanted {
            if let Some(module) = self.modules.get(&id) {
                roots.extend(module.roots.iter().cloned());
            }
        }
        roots.sort();
        roots.dedup();
        (roots, partial)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn dependency_scope_is_model_bound_and_never_falls_back_to_suffix() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        for m in ["a", "b", "c"] {
            std::fs::create_dir_all(root.join(m).join("src")).unwrap();
        }
        let p = ModelScopeProjection {
            root_pointer: "/root".into(),
            modules_pointer: "/parts".into(),
            id_pointer: "/id".into(),
            roots_pointers: vec!["/paths".into()],
            dependencies_pointer: "/requires".into(),
            dependency_id_pointer: None,
        };
        let model = json!({"root":root,"parts":[{"id":"a","paths":[root.join("a/src")],"requires":["b"]},{"id":"b","paths":[root.join("b/src")],"requires":[]},{"id":"c","paths":[root.join("c/src")],"requires":[]}]});
        let graph = ModuleSourceGraph::project(&model, &root, &p).unwrap();
        assert_eq!(
            graph.roots_for(Some("a/src/A.kt")),
            (vec!["a/src".into(), "b/src".into()], false)
        );
        assert_eq!(graph.roots_for(Some("unmatched/A.kt")), (vec![], true));
        assert_eq!(graph.roots_for(None).0.len(), 3);
        let mut bad = model.clone();
        bad["root"] = json!("/unrelated");
        assert!(ModuleSourceGraph::project(&bad, &root, &p).is_err());
    }
}
