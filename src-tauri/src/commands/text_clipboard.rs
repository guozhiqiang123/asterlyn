use clipboard_rs::{Clipboard, ClipboardContext, ContentFormat};

const MAX_TEXT_BYTES: usize = 16 * 1024 * 1024;

fn bounded(text: String) -> Result<String, String> {
    if text.len() > MAX_TEXT_BYTES {
        return Err("Clipboard text exceeds the 16 MiB editor limit".into());
    }
    Ok(text)
}

#[tauri::command]
pub(crate) async fn read_text_clipboard() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let clipboard = ClipboardContext::new().map_err(|_| "Could not open the text clipboard")?;
        if !clipboard.has(ContentFormat::Text) {
            return Ok(String::new());
        }
        bounded(
            clipboard
                .get_text()
                .map_err(|_| "Could not read the text clipboard")?,
        )
    })
    .await
    .map_err(|_| "Text clipboard task failed".to_owned())?
}

#[tauri::command]
pub(crate) async fn write_text_clipboard(text: String) -> Result<(), String> {
    let text = bounded(text)?;
    tauri::async_runtime::spawn_blocking(move || {
        ClipboardContext::new()
            .map_err(|_| "Could not open the text clipboard")?
            .set_text(text)
            .map_err(|_| "Could not write the text clipboard".to_owned())
    })
    .await
    .map_err(|_| "Text clipboard task failed".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clipboard_limit_counts_bytes_without_rewriting_unicode_or_line_endings() {
        let text = "字😀\r\n\tvalue".to_owned();
        assert_eq!(bounded(text.clone()).unwrap(), text);
        assert!(bounded("a".repeat(MAX_TEXT_BYTES)).is_ok());
        assert!(bounded("字".repeat(MAX_TEXT_BYTES / 3 + 1)).is_err());
    }
}
