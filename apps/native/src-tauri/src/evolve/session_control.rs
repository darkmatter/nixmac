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

/// Global holder for an in-flight question sender.
/// We use a oneshot per-question so the evolve loop can await a response
/// without holding a mutex across an await (which would cause a deadlock).
static ONGOING_QUESTION: std::sync::OnceLock<
    tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<String>>>,
> = std::sync::OnceLock::new();

fn ongoing_question_slot(
) -> &'static tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<String>>> {
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
