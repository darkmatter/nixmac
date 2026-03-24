//! macOS system defaults scanner.
//!
//! Reads macOS user defaults domains, compares values against known factory
//! defaults, and produces a list of non-default settings that map to
//! nix-darwin `system.defaults.*` keys. Also generates valid `.nix` module
//! files from the detected customizations.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::process::Command;

// =============================================================================
// Types
// =============================================================================

/// A single macOS system default that differs from the factory value.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemDefault {
    /// nix-darwin key path, e.g. `"system.defaults.dock.autohide"`
    pub nix_key: String,
    /// Human-readable label, e.g. `"Automatically hide the Dock"`
    pub label: String,
    /// Category for grouping in the UI
    pub category: String,
    /// Current value on this machine (as a string)
    pub current_value: String,
    /// Factory default value (as a string)
    pub default_value: String,
}

/// Result of a full system defaults scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemDefaultsScan {
    /// Only the settings that differ from macOS factory defaults.
    pub defaults: Vec<SystemDefault>,
    /// Total number of keys checked across all domains.
    pub total_scanned: usize,
}

/// A recommended prompt based on the user's current macOS settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendedPrompt {
    pub id: String,
    pub prompt_text: String,
}

// =============================================================================
// Domain value types
// =============================================================================

/// The expected type of a defaults key, used for comparison and Nix formatting.
#[derive(Debug, Clone, Copy, PartialEq)]
enum ValType {
    Bool,
    Int,
    Float,
    String,
}

/// Definition of a single scannable key.
struct KeyDef {
    /// The key name inside the defaults domain (e.g. `"autohide"`)
    defaults_key: &'static str,
    /// The nix-darwin attribute path (e.g. `"system.defaults.dock.autohide"`)
    nix_key: &'static str,
    /// Human-readable description
    label: &'static str,
    /// UI grouping category
    category: &'static str,
    /// Expected value type
    val_type: ValType,
    /// The factory default value as a string
    factory_default: &'static str,
}

// =============================================================================
// Factory defaults table
// =============================================================================

