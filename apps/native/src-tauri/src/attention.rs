//! Actionable native attention for the transient menu-bar window.
//!
//! On macOS, `NSUserNotificationCenter` has one process-wide delegate. Popover
//! mode therefore routes every notification through this module's owned
//! backend; plugin-backed sends are reserved for control-window mode. Delivery
//! reasserts our delegate immediately before posting so notification clicks
//! keep reopening the popover even if another backend touched the center.

use std::collections::HashSet;
use std::sync::{LazyLock, Mutex, TryLockError};

use tauri::{AppHandle, Manager, Runtime};

use crate::shared_types::EvolutionState;

const NOTIFICATION_ID_PREFIX: &str = "com.darkmatter.nixmac.attention.";
#[cfg(any(target_os = "macos", test))]
const NOTIFICATION_GENERATION_SEPARATOR: &str = ".generation.";
#[cfg(any(target_os = "macos", test))]
static ATTENTION_PROCESS_ID: LazyLock<String> = LazyLock::new(|| uuid::Uuid::new_v4().to_string());
static ATTENTION_STATE: LazyLock<Mutex<AttentionState>> =
    LazyLock::new(|| Mutex::new(AttentionState::default()));

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AttentionScope {
    Work,
    Drift,
}

#[derive(Debug, Default)]
struct ScopeState {
    generation: u64,
    claimed_notice_ids: HashSet<String>,
}

#[derive(Debug, Default)]
struct AttentionState {
    work: ScopeState,
    drift: ScopeState,
}

impl AttentionState {
    fn scope(&self, scope: AttentionScope) -> &ScopeState {
        match scope {
            AttentionScope::Work => &self.work,
            AttentionScope::Drift => &self.drift,
        }
    }

    fn scope_mut(&mut self, scope: AttentionScope) -> &mut ScopeState {
        match scope {
            AttentionScope::Work => &mut self.work,
            AttentionScope::Drift => &mut self.drift,
        }
    }

    fn generation(&self, scope: AttentionScope) -> u64 {
        self.scope(scope).generation
    }

    fn claim_if_current(
        &mut self,
        scope: AttentionScope,
        generation: u64,
        id: &str,
        eligible: bool,
    ) -> bool {
        let state = self.scope_mut(scope);
        if !eligible || state.generation != generation {
            return false;
        }
        state.claimed_notice_ids.insert(id.to_string())
    }

    fn release_if_current(&mut self, scope: AttentionScope, generation: u64, id: &str) -> bool {
        let state = self.scope_mut(scope);
        if state.generation != generation {
            return false;
        }
        state.claimed_notice_ids.remove(id)
    }

    fn release_current(&mut self, scope: AttentionScope, id: &str) -> bool {
        self.scope_mut(scope).claimed_notice_ids.remove(id)
    }

