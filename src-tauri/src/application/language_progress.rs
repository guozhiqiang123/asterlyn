use serde_json::Value;

/// Closed metadata schema. No server message, filename, source text or arbitrary percentage.
pub(super) fn progress(value: &Value) -> Option<Value> {
    let item = value.get("progress")?;
    let fields = item.as_object()?;
    if fields
        .keys()
        .any(|key| !["phase", "completed", "total", "unit"].contains(&key.as_str()))
    {
        return None;
    }
    if ![
        "model",
        "sources",
        "backend",
        "indexing",
        "refreshing",
        "ready",
        "failed",
    ]
    .contains(&item.get("phase")?.as_str()?)
    {
        return None;
    }
    for key in ["completed", "total"] {
        if let Some(value) = item.get(key)
            && value
                .as_u64()
                .is_none_or(|n| n > 1_000_000 || (key == "total" && n == 0))
        {
            return None;
        }
    }
    if let (Some(a), Some(b)) = (item.get("completed"), item.get("total"))
        && a.as_u64()? > b.as_u64()?
    {
        return None;
    }
    if let Some(unit) = item.get("unit")
        && !["modules", "files", "items"].contains(&unit.as_str()?)
    {
        return None;
    }
    Some(item.clone())
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn accepts_real_counts_but_never_untrusted_messages_or_fake_progress() {
        assert!(
            progress(
                &json!({"progress":{"phase":"sources","completed":2,"total":12,"unit":"modules"}})
            )
            .is_some()
        );
        for p in [
            json!({"phase":"sources","message":"source text"}),
            json!({"phase":"unknown"}),
            json!({"phase":"indexing","completed":4,"total":2}),
            json!({"phase":"indexing","total":0}),
            json!({"phase":"indexing","completed":-1}),
            json!({"phase":"indexing","completed":1.5}),
        ] {
            assert!(progress(&json!({"progress":p})).is_none());
        }
    }
}