/// All nix-darwin-supported `system.defaults.*` keys with their macOS factory
/// defaults. Organised by domain for readability.
const KEY_DEFS: &[(&str, &[KeyDef])] = &[
    // ── Dock ──────────────────────────────────────────────────────────────
    (
        "com.apple.dock",
        &[
            KeyDef {
                defaults_key: "autohide",
                nix_key: "system.defaults.dock.autohide",
                label: "Automatically hide the Dock",
                category: "Dock",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "autohide-delay",
                nix_key: "system.defaults.dock.autohide-delay",
                label: "Dock auto-hide delay",
                category: "Dock",
                val_type: ValType::Float,
                factory_default: "0.24",
            },
            KeyDef {
                defaults_key: "autohide-time-modifier",
                nix_key: "system.defaults.dock.autohide-time-modifier",
                label: "Dock auto-hide animation speed",
                category: "Dock",
                val_type: ValType::Float,
                factory_default: "0.5",
            },
            KeyDef {
                defaults_key: "expose-group-apps",
                nix_key: "system.defaults.dock.expose-group-apps",
                label: "Group windows by application in Mission Control",
                category: "Dock",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "largesize",
                nix_key: "system.defaults.dock.largesize",
                label: "Dock magnification icon size",
                category: "Dock",
                val_type: ValType::Int,
                factory_default: "64",
            },
            KeyDef {
                defaults_key: "launchanim",
                nix_key: "system.defaults.dock.launchanim",
                label: "Animate opening applications",
                category: "Dock",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "magnification",
                nix_key: "system.defaults.dock.magnification",
                label: "Enable Dock magnification",
                category: "Dock",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "mineffect",
                nix_key: "system.defaults.dock.mineffect",
                label: "Minimize window effect",
                category: "Dock",
                val_type: ValType::String,
                factory_default: "genie",
            },
            KeyDef {
                defaults_key: "minimize-to-application",
                nix_key: "system.defaults.dock.minimize-to-application",
                label: "Minimize windows into application icon",
                category: "Dock",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "mru-spaces",
                nix_key: "system.defaults.dock.mru-spaces",
                label: "Automatically rearrange Spaces based on recent use",
                category: "Dock",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "orientation",
                nix_key: "system.defaults.dock.orientation",
                label: "Dock position on screen",
                category: "Dock",
                val_type: ValType::String,
                factory_default: "bottom",
            },
            KeyDef {
                defaults_key: "persistent-apps",
                nix_key: "system.defaults.dock.persistent-apps",
                label: "Persistent Dock apps (managed)",
                category: "Dock",
                val_type: ValType::String,
                factory_default: "",
            },
            KeyDef {
                defaults_key: "persistent-others",
                nix_key: "system.defaults.dock.persistent-others",
                label: "Persistent Dock folders (managed)",
                category: "Dock",
                val_type: ValType::String,
                factory_default: "",
            },
            KeyDef {
                defaults_key: "show-process-indicators",
                nix_key: "system.defaults.dock.show-process-indicators",
                label: "Show indicator lights for open apps",
                category: "Dock",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "show-recents",
                nix_key: "system.defaults.dock.show-recents",
                label: "Show recent applications in Dock",
                category: "Dock",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "showhidden",
                nix_key: "system.defaults.dock.showhidden",
                label: "Make hidden app icons translucent",
                category: "Dock",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "static-only",
                nix_key: "system.defaults.dock.static-only",
                label: "Show only open applications in Dock",
                category: "Dock",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "tilesize",
                nix_key: "system.defaults.dock.tilesize",
                label: "Dock icon size",
                category: "Dock",
                val_type: ValType::Int,
                factory_default: "48",
            },
            KeyDef {
                defaults_key: "wvous-bl-corner",
                nix_key: "system.defaults.dock.wvous-bl-corner",
                label: "Hot corner: bottom-left",
                category: "Dock",
                val_type: ValType::Int,
                factory_default: "1",
            },
            KeyDef {
                defaults_key: "wvous-br-corner",
                nix_key: "system.defaults.dock.wvous-br-corner",
                label: "Hot corner: bottom-right",
                category: "Dock",
                val_type: ValType::Int,
                factory_default: "1",
            },
            KeyDef {
                defaults_key: "wvous-tl-corner",
                nix_key: "system.defaults.dock.wvous-tl-corner",
                label: "Hot corner: top-left",
                category: "Dock",
                val_type: ValType::Int,
                factory_default: "1",
            },
            KeyDef {
                defaults_key: "wvous-tr-corner",
                nix_key: "system.defaults.dock.wvous-tr-corner",
                label: "Hot corner: top-right",
                category: "Dock",
                val_type: ValType::Int,
                factory_default: "1",
            },
        ],
    ),
    // ── Finder ─────────────────────────────────────────────────────────────
    (
        "com.apple.finder",
        &[
            KeyDef {
                defaults_key: "AppleShowAllExtensions",
                nix_key: "system.defaults.finder.AppleShowAllExtensions",
                label: "Show all filename extensions",
                category: "Finder",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "AppleShowAllFiles",
                nix_key: "system.defaults.finder.AppleShowAllFiles",
                label: "Show hidden files",
                category: "Finder",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "CreateDesktop",
                nix_key: "system.defaults.finder.CreateDesktop",
                label: "Show icons on the desktop",
                category: "Finder",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "FXDefaultSearchScope",
                nix_key: "system.defaults.finder.FXDefaultSearchScope",
                label: "Default search scope",
                category: "Finder",
                val_type: ValType::String,
                factory_default: "SCev",
            },
            KeyDef {
                defaults_key: "FXEnableExtensionChangeWarning",
                nix_key: "system.defaults.finder.FXEnableExtensionChangeWarning",
                label: "Warn before changing file extensions",
                category: "Finder",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "FXPreferredViewStyle",
                nix_key: "system.defaults.finder.FXPreferredViewStyle",
                label: "Preferred view style",
                category: "Finder",
                val_type: ValType::String,
                factory_default: "icnv",
            },
            KeyDef {
                defaults_key: "QuitMenuItem",
                nix_key: "system.defaults.finder.QuitMenuItem",
                label: "Allow quitting Finder via ⌘Q",
                category: "Finder",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "ShowPathbar",
                nix_key: "system.defaults.finder.ShowPathbar",
                label: "Show path bar at bottom of Finder",
                category: "Finder",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "ShowStatusBar",
                nix_key: "system.defaults.finder.ShowStatusBar",
                label: "Show status bar at bottom of Finder",
                category: "Finder",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "_FXShowPosixPathInTitle",
                nix_key: "system.defaults.finder._FXShowPosixPathInTitle",
                label: "Show full POSIX path in Finder title bar",
                category: "Finder",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "_FXSortFoldersFirst",
                nix_key: "system.defaults.finder._FXSortFoldersFirst",
                label: "Keep folders on top when sorting by name",
                category: "Finder",
                val_type: ValType::Bool,
                factory_default: "false",
            },
        ],
    ),
    // ── NSGlobalDomain ─────────────────────────────────────────────────────
    (
        "NSGlobalDomain",
        &[
            KeyDef {
                defaults_key: "AppleEnableMouseSwipeNavigateWithScrolls",
                nix_key: "system.defaults.NSGlobalDomain.AppleEnableMouseSwipeNavigateWithScrolls",
                label: "Enable mouse swipe navigation",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "AppleEnableSwipeNavigateWithScrolls",
                nix_key: "system.defaults.NSGlobalDomain.AppleEnableSwipeNavigateWithScrolls",
                label: "Enable trackpad swipe navigation",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "AppleICUForce24HourTime",
                nix_key: "system.defaults.NSGlobalDomain.AppleICUForce24HourTime",
                label: "Use 24-hour time",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "AppleInterfaceStyle",
                nix_key: "system.defaults.NSGlobalDomain.AppleInterfaceStyle",
                label: "Dark Mode",
                category: "Global",
                val_type: ValType::String,
                factory_default: "",
            },
            KeyDef {
                defaults_key: "AppleInterfaceStyleSwitchesAutomatically",
                nix_key: "system.defaults.NSGlobalDomain.AppleInterfaceStyleSwitchesAutomatically",
                label: "Automatically switch between Light and Dark Mode",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "AppleMeasurementUnits",
                nix_key: "system.defaults.NSGlobalDomain.AppleMeasurementUnits",
                label: "Measurement units",
                category: "Global",
                val_type: ValType::String,
                factory_default: "Centimeters",
            },
            KeyDef {
                defaults_key: "AppleMetricUnits",
                nix_key: "system.defaults.NSGlobalDomain.AppleMetricUnits",
                label: "Use metric units",
                category: "Global",
                val_type: ValType::Int,
                factory_default: "1",
            },
            KeyDef {
                defaults_key: "ApplePressAndHoldEnabled",
                nix_key: "system.defaults.NSGlobalDomain.ApplePressAndHoldEnabled",
                label: "Press-and-hold for accented characters (vs key repeat)",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "AppleScrollerPagingBehavior",
                nix_key: "system.defaults.NSGlobalDomain.AppleScrollerPagingBehavior",
                label: "Click in scroll bar to jump to spot",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "AppleShowAllExtensions",
                nix_key: "system.defaults.NSGlobalDomain.AppleShowAllExtensions",
                label: "Show all filename extensions (global)",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "AppleShowScrollBars",
                nix_key: "system.defaults.NSGlobalDomain.AppleShowScrollBars",
                label: "Show scroll bars",
                category: "Global",
                val_type: ValType::String,
                factory_default: "Automatic",
            },
            KeyDef {
                defaults_key: "AppleTemperatureUnit",
                nix_key: "system.defaults.NSGlobalDomain.AppleTemperatureUnit",
                label: "Temperature unit",
                category: "Global",
                val_type: ValType::String,
                factory_default: "Celsius",
            },
            KeyDef {
                defaults_key: "AppleWindowTabbingMode",
                nix_key: "system.defaults.NSGlobalDomain.AppleWindowTabbingMode",
                label: "Prefer tabs when opening documents",
                category: "Global",
                val_type: ValType::String,
                factory_default: "always",
            },
            KeyDef {
                defaults_key: "InitialKeyRepeat",
                nix_key: "system.defaults.NSGlobalDomain.InitialKeyRepeat",
                label: "Delay until key repeat starts",
                category: "Global",
                val_type: ValType::Int,
                factory_default: "25",
            },
            KeyDef {
                defaults_key: "KeyRepeat",
                nix_key: "system.defaults.NSGlobalDomain.KeyRepeat",
                label: "Key repeat rate",
                category: "Global",
                val_type: ValType::Int,
                factory_default: "6",
            },
            KeyDef {
                defaults_key: "NSAutomaticCapitalizationEnabled",
                nix_key: "system.defaults.NSGlobalDomain.NSAutomaticCapitalizationEnabled",
                label: "Auto-capitalize words",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "NSAutomaticDashSubstitutionEnabled",
                nix_key: "system.defaults.NSGlobalDomain.NSAutomaticDashSubstitutionEnabled",
                label: "Auto-convert dashes",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "NSAutomaticInlinePredictionEnabled",
                nix_key: "system.defaults.NSGlobalDomain.NSAutomaticInlinePredictionEnabled",
                label: "Inline text prediction",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "NSAutomaticPeriodSubstitutionEnabled",
                nix_key: "system.defaults.NSGlobalDomain.NSAutomaticPeriodSubstitutionEnabled",
                label: "Auto-insert period with double-space",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "NSAutomaticQuoteSubstitutionEnabled",
                nix_key: "system.defaults.NSGlobalDomain.NSAutomaticQuoteSubstitutionEnabled",
                label: "Smart quotes",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "NSAutomaticSpellingCorrectionEnabled",
                nix_key: "system.defaults.NSGlobalDomain.NSAutomaticSpellingCorrectionEnabled",
                label: "Auto-correct spelling",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "NSAutomaticWindowAnimationsEnabled",
                nix_key: "system.defaults.NSGlobalDomain.NSAutomaticWindowAnimationsEnabled",
                label: "Window opening/closing animations",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "NSDisableAutomaticTermination",
                nix_key: "system.defaults.NSGlobalDomain.NSDisableAutomaticTermination",
                label: "Disable automatic termination of inactive apps",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "NSDocumentSaveNewDocumentsToCloud",
                nix_key: "system.defaults.NSGlobalDomain.NSDocumentSaveNewDocumentsToCloud",
                label: "Save new documents to iCloud by default",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "NSNavPanelExpandedStateForSaveMode",
                nix_key: "system.defaults.NSGlobalDomain.NSNavPanelExpandedStateForSaveMode",
                label: "Expand save panel by default",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "NSNavPanelExpandedStateForSaveMode2",
                nix_key: "system.defaults.NSGlobalDomain.NSNavPanelExpandedStateForSaveMode2",
                label: "Expand save panel by default (secondary)",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "NSScrollAnimationEnabled",
                nix_key: "system.defaults.NSGlobalDomain.NSScrollAnimationEnabled",
                label: "Smooth scrolling",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "NSTableViewDefaultSizeMode",
                nix_key: "system.defaults.NSGlobalDomain.NSTableViewDefaultSizeMode",
                label: "Sidebar icon size (1=small, 2=medium, 3=large)",
                category: "Global",
                val_type: ValType::Int,
                factory_default: "2",
            },
            KeyDef {
                defaults_key: "NSTextShowsControlCharacters",
                nix_key: "system.defaults.NSGlobalDomain.NSTextShowsControlCharacters",
                label: "Show control characters in text fields",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "NSWindowResizeTime",
                nix_key: "system.defaults.NSGlobalDomain.NSWindowResizeTime",
                label: "Window resize animation speed",
                category: "Global",
                val_type: ValType::Float,
                factory_default: "0.2",
            },
            KeyDef {
                defaults_key: "NSWindowShouldDragOnGesture",
                nix_key: "system.defaults.NSGlobalDomain.NSWindowShouldDragOnGesture",
                label: "Drag windows with ⌃⌘ click anywhere",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "PMPrintingExpandedStateForPrint",
                nix_key: "system.defaults.NSGlobalDomain.PMPrintingExpandedStateForPrint",
                label: "Expand print panel by default",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "PMPrintingExpandedStateForPrint2",
                nix_key: "system.defaults.NSGlobalDomain.PMPrintingExpandedStateForPrint2",
                label: "Expand print panel by default (secondary)",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "com.apple.mouse.tapBehavior",
                nix_key: "system.defaults.NSGlobalDomain.\"com.apple.mouse.tapBehavior\"",
                label: "Tap to click",
                category: "Global",
                val_type: ValType::Int,
                factory_default: "0",
            },
            KeyDef {
                defaults_key: "com.apple.sound.beep.feedback",
                nix_key: "system.defaults.NSGlobalDomain.\"com.apple.sound.beep.feedback\"",
                label: "Play feedback when volume is changed",
                category: "Global",
                val_type: ValType::Int,
                factory_default: "1",
            },
            KeyDef {
                defaults_key: "com.apple.sound.beep.volume",
                nix_key: "system.defaults.NSGlobalDomain.\"com.apple.sound.beep.volume\"",
                label: "Alert sound volume",
                category: "Global",
                val_type: ValType::Float,
                factory_default: "0.5",
            },
            KeyDef {
                defaults_key: "com.apple.springing.delay",
                nix_key: "system.defaults.NSGlobalDomain.\"com.apple.springing.delay\"",
                label: "Spring-loaded folders delay",
                category: "Global",
                val_type: ValType::Float,
                factory_default: "0.5",
            },
            KeyDef {
                defaults_key: "com.apple.springing.enabled",
                nix_key: "system.defaults.NSGlobalDomain.\"com.apple.springing.enabled\"",
                label: "Enable spring-loaded folders",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "com.apple.swipescrolldirection",
                nix_key: "system.defaults.NSGlobalDomain.\"com.apple.swipescrolldirection\"",
                label: "Natural scrolling direction",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "com.apple.trackpad.enableSecondaryClick",
                nix_key:
                    "system.defaults.NSGlobalDomain.\"com.apple.trackpad.enableSecondaryClick\"",
                label: "Enable secondary click on trackpad",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "com.apple.trackpad.forceClick",
                nix_key: "system.defaults.NSGlobalDomain.\"com.apple.trackpad.forceClick\"",
                label: "Force Click and haptic feedback",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "com.apple.trackpad.scaling",
                nix_key: "system.defaults.NSGlobalDomain.\"com.apple.trackpad.scaling\"",
                label: "Trackpad tracking speed",
                category: "Global",
                val_type: ValType::Float,
                factory_default: "1.0",
            },
        ],
    ),
    // ── Trackpad ──────────────────────────────────────────────────────────
    (
        "com.apple.AppleMultitouchTrackpad",
        &[
            KeyDef {
                defaults_key: "ActuateDetents",
                nix_key: "system.defaults.trackpad.ActuateDetents",
                label: "Actuate detents haptic feedback",
                category: "Trackpad",
                val_type: ValType::Int,
                factory_default: "1",
            },
            KeyDef {
                defaults_key: "Clicking",
                nix_key: "system.defaults.trackpad.Clicking",
                label: "Tap to click on trackpad",
                category: "Trackpad",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "DragLock",
                nix_key: "system.defaults.trackpad.DragLock",
                label: "Drag lock",
                category: "Trackpad",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "Dragging",
                nix_key: "system.defaults.trackpad.Dragging",
                label: "Three-finger drag",
                category: "Trackpad",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "FirstClickThreshold",
                nix_key: "system.defaults.trackpad.FirstClickThreshold",
                label: "Click pressure threshold (0=light, 1=medium, 2=firm)",
                category: "Trackpad",
                val_type: ValType::Int,
                factory_default: "1",
            },
            KeyDef {
                defaults_key: "SecondClickThreshold",
                nix_key: "system.defaults.trackpad.SecondClickThreshold",
                label: "Force click pressure threshold",
                category: "Trackpad",
                val_type: ValType::Int,
                factory_default: "1",
            },
            KeyDef {
                defaults_key: "TrackpadRightClick",
                nix_key: "system.defaults.trackpad.TrackpadRightClick",
                label: "Two-finger right click",
                category: "Trackpad",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "TrackpadThreeFingerDrag",
                nix_key: "system.defaults.trackpad.TrackpadThreeFingerDrag",
                label: "Three-finger drag gesture",
                category: "Trackpad",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "TrackpadThreeFingerTapGesture",
                nix_key: "system.defaults.trackpad.TrackpadThreeFingerTapGesture",
                label: "Three-finger tap gesture",
                category: "Trackpad",
                val_type: ValType::Int,
                factory_default: "0",
            },
        ],
    ),
    // ── Screenshot ─────────────────────────────────────────────────────────
    (
        "com.apple.screencapture",
        &[
            KeyDef {
                defaults_key: "disable-shadow",
                nix_key: "system.defaults.screencapture.disable-shadow",
                label: "Disable shadow in screenshots",
                category: "Screenshot",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "location",
                nix_key: "system.defaults.screencapture.location",
                label: "Screenshot save location",
                category: "Screenshot",
                val_type: ValType::String,
                factory_default: "~/Desktop",
            },
            KeyDef {
                defaults_key: "show-thumbnail",
                nix_key: "system.defaults.screencapture.show-thumbnail",
                label: "Show thumbnail after taking screenshot",
                category: "Screenshot",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "type",
                nix_key: "system.defaults.screencapture.type",
                label: "Screenshot file format",
                category: "Screenshot",
                val_type: ValType::String,
                factory_default: "png",
            },
        ],
    ),
    // ── Login Window ──────────────────────────────────────────────────────
    (
        "com.apple.loginwindow",
        &[
            KeyDef {
                defaults_key: "DisableConsoleAccess",
                nix_key: "system.defaults.loginwindow.DisableConsoleAccess",
                label: "Disable console access at login",
                category: "Login Window",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "GuestEnabled",
                nix_key: "system.defaults.loginwindow.GuestEnabled",
                label: "Allow guest user login",
                category: "Login Window",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "LoginwindowText",
                nix_key: "system.defaults.loginwindow.LoginwindowText",
                label: "Login window message text",
                category: "Login Window",
                val_type: ValType::String,
                factory_default: "",
            },
            KeyDef {
                defaults_key: "PowerOffDisabledWhileLoggedIn",
                nix_key: "system.defaults.loginwindow.PowerOffDisabledWhileLoggedIn",
                label: "Disable power off while logged in",
                category: "Login Window",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "RestartDisabled",
                nix_key: "system.defaults.loginwindow.RestartDisabled",
                label: "Disable restart button at login",
                category: "Login Window",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "RestartDisabledWhileLoggedIn",
                nix_key: "system.defaults.loginwindow.RestartDisabledWhileLoggedIn",
                label: "Disable restart while logged in",
                category: "Login Window",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "SHOWFULLNAME",
                nix_key: "system.defaults.loginwindow.SHOWFULLNAME",
                label: "Show full name at login window",
                category: "Login Window",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "ShutDownDisabled",
                nix_key: "system.defaults.loginwindow.ShutDownDisabled",
                label: "Disable shut down button at login",
                category: "Login Window",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "ShutDownDisabledWhileLoggedIn",
                nix_key: "system.defaults.loginwindow.ShutDownDisabledWhileLoggedIn",
                label: "Disable shut down while logged in",
                category: "Login Window",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "SleepDisabled",
                nix_key: "system.defaults.loginwindow.SleepDisabled",
                label: "Disable sleep button at login",
                category: "Login Window",
                val_type: ValType::Bool,
                factory_default: "false",
            },
        ],
    ),
    // ── Screensaver ────────────────────────────────────────────────────────
    (
        "com.apple.screensaver",
        &[
            KeyDef {
                defaults_key: "askForPassword",
                nix_key: "system.defaults.screensaver.askForPassword",
                label: "Require password after screensaver",
                category: "Screensaver",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "askForPasswordDelay",
                nix_key: "system.defaults.screensaver.askForPasswordDelay",
                label: "Seconds before password required after screensaver",
                category: "Screensaver",
                val_type: ValType::Int,
                factory_default: "5",
            },
        ],
    ),
    // ── Spaces ─────────────────────────────────────────────────────────────
    (
        "com.apple.spaces",
        &[KeyDef {
            defaults_key: "spans-displays",
            nix_key: "system.defaults.spaces.spans-displays",
            label: "Displays have separate Spaces",
            category: "Spaces",
            val_type: ValType::Bool,
            factory_default: "false",
        }],
    ),
    // ── Window Manager ─────────────────────────────────────────────────────
    (
        "com.apple.WindowManager",
        &[
            KeyDef {
                defaults_key: "AppWindowGroupingBehavior",
                nix_key: "system.defaults.WindowManager.AppWindowGroupingBehavior",
                label: "Group windows by application (Stage Manager)",
                category: "Window Manager",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "AutoHide",
                nix_key: "system.defaults.WindowManager.AutoHide",
                label: "Auto-hide Stage Manager strip",
                category: "Window Manager",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "EnableStandardClickToShowDesktop",
                nix_key: "system.defaults.WindowManager.EnableStandardClickToShowDesktop",
                label: "Click wallpaper to reveal desktop",
                category: "Window Manager",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "EnableTiledWindowMargins",
                nix_key: "system.defaults.WindowManager.EnableTiledWindowMargins",
                label: "Show margins around tiled windows",
                category: "Window Manager",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "GloballyEnabled",
                nix_key: "system.defaults.WindowManager.GloballyEnabled",
                label: "Enable Stage Manager",
                category: "Window Manager",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "HideDesktop",
                nix_key: "system.defaults.WindowManager.HideDesktop",
                label: "Hide desktop items in Stage Manager",
                category: "Window Manager",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "StageManagerHideWidgets",
                nix_key: "system.defaults.WindowManager.StageManagerHideWidgets",
                label: "Hide widgets in Stage Manager",
                category: "Window Manager",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "StandardHideDesktopIcons",
                nix_key: "system.defaults.WindowManager.StandardHideDesktopIcons",
                label: "Hide desktop icons (non-Stage Manager)",
                category: "Window Manager",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "StandardHideWidgets",
                nix_key: "system.defaults.WindowManager.StandardHideWidgets",
                label: "Hide widgets (non-Stage Manager)",
                category: "Window Manager",
                val_type: ValType::Bool,
                factory_default: "false",
            },
        ],
    ),
    // ── Control Center ─────────────────────────────────────────────────────
    (
        "com.apple.controlcenter",
        &[
            KeyDef {
                defaults_key: "BatteryShowPercentage",
                nix_key: "system.defaults.controlcenter.BatteryShowPercentage",
                label: "Show battery percentage",
                category: "Control Center",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "Bluetooth",
                nix_key: "system.defaults.controlcenter.Bluetooth",
                label: "Show Bluetooth in menu bar",
                category: "Control Center",
                val_type: ValType::Int,
                factory_default: "0",
            },
            KeyDef {
                defaults_key: "Display",
                nix_key: "system.defaults.controlcenter.Display",
                label: "Show Display in menu bar",
                category: "Control Center",
                val_type: ValType::Int,
                factory_default: "0",
            },
            KeyDef {
                defaults_key: "FocusModes",
                nix_key: "system.defaults.controlcenter.FocusModes",
                label: "Show Focus in menu bar",
                category: "Control Center",
                val_type: ValType::Int,
                factory_default: "0",
            },
            KeyDef {
                defaults_key: "NowPlaying",
                nix_key: "system.defaults.controlcenter.NowPlaying",
                label: "Show Now Playing in menu bar",
                category: "Control Center",
                val_type: ValType::Int,
                factory_default: "0",
            },
            KeyDef {
                defaults_key: "Sound",
                nix_key: "system.defaults.controlcenter.Sound",
                label: "Show Sound in menu bar",
                category: "Control Center",
                val_type: ValType::Int,
                factory_default: "0",
            },
        ],
    ),
    // ── Menu Bar Clock ─────────────────────────────────────────────────────
    (
        "com.apple.menuextra.clock",
        &[
            KeyDef {
                defaults_key: "FlashDateSeparators",
                nix_key: "system.defaults.menuExtraClock.FlashDateSeparators",
                label: "Flash date separators",
                category: "Menu Bar Clock",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "IsAnalog",
                nix_key: "system.defaults.menuExtraClock.IsAnalog",
                label: "Use analog clock",
                category: "Menu Bar Clock",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "Show24Hour",
                nix_key: "system.defaults.menuExtraClock.Show24Hour",
                label: "Show 24-hour time in menu bar",
                category: "Menu Bar Clock",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "ShowDate",
                nix_key: "system.defaults.menuExtraClock.ShowDate",
                label: "Show date in menu bar (0=when space, 1=always, 2=never)",
                category: "Menu Bar Clock",
                val_type: ValType::Int,
                factory_default: "0",
            },
            KeyDef {
                defaults_key: "ShowDayOfWeek",
                nix_key: "system.defaults.menuExtraClock.ShowDayOfWeek",
                label: "Show day of week in menu bar",
                category: "Menu Bar Clock",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "ShowSeconds",
                nix_key: "system.defaults.menuExtraClock.ShowSeconds",
                label: "Show seconds in menu bar clock",
                category: "Menu Bar Clock",
                val_type: ValType::Bool,
                factory_default: "false",
            },
        ],
    ),
    // ── HIToolbox ──────────────────────────────────────────────────────────
    (
        "com.apple.HIToolbox",
        &[KeyDef {
            defaults_key: "AppleFnUsageType",
            nix_key: "system.defaults.hitoolbox.AppleFnUsageType",
            label: "Fn key action (0=none, 1=input source, 2=emoji, 3=dictation)",
            category: "Keyboard",
            val_type: ValType::Int,
            factory_default: "2",
        }],
    ),
    // ── Universal Access ──────────────────────────────────────────────────
    (
        "com.apple.universalaccess",
        &[
            KeyDef {
                defaults_key: "closeViewScrollWheelToggle",
                nix_key: "system.defaults.universalaccess.closeViewScrollWheelToggle",
                label: "Use scroll gesture with modifier to zoom",
                category: "Accessibility",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "closeViewZoomFollowsFocus",
                nix_key: "system.defaults.universalaccess.closeViewZoomFollowsFocus",
                label: "Zoom follows keyboard focus",
                category: "Accessibility",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "mouseDriverCursorSize",
                nix_key: "system.defaults.universalaccess.mouseDriverCursorSize",
                label: "Cursor size",
                category: "Accessibility",
                val_type: ValType::Float,
                factory_default: "1.0",
            },
            KeyDef {
                defaults_key: "reduceMotion",
                nix_key: "system.defaults.universalaccess.reduceMotion",
                label: "Reduce motion",
                category: "Accessibility",
                val_type: ValType::Bool,
                factory_default: "false",
            },
            KeyDef {
                defaults_key: "reduceTransparency",
                nix_key: "system.defaults.universalaccess.reduceTransparency",
                label: "Reduce transparency",
                category: "Accessibility",
                val_type: ValType::Bool,
                factory_default: "false",
            },
        ],
    ),
    // ── Launch Services ───────────────────────────────────────────────────
    (
        "com.apple.LaunchServices",
        &[KeyDef {
            defaults_key: "LSQuarantine",
            nix_key: "system.defaults.LaunchServices.LSQuarantine",
            label: "Quarantine downloaded files",
            category: "Security",
            val_type: ValType::Bool,
            factory_default: "true",
        }],
    ),
    // ── Activity Monitor ──────────────────────────────────────────────────
    (
        "com.apple.ActivityMonitor",
        &[
            KeyDef {
                defaults_key: "IconType",
                nix_key: "system.defaults.ActivityMonitor.IconType",
                label: "Activity Monitor Dock icon type",
                category: "Activity Monitor",
                val_type: ValType::Int,
                factory_default: "0",
            },
            KeyDef {
                defaults_key: "OpenMainWindow",
                nix_key: "system.defaults.ActivityMonitor.OpenMainWindow",
                label: "Open Activity Monitor main window on launch",
                category: "Activity Monitor",
                val_type: ValType::Bool,
                factory_default: "true",
            },
            KeyDef {
                defaults_key: "ShowCategory",
                nix_key: "system.defaults.ActivityMonitor.ShowCategory",
                label: "Default filter category",
                category: "Activity Monitor",
                val_type: ValType::Int,
                factory_default: "100",
            },
            KeyDef {
                defaults_key: "SortColumn",
                nix_key: "system.defaults.ActivityMonitor.SortColumn",
                label: "Sort column",
                category: "Activity Monitor",
                val_type: ValType::String,
                factory_default: "CPUUsage",
            },
            KeyDef {
                defaults_key: "SortDirection",
                nix_key: "system.defaults.ActivityMonitor.SortDirection",
                label: "Sort direction (0=ascending, 1=descending)",
                category: "Activity Monitor",
                val_type: ValType::Int,
                factory_default: "0",
            },
        ],
    ),
    // ── Software Update ───────────────────────────────────────────────────
    (
        "com.apple.SoftwareUpdate",
        &[KeyDef {
            defaults_key: "AutomaticallyInstallMacOSUpdates",
            nix_key: "system.defaults.SoftwareUpdate.AutomaticallyInstallMacOSUpdates",
            label: "Automatically install macOS updates",
            category: "Software Update",
            val_type: ValType::Bool,
            factory_default: "false",
        }],
    ),
    // ── Magic Mouse ───────────────────────────────────────────────────────
    (
        "com.apple.driver.AppleBluetoothMultitouch.mouse",
        &[KeyDef {
            defaults_key: "MouseButtonMode",
            nix_key: "system.defaults.magicmouse.MouseButtonMode",
            label: "Magic Mouse button mode",
            category: "Mouse",
            val_type: ValType::String,
            factory_default: "TwoButton",
        }],
    ),
    // ── SMB Server ────────────────────────────────────────────────────────
    (
        "com.apple.smb.server",
        &[
            KeyDef {
                defaults_key: "NetBIOSName",
                nix_key: "system.defaults.smb.NetBIOSName",
                label: "NetBIOS name for SMB sharing",
                category: "Sharing",
                val_type: ValType::String,
                factory_default: "",
            },
            KeyDef {
                defaults_key: "ServerDescription",
                nix_key: "system.defaults.smb.ServerDescription",
                label: "SMB server description",
                category: "Sharing",
                val_type: ValType::String,
                factory_default: "",
            },
        ],
    ),
];

