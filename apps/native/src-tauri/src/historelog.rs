//! Debug logging for history restore operations.
//!
//!   TURN SWITCH ON/OFF HERE ↓
pub const VERBOSE: bool = false;

fn emit(step: &str, text: &str) {
    let label = format!("Restore — {step}");
    log::warn!("╔══ {label} ══╗");
    log::info!("{text}");
    log::warn!("╚══ {label} ══╝");
}

pub fn log_prepare(config_dir: &str) {
    if !VERBOSE {
        return;
    }
    let status = match crate::git::status(config_dir) {
        Ok(s) => s,
        Err(e) => { emit("prepare", &format!("git status error: {e}")); return; }
    };
    let files: Vec<&str> = status.files.iter().map(|f| f.path.as_str()).collect();
    emit(
        "prepare",
        &format!("checked out, {} file(s) changed:\n{}", files.len(), files.join("\n")),
    );
}

pub fn log_finalize(hash: &str) {
    if !VERBOSE {
        return;
    }
    emit("finalize", &format!("committed restore as {}", &hash[..hash.len().min(8)]));
}

pub fn log_abort(config_dir: &str) {
    if !VERBOSE {
        return;
    }
    let clean = crate::git::status(config_dir).map(|s| s.files.is_empty()).unwrap_or(false);
    emit("abort", &format!("working tree restored, clean={clean}"));
}
