//! Native notifications for configuration drift detected by the watcher.

use std::sync::Mutex;

use crate::shared_types::GitStatus;

static LAST_DRIFT_NOTIFICATION_ID: Mutex<Option<String>> = Mutex::new(None);

#[derive(Debug, Clone, PartialEq, Eq)]
struct DriftNotification {
    id: String,
    title: &'static str,
    body: String,
}

/// The outcome of reconciling a computed notification against the last one:
/// what the dedupe key should become, and whether to actually send.
#[derive(Debug, Clone, PartialEq, Eq)]
struct NotificationDecision {
    new_last_id: Option<String>,
    send: bool,
}

/// Decide whether to send `notification` and what the dedupe key should become,
/// given the currently stored key and whether an evolution run is active.
///
/// Pure so the dedupe/suppression logic is unit-testable without the global
/// mutex or a live app handle.
fn resolve_notification(
    last_id: Option<&str>,
    notification: Option<&DriftNotification>,
    evolution_active: bool,
) -> NotificationDecision {
    let Some(notification) = notification else {
        // No drift: clear the dedupe key so the next real drift notifies.
        return NotificationDecision {
            new_last_id: None,
            send: false,
        };
    };

    // The one-shot external-build notification never participates in dedupe, so
    // it must not disturb the config-drift key on any path.
    let is_external_build = notification.id == "external-build";
    let key_after_config_drift = |last_id: Option<&str>| {
        if is_external_build {
            last_id.map(str::to_string)
        } else {
            Some(notification.id.clone())
        }
    };

    if evolution_active {
        // A dirty worktree with an unchanged HEAD is exactly what the agent
        // produces while editing, so suppress the popup. Still advance the
        // dedupe key to the drift we're hiding: if that same drift persists
        // once the run ends it stays deduped (no popup fires the instant the
        // evolution finishes), while a genuinely new drift afterwards notifies.
        return NotificationDecision {
            new_last_id: key_after_config_drift(last_id),
            send: false,
        };
    }

    // Already notified for this exact drift — stay quiet, key unchanged.
    if last_id == Some(notification.id.as_str()) {
        return NotificationDecision {
            new_last_id: last_id.map(str::to_string),
            send: false,
        };
    }

    NotificationDecision {
        new_last_id: key_after_config_drift(last_id),
        send: true,
    }
}

pub fn maybe_notify(
    git_status: Option<&GitStatus>,
    external_build_detected: bool,
    evolution_active: bool,
) {
    let notification = notification_for_event(git_status, external_build_detected);
    let mut last_notification_id = match LAST_DRIFT_NOTIFICATION_ID.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let decision = resolve_notification(
        last_notification_id.as_deref(),
        notification.as_ref(),
        evolution_active,
    );
    *last_notification_id = decision.new_last_id;
    drop(last_notification_id);

    if decision.send {
        // `send` is only ever true when a notification was computed.
        if let Some(notification) = notification
            && let Err(error) = send_native_notification(notification.title, &notification.body)
        {
            log::warn!("Failed to send drift notification: {error}");
        }
    }
}

fn notification_for_event(
    git_status: Option<&GitStatus>,
    external_build_detected: bool,
) -> Option<DriftNotification> {
    if external_build_detected {
        return Some(DriftNotification {
            id: "external-build".to_string(),
            title: "nixmac detected drift",
            body: "A nix build was detected outside nixmac. Open nixmac to review and continue."
                .to_string(),
        });
    }

    let status = git_status?;
    let file_count = status.files.len();
    if file_count == 0 {
        return None;
    }

    let change_noun = if file_count == 1 { "change" } else { "changes" };
    Some(DriftNotification {
        id: format!(
            "config-drift:{}",
            status.head_commit_hash.as_deref().unwrap_or("no-head")
        ),
        title: "nixmac detected config drift",
        body: format!(
            "{file_count} uncommitted {change_noun} in your nix config. Open nixmac to review, commit, or discard."
        ),
    })
}

