#![allow(deprecated)]
#![allow(dead_code)]
//! Peek behavior for the widget.
//!
//! Shows a small icon in the bottom-right corner of the RIGHT-MOST monitor
//! when Option is held and the cursor is near that corner. Clicking the icon
//! reveals the main widget window.

use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Runtime, WebviewUrl, WebviewWindowBuilder,
};

/// Size of the peek icon window (physical pixels)
const ICON_SIZE: f64 = 128.0;
/// Margin from screen edge (physical pixels)
const ICON_MARGIN: f64 = 64.0;
/// Corner detection zone size (logical points)
const CORNER_ZONE: f64 = 300.0;
/// Polling interval for monitoring
const POLL_INTERVAL_MS: u64 = 50;
/// Enable verbose logging for debugging
const DEBUG_LOGGING: bool = true;

macro_rules! peek_log {
    ($($arg:tt)*) => {
        if DEBUG_LOGGING {
            log::debug!("[peek] {}", format_args!($($arg)*));
        }
    };
}

/// Monitor info needed for positioning
struct MonitorInfo {
    /// Position of monitor in global coordinates (physical pixels)
    x: f64,
    y: f64,
    /// Size in physical pixels
    width: f64,
    height: f64,
    /// Scale factor for this monitor
    scale_factor: f64,
}

impl MonitorInfo {
    /// Get the position for the peek icon (bottom-right corner)
    fn icon_position(&self) -> (f64, f64) {
        let x = self.x + self.width - ICON_SIZE - ICON_MARGIN;
        let y = self.y + self.height - ICON_SIZE - ICON_MARGIN;
        (x, y)
    }

    /// Get the position for the main window (bottom-right, fully visible)
    fn main_window_position(&self, window_width: f64, window_height: f64) -> (f64, f64) {
        let x = self.x + self.width - window_width - ICON_MARGIN;
        let y = self.y + self.height - window_height - ICON_MARGIN;
        (x, y)
    }

    /// Check if cursor (in logical points) is in the bottom-right corner zone
    fn is_cursor_in_corner(&self, cursor_x: f64, cursor_y: f64) -> bool {
        let monitor_right_logical = (self.x + self.width) / self.scale_factor;
        let monitor_bottom_logical = (self.y + self.height) / self.scale_factor;
        let corner_zone_logical = CORNER_ZONE / self.scale_factor;

        let threshold_x = monitor_right_logical - corner_zone_logical;
        let threshold_y = monitor_bottom_logical - corner_zone_logical;

        cursor_x >= threshold_x && cursor_y >= threshold_y
    }
}

/// Find the right-most monitor (the one whose right edge is furthest right)
fn get_rightmost_monitor<R: Runtime>(app: &AppHandle<R>) -> Result<MonitorInfo, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;

    let mut rightmost: Option<MonitorInfo> = None;
    let mut max_right_edge: f64 = f64::MIN;

    for monitor in monitors {
        let pos = monitor.position();
        let size = monitor.size();
        let right_edge = pos.x as f64 + size.width as f64;

        peek_log!(
            "📺 Found monitor: pos=({}, {}), size={}x{}, right_edge={}, scale={}x",
            pos.x,
            pos.y,
            size.width,
            size.height,
            right_edge,
            monitor.scale_factor()
        );

        if right_edge > max_right_edge {
            max_right_edge = right_edge;
            rightmost = Some(MonitorInfo {
                x: pos.x as f64,
                y: pos.y as f64,
                width: size.width as f64,
                height: size.height as f64,
                scale_factor: monitor.scale_factor(),
            });
        }
    }

    rightmost.ok_or_else(|| "No monitors found".to_string())
}

/// Get the primary monitor
fn get_primary_monitor(app: &AppHandle) -> Result<MonitorInfo, String> {
    let monitor = app
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No primary monitor found".to_string())?;

    let pos = monitor.position();
    let size = monitor.size();

    peek_log!(
        "📺 Primary monitor: pos=({}, {}), size={}x{}, scale={}x",
        pos.x,
        pos.y,
        size.width,
        size.height,
        monitor.scale_factor()
    );

    Ok(MonitorInfo {
        x: pos.x as f64,
        y: pos.y as f64,
        width: size.width as f64,
        height: size.height as f64,
        scale_factor: monitor.scale_factor(),
    })
}