    fn clear(&mut self, scope: AttentionScope) -> u64 {
        let state = self.scope_mut(scope);
        state.generation = state.generation.wrapping_add(1);
        state.claimed_notice_ids.clear();
        state.generation
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AttentionKind {
    InputRequired,
    ChangesReady,
    AnswerReady,
    EvolutionPaused,
    EvolutionFailed,
    BuildSucceeded,
    BuildBlocked,
    BuildCheckFailed,
    BuildFailed,
    BuildFinalizationFailed,
    RestoreSucceeded,
    RestoreFinalizationFailed,
    Crash,
    Drift,
    Test,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Notice {
    id: String,
    title: String,
    body: String,
    request_attention: bool,
    scope: AttentionScope,
}

impl AttentionKind {
    fn notice(self, drift: Option<(&str, &str, &str)>) -> Notice {
        let (suffix, title, body, request_attention) = match self {
            Self::InputRequired => (
                "input-required",
                "nixmac needs your input",
                "Open nixmac to continue.",
                true,
            ),
            Self::ChangesReady => (
                "changes-ready",
                "Your changes are ready to review",
                "Open nixmac to review and Build & Test.",
                false,
            ),
            Self::AnswerReady => (
                "answer-ready",
                "nixmac has an answer",
                "Open nixmac to view the response.",
                false,
            ),
            Self::EvolutionPaused => (
                "evolution-paused",
                "nixmac paused the request",
                "A safety limit was reached. Open nixmac to review or continue.",
                true,
            ),
            Self::EvolutionFailed => (
                "evolution-failed",
                "nixmac needs attention",
                "The request stopped with an error. Open nixmac to review and retry.",
                true,
            ),
            Self::BuildSucceeded => (
                "build-succeeded",
                "Build & Test finished",
                "Open nixmac to review the result and continue.",
                false,
            ),
            Self::BuildBlocked => (
                "build-blocked",
                "Build & Test needs your input",
                "Open nixmac to resolve the blocker before continuing.",
                true,
            ),
            Self::BuildCheckFailed => (
                "build-check-failed",
                "Configuration check needs attention",
                "Open nixmac to review the changes that did not build.",
                true,
            ),
            Self::BuildFailed => (
                "build-failed",
                "System operation needs attention",
                "Open nixmac to review the failure and available recovery options.",
                true,
            ),
            Self::BuildFinalizationFailed => (
                "build-finalization-failed",
                "Your changes are active, but nixmac needs attention",
                "Open nixmac to review the result and prepare the Save step.",
                true,
            ),
            Self::RestoreSucceeded => (
                "restore-succeeded",
                "Restore finished",
                "Open nixmac to review the restored state.",
                false,
            ),
            Self::RestoreFinalizationFailed => (
                "restore-finalization-failed",
                "Restore finished, but nixmac needs attention",
                "Open nixmac to review the restored state and recovery details.",
                true,
            ),
            Self::Crash => (
                "crash",
                "nixmac hit an unexpected error",
                "Open nixmac to review the error and send feedback.",
                true,
            ),
            Self::Drift => {
                let (id, title, body) = drift.expect("drift notice requires its payload");
                return Notice {
                    id: format!("{NOTIFICATION_ID_PREFIX}drift.{id}"),
                    title: title.to_string(),
                    body: body.to_string(),
                    request_attention: false,
                    scope: AttentionScope::Drift,
                };
            }
            Self::Test => (
                "test",
                "nixmac notification test",
                "Click this notification to reopen nixmac.",
                false,
            ),
        };

        Notice {
            id: format!("{NOTIFICATION_ID_PREFIX}{suffix}"),
            title: title.to_string(),
            body: body.to_string(),
            request_attention,
            scope: AttentionScope::Work,
        }
    }
}

#[cfg(any(target_os = "macos", test))]
fn owned_notification_scope(identifier: Option<&str>) -> Option<AttentionScope> {
    let suffix = identifier?.strip_prefix(NOTIFICATION_ID_PREFIX)?;
    Some(if suffix.starts_with("drift.") {
        AttentionScope::Drift
    } else {
        AttentionScope::Work
    })
}

#[cfg(any(target_os = "macos", test))]
fn delivery_identifier(id: &str, generation: u64) -> String {
    format!(
        "{id}{NOTIFICATION_GENERATION_SEPARATOR}{}:{generation}",
        *ATTENTION_PROCESS_ID
    )
}

#[cfg(any(target_os = "macos", test))]
fn should_clear_delivered_notice(
    identifier: Option<&str>,
    scope: AttentionScope,
    generation: u64,
) -> bool {
    if owned_notification_scope(identifier) != Some(scope) {
        return false;
    }
    // Clear requests and new deliveries can be queued from different threads.
    // A delayed clear must leave notifications from its new generation intact.
    // Delivered notices survive app restarts, but the counter does not. A
    // different process ID (or a legacy identifier) is always obsolete.
    identifier
        .and_then(|id| id.rsplit_once(NOTIFICATION_GENERATION_SEPARATOR))
        .and_then(|(_, delivery)| delivery.split_once(':'))
        .and_then(|(process_id, generation)| {
            generation
                .parse::<u64>()
                .ok()
                .map(|generation| (process_id, generation))
        })
        .is_none_or(|(process_id, delivered_generation)| {
            process_id != *ATTENTION_PROCESS_ID || delivered_generation < generation
        })
}

fn completion_kind(state: &EvolutionState, conversational_response: bool) -> AttentionKind {
    match state {
        EvolutionState::Conversational => AttentionKind::AnswerReady,
        EvolutionState::LimitReached => AttentionKind::EvolutionPaused,
        EvolutionState::Generated => AttentionKind::ChangesReady,
        _ if conversational_response => AttentionKind::AnswerReady,
        _ => AttentionKind::ChangesReady,
    }
}

fn should_notify(is_popover: bool, visible: bool, focused: bool, even_if_attended: bool) -> bool {
    is_popover && (even_if_attended || !visible || !focused)
}

fn release_build_check_claim_if_attended(
    state: &mut AttentionState,
    is_popover: bool,
    visible: bool,
    focused: bool,
) -> bool {
    if !is_popover || !visible || !focused {
        return false;
    }
    state.release_current(
        AttentionScope::Work,
        &AttentionKind::BuildCheckFailed.notice(None).id,
    )
}

fn with_attention_state<T>(f: impl FnOnce(&mut AttentionState) -> T) -> T {
    let mut state = match ATTENTION_STATE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    f(&mut state)
}

fn attention_generation(scope: AttentionScope) -> u64 {
    with_attention_state(|state| state.generation(scope))
}

fn claim_notice(scope: AttentionScope, generation: u64, id: &str, eligible: bool) -> bool {
    with_attention_state(|state| state.claim_if_current(scope, generation, id, eligible))
}

fn clear_attention_state(scope: AttentionScope) -> u64 {
    with_attention_state(|state| state.clear(scope))
}

fn release_claim(scope: AttentionScope, generation: u64, id: &str) {
    with_attention_state(|state| state.release_if_current(scope, generation, id));
}

fn send<R: Runtime>(
    app: &AppHandle<R>,
    notice: Notice,
    even_if_attended: bool,
) -> Result<bool, String> {
    let generation = attention_generation(notice.scope);
    send_in_generation(app, notice, even_if_attended, generation)
}

fn send_in_generation<R: Runtime>(
    app: &AppHandle<R>,
    notice: Notice,
    even_if_attended: bool,
    generation: u64,
) -> Result<bool, String> {
    let scope = notice.scope;

    #[cfg(target_os = "macos")]
    {
        let app_for_delivery = app.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            let is_popover = crate::main_window::active(&app_for_delivery).is_popover();
            let (visible, focused) = app_for_delivery
                .get_webview_window("main")
                .map(|window| {
                    (
                        window.is_visible().unwrap_or(false),
                        window.is_focused().unwrap_or(false),
                    )
                })
                .unwrap_or((false, false));
            let eligible = should_notify(is_popover, visible, focused, even_if_attended);
            if !claim_notice(scope, generation, &notice.id, eligible) {
                return;
            }

            if notice.request_attention
                && let Some(window) = app_for_delivery.get_webview_window("main")
                && let Err(error) =
                    window.request_user_attention(Some(tauri::UserAttentionType::Informational))
            {
                log::warn!("Failed to request user attention: {error}");
            }

            let delivery_id = notice.id.clone();
            if let Err(error) = macos::deliver(notice, generation) {
                release_claim(scope, generation, &delivery_id);
                log::warn!("Failed to send attention notification: {error}");
            }
        }) {
            return Err(error.to_string());
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        use tauri_plugin_notification::NotificationExt;

        let is_popover = crate::main_window::active(app).is_popover();
        let (visible, focused) = app
            .get_webview_window("main")
            .map(|window| {
                (
                    window.is_visible().unwrap_or(false),
                    window.is_focused().unwrap_or(false),
                )
            })
            .unwrap_or((false, false));
        let eligible = should_notify(is_popover, visible, focused, even_if_attended);
        if !claim_notice(scope, generation, &notice.id, eligible) {
            return Ok(false);
        }

        if notice.request_attention
            && let Some(window) = app.get_webview_window("main")
            && let Err(error) =
                window.request_user_attention(Some(tauri::UserAttentionType::Informational))
        {
            log::warn!("Failed to request user attention: {error}");
        }

        if let Err(error) = app
            .notification()
            .builder()
            .title(notice.title)
            .body(notice.body)
            .show()
        {
            release_claim(scope, generation, &notice.id);
            return Err(error.to_string());
        }
    }

    Ok(true)
}

pub(crate) fn install(app: &AppHandle) -> Result<(), String> {
    if !crate::main_window::active(app).is_popover() {
        return Ok(());
    }
    install_backend()
}

fn plugin_notification_backend_allowed_for_mode(is_popover: bool) -> bool {
    #[cfg(target_os = "macos")]
    {
        !is_popover
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = is_popover;
        true
    }
}

/// Whether a caller may use `tauri_plugin_notification` without competing
/// with the popover's process-wide macOS notification delegate.
pub(crate) fn plugin_notification_backend_allowed<R: Runtime>(app: &AppHandle<R>) -> bool {
    plugin_notification_backend_allowed_for_mode(crate::main_window::active(app).is_popover())
}

#[cfg(target_os = "macos")]
fn install_backend() -> Result<(), String> {
    macos::install()
}

#[cfg(not(target_os = "macos"))]
fn install_backend() -> Result<(), String> {
    Ok(())
}

pub(crate) fn shutdown() {
    #[cfg(target_os = "macos")]
    macos::shutdown();
}

fn clear_scope<R: Runtime>(_app: &AppHandle<R>, scope: AttentionScope) {
    let _generation = clear_attention_state(scope);
    #[cfg(target_os = "macos")]
    if let Err(error) = _app.run_on_main_thread(move || macos::clear_delivered(scope, _generation))
    {
        log::debug!("Could not clear delivered attention notifications: {error}");
    }
}

pub(crate) fn clear_work<R: Runtime>(app: &AppHandle<R>) {
    clear_scope(app, AttentionScope::Work);
}

pub(crate) fn clear_drift<R: Runtime>(app: &AppHandle<R>) {
    clear_scope(app, AttentionScope::Drift);
}

pub(crate) fn input_required<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = send(app, AttentionKind::InputRequired.notice(None), false) {
        log::warn!("Failed to send input-required attention: {error}");
    }
}

pub(crate) fn evolution_completed<R: Runtime>(
    app: &AppHandle<R>,
    state: &EvolutionState,
    conversational_response: bool,
) {
    if let Err(error) = send(
        app,
        completion_kind(state, conversational_response).notice(None),
        false,
    ) {
        log::warn!("Failed to send evolution-complete attention: {error}");
    }
}

pub(crate) fn evolution_failed<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = send(app, AttentionKind::EvolutionFailed.notice(None), false) {
        log::warn!("Failed to send evolution-failed attention: {error}");
    }
}

