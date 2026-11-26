//! Gateway notification feed polled natively.
//!
//! A WebView timer stops while the window is hidden, which is exactly when a
//! notification matters, so the poll loop lives here and hands each event to
//! both the OS and the renderer.

use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

#[derive(Default)]
pub struct Feed {
    stop: StdMutex<Option<oneshot::Sender<()>>>,
    active: Arc<StdMutex<String>>,
    /// The session the newest notification pointed at, waiting for the window to
    /// come forward. Tauri's notification plugin has no click callback, so the
    /// focus event is the closest honest signal.
    pending: Arc<StdMutex<Option<String>>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FeedEvent {
    session_id: String,
    title: String,
    body: String,
    at: i64,
}

#[derive(Deserialize)]
struct Envelope {
    #[serde(default)]
    events: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    #[serde(default)]
    session_id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    at: i64,
}

fn base(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn feed_start(
    app: AppHandle,
    state: tauri::State<'_, Feed>,
    url: String,
    token: String,
    cookie: String,
    active_session: String,
) -> Result<(), String> {
    feed_stop_inner(&state);
    if url.trim().is_empty() {
        return Ok(());
    }
    *state
        .active
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = active_session;
    let active = Arc::clone(&state.active);
    let pending = Arc::clone(&state.pending);
    let (stop, mut stopped) = oneshot::channel::<()>();
    *state.stop.lock().unwrap_or_else(|error| error.into_inner()) = Some(stop);
    let client = reqwest::Client::builder()
        .user_agent(format!("Icyteru/{}", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?;

    tauri::async_runtime::spawn(async move {
        let mut cursor = now();
        let endpoint = format!("{}/api/plugins/icyteru-push/events", base(&url));
        let mut ticker = tokio::time::interval(Duration::from_secs(4));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                _ = &mut stopped => break,
                _ = ticker.tick() => {}
            }
            let mut request = client.get(format!("{endpoint}?since={cursor}"));
            if !token.is_empty() {
                request = request.header("X-Hermes-Session-Token", &token);
            }
            if !cookie.is_empty() {
                request = request.header("Cookie", &cookie);
            }
            let response = match request.send().await {
                Ok(response) => response,
                Err(_) => continue,
            };
            if !response.status().is_success() {
                continue;
            }
            let envelope: Envelope = match response.json().await {
                Ok(envelope) => envelope,
                Err(_) => continue,
            };
            let current = active
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .clone();
            for entry in envelope.events {
                if entry.at > cursor {
                    cursor = entry.at;
                }
                if entry.session_id.is_empty() || entry.session_id == current {
                    continue;
                }
                let body = entry.body.chars().take(240).collect::<String>();
                let title = if entry.title.is_empty() {
                    "Icyteru".to_string()
                } else {
                    entry.title.clone()
                };
                crate::notify::send(&app, &title, &body, Some(entry.session_id.clone()));
                crate::window::note_notification(&app, &title);
                *pending.lock().unwrap_or_else(|error| error.into_inner()) =
                    Some(entry.session_id.clone());
                let _ = app.emit(
                    "icyteru-feed",
                    FeedEvent {
                        session_id: entry.session_id,
                        title: entry.title,
                        body,
                        at: entry.at,
                    },
                );
            }
        }
    });
    Ok(())
}

fn feed_stop_inner(state: &tauri::State<'_, Feed>) {
    if let Some(stop) = state
        .stop
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .take()
    {
        let _ = stop.send(());
    }
}

/// Called from the window's focus event: hands the pending session to the
/// renderer exactly once.
pub fn take_pending(app: &AppHandle) -> Option<String> {
    let state = app.try_state::<Feed>()?;
    state
        .pending
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .take()
}

#[tauri::command]
pub fn feed_stop(state: tauri::State<'_, Feed>) {
    feed_stop_inner(&state);
}

#[tauri::command]
pub fn feed_set_active_session(state: tauri::State<'_, Feed>, session_id: String) {
    *state
        .active
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = session_id;
}
