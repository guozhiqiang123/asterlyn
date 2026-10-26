//! A fixed-capacity mailbox. Only explicitly recognized, replaceable JDT status is
//! coalesced; replies, diagnostics, requests and unknown notifications stay lossless.
use crate::{JsonRpcId, JsonRpcMessage, JsonRpcResponse, MAX_EVENTS, ServerEvent};
use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Condvar, Mutex, mpsc};
use std::time::{Duration, Instant};

const MAX_STATUS_BYTES: usize = 8192;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum Slot {
    Progress,
    Starting,
    Started,
    ServiceReady,
    ProjectStatus,
    Error,
}

fn slot(event: &ServerEvent) -> Option<Slot> {
    let ServerEvent::Message(JsonRpcMessage::Notification(message)) = event else {
        return None;
    };
    match message.method.as_str() {
        "language/progressReport" => Some(Slot::Progress),
        "language/status" => match message.params.as_ref()?.get("type")?.as_str()? {
            "Starting" => Some(Slot::Starting),
            "Started" => Some(Slot::Started),
            "ServiceReady" => Some(Slot::ServiceReady),
            "ProjectStatus" => Some(Slot::ProjectStatus),
            "Error" => Some(Slot::Error),
            _ => None,
        },
        _ => None,
    }
}

#[derive(Default)]
pub(crate) struct EventBuffer {
    next: u64,
    ordered: VecDeque<(u64, ServerEvent)>,
    latest: BTreeMap<Slot, (u64, ServerEvent)>,
}

impl EventBuffer {
    pub(crate) fn push(&mut self, event: ServerEvent) -> Result<(), &'static str> {
        let sequence = self.next.checked_add(1).ok_or("event sequence")?;
        if let Some(key) = slot(&event) {
            let ServerEvent::Message(JsonRpcMessage::Notification(message)) = &event else {
                unreachable!();
            };
            if serde_json::to_vec(message)
                .map_err(|_| "invalid status")?
                .len()
                > MAX_STATUS_BYTES
            {
                return Err("status bytes");
            }
            self.latest.insert(key, (sequence, event));
        } else {
            if self.ordered.len() >= MAX_EVENTS {
                return Err("server events");
            }
            self.ordered.push_back((sequence, event));
        }
        self.next = sequence;
        Ok(())
    }

    pub(crate) fn pop(&mut self) -> Option<ServerEvent> {
        let latest = self.latest.iter().min_by_key(|(_, (sequence, _))| sequence);
        if let Some((&key, (sequence, _))) = latest
            && self
                .ordered
                .front()
                .is_none_or(|(front, _)| sequence < front)
        {
            return self.latest.remove(&key).map(|(_, event)| event);
        }
        self.ordered.pop_front().map(|(_, event)| event)
    }

    pub(crate) fn take_response(&mut self, id: &JsonRpcId) -> Option<JsonRpcResponse> {
        let index = self.ordered.iter().position(|(_, event)| {
            matches!(event,
            ServerEvent::Message(JsonRpcMessage::Response(response)) if response.id == *id)
        })?;
        let (_, ServerEvent::Message(JsonRpcMessage::Response(response))) =
            self.ordered.remove(index)?
        else {
            unreachable!();
        };
        Some(response)
    }
}

#[derive(Default)]
struct State {
    buffer: EventBuffer,
    terminal: Option<ServerEvent>,
    closed: bool,
    receiver_dropped: bool,
}
impl State {
    fn pop(&mut self) -> Option<ServerEvent> {
        self.buffer.pop().or_else(|| self.terminal.take())
    }
}
#[derive(Default)]
struct Shared {
    state: Mutex<State>,
    ready: Condvar,
}

pub(crate) struct EventSender(Arc<Shared>);
pub(crate) struct EventReceiver(Arc<Shared>);

pub(crate) fn channel() -> (EventSender, EventReceiver) {
    let shared = Arc::new(Shared::default());
    (EventSender(shared.clone()), EventReceiver(shared))
}

