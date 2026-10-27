use super::*;

pub(super) fn actor(
    id: String,
    subject: LanguageSubject,
    mut process: LanguageServiceProcess,
    receiver: Receiver<ActorCommand>,
    allowed: Arc<dyn Fn() -> bool + Send + Sync>,
    emit: Arc<dyn Fn(LanguageServiceEvent) + Send + Sync>,
    services: ActorServices,
) {
    let ActorServices {
        selectors,
        model_access,
    } = services;
    let alive = Arc::new(AtomicBool::new(true));
    struct Alive(Arc<AtomicBool>);
    impl Drop for Alive {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
    let _alive = Alive(alive.clone());
    let (model_sender, model_receiver) = mpsc::sync_channel::<Result<ModelReply, String>>(1);
    let mut model_pending: Option<asterlyn_language_service::JsonRpcRequest> = None;
    let mut model_resource: Option<Box<dyn ModelResource>> = None;
    let mut model_generation = 0;
    let mut last_diagnostic_refresh = Instant::now() - Duration::from_secs(1);
    let mut last_model_request = Instant::now() - Duration::from_secs(1);
    let packaged = process.profile_id() == "packaged";
    let rust = process.profile_id() == "rust-analyzer";
    let pull = (rust || packaged) && process.supports_diagnostic_pull();
    let diagnostics = if packaged {
        DiagnosticProfile::standard(pull)
    } else {
        DiagnosticProfile::new(rust, pull)
    };
    let request_timeout = if rust || packaged {
        Duration::from_secs(30)
    } else {
        REQUEST_TIMEOUT
    };
    let mut rust_ready = !rust && !packaged;
    let mut documents = HashMap::<String, DocumentState>::new();
    let mut pending = BTreeMap::<u64, Pending>::new();
    let mut diagnostic_pending = HashMap::<u64, (String, i64, Instant)>::new();
    let mut diagnostic_jobs = HashMap::<String, DiagnosticJob>::new();
    let mut authority_check = Instant::now();
    'session: loop {
        if authority_check.elapsed() >= Duration::from_millis(250) {
            if !allowed() {
                break;
            }
            if model_resource
                .as_ref()
                .is_some_and(|resource| !resource.is_current())
            {
                model_resource = None;
                model_generation += 1;
                rust_ready = false;
                if process
                    .notify("asterlyn/modelInvalidated", Some(json!({})))
                    .is_err()
                {
                    break;
                }
            }
            authority_check = Instant::now();
        }
        if let Ok(result) = model_receiver.try_recv()
            && let Some(request) = model_pending.take()
        {
            let value = match result {
                Ok(reply) if reply.resource.is_current() => {
                    if model_resource
                        .as_ref()
                        .is_none_or(|old| old.generation() != reply.resource.generation())
                    {
                        model_generation += 1;
                    }
                    model_resource = Some(reply.resource);
                    Ok(reply.value)
                }
                _ => Err("workspace model is no longer current".into()),
            };
            if process.reply_to_server(request.id, value).is_err() {
                break;
            }
        }
        for _ in 0..32 {
            match process.poll_event() {
                Ok(Some(ServerEvent::Message(JsonRpcMessage::Response(response)))) => {
                    process.accept_response(&response);
                    if let JsonRpcId::Number(number) = response.id {
                        if let Some((uri, version, _)) = diagnostic_pending.remove(&number)
                            && let (Some(doc), Some(job)) =
                                (documents.get(&uri), diagnostic_jobs.get_mut(&uri))
                            && doc.version == version
                            && job.version == version
                        {
                            if response.error.is_none() {
                                if let Some(body) = response
                                    .result
                                    .as_ref()
                                    .and_then(|v| v.get(diagnostics.body_key()))
                                    .and_then(Value::as_array)
                                {
                                    for diagnostic in
                                        body.iter().take(512 - job.items.len().min(512))
                                    {
                                        if let Some(item) = diagnostics.item(&doc.text, diagnostic)
                                        {
                                            job.items.push(item);
                                        }
                                    }
                                } else {
                                    job.failed = true
                                }
                            } else {
                                job.failed = true
                            }
                            job.remaining = job.remaining.saturating_sub(1);
                            if job.remaining == 0 && !job.failed {
                                emit(LanguageServiceEvent {
                                    session_id: id.clone(),
                                    kind: "diagnostics",
                                    code: None,
                                    uri: Some(uri.clone()),
                                    version: Some(version),
                                    diagnostics: Some(Value::Array(std::mem::take(&mut job.items))),
                                });
                            }
                        }
                        if let Some(request) = pending.remove(&number) {
                            let valid = documents
                                .get(&request.uri)
                                .is_some_and(|doc| doc.version == request.version);
                            let result = if !valid || request.model_generation != model_generation {
                                Err("language result is stale".into())
                            } else if response.error.is_some() {
                                Err("language server rejected the request".into())
                            } else {
                                {
                                    let value = response.result.unwrap_or(Value::Null);
                                    sources::validate_sources(&value).map(|()| value)
                                }
                            };
                            let _ = request.reply.send(result);
                        }
                    }
                }
                Ok(Some(ServerEvent::Message(JsonRpcMessage::Request(request)))) => {
                    #[cfg(test)]
                    eprintln!("server request {}", request.method);
                    if request.method == "workspace/diagnostic/refresh"
                        && last_diagnostic_refresh.elapsed() >= Duration::from_millis(500)
                    {
                        last_diagnostic_refresh = Instant::now();
                        for (number, _) in diagnostic_pending.drain() {
                            let _ = process.cancel(number);
                        }
                        for job in diagnostic_jobs.values_mut() {
                            job.remaining = 0;
                            job.failed = false;
                            job.items.clear();
                            job.due = Instant::now() + Duration::from_millis(150);
                        }
                        if process
                            .reply_to_server(request.id, Ok(Value::Null))
                            .is_err()
                        {
                            break 'session;
                        }
                        continue;
                    }
                    let valid_model_request = request.params.as_ref().is_none_or(|value| {
                        value.is_null()
                            || value.as_object().is_some_and(|object| {
                                object.len() <= 1
                                    && object
                                        .iter()
                                        .all(|(key, value)| key == "refresh" && value.is_boolean())
                            })
                    });
                    if request.method == "asterlyn/workspaceModel"
                        && valid_model_request
                        && model_pending.is_none()
                        && last_model_request.elapsed() >= Duration::from_millis(500)
                        && let Some(access) = model_access.as_ref()
                    {
                        let access = access.clone();
                        let lifetime = alive.clone();
                        let sender = model_sender.clone();
                        let refresh = request
                            .params
                            .as_ref()
                            .and_then(|params| params.get("refresh"))
                            .and_then(Value::as_bool)
                            .unwrap_or(false);
                        last_model_request = Instant::now();
                        model_pending = Some(request);
                        std::thread::spawn(move || {
                            let result =
                                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                                    access(lifetime, refresh)
                                }))
                                .unwrap_or_else(|_| Err("model work failed".into()));
                            let _ = sender.send(result);
                        });
                    } else if process.reject_request(&request).is_err() {
                        break 'session;
                    }
                }
                Ok(Some(ServerEvent::Message(JsonRpcMessage::Notification(notification)))) => {
                    if notification.method == "asterlyn/trace"
                        && let Some(code) = notification
                            .params
                            .as_ref()
                            .and_then(|params| params.get("code"))
                            .and_then(Value::as_str)
                            .filter(|code| {
                                code.len() <= 80
                                    && code.bytes().all(|b| {
                                        b.is_ascii_lowercase()
                                            || b.is_ascii_digit()
                                            || matches!(b, b'.' | b'-')
                                    })
                            })
                    {
                        emit(LanguageServiceEvent {
                            session_id: id.clone(),
                            kind: "backend-log",
                            code: Some(code.into()),
                            uri: None,
                            version: None,
                            diagnostics: None,
                        });
                    }
                    if (rust || packaged)
                        && notification.method == "experimental/serverStatus"
                        && let Some(params) = notification.params.as_ref()
                        && let (Some(health), Some(quiescent)) = (
                            params.get("health").and_then(Value::as_str),
                            params.get("quiescent").and_then(Value::as_bool),
                        )
                        && ["ok", "warning", "error"].contains(&health)
                    {
                        let code = params
                            .get("code")
                            .and_then(Value::as_str)
                            .filter(|value| {
                                value.len() <= 80
                                    && value.bytes().all(|b| {
                                        b.is_ascii_lowercase()
                                            || b.is_ascii_digit()
                                            || matches!(b, b'.' | b'-')
                                    })
                            })
                            .map(str::to_owned);
                        let was_ready = rust_ready;
                        rust_ready = quiescent && health != "error";
                        if rust_ready && !was_ready {
                            for (number, _) in diagnostic_pending.drain() {
                                let _ = process.cancel(number);
                            }
                            for job in diagnostic_jobs.values_mut() {
                                job.remaining = 0;
                                job.failed = false;
                                job.items.clear();
                                job.due = Instant::now() + Duration::from_millis(150);
                            }
                        }
                        emit(LanguageServiceEvent {
                            session_id: id.clone(),
                            kind: if health == "error" {
                                "degraded"
                            } else if rust_ready {
                                "ready"
                            } else {
                                "indexing"
                            },
                            code,
                            uri: None,
                            version: None,
                            diagnostics: None,
                        });
                    }
                    if notification.method == "textDocument/publishDiagnostics"
                        && let Some(params) = notification.params
                        && let (Some(uri), Some(version), Some(items)) = (
                            params.get("uri").and_then(Value::as_str),
                            params.get("version").and_then(Value::as_i64),
                            params.get("diagnostics").and_then(Value::as_array),
                        )
                        && documents.get(uri).is_some_and(|doc| doc.version == version)
                        && items.len() <= 512
                    {
                        emit(LanguageServiceEvent {
                            session_id: id.clone(),
                            kind: "diagnostics",
                            code: None,
                            uri: Some(uri.into()),
                            version: Some(version),
                            diagnostics: Some(Value::Array(
                                diagnostics.push_items(&documents[uri].text, items),
                            )),
                        });
                    }
                }
                Ok(Some(ServerEvent::Eof | ServerEvent::Io(_))) | Err(_) => break 'session,
                Ok(None) => break,
            }
        }
        let expired = pending
            .iter()
            .filter(|(_, p)| p.deadline <= Instant::now())
            .map(|(id, _)| *id)
            .collect::<Vec<_>>();
        for number in expired {
            if let Some(p) = pending.remove(&number) {
                let _ = process.cancel(number);
                let _ = p.reply.send(Err("language request timed out".into()));
            }
        }
        let expired_diagnostics = diagnostic_pending
            .iter()
            .filter(|(_, (_, _, deadline))| *deadline <= Instant::now())
            .map(|(id, _)| *id)
            .collect::<Vec<_>>();
        for number in expired_diagnostics {
            if let Some((uri, version, _)) = diagnostic_pending.remove(&number) {
                let _ = process.cancel(number);
                if let Some(job) = diagnostic_jobs.get_mut(&uri)
                    && job.version == version
                {
                    job.remaining = job.remaining.saturating_sub(1);
                    job.failed = true;
                }
            }
        }
        let due = diagnostic_jobs
            .iter()
            .filter(|(_, job)| job.remaining == 0 && job.due <= Instant::now())
            .map(|(uri, job)| (uri.clone(), job.version))
            .collect::<Vec<_>>();
        for (uri, version) in due {
            if diagnostics.query_count() == 0 {
                continue;
            }
            if !documents
                .get(&uri)
                .is_some_and(|doc| doc.version == version)
            {
                continue;
            }
            if pending.len() + diagnostic_pending.len() >= MAX_REQUESTS {
                continue;
            }
            let Ok(file) = document_path(&subject.root, &uri) else {
                continue;
            };
            if let Some(job) = diagnostic_jobs.get_mut(&uri) {
                job.due = Instant::now() + Duration::from_secs(86400);
                job.remaining = diagnostics.query_count();
                job.failed = false;
                job.items.clear();
            }
            for (method, params) in diagnostics.requests(&uri, &file) {
                match process.request(method, Some(params)) {
                    Ok(number) => {
                        diagnostic_pending.insert(
                            number,
                            (uri.clone(), version, Instant::now() + request_timeout),
                        );
                    }
                    Err(_) => break 'session,
                }
            }
        }

        let command = match receiver.recv_timeout(Duration::from_millis(10)) {
            Ok(c) => c,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => break,
        };
        match command {
            ActorCommand::Stop => break,
            ActorCommand::Open {
                uri,
                language,
                version,
                text,
                reply,
            } => {
                let result = (|| {
                    let path = document_path(&subject.root, &uri)?;
                    let expected = if let Some(selectors) = selectors.as_ref() {
                        path.file_name()
                            .and_then(|name| name.to_str())
                            .and_then(|name| {
                                selectors
                                    .iter()
                                    .flat_map(|(language, extensions)| {
                                        extensions
                                            .iter()
                                            .map(move |extension| (language, extension))
                                    })
                                    .filter(|(_, extension)| name.ends_with(extension.as_str()))
                                    .max_by_key(|(_, extension)| extension.len())
                                    .map(|(language, _)| language.as_str())
                            })
                    } else {
                        document_language(&path)
                    };
                    if expected != Some(language.as_str())
                        || (!packaged && (language == "rust") != rust)
                        || version != 1
                        || text.len() > MAX_DOCUMENT_BYTES
                        || documents.len() >= MAX_DOCUMENTS
                        || documents.contains_key(&uri)
                    {
                        return Err("invalid or duplicate language document".into());
                    }
                    process.notify("textDocument/didOpen",Some(json!({"textDocument":{"uri":uri,"languageId":language,"version":version,"text":text}}))).map_err(safe_error)?;
                    diagnostic_jobs.insert(
                        uri.clone(),
                        DiagnosticJob {
                            version,
                            due: Instant::now() + Duration::from_millis(250),
                            remaining: 0,
                            items: Vec::new(),
                            failed: false,
                        },
                    );
                    documents.insert(
                        uri.clone(),
                        DocumentState::new(
                            DocumentIdentity {
                                window_id: subject.owner.clone(),
                                worktree_root: subject.root.to_string_lossy().into(),
                                generation: subject.activation,
                                uri,
                            },
                            text,
                        ),
                    );
                    Ok(Value::Null)
                })();
                let _ = reply.send(result);
            }
            ActorCommand::Change {
                uri,
                version,
                changes,
                reply,
            } => {
                let result = (|| {
                    let doc = documents
                        .get_mut(&uri)
                        .ok_or("language document is not open")?;
                    if version <= doc.version
                        || changes.is_empty()
                        || changes.len() > 128
                        || changes.iter().map(|c| c.text.len()).sum::<usize>() > MAX_DOCUMENT_BYTES
                    {
                        return Err("invalid language document update".into());
                    }
                    let mut next = doc.clone();
                    next.apply(&changes).map_err(safe_error)?;
                    next.version = version;
                    if next.text.len() > MAX_DOCUMENT_BYTES {
                        return Err("language document exceeds bound".into());
                    }
                    process.notify("textDocument/didChange",Some(json!({"textDocument":{"uri":uri,"version":version},"contentChanges":[{"text":next.text}]}))).map_err(safe_error)?;
                    *doc = next;
                    diagnostic_jobs.insert(
                        uri.clone(),
                        DiagnosticJob {
                            version,
                            due: Instant::now() + Duration::from_millis(250),
                            remaining: 0,
                            items: Vec::new(),
                            failed: false,
                        },
                    );
                    let old_diagnostics = diagnostic_pending
                        .iter()
                        .filter(|(_, v)| v.0 == uri)
                        .map(|(id, _)| *id)
                        .collect::<Vec<_>>();
                    for number in old_diagnostics {
                        diagnostic_pending.remove(&number);
                        let _ = process.cancel(number);
                    }
                    let obsolete = pending
                        .iter()
                        .filter(|(_, p)| p.uri == uri)
                        .map(|(id, _)| *id)
                        .collect::<Vec<_>>();
                    for number in obsolete {
                        if let Some(p) = pending.remove(&number) {
                            let _ = process.cancel(number);
                            let _ = p.reply.send(Err("language result is stale".into()));
                        }
                    }
                    Ok(Value::Null)
                })();
                let _ = reply.send(result);
            }
            ActorCommand::Close { uri, reply } => {
                documents.remove(&uri);
                diagnostic_jobs.remove(&uri);
                let old_diagnostics = diagnostic_pending
                    .iter()
                    .filter(|(_, v)| v.0 == uri)
                    .map(|(id, _)| *id)
                    .collect::<Vec<_>>();
                for number in old_diagnostics {
                    diagnostic_pending.remove(&number);
                    let _ = process.cancel(number);
                }
                let obsolete = pending
                    .iter()
                    .filter(|(_, p)| p.uri == uri)
                    .map(|(id, _)| *id)
                    .collect::<Vec<_>>();
                for number in obsolete {
                    if let Some(p) = pending.remove(&number) {
                        let _ = process.cancel(number);
                        let _ = p.reply.send(Err("language document closed".into()));
                    }
                }
                let result = process
                    .notify(
                        "textDocument/didClose",
                        Some(json!({"textDocument":{"uri":uri}})),
                    )
                    .map(|_| Value::Null)
                    .map_err(safe_error);
                let _ = reply.send(result);
            }
            ActorCommand::Request {
                uri,
                version,
                request_id,
                feature,
                position,
                reply,
            } => {
                let result = (|| {
                    let doc = documents.get(&uri).ok_or("language document is not open")?;
                    if (rust || packaged) && !rust_ready {
                        return Err("Language services are loading this project. Try navigation again shortly.".into());
                    }
                    if doc.version != version
                        || request_id.is_empty()
                        || request_id.len() > 128
                        || pending.len() + diagnostic_pending.len() >= MAX_REQUESTS
                        || pending.values().any(|p| p.external == request_id)
                    {
                        return Err("stale or invalid language request".into());
                    }
                    utf16_offset(&doc.text, &position).map_err(safe_error)?;
                    let method = match feature.as_str() {
                        "hover" => "textDocument/hover",
                        "definition" => "textDocument/definition",
                        "completion" => "textDocument/completion",
                        "references" => "textDocument/references",
                        _ => return Err("unsupported language feature".into()),
                    };
                    let mut params = json!({"textDocument":{"uri":uri},"position":{"line":position.line,"character":position.character}});
                    if feature == "references" {
                        params["context"] = json!({"includeDeclaration":false});
                    }
                    process.request(method, Some(params)).map_err(safe_error)
                })();
                match result {
                    Ok(number) => {
                        pending.insert(
                            number,
                            Pending {
                                external: request_id,
                                uri,
                                version,
                                deadline: Instant::now() + request_timeout,
                                model_generation,
                                reply,
                            },
                        );
                    }
                    Err(error) => {
                        let _ = reply.send(Err(error));
                    }
                }
            }
            ActorCommand::Cancel { request_id, reply } => {
                let number = pending
                    .iter()
                    .find(|(_, p)| p.external == request_id)
                    .map(|(id, _)| *id);
                if let Some(number) = number
                    && let Some(p) = pending.remove(&number)
                {
                    let _ = process.cancel(number);
                    let _ = p.reply.send(Err("language request cancelled".into()));
                }
                let _ = reply.send(Ok(Value::Bool(number.is_some())));
            }
        }
    }
    for (_, p) in pending {
        let _ = p.reply.send(Err("language service has ended".into()));
    }
    let _ = process.stop();
    emit(LanguageServiceEvent {
        session_id: id,
        kind: "terminated",
        code: None,
        uri: None,
        version: None,
        diagnostics: None,
    });
}