fn send_native_notification(title: &str, body: &str) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    // The notification plugin is registered during GUI startup, so the global
    // app handle is available by the time the watcher emits drift notifications.
    let app_handle = crate::APP_HANDLE
        .get()
        .ok_or("App handle not initialized")?;

    app_handle
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared_types::{ChangeType, GitFileStatus, GitStatus};

    fn clean_status() -> GitStatus {
        GitStatus {
            files: Vec::new(),
            branch: Some("main".to_string()),
            diff: String::new(),
            additions: 0,
            deletions: 0,
            head_commit_hash: Some("abc123".to_string()),
            clean_head: true,
            changes: Vec::new(),
        }
    }

    #[test]
    fn no_notification_without_drift() {
        let status = clean_status();
        assert_eq!(notification_for_event(Some(&status), false), None);
    }

    #[test]
    fn external_build_drift_takes_priority() {
        let status = clean_status();
        assert_eq!(
            notification_for_event(Some(&status), true),
            Some(DriftNotification {
                id: "external-build".to_string(),
                title: "nixmac detected drift",
                body:
                    "A nix build was detected outside nixmac. Open nixmac to review and continue."
                        .to_string(),
            })
        );
    }

    #[test]
    fn uncommitted_config_drift_includes_file_count() {
        let mut status = clean_status();
        status.files = vec![GitFileStatus {
            path: "flake.nix".to_string(),
            change_type: ChangeType::Edited,
        }];
        status.diff = "diff --git a/flake.nix b/flake.nix".to_string();
        status.additions = 3;
        status.clean_head = false;

        assert_eq!(
            notification_for_event(Some(&status), false),
            Some(DriftNotification {
                id: "config-drift:abc123".to_string(),
                title: "nixmac detected config drift",
                body: "1 uncommitted change in your nix config. Open nixmac to review, commit, or discard."
                    .to_string(),
            })
        );
    }

    fn config_drift(head: &str) -> DriftNotification {
        DriftNotification {
            id: format!("config-drift:{head}"),
            title: "nixmac detected config drift",
            body: "drift".to_string(),
        }
    }

    fn external_build() -> DriftNotification {
        DriftNotification {
            id: "external-build".to_string(),
            title: "nixmac detected drift",
            body: "build".to_string(),
        }
    }

    #[test]
    fn sends_new_config_drift_and_dedupes_repeats() {
        let drift = config_drift("abc123");

        // First sighting fires and records the key.
        let first = resolve_notification(None, Some(&drift), false);
        assert!(first.send);
        assert_eq!(first.new_last_id.as_deref(), Some("config-drift:abc123"));

        // Same drift again is deduped.
        let repeat = resolve_notification(Some("config-drift:abc123"), Some(&drift), false);
        assert!(!repeat.send);
        assert_eq!(repeat.new_last_id.as_deref(), Some("config-drift:abc123"));
    }

    #[test]
    fn clears_key_when_drift_resolves() {
        let decision = resolve_notification(Some("config-drift:abc123"), None, false);
        assert!(!decision.send);
        assert_eq!(decision.new_last_id, None);
    }

    #[test]
    fn external_build_never_disturbs_the_config_drift_key() {
        let build = external_build();

        // Fires (external build is not deduped) but leaves the config-drift key.
        let decision = resolve_notification(Some("config-drift:abc123"), Some(&build), false);
        assert!(decision.send);
        assert_eq!(decision.new_last_id.as_deref(), Some("config-drift:abc123"));
    }

    #[test]
    fn evolution_active_suppresses_but_records_the_hidden_drift() {
        let drift = config_drift("abc123");

        // No popup, yet the key advances to the drift we're hiding so it stays
        // deduped once the evolution ends.
        let decision = resolve_notification(None, Some(&drift), true);
        assert!(!decision.send);
        assert_eq!(decision.new_last_id.as_deref(), Some("config-drift:abc123"));

        // The instant the run ends with that same drift still present: deduped,
        // so no popup fires.
        let after = resolve_notification(decision.new_last_id.as_deref(), Some(&drift), false);
        assert!(!after.send);
    }

    #[test]
    fn evolution_active_suppresses_external_build_without_touching_the_key() {
        let build = external_build();
        let decision = resolve_notification(Some("config-drift:abc123"), Some(&build), true);
        assert!(!decision.send);
        assert_eq!(decision.new_last_id.as_deref(), Some("config-drift:abc123"));
    }

    #[test]
    fn genuinely_new_drift_after_evolution_still_notifies() {
        // Hidden drift at one HEAD is recorded during the run...
        let hidden = resolve_notification(None, Some(&config_drift("abc123")), true);
        // ...then HEAD moves and new drift appears: it is not swallowed.
        let after = resolve_notification(
            hidden.new_last_id.as_deref(),
            Some(&config_drift("def456")),
            false,
        );
        assert!(after.send);
        assert_eq!(after.new_last_id.as_deref(), Some("config-drift:def456"));
    }
}
