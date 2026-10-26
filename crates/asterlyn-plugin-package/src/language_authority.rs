use super::{AdmissionError, contract};

pub(super) fn validate(
    capabilities: &[String],
    permissions: &[String],
) -> Result<(), AdmissionError> {
    let capability = capabilities.iter().any(|value| value == "languageServices");
    let permission = permissions
        .iter()
        .any(|value| value == "host.language-services.execute");
    if capability != permission {
        return Err(contract(
            "languageServices requires exactly its host.language-services.execute permission",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn language_execution_requires_both_named_declarations() {
        assert!(validate(&[], &[]).is_ok());
        assert!(validate(&["languageServices".into()], &[]).is_err());
        assert!(validate(&[], &["host.language-services.execute".into()]).is_err());
        assert!(
            validate(
                &["languageServices".into()],
                &["host.language-services.execute".into()]
            )
            .is_ok()
        );
    }
}
