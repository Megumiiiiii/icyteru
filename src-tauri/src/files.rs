use base64::{Engine as _, engine::general_purpose::STANDARD};

#[tauri::command]
pub fn save_download(path: String, data_url: String) -> Result<String, String> {
    let (meta, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "That download is not a data URL.".to_string())?;
    if !meta.contains(";base64") {
        return Err("Only base64 downloads are supported.".to_string());
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "That download data is invalid.".to_string())?;
    if bytes.len() > 256 * 1024 * 1024 {
        return Err("That download is larger than 256 MB.".to_string());
    }
    std::fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path)
}

/// A link inside the transcript belongs in the user's browser. Letting the
/// WebView navigate would replace the whole app with no way back, which is what
/// Electron's `setWindowOpenHandler` prevented.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "That link is invalid.".to_string())?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("Only http(s) links can be opened.".to_string());
    }
    tauri_plugin_opener::open_url(parsed.as_str(), None::<&str>)
        .map_err(|_| "The system browser did not accept that link.".to_string())
}
