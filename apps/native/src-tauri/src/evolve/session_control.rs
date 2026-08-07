//! Session-scoped control state for an in-progress evolution run.
//!
//! Owns the cancellation flag and the question/response channel so that
//! the evolve loop can check cancellation and wait for user answers without
//! reaching back into `commands`.

pub const EVOLUTION_CANCELLED_MSG: &str = "Evolution cancelled by user";

/// Global flag to signal evolution cancellation.
static EVOLVE_CANCELLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Check if evolution has been cancelled.
pub fn is_evolve_cancelled() -> bool {
    EVOLVE_CANCELLED.load(std::sync::atomic::Ordering::SeqCst)
}

/// Set the cancellation flag.
pub fn set_evolve_cancelled(value: bool) {
    EVOLVE_CANCELLED.store(value, std::sync::atomic::Ordering::SeqCst);
}

/// Global flag: an evolution run is actively editing files right now.
///
/// The session's `evolution_id` is only written once generation finishes, so it
/// does not mark the window during which the agent is mutating the working
/// tree — precisely the window that produces a dirty-but-HEAD-unchanged repo
/// and trips a spurious "config drift" notification. The git watcher reads this
/// flag to suppress those notifications for the duration of the run.
static EVOLVE_IN_PROGRESS: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Whether an evolution run is currently editing files.
pub fn is_evolve_in_progress() -> bool {
    EVOLVE_IN_PROGRESS.load(std::sync::atomic::Ordering::SeqCst)
}

/// RAII guard that marks an evolution run as in progress for its lifetime.
///
/// The flag is set on construction and cleared on drop, so every exit path of
/// the evolve pipeline — early returns, `?`, and panics — resets it without a
/// scattered set of manual clears.
pub struct EvolveInProgressGuard(());

impl EvolveInProgressGuard {
    pub fn new() -> Self {
        EVOLVE_IN_PROGRESS.store(true, std::sync::atomic::Ordering::SeqCst);
        Self(())
    }
}

impl Default for EvolveInProgressGuard {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for EvolveInProgressGuard {
    fn drop(&mut self) {
        EVOLVE_IN_PROGRESS.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Global holder for an in-flight question sender.
/// We use a oneshot per-question so the evolve loop can await a response
/// without holding a mutex across an await (which would cause a deadlock).
static ONGOING_QUESTION: std::sync::OnceLock<
    tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<String>>>,
> = std::sync::OnceLock::new();

fn ongoing_question_slot()
-> &'static tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<String>>> {
    ONGOING_QUESTION.get_or_init(|| tokio::sync::Mutex::new(None))
}

/// Send a user's answer to the evolve loop's pending question.
pub async fn send_question_response(answer: String) -> anyhow::Result<()> {
    let slot = ongoing_question_slot();
    let mut guard = slot.lock().await;
    if let Some(tx) = guard.take() {
        tx.send(answer)
            .map_err(|_e| anyhow::anyhow!("Failed to send question response"))
    } else {
        Err(anyhow::anyhow!("No pending question to answer"))
    }
}

/// Wait for a user response to a question (called from the evolve loop).
pub async fn wait_for_question_response() -> Option<String> {
    let slot = ongoing_question_slot();

    // Create a oneshot for this question and register its sender globally.
    let (tx, rx) = tokio::sync::oneshot::channel();
    {
        let mut guard = slot.lock().await;
        // If there's already a pending question, replace it (dropping old sender).
        *guard = Some(tx);
    }

    rx.await.ok()
}