// Track if the main window is open (user clicked icon)
static MAIN_WINDOW_OPEN: AtomicBool = AtomicBool::new(false);
// Track if peek monitoring is active
static MONITORING_ACTIVE: AtomicBool = AtomicBool::new(false);
// Track if there are uncommitted changes (for preview indicator)
static HAS_UNCOMMITTED_CHANGES: AtomicBool = AtomicBool::new(false);

/// External functions from Core Graphics for macOS
#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::c_void;

    #[repr(C)]
    pub struct CGPoint {
        pub x: f64,
        pub y: f64,
    }

    pub const COMBINED_SESSION_STATE: i32 = 0;
    pub const ALTERNATE_FLAG: u64 = 0x00080000;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        pub fn CGEventSourceFlagsState(stateID: i32) -> u64;
        pub fn CGEventCreate(source: *const c_void) -> *const c_void;
        pub fn CGEventGetLocation(event: *const c_void) -> CGPoint;
        pub fn CFRelease(cf: *const c_void);
    }

    pub fn is_option_held() -> bool {
        unsafe {
            let flags = CGEventSourceFlagsState(COMBINED_SESSION_STATE);
            (flags & ALTERNATE_FLAG) != 0
        }
    }

    pub fn get_cursor_position() -> (f64, f64) {
        unsafe {
            let event = CGEventCreate(std::ptr::null());
            if event.is_null() {
                return (0.0, 0.0);
            }
            let point = CGEventGetLocation(event);
            CFRelease(event);
            (point.x, point.y)
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod macos {
    pub fn is_option_held() -> bool {
        false
    }
    pub fn get_cursor_position() -> (f64, f64) {
        (0.0, 0.0)
    }
}

/// Widget visibility state
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PeekState {
    /// Icon and main window are hidden
    Hidden,
    /// Icon is visible (peeking from corner)
    Peeking,
    /// Main window is open
    Expanded,
}

/// Shows the peek icon
pub fn show_icon<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("peek-icon") {
        // Reposition in case monitor setup changed
        let monitor = get_rightmost_monitor(app)?;
        let (icon_x, icon_y) = monitor.icon_position();

        window
            .set_position(PhysicalPosition::new(icon_x as i32, icon_y as i32))
            .map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        peek_log!("👁️ Showing peek icon at ({}, {})", icon_x, icon_y);
    }
    Ok(())
}

/// Hides the peek icon
pub fn hide_icon<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("peek-icon") {
        window.hide().map_err(|e| e.to_string())?;
        peek_log!("🙈 Hiding peek icon");
    }
    Ok(())
}

/// Shows the main window (called when icon is clicked)
pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;

    // Just show and focus the window without changing its position
    peek_log!("📍 Showing main window");
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;

    MAIN_WINDOW_OPEN.store(true, Ordering::SeqCst);

    // Hide the icon
    hide_icon(app)?;

    // Note: Preview indicator stays visible when there are changes,
    // even when main window is open

    // Emit state change
    let _ = window.emit("peek:state", PeekState::Expanded);

    Ok(())
}

/// Hides the main window
pub fn hide_main_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
        peek_log!("🙈 Hiding main window");
        MAIN_WINDOW_OPEN.store(false, Ordering::SeqCst);
        let _ = window.emit("peek:state", PeekState::Hidden);

        // Show preview indicator if there are uncommitted changes
        if HAS_UNCOMMITTED_CHANGES.load(Ordering::SeqCst) {
            show_preview_indicator(app)?;
        }
    }
    Ok(())
}

/// Sets whether there are uncommitted changes (called from frontend)
pub fn set_has_uncommitted_changes(has_changes: bool) {
    HAS_UNCOMMITTED_CHANGES.store(has_changes, Ordering::SeqCst);
}

/// Called when the peek icon is clicked
pub fn on_icon_clicked<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    peek_log!("🖱️ Peek icon clicked!");
    show_main_window(app)
}

