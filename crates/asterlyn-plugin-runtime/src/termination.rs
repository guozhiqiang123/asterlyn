use std::sync::Mutex;
use std::sync::mpsc::{self, Receiver, Sender};

use crate::PluginDiagnostics;

pub(crate) const MAX_TERMINATION_DETAIL_CHARS: usize = 4_096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PluginSessionTerminationReason {
    UnexpectedExit,
    ProtocolViolation,
    Timeout,
    HostIoFailure,
    ResourceLimit,
    PeerSessionFailure,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSessionTermination {
    pub owner: String,
    pub plugin_id: String,
    pub plugin_version: String,
    pub package_digest: String,
    pub session_id: String,
    pub reason: PluginSessionTerminationReason,
    pub detail: String,
    pub diagnostics: PluginDiagnostics,
}

#[derive(Default)]
pub(crate) struct TerminationObservers {
    senders: Mutex<Vec<Sender<PluginSessionTermination>>>,
}

impl TerminationObservers {
    pub(crate) fn subscribe(&self) -> Receiver<PluginSessionTermination> {
        let (sender, receiver) = mpsc::channel();
        if let Ok(mut senders) = self.senders.lock() {
            senders.push(sender);
        }
        receiver
    }

    pub(crate) fn publish(&self, termination: PluginSessionTermination) {
        let Ok(mut senders) = self.senders.lock() else {
            return;
        };
        senders.retain(|sender| sender.send(termination.clone()).is_ok());
    }
}

pub(crate) fn bounded_termination_detail(detail: impl Into<String>) -> String {
    detail
        .into()
        .chars()
        .take(MAX_TERMINATION_DETAIL_CHARS)
        .collect()
}
