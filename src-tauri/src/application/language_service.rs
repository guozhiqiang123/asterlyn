//! Window/workspace-bound language actors. No manager lock is held while performing server I/O.
#[path = "language_service_actor.rs"]
mod actor_runtime;
use actor_runtime::actor;
#[path = "language_service_diagnostics.rs"]
mod diagnostics;
#[path = "language_service_sources.rs"]
mod sources;
use asterlyn_language_service::{
    DocumentIdentity, DocumentState, JsonRpcId, JsonRpcMessage, LanguageServiceProcess,
    PackagedServerProfile, RustServerProfile, ServerEvent, TextChange, TextPosition,
    TypeScriptServerProfile, terminate_process_tree, utf16_offset,
};
use diagnostics::DiagnosticProfile;
#[cfg(test)]
use diagnostics::rust_diagnostic_item;
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, Receiver, SyncSender},
    },
    time::{Duration, Instant},
};

const MAX_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;
const MAX_DOCUMENTS: usize = 32;
const MAX_REQUESTS: usize = 64;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LanguageSubject {
    pub owner: String,
    pub root: PathBuf,
    pub activation: u64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LanguagePackage {
    pub version: String,
    pub digest: String,
    pub content_digest: String,
    pub root: PathBuf,
    pub node: PathBuf,
    pub node_digest: String,
    pub rust: Option<RustServerProfile>,
    pub packaged: Option<PackagedServerProfile>,
}
impl LanguagePackage {
    pub fn server_id(&self) -> &str {
        if let Some(profile) = &self.packaged {
            return &profile.id;
        }
        if self.rust.is_some() {
            "rust-analyzer"
        } else {
            "typescript"
        }
    }
}
struct Review {
    subject: LanguageSubject,
    package: LanguagePackage,
    expires: Instant,
    authority: u64,
}
struct Session {
    subject: LanguageSubject,
    control: SyncSender<ActorCommand>,
    pid: u32,
    profile: String,
}
#[derive(Default)]
pub(crate) struct LanguageServiceManager {
    sessions: Mutex<HashMap<String, Session>>,
    reviews: Mutex<HashMap<String, Review>>,
    sequence: AtomicU64,
    authority: Arc<AtomicU64>,
    starting: Mutex<HashSet<String>>,
    closing: Arc<AtomicBool>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LanguageServiceEvent {
    pub session_id: String,
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<Value>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LanguageServiceResult {
    pub session_id: String,
    pub uri: String,
    pub version: i64,
    pub result: Value,
}
pub(crate) trait ModelResource: Send {
    fn is_current(&self) -> bool;
    fn generation(&self) -> u64;
}
pub(crate) struct ModelReply {
    pub value: Value,
    pub resource: Box<dyn ModelResource>,
}
pub(crate) type ModelAccess =
    Arc<dyn Fn(Arc<AtomicBool>, bool) -> Result<ModelReply, String> + Send + Sync>;
pub(super) struct ActorServices {
    selectors: Option<Vec<(String, Vec<String>)>>,
    model_access: Option<ModelAccess>,
}

pub(crate) type ActorReply = mpsc::Sender<Result<Value, String>>;
enum ActorCommand {
    Open {
        uri: String,
        language: String,
        version: i64,
        text: String,
        reply: ActorReply,
    },
    Change {
        uri: String,
        version: i64,
        changes: Vec<TextChange>,
        reply: ActorReply,
    },
    Close {
        uri: String,
        reply: ActorReply,
    },
    Request {
        uri: String,
        version: i64,
        request_id: String,
        feature: String,
        position: TextPosition,
        reply: ActorReply,
    },
    Cancel {
        request_id: String,
        reply: ActorReply,
    },
    Stop,
}
struct DiagnosticJob {
    version: i64,
    due: Instant,
    remaining: usize,
    items: Vec<Value>,
    failed: bool,
}
struct Pending {
    external: String,
    uri: String,
    version: i64,
    deadline: Instant,
    model_generation: u64,
    reply: ActorReply,
}

impl LanguageServiceManager {
    pub(crate) fn prepare(
        &self,
        subject: LanguageSubject,
        package: LanguagePackage,
    ) -> Result<String, String> {
        let mut reviews = self
            .reviews
            .lock()
            .map_err(|_| "language review lock unavailable")?;
        reviews.retain(|_, value| value.expires > Instant::now());
        if reviews.len() >= 32 {
            return Err("language review limit exceeded".into());
        }
        let id = format!(
            "language-review-{}-{}",
            std::process::id(),
            self.sequence.fetch_add(1, Ordering::Relaxed)
        );
        reviews.insert(
            id.clone(),
            Review {
                subject,
                package,
                expires: Instant::now() + Duration::from_secs(60),
                authority: self.authority.load(Ordering::SeqCst),
            },
        );
        Ok(id)
    }
    pub(crate) fn consume(
        &self,
        id: &str,
        subject: &LanguageSubject,
        package: &LanguagePackage,
    ) -> Result<u64, String> {
        let mut reviews = self
            .reviews
            .lock()
            .map_err(|_| "language review lock unavailable")?;
        let review = reviews
            .get(id)
            .ok_or("language execution review is missing or expired")?;
        if review.subject != *subject
            || review.package != *package
            || review.expires <= Instant::now()
            || review.authority != self.authority.load(Ordering::SeqCst)
        {
            return Err(
                "language execution review no longer matches the workspace, package or executable"
                    .into(),
            );
        }
        let authority = review.authority;
        reviews.remove(id);
        Ok(authority)
    }
    #[cfg(test)]
    pub(crate) fn start(
        &self,
        subject: LanguageSubject,
        package: LanguagePackage,
        authority: u64,
        allowed: Arc<dyn Fn() -> bool + Send + Sync>,
        emit: Arc<dyn Fn(LanguageServiceEvent) + Send + Sync>,
    ) -> Result<String, String> {
        self.start_with_models(subject, package, authority, allowed, emit, None)
    }
    pub(crate) fn start_with_models(
        &self,
        subject: LanguageSubject,
        package: LanguagePackage,
        authority: u64,
        allowed: Arc<dyn Fn() -> bool + Send + Sync>,
        emit: Arc<dyn Fn(LanguageServiceEvent) + Send + Sync>,
        model_access: Option<ModelAccess>,
    ) -> Result<String, String> {
        let mut starting = self
            .starting
            .lock()
            .map_err(|_| "language startup lock unavailable")?;
        let startup_key = format!(
            "{}:{}:{}",
            subject.owner,
            subject.activation,
            package.server_id()
        );
        let active_count = self
            .sessions
            .lock()
            .map_err(|_| "language session lock unavailable")?
            .values()
            .filter(|session| {
                session.subject.owner != subject.owner || session.profile != package.server_id()
            })
            .count();
        if active_count + starting.len() >= 8 {
            return Err("language service session limit reached".into());
        }
        if !starting.insert(startup_key.clone()) {
            return Err("language service is already starting for this window".into());
        }
        drop(starting);
        struct Startup<'a> {
            owners: &'a Mutex<HashSet<String>>,
            owner: String,
        }
        impl Drop for Startup<'_> {
            fn drop(&mut self) {
                if let Ok(mut owners) = self.owners.lock() {
                    owners.remove(&self.owner);
                }
            }
        }
        let _startup = Startup {
            owners: &self.starting,
            owner: startup_key,
        };
        let closing = self.closing.clone();
        let current_authority = self.authority.clone();
        let allowed: Arc<dyn Fn() -> bool + Send + Sync> = Arc::new(move || {
            !closing.load(Ordering::SeqCst)
                && current_authority.load(Ordering::SeqCst) == authority
                && allowed()
        });
        if !allowed() {
            return Err("language service authority was revoked".into());
        }
        let profile = package.server_id().to_owned();
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.retain(|_, session| {
                if session.subject.owner == subject.owner && session.profile == profile {
                    let _ = session.control.try_send(ActorCommand::Stop);
                    terminate_process_tree(session.pid);
                    false
                } else {
                    true
                }
            });
            if sessions.len() >= 8 {
                return Err("language service session limit reached".into());
            }
        }
        let selectors = package
            .packaged
            .as_ref()
            .map(|profile| profile.selectors.clone());
        let mut cache = None;
        let mut process = if let Some(mut profile) = package.packaged {
            std::fs::create_dir_all(&profile.cache_parent)
                .map_err(|_| "language cache unavailable")?;
            let directory = tempfile::Builder::new()
                .prefix("session-")
                .tempdir_in(&profile.cache_parent)
                .map_err(|_| "language cache unavailable")?;
            profile.initialization_options["analysis"]["stateDirectory"] = json!(directory.path());
            let process = LanguageServiceProcess::start_packaged(&profile);
            cache = Some(directory);
            process
        } else {
            match package.rust.as_ref() {
                Some(rust) => LanguageServiceProcess::start_rust(rust),
                None => LanguageServiceProcess::start(&TypeScriptServerProfile {
                    package_root: package.root,
                    node: package.node,
                }),
            }
        }
        .map_err(safe_error)?;
        let pid = process.pid();
        let root_uri = url::Url::from_directory_path(&subject.root)
            .map_err(|_| "invalid workspace URI")?
            .to_string();
        process.initialize(&root_uri).map_err(safe_error)?;
        if !allowed() {
            return Err("language service authority was revoked during startup".into());
        }
        let id = format!(
            "language-session-{}-{}",
            std::process::id(),
            self.sequence.fetch_add(1, Ordering::Relaxed)
        );
        let (control, receiver) = mpsc::sync_channel(16);
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "language session lock unavailable")?;
        // Serialize admission with revocation: a startup may never reinsert itself after disable.
        if !allowed() {
            return Err("language service authority was revoked during startup".into());
        }
        sessions.insert(
            id.clone(),
            Session {
                subject: subject.clone(),
                control,
                pid,
                profile,
            },
        );
        drop(sessions);
        let actor_id = id.clone();
        std::thread::spawn(move || {
            let _cache = cache;
            actor(
                actor_id,
                subject,
                process,
                receiver,
                allowed,
                emit,
                ActorServices {
                    selectors,
                    model_access,
                },
            );
        });
        Ok(id)
    }
    fn send(
        &self,
        id: &str,
        subject: &LanguageSubject,
        command: ActorCommand,
    ) -> Result<(), String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "language session lock unavailable")?;
        let session = sessions.get(id).ok_or("language session has ended")?;
        if session.subject != *subject {
            return Err("language session does not belong to this workspace/window".into());
        }
        session
            .control
            .try_send(command)
            .map_err(|_| "language service command queue unavailable".into())
    }
    pub(crate) fn open(
        &self,
        id: &str,
        subject: &LanguageSubject,
        uri: String,
        language: String,
        version: i64,
        text: String,
    ) -> Result<Receiver<Result<Value, String>>, String> {
        let (reply, rx) = mpsc::channel();
        self.send(
            id,
            subject,
            ActorCommand::Open {
                uri,
                language,
                version,
                text,
                reply,
            },
        )?;
        Ok(rx)
    }
    pub(crate) fn change(
        &self,
        id: &str,
        subject: &LanguageSubject,
        uri: String,
        version: i64,
        changes: Vec<TextChange>,
    ) -> Result<Receiver<Result<Value, String>>, String> {
        let (reply, rx) = mpsc::channel();
        self.send(
            id,
            subject,
            ActorCommand::Change {
                uri,
                version,
                changes,
                reply,
            },
        )?;
        Ok(rx)
    }
    pub(crate) fn close(
        &self,
        id: &str,
        subject: &LanguageSubject,
        uri: String,
    ) -> Result<Receiver<Result<Value, String>>, String> {
        let (reply, rx) = mpsc::channel();
        self.send(id, subject, ActorCommand::Close { uri, reply })?;
        Ok(rx)
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn request(
        &self,
        id: &str,
        subject: &LanguageSubject,
        uri: String,
        version: i64,
        request_id: String,
        feature: String,
        position: TextPosition,
    ) -> Result<Receiver<Result<Value, String>>, String> {
        let (reply, rx) = mpsc::channel();
        self.send(
            id,
            subject,
            ActorCommand::Request {
                uri,
                version,
                request_id,
                feature,
                position,
                reply,
            },
        )?;
        Ok(rx)
    }
    pub(crate) fn cancel(
        &self,
        id: &str,
        subject: &LanguageSubject,
        request_id: String,
    ) -> Result<Receiver<Result<Value, String>>, String> {
        let (reply, rx) = mpsc::channel();
        self.send(id, subject, ActorCommand::Cancel { request_id, reply })?;
        Ok(rx)
    }
    pub(crate) fn stop(&self, id: &str, subject: &LanguageSubject) -> Result<bool, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "language session lock unavailable")?;
        let Some(session) = sessions.get(id) else {
            return Ok(false);
        };
        if session.subject != *subject {
            return Err("language session owner mismatch".into());
        }
        let session = sessions.remove(id).expect("checked session");
        let _ = session.control.try_send(ActorCommand::Stop);
        terminate_process_tree(session.pid);
        Ok(true)
    }
    pub(crate) fn cancel_owner(&self, owner: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.retain(|_, session| {
                if session.subject.owner != owner {
                    return true;
                }
                let _ = session.control.try_send(ActorCommand::Stop);
                terminate_process_tree(session.pid);
                false
            });
        }
        if let Ok(mut reviews) = self.reviews.lock() {
            reviews.retain(|_, review| review.subject.owner != owner);
        }
    }
    pub(crate) fn finished(&self, id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(id);
        }
    }
    pub(crate) fn stop_sessions(&self) {
        self.authority.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, session) in sessions.drain() {
                let _ = session.control.try_send(ActorCommand::Stop);
                terminate_process_tree(session.pid);
            }
        }
        if let Ok(mut reviews) = self.reviews.lock() {
            reviews.clear();
        }
    }
    pub(crate) fn cancel_all(&self) {
        self.closing.store(true, Ordering::SeqCst);
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, session) in sessions.drain() {
                let _ = session.control.try_send(ActorCommand::Stop);
                terminate_process_tree(session.pid);
            }
        }
        if let Ok(mut reviews) = self.reviews.lock() {
            reviews.clear();
        }
    }
}
impl Drop for LanguageServiceManager {
    fn drop(&mut self) {
        self.cancel_all();
    }
}
fn safe_error(error: impl std::fmt::Debug) -> String {
    format!("language service transport failed: {error:?}")
}

