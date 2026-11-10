//! Native notifications for configuration drift detected by the watcher.

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, Runtime};

use crate::shared_types::{EvolveSession, GitStatus};

static LAST_DRIFT_NOTIFICATION_ID: Mutex<Option<String>> = Mutex::new(None);
static DRIFT_GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, PartialEq, Eq)]
struct DriftNotification {
    id: String,
    title: &'static str,
    body: String,
}

pub fn maybe_notify(git_status: Option<&GitStatus>, external_build_detected: bool) {
    let notification = notification_for_event(git_status, external_build_detected);

    let Some(notification) = notification else {
        set_last_notification_id(None);
        DRIFT_GENERATION.fetch_add(1, Ordering::SeqCst);
        if let Some(app) = crate::APP_HANDLE.get()
            && crate::main_window::active(app).is_popover()
        {
            crate::attention::clear_drift(app);
        }
        return;
    };

    if let Some(app) = crate::APP_HANDLE.get()
        && crate::main_window::active(app).is_popover()
    {
        if notification.id != "external-build"
            && (crate::evolve::session_control::is_evolve_active()
                || session_owns_current_changes(app, &crate::state::evolve_state::get_session(app)))
        {
            return;
        }
        // The attention backend owns popover deduplication because it knows
        // whether the window was unattended when delivery was attempted.
        // A focused-window observation must not consume a future notice.
        let generation = if notification.id == "external-build" {
            DRIFT_GENERATION.fetch_add(1, Ordering::SeqCst) + 1
        } else {
            DRIFT_GENERATION.load(Ordering::SeqCst)
        };
        let attention_id = attention_drift_id(&notification.id, generation);
        crate::attention::drift(app, &attention_id, notification.title, &notification.body);
        return;
    }

    if !claim_notification_id(&notification.id, notification.id != "external-build") {
        return;
    }
    if let Err(error) = send_native_notification(notification.title, &notification.body) {
        log::warn!("Failed to send drift notification: {error}");
    }
}

fn set_last_notification_id(id: Option<String>) {
    match LAST_DRIFT_NOTIFICATION_ID.lock() {
        Ok(mut guard) => *guard = id,
        Err(poisoned) => *poisoned.into_inner() = id,
    }
}

fn claim_notification(last: &mut Option<String>, id: &str, remember: bool) -> bool {
    if last.as_deref() == Some(id) {
        return false;
    }
    // Don't let the one-shot external-build notification disrupt config-drift deduping.
    if remember {
        *last = Some(id.to_string());
    }
    true
}

fn claim_notification_id(id: &str, remember: bool) -> bool {
    let mut last = match LAST_DRIFT_NOTIFICATION_ID.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    claim_notification(&mut last, id, remember)
}

fn attention_drift_id(notification_id: &str, generation: u64) -> String {
    format!("{notification_id}:{generation}")
}

fn session_owns_current_changes<R: Runtime>(app: &AppHandle<R>, session: &EvolveSession) -> bool {
    let (Some(_), Some(snapshot_id)) = (session.evolution_id, session.current_changeset_id) else {
        return false;
    };
    // A pending session can outlive the agent run. Only its exact recorded
    // changes are covered by completion attention; later manual edits need
    // their own drift notice. Use the same base ref as the stored snapshot,
    // which may include a backup of manual changes that preceded the run.
    let base_ref = crate::summarize::active_summary_base_ref(app);
    crate::summarize::found_since(app, &base_ref)
        .ok()
        .flatten()
        .is_some_and(|found| found.snapshot_id == Some(snapshot_id))
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
    if !crate::attention::plugin_notification_backend_allowed(app_handle) {
        return Err(
            "plugin-backed notifications are disabled in menu-bar popover mode".to_string(),
        );
    }

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

    #[tokio::test]
    async fn pending_evolution_only_suppresses_its_recorded_changes() {
        use crate::observable::Observable;
        use crate::shared_types::GlobalPreferences;
        use tauri::Manager;

        let temp = tempfile::tempdir().unwrap();
        let config_dir = temp.path().join("config");
        std::fs::create_dir(&config_dir).unwrap();
        let repo = git2::Repository::init(&config_dir).unwrap();
        let config_file = config_dir.join("flake.nix");
        std::fs::write(&config_file, "initial\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("flake.nix")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let signature = git2::Signature::now("nixmac", "nixmac@local").unwrap();
        repo.commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
            .unwrap();

        // The agent started from pre-existing manual changes, so its stored
        // snapshot is relative to the backup rather than HEAD.
        std::fs::write(&config_file, "manual baseline\n").unwrap();
        let dir = config_dir.to_string_lossy().to_string();
        let backup = crate::git::create_evolution_backup(&dir, None, 0)
            .unwrap()
            .unwrap();
        std::fs::write(&config_file, "agent result\n").unwrap();
        let hashes = crate::git::query::changes_since_ref(&dir, &backup)
            .unwrap()
            .into_iter()
            .map(|diff| crate::git::file_diff_to_change(diff, 0, false).hash)
            .collect::<Vec<_>>();
        let pool = crate::db::init_pool_at_path(&temp.path().join("nixmac.db"))
            .await
            .unwrap();
        let snapshot_id = crate::db::snapshots::upsert(
            &pool,
            &crate::db::keys::snapshot_key(&hashes),
            None,
            None,
            0,
        )
        .unwrap();
        let session = EvolveSession {
            evolution_id: Some(1),
            current_changeset_id: Some(snapshot_id),
            rollback_branch: Some(backup),
            ..Default::default()
        };
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        app.manage(pool);
        app.manage(Observable::new(GlobalPreferences {
            config_dir: Some(dir),
            ..Default::default()
        }));
        app.manage(Observable::new(session.clone()));

        assert!(session_owns_current_changes(app.handle(), &session));
        std::fs::write(&config_file, "manual edit after generation\n").unwrap();
        assert!(!session_owns_current_changes(app.handle(), &session));
        assert!(!session_owns_current_changes(
            app.handle(),
            &EvolveSession::default()
        ));
    }

    #[test]
    fn control_mode_keeps_existing_dedupe_behavior() {
        let mut last = None;
        assert!(claim_notification(&mut last, "config-drift:abc123", true));
        assert!(!claim_notification(&mut last, "config-drift:abc123", true));
        assert!(claim_notification(&mut last, "external-build", false));
        assert_eq!(last.as_deref(), Some("config-drift:abc123"));
    }

    #[test]
    fn a_clean_transition_allows_the_same_head_to_notify_again() {
        assert_ne!(
            attention_drift_id("config-drift:abc123", 1),
            attention_drift_id("config-drift:abc123", 2)
        );
    }
}
