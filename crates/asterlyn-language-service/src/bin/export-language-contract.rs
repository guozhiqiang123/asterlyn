use asterlyn_language_service::protocol::{LanguageServiceFailure, LanguageServiceReview};
use serde_json::json;
fn main() {
    println!("{}",serde_json::to_string(&json!({"schema":1,"models":{"NativeLanguageServiceReview":schemars::schema_for!(LanguageServiceReview),"NativeLanguageServiceFailure":schemars::schema_for!(LanguageServiceFailure)}})).unwrap());
}
