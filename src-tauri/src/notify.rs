//! Native OS toast notifications with click-to-focus support on Windows.

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// Show a desktop notification without ever opening a secondary WebView window.
/// On Windows, clicking the native WinRT toast activates Icyteru and jumps to
/// `session_id` when provided.
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
            use tauri_winrt_notification::{Sound, Toast};

            let click_app = app_handle.clone();
            let click_session = session_id;
            let mut toast = Toast::new(&app_id)
                .title(&title)
                .sound(Some(Sound::Default))
                .on_activated(move |_action| {
                    let main_app = click_app.clone();
                    let target_session = click_session.clone();
                    let _ = click_app.run_on_main_thread(move || {
                        crate::window::activate_from_notification(
                            &main_app,
                            target_session.as_deref(),
                        );
                    });
                    Ok(())
                });
            if !body.is_empty() {
                toast = toast.text1(&body);
            }
            if toast.show().is_err() {
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
