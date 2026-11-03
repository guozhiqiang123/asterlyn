//! Explicit private-project measurement. Inputs are paths, never guessed or collected implicitly.
use asterlyn_workspace::{Workspace, symbols::*};
use std::{env, fs, path::PathBuf, sync::atomic::AtomicBool, time::Instant};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() != 7 {
        return Err(
            "usage: symbol_probe ROOT RULES CATALOG_JSON MODEL_JSON_OR_- ORIGIN_OR_- QUERY CACHE"
                .into(),
        );
    }
    let ws = Workspace::open(&args[0])?;
    let bytes = fs::read(&args[1])?;
    let rules: SymbolRuleSet = serde_json::from_slice(&bytes)?;
    rules.validate()?;
    let paths: Vec<String> = serde_json::from_slice(&fs::read(&args[2])?)?;
    let model: Option<serde_json::Value> = if args[3] == "-" {
        None
    } else {
        Some(serde_json::from_slice(&fs::read(&args[3])?)?)
    };
    let origin = (args[4] != "-").then_some(args[4].as_str());
    let mut scopes = Vec::new();
    for p in &rules.profiles {
        let roots = if let Some(projection) = &p.model_scope {
            let Some(model) = model.as_ref() else {
                continue;
            };
            Some(
                ModuleSourceGraph::project(model, ws.root(), projection)?
                    .roots_for(origin)
                    .0,
            )
        } else {
            None
        };
        scopes.push(SymbolScope {
            profile: p.id.clone(),
            roots,
        });
    }
    let key = SymbolCache::identity(&ws, &bytes, "explicit-probe")?;
    let cache_path = PathBuf::from(&args[6]);
    let mut cache = SymbolCache::load(&cache_path, key.clone());
    let stop = AtomicBool::new(false);
    let mut samples = Vec::new();
    let mut first = None;
    let mut last = None;
    for n in 0..31 {
        let began = Instant::now();
        let report = cache.query(SymbolQuery {
            workspace: &ws,
            paths: &paths,
            rules: &rules,
            scopes: &scopes,
            overlays: &[],
            query: &args[5],
            cancel: &stop,
        })?;
        let ms = began.elapsed().as_secs_f64() * 1000.;
        if n == 0 {
            first = Some(
                serde_json::json!({"ms":ms,"matches":report.matches.len(),"scanned":report.files_scanned,"reused":report.reused_files,"partial":report.partial}),
            );
            cache.save(&cache_path)?;
            cache = SymbolCache::load(&cache_path, key.clone());
        } else {
            samples.push(ms);
        }
        last = Some(report);
    }
    samples.sort_by(f64::total_cmp);
    let report = last.unwrap();
    println!(
        "{}",
        serde_json::json!({"first":first,"hotP95Ms":samples[28],"hotSamples":30,"last":{"matches":report.matches.len(),"files":report.files_scanned,"reused":report.reused_files,"partial":report.partial},"cacheBytes":fs::metadata(cache_path)?.len()})
    );
    Ok(())
}
