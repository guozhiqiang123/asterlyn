use super::*;

/// Disabled fast path avoids JSON construction. Each actor also caps detailed events independently.
pub(super) struct LanguageTrace {
    enabled: Arc<AtomicBool>,
    emit: Arc<dyn Fn(LanguageServiceEvent) + Send + Sync>,
    id: String,
    window: Instant,
    count: usize,
}
impl LanguageTrace {
    pub fn new(
        enabled: Arc<AtomicBool>,
        emit: Arc<dyn Fn(LanguageServiceEvent) + Send + Sync>,
        id: String,
    ) -> Self {
        Self {
            enabled,
            emit,
            id,
            window: Instant::now(),
            count: 0,
        }
    }
    pub fn record(
        &mut self,
        operation: &str,
        uri: Option<&str>,
        version: Option<i64>,
        fields: impl FnOnce() -> Value,
    ) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }
        if self.window.elapsed() >= Duration::from_secs(1) {
            self.window = Instant::now();
            self.count = 0;
        }
        if self.count >= 120 {
            return;
        }
        self.count += 1;
        (self.emit)(LanguageServiceEvent {
            session_id: self.id.clone(),
            kind: "debug",
            code: Some(operation.into()),
            uri: uri.map(str::to_owned),
            version,
            diagnostics: None,
            progress: None,
            details: Some(fields()),
        });
    }
    pub fn command(&mut self, command: &ActorCommand) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }
        match command {
            ActorCommand::Open{uri,version,text,..}=>self.record("document.open",Some(uri),Some(*version),||json!({"bytes":text.len()})),
            ActorCommand::Change{uri,version,changes,..}=>self.record("document.change",Some(uri),Some(*version),||json!({"bytes":changes.iter().map(|c|c.text.len()).sum::<usize>(),"changeCount":changes.len()})),
            ActorCommand::Close{uri,..}=>self.record("document.close",Some(uri),None,||json!({})),
            ActorCommand::Request{uri,version,request_id,feature,position,..}=>self.record("request.started",Some(uri),Some(*version),||json!({"requestId":safe_id(request_id),"feature":if["hover","definition","completion","references"].contains(&feature.as_str()){feature.as_str()}else{"unsupported"},"line":position.line,"character":position.character})),
            ActorCommand::Cancel{request_id,..}=>self.record("request.cancelled",None,None,||json!({"requestId":safe_id(request_id)})),
            ActorCommand::Stop=>self.record("session.stop",None,None,||json!({})),
        }
    }
    pub fn response(&mut self, request: &Pending, result: &Result<Value, String>) {
        self.record("request.completed",Some(&request.uri),Some(request.version),||json!({"requestId":safe_id(&request.external),"outcome":match result{Ok(_)=>"completed",Err(error)if error.contains("stale")=>"discarded",Err(error)if error.contains("loading")=>"indexing",Err(_)=>"failed"},"durationMs":request.started.elapsed().as_millis() as u64,"resultCount":result.as_ref().ok().and_then(Value::as_array).map(Vec::len)}));
    }
}
fn safe_id(id: &str) -> &str {
    if id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        id
    } else {
        "invalid"
    }
}
pub(super) fn backend_details(params: Option<&Value>) -> Value {
    let mut result = serde_json::Map::new();
    if let Some(details) = params
        .and_then(|p| p.get("details"))
        .and_then(Value::as_object)
    {
        for key in [
            "durationMs",
            "completed",
            "total",
            "version",
            "bytes",
            "attempt",
        ] {
            if let Some(value) = details
                .get(key)
                .and_then(Value::as_u64)
                .filter(|v| *v <= 86_400_000)
            {
                result.insert(key.into(), json!(value));
            }
        }
        if let Some(value) = details
            .get("backend")
            .and_then(Value::as_str)
            .filter(|v| ["java", "kotlin", "model", "compiler"].contains(v))
        {
            result.insert("backend".into(), json!(value));
        }
        if let Some(value) = details
            .get("moduleHash")
            .and_then(Value::as_str)
            .filter(|v| v.len() == 12 && v.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            result.insert("moduleHash".into(), json!(value));
        }
    }
    Value::Object(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tracing_is_opt_in_metadata_only_and_rate_bounded() {
        let enabled = Arc::new(AtomicBool::new(false));
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let emit = Arc::new(move |event| sink.lock().unwrap().push(event));
        let mut trace = LanguageTrace::new(enabled.clone(), emit, "session-test".into());
        let (tx, _) = mpsc::channel();
        let command = ActorCommand::Open {
            uri: "file:///repo/Test.kt".into(),
            language: "kotlin".into(),
            version: 1,
            text: "source-never-logged".into(),
            reply: tx,
        };
        trace.command(&command);
        assert!(events.lock().unwrap().is_empty());
        enabled.store(true, Ordering::Relaxed);
        for _ in 0..500 {
            trace.command(&command);
        }
        let events = events.lock().unwrap();
        assert_eq!(events.len(), 120);
        for event in events.iter() {
            assert!(
                !serde_json::to_string(&event.details)
                    .unwrap()
                    .contains("source-never-logged")
            );
            assert_eq!(event.details.as_ref().unwrap()["bytes"], 19);
        }
    }
}