impl EventSender {
    pub(crate) fn send(&self, event: ServerEvent) -> Result<(), &'static str> {
        let mut state = self.0.state.lock().map_err(|_| "event lock")?;
        if state.closed || state.receiver_dropped {
            return Err("event receiver closed");
        }
        state.buffer.push(event)?;
        self.0.ready.notify_one();
        Ok(())
    }
    // Terminal delivery never waits for queue capacity, including malformed-stream errors.
    pub(crate) fn finish(&self, event: ServerEvent) {
        if let Ok(mut state) = self.0.state.lock()
            && !state.closed
        {
            state.terminal = Some(event);
            state.closed = true;
            self.0.ready.notify_all();
        }
    }
}
impl Drop for EventSender {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.state.lock() {
            state.closed = true;
            self.0.ready.notify_all();
        }
    }
}
impl EventReceiver {
    pub(crate) fn try_recv(&self) -> Result<ServerEvent, mpsc::TryRecvError> {
        let mut state = self
            .0
            .state
            .lock()
            .map_err(|_| mpsc::TryRecvError::Disconnected)?;
        state.pop().ok_or(if state.closed {
            mpsc::TryRecvError::Disconnected
        } else {
            mpsc::TryRecvError::Empty
        })
    }
    pub(crate) fn recv_timeout(
        &self,
        timeout: Duration,
    ) -> Result<ServerEvent, mpsc::RecvTimeoutError> {
        let started = Instant::now();
        let mut state = self
            .0
            .state
            .lock()
            .map_err(|_| mpsc::RecvTimeoutError::Disconnected)?;
        loop {
            if let Some(event) = state.pop() {
                return Ok(event);
            }
            if state.closed {
                return Err(mpsc::RecvTimeoutError::Disconnected);
            }
            let remaining = timeout.saturating_sub(started.elapsed());
            if remaining.is_zero() {
                return Err(mpsc::RecvTimeoutError::Timeout);
            }
            state = self
                .0
                .ready
                .wait_timeout(state, remaining)
                .map_err(|_| mpsc::RecvTimeoutError::Disconnected)?
                .0;
        }
    }
}
impl Drop for EventReceiver {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.state.lock() {
            state.receiver_dropped = true;
            self.0.ready.notify_all();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{JsonRpcNotification, JsonRpcRequest};
    use serde_json::json;
    fn notification(method: &str, params: serde_json::Value) -> ServerEvent {
        ServerEvent::Message(JsonRpcMessage::Notification(JsonRpcNotification {
            jsonrpc: "2.0".into(),
            method: method.into(),
            params: Some(params),
        }))
    }
    fn status(kind: &str, value: usize) -> ServerEvent {
        notification("language/status", json!({"type":kind,"count":value}))
    }
    fn reply(id: u64) -> ServerEvent {
        ServerEvent::Message(JsonRpcMessage::Response(JsonRpcResponse {
            jsonrpc: "2.0".into(),
            id: JsonRpcId::Number(id),
            result: Some(json!(id)),
            error: None,
        }))
    }