// =============================================================================
// Domain reading
// =============================================================================

/// Read all keys from a macOS defaults domain using `defaults export`.
/// Returns a map of key → string value.
fn read_domain(domain: &str) -> BTreeMap<String, String> {
    let mut result = BTreeMap::new();

    let output = match Command::new("defaults")
        .args(["export", domain, "-"])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return result,
    };

    let plist = String::from_utf8_lossy(&output.stdout);

    // Simple XML plist parser — we only need <key>…</key> followed by a value
    // element. Full plist parsing is overkill and would add a dependency.
    let mut lines = plist.lines().peekable();
    while let Some(line) = lines.next() {
        let trimmed = line.trim();
        if let Some(key) = extract_xml_tag(trimmed, "key") {
            if let Some(next_line) = lines.peek() {
                let next = next_line.trim();
                if let Some(val) = parse_plist_value(next) {
                    result.insert(key, val);
                }
            }
        }
    }

    result
}

/// Extract the text content of a simple XML tag, e.g. `<key>foo</key>` → `"foo"`.
fn extract_xml_tag(line: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    if line.starts_with(&open) && line.ends_with(&close) {
        let start = open.len();
        let end = line.len() - close.len();
        if start < end {
            return Some(line[start..end].to_string());
        }
    }
    None
}

