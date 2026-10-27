use asterlyn_plugin_analysis::*;
use asterlyn_plugin_dependencies::{DependencyNode, PluginDependency};
use asterlyn_plugin_models::*;
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

struct Fixture {
    directory: tempfile::TempDir,
    package: tempfile::TempDir,
    workspace: tempfile::TempDir,
    node: PathBuf,
    snapshot: Arc<Mutex<AuthoritySnapshot>>,
    grant: ModelGrant,
}
impl Fixture {
    fn new(script: &str) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let package = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        std::fs::write(package.path().join("model.mjs"), script).unwrap();
        let node = std::process::Command::new("node")
            .args(["-p", "process.execPath"])
            .output()
            .expect("model runtime tests require Node");
        assert!(node.status.success());
        let node = PathBuf::from(String::from_utf8(node.stdout).unwrap().trim());
        let identity = |id: &str| PackageIdentity {
            id: id.into(),
            version: "1.0.0".into(),
            archive_digest: content_digest(id.as_bytes()),
            content_digest: content_digest(b"contents"),
        };
        let producer = identity("producer");
        let consumer = identity("consumer");
        let nodes = vec![
            DependencyNode {
                id: producer.id.clone(),
                versions: vec![producer.version.clone()],
                enabled: true,
                available: true,
                dependencies: vec![],
            },
            DependencyNode {
                id: consumer.id.clone(),
                versions: vec![consumer.version.clone()],
                enabled: true,
                available: true,
                dependencies: vec![PluginDependency {
                    id: producer.id.clone(),
                    minimum: "1.0.0".into(),
                    maximum_exclusive: None,
                }],
            },
        ];
        let scope = Scope {
            owner: "window".into(),
            activation: 1,
            workspace_digest: content_digest(b"workspace"),
        };
        let key = ModelKey {
            scope: scope.clone(),
            producer: producer.clone(),
            service: "model".into(),
            schema: 1,
            build_root_digest: content_digest(b"build"),
            input_digest: content_digest(b"inputs"),
            selection_digest: content_digest(b"debug"),
            tool_digest: content_digest(b"tool"),
        };
        let snapshot = AuthoritySnapshot {
            nodes,
            packages: vec![producer.clone(), consumer.clone()],
            scope,
            services: vec![ProvidedService {
                producer,
                id: "model".into(),
                schema: 1,
            }],
        };
        let grant = ModelGrant::admit(&snapshot.view(), consumer, key).unwrap();
        Self {
            directory,
            package,
            workspace,
            node,
            snapshot: Arc::new(Mutex::new(snapshot)),
            grant,
        }
    }
    fn program(&self) -> AdmittedProgram {
        AdmittedProgram::new(
            &self.node,
            self.package.path(),
            "model.mjs",
            self.workspace.path(),
            BTreeMap::new(),
            b"{}".to_vec(),
        )
        .unwrap()
    }
    fn authority(&self) -> AuthorityReader {
        let snapshot = self.snapshot.clone();
        Arc::new(move || Ok(snapshot.lock().unwrap().clone()))
    }
}

#[test]
fn simultaneous_consumers_share_one_sealed_artifact_and_last_lease_removes_it() {
    let f = Fixture::new("setTimeout(()=>process.stdout.write(JSON.stringify({model:1})),150)");
    let runtime = Arc::new(AnalysisRuntime::new(f.directory.path()).unwrap());
    let first_runtime = runtime.clone();
    let grant = f.grant.clone();
    let program = f.program();
    let authority = f.authority();
    let first = std::thread::spawn(move || {
        first_runtime
            .acquire(
                grant,
                program,
                authority,
                Arc::new(|| true),
                Arc::new(|_| {}),
            )
            .unwrap()
    });
    let second = runtime
        .acquire(
            f.grant.clone(),
            f.program(),
            f.authority(),
            Arc::new(|| true),
            Arc::new(|_| {}),
        )
        .unwrap();
    let first = first.join().unwrap();
    assert_eq!(first.reference, second.reference);
    assert_eq!(first.artifact.path(), second.artifact.path());
    assert!(
        first
            .artifact
            .path()
            .metadata()
            .unwrap()
            .permissions()
            .readonly()
    );
    let path = second.artifact.path().to_owned();
    drop(first);
    second.artifact.verify().unwrap();
    drop(second);
    assert!(!path.exists());
    let root = runtime.cache_directory();
    drop(runtime);
    assert!(!root.exists());
}

