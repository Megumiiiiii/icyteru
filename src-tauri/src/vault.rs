use std::{fs, path::PathBuf};

use aes_gcm::{Aes256Gcm, KeyInit, Nonce, aead::Aead};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use zeroize::Zeroize;

const SERVICE: &str = "dev.megumii.icyteru.canary";
const ACCOUNT: &str = "master-key";

#[derive(Serialize, Deserialize)]
#[serde(tag = "alg", rename_all = "kebab-case")]
enum Envelope {
    Aes256Gcm { nonce: String, ciphertext: String },
    Plain { value: String },
}

fn vault_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("connection.json"))
}

fn key_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|error| error.to_string())
}

fn read_key() -> Result<Option<[u8; 32]>, String> {
    let entry = key_entry()?;
    match entry.get_password() {
        Ok(encoded) => {
            let bytes = STANDARD
                .decode(encoded)
                .map_err(|_| "The saved credential key is invalid.".to_string())?;
            let key: [u8; 32] = bytes
                .try_into()
                .map_err(|_| "The saved credential key has the wrong size.".to_string())?;
            Ok(Some(key))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn create_key() -> Result<[u8; 32], String> {
    let mut key = rand::random::<[u8; 32]>();
    let encoded = STANDARD.encode(key);
    if let Err(error) = key_entry().and_then(|entry| {
        entry
            .set_password(&encoded)
            .map_err(|error| error.to_string())
    }) {
        key.zeroize();
        return Err(error);
    }
    Ok(key)
}

fn save_file(path: &PathBuf, envelope: &Envelope) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(envelope).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn vault_load(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = vault_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let envelope: Envelope =
        serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?)
            .map_err(|_| "The saved connection file is invalid.".to_string())?;
    match envelope {
        Envelope::Plain { value } => Ok(Some(value)),
        Envelope::Aes256Gcm { nonce, ciphertext } => {
            let mut key = read_key()?
                .ok_or_else(|| "The operating system credential key is missing.".to_string())?;
            let nonce = STANDARD
                .decode(nonce)
                .map_err(|_| "The saved credential nonce is invalid.".to_string())?;
            if nonce.len() != 12 {
                return Err("The saved credential nonce has the wrong size.".to_string());
            }
            let ciphertext = STANDARD
                .decode(ciphertext)
                .map_err(|_| "The saved credentials are invalid.".to_string())?;
            let cipher = Aes256Gcm::new_from_slice(&key)
                .map_err(|_| "Could not open the credential vault.".to_string())?;
            let plaintext = cipher
                .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
                .map_err(|_| {
                    "The operating system could not decrypt the saved credentials.".to_string()
                })?;
            key.zeroize();
            String::from_utf8(plaintext)
                .map(Some)
                .map_err(|_| "The saved credentials are not valid text.".to_string())
        }
    }
}

#[tauri::command]
pub fn vault_save(app: tauri::AppHandle, value: String) -> Result<(), String> {
    let path = vault_path(&app)?;
    let existing_key = read_key().unwrap_or(None);
    let envelope = match existing_key {
        Some(mut key) => {
            let nonce = rand::random::<[u8; 12]>();
            let cipher = Aes256Gcm::new_from_slice(&key)
                .map_err(|_| "Could not open the credential vault.".to_string())?;
            let ciphertext = cipher
                .encrypt(Nonce::from_slice(&nonce), value.as_bytes())
                .map_err(|_| "Could not encrypt the saved credentials.".to_string())?;
            key.zeroize();
            Envelope::Aes256Gcm {
                nonce: STANDARD.encode(nonce),
                ciphertext: STANDARD.encode(ciphertext),
            }
        }
        None => match create_key() {
            Ok(mut key) => {
                let nonce = rand::random::<[u8; 12]>();
                let cipher = Aes256Gcm::new_from_slice(&key)
                    .map_err(|_| "Could not open the credential vault.".to_string())?;
                let ciphertext = cipher
                    .encrypt(Nonce::from_slice(&nonce), value.as_bytes())
                    .map_err(|_| "Could not encrypt the saved credentials.".to_string())?;
                key.zeroize();
                Envelope::Aes256Gcm {
                    nonce: STANDARD.encode(nonce),
                    ciphertext: STANDARD.encode(ciphertext),
                }
            }
            Err(_) => Envelope::Plain { value },
        },
    };
    save_file(&path, &envelope)
}

#[tauri::command]
pub fn vault_clear(app: tauri::AppHandle) -> Result<(), String> {
    let path = vault_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    if let Ok(entry) = key_entry() {
        let _ = entry.delete_credential();
    }
    Ok(())
}
