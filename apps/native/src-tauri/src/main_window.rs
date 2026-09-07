//! Launch-scoped control and menu-bar popover behavior for the main window.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};

#[cfg(target_os = "macos")]
use block2::RcBlock;
#[cfg(target_os = "macos")]
use objc2::{
    rc::Retained,
    runtime::{AnyObject, ProtocolObject},
};
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSApplication, NSApplicationDidBecomeActiveNotification,
    NSApplicationDidChangeScreenParametersNotification, NSApplicationDidResignActiveNotification,
    NSEvent, NSEventMask, NSResponder, NSWindow,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{
    MainThreadMarker, NSNotification, NSNotificationCenter, NSObjectProtocol, NSPoint, NSRect,
};
#[cfg(target_os = "macos")]
use std::{
    cell::RefCell,
    ptr::NonNull,
    sync::{
        Arc,
        atomic::{AtomicU8, Ordering as AtomicOrdering},
        mpsc,
    },
};

pub(crate) const MAIN_TRAY_ID: &str = "main-tray";
pub(crate) const MENU_BAR_POPOVER_FLAG: &str = "menu-bar-popover";

const E2E_CONTROL_WINDOW_KEYS: &[&str] = &[
    "NIXMAC_E2E_MOCK_SYSTEM",
    "NIXMAC_E2E_SOLID_CAPTURE",
    "NIXMAC_E2E_OPAQUE_WINDOW",
    "NIXMAC_E2E_WEBVIEW_WATCHDOG",
    "NIXMAC_E2E_CONFIG_DIR",
    "NIXMAC_E2E_DIAGNOSTICS_DIR",
];
// NSStatusItem geometry can lag page load on a cold launch. Keep the window
// hidden for up to five seconds instead of flashing at a stale/default frame.
const INITIAL_POPOVER_POSITION_ATTEMPTS: usize = 100;
const INITIAL_POPOVER_POSITION_RETRY: Duration = Duration::from_millis(50);
const CLOSE_REQUEST_FALLBACK: Duration = Duration::from_secs(1);
#[cfg(target_os = "macos")]
const MACOS_ESCAPE_KEY_CODE: u16 = 53;
#[cfg(target_os = "macos")]
const MAX_RESPONDER_CHAIN_DEPTH: usize = 64;
// WKWebView can acquire its responder after the window is ordered onscreen.
const WEBVIEW_REFOCUS_DELAY: Duration = Duration::from_millis(75);

static REFOCUS_GENERATION: AtomicU64 = AtomicU64::new(0);
static ACTIVATION_REOPEN_ARMED: AtomicBool = AtomicBool::new(false);
static CLOSE_REQUESTS: CloseRequestTracker = CloseRequestTracker::new();

#[derive(Debug)]
struct CloseRequestTracker {
    next_token: AtomicU32,
    pending_token: AtomicU32,
}

impl CloseRequestTracker {
    const fn new() -> Self {
        Self {
            next_token: AtomicU32::new(1),
            pending_token: AtomicU32::new(0),
        }
    }

    fn begin(&self) -> u32 {
        // Zero denotes no pending close. A wrapped counter simply skips it;
        // only the latest token can authorize its one-second fallback.
        let token = loop {
            let token = self.next_token.fetch_add(1, Ordering::SeqCst);
            if token != 0 {
                break token;
            }
        };
        self.pending_token.store(token, Ordering::SeqCst);
        token
    }

