use asterlyn_language_service::protocol::{LanguageServiceFailure, LanguageServiceReview};
use serde_json::json;
fn main() {
    println!("{}",serde_json::to_string(&json!({"schema":1,"models":{"LanguageResourcePolicy":schemars::schema_for!(asterlyn_language_service::application::resources::ResourcePolicy),"SymbolCandidate":schemars::schema_for!(asterlyn_workspace::symbols::SymbolCandidate),"SymbolOverlay":schemars::schema_for!(asterlyn_workspace::symbols::SymbolOverlay),"SymbolQueryReport":schemars::schema_for!(asterlyn_workspace::symbols::SymbolQueryReport),"NativeLanguageServiceReview":schemars::schema_for!(LanguageServiceReview),"NativeLanguageServiceFailure":schemars::schema_for!(LanguageServiceFailure)}})).unwrap());
}