#[test]
fn producer_revocation_discards_output_and_cleans_staging() {
    let f = Fixture::new("setTimeout(()=>process.stdout.write('{}'),250)");
    let runtime = AnalysisRuntime::new(f.directory.path()).unwrap();
    let snapshot = f.snapshot.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(60));
        snapshot.lock().unwrap().nodes[0].enabled = false;
    });
    assert!(
        runtime
            .acquire(
                f.grant.clone(),
                f.program(),
                f.authority(),
                Arc::new(|| true),
                Arc::new(|_| {})
            )
            .is_err()
    );
    let deadline = Instant::now() + Duration::from_secs(2);
    while std::fs::read_dir(runtime.cache_directory())
        .unwrap()
        .next()
        .is_some()
        && Instant::now() < deadline
    {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(
        std::fs::read_dir(runtime.cache_directory())
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn floods_invalid_json_and_nonzero_exit_never_publish_artifacts() {
    for script in [
        "process.stdout.write('x'.repeat(9*1024*1024))",
        "process.stdout.write('not-json')",
        "process.stdout.write('{}');process.exitCode=3",
    ] {
        let f = Fixture::new(script);
        let runtime = AnalysisRuntime::new(f.directory.path()).unwrap();
        assert!(
            runtime
                .acquire(
                    f.grant.clone(),
                    f.program(),
                    f.authority(),
                    Arc::new(|| true),
                    Arc::new(|_| {})
                )
                .is_err()
        );
    }
}

#[test]
fn cancellation_interrupts_work_and_progress_cannot_leak_raw_stderr_or_break_execution() {
    let f = Fixture::new(
        "process.stderr.write('secret-environment-value\\n');process.stderr.write(JSON.stringify({stage:'model.ready',count:1,message:'secret-source'})+'\\n');process.stdout.write('{}')",
    );
    let events = Arc::new(Mutex::new(Vec::new()));
    let seen = events.clone();
    let runtime = AnalysisRuntime::new(f.directory.path()).unwrap();
    let result = runtime
        .acquire(
            f.grant.clone(),
            f.program(),
            f.authority(),
            Arc::new(|| true),
            Arc::new(move |event| seen.lock().unwrap().push(event)),
        )
        .unwrap();
    assert_eq!(result.artifact.bytes(), 2);
    std::thread::sleep(Duration::from_millis(30));
    let events = events.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].stage, "model.ready");
    drop(events);
    drop(result);
    let f = Fixture::new("setInterval(()=>{},1000)");
    let runtime = AnalysisRuntime::new(f.directory.path()).unwrap();
    let allowed = Arc::new(AtomicBool::new(true));
    let cancel = allowed.clone();
    let check = allowed.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(80));
        cancel.store(false, Ordering::SeqCst);
    });
    let started = Instant::now();
    assert!(
        runtime
            .acquire(
                f.grant.clone(),
                f.program(),
                f.authority(),
                Arc::new(move || check.load(Ordering::SeqCst)),
                Arc::new(|_| {})
            )
            .is_err()
    );
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[test]
fn runtime_overrides_and_tampered_sealed_files_are_rejected() {
    let f = Fixture::new("process.stdout.write('{\"value\":1}')");
    let mut environment = BTreeMap::new();
    environment.insert("NODE_OPTIONS".into(), "--import /unreviewed.mjs".into());
    assert!(
        AdmittedProgram::new(
            &f.node,
            f.package.path(),
            "model.mjs",
            f.workspace.path(),
            environment,
            b"{}".to_vec()
        )
        .is_err()
    );
    let runtime = AnalysisRuntime::new(f.directory.path()).unwrap();
    let result = runtime
        .acquire(
            f.grant.clone(),
            f.program(),
            f.authority(),
            Arc::new(|| true),
            Arc::new(|_| {}),
        )
        .unwrap();
    let mut permissions = std::fs::metadata(result.artifact.path())
        .unwrap()
        .permissions();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        permissions.set_mode(0o600);
    }
    #[cfg(windows)]
    permissions.set_readonly(false);
    std::fs::set_permissions(result.artifact.path(), permissions).unwrap();
    std::fs::write(result.artifact.path(), "{\"value\":2}").unwrap();
    let mut permissions = std::fs::metadata(result.artifact.path())
        .unwrap()
        .permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(result.artifact.path(), permissions).unwrap();
    assert!(result.artifact.verify().is_err());
}

