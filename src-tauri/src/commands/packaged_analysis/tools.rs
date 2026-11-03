use crate::application::java_installations::candidates;
use asterlyn_plugin_package::AnalysisTool;
use asterlyn_process::toolchain::{JavaRequirement, ToolchainRole, ToolchainSource, inspect_jdk};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::Path};

pub(super) fn resolve(
    workspace: &Path,
    requirements: &[AnalysisTool],
    role: ToolchainRole,
) -> Result<BTreeMap<String, Value>, String> {
    resolve_from(workspace, requirements, role, &candidates())
}

fn resolve_from(
    workspace: &Path,
    requirements: &[AnalysisTool],
    role: ToolchainRole,
    candidates: &[std::path::PathBuf],
) -> Result<BTreeMap<String, Value>, String> {
    let mut available: Vec<_> = candidates
        .iter()
        .filter_map(|home| inspect_jdk(home, workspace).ok())
        .collect();
    available.sort_by(|a, b| a.major.cmp(&b.major).then(a.home.cmp(&b.home)));
    requirements.iter().map(|required| {
        let requirement=JavaRequirement {minimum_major:required.minimum_major,maximum_major_exclusive:required.maximum_major_exclusive};
        let jdk=available.iter().find(|jdk| requirement.accepts(jdk.major)).ok_or_else(||format!("Toolchain unavailable: '{}' requires a standalone JDK {}{} in a standard Java installation directory.",required.id,required.minimum_major,required.maximum_major_exclusive.map(|max|format!("–{}",max-1)).unwrap_or_default()))?;
        let context=jdk.snapshot(&required.id,role,requirement,ToolchainSource::Installed,"lowest-compatible").map_err(|failure| format!("Toolchain unavailable: {} for '{}'.",failure.code(),required.id))?;
        Ok((required.id.clone(),json!({"home":jdk.home,"java":context.executable,"javac":jdk.javac,"major":jdk.major,"digest":context.identity,"context":context})))
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolves_distinct_jvm_requirements_and_binds_context_to_content() {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().canonicalize().unwrap();
        let workspace = base.join("project");
        std::fs::create_dir_all(&workspace).unwrap();
        let mut homes = Vec::new();
        for major in [25, 17] {
            let home = base.join(format!("jdk-{major}"));
            std::fs::create_dir_all(home.join("bin")).unwrap();
            std::fs::write(
                home.join("release"),
                format!("JAVA_VERSION=\"{major}.0.1\"\n"),
            )
            .unwrap();
            for name in ["java", "javac"] {
                std::fs::write(
                    home.join("bin").join(if cfg!(windows) {
                        format!("{name}.exe")
                    } else {
                        name.into()
                    }),
                    b"standalone",
                )
                .unwrap();
            }
            homes.push(home);
        }
        let requirements = vec![
            AnalysisTool {
                id: "serverJava".into(),
                kind: asterlyn_plugin_package::AnalysisToolKind::Java,
                minimum_major: 25,
                maximum_major_exclusive: Some(26),
            },
            AnalysisTool {
                id: "kotlinJava".into(),
                kind: asterlyn_plugin_package::AnalysisToolKind::Java,
                minimum_major: 17,
                maximum_major_exclusive: Some(25),
            },
        ];
        let tools = resolve_from(
            &workspace,
            &requirements,
            ToolchainRole::LanguageServer,
            &homes,
        )
        .unwrap();
        assert_eq!(tools["serverJava"]["major"], 25);
        assert_eq!(tools["kotlinJava"]["major"], 17);
        assert_eq!(tools["serverJava"]["context"]["role"], "language-server");
        let model = resolve_from(
            &workspace,
            &requirements[1..],
            ToolchainRole::BuildModel,
            &homes,
        )
        .unwrap();
        assert_eq!(model["kotlinJava"]["context"]["role"], "build-model");
        assert_eq!(
            model["kotlinJava"]["digest"], tools["kotlinJava"]["digest"],
            "role explains use; executable identity is shared"
        );
        std::fs::write(
            homes[0].join(if cfg!(windows) {
                "bin/java.exe"
            } else {
                "bin/java"
            }),
            b"changed",
        )
        .unwrap();
        assert_ne!(
            tools["serverJava"]["digest"],
            resolve_from(
                &workspace,
                &requirements,
                ToolchainRole::LanguageServer,
                &homes
            )
            .unwrap()["serverJava"]["digest"]
        );
        assert!(
            resolve_from(
                &workspace,
                &requirements,
                ToolchainRole::LanguageServer,
                &[]
            )
            .unwrap_err()
            .contains("serverJava")
        );
    }
}
