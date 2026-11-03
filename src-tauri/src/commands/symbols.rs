//! Explicit syntax candidates. Admission, catalog and approved model leases stay authoritative.
use crate::application::{ActiveWorkspaces, DiagnosticsLog, LanguageServiceManager};
use crate::commands::{
    admission_context, installation_store, installed_package_root, select_installed_plugin,
    verify_installed_package_archive,
};
use asterlyn_language_service::application::LanguageSubject;
use asterlyn_plugin_package::inspect_extracted_package;
use asterlyn_workspace::{
    Workspace,
    symbols::{
        SymbolCache, SymbolCandidate, SymbolFact, SymbolOverlay, SymbolQuery, SymbolQueryReport,
        SymbolRuleSet, SymbolScope, extract_symbols, fact_matches, source_revision,
    },
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, WebviewWindow};
const PLUGIN: &str = "dev.asterlyn.lsp";
const RULES: &str = "servers/symbol-index.v1.json";
#[derive(Clone)]
struct Rules {
    key: String,
    bytes: Vec<u8>,
    rules: SymbolRuleSet,
}
#[derive(Default)]
pub(crate) struct SymbolQueries {
    queries: Mutex<HashMap<String, (String, Arc<AtomicBool>)>>,
    rules: Mutex<Option<Rules>>,
}
struct QueryGuard {
    app: AppHandle,
    owner: String,
    id: String,
    cancel: Arc<AtomicBool>,
}
impl SymbolQueries {
    pub(crate) fn remove_window(&self, owner: &str) {
        if let Ok(mut queries) = self.queries.lock()
            && let Some((_, cancel)) = queries.remove(owner)
        {
            cancel.store(true, Ordering::Relaxed);
        }
    }
}
impl Drop for QueryGuard {
    fn drop(&mut self) {
        if let Ok(mut q) = self.app.state::<SymbolQueries>().queries.lock()
            && q.get(&self.owner).is_some_and(|(id, _)| id == &self.id)
        {
            q.remove(&self.owner);
        }
    }
}
fn subject(app: &AppHandle, window: &str, root: &str) -> Result<LanguageSubject, String> {
    let active = app.state::<ActiveWorkspaces>();
    Ok(LanguageSubject {
        owner: window.into(),
        activation: active
            .activation_token(window)
            .map_err(|_| "symbol-workspace-stale")?,
        root: active
            .resolve(window, root)
            .map_err(|_| "symbol-workspace-stale")?,
    })
}
fn current(app: &AppHandle, s: &LanguageSubject) -> bool {
    subject(app, &s.owner, &s.root.to_string_lossy())
        .as_ref()
        .is_ok_and(|v| v == s)
}
fn read_rules(path: &Path) -> Result<Vec<u8>, String> {
    let meta = fs::symlink_metadata(path).map_err(|_| "symbol-rules-unavailable")?;
    if !meta.is_file() || meta.len() > 64 * 1024 {
        return Err("symbol-rules-invalid".into());
    }
    let mut b = Vec::new();
    fs::File::open(path)
        .map_err(|_| "symbol-rules-unavailable")?
        .take(65537)
        .read_to_end(&mut b)
        .map_err(|_| "symbol-rules-unavailable")?;
    if b.len() > 65536 {
        return Err("symbol-rules-limit".into());
    }
    Ok(b)
}
fn rules(app: &AppHandle) -> Result<Rules, String> {
    let selected = select_installed_plugin(
        &installation_store(app)?
            .snapshot()
            .map_err(|_| "symbol-plugin-state")?,
        PLUGIN,
    )?;
    if selected.repository != "guozhiqiang123/asterlyn-plugin-lsp" {
        return Err("symbol-provider-unavailable".into());
    }
    let key = format!(
        "{}:{}:{}",
        selected.version, selected.package_digest, selected.content_digest
    );
    let root = installed_package_root(app, PLUGIN, &selected.version, &selected.package_digest)?;
    let bytes = read_rules(&root.join(RULES))?;
    let state = app.state::<SymbolQueries>();
    let mut cached = state.rules.lock().map_err(|_| "symbol-rules-lock")?;
    if let Some(value) = cached.as_ref().filter(|c| c.key == key && c.bytes == bytes) {
        return Ok(value.clone());
    }
    verify_installed_package_archive(app, PLUGIN, &selected.version, &selected.package_digest)?;
    let report = inspect_extracted_package(
        &root,
        &admission_context(&selected.repository, &selected.version),
    )
    .map_err(|_| "symbol-plugin-integrity")?;
    if report.plugin_id != PLUGIN
        || report.plugin_version != selected.version
        || report.content_digest != selected.content_digest
        || !report.capabilities.iter().any(|v| v == "languageServices")
        || !report.files.iter().any(|f| f.path == RULES)
    {
        return Err("symbol-plugin-integrity".into());
    }
    // Inspector and reader must see the same resource, including replacement races.
    if read_rules(&root.join(RULES))? != bytes {
        return Err("symbol-rules-changed".into());
    }
    let rules: SymbolRuleSet =
        serde_json::from_slice(&bytes).map_err(|_| "symbol-rules-invalid")?;
    rules.validate()?;
    let value = Rules { key, bytes, rules };
    *cached = Some(value.clone());
    Ok(value)
}
fn scopes(
    app: &AppHandle,
    s: &LanguageSubject,
    r: &Rules,
    origin: Option<&str>,
) -> (Vec<SymbolScope>, Option<String>, bool) {
    let mut scopes = Vec::new();
    let mut tokens = Vec::new();
    let mut partial = false;
    let mut models: HashMap<String, Result<Value, String>> = HashMap::new();
    for p in &r.rules.profiles {
        if let Some(projection) = &p.model_scope {
            let projection_key = format!(
                "{}:{}",
                p.server_id,
                serde_json::to_string(projection).unwrap_or_default()
            );
            let result = models
                .entry(projection_key)
                .or_insert_with(|| {
                    (|| {
                        let receiver = app.state::<LanguageServiceManager>().source_scope(
                            s,
                            &p.server_id,
                            serde_json::to_value(projection).map_err(|_| "symbol-projection")?,
                            origin.map(str::to_owned),
                        )?;
                        receiver
                            .recv_timeout(Duration::from_secs(2))
                            .map_err(|_| "symbol-model-timeout")?
                    })()
                })
                .clone();
            match result {
                Ok(value) => {
                    let roots = value["roots"]
                        .as_array()
                        .map(|roots| {
                            roots
                                .iter()
                                .filter_map(Value::as_str)
                                .map(str::to_owned)
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    partial |= value["partial"].as_bool() != Some(false);
                    if let Some(token) = value["token"].as_str() {
                        tokens.push(format!("{}:{token}", p.id));
                    }
                    scopes.push(SymbolScope {
                        profile: p.id.clone(),
                        roots: Some(roots),
                    });
                }
                Err(_) => {
                    partial = true;
                }
            }
        } else {
            scopes.push(SymbolScope {
                profile: p.id.clone(),
                roots: None,
            });
        }
    }
    tokens.sort();
    (
        scopes,
        (!tokens.is_empty()).then(|| tokens.join("|")),
        partial,
    )
}
fn cache_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|_| "symbol-cache-directory")?
        .join("symbols-v1")
        .join(format!("{key}.json")))
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn query_project_symbols(
    app: AppHandle,
    window: WebviewWindow,
    root: String,
    request_id: String,
    query: String,
    origin: Option<String>,
    overlays: Vec<SymbolOverlay>,
) -> Result<SymbolQueryReport, String> {
    if !valid_id(&request_id)
        || query.len() > 128
        || origin.as_ref().is_some_and(|s| s.len() > 4096)
    {
        return Err("symbol-query-limit".into());
    }
    let s = subject(&app, window.label(), &root)?;
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<SymbolQueries>();
        let mut pending = state.queries.lock().map_err(|_| "symbol-query-lock")?;
        if let Some((_, old)) =
            pending.insert(s.owner.clone(), (request_id.clone(), cancel.clone()))
        {
            old.store(true, Ordering::Relaxed);
        }
    }
    let guard = QueryGuard {
        app: app.clone(),
        owner: s.owner.clone(),
        id: request_id,
        cancel,
    };
    tauri::async_runtime::spawn_blocking(move||{
  let started=Instant::now();let r=rules(&app)?;if guard.cancel.load(Ordering::Relaxed){return Err("symbol-query-cancelled".into());}let workspace=Workspace::open(&s.root).map_err(|_|"symbol-workspace-unavailable")?;
  let paths=app.state::<ActiveWorkspaces>().symbol_catalog(&s.owner,s.activation,&s.root).map_err(|_|"symbol-workspace-stale")?;
  if origin.as_ref().is_some_and(|origin|!paths.contains(origin)){return Err("symbol-origin-outside-catalog".into());}
  if overlays.iter().any(|overlay|!paths.contains(&overlay.workspace_path)){return Err("symbol-overlay-outside-catalog".into());}
  let(admitted_scopes,token,partial)=scopes(&app,&s,&r,origin.as_deref());
  let key=SymbolCache::identity(&workspace,&r.bytes,&r.key)?;let path=cache_path(&app,&key)?;let mut cache=SymbolCache::load(&path,key);let mut report=cache.query(SymbolQuery { workspace: &workspace, paths: &paths, rules: &r.rules, scopes: &admitted_scopes, overlays: &overlays, query: &query, cancel: &guard.cancel })?;
  if !current(&app,&s)||guard.cancel.load(Ordering::Relaxed)||rules(&app)?.key!=r.key{return Err("symbol-query-stale".into());}
  let(_,after,_)=scopes_for_check(&app,&s,&r,origin.as_deref());if token!=after{return Err("symbol-model-stale".into());}
  report.scope_token=token;report.partial|=partial;if partial{report.reasons.push("model-scope".into());}
  let persisted=cache.save(&path).is_ok();if persisted{prune_cache(&path);}app.state::<DiagnosticsLog>().info("language.symbols","query.completed",None,json!({"files":report.files_scanned,"reused":report.reused_files,"matches":report.matches.len(),"partial":report.partial,"persisted":persisted,"durationMs":started.elapsed().as_millis() as u64}));Ok(report)
 }).await.map_err(|_|"symbol-query-worker")?
}
fn scopes_for_check(
    app: &AppHandle,
    s: &LanguageSubject,
    r: &Rules,
    origin: Option<&str>,
) -> (Vec<SymbolScope>, Option<String>, bool) {
    scopes(app, s, r, origin)
}
#[tauri::command]
pub(crate) fn cancel_project_symbols(app: AppHandle, window: WebviewWindow, request_id: String) {
    if let Ok(q) = app.state::<SymbolQueries>().queries.lock()
        && let Some((id, cancel)) = q.get(window.label()).filter(|(id, _)| id == &request_id)
    {
        let _ = id;
        cancel.store(true, Ordering::Relaxed);
    }
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn validate_project_symbol(
    app: AppHandle,
    window: WebviewWindow,
    root: String,
    candidate: SymbolCandidate,
    identity: String,
    scope_token: Option<String>,
    origin: Option<String>,
    overlay: Option<SymbolOverlay>,
) -> Result<bool, String> {
    let s = subject(&app, window.label(), &root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let r = rules(&app)?;
        let workspace = Workspace::open(&s.root).map_err(|_| "symbol-workspace-unavailable")?;
        if identity != SymbolCache::identity(&workspace, &r.bytes, &r.key)? {
            return Ok(false);
        }
        let paths = app
            .state::<ActiveWorkspaces>()
            .symbol_catalog(&s.owner, s.activation, &s.root)
            .map_err(|_| "symbol-workspace-stale")?;
        if !paths.contains(&candidate.workspace_path) {
            return Ok(false);
        }
        let (scopes, token, _) = scopes(&app, &s, &r, origin.as_deref());
        if scope_token != token {
            return Ok(false);
        }
        let Some(profile) = r
            .rules
            .profiles
            .iter()
            .find(|p| p.id == candidate.extractor_id)
        else {
            return Ok(false);
        };
        let Some(scope) = scopes.iter().find(|p| p.profile == profile.id) else {
            return Ok(false);
        };
        if scope.roots.as_ref().is_some_and(|roots| {
            !roots.iter().any(|root| {
                candidate.workspace_path == *root
                    || candidate
                        .workspace_path
                        .strip_prefix(root)
                        .is_some_and(|tail| tail.starts_with('/'))
            })
        }) {
            return Ok(false);
        }
        let text = if candidate.overlay {
            let Some(o) = overlay.filter(|o| o.workspace_path == candidate.workspace_path) else {
                return Ok(false);
            };
            let Some(text) = o
                .text
                .filter(|t| t.len() <= asterlyn_workspace::symbols::MAX_SOURCE_BYTES)
            else {
                return Ok(false);
            };
            if source_revision(&text) != candidate.revision {
                return Ok(false);
            }
            text
        } else {
            if overlay.is_some() {
                return Ok(false);
            }
            let snap = workspace
                .read_symbol_source(&candidate.workspace_path)
                .map_err(|_| "symbol-source-unavailable")?;
            if snap.revision != candidate.revision {
                return Ok(false);
            }
            snap.content
        };
        let fact = SymbolFact {
            name: candidate.name,
            kind: candidate.kind,
            range: candidate.range,
        };
        Ok(current(&app, &s)
            && fact_matches(&text, &fact)
            && extract_symbols(&text, profile).0.contains(&fact))
    })
    .await
    .map_err(|_| "symbol-query-worker")?
}

fn prune_cache(current: &Path) {
    let Some(parent) = current.parent() else {
        return;
    };
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    let mut files: Vec<_> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_stem()?.to_str()?;
            if path.extension()?.to_str()? != "json"
                || name.len() != 64
                || !name.bytes().all(|c| c.is_ascii_hexdigit())
            {
                return None;
            }
            let meta = fs::symlink_metadata(&path).ok()?;
            if !meta.is_file() {
                return None;
            }
            Some((meta.modified().ok()?, meta.len(), path))
        })
        .collect();
    files.sort_by_key(|f| f.0);
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    let mut count = files.len();
    for (_, bytes, path) in files {
        if count <= 8 && total <= 32 * 1024 * 1024 {
            break;
        }
        if path != current && fs::remove_file(path).is_ok() {
            total = total.saturating_sub(bytes);
            count -= 1;
        }
    }
}
