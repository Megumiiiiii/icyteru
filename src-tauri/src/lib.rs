mod bridge;
mod feed;
mod files;
mod vault;
mod window;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let bridge = bridge::Bridge::new().expect("failed to create native gateway bridge");
    tauri::Builder::default()
        // Registered first: a second launch must never race the first one's vault file.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window::show_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            window::install(app.handle())?;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .on_window_event(|window, event| window::on_window_event(window, event))
        .manage(bridge)
        .manage(feed::Feed::default())
        .manage(window::WindowPrefs::default())
        .invoke_handler(tauri::generate_handler![
            bridge::gateway_request,
            bridge::ws_open,
            bridge::ws_send,
            bridge::ws_close,
            vault::vault_load,
            vault::vault_save,
            vault::vault_clear,
            vault::vault_import_electron,
            files::save_download,
            files::open_external,
            feed::feed_start,
            feed::feed_stop,
            feed::feed_set_active_session,
            window::get_close_behavior,
            window::set_close_behavior,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Icyteru Canary");
}
