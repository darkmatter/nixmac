use crate::privileged_helper::protocol::{
    ActivateStorePathRequest, HELPER_SOCKET_PATH, HelperRequest, HelperResponse,
};
use anyhow::{Context, Result, bail};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::time::Duration;

const CLIENT_TIMEOUT: Duration = Duration::from_secs(30);
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// Status probes back the permissions UI; a wedged helper must not stall a
/// permissions refresh, so they get a short leash instead of CLIENT_TIMEOUT.
const STATUS_PROBE_TIMEOUT: Duration = Duration::from_secs(2);

pub fn socket_available() -> bool {
    std::path::Path::new(HELPER_SOCKET_PATH).exists()
}

fn request_with_timeout(request: &HelperRequest, timeout: Duration) -> Result<HelperResponse> {
    let mut stream = UnixStream::connect(HELPER_SOCKET_PATH)
        .with_context(|| format!("failed to connect to {HELPER_SOCKET_PATH}"))?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(CLIENT_TIMEOUT))?;

    let body = serde_json::to_vec(request)?;
    stream.write_all(&body)?;
    stream.write_all(b"\n")?;
    stream.flush()?;

    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line)?;
    if line.trim().is_empty() {
        bail!("helper returned an empty response");
    }

    Ok(serde_json::from_str(&line)?)
}

pub fn status() -> Result<HelperResponse> {
    request_with_timeout(&HelperRequest::Status, STATUS_PROBE_TIMEOUT)
}

pub fn activate_store_path(request_body: ActivateStorePathRequest) -> Result<HelperResponse> {
    request_with_timeout(
        &HelperRequest::ActivateStorePath {
            request: request_body,
        },
        ACTIVATION_TIMEOUT,
    )
}