pub(crate) fn build_succeeded<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = send(app, AttentionKind::BuildSucceeded.notice(None), false) {
        log::warn!("Failed to send build-succeeded attention: {error}");
    }
}

pub(crate) fn build_failed<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = send(app, AttentionKind::BuildFailed.notice(None), false) {
        log::warn!("Failed to send build-failed attention: {error}");
    }
}

pub(crate) fn build_blocked<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = send(app, AttentionKind::BuildBlocked.notice(None), false) {
        log::warn!("Failed to send build-blocked attention: {error}");
    }
}

pub(crate) fn build_check_failed<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = send(app, AttentionKind::BuildCheckFailed.notice(None), false) {
        log::warn!("Failed to send build-check attention: {error}");
    }
}

pub(crate) fn begin_build_check<R: Runtime>(app: &AppHandle<R>) {
    let is_popover = crate::main_window::active(app).is_popover();
    let (visible, focused) = app
        .get_webview_window("main")
        .map(|window| {
            (
                window.is_visible().unwrap_or(false),
                window.is_focused().unwrap_or(false),
            )
        })
        .unwrap_or((false, false));
    with_attention_state(|state| {
        release_build_check_claim_if_attended(state, is_popover, visible, focused)
    });
}

pub(crate) fn build_finalization_failed<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = send(
        app,
        AttentionKind::BuildFinalizationFailed.notice(None),
        false,
    ) {
        log::warn!("Failed to send build-finalization attention: {error}");
    }
}