/// Parse a plist value element into a string representation.
fn parse_plist_value(line: &str) -> Option<String> {
    if line == "<true/>" {
        return Some("true".to_string());
    }
    if line == "<false/>" {
        return Some("false".to_string());
    }
    if let Some(val) = extract_xml_tag(line, "integer") {
        return Some(val);
    }
    if let Some(val) = extract_xml_tag(line, "real") {
        return Some(val);
    }
    if let Some(val) = extract_xml_tag(line, "string") {
        return Some(val);
    }
    // Skip arrays, dicts, data, date — not relevant for our scalar keys
    None
}

// =============================================================================
// Comparison logic
// =============================================================================

/// Compare a current value string against a factory default, taking value type
/// into account. Returns `true` if they are semantically different.
fn values_differ(current: &str, factory: &str, val_type: ValType) -> bool {
    match val_type {
        ValType::Bool => {
            let cur = normalize_bool(current);
            let fac = normalize_bool(factory);
            cur != fac
        }
        ValType::Int => {
            let cur: i64 = current.trim().parse().unwrap_or(0);
            let fac: i64 = factory.trim().parse().unwrap_or(0);
            cur != fac
        }
        ValType::Float => {
            let cur: f64 = current.trim().parse().unwrap_or(0.0);
            let fac: f64 = factory.trim().parse().unwrap_or(0.0);
            (cur - fac).abs() > 0.001
        }
        ValType::String => current.trim() != factory.trim(),
    }
}

