//! A small always-on-top card that stands in for an OS toast.
//!
//! Windows toasts from an unpackaged app cannot report a click back to us, so a
//! notification the user cannot act on is worse than useless. This window is
//! ours: clicking it brings Icyteru back and opens the session it points at.

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

const TOAST: &str = "toast";
const WIDTH: f64 = 372.0;
const HEIGHT: f64 = 96.0;
const LIFETIME: Duration = Duration::from_secs(8);

static GENERATION: AtomicU64 = AtomicU64::new(0);
/// The card may finish loading after `show()` emitted, so keep the payload.
static LAST: Mutex<Option<(String, String, String)>> = Mutex::new(None);

fn place(window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let size = monitor.size();
    let scale = monitor.scale_factor();
    let width = (WIDTH * scale) as i32;
    let height = (HEIGHT * scale) as i32;
    let margin = (18.0 * scale) as i32;
    // Sit above the taskbar/dock instead of under it.
    let x = (size.width as i32 - width - margin).max(0);
    let y = (size.height as i32 - height - margin - (42.0 * scale) as i32).max(0);
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn ensure_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(window) = app.get_webview_window(TOAST) {
        return Some(window);
    }
    WebviewWindowBuilder::new(app, TOAST, WebviewUrl::App("toast.html".into()))
        .title("Icyteru")
        .inner_size(WIDTH, HEIGHT)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .shadow(true)
        .build()
        .ok()
}

/// Show (or refresh) the card. `session` is handed back when it is clicked.
pub fn show(app: &AppHandle, title: &str, body: &str, session: &str) {
    let Some(window) = ensure_window(app) else {
        return;
    };
    place(&window);
    let _ = window.show();
    *LAST.lock().unwrap_or_else(|error| error.into_inner()) =
        Some((title.to_string(), body.to_string(), session.to_string()));
    let _ = window.emit(
        "icyteru-toast",
        serde_json::json!({ "title": title, "body": body, "session": session }),
    );
    let generation = GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(LIFETIME).await;
        // A newer notification must not be hidden by an older timer.
        if GENERATION.load(Ordering::Relaxed) == generation {
            if let Some(window) = handle.get_webview_window(TOAST) {
                let _ = window.hide();
            }
        }
    });
}

pub fn hide(app: &AppHandle) {
    GENERATION.fetch_add(1, Ordering::Relaxed);
    if let Some(window) = app.get_webview_window(TOAST) {
        let _ = window.hide();
    }
}

/// Read by the card on load, because the window is created and shown in one go.
#[tauri::command]
pub fn toast_current() -> Option<serde_json::Value> {
    let last = LAST
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone()?;
    Some(serde_json::json!({ "title": last.0, "body": last.1, "session": last.2 }))
}

#[tauri::command]
pub fn toast_show(app: AppHandle, title: String, body: String, session: String) {
    show(&app, &title, &body, &session);
}

#[tauri::command]
pub fn toast_dismiss(app: AppHandle) {
    hide(&app);
}

#[tauri::command]
pub fn toast_activate(app: AppHandle, session: String) {
    hide(&app);
    crate::window::show_main(&app);
    if !session.is_empty() {
        let _ = app.emit("icyteru-feed-open", session);
    }
}