    fn retire(&self, token: u32) -> bool {
        token != 0
            && self
                .pending_token
                .compare_exchange(token, 0, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
    }

    fn clear(&self) {
        self.pending_token.store(0, Ordering::SeqCst);
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
pub(crate) struct CloseRequestedPayload {
    pub(crate) token: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum MainWindowMode {
    #[default]
    Control,
    Popover,
}

impl MainWindowMode {
    pub(crate) fn is_popover(self) -> bool {
        self == Self::Popover
    }

    pub(crate) fn shows_detached_indicators(self) -> bool {
        !self.is_popover()
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct TrayClickState {
    started_visible: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TrayClickInput {
    Down {
        is_visible: bool,
        is_minimized: bool,
    },
    Up,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TrayClickAction {
    None,
    Show,
    Dismiss,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct TrayClickDecision {
    pub(crate) state: TrayClickState,
    pub(crate) action: TrayClickAction,
}

/// Decide a complete left-click transition without touching AppKit or Tauri.
///
/// Visibility is sampled on mouse-down so the corresponding mouse-up toggles
/// from the state the user actually clicked. Minimized popovers are treated as
/// hidden, and every mouse-up resets the gesture state.
pub(crate) fn decide_tray_click(
    mode: MainWindowMode,
    state: TrayClickState,
    input: TrayClickInput,
) -> TrayClickDecision {
    if !mode.is_popover() {
        return TrayClickDecision {
            state: TrayClickState::default(),
            action: TrayClickAction::None,
        };
    }

    match input {
        TrayClickInput::Down {
            is_visible,
            is_minimized,
        } => TrayClickDecision {
            state: TrayClickState {
                started_visible: is_visible && !is_minimized,
            },
            action: TrayClickAction::None,
        },
        TrayClickInput::Up => TrayClickDecision {
            state: TrayClickState::default(),
            action: if state.started_visible {
                TrayClickAction::Dismiss
            } else {
                TrayClickAction::Show
            },
        },
    }
}

fn resolve_mode(override_value: Option<&str>, force_e2e_control: bool) -> MainWindowMode {
    if force_e2e_control {
        return MainWindowMode::Control;
    }
    match override_value {
        Some("popover") => MainWindowMode::Popover,
        _ => MainWindowMode::Control,
    }
}

fn e2e_forces_control_window() -> bool {
    cfg!(debug_assertions)
        && should_force_e2e_control(
            E2E_CONTROL_WINDOW_KEYS
                .iter()
                .any(|key| crate::e2e_runtime::value(key).is_some()),
            crate::e2e_runtime::value("NIXMAC_E2E_WINDOW_MODE").as_deref(),
        )
}

fn should_force_e2e_control(has_e2e_control_key: bool, explicit_mode: Option<&str>) -> bool {
    has_e2e_control_key && explicit_mode != Some("popover")
}

fn resolve_e2e_window_mode(value: Option<&str>, debug_build: bool) -> Option<MainWindowMode> {
    if !debug_build {
        return None;
    }
    match value {
        Some("popover") => Some(MainWindowMode::Popover),
        Some("control") => Some(MainWindowMode::Control),
        _ => None,
    }
}

fn e2e_window_mode_override() -> Option<MainWindowMode> {
    let value = crate::e2e_runtime::value("NIXMAC_E2E_WINDOW_MODE");
    resolve_e2e_window_mode(value.as_deref(), cfg!(debug_assertions))
}

/// Resolve the launch-scoped window mode after `GlobalPreferences` is managed.
///
/// Rust intentionally reads only the local string override. PostHog flags are
/// JS-only in v1, and every unset or unrecognized value remains control.
pub(crate) fn read_at_launch<R: Runtime>(app: &AppHandle<R>) -> MainWindowMode {
    if let Some(mode) = e2e_window_mode_override() {
        return mode;
    }
    let override_value = crate::state::preferences::try_read(app).and_then(|preferences| {
        preferences
            .feature_flag_overrides
            .and_then(|overrides| overrides.get(MENU_BAR_POPOVER_FLAG).cloned())
    });
    resolve_mode(override_value.as_deref(), e2e_forces_control_window())
}

pub(crate) fn active<R: Runtime>(app: &AppHandle<R>) -> MainWindowMode {
    app.try_state::<MainWindowMode>()
        .map(|mode| *mode)
        .unwrap_or_default()
}

#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg(any(target_os = "macos", test))]
struct LogicalRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[cfg(target_os = "macos")]
impl LogicalRect {
    fn from_ns_rect(rect: NSRect) -> Self {
        Self {
            x: rect.origin.x,
            y: rect.origin.y,
            width: rect.size.width,
            height: rect.size.height,
        }
    }
}

#[cfg(any(target_os = "macos", test))]
fn popover_origin(
    status_item: LogicalRect,
    window_width: f64,
    window_height: f64,
    visible_frame: LogicalRect,
) -> (f64, f64) {
    let centered_x = status_item.x + status_item.width / 2.0 - window_width / 2.0;
    let below_status_item = status_item.y - window_height;
    let max_x = (visible_frame.x + visible_frame.width - window_width).max(visible_frame.x);
    let max_y = (visible_frame.y + visible_frame.height - window_height).max(visible_frame.y);

    (
        centered_x.clamp(visible_frame.x, max_x),
        below_status_item.clamp(visible_frame.y, max_y),
    )
}

#[cfg(any(target_os = "macos", test))]
fn popover_visible_frame_fallback_origin(
    window_width: f64,
    window_height: f64,
    visible_frame: LogicalRect,
) -> (f64, f64) {
    (
        (visible_frame.x + visible_frame.width - window_width).max(visible_frame.x),
        (visible_frame.y + visible_frame.height - window_height).max(visible_frame.y),
    )
}

#[cfg(any(target_os = "macos", test))]
fn status_item_frame_is_usable(status_item: LogicalRect, screen_frame: LogicalRect) -> bool {
    const EDGE_TOLERANCE: f64 = 1.0;
    const MAX_STATUS_ITEM_WIDTH: f64 = 256.0;
    const MAX_STATUS_ITEM_HEIGHT: f64 = 64.0;
    let screen_max_x = screen_frame.x + screen_frame.width;
    let screen_max_y = screen_frame.y + screen_frame.height;
    let status_item_top = status_item.y + status_item.height;
    status_item.width > 0.0
        && status_item.width <= MAX_STATUS_ITEM_WIDTH
        && status_item.height > 0.0
        && status_item.height <= MAX_STATUS_ITEM_HEIGHT
        && status_item.x >= screen_frame.x - EDGE_TOLERANCE
        && status_item.x + status_item.width <= screen_max_x + EDGE_TOLERANCE
        && status_item.y <= screen_max_y + EDGE_TOLERANCE
        && status_item_top >= screen_max_y - EDGE_TOLERANCE
        && status_item_top <= screen_max_y + EDGE_TOLERANCE
}

#[cfg(target_os = "macos")]
fn run_on_main_thread_sync<R, T, F>(app: &AppHandle<R>, task: F) -> Result<T, String>
where
    R: Runtime,
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    let (sender, receiver) = mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = sender.send(task());
    })
    .map_err(|error| error.to_string())?;
    receiver.recv().map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn position_under_status_item_on_main<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
) -> Result<(), String> {
    let tray = app
        .tray_by_id(MAIN_TRAY_ID)
        .ok_or_else(|| "Main tray icon not found".to_string())?;
    let (status_item, visible_frame) = tray
        .with_inner_tray_icon(|inner| -> Result<(LogicalRect, LogicalRect), String> {
            let mtm = MainThreadMarker::new()
                .ok_or_else(|| "Status-item geometry must run on the main thread".to_string())?;
            let status_item = inner
                .ns_status_item()
                .ok_or_else(|| "Native status item is unavailable".to_string())?;
            let button = status_item
                .button(mtm)
                .ok_or_else(|| "Native status-item button is unavailable".to_string())?;
            let status_window = button
                .window()
                .ok_or_else(|| "Native status-item window is unavailable".to_string())?;
            let screen = status_window
                .screen()
                .ok_or_else(|| "Status-item screen is unavailable".to_string())?;

            let status_item = LogicalRect::from_ns_rect(status_window.frame());
            let screen_frame = LogicalRect::from_ns_rect(screen.frame());
            let visible_frame = LogicalRect::from_ns_rect(screen.visibleFrame());
            if !status_item_frame_is_usable(status_item, screen_frame) {
                return Err(format!(
                    "Status-item frame is not ready: ({:.1},{:.1},{:.1}x{:.1})",
                    status_item.x, status_item.y, status_item.width, status_item.height,
                ));
            }

            Ok((status_item, visible_frame))
        })
        .map_err(|error| error.to_string())??;

    unsafe {
        let ns_window = window.ns_window().map_err(|error| error.to_string())?;
        let ns_window = &*(ns_window.cast::<NSWindow>());
        let frame = ns_window.frame();
        let (x, y) = popover_origin(
            status_item,
            frame.size.width,
            frame.size.height,
            visible_frame,
        );
        log::debug!(
            "Popover geometry: status=({:.1},{:.1},{:.1}x{:.1}) visible=({:.1},{:.1},{:.1}x{:.1}) window={:.1}x{:.1} origin=({:.1},{:.1})",
            status_item.x,
            status_item.y,
            status_item.width,
            status_item.height,
            visible_frame.x,
            visible_frame.y,
            visible_frame.width,
            visible_frame.height,
            frame.size.width,
            frame.size.height,
            x,
            y,
        );
        ns_window.setFrameOrigin(NSPoint::new(x, y));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn position_in_status_screen_visible_frame_on_main<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
) -> Result<(), String> {
    let tray = app
        .tray_by_id(MAIN_TRAY_ID)
        .ok_or_else(|| "Main tray icon not found".to_string())?;
    let visible_frame = tray
        .with_inner_tray_icon(|inner| -> Result<LogicalRect, String> {
            let mtm = MainThreadMarker::new()
                .ok_or_else(|| "Status-screen fallback must run on the main thread".to_string())?;
            let status_item = inner
                .ns_status_item()
                .ok_or_else(|| "Native status item is unavailable".to_string())?;
            let button = status_item
                .button(mtm)
                .ok_or_else(|| "Native status-item button is unavailable".to_string())?;
            let status_window = button
                .window()
                .ok_or_else(|| "Native status-item window is unavailable".to_string())?;
            let screen = status_window
                .screen()
                .ok_or_else(|| "Status-item screen is unavailable".to_string())?;
            Ok(LogicalRect::from_ns_rect(screen.visibleFrame()))
        })
        .map_err(|error| error.to_string())??;

    unsafe {
        let ns_window = window.ns_window().map_err(|error| error.to_string())?;
        let ns_window = &*(ns_window.cast::<NSWindow>());
        let frame = ns_window.frame();
        let (x, y) = popover_visible_frame_fallback_origin(
            frame.size.width,
            frame.size.height,
            visible_frame,
        );
        ns_window.setFrameOrigin(NSPoint::new(x, y));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn position_in_status_screen_visible_frame<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
) -> Result<(), String> {
    if MainThreadMarker::new().is_some() {
        return position_in_status_screen_visible_frame_on_main(app, window);
    }
    let task_app = app.clone();
    let task_window = window.clone();
    run_on_main_thread_sync(app, move || {
        position_in_status_screen_visible_frame_on_main(&task_app, &task_window)
    })?
}

#[cfg(not(target_os = "macos"))]
fn position_in_status_screen_visible_frame<R: Runtime>(
    _app: &AppHandle<R>,
    _window: &WebviewWindow<R>,
) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn position_under_status_item<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
) -> Result<(), String> {
    if MainThreadMarker::new().is_some() {
        return position_under_status_item_on_main(app, window);
    }
    let task_app = app.clone();
    let task_window = window.clone();
    run_on_main_thread_sync(app, move || {
        position_under_status_item_on_main(&task_app, &task_window)
    })?
}

#[cfg(not(target_os = "macos"))]
fn position_under_status_item<R: Runtime>(
    _app: &AppHandle<R>,
    _window: &WebviewWindow<R>,
) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn native_window_has_owned_dialog(ns_window: &NSWindow, mtm: MainThreadMarker) -> bool {
    ns_window.attachedSheet().is_some()
        || NSApplication::sharedApplication(mtm)
            .modalWindow()
            .is_some()
}

#[cfg(target_os = "macos")]
fn responder_chain_contains(
    mut responder: Option<Retained<NSResponder>>,
    expected_responder: &NSResponder,
) -> bool {
    for _ in 0..MAX_RESPONDER_CHAIN_DEPTH {
        let Some(current) = responder else {
            return false;
        };
        if std::ptr::eq(&*current, expected_responder) {
            return true;
        }
        responder = unsafe { current.nextResponder() };
    }
    false
}

#[cfg(target_os = "macos")]
fn make_webview_first_responder<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    window
        .with_webview(|webview| {
            let Some(mtm) = MainThreadMarker::new() else {
                log::debug!("Skipping WebView focus outside the main thread");
                return;
            };
            unsafe {
                let ns_window = &*(webview.ns_window().cast::<NSWindow>());
                let webview_responder = &*(webview.inner().cast::<NSResponder>());
                if ns_window.isVisible()
                    && ns_window.isKeyWindow()
                    && !native_window_has_owned_dialog(ns_window, mtm)
                {
                    ns_window.makeFirstResponder(Some(webview_responder));
                }
            }
        })
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn make_webview_first_responder<R: Runtime>(_window: &WebviewWindow<R>) -> Result<(), String> {
    Ok(())
}

fn should_run_delayed_refocus(
    captured_generation: u64,
    current_generation: u64,
    mode: MainWindowMode,
    is_visible: bool,
) -> bool {
    captured_generation == current_generation && mode.is_popover() && is_visible
}

fn should_continue_initial_show(
    startup_generation: u64,
    current_generation: u64,
    mode: MainWindowMode,
) -> bool {
    startup_generation == current_generation && mode.is_popover()
}

fn claim_initial_show_generation(generation: &AtomicU64) -> Option<u64> {
    generation
        .compare_exchange(0, 1, Ordering::SeqCst, Ordering::SeqCst)
        .ok()
        .map(|_| 1)
}

#[cfg(any(target_os = "macos", test))]
fn should_reanchor_after_screen_change(mode: MainWindowMode, is_visible: bool) -> bool {
    mode.is_popover() && is_visible
}

#[cfg(any(target_os = "macos", test))]
fn should_reopen_after_activation(
    mode: MainWindowMode,
    is_visible: bool,
    activation_reopen_armed: bool,
    pointer_buttons_pressed: bool,
) -> bool {
    mode.is_popover() && !is_visible && activation_reopen_armed && !pointer_buttons_pressed
}

fn schedule_delayed_refocus<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    generation: u64,
) {
    let app = app.clone();
    let window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(WEBVIEW_REFOCUS_DELAY);
        let task_app = app.clone();
        let task_window = window.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            let current_generation = REFOCUS_GENERATION.load(Ordering::SeqCst);
            let is_visible = task_window.is_visible().unwrap_or(false);
            if should_run_delayed_refocus(
                generation,
                current_generation,
                active(&task_app),
                is_visible,
            ) && let Err(error) = make_webview_first_responder(&task_window)
            {
                log::debug!("Delayed WebView refocus failed: {}", error);
            }
        }) {
            log::debug!("Could not schedule delayed WebView refocus: {}", error);
        }
    });
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg(any(target_os = "macos", test))]
enum EscapeAction {
    PassThrough,
    BridgeToWebview,
}

#[derive(Debug, Clone, Copy)]
#[cfg(any(target_os = "macos", test))]
struct EscapeContext {
    is_popover: bool,
    is_visible: bool,
    is_key_window: bool,
    event_targets_main_window: bool,
    has_owned_native_dialog: bool,
    webview_owns_first_responder: bool,
}

#[cfg(any(target_os = "macos", test))]
fn escape_action(context: EscapeContext) -> EscapeAction {
    if context.is_popover
        && context.is_visible
        && context.is_key_window
        && context.event_targets_main_window
        && !context.has_owned_native_dialog
        && !context.webview_owns_first_responder
    {
        EscapeAction::BridgeToWebview
    } else {
        EscapeAction::PassThrough
    }
}

#[cfg(target_os = "macos")]
struct MacWindowObservers {
    escape_monitor: Retained<AnyObject>,
    become_active_observer: Retained<ProtocolObject<dyn NSObjectProtocol>>,
    resign_observer: Retained<ProtocolObject<dyn NSObjectProtocol>>,
    screen_parameters_observer: Retained<ProtocolObject<dyn NSObjectProtocol>>,
}

#[cfg(target_os = "macos")]
impl Drop for MacWindowObservers {
    fn drop(&mut self) {
        unsafe {
            NSEvent::removeMonitor(&self.escape_monitor);
            let observer: &AnyObject = (*self.become_active_observer).as_ref();
            NSNotificationCenter::defaultCenter().removeObserver(observer);
            let observer: &AnyObject = (*self.resign_observer).as_ref();
            NSNotificationCenter::defaultCenter().removeObserver(observer);
            let observer: &AnyObject = (*self.screen_parameters_observer).as_ref();
            NSNotificationCenter::defaultCenter().removeObserver(observer);
        }
    }
}

#[cfg(target_os = "macos")]
thread_local! {
    static MAC_WINDOW_OBSERVERS: RefCell<Option<MacWindowObservers>> = const { RefCell::new(None) };
}

/// Install the macOS event bridge and application-activation observer.
///
/// The local monitor passes WebView-owned Escape events through untouched. It
/// only consumes an early Escape that targets the main window before WKWebView
/// owns first responder, after successfully bridging that event to the frontend.
#[cfg(target_os = "macos")]
pub(crate) fn install_macos_event_handlers<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if !active(app).is_popover() {
        return Ok(());
    }

    let escape_app = app.clone();
    let escape_handler = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        let event_ref = unsafe { event.as_ref() };
        if event_ref.keyCode() != MACOS_ESCAPE_KEY_CODE || !active(&escape_app).is_popover() {
            return event.as_ptr();
        }

        let Some(window) = escape_app.get_webview_window("main") else {
            return event.as_ptr();
        };
        let action = Arc::new(AtomicU8::new(0));
        let action_for_webview = Arc::clone(&action);
        let event_window_number = event_ref.windowNumber();
        if window
            .with_webview(move |webview| unsafe {
                let Some(mtm) = MainThreadMarker::new() else {
                    return;
                };
                let ns_window = &*(webview.ns_window().cast::<NSWindow>());
                let webview_responder = &*(webview.inner().cast::<NSResponder>());
                let context = EscapeContext {
                    is_popover: true,
                    is_visible: ns_window.isVisible(),
                    is_key_window: ns_window.isKeyWindow(),
                    event_targets_main_window: event_window_number == ns_window.windowNumber(),
                    has_owned_native_dialog: native_window_has_owned_dialog(ns_window, mtm),
                    webview_owns_first_responder: responder_chain_contains(
                        ns_window.firstResponder(),
                        webview_responder,
                    ),
                };
                let value = match escape_action(context) {
                    EscapeAction::PassThrough => 1,
                    EscapeAction::BridgeToWebview => 2,
                };
                action_for_webview.store(value, AtomicOrdering::SeqCst);
            })
            .is_err()
        {
            return event.as_ptr();
        }

        if action.load(AtomicOrdering::SeqCst) == 2 {
            if let Err(error) = window.emit("window:escape", ()) {
                log::warn!("Failed to bridge early Escape to the WebView: {}", error);
                return event.as_ptr();
            }
            return std::ptr::null_mut();
        }
        event.as_ptr()
    });
    let escape_monitor = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &escape_handler)
    }
    .ok_or_else(|| "Failed to install menu-bar popover Escape monitor".to_string())?;

    let resign_app = app.clone();
    let resign_handler = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        if active(&resign_app).is_popover()
            && let Err(error) = dismiss(&resign_app, MainWindowMode::Popover)
        {
            log::warn!(
                "Failed to dismiss menu-bar popover after app resign: {}",
                error
            );
        }
    });
    let center = NSNotificationCenter::defaultCenter();
    let become_active_app = app.clone();
    let become_active_handler = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        let Some(window) = become_active_app.get_webview_window("main") else {
            return;
        };
        let is_visible = window.is_visible().unwrap_or(false);
        // Pointer-driven activation already has an explicit owner: the status-item
        // click toggler, Dock reopen event, or tray menu callback. Skipping it here
        // prevents a mouse-down activation from showing the window before the
        // corresponding mouse-up decides whether to show or dismiss it.
        let pointer_buttons_pressed = NSEvent::pressedMouseButtons() != 0;
        if should_reopen_after_activation(
            active(&become_active_app),
            is_visible,
            ACTIVATION_REOPEN_ARMED.load(Ordering::SeqCst),
            pointer_buttons_pressed,
        ) && let Err(error) = show(&become_active_app, MainWindowMode::Popover)
        {
            log::warn!(
                "Failed to reopen menu-bar popover after app activation: {}",
                error
            );
        }
    });
    let become_active_observer = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(NSApplicationDidBecomeActiveNotification),
            None,
            None,
            &become_active_handler,
        )
    };

    let resign_observer = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(NSApplicationDidResignActiveNotification),
            None,
            None,
            &resign_handler,
        )
    };

    let screen_parameters_app = app.clone();
    let screen_parameters_handler = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        let Some(window) = screen_parameters_app.get_webview_window("main") else {
            return;
        };
        let is_visible = window.is_visible().unwrap_or(false);
        if should_reanchor_after_screen_change(active(&screen_parameters_app), is_visible)
            && let Err(error) = position_under_status_item(&screen_parameters_app, &window)
        {
            log::warn!(
                "Could not reanchor visible menu-bar popover after screen parameters changed: {}",
                error
            );
        }
    });
    let screen_parameters_observer = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(NSApplicationDidChangeScreenParametersNotification),
            None,
            None,
            &screen_parameters_handler,
        )
    };

    MAC_WINDOW_OBSERVERS.with(|observers| {
        observers.borrow_mut().replace(MacWindowObservers {
            escape_monitor,
            become_active_observer,
            resign_observer,
            screen_parameters_observer,
        });
    });
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn install_macos_event_handlers<R: Runtime>(_app: &AppHandle<R>) -> Result<(), String> {
    Ok(())
}

