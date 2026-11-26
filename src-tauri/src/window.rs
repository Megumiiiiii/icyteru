//! Window chrome preferences: what the X button does, plus the tray icon that
//! keeps a hidden window reachable.

use std::{
    fs,
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, WindowEvent,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

pub const QUIT: &str = "quit";
pub const TRAY: &str = "tray";

/// Handles the tray menu needs to keep updating after the app is running.
pub struct Tray {
    open: MenuItem<tauri::Wry>,
}

fn shorten(text: &str) -> String {
    let trimmed = text.trim();
    let mut out: String = trimmed.chars().take(48).collect();
    if trimmed.chars().count() > 48 {
        out.push('…');
    }
    out
}

/// Called for every notification: an OS toast cannot be clicked, so the tray
/// menu carries the actionable entry and the taskbar button flashes.
pub fn note_notification(app: &AppHandle, title: &str) {
    if let Some(tray) = app.try_state::<Tray>() {
        let label = if title.trim().is_empty() {
            "Open last notification".to_string()
        } else {
            format!("Open: {}", shorten(title))
        };
        let _ = tray.open.set_text(label);
        let _ = tray.open.set_enabled(true);
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
    }
}

#[derive(Default)]
pub struct WindowPrefs {
    behavior: Mutex<Option<String>>,
    quitting: AtomicBool,
}

#[derive(Serialize, Deserialize)]
struct Stored {
    #[serde(default)]
    behavior: String,
}

fn prefs_path(app: &AppHandle) -> Option<PathBuf> {
    let directory = app.path().app_config_dir().ok()?;
    let _ = fs::create_dir_all(&directory);
    Some(directory.join("window.json"))
}

fn normalize(value: &str) -> String {
    if value == TRAY {
        TRAY.to_string()
    } else {
        QUIT.to_string()
    }
}

impl WindowPrefs {
    /// Read once, then keep in memory: the close handler runs on every click.
    fn behavior(&self, app: &AppHandle) -> String {
        let mut slot = self
            .behavior
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(value) = slot.as_ref() {
            return value.clone();
        }
        let stored = prefs_path(app)
            .and_then(|path| fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice::<Stored>(&bytes).ok())
            .map(|stored| normalize(&stored.behavior))
            .unwrap_or_else(|| QUIT.to_string());
        *slot = Some(stored.clone());
        stored
    }

    fn set(&self, app: &AppHandle, value: &str) -> Result<String, String> {
        let next = normalize(value);
        if let Some(path) = prefs_path(app) {
            let payload = serde_json::to_vec_pretty(&Stored {
                behavior: next.clone(),
            })
            .map_err(|error| error.to_string())?;
            fs::write(path, payload).map_err(|error| error.to_string())?;
        }
        let mut slot = self
            .behavior
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        *slot = Some(next.clone());
        Ok(next)
    }
}

#[tauri::command]
pub fn get_close_behavior(app: AppHandle, state: tauri::State<'_, WindowPrefs>) -> String {
    state.behavior(&app)
}

#[tauri::command]
pub fn set_close_behavior(
    app: AppHandle,
    state: tauri::State<'_, WindowPrefs>,
    value: String,
) -> Result<String, String> {
    state.set(&app, &value)
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Returning true means the close was swallowed and the window now sits in the tray.
pub fn intercept_close(window: &tauri::Window) -> bool {
    let app = window.app_handle();
    let state = app.state::<WindowPrefs>();
    if state.quitting.load(Ordering::Relaxed) || state.behavior(app) != TRAY {
        return false;
    }
    let _ = window.hide();
    true
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "No new notifications", false, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show Icyteru", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Icyteru", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &show, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .or_else(|| tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png")).ok());
    let mut builder = TrayIconBuilder::with_id("icyteru")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Icyteru")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                let session = crate::feed::take_pending(app).unwrap_or_default();
                show_main(app);
                if !session.is_empty() {
                    let _ = app.emit("icyteru-feed-open", session);
                }
            }
            "show" => show_main(app),
            "quit" => {
                if let Some(state) = app.try_state::<WindowPrefs>() {
                    state.quitting.store(true, Ordering::Relaxed);
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    app.manage(Tray { open });
    Ok(())
}

/// Keep the tray icon working even when the window closes for real, and turn a
/// notification into a session switch when the user comes back.
pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            if intercept_close(window) {
                api.prevent_close();
            }
        }
        WindowEvent::Focused(true) => {
            let app = window.app_handle();
            // Kept so a future notification surface can claim it; nothing shows
            // an overlay window any more.
            let _ = crate::feed::take_pending(app);
        }
        _ => {}
    }
}