/// Normalize various boolean representations to "true" / "false".
fn normalize_bool(val: &str) -> &'static str {
    match val.trim().to_lowercase().as_str() {
        "true" | "1" | "yes" => "true",
        _ => "false",
    }
}

// =============================================================================
// Public scan API
// =============================================================================

/// Scan all supported macOS defaults domains and return settings that differ
/// from the factory defaults.
pub fn scan_system_defaults() -> SystemDefaultsScan {
    let mut defaults = Vec::new();
    let mut total_scanned: usize = 0;

    for (domain, key_defs) in KEY_DEFS {
        let domain_values = read_domain(domain);

        for def in *key_defs {
            total_scanned += 1;

            let current = match domain_values.get(def.defaults_key) {
                Some(v) => v.as_str(),
                None => continue, // key not set → using factory default
            };

            if values_differ(current, def.factory_default, def.val_type) {
                defaults.push(SystemDefault {
                    nix_key: def.nix_key.to_string(),
                    label: def.label.to_string(),
                    category: def.category.to_string(),
                    current_value: current.to_string(),
                    default_value: def.factory_default.to_string(),
                });
            }
        }
    }

    SystemDefaultsScan {
        defaults,
        total_scanned,
    }
}

// =============================================================================
// Nix file generation
// =============================================================================

/// Generate a valid `.nix` module file from the detected non-default settings.
///
/// Groups settings by their nix-darwin category and uses correct Nix value
/// syntax (bools lowercase, strings quoted, numbers unquoted).
/// Find the last `.` that is not inside double quotes.
/// e.g. `system.defaults.NSGlobalDomain."com.apple.sound.beep.feedback"`
///   → splits at the dot before the opening `"`, not inside it.
fn rfind_unquoted_dot(s: &str) -> Option<usize> {
    let mut in_quotes = false;
    let mut last_dot = None;
    for (i, ch) in s.char_indices() {
        match ch {
            '"' => in_quotes = !in_quotes,
            '.' if !in_quotes => last_dot = Some(i),
            _ => {}
        }
    }
    last_dot
}

pub fn generate_system_defaults_nix(defaults: &[SystemDefault]) -> String {
    // Group by nix-darwin attribute path prefix
    // e.g. "system.defaults.dock.autohide" → group key "system.defaults.dock"
    // Quoted segments (e.g. "com.apple.sound.beep.feedback") are kept intact.
    let mut groups: BTreeMap<String, Vec<(&str, &str)>> = BTreeMap::new();

    for d in defaults {
        if let Some(last_dot) = rfind_unquoted_dot(&d.nix_key) {
            let group = &d.nix_key[..last_dot];
            let attr = &d.nix_key[last_dot + 1..];
            groups
                .entry(group.to_string())
                .or_default()
                .push((attr, &d.current_value));
        }
    }

    // Detect the current macOS username for system.primaryUser
    let username = std::env::var("USER").unwrap_or_else(|_| "unknown".to_string());

    let mut out = String::new();
    out.push_str("{ config, ... }:\n\n{\n");
    out.push_str("  # macOS system defaults\n");
    out.push_str(
        "  # Detected by nixmac system scanner \u{2014} these settings differ from macOS factory defaults.\n",
    );
    out.push('\n');
    out.push_str(&format!(
        "  # Required by nix-darwin for system.defaults.* options.\n  system.primaryUser = \"{}\";\n",
        username
    ));

    for (group, attrs) in &groups {
        out.push('\n');
        out.push_str(&format!("  {} = {{\n", group));
        for (attr, value) in attrs {
            let nix_val = to_nix_value(value, group, attr);
            out.push_str(&format!("    {} = {};\n", attr, nix_val));
        }
        out.push_str("  };\n");
    }

    out.push_str("}\n");
    out
}

