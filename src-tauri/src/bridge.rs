use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use futures_util::{SinkExt, StreamExt};
use reqwest::{Client, Method, header::SET_COOKIE};
use serde::Serialize;
use tauri::ipc::Channel;
use tokio::sync::{Mutex, mpsc};
use tokio_tungstenite::tungstenite::{Message, client::IntoClientRequest};

#[derive(Clone)]
pub struct Bridge {
    http: Client,
    sockets: Arc<Mutex<HashMap<u64, mpsc::UnboundedSender<WsCommand>>>>,
    next_socket: Arc<AtomicU64>,
}

impl Bridge {
    pub fn new() -> Result<Self, String> {
        let http = Client::builder()
            .user_agent(format!("Icyteru/{}", env!("CARGO_PKG_VERSION")))
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self {
            http,
            sockets: Arc::new(Mutex::new(HashMap::new())),
            next_socket: Arc::new(AtomicU64::new(1)),
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayResponse {
    status: u16,
    headers: Vec<(String, String)>,
    set_cookie: Vec<String>,
    body: String,
    body_b64: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WsFrame {
    Open { id: u64 },
    Text { data: String },
    Close { code: u16, reason: String },
    Error { message: String },
}

enum WsCommand {
    Text(String),
    Close,
}

fn safe_error(error: impl ToString) -> String {
    let raw = error.to_string();
    if let Ok(mut parsed) = url::Url::parse(&raw) {
        parsed.set_query(None);
        return parsed.to_string();
    }
    raw.split('?')
        .next()
        .unwrap_or("Network request failed.")
        .to_string()
}

#[tauri::command]
pub async fn gateway_request(
    state: tauri::State<'_, Bridge>,
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<GatewayResponse, String> {
    let parsed =
        reqwest::Url::parse(&url).map_err(|_| "That gateway URL is invalid.".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http(s) gateway URLs are supported.".to_string());
    }
    let method = Method::from_bytes(method.as_bytes())
        .map_err(|_| "That HTTP method is invalid.".to_string())?;
    let mut request = state.http.request(method, parsed);
    for (name, value) in headers {
        request = request.header(name, value);
    }
    if let Some(body) = body {
        request = request.body(body);
    }
    let response = request.send().await.map_err(safe_error)?;
    let status = response.status().as_u16();
    let set_cookie = response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok().map(ToOwned::to_owned))
        .collect::<Vec<_>>();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect::<Vec<_>>();
    let textual = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value.starts_with("text/")
                || value.contains("json")
                || value.contains("javascript")
                || value.contains("xml")
        })
        .unwrap_or(false);
    let bytes = response.bytes().await.map_err(safe_error)?;
    if textual {
        Ok(GatewayResponse {
            status,
            headers,
            set_cookie,
            body: String::from_utf8_lossy(&bytes).into_owned(),
            body_b64: None,
        })
    } else {
        Ok(GatewayResponse {
            status,
            headers,
            set_cookie,
            body: String::new(),
            body_b64: Some(STANDARD.encode(bytes)),
        })
    }
}

#[tauri::command]
pub async fn ws_open(
    state: tauri::State<'_, Bridge>,
    url: String,
    protocols: Vec<String>,
    on_frame: Channel<WsFrame>,
) -> Result<u64, String> {
    let parsed = url::Url::parse(&url).map_err(|_| "That WebSocket URL is invalid.".to_string())?;
    if parsed.scheme() != "ws" && parsed.scheme() != "wss" {
        return Err("Only ws(s) gateway URLs are supported.".to_string());
    }
    let mut request = url.as_str().into_client_request().map_err(safe_error)?;
    if !protocols.is_empty() {
        let value = protocols
            .join(", ")
            .parse()
            .map_err(|_| "Invalid WebSocket protocol.".to_string())?;
        request
            .headers_mut()
            .insert("Sec-WebSocket-Protocol", value);
    }
    let (socket, _) = tokio::time::timeout(
        Duration::from_secs(10),
        tokio_tungstenite::connect_async(request),
    )
    .await
    .map_err(|_| "The gateway did not answer the WebSocket handshake in time.".to_string())?
    .map_err(safe_error)?;
    let id = state.next_socket.fetch_add(1, Ordering::Relaxed);
    let (commands_tx, mut commands_rx) = mpsc::unbounded_channel();
    state.sockets.lock().await.insert(id, commands_tx);
    let bridge = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        let (mut writer, mut reader) = socket.split();
        let _ = on_frame.send(WsFrame::Open { id });
        let terminal = loop {
            tokio::select! {
                command = commands_rx.recv() => match command {
                    Some(WsCommand::Text(text)) => {
                        if let Err(error) = writer.send(Message::Text(text.into())).await {
                            break WsFrame::Close { code: 1006, reason: safe_error(error) };
                        }
                    }
                    Some(WsCommand::Close) | None => {
                        let _ = writer.send(Message::Close(None)).await;
                        break WsFrame::Close { code: 1000, reason: String::new() };
                    }
                },
                message = reader.next() => match message {
                    Some(Ok(Message::Text(text))) => {
                        let _ = on_frame.send(WsFrame::Text { data: text.to_string() });
                    }
                    Some(Ok(Message::Binary(bytes))) => {
                        if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                            let _ = on_frame.send(WsFrame::Text { data: text });
                        }
                    }
                    Some(Ok(Message::Close(frame))) => {
                        let (code, reason) = frame
                            .map(|frame| (u16::from(frame.code), frame.reason.to_string()))
                            .unwrap_or((1000, String::new()));
                        break WsFrame::Close { code, reason };
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        let _ = writer.send(Message::Pong(payload)).await;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(error)) => {
                        let message = safe_error(error);
                        let _ = on_frame.send(WsFrame::Error { message: message.clone() });
                        break WsFrame::Close { code: 1006, reason: message };
                    }
                    None => break WsFrame::Close { code: 1006, reason: "The gateway connection ended.".to_string() },
                }
            }
        };
        bridge.sockets.lock().await.remove(&id);
        let _ = on_frame.send(terminal);
    });
    Ok(id)
}

#[tauri::command]
pub async fn ws_send(state: tauri::State<'_, Bridge>, id: u64, data: String) -> Result<(), String> {
    let sockets = state.sockets.lock().await;
    let sender = sockets
        .get(&id)
        .ok_or_else(|| "That WebSocket is closed.".to_string())?;
    sender
        .send(WsCommand::Text(data))
        .map_err(|_| "That WebSocket is closed.".to_string())
}

#[tauri::command]
pub async fn ws_close(state: tauri::State<'_, Bridge>, id: u64) -> Result<(), String> {
    if let Some(sender) = state.sockets.lock().await.get(&id) {
        let _ = sender.send(WsCommand::Close);
    }
    Ok(())
}