pub(crate) fn restore_finished<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = send(app, AttentionKind::RestoreSucceeded.notice(None), false) {
        log::warn!("Failed to send restore-finished attention: {error}");
    }
}

pub(crate) fn restore_finalization_failed<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = send(
        app,
        AttentionKind::RestoreFinalizationFailed.notice(None),
        false,
    ) {
        log::warn!("Failed to send restore-finalization attention: {error}");
    }
}

fn try_crash_generation(state: &Mutex<AttentionState>) -> Option<u64> {
    let state = match state.try_lock() {
        Ok(state) => state,
        Err(TryLockError::Poisoned(error)) => error.into_inner(),
        Err(TryLockError::WouldBlock) => return None,
    };
    Some(state.generation(AttentionScope::Work))
}

pub(crate) fn crash<R: Runtime>(app: &AppHandle<R>) {
    // A panic may originate inside an attention-state mutation. Never wait on
    // its lock in the hook: unwinding must be able to release that same lock.
    let Some(generation) = try_crash_generation(&ATTENTION_STATE) else {
        return;
    };
    if let Err(error) =
        send_in_generation(app, AttentionKind::Crash.notice(None), false, generation)
    {
        log::warn!("Failed to send crash attention: {error}");
    }
}

pub(crate) fn drift<R: Runtime>(app: &AppHandle<R>, id: &str, title: &str, body: &str) {
    if let Err(error) = send(
        app,
        AttentionKind::Drift.notice(Some((id, title, body))),
        false,
    ) {
        log::warn!("Failed to send drift attention: {error}");
    }
}