/// Check if main window is open
pub fn is_main_window_open() -> bool {
    MAIN_WINDOW_OPEN.load(Ordering::SeqCst)
}

/// Lock the main window open (e.g., from hotkey)
pub fn lock_expanded() {
    peek_log!("🔒 Locking main window EXPANDED");
    MAIN_WINDOW_OPEN.store(true, Ordering::SeqCst);
}

/// Unlock and hide the main window
pub fn unlock_and_hide() {
    peek_log!("🔓 Unlocking, will hide main window");
    MAIN_WINDOW_OPEN.store(false, Ordering::SeqCst);
}

/// Starts the background monitoring thread for peek behavior.
pub fn start_monitoring<R: Runtime + 'static>(app: AppHandle<R>) {
    if MONITORING_ACTIVE.swap(true, Ordering::SeqCst) {
        peek_log!("⚠️ Monitoring already active, skipping start");
        return;
    }

    peek_log!("🚀 Starting peek monitoring thread");

    std::thread::spawn(move || {
        let mut last_should_show_icon = false;
        let mut last_option_held = false;
        let mut last_in_corner = false;
        let mut log_counter = 0u32;

        // Get the right-most monitor for positioning
        let monitor = match get_rightmost_monitor(&app) {
            Ok(m) => m,
            Err(e) => {
                peek_log!("❌ Failed to get right-most monitor: {}", e);
                MONITORING_ACTIVE.store(false, Ordering::SeqCst);
                return;
            }
        };

        peek_log!(
            "📺 Using RIGHT-MOST monitor: {}x{} @ ({}, {}), scale={}x",
            monitor.width,
            monitor.height,
            monitor.x,
            monitor.y,
            monitor.scale_factor
        );

        let (icon_x, icon_y) = monitor.icon_position();
        peek_log!("🎯 Icon position: ({}, {})", icon_x, icon_y);

        loop {
            if !MONITORING_ACTIVE.load(Ordering::SeqCst) {
                peek_log!("🛑 Monitoring stopped");
                break;
            }

            let option_held = macos::is_option_held();
            let (cursor_x, cursor_y) = macos::get_cursor_position();
            let in_corner = monitor.is_cursor_in_corner(cursor_x, cursor_y);
            let main_open = is_main_window_open();

            // Log state changes
            if option_held != last_option_held {
                peek_log!(
                    "⌥ Option key {}",
                    if option_held { "PRESSED" } else { "RELEASED" }
                );
                last_option_held = option_held;
            }

            if in_corner != last_in_corner {
                peek_log!(
                    "🎯 Cursor {} corner zone at ({:.0}, {:.0})",
                    if in_corner { "ENTERED" } else { "LEFT" },
                    cursor_x,
                    cursor_y
                );
                last_in_corner = in_corner;
            }

            // Periodic logging
            log_counter = log_counter.wrapping_add(1);
            if option_held && log_counter.is_multiple_of(40) {
                peek_log!(
                    "🖱️ Cursor: ({:.0}, {:.0}) | In corner: {} | Main open: {}",
                    cursor_x,
                    cursor_y,
                    in_corner,
                    main_open
                );
            }

            // Determine if icon should be shown
            // Show icon when: Option held AND cursor in corner AND main window NOT open
            let should_show_icon = option_held && in_corner && !main_open;

            if should_show_icon != last_should_show_icon {
                peek_log!(
                    "🔄 Icon visibility: {} (option={}, corner={}, main_open={})",
                    if should_show_icon { "SHOW" } else { "HIDE" },
                    option_held,
                    in_corner,
                    main_open
                );
                last_should_show_icon = should_show_icon;

                if should_show_icon {
                    if let Err(e) = show_icon(&app) {
                        peek_log!("❌ Failed to show icon: {}", e);
                    }
                } else if let Err(e) = hide_icon(&app) {
                    peek_log!("❌ Failed to hide icon: {}", e);
                }

                // Emit state change
                let state = if main_open {
                    PeekState::Expanded
                } else if should_show_icon {
                    PeekState::Peeking
                } else {
                    PeekState::Hidden
                };

                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("peek:state", state);
                }
            }

            std::thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));
        }
    });
}