pub(crate) fn acknowledge_close(token: u32) -> bool {
    CLOSE_REQUESTS.retire(token)
}

/// Give the WebView first refusal on a popover close request.
///
/// A listener can synchronously route the request through the overlay Escape
/// stack and then acknowledge this token. If no listener receives the event,
/// or the WebView is unresponsive, the current request dismisses after exactly
/// one second. A newer request supersedes every older token and timeout.
pub(crate) fn request_close<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let token = CLOSE_REQUESTS.begin();
    let emit_result = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())
        .and_then(|window| {
            window
                .emit("window:close-requested", CloseRequestedPayload { token })
                .map_err(|error| error.to_string())
        });

    if let Err(emit_error) = emit_result {
        CLOSE_REQUESTS.retire(token);
        return match dismiss(app, MainWindowMode::Popover) {
            Ok(_) => Err(format!(
                "Failed to emit popover close request; dismissed immediately: {emit_error}"
            )),
            Err(dismiss_error) => Err(format!(
                "Failed to emit popover close request ({emit_error}) and immediate dismissal failed ({dismiss_error})"
            )),
        };
    }

    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(CLOSE_REQUEST_FALLBACK);
        let task_app = app.clone();
        if let Err(schedule_error) = app.run_on_main_thread(move || {
            if CLOSE_REQUESTS.retire(token)
                && let Err(error) = dismiss(&task_app, MainWindowMode::Popover)
            {
                log::warn!(
                    "Failed to dismiss unacknowledged menu-bar popover close request: {}",
                    error
                );
            }
        }) {
            // Scheduling can fail during teardown. Retire the token and make a
            // final best-effort dismissal so a live but unhealthy event loop
            // cannot leave the popover stranded onscreen.
            if CLOSE_REQUESTS.retire(token)
                && let Err(error) = dismiss(&app, MainWindowMode::Popover)
            {
                log::warn!(
                    "Could not schedule close fallback ({schedule_error}); direct dismissal also failed: {error}"
                );
            }
        }
    });
    Ok(())
}