#[test]
fn shutdown_signals_the_owned_process_and_releases_the_job() {
    let f = Fixture::new(
        "import fs from 'node:fs';process.on('SIGTERM',()=>{fs.writeFileSync('cancel-marker','stopped');process.exit(0)});process.stderr.write(JSON.stringify({stage:'running'})+'\\n');setInterval(()=>{},1000)",
    );
    let runtime = Arc::new(AnalysisRuntime::new(f.directory.path()).unwrap());
    let current = runtime.clone();
    let grant = f.grant.clone();
    let program = f.program();
    let authority = f.authority();
    let (tx, ready) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        current.acquire(
            grant,
            program,
            authority,
            Arc::new(|| true),
            Arc::new(move |_| {
                let _ = tx.send(());
            }),
        )
    });
    ready.recv_timeout(Duration::from_secs(3)).unwrap();
    let began = Instant::now();
    runtime.cancel_all();
    assert!(worker.join().unwrap().is_err());
    assert!(began.elapsed() < Duration::from_secs(2));
    assert_eq!(
        std::fs::read_to_string(f.workspace.path().join("cancel-marker")).unwrap(),
        "stopped"
    );
}

#[cfg(unix)]
#[test]
fn shutdown_force_kills_a_process_that_ignores_sigterm() {
    let f = Fixture::new(
        "import fs from 'node:fs';fs.writeFileSync('pid',String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)",
    );
    let runtime = Arc::new(AnalysisRuntime::new(f.directory.path()).unwrap());
    let current = runtime.clone();
    let grant = f.grant.clone();
    let program = f.program();
    let authority = f.authority();
    let worker = std::thread::spawn(move || {
        current.acquire(
            grant,
            program,
            authority,
            Arc::new(|| true),
            Arc::new(|_| {}),
        )
    });
    let pid_path = f.workspace.path().join("pid");
    let deadline = Instant::now() + Duration::from_secs(3);
    while !pid_path.exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    let deadline = Instant::now() + Duration::from_secs(3);
    let pid: i32 = loop {
        if let Ok(value) = std::fs::read_to_string(&pid_path)
            && let Ok(pid) = value.trim().parse()
        {
            break pid;
        }
        assert!(Instant::now() < deadline, "model PID was not written");
        std::thread::sleep(Duration::from_millis(10));
    };
    runtime.cancel_all();
    assert!(worker.join().unwrap().is_err());
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        let alive = unsafe { libc::kill(pid, 0) == 0 };
        if !alive {
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("SIGTERM-ignoring model process remained alive: {pid}");
}

#[test]
fn launch_guard_runs_only_when_a_new_worker_is_spawned() {
    let f = Fixture::new("process.stdout.write('{}')");
    let runtime = AnalysisRuntime::new(f.directory.path()).unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let guard = {
        let calls = calls.clone();
        Arc::new(move || {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
    };
    let first = runtime
        .acquire(
            f.grant.clone(),
            f.program().with_launch_guard(guard.clone()),
            f.authority(),
            Arc::new(|| true),
            Arc::new(|_| {}),
        )
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let second = runtime
        .acquire(
            f.grant.clone(),
            f.program().with_launch_guard(guard),
            f.authority(),
            Arc::new(|| true),
            Arc::new(|_| {}),
        )
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    drop(second);
    drop(first);
}

#[test]
fn launch_guard_failure_prevents_child_spawn() {
    let f = Fixture::new("process.stdout.write('{}')");
    let runtime = AnalysisRuntime::new(f.directory.path()).unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let guard = {
        let calls = calls.clone();
        Arc::new(move || {
            calls.fetch_add(1, Ordering::SeqCst);
            Err("guard rejected launch".into())
        })
    };
    let result = runtime.acquire(
        f.grant.clone(),
        f.program().with_launch_guard(guard),
        f.authority(),
        Arc::new(|| true),
        Arc::new(|_| {}),
    );
    assert!(result.is_err());
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn a_ready_handle_rechecks_producer_authority_without_a_new_model_request() {
    let f = Fixture::new("process.stdout.write('{}')");
    let runtime = AnalysisRuntime::new(f.directory.path()).unwrap();
    let handle = runtime
        .acquire(
            f.grant.clone(),
            f.program(),
            f.authority(),
            Arc::new(|| true),
            Arc::new(|_| {}),
        )
        .unwrap();
    assert!(handle.is_current());
    f.snapshot.lock().unwrap().nodes[0].enabled = false;
    assert!(!handle.is_current());
}