/// Canonical file identities only: symlinks leaving this workspace and URL aliases are rejected.
pub(crate) fn document_path(root: &Path, uri: &str) -> Result<PathBuf, String> {
    if uri.len() > 16384 {
        return Err("document URI exceeds bound".into());
    }
    let url = url::Url::parse(uri).map_err(|_| "invalid document URI")?;
    if url.scheme() != "file" || url.query().is_some() || url.fragment().is_some() {
        return Err("unsupported document URI".into());
    }
    let path = url.to_file_path().map_err(|_| "invalid file URI")?;
    let canonical = path
        .canonicalize()
        .map_err(|_| "language document must exist in the active workspace")?;
    if !canonical.starts_with(root)
        || canonical == root
        || canonical != path
        || !canonical.is_file()
    {
        return Err("language document is outside the workspace or uses a path alias".into());
    }
    Ok(canonical)
}
fn document_language(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()? {
        "ts" | "mts" | "cts" => Some("typescript"),
        "tsx" => Some("typescriptreact"),
        "js" | "mjs" | "cjs" => Some("javascript"),
        "jsx" => Some("javascriptreact"),
        "rs" => Some("rust"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reviews_are_one_time_and_bind_owner_activation_package() {
        let manager = LanguageServiceManager::default();
        let subject = LanguageSubject {
            owner: "one".into(),
            root: "/root".into(),
            activation: 1,
        };
        let package = LanguagePackage {
            version: "1".into(),
            digest: "d".into(),
            content_digest: "c".into(),
            root: "/package".into(),
            node: "/node".into(),
            node_digest: "n".into(),
            rust: None,
            packaged: None,
        };
        let id = manager.prepare(subject.clone(), package.clone()).unwrap();
        assert!(
            manager
                .consume(
                    &id,
                    &LanguageSubject {
                        owner: "two".into(),
                        ..subject.clone()
                    },
                    &package
                )
                .is_err()
        );
        assert!(
            manager
                .consume(
                    &id,
                    &LanguageSubject {
                        activation: 2,
                        ..subject.clone()
                    },
                    &package
                )
                .is_err()
        );
        assert!(
            manager
                .consume(
                    &id,
                    &subject,
                    &LanguagePackage {
                        node_digest: "changed".into(),
                        ..package.clone()
                    }
                )
                .is_err()
        );
        let authority = manager.consume(&id, &subject, &package).unwrap();
        assert!(manager.consume(&id, &subject, &package).is_err());
        manager.stop_sessions();
        let error = manager
            .start(
                subject.clone(),
                package.clone(),
                authority,
                Arc::new(|| true),
                Arc::new(|_| {}),
            )
            .unwrap_err();
        assert!(error.contains("authority was revoked"));
        assert!(manager.sessions.lock().unwrap().is_empty());
        assert!(!manager.closing.load(Ordering::SeqCst));
        let renewed = manager.prepare(subject.clone(), package.clone()).unwrap();
        assert_ne!(
            manager.consume(&renewed, &subject, &package).unwrap(),
            authority
        );
    }
    #[test]
    fn actor_cancellation_bypasses_a_stalled_request_and_rejects_foreign_owners() {
        let Ok(node) = std::env::var("ASTERLYN_LANGUAGE_SERVICE_NODE") else {
            eprintln!("actor cancellation fixture requires ASTERLYN_LANGUAGE_SERVICE_NODE");
            return;
        };
        let package = tempfile::tempdir().unwrap();
        let servers = package.path().join("servers/typescript");
        std::fs::create_dir_all(servers.join("typescript/lib")).unwrap();
        std::fs::write(servers.join("typescript/lib/tsserver.js"), "").unwrap();
        std::fs::write(servers.join("server.mjs"),r#"let buffer=Buffer.alloc(0);process.stdin.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(true){const end=buffer.indexOf('\r\n\r\n');if(end<0)return;const size=Number(buffer.subarray(0,end).toString().match(/Content-Length: (\d+)/i)[1]);if(buffer.length<end+4+size)return;const m=JSON.parse(buffer.subarray(end+4,end+4+size));buffer=buffer.subarray(end+4+size);if(m.id===undefined||m.method==='textDocument/hover')continue;const result=m.method==='initialize'?{capabilities:{positionEncoding:'utf-16'}}:m.method==='workspace/executeCommand'?{body:[]}:[];const out=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));process.stdout.write('Content-Length: '+out.length+'\r\n\r\n');process.stdout.write(out);}});"#).unwrap();
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let file = root.join("a.ts");
        std::fs::write(&file, "let x=1").unwrap();
        let uri = url::Url::from_file_path(file).unwrap().to_string();
        let manager = LanguageServiceManager::default();
        let owner = LanguageSubject {
            owner: "owner".into(),
            root,
            activation: 1,
        };
        let identity = LanguagePackage {
            version: "test".into(),
            digest: "test".into(),
            content_digest: "test".into(),
            root: package.path().to_owned(),
            node: PathBuf::from(node),
            node_digest: "test".into(),
            rust: None,
            packaged: None,
        };
        let id = manager
            .start(
                owner.clone(),
                identity,
                0,
                Arc::new(|| true),
                Arc::new(|_| {}),
            )
            .unwrap();
        manager
            .open(
                &id,
                &owner,
                uri.clone(),
                "typescript".into(),
                1,
                "let x=1".into(),
            )
            .unwrap()
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap();
        let hover = manager
            .request(
                &id,
                &owner,
                uri.clone(),
                1,
                "stalled".into(),
                "hover".into(),
                TextPosition {
                    line: 0,
                    character: 0,
                },
            )
            .unwrap();
        let started = Instant::now();
        let fast = manager
            .request(
                &id,
                &owner,
                uri.clone(),
                1,
                "fast".into(),
                "definition".into(),
                TextPosition {
                    line: 0,
                    character: 0,
                },
            )
            .unwrap();
        assert_eq!(
            fast.recv_timeout(Duration::from_secs(2)).unwrap().unwrap(),
            json!([])
        );
        assert!(
            manager
                .cancel(&id, &owner, "stalled".into())
                .unwrap()
                .recv_timeout(Duration::from_secs(1))
                .unwrap()
                .unwrap()
                .as_bool()
                .unwrap()
        );
        assert!(hover.recv_timeout(Duration::from_secs(1)).unwrap().is_err());
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(
            manager
                .stop(
                    &id,
                    &LanguageSubject {
                        owner: "foreign".into(),
                        ..owner.clone()
                    }
                )
                .is_err()
        );
        manager.stop(&id, &owner).unwrap();
    }
    #[test]
    fn actual_actor_orders_unsaved_diagnostics_requests_and_cleanup() {
        let Ok(package_root) = std::env::var("ASTERLYN_LSP_PACKAGE_ROOT") else {
            eprintln!("real language actor fixture requires ASTERLYN_LSP_PACKAGE_ROOT");
            return;
        };
        let node = std::env::var("ASTERLYN_LANGUAGE_SERVICE_NODE")
            .unwrap_or_else(|_| "/opt/homebrew/bin/node".into());
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let file = root.join("sample.ts");
        std::fs::write(&file, "export {};\n").unwrap();
        let uri = url::Url::from_file_path(&file).unwrap().to_string();
        let manager = LanguageServiceManager::default();
        let subject = LanguageSubject {
            owner: "actor-test".into(),
            root,
            activation: 7,
        };
        let package = LanguagePackage {
            version: "0.1.0".into(),
            digest: "fixture".into(),
            content_digest: "fixture".into(),
            root: PathBuf::from(package_root),
            node: PathBuf::from(node),
            node_digest: "fixture".into(),
            rust: None,
            packaged: None,
        };
        let alive = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let allowed_alive = alive.clone();
        let (tx, events) = mpsc::channel();
        let started = Instant::now();
        let id = manager
            .start(
                subject.clone(),
                package,
                0,
                Arc::new(move || allowed_alive.load(Ordering::SeqCst)),
                Arc::new(move |event| {
                    let _ = tx.send(event);
                }),
            )
            .unwrap();
        let wait = |rx: Receiver<Result<Value, String>>| {
            rx.recv_timeout(Duration::from_secs(12)).unwrap().unwrap()
        };
        wait(
            manager
                .open(
                    &id,
                    &subject,
                    uri.clone(),
                    "typescript".into(),
                    1,
                    "const marker = '😀';\nconst value: string = 1;\nvalue;\n".into(),
                )
                .unwrap(),
        );
        let hover = manager
            .request(
                &id,
                &subject,
                uri.clone(),
                1,
                "hover".into(),
                "hover".into(),
                TextPosition {
                    line: 2,
                    character: 2,
                },
            )
            .unwrap();
        assert!(wait(hover).get("contents").is_some());
        let references = wait(
            manager
                .request(
                    &id,
                    &subject,
                    uri.clone(),
                    1,
                    "references".into(),
                    "references".into(),
                    TextPosition {
                        line: 1,
                        character: 7,
                    },
                )
                .unwrap(),
        );
        let uses = references.as_array().unwrap();
        assert_eq!(uses.len(), 1, "native references exclude the declaration");
        assert_eq!(uses[0]["range"]["start"]["line"], json!(2));
        let deadline = Instant::now() + Duration::from_secs(12);
        let mut got_error = false;
        while Instant::now() < deadline {
            if let Ok(event) = events.recv_timeout(Duration::from_millis(100))
                && event.kind == "diagnostics"
                && event.version == Some(1)
            {
                got_error = event
                    .diagnostics
                    .unwrap()
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|d| d.get("code") == Some(&json!(2322)));
                break;
            }
        }
        assert!(
            got_error,
            "request-correlated diagnostics must include unsaved type error"
        );
        wait(
            manager
                .change(
                    &id,
                    &subject,
                    uri.clone(),
                    2,
                    vec![TextChange {
                        range: None,
                        text: "const marker = '😀';\nconst value: string = 'ok';\nvalue;\n".into(),
                    }],
                )
                .unwrap(),
        );
        let deadline = Instant::now() + Duration::from_secs(12);
        let mut got_clean = false;
        while Instant::now() < deadline {
            if let Ok(event) = events.recv_timeout(Duration::from_millis(100))
                && event.kind == "diagnostics"
                && event.version == Some(2)
            {
                got_clean = event.diagnostics.unwrap().as_array().unwrap().is_empty();
                break;
            }
        }
        assert!(got_clean, "fixed unsaved version must clear diagnostics");
        assert!(
            manager
                .request(
                    &id,
                    &LanguageSubject {
                        owner: "intruder".into(),
                        ..subject.clone()
                    },
                    uri.clone(),
                    2,
                    "bad".into(),
                    "hover".into(),
                    TextPosition {
                        line: 0,
                        character: 0
                    }
                )
                .is_err()
        );
        let stale = manager
            .request(
                &id,
                &subject,
                uri.clone(),
                1,
                "old".into(),
                "hover".into(),
                TextPosition {
                    line: 0,
                    character: 0,
                },
            )
            .unwrap();
        assert!(stale.recv_timeout(Duration::from_secs(1)).unwrap().is_err());
        alive.store(false, Ordering::SeqCst);
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut terminated = false;
        while Instant::now() < deadline {
            if let Ok(event) = events.recv_timeout(Duration::from_millis(100))
                && event.kind == "terminated"
            {
                terminated = true;
                break;
            }
        }
        assert!(
            terminated,
            "revocation must stop actor within finite deadline"
        );
        eprintln!(
            "native language actor actual-server acceptance: {}ms",
            started.elapsed().as_millis()
        );
    }
    #[test]
    fn rejects_uri_aliases_and_escape() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let file = root.join("a.ts");
        std::fs::write(&file, "let x=1").unwrap();
        let uri = url::Url::from_file_path(&file).unwrap().to_string();
        assert_eq!(document_path(&root, &uri).unwrap(), file);
        assert!(document_path(&root, &format!("{uri}?x=1")).is_err());
        assert!(document_path(&root, "https://example.org/a.ts").is_err());
        assert!(document_path(&root, "file:///etc/passwd").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc/passwd", root.join("outside.ts")).unwrap();
            assert!(
                document_path(
                    &root,
                    url::Url::from_file_path(root.join("outside.ts"))
                        .unwrap()
                        .as_ref()
                )
                .is_err()
            );
        }
    }
}

#[cfg(test)]
#[path = "language_service_rust_tests.rs"]
mod rust_tests;

#[cfg(test)]
#[path = "language_service_packaged_tests.rs"]
mod packaged_tests;