pub(crate) fn show<R: Runtime>(app: &AppHandle<R>, mode: MainWindowMode) -> Result<(), String> {
    // An explicit reopen supersedes any unacknowledged close fallback so an
    // older timer can never hide the newly shown popover.
    CLOSE_REQUESTS.clear();
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let refocus_generation = mode
        .is_popover()
        .then(|| REFOCUS_GENERATION.fetch_add(1, Ordering::SeqCst) + 1);

    if mode.is_popover() {
        window.unminimize().map_err(|error| error.to_string())?;
    }

    window.show().map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    if mode.is_popover() {
        // Explicit dismissal hides the application to return keyboard focus.
        // Order the window first so activation observes it as already visible.
        app.show().map_err(|error| error.to_string())?;
    }
    if mode.is_popover() {
        // Do not let a launch-time DidBecomeActive notification bypass the
        // status-item readiness path. Once any explicit/initial show succeeds,
        // later keyboard/programmatic app activation may reopen the popover.
        ACTIVATION_REOPEN_ARMED.store(true, Ordering::SeqCst);
    }

    // AppKit may replace a hidden window's frame while ordering it onscreen.
    // Position only after `show` so the status-item anchor remains final.
    if mode.is_popover()
        && let Err(error) = position_under_status_item(app, &window)
    {
        if let Err(fallback_error) = position_in_status_screen_visible_frame(app, &window) {
            log::warn!(
                "Could not position menu-bar popover under its status item ({error}) or within the status screen's visible frame ({fallback_error}); showing at its current position"
            );
        } else {
            log::warn!(
                "Could not position menu-bar popover under its status item; using the status screen's visible-frame fallback: {error}"
            );
        }
    }

    window.set_focus().map_err(|error| error.to_string())?;
    crate::attention::clear_work(app);
    if let Some(generation) = refocus_generation {
        if let Err(error) = make_webview_first_responder(&window) {
            log::debug!("Initial WebView focus failed: {}", error);
        }
        schedule_delayed_refocus(app, &window, generation);
        crate::peek::record_main_window_shown(app)?;
    }
    Ok(())
}

