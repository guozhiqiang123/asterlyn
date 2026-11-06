use asterlyn_plugin_package::language_catalog::{LanguageServerCatalog, PATTERNS};
use serde_json::json;

fn main() {
    let patterns = PATTERNS
        .iter()
        .copied()
        .collect::<std::collections::BTreeMap<_, _>>();
    println!(
        "{}",
        json!({"schema": schemars::schema_for!(LanguageServerCatalog), "patterns": patterns})
    );
}
