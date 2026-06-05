//! Native notifications for configuration drift detected by the watcher.

use std::sync::Mutex;

use crate::shared_types::GitStatus;

static LAST_DRIFT_NOTIFICATION_ID: Mutex<Option<String>> = Mutex::new(None);

#[cfg(target_os = "macos")]
#[link(name = "UserNotifications", kind = "framework")]
extern "C" {}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DriftNotification {
    id: String,
    title: &'static str,
    body: String,
}

pub fn maybe_notify(git_status: Option<&GitStatus>, external_build_detected: bool) {
    let notification = notification_for_event(git_status, external_build_detected);
    let mut last_notification_id = match LAST_DRIFT_NOTIFICATION_ID.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let Some(notification) = notification else {
        *last_notification_id = None;
        return;
    };

    if last_notification_id.as_deref() == Some(notification.id.as_str()) {
        return;
    }

    // Don't let the one-shot external-build notification disrupt config-drift deduping.
    if notification.id != "external-build" {
        *last_notification_id = Some(notification.id.clone());
    }
    drop(last_notification_id);

    if let Err(error) = send_native_notification(notification.title, &notification.body) {
        log::warn!("Failed to send drift notification: {error}");
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

#[cfg(target_os = "macos")]
fn send_native_notification(title: &str, body: &str) -> Result<(), String> {
    use objc2::ffi::nil;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::{NSAutoreleasePool, NSString};

    unsafe {
        let pool = NSAutoreleasePool::new();
        let content: Retained<AnyObject> = msg_send![class!(UNMutableNotificationContent), new];
        let title = NSString::from_str(title);
        let body = NSString::from_str(body);
        let identifier = NSString::from_str(&format!("nixmac-drift-{}", uuid::Uuid::new_v4()));

        let _: () = msg_send![&content, setTitle: &*title];
        let _: () = msg_send![&content, setBody: &*body];

        let request: Retained<AnyObject> = msg_send![
            class!(UNNotificationRequest),
            requestWithIdentifier: &*identifier,
            content: &*content,
            trigger: nil
        ];

        let center: Retained<AnyObject> =
            msg_send![class!(UNUserNotificationCenter), currentNotificationCenter];
        let _: () =
            msg_send![&center, addNotificationRequest: &*request, withCompletionHandler: nil];

        pool.drain();
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn send_native_notification(_title: &str, _body: &str) -> Result<(), String> {
    Ok(())
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
}