    #[test]
    fn import_status_flood_does_not_displace_replies_diagnostics_or_readiness() {
        let (sender, receiver) = channel();
        sender.send(status("Starting", 0)).unwrap();
        sender.send(reply(1)).unwrap();
        let diagnostic = notification(
            "textDocument/publishDiagnostics",
            json!({"uri":"file:///a.java","version":2,"diagnostics":[]}),
        );
        sender.send(diagnostic.clone()).unwrap();
        for index in 0..10000 {
            sender.send(status("ProjectStatus", index)).unwrap();
            sender
                .send(notification(
                    "language/progressReport",
                    json!({"id":index,"workDone":index}),
                ))
                .unwrap();
        }
        sender.send(status("ServiceReady", 1)).unwrap();
        sender.send(reply(2)).unwrap();
        let expected = [
            status("Starting", 0),
            reply(1),
            diagnostic,
            status("ProjectStatus", 9999),
            notification(
                "language/progressReport",
                json!({"id":9999,"workDone":9999}),
            ),
            status("ServiceReady", 1),
            reply(2),
        ];
        for event in expected {
            assert_eq!(receiver.try_recv().unwrap(), event);
        }
        assert_eq!(receiver.try_recv(), Err(mpsc::TryRecvError::Empty));
    }
    #[test]
    fn unknown_notifications_requests_and_responses_keep_strict_capacity() {
        for method in [
            "textDocument/publishDiagnostics",
            "unrecognized/progress",
            "language/status",
        ] {
            let (sender, _receiver) = channel();
            for _ in 0..MAX_EVENTS {
                sender
                    .send(notification(method, json!({"type":"unknown"})))
                    .unwrap();
            }
            assert_eq!(
                sender.send(notification(method, json!({"type":"unknown"}))),
                Err("server events")
            );
        }
        let (sender, _receiver) = channel();
        for id in 0..MAX_EVENTS as u64 {
            sender.send(reply(id)).unwrap();
        }
        assert!(
            sender
                .send(ServerEvent::Message(JsonRpcMessage::Request(
                    JsonRpcRequest {
                        jsonrpc: "2.0".into(),
                        id: JsonRpcId::Number(100),
                        method: "workspace/applyEdit".into(),
                        params: None
                    }
                )))
                .is_err()
        );
    }
    #[test]
    fn terminal_event_survives_a_full_queue_without_blocking_the_reader() {
        let (sender, receiver) = channel();
        for id in 0..MAX_EVENTS as u64 {
            sender.send(reply(id)).unwrap();
        }
        sender.finish(ServerEvent::Io("invalid frame".into()));
        for id in 0..MAX_EVENTS as u64 {
            assert_eq!(receiver.try_recv().unwrap(), reply(id));
        }
        assert_eq!(
            receiver.try_recv().unwrap(),
            ServerEvent::Io("invalid frame".into())
        );
        assert_eq!(receiver.try_recv(), Err(mpsc::TryRecvError::Disconnected));
    }
    #[test]
    fn replacement_retains_wire_order_relative_to_responses_and_readiness() {
        let mut buffer = EventBuffer::default();
        buffer.push(status("ProjectStatus", 0)).unwrap();
        buffer.push(status("ServiceReady", 0)).unwrap();
        buffer.push(reply(1)).unwrap();
        buffer.push(status("ProjectStatus", 1)).unwrap();
        assert_eq!(buffer.pop(), Some(status("ServiceReady", 0)));
        assert_eq!(buffer.pop(), Some(reply(1)));
        assert_eq!(buffer.pop(), Some(status("ProjectStatus", 1)));
        assert_eq!(buffer.pop(), None);
    }
    #[test]
    fn oversized_replaceable_status_is_rejected_without_expanding_the_mailbox() {
        let mut buffer = EventBuffer::default();
        assert_eq!(
            buffer.push(notification(
                "language/progressReport",
                json!({"message":"x".repeat(MAX_STATUS_BYTES)})
            )),
            Err("status bytes")
        );
        assert!(buffer.pop().is_none());
    }
    #[test]
    fn waiters_wake_on_sender_drop_and_receiver_drop_rejects_delivery() {
        let (sender, receiver) = channel();
        assert_eq!(
            receiver.recv_timeout(Duration::ZERO),
            Err(mpsc::RecvTimeoutError::Timeout)
        );
        let waiter = std::thread::spawn(move || receiver.recv_timeout(Duration::from_secs(5)));
        drop(sender);
        assert_eq!(
            waiter.join().unwrap(),
            Err(mpsc::RecvTimeoutError::Disconnected)
        );
        let (sender, receiver) = channel();
        drop(receiver);
        assert_eq!(sender.send(reply(1)), Err("event receiver closed"));
    }
    #[test]
    fn startup_response_selection_preserves_the_remaining_fifo() {
        let mut buffer = EventBuffer::default();
        buffer.push(status("Started", 0)).unwrap();
        buffer.push(reply(3)).unwrap();
        buffer.push(reply(4)).unwrap();
        assert_eq!(
            buffer.take_response(&JsonRpcId::Number(3)).unwrap().id,
            JsonRpcId::Number(3)
        );
        assert_eq!(buffer.pop(), Some(status("Started", 0)));
        assert_eq!(buffer.pop(), Some(reply(4)));
    }
}
