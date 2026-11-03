use crate::application::java_installations::{candidates, major};
use asterlyn_plugin_package::AnalysisTool;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, path::Path};
pub(super) fn resolve(
    workspace: &Path,
    requirements: &[AnalysisTool],
) -> Result<BTreeMap<String, Value>, String> {
    let mut available = Vec::new();
    for candidate in candidates() {
        let Ok(home) = candidate.canonicalize() else {
            continue;
        };
        if home.starts_with(workspace) {
            continue;
        }
        let Ok(metadata) = fs::metadata(home.join("release")) else {
            continue;
        };
        if metadata.len() > 65536 {
            continue;
        }
        let Ok(release) = fs::read_to_string(home.join("release")) else {
            continue;
        };
        let Some(major) = major(&release) else {
            continue;
        };
        let java = home.join(if cfg!(windows) {
            "bin/java.exe"
        } else {
            "bin/java"
        });
        let javac = home.join(if cfg!(windows) {
            "bin/javac.exe"
        } else {
            "bin/javac"
        });
        if java.is_file() && javac.is_file() {
            available.push((major, home, java, javac, release));
        }
    }
    available.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    requirements.iter().map(|required|{
        let (major,home,java,javac,release)=available.iter().find(|(major,..)|*major>=required.minimum_major&&required.maximum_major_exclusive.is_none_or(|max|*major<max)).ok_or_else(||format!("Language component '{}' requires a standalone JDK {}{} in a standard Java installation directory.",required.id,required.minimum_major,required.maximum_major_exclusive.map(|max|format!("–{}",max-1)).unwrap_or_default()))?;
        let mut identity=Sha256::new();identity.update(release.as_bytes());identity.update(super::super::language_service::hash_file(java)?);identity.update(super::super::language_service::hash_file(javac)?);
        Ok((required.id.clone(),json!({"home":home,"java":java,"javac":javac,"major":major,"digest":format!("sha256:{:x}",identity.finalize())})))
    }).collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_modern_release_without_executing_project_code() {
        assert_eq!(major("JAVA_VERSION=\"25.0.5\"\n"), Some(25));
        assert_eq!(major("OTHER=17"), None);
    }
}