/// Stops the background monitoring thread.
#[allow(dead_code)]
pub fn stop_monitoring() {
    MONITORING_ACTIVE.store(false, Ordering::SeqCst);
}

// =============================================================================
// Preview Indicator Window
// =============================================================================

/// Size of the preview indicator window
const PREVIEW_INDICATOR_WIDTH: f64 = 300.0;
const PREVIEW_INDICATOR_HEIGHT: f64 = 80.0;
const PREVIEW_INDICATOR_MARGIN: f64 = 20.0; // Large margin to ensure it's visible on screen

/// State sent to the preview indicator window
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewIndicatorState {
    pub visible: bool,
    pub summary: Option<String>,
    pub files_changed: usize,
    pub additions: Option<usize>,
    pub deletions: Option<usize>,
    pub is_loading: bool,
}

/// Cache of the current preview indicator state (for late-mounting windows)
static PREVIEW_INDICATOR_STATE: Lazy<Mutex<PreviewIndicatorState>> = Lazy::new(|| {
    Mutex::new(PreviewIndicatorState {
        visible: false,
        summary: None,
        files_changed: 0,
        additions: None,
        deletions: None,
        is_loading: false,
    })
});

/// Get the current preview indicator state (for window to call on mount)
pub fn get_preview_indicator_state() -> PreviewIndicatorState {
    match PREVIEW_INDICATOR_STATE.lock() {
        Ok(guard) => guard.clone(),
        Err(e) => {
            let msg = format!("PREVIEW_INDICATOR_STATE mutex poisoned: {}", e);
            log::error!("{}", msg);
            sentry::capture_message(&msg, sentry::Level::Error);
            // Return a sensible default state to keep the app running
            PreviewIndicatorState {
                visible: false,
                summary: None,
                files_changed: 0,
                additions: None,
                deletions: None,
                is_loading: false,
            }
        }
    }
}

/// Creates the preview indicator window (call once during setup)
pub fn create_preview_indicator_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let monitor = get_rightmost_monitor(app)?;

    // Convert to logical pixels for positioning (monitor dimensions are in physical pixels)
    let scale = monitor.scale_factor;
    let logical_width = monitor.width / scale;
    let logical_height = monitor.height / scale;
    let logical_x = monitor.x / scale;
    let logical_y = monitor.y / scale;

    // Position at bottom-right, above where the main widget would appear
    let x = logical_x + logical_width - PREVIEW_INDICATOR_WIDTH - PREVIEW_INDICATOR_MARGIN;
    let y = logical_y + logical_height - PREVIEW_INDICATOR_HEIGHT - PREVIEW_INDICATOR_MARGIN;

    peek_log!(
        "🏷️ Creating preview indicator window at logical ({}, {}), scale={}, monitor={}x{}",
        x,
        y,
        scale,
        logical_width,
        logical_height
    );

    let window = WebviewWindowBuilder::new(
        app,
        "preview-indicator",
        WebviewUrl::App("preview-indicator.html".into()),
    )
    .title("Preview")
    .inner_size(PREVIEW_INDICATOR_WIDTH, PREVIEW_INDICATOR_HEIGHT)
    .position(x, y)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .visible(true) // Start hidden
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .build()
    .map_err(|e| e.to_string())?;

    // Disable shadow and set as utility panel (prevents grouping with main window)
    #[cfg(target_os = "macos")]
    {
        use cocoa::appkit::{NSWindow, NSWindowCollectionBehavior};
        use cocoa::base::id;
        use objc::msg_send;
        use objc::sel;
        use objc::sel_impl;

        let _ = window.set_shadow(false);

        // Get the native NSWindow and configure it as an independent panel
        if let Ok(ns_window) = window.ns_window() {
            let ns_win = ns_window as id;
            unsafe {
                // Set collection behavior to be independent (not grouped with other windows)
                // NSWindowCollectionBehaviorStationary keeps it from moving with spaces
                // NSWindowCollectionBehaviorCanJoinAllSpaces makes it visible on all spaces
                // NSWindowCollectionBehaviorIgnoresCycle prevents Cmd+` from cycling to it
                ns_win.setCollectionBehavior_(
                    NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary
                        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorIgnoresCycle,
                );

                // Set as a floating panel level (above regular windows but independent)
                // kCGFloatingWindowLevel = 5 (or we can use NSFloatingWindowLevel = 3)
                let floating_level: i64 = 3; // NSFloatingWindowLevel
                let _: () = msg_send![ns_win, setLevel: floating_level];
            }
        }
    }

    Ok(())
}

