use crate::state::{evolve_state, watcher};
use crate::storage::store;
use crate::system::nix;
use crate::{git, shared_types};
use sentry::Level;
use tauri::AppHandle;

pub trait SentryClient {
    fn capture_message(&self, msg: &str, level: Level);
}

pub struct RealSentryClient;

impl SentryClient for RealSentryClient {
    fn capture_message(&self, msg: &str, level: Level) {
        sentry::capture_message(msg, level);
    }
}

fn wrap_result_and_capture_err_with_client<T, E: ToString>(
    sentry_client: &dyn SentryClient,
    ctx: &str,
    result: Result<T, E>,
) -> Result<T, String>
where
    E: std::fmt::Display,
{
    result.map_err(|e| capture_err_with_client(sentry_client, ctx, e))
}

/// Wraps a store Result, capturing any error with Sentry and converting it to a string for UI display.
/// T is the success type (bool, String, etc)
/// E is the error type from your store
pub(super) fn wrap_result_and_capture_err<T, E>(ctx: &str, res: Result<T, E>) -> Result<T, String>
where
    E: std::fmt::Display, // This allows us to convert the error to a string
{
    let client = RealSentryClient;
    wrap_result_and_capture_err_with_client(&client, ctx, res)
}

fn capture_err_with_client<E: std::fmt::Display>(
    sentry_client: &dyn SentryClient,
    cmd: &str,
    e: E,
) -> String {
    sentry_client.capture_message(cmd, Level::Error);
    e.to_string()
}

pub(super) fn capture_err<E: std::fmt::Display>(cmd: &str, e: E) -> String {
    let client = RealSentryClient;
    capture_err_with_client(&client, cmd, e)
}

/// Initializes app state after switching to a new config directory:
/// caches git status, starts the file watcher, resets evolve state, and lists hosts.
pub(super) fn handle_new_config_dir(
    app: &AppHandle,
    dir: &str,
) -> Result<(shared_types::EvolveState, Option<Vec<String>>), String> {
    let git_status = git::status(dir).ok();
    let changes = git_status
        .as_ref()
        .map(|s| s.changes.clone())
        .unwrap_or_default();
    if let Some(ref s) = git_status {
        // fire-and-forget: cache is a best-effort perf optimization; watcher and evolution
        // will re-populate it. A store write failure here must not block dir switch.
        let _ = store::set_cached_git_status(app, s);
    }
    watcher::start_watching(app.clone(), dir.to_string(), 2500);
    let evolve_state = evolve_state::set(app, shared_types::EvolveState::default(), &changes)
        .map_err(|e| e.to_string())?;
    let hosts = nix::list_darwin_hosts(dir).ok();
    Ok((evolve_state, hosts))
}
#[cfg(test)]
mod tests {
    use super::*;
    use mockall::{mock, predicate::*};
    use sentry::Level;

    mock! {
        pub SentryClient {}

        impl super::SentryClient for SentryClient {
            fn capture_message(&self, msg: &str, level: Level);
        }
    }

    #[test]
    fn test_wrap_result_and_capture_err_success() {
        let ctx = "test_context";
        let result: Result<i32, &str> = Ok(42);

        let mock = MockSentryClient::new();

        assert_eq!(
            wrap_result_and_capture_err_with_client(&mock, ctx, result,),
            Ok(42)
        );
    }

    #[test]
    fn test_wrap_result_and_capture_err_failure() {
        let ctx = "test_context";
        let error_message = "Test Error";
        let result: Result<i32, &str> = Err(error_message);

        let mut mock = MockSentryClient::new();

        mock.expect_capture_message()
            .with(eq(ctx), eq(Level::Error))
            .times(1)
            .return_const(());

        assert_eq!(
            wrap_result_and_capture_err_with_client(&mock, ctx, result,),
            Err(String::from(error_message))
        );
    }

    #[test]
    fn test_capture_err() {
        let cmd = "test_command";
        let error_message = "Test Error";

        let mut mock = MockSentryClient::new();

        mock.expect_capture_message()
            .with(eq(cmd), eq(Level::Error))
            .times(1)
            .return_const(());

        let result = capture_err_with_client(&mock, cmd, error_message);

        assert_eq!(result, String::from(error_message));
    }
}
