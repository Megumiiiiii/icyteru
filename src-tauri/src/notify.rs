//! Native OS toast notifications with Windows protocol activation.
//!
//! On Windows 10/11, in-process WinRT `ToastNotification::Activated` handlers
//! do not fire once a toast moves into Notification Center (Action Center) for
//! unpackaged NSIS apps. Using `<toast activationType="protocol" launch="icyteru://...">`
//! lets Windows route clicks from both live banners and Notification Center
//! directly into `tauri-plugin-single-instance`, which focuses the main window
//! and opens the target session.

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

const SCHEME: &str = "icyteru";

/// Register the per-user `icyteru://` URL protocol in `HKCU\Software\Classes`
/// so Windows Notification Center can activate Icyteru on toast clicks.
pub fn register_protocol() {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let Ok(exe) = std::env::current_exe() else {
            return;
        };
        let command = format!("\"{}\" \"%1\"", exe.display());
        tauri::async_runtime::spawn_blocking(move || {
            let root = format!("HKCU\\Software\\Classes\\{SCHEME}");
            let open_cmd = format!("{root}\\shell\\open\\command");
            let _ = Command::new("reg")
                .args(["add", &root, "/ve", "/t", "REG_SZ", "/d", "URL:Icyteru Protocol", "/f"])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
            let _ = Command::new("reg")
                .args(["add", &root, "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
            let _ = Command::new("reg")
                .args(["add", &open_cmd, "/ve", "/t", "REG_SZ", "/d", &command, "/f"])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        });
    }
}

/// Extract an optional session ID from a `icyteru://open?session=...` launch argument.
pub fn session_from_args(args: &[String]) -> Option<String> {
    for arg in args {
        let trimmed = arg.trim();
        if !trimmed.starts_with(&format!("{SCHEME}://")) {
            continue;
        }
        if let Ok(parsed) = url::Url::parse(trimmed) {
            for (key, value) in parsed.query_pairs() {
                if key == "session" && !value.trim().is_empty() {
                    return Some(value.into_owned());
                }
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn escape_xml(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

#[cfg(target_os = "windows")]
fn show_windows_toast(
    app_id: &str,
    title: &str,
    body: &str,
    session_id: Option<&str>,
) -> windows::core::Result<()> {
    use windows::{
        Data::Xml::Dom::XmlDocument,
        UI::Notifications::{ToastNotification, ToastNotificationManager},
        core::HSTRING,
    };

    let mut launch = url::Url::parse(&format!("{SCHEME}://open"))
        .expect("static protocol url is valid");
    if let Some(sid) = session_id.filter(|id| !id.trim().is_empty()) {
        launch.query_pairs_mut().append_pair("session", sid.trim());
    }
    let body_xml = if body.is_empty() {
        String::new()
    } else {
        format!("<text>{}</text>", escape_xml(body))
    };
    let xml = format!(
        r#"<toast launch="{}" activationType="protocol"><visual><binding template="ToastGeneric"><text>{}</text>{}</binding></visual><audio src="ms-winsoundevent:Notification.Default"/></toast>"#,
        escape_xml(launch.as_str()),
        escape_xml(title),
        body_xml
    );

    let doc = XmlDocument::new()?;
    doc.LoadXml(&HSTRING::from(xml))?;
    let toast = ToastNotification::CreateToastNotification(&doc)?;
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))?;
    notifier.Show(&toast)
}

/// Show a desktop notification without ever opening a secondary WebView window.
pub fn send(app: &AppHandle, title: &str, body: &str, session_id: Option<String>) {
    let title = if title.trim().is_empty() {
        "Icyteru".to_string()
    } else {
        title.to_string()
    };
    let body = body.to_string();

    #[cfg(target_os = "windows")]
    {
        let app_handle = app.clone();
        let app_id = app.config().identifier.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if show_windows_toast(&app_id, &title, &body, session_id.as_deref()).is_err() {
                let _ = app_handle
                    .notification()
                    .builder()
                    .title(&title)
                    .body(&body)
                    .show();
            }
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = session_id;
        let _ = app
            .notification()
            .builder()
            .title(&title)
            .body(&body)
            .show();
    }
}

#[tauri::command]
pub fn notify_send(
    app: AppHandle,
    title: String,
    body: String,
    session_id: Option<String>,
) {
    send(&app, &title, &body, session_id);
}