/// Shows the preview indicator window
pub fn show_preview_indicator<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("preview-indicator") {
        // Reposition in case monitor setup changed
        let monitor = get_rightmost_monitor(app)?;

        // Convert to logical pixels for positioning
        let scale = monitor.scale_factor;
        let logical_width = monitor.width / scale;
        let logical_height = monitor.height / scale;
        let logical_x = monitor.x / scale;
        let logical_y = monitor.y / scale;

        let x = logical_x + logical_width - PREVIEW_INDICATOR_WIDTH - PREVIEW_INDICATOR_MARGIN;
        let y = logical_y + logical_height - PREVIEW_INDICATOR_HEIGHT - PREVIEW_INDICATOR_MARGIN;

        // Use physical position (convert logical back to physical)
        let phys_x = (x * scale) as i32;
        let phys_y = (y * scale) as i32;

        window
            .set_position(PhysicalPosition::new(phys_x, phys_y))
            .map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        peek_log!(
            "🏷️ Showing preview indicator at logical ({}, {}), physical ({}, {})",
            x,
            y,
            phys_x,
            phys_y
        );
    }
    Ok(())
}

/// Hides the preview indicator window
pub fn hide_preview_indicator<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("preview-indicator") {
        window.hide().map_err(|e| e.to_string())?;
        peek_log!("🏷️ Hiding preview indicator");
    }
    Ok(())
}

/// Updates the preview indicator state
pub fn update_preview_indicator<R: Runtime>(
    app: &AppHandle<R>,
    state: PreviewIndicatorState,
) -> Result<(), String> {
    // Track whether there are uncommitted changes
    let has_changes = state.files_changed > 0;
    set_has_uncommitted_changes(has_changes);

    // Cache the state for late-mounting windows
    match PREVIEW_INDICATOR_STATE.lock() {
        Ok(mut guard) => {
            *guard = state.clone();
        }
        Err(e) => {
            let msg = format!(
                "PREVIEW_INDICATOR_STATE mutex poisoned while updating: {}",
                e
            );
            log::error!("{}", msg);
            sentry::capture_message(&msg, sentry::Level::Error);
        }
    }

    if let Some(window) = app.get_webview_window("preview-indicator") {
        window
            .emit("preview-indicator:update", &state)
            .map_err(|e| e.to_string())?;

        // Show preview indicator whenever there are visible changes,
        // regardless of whether main window is open
        if state.visible {
            show_preview_indicator(app)?;
        } else {
            hide_preview_indicator(app)?;
        }
    }
    Ok(())
}

// =============================================================================
// Debug Zone Info
// =============================================================================

/// Debug info for the corner zone visualization
#[derive(Debug, Clone, serde::Serialize)]
pub struct DebugZoneInfo {
    pub enabled: bool,
    pub corner_zone_size: f64,
    pub screen_width: f64,
    pub screen_height: f64,
    pub scale_factor: f64,
}

/// Returns debug info for visualizing the corner zone
pub fn get_debug_zone_info<R: Runtime>(app: &AppHandle<R>) -> Result<DebugZoneInfo, String> {
    let monitor = get_rightmost_monitor(app)?;

    let corner_zone_logical = CORNER_ZONE / monitor.scale_factor;
    let screen_width_logical = monitor.width / monitor.scale_factor;
    let screen_height_logical = monitor.height / monitor.scale_factor;

    Ok(DebugZoneInfo {
        enabled: false, // Disable debug overlay for now
        corner_zone_size: corner_zone_logical,
        screen_width: screen_width_logical,
        screen_height: screen_height_logical,
        scale_factor: monitor.scale_factor,
    })
}
