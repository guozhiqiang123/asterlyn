//! Native wire authority. Binding generation is an opt-in development feature.
use asterlyn_process::toolchain::ToolchainSnapshot;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct LanguageServiceReview {
    pub review_id: String,
    pub plugin_id: String,
    pub server_id: String,
    pub plugin_version: String,
    pub package_digest: String,
    pub resource_digest: String,
    pub executable_identity: String,
    pub expires_at: u64,
    pub remembered: bool,
    #[cfg_attr(feature = "bindings", schemars(length(max = 32)))]
    pub toolchains: Vec<ToolchainSnapshot>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "kebab-case")]
pub enum LanguageFailureCode {
    BackendExited,
    ProtocolFailed,
    ResourceLimit,
    AuthorityRevoked,
    ModelUnavailable,
    ToolchainUnavailable,
    Cancelled,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct LanguageServiceFailure {
    pub code: LanguageFailureCode,
    /// Classification only; automatic recovery still requires current authority and a retry budget.
    pub retryable: bool,
    pub message: String,
    pub request_id: Option<String>,
}
impl LanguageServiceFailure {
    pub fn from_code(code: &str) -> Self {
        use LanguageFailureCode::*;
        let (code, message) = match code {
            "backend-exited" | "language-start-backend-exited" => {
                (BackendExited, "The language process exited unexpectedly.")
            }
            "transport-failed" | "protocol-failed" => (
                ProtocolFailed,
                "The language transport could not continue safely.",
            ),
            "resource-limit" | "memory-limit" | "cpu-limit" => (
                ResourceLimit,
                "The language service reached its resource limit.",
            ),
            "authority-revoked"
            | "language-approval-revoked"
            | "language-execution-identity-changed" => (
                AuthorityRevoked,
                "Project approval or tool identity changed.",
            ),
            "cancelled" | "request-cancelled" => {
                (Cancelled, "The language operation was cancelled.")
            }
            value if value.starts_with("toolchain-") => (
                ToolchainUnavailable,
                "A compatible inspected toolchain is unavailable.",
            ),
            value if value.starts_with("model-") => {
                (ModelUnavailable, "A current project model is unavailable.")
            }
            _ => (
                Unavailable,
                "Language services are unavailable. Check project status and retry.",
            ),
        };
        Self {
            code,
            retryable: code == BackendExited,
            message: message.into(),
            request_id: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failure_is_fixed_private_and_retry_is_not_authority() {
        for code in [
            "backend-exited",
            "protocol-failed",
            "resource-limit",
            "authority-revoked",
            "model-invalid",
            "toolchain-unavailable",
            "cancelled",
            "secret=/private/path",
        ] {
            let value = LanguageServiceFailure::from_code(code);
            assert_eq!(value.retryable, code == "backend-exited");
            assert!(!value.message.contains("private"));
            let encoded = serde_json::to_value(value).unwrap();
            assert!(encoded["requestId"].is_null());
            assert!(!encoded.to_string().contains("secret="));
        }
    }
}
