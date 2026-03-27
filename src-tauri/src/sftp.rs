use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use russh::keys::key::PublicKey;
use russh::client;
use russh_sftp::client::SftpSession;
use tokio::sync::Mutex;

// ---------------------------------------------------------------------------
// SSH client handler — accepts all host keys (matches existing SSH behavior)
// ---------------------------------------------------------------------------

pub struct SftpClientHandler;

#[async_trait]
impl client::Handler for SftpClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        // Accept all keys — mirrors `-o StrictHostKeyChecking=accept-new`
        Ok(true)
    }
}

// ---------------------------------------------------------------------------
// SFTP session wrapper
// ---------------------------------------------------------------------------

pub struct SftpSessionHandle {
    pub session_id: String,
    pub host_id: String,
    pub sftp: SftpSession,
    #[allow(dead_code)]
    pub ssh_handle: client::Handle<SftpClientHandler>,
}

// ---------------------------------------------------------------------------
// SFTP manager — Tauri-managed state
// ---------------------------------------------------------------------------

pub struct SftpManager {
    pub sessions: Arc<Mutex<HashMap<String, SftpSessionHandle>>>,
}

impl SftpManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

// ---------------------------------------------------------------------------
// Connection helper
// ---------------------------------------------------------------------------

pub struct HostCredentials {
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub password: Option<String>,
    pub key_path: Option<String>,
}

pub async fn connect_sftp(creds: &HostCredentials) -> Result<(SftpSession, client::Handle<SftpClientHandler>), String> {
    let config = Arc::new(client::Config::default());
    let handler = SftpClientHandler;

    let mut handle = client::connect(config, (creds.hostname.as_str(), creds.port), handler)
        .await
        .map_err(|e| format!("SSH connection failed: {e}"))?;

    // Authenticate
    match creds.auth_type.as_str() {
        "key" => {
            let key_path = creds.key_path.as_deref().ok_or("No SSH key path configured")?;
            let key_pair = russh_keys::load_secret_key(key_path, None)
                .map_err(|e| format!(
                    "Failed to load SSH key '{}': {}. The key may be passphrase-protected (not yet supported) or in an unsupported format.",
                    key_path, e
                ))?;
            let authenticated = handle
                .authenticate_publickey(&creds.username, Arc::new(key_pair))
                .await
                .map_err(|e| format!("Key authentication failed: {e}"))?;
            if !authenticated {
                return Err("Key authentication rejected by server".into());
            }
        }
        _ => {
            let password = creds.password.as_deref().unwrap_or("");
            let authenticated = handle
                .authenticate_password(&creds.username, password)
                .await
                .map_err(|e| format!("Password authentication failed: {e}"))?;
            if !authenticated {
                return Err("Password authentication rejected by server".into());
            }
        }
    }

    // Open SFTP subsystem
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open SSH channel: {e}"))?;

    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("Failed to request SFTP subsystem: {e}"))?;

    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("Failed to initialize SFTP session: {e}"))?;

    Ok((sftp, handle))
}
