//! Native notifications for configuration drift detected by the watcher.

use std::sync::Mutex;

use crate::shared_types::WatcherEvent;

static LAST_DRIFT_NOTIFICATION_ID: Mutex<Option<String>> = Mutex::new(None);

#[derive(Debug, Clone, PartialEq, Eq)]
struct DriftNotification {
    id: String,
    title: &'static str,
    body: String,
}

pub fn maybe_notify(event: &WatcherEvent) {
    let notification = notification_for_event(event);
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

    *last_notification_id = Some(notification.id.clone());
    drop(last_notification_id);

    if let Err(error) = send_native_notification(notification.title, &notification.body) {
        log::warn!("Failed to send drift notification: {error}");
    }
}

fn notification_for_event(event: &WatcherEvent) -> Option<DriftNotification> {
    if event.external_build_detected {
        return Some(DriftNotification {
            id: "external-build".to_string(),
            title: "nixmac detected drift",
            body: "A nix build was detected outside nixmac. Open nixmac to review and continue."
                .to_string(),
        });
    }

    let status = event.git_status.as_ref()?;
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
    use cocoa::base::{id, nil};
    use cocoa::foundation::{NSAutoreleasePool, NSString};
    use objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let pool = NSAutoreleasePool::new(nil);
        let notification: id = msg_send![class!(NSUserNotification), new];
        let title = NSString::alloc(nil).init_str(title);
        let body = NSString::alloc(nil).init_str(body);

        let _: () = msg_send![notification, setTitle: title];
        let _: () = msg_send![notification, setInformativeText: body];

        let center: id = msg_send![
            class!(NSUserNotificationCenter),
            defaultUserNotificationCenter
        ];
        let _: () = msg_send![center, deliverNotification: notification];

        let _: () = msg_send![notification, release];
        let _: () = msg_send![title, release];
        let _: () = msg_send![body, release];
        let _: () = msg_send![pool, drain];
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

    fn watcher_event(git_status: Option<GitStatus>, external_build_detected: bool) -> WatcherEvent {
        WatcherEvent {
            git_status,
            change_map: None,
            evolve_state: None,
            error: None,
            external_build_detected,
        }
    }

    #[test]
    fn no_notification_without_drift() {
        let event = watcher_event(Some(clean_status()), false);
        assert_eq!(notification_for_event(&event), None);
    }

    #[test]
    fn external_build_drift_takes_priority() {
        let event = watcher_event(Some(clean_status()), true);
        assert_eq!(
            notification_for_event(&event),
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

        let event = watcher_event(Some(status), false);
        assert_eq!(
            notification_for_event(&event),
            Some(DriftNotification {
                id: "config-drift:abc123".to_string(),
                title: "nixmac detected config drift",
                body: "1 uncommitted change in your nix config. Open nixmac to review, commit, or discard."
                    .to_string(),
            })
        );
    }
}