fn schedule_initial_show<R: Runtime>(
    app: &AppHandle<R>,
    mode: MainWindowMode,
    startup_generation: u64,
) {
    let task_app = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        if !should_continue_initial_show(
            startup_generation,
            REFOCUS_GENERATION.load(Ordering::SeqCst),
            active(&task_app),
        ) {
            return;
        }
        if let Err(error) = show(&task_app, mode) {
            log::warn!("Failed to show initial menu-bar popover: {}", error);
        }
    }) {
        log::warn!("Could not schedule initial menu-bar popover: {}", error);
    }
}

pub(crate) fn show_initial_when_ready<R: Runtime>(app: &AppHandle<R>, mode: MainWindowMode) {
    if !mode.is_popover() {
        return;
    }

    // Page load may finish after the user has already opened or dismissed the
    // window. Only untouched startup state may begin the automatic show.
    let Some(startup_generation) = claim_initial_show_generation(&REFOCUS_GENERATION) else {
        return;
    };
    let app = app.clone();
    std::thread::spawn(move || {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let mut last_error = None;
        for attempt in 0..INITIAL_POPOVER_POSITION_ATTEMPTS {
            if attempt > 0 {
                std::thread::sleep(INITIAL_POPOVER_POSITION_RETRY);
            }
            if !should_continue_initial_show(
                startup_generation,
                REFOCUS_GENERATION.load(Ordering::SeqCst),
                active(&app),
            ) {
                return;
            }
            match position_under_status_item(&app, &window) {
                Ok(()) => {
                    schedule_initial_show(&app, mode, startup_generation);
                    return;
                }
                Err(error) => last_error = Some(error),
            }
        }
        log::warn!(
            "Initial menu-bar popover status item remained unavailable; the status screen visible-frame fallback will be used: {}",
            last_error.unwrap_or_else(|| "unknown positioning error".to_string())
        );
        schedule_initial_show(&app, mode, startup_generation);
    });
}