/// Convert a string value to appropriate Nix syntax based on content analysis.
fn to_nix_value(value: &str, group: &str, attr: &str) -> String {
    // Find the KeyDef to get the expected type
    let val_type = find_val_type(group, attr);

    match val_type {
        Some(ValType::Bool) => {
            if normalize_bool(value) == "true" {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }
        Some(ValType::Int) => {
            // Ensure it's a valid integer
            if let Ok(n) = value.trim().parse::<i64>() {
                n.to_string()
            } else {
                format!("\"{}\"", escape_nix_string(value))
            }
        }
        Some(ValType::Float) => {
            if let Ok(f) = value.trim().parse::<f64>() {
                // Format with enough precision
                let s = format!("{}", f);
                // Ensure it has a decimal point for Nix
                if s.contains('.') {
                    s
                } else {
                    format!("{}.0", s)
                }
            } else {
                format!("\"{}\"", escape_nix_string(value))
            }
        }
        Some(ValType::String) | None => {
            format!("\"{}\"", escape_nix_string(value))
        }
    }
}

/// Find the ValType for a given group + attr combination.
fn find_val_type(group: &str, attr: &str) -> Option<ValType> {
    for (_, key_defs) in KEY_DEFS {
        for def in *key_defs {
            if let Some(last_dot) = rfind_unquoted_dot(def.nix_key) {
                let def_group = &def.nix_key[..last_dot];
                let def_attr = &def.nix_key[last_dot + 1..];
                if def_group == group && def_attr == attr {
                    return Some(def.val_type);
                }
            }
        }
    }
    None
}

/// Escape special characters in a Nix string literal.
fn escape_nix_string(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\t', "\\t")
        .replace("${", "\\${")
}

/// Inject a module import into an existing `flake.nix` file.
///
/// Locates the `modules` list assignment (tolerating any whitespace around `=`,
/// including newlines, e.g. `modules=[`, `modules = [`, `modules\n=\n[`) and
/// adds the new module path before the closing `]`.  Returns an error when no
/// `modules` assignment is found or its value is not a list literal (e.g.
/// `modules = myVar`).
pub fn inject_module_import(content: &str, module_path: &str) -> Result<String, String> {
    use once_cell::sync::Lazy;
    use regex::Regex;

    // Already imported — return unchanged
    if content.contains(module_path) {
        return Ok(content.to_string());
    }

    // Match `modules` with any whitespace (including newlines) around `=`.
    static MODULES_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"\bmodules\s*=\s*").expect("valid regex"));

    let Some(m) = MODULES_RE.find(content) else {
        return Err("Could not find 'modules' assignment".to_string());
    };

    // The value must be a list literal; a bare identifier (e.g. `modules = myVar`)
    // cannot be modified in place.
    let open_bracket = m.end();
    if !content[open_bracket..].starts_with('[') {
        return Err(
            "modules value is not a list literal — cannot inject import automatically".to_string(),
        );
    }

    // Walk forward tracking bracket depth to find the matching `]`.
    // This correctly skips nested lists like `extra-experimental-features = [ ... ];`
    let mut depth: i32 = 0;
    let mut close_bracket: Option<usize> = None;
    for (i, ch) in content[open_bracket..].char_indices() {
        match ch {
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    close_bracket = Some(open_bracket + i);
                    break;
                }
            }
            _ => {}
        }
    }

    let close = close_bracket.ok_or("Unmatched modules list — no closing ']' found")?;

    // Determine indentation by looking for a top-level entry in the modules list.
    // Scan lines between the opening `[` and closing `]` for a recognisable entry.
    let block = &content[open_bracket + 1..close];
    let indent = block
        .lines()
        .find(|line| {
            let t = line.trim();
            t.starts_with("./")
                || t.starts_with("../")
                || t.starts_with("inputs.")
                || t.starts_with("configuration")
        })
        .map(|line| {
            line.chars()
                .take_while(|c| c.is_whitespace())
                .collect::<String>()
        })
        .unwrap_or_else(|| "          ".to_string());

    // Insert the new module path on a new line just before the closing `]`.
    let new_import = format!("{}{}\n", indent, module_path);

    let mut result = String::with_capacity(content.len() + new_import.len());
    result.push_str(&content[..close]);
    // Ensure there's a newline before our import
    if !result.ends_with('\n') {
        result.push('\n');
    }
    result.push_str(&new_import);
    result.push_str(&content[close..]);

    Ok(result)
}

/// Build a summary of applied defaults grouped by category.
/// Returns a list of (title, description) pairs for display in the UI.
pub fn build_summary(defaults: &[SystemDefault]) -> Vec<(String, String)> {
    let mut by_category: BTreeMap<String, Vec<&SystemDefault>> = BTreeMap::new();
    for d in defaults {
        by_category.entry(d.category.clone()).or_default().push(d);
    }

    by_category
        .into_iter()
        .map(|(category, defs)| {
            let examples: Vec<&str> = defs.iter().take(3).map(|d| d.label.as_str()).collect();
            let suffix = if defs.len() > 3 {
                format!(", +{} more", defs.len() - 3)
            } else {
                String::new()
            };
            (
                format!("{} ({})", category, defs.len()),
                format!("{}{}", examples.join(", "), suffix),
            )
        })
        .collect()
}

// =============================================================================
// Recommended prompt selection
// =============================================================================

/// A single target that a recommended prompt checks against.
struct PromptTarget {
    defaults_domain: &'static str,
    defaults_key: &'static str,
    desired_value: &'static str,
}

/// Definition for a curated prompt recommendation.
struct PromptDef {
    id: &'static str,
    prompt_text: &'static str,
    targets: &'static [PromptTarget],
}

/// Curated prompt definitions in priority order. The first prompt whose targets
/// are not all at their desired values is returned as the recommendation.
const PROMPT_DEFS: &[PromptDef] = &[
    PromptDef {
        id: "finder_pathbar",
        prompt_text: "Enable the Finder path bar and status bar",
        targets: &[
            PromptTarget {
                defaults_domain: "com.apple.finder",
                defaults_key: "ShowPathbar",
                desired_value: "true",
            },
            PromptTarget {
                defaults_domain: "com.apple.finder",
                defaults_key: "ShowStatusBar",
                desired_value: "true",
            },
        ],
    },
    PromptDef {
        id: "show_extensions",
        prompt_text: "Show all file extensions in Finder",
        targets: &[
            PromptTarget {
                defaults_domain: "com.apple.finder",
                defaults_key: "AppleShowAllExtensions",
                desired_value: "true",
            },
            PromptTarget {
                defaults_domain: "NSGlobalDomain",
                defaults_key: "AppleShowAllExtensions",
                desired_value: "true",
            },
        ],
    },
    PromptDef {
        id: "dock_autohide",
        prompt_text: "Hide the Dock automatically",
        targets: &[PromptTarget {
            defaults_domain: "com.apple.dock",
            defaults_key: "autohide",
            desired_value: "true",
        }],
    },
    PromptDef {
        id: "tap_to_click",
        prompt_text: "Enable tap to click on the trackpad",
        targets: &[PromptTarget {
            defaults_domain: "com.apple.AppleMultitouchTrackpad",
            defaults_key: "Clicking",
            desired_value: "true",
        }],
    },
    PromptDef {
        id: "folders_first",
        prompt_text: "Sort folders first in Finder",
        targets: &[PromptTarget {
            defaults_domain: "com.apple.finder",
            defaults_key: "_FXSortFoldersFirst",
            desired_value: "true",
        }],
    },
    PromptDef {
        id: "disable_autocorrect",
        prompt_text: "Disable auto-correct and auto-capitalization",
        targets: &[
            PromptTarget {
                defaults_domain: "NSGlobalDomain",
                defaults_key: "NSAutomaticSpellingCorrectionEnabled",
                desired_value: "false",
            },
            PromptTarget {
                defaults_domain: "NSGlobalDomain",
                defaults_key: "NSAutomaticCapitalizationEnabled",
                desired_value: "false",
            },
        ],
    },
];