pub(crate) fn test<R: Runtime>(app: &AppHandle<R>) {
    clear_work(app);
    if let Err(error) = send(app, AttentionKind::Test.notice(None), true) {
        log::warn!("Failed to send test attention: {error}");
    }
}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
mod macos {
    use std::cell::RefCell;

    use objc2::runtime::ProtocolObject;
    use objc2::{MainThreadOnly, define_class, msg_send, rc::Retained};
    use objc2_foundation::{
        MainThreadMarker, NSObject, NSObjectProtocol, NSString, NSUserNotification,
        NSUserNotificationCenter, NSUserNotificationCenterDelegate,
    };

    use super::{
        AttentionScope, Notice, delivery_identifier, owned_notification_scope,
        should_clear_delivered_notice,
    };

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum ActivationAction {
        Ignore,
        OpenMain,
    }

    fn activation_action(identifier: Option<&str>) -> ActivationAction {
        if owned_notification_scope(identifier).is_some() {
            ActivationAction::OpenMain
        } else {
            ActivationAction::Ignore
        }
    }

    define_class!(
        // SAFETY: NSObject has no subclassing requirements and this class has no Drop impl.
        #[unsafe(super = NSObject)]
        #[thread_kind = MainThreadOnly]
        #[ivars = ()]
        struct AttentionDelegate;

        // SAFETY: These delegate protocols add no invariants beyond their method signatures.
        unsafe impl NSObjectProtocol for AttentionDelegate {}

        #[allow(deprecated)]
        unsafe impl NSUserNotificationCenterDelegate for AttentionDelegate {
            #[unsafe(method(userNotificationCenter:didActivateNotification:))]
            fn did_activate(
                &self,
                center: &NSUserNotificationCenter,
                notification: &NSUserNotification,
            ) {
                let identifier = notification.identifier().map(|value| value.to_string());
                if activation_action(identifier.as_deref()) != ActivationAction::OpenMain {
                    return;
                }

                if let Some(app) = crate::APP_HANDLE.get() {
                    let mode = crate::main_window::active(app);
                    match crate::main_window::show(app, mode) {
                        Ok(()) => center.removeDeliveredNotification(notification),
                        Err(error) => {
                            log::warn!("Failed to open nixmac from a notification: {error}")
                        }
                    }
                }
            }

            #[unsafe(method(userNotificationCenter:shouldPresentNotification:))]
            fn should_present(
                &self,
                _center: &NSUserNotificationCenter,
                notification: &NSUserNotification,
            ) -> bool {
                let identifier = notification.identifier().map(|value| value.to_string());
                activation_action(identifier.as_deref()) == ActivationAction::OpenMain
            }
        }
    );

