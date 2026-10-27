use std::{collections::BTreeSet, fs, path::Path};
/// Bound traversal before hashing. Conventional dependency/output trees cannot be model inputs.
pub(super) fn fingerprint(root: &Path, globs: &[String]) -> Result<String, String> {
    let patterns = globs
        .iter()
        .map(|pattern| glob::Pattern::new(pattern).map_err(|_| "invalid analysis input pattern"))
        .collect::<Result<Vec<_>, _>>()?;
    let mut paths = BTreeSet::new();
    let mut remaining = 100_000usize;
    fn walk(
        root: &Path,
        relative: &Path,
        patterns: &[glob::Pattern],
        paths: &mut BTreeSet<String>,
        remaining: &mut usize,
        depth: usize,
    ) -> Result<(), String> {
        if depth > 32 {
            return Err("model input directory depth exceeds its bound".into());
        }
        for entry in fs::read_dir(root.join(relative)).map_err(|_| "model inputs unavailable")? {
            let entry = entry.map_err(|_| "model inputs unavailable")?;
            *remaining = remaining
                .checked_sub(1)
                .ok_or("model input catalog exceeds its bound")?;
            let kind = entry.file_type().map_err(|_| "model inputs unavailable")?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            let path = relative.join(name);
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if ![
                    ".git",
                    ".gradle",
                    ".idea",
                    "node_modules",
                    "target",
                    "build",
                    "out",
                ]
                .contains(&name)
                {
                    walk(root, &path, patterns, paths, remaining, depth + 1)?;
                }
            } else if kind.is_file() {
                let path = path.to_string_lossy().replace('\\', "/");
                if patterns.iter().any(|pattern| pattern.matches(&path)) {
                    paths.insert(path);
                    if paths.len() > 4096 {
                        return Err("model input count exceeds its bound".into());
                    }
                }
            }
        }
        Ok(())
    }
    walk(
        root,
        Path::new(""),
        &patterns,
        &mut paths,
        &mut remaining,
        0,
    )?;
    // Missing explicit inputs matter too (for example a subsequently created local configuration).
    paths.extend(
        globs
            .iter()
            .filter(|pattern| !pattern.contains(['*', '?', '[']))
            .cloned(),
    );
    let result = crate::application::plugin_task_cache::compute_fingerprint(
        root,
        &paths.into_iter().collect::<Vec<_>>(),
    );
    // Task-cache fingerprints are bare hex; model identities use algorithm-qualified digests.
    // Adapt at this boundary rather than weakening the model kernel's identity checks.
    result
        .digest
        .map(|hex| format!("sha256:{hex}"))
        .ok_or_else(|| {
            result
                .reason
                .unwrap_or_else(|| "model inputs unavailable".into())
        })
}
#[cfg(test)]
mod tests {
    use super::*;
    use asterlyn_plugin_dependencies::{DependencyNode, PluginDependency};
    use asterlyn_plugin_models::{
        ModelAuthority, ModelError, ModelGrant, ModelKey, PackageIdentity, ProvidedService, Scope,
        content_digest,
    };

    #[test]
    fn real_input_fingerprint_passes_the_native_model_grant() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("build.gradle"), "plugins {}\n").unwrap();
        let fingerprint = fingerprint(root.path(), &["*.gradle".into()]).unwrap();
        let scope = Scope {
            owner: "main".into(),
            workspace_digest: content_digest(root.path().to_string_lossy().as_bytes()),
            activation: 1,
        };
        let packages = ["producer", "consumer"].map(|id| PackageIdentity {
            id: id.into(),
            version: "1.0.0".into(),
            archive_digest: content_digest(id.as_bytes()),
            content_digest: content_digest(b"contents"),
        });
        let nodes = packages.each_ref().map(|package| DependencyNode {
            id: package.id.clone(),
            versions: vec![package.version.clone()],
            enabled: true,
            available: true,
            dependencies: if package.id == "consumer" {
                vec![PluginDependency {
                    id: "producer".into(),
                    minimum: "1.0.0".into(),
                    maximum_exclusive: None,
                }]
            } else {
                vec![]
            },
        });
        let services = [ProvidedService {
            producer: packages[0].clone(),
            id: "build-model".into(),
            schema: 1,
        }];
        let authority = ModelAuthority {
            nodes: &nodes,
            packages: &packages,
            scope: &scope,
            services: &services,
        };
        let key = ModelKey {
            scope: scope.clone(),
            producer: packages[0].clone(),
            service: services[0].id.clone(),
            schema: 1,
            build_root_digest: scope.workspace_digest.clone(),
            input_digest: fingerprint.clone(),
            selection_digest: content_digest(b"selected"),
            tool_digest: content_digest(b"tool"),
        };
        ModelGrant::admit(&authority, packages[1].clone(), key.clone()).unwrap();
        // Prove the kernel still rejects the former unqualified representation.
        let mut bare_key = key;
        bare_key.input_digest = fingerprint.strip_prefix("sha256:").unwrap().into();
        assert!(matches!(
            ModelGrant::admit(&authority, packages[1].clone(), bare_key),
            Err(ModelError::InvalidIdentity)
        ));
    }
    #[test]
    fn content_and_new_inputs_invalidate_without_scanning_outputs() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("build.gradle"), "a").unwrap();
        fs::create_dir(root.path().join("build")).unwrap();
        fs::write(root.path().join("build/ignored.gradle"), "x").unwrap();
        let patterns = vec!["*.gradle".into(), "local.properties".into()];
        let a = fingerprint(root.path(), &patterns).unwrap();
        fs::write(root.path().join("build/ignored.gradle"), "y").unwrap();
        assert_eq!(a, fingerprint(root.path(), &patterns).unwrap());
        fs::write(root.path().join("local.properties"), "b").unwrap();
        assert_ne!(a, fingerprint(root.path(), &patterns).unwrap());
    }
}