/// Returns the first curated prompt whose targets are not all at the desired
/// value, or `None` if every prompt is already satisfied.
pub fn recommend_prompt() -> Option<RecommendedPrompt> {
    recommend_prompt_with_reader(read_domain)
}

/// Testable core: accepts a domain-reader function so tests can inject mock data.
fn recommend_prompt_with_reader<F>(reader: F) -> Option<RecommendedPrompt>
where
    F: Fn(&str) -> BTreeMap<String, String>,
{
    // Cache domain reads to avoid re-reading the same domain for multiple prompts.
    let mut domain_cache: BTreeMap<&str, BTreeMap<String, String>> = BTreeMap::new();

    for def in PROMPT_DEFS {
        let needs_change = def.targets.iter().any(|target| {
            let domain_values = domain_cache
                .entry(target.defaults_domain)
                .or_insert_with(|| reader(target.defaults_domain));

            match domain_values.get(target.defaults_key) {
                Some(current) => {
                    // Normalize booleans for comparison
                    normalize_bool(current) != normalize_bool(target.desired_value)
                }
                // Key not set — the system is using whatever macOS factory
                // default is compiled in.  We can't know that value here,
                // so conservatively assume it needs changing.
                None => true,
            }
        });

        if needs_change {
            return Some(RecommendedPrompt {
                id: def.id.to_string(),
                prompt_text: def.prompt_text.to_string(),
            });
        }
    }

    None
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_bool() {
        assert_eq!(normalize_bool("true"), "true");
        assert_eq!(normalize_bool("1"), "true");
        assert_eq!(normalize_bool("yes"), "true");
        assert_eq!(normalize_bool("false"), "false");
        assert_eq!(normalize_bool("0"), "false");
        assert_eq!(normalize_bool("no"), "false");
        assert_eq!(normalize_bool(""), "false");
    }

    #[test]
    fn test_values_differ_bool() {
        assert!(!values_differ("true", "true", ValType::Bool));
        assert!(!values_differ("1", "true", ValType::Bool));
        assert!(values_differ("false", "true", ValType::Bool));
        assert!(values_differ("0", "true", ValType::Bool));
    }

    #[test]
    fn test_values_differ_int() {
        assert!(!values_differ("42", "42", ValType::Int));
        assert!(values_differ("42", "0", ValType::Int));
        assert!(!values_differ("0", "0", ValType::Int));
    }

    #[test]
    fn test_values_differ_float() {
        assert!(!values_differ("0.5", "0.5", ValType::Float));
        assert!(values_differ("1.0", "0.5", ValType::Float));
        // Within tolerance
        assert!(!values_differ("0.5001", "0.5", ValType::Float));
    }

    #[test]
    fn test_values_differ_string() {
        assert!(!values_differ("foo", "foo", ValType::String));
        assert!(values_differ("foo", "bar", ValType::String));
        assert!(!values_differ("", "", ValType::String));
    }

    #[test]
    fn test_to_nix_value_bool() {
        assert_eq!(
            to_nix_value("true", "system.defaults.dock", "autohide"),
            "true"
        );
        assert_eq!(
            to_nix_value("false", "system.defaults.dock", "autohide"),
            "false"
        );
        assert_eq!(
            to_nix_value("1", "system.defaults.dock", "autohide"),
            "true"
        );
    }

    #[test]
    fn test_to_nix_value_int() {
        assert_eq!(to_nix_value("16", "system.defaults.dock", "tilesize"), "16");
        assert_eq!(
            to_nix_value("120", "system.defaults.NSGlobalDomain", "KeyRepeat"),
            "120"
        );
    }

    #[test]
    fn test_to_nix_value_float() {
        assert_eq!(
            to_nix_value("0.0", "system.defaults.dock", "autohide-delay"),
            "0.0"
        );
    }

    #[test]
    fn test_to_nix_value_string() {
        assert_eq!(
            to_nix_value("left", "system.defaults.dock", "orientation"),
            "\"left\""
        );
        assert_eq!(
            to_nix_value(
                "Dark",
                "system.defaults.NSGlobalDomain",
                "AppleInterfaceStyle"
            ),
            "\"Dark\""
        );
    }

    #[test]
    fn test_escape_nix_string() {
        assert_eq!(escape_nix_string("hello"), "hello");
        assert_eq!(escape_nix_string("say \"hi\""), "say \\\"hi\\\"");
        assert_eq!(escape_nix_string("${foo}"), "\\${foo}");
    }

    #[test]
    fn test_generate_system_defaults_nix_empty() {
        let result = generate_system_defaults_nix(&[]);
        assert!(result.contains("{ config, ... }:"));
        assert!(result.contains("# macOS system defaults"));
    }

    #[test]
    fn test_generate_system_defaults_nix_grouped() {
        let defaults = vec![
            SystemDefault {
                nix_key: "system.defaults.dock.autohide".into(),
                label: "Automatically hide the Dock".into(),
                category: "Dock".into(),
                current_value: "true".into(),
                default_value: "false".into(),
            },
            SystemDefault {
                nix_key: "system.defaults.dock.orientation".into(),
                label: "Dock position on screen".into(),
                category: "Dock".into(),
                current_value: "left".into(),
                default_value: "bottom".into(),
            },
            SystemDefault {
                nix_key: "system.defaults.NSGlobalDomain.AppleInterfaceStyle".into(),
                label: "Dark Mode".into(),
                category: "Global".into(),
                current_value: "Dark".into(),
                default_value: "".into(),
            },
        ];

        let result = generate_system_defaults_nix(&defaults);
        assert!(result.contains("system.defaults.NSGlobalDomain = {"));
        assert!(result.contains("system.defaults.dock = {"));
        assert!(result.contains("autohide = true;"));
        assert!(result.contains("orientation = \"left\";"));
        assert!(result.contains("AppleInterfaceStyle = \"Dark\";"));
    }

    #[test]
    fn test_inject_module_import() {
        let flake = r#"
      darwinConfigurations."test" = nix-darwin.lib.darwinSystem {
        modules = [
          configuration
          ./modules/darwin/fonts.nix
          ./modules/darwin/homebrew.nix
        ];
      };
"#;
        let result = inject_module_import(flake, "./modules/darwin/system-defaults.nix").unwrap();
        assert!(result.contains("./modules/darwin/system-defaults.nix"));
        assert!(result.contains("./modules/darwin/homebrew.nix"));
    }

    #[test]
    fn test_inject_module_flake_parts() {
        // Flake-parts template: modules = [ ... ] contains nested { } and [ ] blocks
        let darwin_nix = r#"
{ inputs, self, ... }:
{
  flake = {
    darwinConfigurations = {
      "Test" = inputs.darwin.lib.darwinSystem {
        modules = [
          inputs.determinate.darwinModules.default
          inputs.home-manager.darwinModules.home-manager
          {
            system.stateVersion = 6;
            determinate-nix.customSettings = {
              extra-experimental-features = [
                "build-time-fetch-tree"
                "parallel-eval"
              ];
            };
          }
        ];
      };
    };
  };
}
"#;
        let result =
            inject_module_import(darwin_nix, "../modules/darwin/system-defaults.nix").unwrap();
        assert!(
            result.contains("../modules/darwin/system-defaults.nix"),
            "Import not found in result:\n{}",
            result
        );
        // Verify the import is inside the modules list (before the closing ])
        let modules_start = result.find("modules = [").unwrap();
        let import_pos = result
            .find("../modules/darwin/system-defaults.nix")
            .unwrap();
        assert!(
            import_pos > modules_start,
            "Import should be after modules = ["
        );
    }

    #[test]
    fn test_inject_module_compact_syntax() {
        // `modules=[` with no spaces around `=`
        let flake = "darwinConfigurations.test = nix-darwin.lib.darwinSystem { modules=[\n  ./fonts.nix\n]; };";
        let result = inject_module_import(flake, "./system-defaults.nix").unwrap();
        assert!(result.contains("./system-defaults.nix"));
        assert!(result.contains("./fonts.nix"));
    }

    #[test]
    fn test_inject_module_newlines_around_equals() {
        // `modules \n= \n[` — newlines between the keyword, `=`, and `[`
        let flake = "darwinConfigurations.test = nix-darwin.lib.darwinSystem {\n  modules\n  =\n  [\n    ./fonts.nix\n  ];\n};";
        let result = inject_module_import(flake, "./system-defaults.nix").unwrap();
        assert!(result.contains("./system-defaults.nix"));
    }

    #[test]
    fn test_inject_module_variable_value_errors() {
        // `modules = someVariable` — cannot inject into a non-list value
        let flake =
            "darwinConfigurations.test = nix-darwin.lib.darwinSystem { modules = myModules; };";
        let err = inject_module_import(flake, "./system-defaults.nix").unwrap_err();
        assert!(
            err.contains("not a list literal"),
            "Expected 'not a list literal' error, got: {err}"
        );
    }

    #[test]
    fn test_inject_module_already_present() {
        let flake = r#"
        modules = [
          ./modules/darwin/system-defaults.nix
        ];
"#;
        let result = inject_module_import(flake, "./modules/darwin/system-defaults.nix").unwrap();
        // Should not duplicate
        assert_eq!(result.matches("system-defaults.nix").count(), 1);
    }

    #[test]
    fn test_key_defs_completeness() {
        // Verify we have entries for all expected domains
        let domains: Vec<&str> = KEY_DEFS.iter().map(|(d, _)| *d).collect();
        assert!(domains.contains(&"com.apple.dock"));
        assert!(domains.contains(&"com.apple.finder"));
        assert!(domains.contains(&"NSGlobalDomain"));
        assert!(domains.contains(&"com.apple.AppleMultitouchTrackpad"));
        assert!(domains.contains(&"com.apple.screencapture"));
        assert!(domains.contains(&"com.apple.loginwindow"));
        assert!(domains.contains(&"com.apple.screensaver"));
        assert!(domains.contains(&"com.apple.spaces"));
        assert!(domains.contains(&"com.apple.WindowManager"));
        assert!(domains.contains(&"com.apple.controlcenter"));
        assert!(domains.contains(&"com.apple.menuextra.clock"));
        assert!(domains.contains(&"com.apple.HIToolbox"));
        assert!(domains.contains(&"com.apple.universalaccess"));
        assert!(domains.contains(&"com.apple.LaunchServices"));
        assert!(domains.contains(&"com.apple.ActivityMonitor"));
        assert!(domains.contains(&"com.apple.SoftwareUpdate"));
        assert!(domains.contains(&"com.apple.driver.AppleBluetoothMultitouch.mouse"));
        assert!(domains.contains(&"com.apple.smb.server"));
    }

    #[test]
    fn test_total_key_count() {
        let total: usize = KEY_DEFS.iter().map(|(_, defs)| defs.len()).sum();
        // Verify we're scanning a meaningful number of keys
        assert!(total >= 130, "Expected at least 130 keys, got {}", total);
    }

    #[test]
    fn test_extract_xml_tag() {
        assert_eq!(
            extract_xml_tag("<key>foo</key>", "key"),
            Some("foo".to_string())
        );
        assert_eq!(
            extract_xml_tag("<integer>42</integer>", "integer"),
            Some("42".to_string())
        );
        assert_eq!(extract_xml_tag("<key></key>", "key"), None);
        assert_eq!(extract_xml_tag("not xml", "key"), None);
    }

    #[test]
    fn test_parse_plist_value() {
        assert_eq!(parse_plist_value("<true/>"), Some("true".to_string()));
        assert_eq!(parse_plist_value("<false/>"), Some("false".to_string()));
        assert_eq!(
            parse_plist_value("<integer>42</integer>"),
            Some("42".to_string())
        );
        assert_eq!(
            parse_plist_value("<real>3.14</real>"),
            Some("3.14".to_string())
        );
        assert_eq!(
            parse_plist_value("<string>hello</string>"),
            Some("hello".to_string())
        );
        assert_eq!(parse_plist_value("<dict>"), None);
        assert_eq!(parse_plist_value("<array>"), None);
    }

    // ── recommend_prompt tests ──────────────────────────────────────────

    /// Helper: build a mock domain reader from a list of (domain, key, value).
    fn mock_reader(
        data: Vec<(&'static str, &'static str, &'static str)>,
    ) -> impl Fn(&str) -> BTreeMap<String, String> {
        let mut map: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
        for (domain, key, value) in data {
            map.entry(domain.to_string())
                .or_default()
                .insert(key.to_string(), value.to_string());
        }
        move |domain: &str| map.get(domain).cloned().unwrap_or_default()
    }

    #[test]
    fn test_recommend_prompt_returns_first_unsatisfied() {
        // No defaults set → first prompt (finder_pathbar) should be returned
        let reader = mock_reader(vec![]);
        let result = recommend_prompt_with_reader(reader);
        assert!(result.is_some());
        assert_eq!(result.unwrap().id, "finder_pathbar");
    }

    #[test]
    fn test_recommend_prompt_skips_satisfied() {
        // Satisfy finder_pathbar → should return show_extensions
        let reader = mock_reader(vec![
            ("com.apple.finder", "ShowPathbar", "true"),
            ("com.apple.finder", "ShowStatusBar", "true"),
        ]);
        let result = recommend_prompt_with_reader(reader);
        assert!(result.is_some());
        assert_eq!(result.unwrap().id, "show_extensions");
    }

    #[test]
    fn test_recommend_prompt_partially_satisfied_still_recommended() {
        // Only one of finder_pathbar's targets is satisfied
        let reader = mock_reader(vec![("com.apple.finder", "ShowPathbar", "true")]);
        let result = recommend_prompt_with_reader(reader);
        assert!(result.is_some());
        assert_eq!(result.unwrap().id, "finder_pathbar");
    }

    #[test]
    fn test_recommend_prompt_all_satisfied_returns_none() {
        let reader = mock_reader(vec![
            // finder_pathbar
            ("com.apple.finder", "ShowPathbar", "true"),
            ("com.apple.finder", "ShowStatusBar", "true"),
            // show_extensions
            ("com.apple.finder", "AppleShowAllExtensions", "true"),
            ("NSGlobalDomain", "AppleShowAllExtensions", "true"),
            // dock_autohide
            ("com.apple.dock", "autohide", "true"),
            // tap_to_click
            ("com.apple.AppleMultitouchTrackpad", "Clicking", "true"),
            // folders_first
            ("com.apple.finder", "_FXSortFoldersFirst", "true"),
            // disable_autocorrect (desired is false)
            (
                "NSGlobalDomain",
                "NSAutomaticSpellingCorrectionEnabled",
                "false",
            ),
            (
                "NSGlobalDomain",
                "NSAutomaticCapitalizationEnabled",
                "false",
            ),
        ]);
        let result = recommend_prompt_with_reader(reader);
        assert!(result.is_none());
    }

    #[test]
    fn test_recommend_prompt_false_desired_unset_is_satisfied() {
        // disable_autocorrect wants false; key not set = macOS default (true)
        // → should be recommended when it's the only one left
        let reader = mock_reader(vec![
            ("com.apple.finder", "ShowPathbar", "true"),
            ("com.apple.finder", "ShowStatusBar", "true"),
            ("com.apple.finder", "AppleShowAllExtensions", "true"),
            ("NSGlobalDomain", "AppleShowAllExtensions", "true"),
            ("com.apple.dock", "autohide", "true"),
            ("com.apple.AppleMultitouchTrackpad", "Clicking", "true"),
            ("com.apple.finder", "_FXSortFoldersFirst", "true"),
            // autocorrect keys NOT set → they default to true (enabled),
            // but desired is false → needs change
        ]);
        let result = recommend_prompt_with_reader(reader);
        assert!(result.is_some());
        assert_eq!(result.unwrap().id, "disable_autocorrect");
    }

    // ── PROMPT_DEFS / KEY_DEFS alignment ────────────────────────────────

    #[test]
    fn test_prompt_defs_targets_exist_in_key_defs() {
        for def in PROMPT_DEFS {
            for target in def.targets {
                let found = KEY_DEFS.iter().any(|(domain, keys)| {
                    *domain == target.defaults_domain
                        && keys.iter().any(|k| k.defaults_key == target.defaults_key)
                });
                assert!(
                    found,
                    "PROMPT_DEFS target ({}, {}) in prompt '{}' not found in KEY_DEFS",
                    target.defaults_domain, target.defaults_key, def.id
                );
            }
        }
    }
}