    impl AttentionDelegate {
        fn new(mtm: MainThreadMarker) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(());
            // SAFETY: NSObject's init signature is correct for this ivar-free subclass.
            unsafe { msg_send![super(this), init] }
        }
    }

    struct Installed {
        center: Retained<NSUserNotificationCenter>,
        delegate: Retained<AttentionDelegate>,
    }

    impl Installed {
        #[allow(deprecated)]
        fn reassert_delegate(&self) {
            // SAFETY: NSUserNotificationCenter keeps an unretained pointer; `delegate` is retained
            // alongside the center in main-thread storage for the entire installation lifetime.
            unsafe {
                self.center
                    .setDelegate(Some(ProtocolObject::from_ref(&*self.delegate)));
            }
        }
    }

    impl Drop for Installed {
        #[allow(deprecated)]
        fn drop(&mut self) {
            // SAFETY: Only clear the unretained pointer when it still points at our retained
            // delegate; another notification backend may have replaced it in the meantime.
            let current = unsafe { self.center.delegate() };
            let ours: &ProtocolObject<dyn NSUserNotificationCenterDelegate> =
                ProtocolObject::from_ref(&*self.delegate);
            if current
                .as_deref()
                .is_some_and(|delegate| std::ptr::eq(delegate, ours))
            {
                unsafe { self.center.setDelegate(None) };
            }
        }
    }

    thread_local! {
        static INSTALLED: RefCell<Option<Installed>> = const { RefCell::new(None) };
    }

    #[allow(deprecated)]
    pub(super) fn install() -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or_else(|| {
            "Attention notifications must be installed on the main thread".to_string()
        })?;
        INSTALLED.with(|slot| {
            let mut installed = slot.borrow_mut();
            if installed.is_none() {
                *installed = Some(Installed {
                    center: NSUserNotificationCenter::defaultUserNotificationCenter(),
                    delegate: AttentionDelegate::new(mtm),
                });
            }
            installed
                .as_ref()
                .expect("attention delegate was just installed")
                .reassert_delegate();
        });
        Ok(())
    }

    #[allow(deprecated)]
    pub(super) fn deliver(notice: Notice, generation: u64) -> Result<(), String> {
        install()?;
        INSTALLED.with(|slot| {
            let installed = slot.borrow();
            let installed = installed
                .as_ref()
                .ok_or_else(|| "Attention notification delegate is unavailable".to_string())?;
            installed.reassert_delegate();

            let notification = NSUserNotification::new();
            notification.setIdentifier(Some(&NSString::from_str(&delivery_identifier(
                &notice.id, generation,
            ))));
            notification.setTitle(Some(&NSString::from_str(&notice.title)));
            notification.setInformativeText(Some(&NSString::from_str(&notice.body)));
            installed.center.deliverNotification(&notification);
            Ok(())
        })
    }

    #[allow(deprecated)]
    pub(super) fn clear_delivered(scope: AttentionScope, generation: u64) {
        INSTALLED.with(|slot| {
            if let Some(installed) = slot.borrow().as_ref() {
                let delivered = installed.center.deliveredNotifications();
                for notification in delivered.iter() {
                    let identifier = notification.identifier().map(|value| value.to_string());
                    if should_clear_delivered_notice(identifier.as_deref(), scope, generation) {
                        installed.center.removeDeliveredNotification(&notification);
                    }
                }
            }
        });
    }

    pub(super) fn shutdown() {
        INSTALLED.with(|slot| {
            slot.borrow_mut().take();
        });
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn only_owned_attention_notifications_open_the_main_window() {
            assert_eq!(
                activation_action(Some("com.darkmatter.nixmac.attention.question")),
                ActivationAction::OpenMain
            );
            assert_eq!(
                activation_action(Some("com.darkmatter.nixmac.other")),
                ActivationAction::Ignore
            );
            assert_eq!(activation_action(None), ActivationAction::Ignore);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completion_attention_distinguishes_review_answer_and_pause() {
        assert_eq!(
            completion_kind(&EvolutionState::Generated, false),
            AttentionKind::ChangesReady
        );
        assert_eq!(
            completion_kind(&EvolutionState::Conversational, true),
            AttentionKind::AnswerReady
        );
        assert_eq!(
            completion_kind(&EvolutionState::LimitReached, false),
            AttentionKind::EvolutionPaused
        );
    }

    #[test]
    fn popover_attention_only_fires_when_away() {
        assert!(!should_notify(true, true, true, false));
        assert!(should_notify(true, true, false, false));
        assert!(should_notify(true, false, true, false));
        assert!(should_notify(true, true, true, true));
        assert!(!should_notify(false, false, false, true));
    }

    #[test]
    fn notice_copy_is_actionable_and_privacy_safe() {
        let input = AttentionKind::InputRequired.notice(None);
        assert_eq!(input.title, "nixmac needs your input");
        assert_eq!(input.body, "Open nixmac to continue.");
        assert!(input.id.starts_with(NOTIFICATION_ID_PREFIX));
    }

    #[test]
    fn build_outcomes_distinguish_success_failure_finalization_and_restore() {
        let success = AttentionKind::BuildSucceeded.notice(None);
        let failure = AttentionKind::BuildFailed.notice(None);
        let finalization = AttentionKind::BuildFinalizationFailed.notice(None);
        let restore = AttentionKind::RestoreSucceeded.notice(None);
        let restore_finalization = AttentionKind::RestoreFinalizationFailed.notice(None);

        assert_eq!(success.title, "Build & Test finished");
        assert!(!success.request_attention);
        assert_eq!(failure.title, "System operation needs attention");
        assert!(failure.request_attention);
        assert!(finalization.title.contains("changes are active"));
        assert_eq!(restore.title, "Restore finished");
        assert!(restore_finalization.title.contains("Restore finished"));
    }

    #[test]
    fn panic_attention_does_not_wait_on_an_already_held_state_lock() {
        let state = Mutex::new(AttentionState::default());
        let held = state.lock().unwrap();
        assert_eq!(try_crash_generation(&state), None);
        drop(held);
        assert_eq!(try_crash_generation(&state), Some(0));
    }

    #[test]
    fn attended_notice_does_not_consume_its_claim() {
        let mut state = AttentionState::default();
        let generation = state.generation(AttentionScope::Work);

        assert!(!state.claim_if_current(
            AttentionScope::Work,
            generation,
            "same",
            should_notify(true, true, true, false),
        ));
        assert!(state.claim_if_current(
            AttentionScope::Work,
            generation,
            "same",
            should_notify(true, false, false, false),
        ));
        assert!(!state.claim_if_current(AttentionScope::Work, generation, "same", true));
    }

    #[test]
    fn stale_generation_cannot_claim_after_clear() {
        let mut state = AttentionState::default();
        let stale_generation = state.generation(AttentionScope::Work);

        state.clear(AttentionScope::Work);

        assert!(!state.claim_if_current(AttentionScope::Work, stale_generation, "stale", true));
        assert!(state.claim_if_current(
            AttentionScope::Work,
            state.generation(AttentionScope::Work),
            "fresh",
            true
        ));
    }

    #[test]
    fn delayed_clear_preserves_deliveries_from_the_new_generation() {
        let mut state = AttentionState::default();
        let id = AttentionKind::BuildSucceeded.notice(None).id;
        let old_id = delivery_identifier(&id, state.generation(AttentionScope::Work));
        let clearing_generation = state.clear(AttentionScope::Work);
        let fresh_id = delivery_identifier(&id, state.generation(AttentionScope::Work));

        // Another thread queued a fresh delivery before this clear's Cocoa
        // callback reached the main thread. It must remain actionable.
        assert!(should_clear_delivered_notice(
            Some(&old_id),
            AttentionScope::Work,
            clearing_generation,
        ));
        assert!(!should_clear_delivered_notice(
            Some(&fresh_id),
            AttentionScope::Work,
            clearing_generation,
        ));
        assert!(should_clear_delivered_notice(
            Some(&fresh_id),
            AttentionScope::Work,
            state.clear(AttentionScope::Work),
        ));
    }

    #[test]
    fn clearing_delivered_notices_preserves_other_scopes_and_removes_legacy_ids() {
        let work = AttentionKind::BuildSucceeded.notice(None).id;
        let drift = AttentionKind::Drift
            .notice(Some(("external-build:1", "Drift", "Review")))
            .id;
        assert!(should_clear_delivered_notice(
            Some(&work),
            AttentionScope::Work,
            1
        ));
        assert!(!should_clear_delivered_notice(
            Some(&drift),
            AttentionScope::Work,
            1
        ));
        assert!(!should_clear_delivered_notice(
            None,
            AttentionScope::Work,
            1
        ));
        assert!(should_clear_delivered_notice(
            Some(&format!(
                "{work}{NOTIFICATION_GENERATION_SEPARATOR}previous-process:100"
            )),
            AttentionScope::Work,
            1,
        ));
    }

    #[test]
    fn clear_resets_claims_for_the_next_generation() {
        let mut state = AttentionState::default();
        let first_generation = state.generation(AttentionScope::Work);
        assert!(state.claim_if_current(AttentionScope::Work, first_generation, "same", true));
        assert!(!state.claim_if_current(AttentionScope::Work, first_generation, "same", true));

        state.clear(AttentionScope::Work);

        let next_generation = state.generation(AttentionScope::Work);
        assert_ne!(next_generation, first_generation);
        assert!(state.claim_if_current(AttentionScope::Work, next_generation, "same", true));
    }

    #[test]
    fn failed_delivery_releases_only_its_claim_for_retry() {
        let mut state = AttentionState::default();
        let generation = state.generation(AttentionScope::Work);
        assert!(state.claim_if_current(AttentionScope::Work, generation, "failed", true));
        assert!(state.claim_if_current(AttentionScope::Work, generation, "unrelated", true));

        assert!(state.release_if_current(AttentionScope::Work, generation, "failed"));

        assert!(state.claim_if_current(AttentionScope::Work, generation, "failed", true));
        assert!(!state.claim_if_current(AttentionScope::Work, generation, "unrelated", true));
    }

    #[test]
    fn failed_delivery_releases_only_the_matching_scope() {
        let mut state = AttentionState::default();
        let work_generation = state.generation(AttentionScope::Work);
        let drift_generation = state.generation(AttentionScope::Drift);
        assert!(state.claim_if_current(AttentionScope::Work, work_generation, "same", true));
        assert!(state.claim_if_current(AttentionScope::Drift, drift_generation, "same", true));

        assert!(state.release_if_current(AttentionScope::Drift, drift_generation, "same"));

        assert!(state.claim_if_current(AttentionScope::Drift, drift_generation, "same", true));
        assert!(!state.claim_if_current(AttentionScope::Work, work_generation, "same", true));
    }

    #[test]
    fn stale_delivery_failure_does_not_release_a_new_generation_claim() {
        let mut state = AttentionState::default();
        let stale_generation = state.generation(AttentionScope::Work);
        assert!(state.claim_if_current(AttentionScope::Work, stale_generation, "same", true));
        state.clear(AttentionScope::Work);
        let current_generation = state.generation(AttentionScope::Work);
        assert!(state.claim_if_current(AttentionScope::Work, current_generation, "same", true));

        assert!(!state.release_if_current(AttentionScope::Work, stale_generation, "same"));

        assert!(!state.claim_if_current(AttentionScope::Work, current_generation, "same", true));
    }

    #[test]
    fn attended_build_check_release_is_targeted() {
        let mut state = AttentionState::default();
        let generation = state.generation(AttentionScope::Work);
        let build_check_id = AttentionKind::BuildCheckFailed.notice(None).id;
        let other_id = AttentionKind::BuildFailed.notice(None).id;
        assert!(state.claim_if_current(AttentionScope::Work, generation, &build_check_id, true));
        assert!(state.claim_if_current(AttentionScope::Work, generation, &other_id, true));

        assert!(release_build_check_claim_if_attended(
            &mut state, true, true, true,
        ));

        assert!(state.claim_if_current(AttentionScope::Work, generation, &build_check_id, true));
        assert!(!state.claim_if_current(AttentionScope::Work, generation, &other_id, true));
    }

    #[test]
    fn hidden_or_unfocused_build_checks_keep_the_failure_claim() {
        for (is_popover, visible, focused) in [
            (true, false, false),
            (true, false, true),
            (true, true, false),
            (false, true, true),
        ] {
            let mut state = AttentionState::default();
            let generation = state.generation(AttentionScope::Work);
            let build_check_id = AttentionKind::BuildCheckFailed.notice(None).id;
            assert!(state.claim_if_current(
                AttentionScope::Work,
                generation,
                &build_check_id,
                true
            ));

            assert!(!release_build_check_claim_if_attended(
                &mut state, is_popover, visible, focused,
            ));
            assert!(!state.claim_if_current(
                AttentionScope::Work,
                generation,
                &build_check_id,
                true
            ));
        }
    }

    #[test]
    fn developer_test_notice_can_notify_while_attended() {
        let mut state = AttentionState::default();
        let generation = state.generation(AttentionScope::Work);

        assert!(state.claim_if_current(
            AttentionScope::Work,
            generation,
            "test",
            should_notify(true, true, true, true),
        ));
        assert!(!state.claim_if_current(
            AttentionScope::Work,
            generation,
            "control-mode-test",
            should_notify(false, false, false, true),
        ));
    }

    #[test]
    fn clearing_work_releases_work_without_consuming_drift() {
        let mut state = AttentionState::default();
        let work_generation = state.generation(AttentionScope::Work);
        let drift_generation = state.generation(AttentionScope::Drift);
        assert!(state.claim_if_current(AttentionScope::Work, work_generation, "same-work", true));
        assert!(state.claim_if_current(
            AttentionScope::Drift,
            drift_generation,
            "same-drift",
            true
        ));

        state.clear(AttentionScope::Work);

        assert!(state.claim_if_current(
            AttentionScope::Work,
            state.generation(AttentionScope::Work),
            "same-work",
            true
        ));
        assert!(!state.claim_if_current(
            AttentionScope::Drift,
            drift_generation,
            "same-drift",
            true
        ));
    }

    #[test]
    fn delivered_notice_scopes_only_match_owned_identifiers() {
        assert_eq!(
            owned_notification_scope(Some("com.darkmatter.nixmac.attention.build-failed")),
            Some(AttentionScope::Work)
        );
        assert_eq!(
            owned_notification_scope(Some(
                "com.darkmatter.nixmac.attention.drift.config-drift:abc123"
            )),
            Some(AttentionScope::Drift)
        );
        assert_eq!(
            owned_notification_scope(Some("com.darkmatter.nixmac.someone-elses-notice")),
            None
        );
    }

    #[test]
    fn macos_popover_reserves_the_owned_notification_backend() {
        #[cfg(target_os = "macos")]
        {
            assert!(!plugin_notification_backend_allowed_for_mode(true));
            assert!(plugin_notification_backend_allowed_for_mode(false));
        }
    }
}