pub(crate) fn dismiss<R: Runtime>(
    app: &AppHandle<R>,
    mode: MainWindowMode,
) -> Result<bool, String> {
    if !mode.is_popover() {
        return Ok(false);
    }
    // Any successful explicit dismissal supersedes a pending close fallback.
    CLOSE_REQUESTS.clear();
    REFOCUS_GENERATION.fetch_add(1, Ordering::SeqCst);
    let Some(window) = app.get_webview_window("main") else {
        return Ok(false);
    };
    window.hide().map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    run_on_main_thread_sync(app, || {
        let mtm = MainThreadMarker::new()
            .ok_or_else(|| "Application dismissal must run on the main thread".to_string())?;
        let application = NSApplication::sharedApplication(mtm);
        // Escape, Cmd+W and tray dismissal should return to the previous app.
        // On app resignation focus has already moved, so hide only the window.
        if application.isActive() {
            application.hide(None);
        }
        Ok::<(), String>(())
    })??;
    crate::peek::record_main_window_hidden(app)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> LogicalRect {
        LogicalRect {
            x,
            y,
            width,
            height,
        }
    }

    fn bridgeable_escape() -> EscapeContext {
        EscapeContext {
            is_popover: true,
            is_visible: true,
            is_key_window: true,
            event_targets_main_window: true,
            has_owned_native_dialog: false,
            webview_owns_first_responder: false,
        }
    }

    #[test]
    fn popover_is_the_only_enabling_variant() {
        assert_eq!(resolve_mode(None, false), MainWindowMode::Control);
        assert_eq!(
            resolve_mode(Some("control"), false),
            MainWindowMode::Control
        );
        assert_eq!(resolve_mode(Some("false"), false), MainWindowMode::Control);
        assert_eq!(
            resolve_mode(Some("unknown"), false),
            MainWindowMode::Control
        );
        assert_eq!(
            resolve_mode(Some("popover"), false),
            MainWindowMode::Popover
        );
    }

    #[test]
    fn transient_popover_mode_suppresses_detached_indicator_windows() {
        assert!(MainWindowMode::Control.shows_detached_indicators());
        assert!(!MainWindowMode::Popover.shows_detached_indicators());
    }

    #[test]
    fn keyboard_activation_reopens_only_an_armed_hidden_popover() {
        assert!(should_reopen_after_activation(
            MainWindowMode::Popover,
            false,
            true,
            false,
        ));
        assert!(!should_reopen_after_activation(
            MainWindowMode::Control,
            false,
            true,
            false,
        ));
        assert!(!should_reopen_after_activation(
            MainWindowMode::Popover,
            true,
            true,
            false,
        ));
        assert!(!should_reopen_after_activation(
            MainWindowMode::Popover,
            false,
            false,
            false,
        ));
    }

    #[test]
    fn pointer_activation_stays_owned_by_the_status_item_dock_or_tray_menu() {
        assert!(!should_reopen_after_activation(
            MainWindowMode::Popover,
            false,
            true,
            true,
        ));
    }

    #[test]
    fn e2e_control_wins_over_a_popover_override() {
        assert_eq!(resolve_mode(Some("popover"), true), MainWindowMode::Control);
    }

    #[test]
    fn an_explicit_e2e_popover_mode_allows_native_mock_qa() {
        assert!(should_force_e2e_control(true, None));
        assert!(should_force_e2e_control(true, Some("control")));
        assert!(!should_force_e2e_control(true, Some("popover")));
        assert!(!should_force_e2e_control(false, None));
        assert_eq!(
            resolve_e2e_window_mode(Some("popover"), true),
            Some(MainWindowMode::Popover)
        );
        assert_eq!(
            resolve_e2e_window_mode(Some("control"), true),
            Some(MainWindowMode::Control)
        );
        assert_eq!(resolve_e2e_window_mode(Some("popover"), false), None);
        assert_eq!(resolve_e2e_window_mode(Some("unknown"), true), None);
    }

    #[test]
    fn popover_uses_status_screen_visible_frame_in_logical_coordinates() {
        let visible_frame = rect(1_440.0, 25.0, 1_920.0, 1_055.0);
        let status_item = rect(3_100.0, 1_056.0, 24.0, 24.0);
        assert_eq!(
            popover_origin(status_item, 800.0, 600.0, visible_frame),
            (2_560.0, 456.0)
        );
    }

    #[test]
    fn popover_clamps_to_visible_work_area_edges() {
        let visible_frame = rect(-1_920.0, 25.0, 1_920.0, 1_055.0);
        assert_eq!(
            popover_origin(
                rect(-1_910.0, 1_056.0, 24.0, 24.0),
                800.0,
                600.0,
                visible_frame,
            ),
            (-1_920.0, 456.0)
        );
        assert_eq!(
            popover_origin(
                rect(-20.0, 1_056.0, 24.0, 24.0),
                800.0,
                600.0,
                visible_frame,
            ),
            (-800.0, 456.0)
        );

        let dock_inset_visible_frame = rect(50.0, 0.0, 2_958.0, 1_662.0);
        assert_eq!(
            popover_origin(
                rect(20.0, 1_662.0, 36.0, 30.0),
                800.0,
                600.0,
                dock_inset_visible_frame,
            ),
            (50.0, 1_062.0)
        );

        let lower_display_visible_frame = rect(0.0, -1_200.0, 1_920.0, 1_170.0);
        assert_eq!(
            popover_origin(
                rect(1_000.0, -30.0, 24.0, 30.0),
                800.0,
                600.0,
                lower_display_visible_frame,
            ),
            (612.0, -630.0)
        );
    }

    #[test]
    fn popover_visible_frame_fallback_uses_the_top_right_work_area_corner() {
        assert_eq!(
            popover_visible_frame_fallback_origin(
                800.0,
                600.0,
                rect(-1_920.0, 25.0, 1_920.0, 1_055.0),
            ),
            (-800.0, 480.0),
        );
        assert_eq!(
            popover_visible_frame_fallback_origin(800.0, 600.0, rect(0.0, 25.0, 700.0, 500.0)),
            (0.0, 25.0),
        );
    }

    #[test]
    fn status_item_frame_must_be_laid_out_before_positioning() {
        let screen_frame = rect(0.0, 0.0, 3_008.0, 1_692.0);
        assert!(!status_item_frame_is_usable(
            rect(0.0, 0.0, 36.0, 0.0),
            screen_frame
        ));
        assert!(status_item_frame_is_usable(
            rect(2_063.0, 1_662.0, 36.0, 30.0),
            screen_frame
        ));
        assert!(status_item_frame_is_usable(
            rect(2_063.0, 1_670.0, 36.0, 22.0),
            screen_frame
        ));
        assert!(!status_item_frame_is_usable(
            rect(0.0, -11.0, 35.5, 22.0),
            screen_frame
        ));
        assert!(!status_item_frame_is_usable(
            rect(0.0, 1_662.0, 3_008.0, 30.0),
            screen_frame
        ));
        assert!(!status_item_frame_is_usable(
            rect(2_063.0, 1_692.0, 36.0, 30.0),
            screen_frame
        ));
    }

    #[test]
    fn webview_owned_escape_passes_through_to_dom() {
        let mut context = bridgeable_escape();
        context.webview_owns_first_responder = true;
        assert_eq!(escape_action(context), EscapeAction::PassThrough);
    }

    #[test]
    fn native_dialog_owned_escape_passes_through() {
        let mut context = bridgeable_escape();
        context.has_owned_native_dialog = true;
        assert_eq!(escape_action(context), EscapeAction::PassThrough);

        context.has_owned_native_dialog = false;
        context.event_targets_main_window = false;
        assert_eq!(escape_action(context), EscapeAction::PassThrough);
    }

    #[test]
    fn early_main_window_escape_bridges_to_webview() {
        assert_eq!(
            escape_action(bridgeable_escape()),
            EscapeAction::BridgeToWebview
        );
    }

    #[test]
    fn delayed_refocus_requires_the_current_visible_popover_generation() {
        assert!(should_run_delayed_refocus(
            4,
            4,
            MainWindowMode::Popover,
            true
        ));
        assert!(!should_run_delayed_refocus(
            4,
            5,
            MainWindowMode::Popover,
            true
        ));
        assert!(!should_run_delayed_refocus(
            4,
            4,
            MainWindowMode::Control,
            true
        ));
        assert!(!should_run_delayed_refocus(
            4,
            4,
            MainWindowMode::Popover,
            false
        ));
    }

    #[test]
    fn initial_show_is_cancelled_by_any_newer_window_action() {
        assert!(should_continue_initial_show(4, 4, MainWindowMode::Popover));
        assert!(!should_continue_initial_show(4, 5, MainWindowMode::Popover));
        assert!(!should_continue_initial_show(4, 4, MainWindowMode::Control));
    }

    #[test]
    fn late_page_load_cannot_override_an_earlier_window_action() {
        let generation = AtomicU64::new(0);
        // Explicit show/dismiss before PageLoadEvent::Finished advances this
        // same counter, even though the automatic startup show has not begun.
        generation.fetch_add(1, Ordering::SeqCst);
        assert_eq!(claim_initial_show_generation(&generation), None);
        assert_eq!(generation.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn initial_show_can_claim_only_untouched_startup_state() {
        let generation = AtomicU64::new(0);
        assert_eq!(claim_initial_show_generation(&generation), Some(1));
        assert_eq!(claim_initial_show_generation(&generation), None);
        assert!(should_continue_initial_show(
            1,
            generation.load(Ordering::SeqCst),
            MainWindowMode::Popover,
        ));

        generation.fetch_add(1, Ordering::SeqCst);
        assert!(!should_continue_initial_show(
            1,
            generation.load(Ordering::SeqCst),
            MainWindowMode::Popover,
        ));
    }

    #[test]
    fn screen_changes_only_reanchor_a_visible_popover() {
        assert!(should_reanchor_after_screen_change(
            MainWindowMode::Popover,
            true
        ));
        assert!(!should_reanchor_after_screen_change(
            MainWindowMode::Popover,
            false
        ));
        assert!(!should_reanchor_after_screen_change(
            MainWindowMode::Control,
            true
        ));
    }

    #[test]
    fn hidden_and_minimized_tray_clicks_show_the_popover() {
        for (is_visible, is_minimized) in [(false, false), (true, true)] {
            let down = decide_tray_click(
                MainWindowMode::Popover,
                TrayClickState::default(),
                TrayClickInput::Down {
                    is_visible,
                    is_minimized,
                },
            );
            assert_eq!(down.action, TrayClickAction::None);
            let up = decide_tray_click(MainWindowMode::Popover, down.state, TrayClickInput::Up);
            assert_eq!(up.action, TrayClickAction::Show);
            assert_eq!(up.state, TrayClickState::default());
        }
    }

    #[test]
    fn visible_tray_click_dismisses_and_resets_for_the_next_gesture() {
        let down = decide_tray_click(
            MainWindowMode::Popover,
            TrayClickState::default(),
            TrayClickInput::Down {
                is_visible: true,
                is_minimized: false,
            },
        );
        let up = decide_tray_click(MainWindowMode::Popover, down.state, TrayClickInput::Up);
        assert_eq!(up.action, TrayClickAction::Dismiss);
        assert_eq!(up.state, TrayClickState::default());

        let next_up = decide_tray_click(MainWindowMode::Popover, up.state, TrayClickInput::Up);
        assert_eq!(next_up.action, TrayClickAction::Show);
    }

    #[test]
    fn control_mode_ignores_and_resets_popover_tray_state() {
        let decision = decide_tray_click(
            MainWindowMode::Control,
            TrayClickState {
                started_visible: true,
            },
            TrayClickInput::Up,
        );
        assert_eq!(decision.action, TrayClickAction::None);
        assert_eq!(decision.state, TrayClickState::default());
    }

    #[test]
    fn close_request_in_time_ack_cancels_its_fallback() {
        assert_eq!(CLOSE_REQUEST_FALLBACK, Duration::from_secs(1));
        let requests = CloseRequestTracker::new();
        let token = requests.begin();
        assert!(requests.retire(token));
        assert!(
            !requests.retire(token),
            "acknowledged timeout must be stale"
        );
    }

    #[test]
    fn missing_close_listener_allows_timeout_and_rejects_late_ack() {
        let requests = CloseRequestTracker::new();
        let token = requests.begin();
        assert!(requests.retire(token), "current timeout owns dismissal");
        assert!(!requests.retire(token), "late ack must be a no-op");
    }

    #[test]
    fn close_tokens_wrap_without_reusing_the_empty_sentinel() {
        let requests = CloseRequestTracker::new();
        requests.next_token.store(u32::MAX, Ordering::SeqCst);
        assert_eq!(requests.begin(), u32::MAX);
        let wrapped = requests.begin();
        assert_eq!(wrapped, 1);
        assert!(!requests.retire(u32::MAX));
        assert!(requests.retire(wrapped));
    }

    #[test]
    fn newest_close_request_wins_over_stale_ack_and_older_timeout() {
        let requests = CloseRequestTracker::new();
        let older = requests.begin();
        let current = requests.begin();
        assert!(current > older);
        assert!(!requests.retire(older), "stale ack must be a no-op");
        assert!(!requests.retire(older), "older timeout must be a no-op");
        assert!(requests.retire(current));
    }
}
