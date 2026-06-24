//! macOS system defaults scanner.
//!
//! Reads macOS user defaults domains, compares values against known factory
//! defaults, and produces a list of non-default settings that map to
//! nix-darwin `system.defaults.*` keys. Also generates valid `.nix` module
//! files from the detected customizations.

pub(crate) use crate::shared_types::{RecommendedPrompt, SystemDefault, SystemDefaultsScan};
use crate::system::nix;
use std::collections::BTreeMap;
use std::process::Command;

// =============================================================================
// Types
// =============================================================================
// Magic string that indicates the default value is null.
const NULL_FLAG: &str = "__NULL__";

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
    StringFromIntMap,
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
    /// Map of int values to nix-darwin-compatible string representations (only for ValType::StringFromIntMap)
    int_to_string_map: Option<&'static [(i32, &'static str)]>,
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
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "autohide-delay",
                nix_key: "system.defaults.dock.autohide-delay",
                label: "Dock auto-hide delay",
                category: "Dock",
                val_type: ValType::Float,
                factory_default: "0.24",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "autohide-time-modifier",
                nix_key: "system.defaults.dock.autohide-time-modifier",
                label: "Dock auto-hide animation speed",
                category: "Dock",
                val_type: ValType::Float,
                factory_default: "0.5",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "expose-group-apps",
                nix_key: "system.defaults.dock.expose-group-apps",
                label: "Group windows by application in Mission Control",
                category: "Dock",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "largesize",
                nix_key: "system.defaults.dock.largesize",
                label: "Dock magnification icon size",
                category: "Dock",
                val_type: ValType::Int,
                factory_default: "64",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "launchanim",
                nix_key: "system.defaults.dock.launchanim",
                label: "Animate opening applications",
                category: "Dock",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "magnification",
                nix_key: "system.defaults.dock.magnification",
                label: "Enable Dock magnification",
                category: "Dock",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "mineffect",
                nix_key: "system.defaults.dock.mineffect",
                label: "Minimize window effect",
                category: "Dock",
                val_type: ValType::String,
                factory_default: "genie",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "minimize-to-application",
                nix_key: "system.defaults.dock.minimize-to-application",
                label: "Minimize windows into application icon",
                category: "Dock",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "mru-spaces",
                nix_key: "system.defaults.dock.mru-spaces",
                label: "Automatically rearrange Spaces based on recent use",
                category: "Dock",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "orientation",
                nix_key: "system.defaults.dock.orientation",
                label: "Dock position on screen",
                category: "Dock",
                val_type: ValType::String,
                factory_default: "bottom",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "persistent-apps",
                nix_key: "system.defaults.dock.persistent-apps",
                label: "Persistent Dock apps (managed)",
                category: "Dock",
                val_type: ValType::String,
                factory_default: NULL_FLAG,
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "persistent-others",
                nix_key: "system.defaults.dock.persistent-others",
                label: "Persistent Dock folders (managed)",
                category: "Dock",
                val_type: ValType::String,
                factory_default: NULL_FLAG,
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "show-process-indicators",
                nix_key: "system.defaults.dock.show-process-indicators",
                label: "Show indicator lights for open apps",
                category: "Dock",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "show-recents",
                nix_key: "system.defaults.dock.show-recents",
                label: "Show recent applications in Dock",
                category: "Dock",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "showhidden",
                nix_key: "system.defaults.dock.showhidden",
                label: "Make hidden app icons translucent",
                category: "Dock",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "static-only",
                nix_key: "system.defaults.dock.static-only",
                label: "Show only open applications in Dock",
                category: "Dock",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "tilesize",
                nix_key: "system.defaults.dock.tilesize",
                label: "Dock icon size",
                category: "Dock",
                val_type: ValType::Int,
                factory_default: "48",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "wvous-bl-corner",
                nix_key: "system.defaults.dock.wvous-bl-corner",
                label: "Hot corner: bottom-left",
                category: "Dock",
                val_type: ValType::Int,
                factory_default: "1",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "wvous-br-corner",
                nix_key: "system.defaults.dock.wvous-br-corner",
                label: "Hot corner: bottom-right",
                category: "Dock",
                val_type: ValType::Int,
                factory_default: "1",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "wvous-tl-corner",
                nix_key: "system.defaults.dock.wvous-tl-corner",
                label: "Hot corner: top-left",
                category: "Dock",
                val_type: ValType::Int,
                factory_default: "1",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "wvous-tr-corner",
                nix_key: "system.defaults.dock.wvous-tr-corner",
                label: "Hot corner: top-right",
                category: "Dock",
                val_type: ValType::Int,
                factory_default: "1",
                int_to_string_map: None,
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
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "AppleShowAllFiles",
                nix_key: "system.defaults.finder.AppleShowAllFiles",
                label: "Show hidden files",
                category: "Finder",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "CreateDesktop",
                nix_key: "system.defaults.finder.CreateDesktop",
                label: "Show icons on the desktop",
                category: "Finder",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "FXDefaultSearchScope",
                nix_key: "system.defaults.finder.FXDefaultSearchScope",
                label: "Default search scope",
                category: "Finder",
                val_type: ValType::String,
                factory_default: "SCev",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "FXEnableExtensionChangeWarning",
                nix_key: "system.defaults.finder.FXEnableExtensionChangeWarning",
                label: "Warn before changing file extensions",
                category: "Finder",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "FXPreferredViewStyle",
                nix_key: "system.defaults.finder.FXPreferredViewStyle",
                label: "Preferred view style",
                category: "Finder",
                val_type: ValType::String,
                factory_default: "icnv",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "QuitMenuItem",
                nix_key: "system.defaults.finder.QuitMenuItem",
                label: "Allow quitting Finder via ⌘Q",
                category: "Finder",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "ShowPathbar",
                nix_key: "system.defaults.finder.ShowPathbar",
                label: "Show path bar at bottom of Finder",
                category: "Finder",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "ShowStatusBar",
                nix_key: "system.defaults.finder.ShowStatusBar",
                label: "Show status bar at bottom of Finder",
                category: "Finder",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "_FXShowPosixPathInTitle",
                nix_key: "system.defaults.finder._FXShowPosixPathInTitle",
                label: "Show full POSIX path in Finder title bar",
                category: "Finder",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "_FXSortFoldersFirst",
                nix_key: "system.defaults.finder._FXSortFoldersFirst",
                label: "Keep folders on top when sorting by name",
                category: "Finder",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
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
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "AppleEnableSwipeNavigateWithScrolls",
                nix_key: "system.defaults.NSGlobalDomain.AppleEnableSwipeNavigateWithScrolls",
                label: "Enable trackpad swipe navigation",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "AppleICUForce24HourTime",
                nix_key: "system.defaults.NSGlobalDomain.AppleICUForce24HourTime",
                label: "Use 24-hour time",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "AppleInterfaceStyle",
                nix_key: "system.defaults.NSGlobalDomain.AppleInterfaceStyle",
                label: "Dark Mode",
                category: "Global",
                val_type: ValType::String,
                factory_default: NULL_FLAG,
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "AppleInterfaceStyleSwitchesAutomatically",
                nix_key: "system.defaults.NSGlobalDomain.AppleInterfaceStyleSwitchesAutomatically",
                label: "Automatically switch between Light and Dark Mode",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "AppleMeasurementUnits",
                nix_key: "system.defaults.NSGlobalDomain.AppleMeasurementUnits",
                label: "Measurement units",
                category: "Global",
                val_type: ValType::String,
                factory_default: "Centimeters",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "AppleMetricUnits",
                nix_key: "system.defaults.NSGlobalDomain.AppleMetricUnits",
                label: "Use metric units",
                category: "Global",
                val_type: ValType::Int,
                factory_default: "1",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "ApplePressAndHoldEnabled",
                nix_key: "system.defaults.NSGlobalDomain.ApplePressAndHoldEnabled",
                label: "Press-and-hold for accented characters (vs key repeat)",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "AppleScrollerPagingBehavior",
                nix_key: "system.defaults.NSGlobalDomain.AppleScrollerPagingBehavior",
                label: "Click in scroll bar to jump to spot",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "AppleShowAllExtensions",
                nix_key: "system.defaults.NSGlobalDomain.AppleShowAllExtensions",
                label: "Show all filename extensions (global)",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "AppleShowScrollBars",
                nix_key: "system.defaults.NSGlobalDomain.AppleShowScrollBars",
                label: "Show scroll bars",
                category: "Global",
                val_type: ValType::String,
                factory_default: "Automatic",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "AppleTemperatureUnit",
                nix_key: "system.defaults.NSGlobalDomain.AppleTemperatureUnit",
                label: "Temperature unit",
                category: "Global",
                val_type: ValType::String,
                factory_default: "Celsius",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "AppleWindowTabbingMode",
                nix_key: "system.defaults.NSGlobalDomain.AppleWindowTabbingMode",
                label: "Prefer tabs when opening documents",
                category: "Global",
                val_type: ValType::String,
                factory_default: "always",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "InitialKeyRepeat",
                nix_key: "system.defaults.NSGlobalDomain.InitialKeyRepeat",
                label: "Delay until key repeat starts",
                category: "Global",
                val_type: ValType::Int,
                factory_default: "25",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "KeyRepeat",
                nix_key: "system.defaults.NSGlobalDomain.KeyRepeat",
                label: "Key repeat rate",
                category: "Global",
                val_type: ValType::Int,
                factory_default: "6",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "NSAutomaticCapitalizationEnabled",
                nix_key: "system.defaults.NSGlobalDomain.NSAutomaticCapitalizationEnabled",
                label: "Auto-capitalize words",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "NSAutomaticDashSubstitutionEnabled",
                nix_key: "system.defaults.NSGlobalDomain.NSAutomaticDashSubstitutionEnabled",
                label: "Auto-convert dashes",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "NSAutomaticInlinePredictionEnabled",
                nix_key: "system.defaults.NSGlobalDomain.NSAutomaticInlinePredictionEnabled",
                label: "Inline text prediction",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "NSAutomaticPeriodSubstitutionEnabled",
                nix_key: "system.defaults.NSGlobalDomain.NSAutomaticPeriodSubstitutionEnabled",
                label: "Auto-insert period with double-space",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "NSAutomaticQuoteSubstitutionEnabled",
                nix_key: "system.defaults.NSGlobalDomain.NSAutomaticQuoteSubstitutionEnabled",
                label: "Smart quotes",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "NSAutomaticSpellingCorrectionEnabled",
                nix_key: "system.defaults.NSGlobalDomain.NSAutomaticSpellingCorrectionEnabled",
                label: "Auto-correct spelling",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "NSAutomaticWindowAnimationsEnabled",
                nix_key: "system.defaults.NSGlobalDomain.NSAutomaticWindowAnimationsEnabled",
                label: "Window opening/closing animations",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "NSDisableAutomaticTermination",
                nix_key: "system.defaults.NSGlobalDomain.NSDisableAutomaticTermination",
                label: "Disable automatic termination of inactive apps",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "NSDocumentSaveNewDocumentsToCloud",
                nix_key: "system.defaults.NSGlobalDomain.NSDocumentSaveNewDocumentsToCloud",
                label: "Save new documents to iCloud by default",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "NSNavPanelExpandedStateForSaveMode",
                nix_key: "system.defaults.NSGlobalDomain.NSNavPanelExpandedStateForSaveMode",
                label: "Expand save panel by default",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "NSNavPanelExpandedStateForSaveMode2",
                nix_key: "system.defaults.NSGlobalDomain.NSNavPanelExpandedStateForSaveMode2",
                label: "Expand save panel by default (secondary)",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "NSScrollAnimationEnabled",
                nix_key: "system.defaults.NSGlobalDomain.NSScrollAnimationEnabled",
                label: "Smooth scrolling",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "NSTableViewDefaultSizeMode",
                nix_key: "system.defaults.NSGlobalDomain.NSTableViewDefaultSizeMode",
                label: "Sidebar icon size (1=small, 2=medium, 3=large)",
                category: "Global",
                val_type: ValType::Int,
                factory_default: "2",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "NSTextShowsControlCharacters",
                nix_key: "system.defaults.NSGlobalDomain.NSTextShowsControlCharacters",
                label: "Show control characters in text fields",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "NSWindowResizeTime",
                nix_key: "system.defaults.NSGlobalDomain.NSWindowResizeTime",
                label: "Window resize animation speed",
                category: "Global",
                val_type: ValType::Float,
                factory_default: "0.2",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "NSWindowShouldDragOnGesture",
                nix_key: "system.defaults.NSGlobalDomain.NSWindowShouldDragOnGesture",
                label: "Drag windows with ⌃⌘ click anywhere",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "PMPrintingExpandedStateForPrint",
                nix_key: "system.defaults.NSGlobalDomain.PMPrintingExpandedStateForPrint",
                label: "Expand print panel by default",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "PMPrintingExpandedStateForPrint2",
                nix_key: "system.defaults.NSGlobalDomain.PMPrintingExpandedStateForPrint2",
                label: "Expand print panel by default (secondary)",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "com.apple.mouse.tapBehavior",
                nix_key: "system.defaults.NSGlobalDomain.\"com.apple.mouse.tapBehavior\"",
                label: "Tap to click",
                category: "Global",
                val_type: ValType::Int,
                factory_default: NULL_FLAG,
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "com.apple.sound.beep.feedback",
                nix_key: "system.defaults.NSGlobalDomain.\"com.apple.sound.beep.feedback\"",
                label: "Play feedback when volume is changed",
                category: "Global",
                val_type: ValType::Int,
                factory_default: "1",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "com.apple.sound.beep.volume",
                nix_key: "system.defaults.NSGlobalDomain.\"com.apple.sound.beep.volume\"",
                label: "Alert sound volume",
                category: "Global",
                val_type: ValType::Float,
                factory_default: "0.5",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "com.apple.springing.delay",
                nix_key: "system.defaults.NSGlobalDomain.\"com.apple.springing.delay\"",
                label: "Spring-loaded folders delay",
                category: "Global",
                val_type: ValType::Float,
                factory_default: "0.5",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "com.apple.springing.enabled",
                nix_key: "system.defaults.NSGlobalDomain.\"com.apple.springing.enabled\"",
                label: "Enable spring-loaded folders",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "com.apple.swipescrolldirection",
                nix_key: "system.defaults.NSGlobalDomain.\"com.apple.swipescrolldirection\"",
                label: "Natural scrolling direction",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "com.apple.trackpad.enableSecondaryClick",
                nix_key: "system.defaults.NSGlobalDomain.\"com.apple.trackpad.enableSecondaryClick\"",
                label: "Enable secondary click on trackpad",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "com.apple.trackpad.forceClick",
                nix_key: "system.defaults.NSGlobalDomain.\"com.apple.trackpad.forceClick\"",
                label: "Force Click and haptic feedback",
                category: "Global",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "com.apple.trackpad.scaling",
                nix_key: "system.defaults.NSGlobalDomain.\"com.apple.trackpad.scaling\"",
                label: "Trackpad tracking speed",
                category: "Global",
                val_type: ValType::Float,
                factory_default: "1.0",
                int_to_string_map: None,
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
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "Clicking",
                nix_key: "system.defaults.trackpad.Clicking",
                label: "Tap to click on trackpad",
                category: "Trackpad",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "DragLock",
                nix_key: "system.defaults.trackpad.DragLock",
                label: "Drag lock",
                category: "Trackpad",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "Dragging",
                nix_key: "system.defaults.trackpad.Dragging",
                label: "Three-finger drag",
                category: "Trackpad",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "FirstClickThreshold",
                nix_key: "system.defaults.trackpad.FirstClickThreshold",
                label: "Click pressure threshold (0=light, 1=medium, 2=firm)",
                category: "Trackpad",
                val_type: ValType::Int,
                factory_default: "1",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "SecondClickThreshold",
                nix_key: "system.defaults.trackpad.SecondClickThreshold",
                label: "Force click pressure threshold",
                category: "Trackpad",
                val_type: ValType::Int,
                factory_default: "1",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "TrackpadRightClick",
                nix_key: "system.defaults.trackpad.TrackpadRightClick",
                label: "Two-finger right click",
                category: "Trackpad",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "TrackpadThreeFingerDrag",
                nix_key: "system.defaults.trackpad.TrackpadThreeFingerDrag",
                label: "Three-finger drag gesture",
                category: "Trackpad",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "TrackpadThreeFingerTapGesture",
                nix_key: "system.defaults.trackpad.TrackpadThreeFingerTapGesture",
                label: "Three-finger tap gesture",
                category: "Trackpad",
                val_type: ValType::Int,
                factory_default: "0",
                int_to_string_map: None,
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
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "location",
                nix_key: "system.defaults.screencapture.location",
                label: "Screenshot save location",
                category: "Screenshot",
                val_type: ValType::String,
                factory_default: "~/Desktop",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "show-thumbnail",
                nix_key: "system.defaults.screencapture.show-thumbnail",
                label: "Show thumbnail after taking screenshot",
                category: "Screenshot",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "type",
                nix_key: "system.defaults.screencapture.type",
                label: "Screenshot file format",
                category: "Screenshot",
                val_type: ValType::String,
                factory_default: "png",
                int_to_string_map: None,
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
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "GuestEnabled",
                nix_key: "system.defaults.loginwindow.GuestEnabled",
                label: "Allow guest user login",
                category: "Login Window",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "LoginwindowText",
                nix_key: "system.defaults.loginwindow.LoginwindowText",
                label: "Login window message text",
                category: "Login Window",
                val_type: ValType::String,
                factory_default: "",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "PowerOffDisabledWhileLoggedIn",
                nix_key: "system.defaults.loginwindow.PowerOffDisabledWhileLoggedIn",
                label: "Disable power off while logged in",
                category: "Login Window",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "RestartDisabled",
                nix_key: "system.defaults.loginwindow.RestartDisabled",
                label: "Disable restart button at login",
                category: "Login Window",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "RestartDisabledWhileLoggedIn",
                nix_key: "system.defaults.loginwindow.RestartDisabledWhileLoggedIn",
                label: "Disable restart while logged in",
                category: "Login Window",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "SHOWFULLNAME",
                nix_key: "system.defaults.loginwindow.SHOWFULLNAME",
                label: "Show full name at login window",
                category: "Login Window",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "ShutDownDisabled",
                nix_key: "system.defaults.loginwindow.ShutDownDisabled",
                label: "Disable shut down button at login",
                category: "Login Window",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "ShutDownDisabledWhileLoggedIn",
                nix_key: "system.defaults.loginwindow.ShutDownDisabledWhileLoggedIn",
                label: "Disable shut down while logged in",
                category: "Login Window",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "SleepDisabled",
                nix_key: "system.defaults.loginwindow.SleepDisabled",
                label: "Disable sleep button at login",
                category: "Login Window",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
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
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "askForPasswordDelay",
                nix_key: "system.defaults.screensaver.askForPasswordDelay",
                label: "Seconds before password required after screensaver",
                category: "Screensaver",
                val_type: ValType::Int,
                factory_default: "5",
                int_to_string_map: None,
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
            int_to_string_map: None,
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
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "AutoHide",
                nix_key: "system.defaults.WindowManager.AutoHide",
                label: "Auto-hide Stage Manager strip",
                category: "Window Manager",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "EnableStandardClickToShowDesktop",
                nix_key: "system.defaults.WindowManager.EnableStandardClickToShowDesktop",
                label: "Click wallpaper to reveal desktop",
                category: "Window Manager",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "EnableTiledWindowMargins",
                nix_key: "system.defaults.WindowManager.EnableTiledWindowMargins",
                label: "Show margins around tiled windows",
                category: "Window Manager",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "GloballyEnabled",
                nix_key: "system.defaults.WindowManager.GloballyEnabled",
                label: "Enable Stage Manager",
                category: "Window Manager",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "HideDesktop",
                nix_key: "system.defaults.WindowManager.HideDesktop",
                label: "Hide desktop items in Stage Manager",
                category: "Window Manager",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "StageManagerHideWidgets",
                nix_key: "system.defaults.WindowManager.StageManagerHideWidgets",
                label: "Hide widgets in Stage Manager",
                category: "Window Manager",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "StandardHideDesktopIcons",
                nix_key: "system.defaults.WindowManager.StandardHideDesktopIcons",
                label: "Hide desktop icons (non-Stage Manager)",
                category: "Window Manager",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "StandardHideWidgets",
                nix_key: "system.defaults.WindowManager.StandardHideWidgets",
                label: "Hide widgets (non-Stage Manager)",
                category: "Window Manager",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
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
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "Bluetooth",
                nix_key: "system.defaults.controlcenter.Bluetooth",
                label: "Show Bluetooth in menu bar",
                category: "Control Center",
                val_type: ValType::Bool,
                factory_default: NULL_FLAG,
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "Display",
                nix_key: "system.defaults.controlcenter.Display",
                label: "Show Display in menu bar",
                category: "Control Center",
                val_type: ValType::Bool,
                factory_default: NULL_FLAG,
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "FocusModes",
                nix_key: "system.defaults.controlcenter.FocusModes",
                label: "Show Focus in menu bar",
                category: "Control Center",
                val_type: ValType::Bool,
                factory_default: NULL_FLAG,
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "NowPlaying",
                nix_key: "system.defaults.controlcenter.NowPlaying",
                label: "Show Now Playing in menu bar",
                category: "Control Center",
                val_type: ValType::Bool,
                factory_default: NULL_FLAG,
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "Sound",
                nix_key: "system.defaults.controlcenter.Sound",
                label: "Show Sound in menu bar",
                category: "Control Center",
                val_type: ValType::Bool,
                factory_default: NULL_FLAG,
                int_to_string_map: None,
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
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "IsAnalog",
                nix_key: "system.defaults.menuExtraClock.IsAnalog",
                label: "Use analog clock",
                category: "Menu Bar Clock",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "Show24Hour",
                nix_key: "system.defaults.menuExtraClock.Show24Hour",
                label: "Show 24-hour time in menu bar",
                category: "Menu Bar Clock",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "ShowDate",
                nix_key: "system.defaults.menuExtraClock.ShowDate",
                label: "Show date in menu bar (0=when space, 1=always, 2=never)",
                category: "Menu Bar Clock",
                val_type: ValType::Int,
                factory_default: "0",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "ShowDayOfWeek",
                nix_key: "system.defaults.menuExtraClock.ShowDayOfWeek",
                label: "Show day of week in menu bar",
                category: "Menu Bar Clock",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "ShowSeconds",
                nix_key: "system.defaults.menuExtraClock.ShowSeconds",
                label: "Show seconds in menu bar clock",
                category: "Menu Bar Clock",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
        ],
    ),
    // ── HIToolbox ──────────────────────────────────────────────────────────
    (
        "com.apple.HIToolbox",
        &[KeyDef {
            defaults_key: "AppleFnUsageType",
            nix_key: "system.defaults.hitoolbox.AppleFnUsageType",
            label: "Fn key action (0='Do Nothing', 1='Change Input Source', 2='Show Emoji & Symbols', 3='Start Dictation')",
            category: "Keyboard",
            val_type: ValType::StringFromIntMap,
            factory_default: "2",
            int_to_string_map: Some(&[
                (0, "Do Nothing"),
                (1, "Change Input Source"),
                (2, "Show Emoji & Symbols"),
                (3, "Start Dictation"),
            ]),
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
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "closeViewZoomFollowsFocus",
                nix_key: "system.defaults.universalaccess.closeViewZoomFollowsFocus",
                label: "Zoom follows keyboard focus",
                category: "Accessibility",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "mouseDriverCursorSize",
                nix_key: "system.defaults.universalaccess.mouseDriverCursorSize",
                label: "Cursor size",
                category: "Accessibility",
                val_type: ValType::Float,
                factory_default: "1.0",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "reduceMotion",
                nix_key: "system.defaults.universalaccess.reduceMotion",
                label: "Reduce motion",
                category: "Accessibility",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "reduceTransparency",
                nix_key: "system.defaults.universalaccess.reduceTransparency",
                label: "Reduce transparency",
                category: "Accessibility",
                val_type: ValType::Bool,
                factory_default: "false",
                int_to_string_map: None,
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
            int_to_string_map: None,
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
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "OpenMainWindow",
                nix_key: "system.defaults.ActivityMonitor.OpenMainWindow",
                label: "Open Activity Monitor main window on launch",
                category: "Activity Monitor",
                val_type: ValType::Bool,
                factory_default: "true",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "ShowCategory",
                nix_key: "system.defaults.ActivityMonitor.ShowCategory",
                label: "Default filter category",
                category: "Activity Monitor",
                val_type: ValType::Int,
                factory_default: "100",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "SortColumn",
                nix_key: "system.defaults.ActivityMonitor.SortColumn",
                label: "Sort column",
                category: "Activity Monitor",
                val_type: ValType::String,
                factory_default: "CPUUsage",
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "SortDirection",
                nix_key: "system.defaults.ActivityMonitor.SortDirection",
                label: "Sort direction (0=ascending, 1=descending)",
                category: "Activity Monitor",
                val_type: ValType::Int,
                factory_default: "0",
                int_to_string_map: None,
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
            int_to_string_map: None,
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
            int_to_string_map: None,
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
                int_to_string_map: None,
            },
            KeyDef {
                defaults_key: "ServerDescription",
                nix_key: "system.defaults.smb.ServerDescription",
                label: "SMB server description",
                category: "Sharing",
                val_type: ValType::String,
                factory_default: "",
                int_to_string_map: None,
            },
        ],
    ),
];

fn e2e_mock_system_enabled() -> bool {
    cfg!(debug_assertions) && crate::e2e_runtime::enabled("NIXMAC_E2E_MOCK_SYSTEM")
}

fn e2e_default_system_defaults_fixture() -> SystemDefaultsScan {
    SystemDefaultsScan {
        defaults: vec![SystemDefault {
            nix_key: "system.defaults.finder.ShowPathbar".to_string(),
            label: "Show Finder path bar".to_string(),
            category: "Finder".to_string(),
            current_value: "true".to_string(),
            default_value: "false".to_string(),
        }],
        total_scanned: KEY_DEFS.iter().map(|(_, defs)| defs.len()).sum(),
    }
}

fn e2e_system_defaults_scan() -> Option<SystemDefaultsScan> {
    if !e2e_mock_system_enabled() {
        return None;
    }

    if crate::e2e_runtime::enabled("NIXMAC_E2E_SYSTEM_DEFAULTS_FIXTURE") {
        log::info!("Using deterministic NIXMAC_E2E_SYSTEM_DEFAULTS_FIXTURE scan");
        return Some(e2e_default_system_defaults_fixture());
    }

    let raw = crate::e2e_runtime::value("NIXMAC_E2E_SYSTEM_DEFAULTS_JSON")?;
    log::info!(
        "Using NIXMAC_E2E_SYSTEM_DEFAULTS_JSON fixture, len={}, prefix={:?}",
        raw.len(),
        raw.chars().take(400).collect::<String>()
    );
    let defaults: Vec<SystemDefault> = match serde_json::from_str(&raw) {
        Ok(defaults) => defaults,
        Err(error) => {
            log::error!(
                "NIXMAC_E2E_SYSTEM_DEFAULTS_JSON was set but could not be parsed: {}",
                error
            );
            Vec::new()
        }
    };

    Some(SystemDefaultsScan {
        defaults,
        total_scanned: KEY_DEFS.iter().map(|(_, defs)| defs.len()).sum(),
    })
}

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

    // Read the results.
    let parser = plist::from_bytes(&output.stdout);
    if let Ok(plist::Value::Dictionary(dict)) = parser {
        for (key, value) in dict {
            if let Some(val_str) = parse_plist_value(value) {
                result.insert(key, val_str);
            }
        }
    }

    result
}

/// Parse a plist value element into a string representation.
fn parse_plist_value(value: plist::Value) -> Option<String> {
    match value {
        plist::Value::Boolean(true) => Some("true".to_string()),
        plist::Value::Boolean(false) => Some("false".to_string()),
        plist::Value::Integer(i) => Some(i.to_string()),
        plist::Value::Real(f) => Some(f.to_string()),
        plist::Value::String(s) => Some(s),
        _ => None,
    }
}

// =============================================================================
// Comparison logic
// =============================================================================

/// Compare a current value string against a factory default, taking value type
/// into account. Returns `true` if they are semantically different.
fn values_differ(current: &str, factory: &str, val_type: ValType) -> bool {
    // macOS commonly omits keys whose factory value is null. In our scanner an
    // empty string can represent that missing value. If the factory is NULL_FLAG,
    // any present value should be treated as drift.
    if factory == NULL_FLAG {
        return !current.trim().is_empty();
    }

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
        ValType::StringFromIntMap => {
            let cur: i64 = current.trim().parse().unwrap_or(0);
            let fac: i64 = factory.trim().parse().unwrap_or(0);
            cur != fac
        }
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
/// from the factory defaults AND are not managed by nix-darwin.
/// If you want to make sure none of the KeyDefs are stale by running their
/// results through a nix build you can play with the value of GENERATE_EVERYTHING.
pub fn scan_system_defaults(hostname: &str, config_dir: &str) -> SystemDefaultsScan {
    if let Some(scan) = e2e_system_defaults_scan() {
        return scan;
    }

    const GENERATE_EVERYTHING: bool = false; // for testing: treat all keys as non-default

    let mut defaults = Vec::new();
    let mut total_scanned: usize = 0;

    for (domain, key_defs) in KEY_DEFS {
        let domain_values = read_domain(domain);

        // Gets the nix "system.defaults" group from one of our domain definitions.
        // This is the first dotted-path-part of the nix_key following "system.defaults".
        // For example, for the domain "com.apple.finder" the nix key is "system.defaults.finder.*",
        // so the nix group is "finder".
        let nix_group_name = key_defs
            .first()
            .and_then(|def| def.nix_key.split('.').nth(2))
            .unwrap_or(domain);

        // Get the current values managed by nix.
        let current_nix_managed_values =
            nix::get_nix_system_defaults_for_domain(hostname, config_dir, nix_group_name);

        for def in *key_defs {
            // Check if this key is currently managed by nix. If it is, we skip it because we don't want to report it as a non-default.
            // Currently we won't compare the value against the factory default because if it's managed by nix it might be intentionally set to a default
            // or non-default value.
            if let Ok(ref nix_values) = current_nix_managed_values {
                if nix_values.contains_key(def.defaults_key) {
                    continue;
                }
            }

            total_scanned += 1;

            let current = match domain_values.get(def.defaults_key) {
                Some(v) => v.as_str(),
                None => {
                    if !GENERATE_EVERYTHING {
                        continue;
                    } else if def.factory_default == NULL_FLAG {
                        ""
                    } else {
                        def.factory_default
                    }
                } // key not set → using factory default
            };

            if GENERATE_EVERYTHING || values_differ(current, def.factory_default, def.val_type) {
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

pub(crate) fn system_default_current_value_to_json(
    value: &str,
    group: &str,
    attr: &str,
) -> serde_json::Value {
    let key_def = find_key_def(group, attr);
    if key_def.is_some_and(|def| def.factory_default == NULL_FLAG)
        && is_nullish_factory_value(value)
    {
        return serde_json::Value::Null;
    }

    match key_def.map(|def| def.val_type) {
        Some(ValType::Bool) => serde_json::Value::Bool(normalize_bool(value) == "true"),
        Some(ValType::Int) => value
            .trim()
            .parse::<i64>()
            .map(serde_json::Value::from)
            .unwrap_or_else(|_| serde_json::Value::String(value.to_string())),
        Some(ValType::Float) => value
            .trim()
            .parse::<f64>()
            .ok()
            .and_then(serde_json::Number::from_f64)
            .map(serde_json::Value::Number)
            .unwrap_or_else(|| serde_json::Value::String(value.to_string())),
        Some(ValType::StringFromIntMap) => {
            if let Ok(n) = value.trim().parse::<i32>() {
                if let Some(map) = key_def.and_then(|def| def.int_to_string_map) {
                    if let Some((_, mapped)) = map.iter().find(|(k, _)| *k == n) {
                        return serde_json::Value::String((*mapped).to_string());
                    }
                }
            }
            serde_json::Value::String(value.to_string())
        }
        Some(ValType::String) | None => serde_json::Value::String(value.to_string()),
    }
}

fn is_nullish_factory_value(value: &str) -> bool {
    value.trim().is_empty()
}

/// Find the KeyDef for a given group + attr combination.
fn find_key_def(group: &str, attr: &str) -> Option<&'static KeyDef> {
    for (_, key_defs) in KEY_DEFS {
        for def in *key_defs {
            if let Some(last_dot) = rfind_unquoted_dot(def.nix_key) {
                let def_group = &def.nix_key[..last_dot];
                let def_attr = &def.nix_key[last_dot + 1..];
                if def_group == group && def_attr == attr {
                    return Some(def);
                }
            }
        }
    }
    None
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

    // Create a test that runs the scanner on the current system and prints the results.
    // Leave it off by default.
    #[test]
    #[ignore = "Runs against the local system; enable explicitly when debugging the defaults scanner."]
    #[cfg(target_os = "macos")]
    fn test_scan_system_defaults() {
        use crate::bootstrap::default_config::detect_hostname;

        let this_host_name = detect_hostname().expect("failed to get hostname");
        const CONFIG_DIR: &str = "~/.darwin";

        let scan = scan_system_defaults(&this_host_name, CONFIG_DIR);
        println!(
            "Scanned {} settings, found {} unmanaged non-defaults:",
            scan.total_scanned,
            scan.defaults.len()
        );
        for d in scan.defaults {
            println!(
                "- {} ({}): current='{}', default='{}'",
                d.label, d.nix_key, d.current_value, d.default_value
            );
        }
    }

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
    fn test_e2e_system_defaults_fixture_returns_customization() {
        let _env_lock = crate::test_support::e2e_env_lock();
        let _env_restore = crate::test_support::EnvVarRestore::capture(&[
            "NIXMAC_E2E_MOCK_SYSTEM",
            "NIXMAC_E2E_SYSTEM_DEFAULTS_FIXTURE",
            "NIXMAC_E2E_SYSTEM_DEFAULTS_JSON",
        ]);

        std::env::set_var("NIXMAC_E2E_MOCK_SYSTEM", "1");
        std::env::set_var("NIXMAC_E2E_SYSTEM_DEFAULTS_FIXTURE", "1");
        std::env::remove_var("NIXMAC_E2E_SYSTEM_DEFAULTS_JSON");

        let scan = e2e_system_defaults_scan().expect("fixture scan");
        assert_eq!(scan.defaults.len(), 1);
        assert_eq!(
            scan.defaults[0].nix_key,
            "system.defaults.finder.ShowPathbar"
        );
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
    fn test_values_differ_string_from_int_map() {
        assert!(!values_differ("2", "2", ValType::StringFromIntMap));
        assert!(values_differ("1", "2", ValType::StringFromIntMap));
    }

    #[test]
    fn test_values_differ_null_flag_empty_current() {
        assert!(!values_differ("", NULL_FLAG, ValType::String));
        assert!(!values_differ("   ", NULL_FLAG, ValType::String));
        assert!(values_differ("custom", NULL_FLAG, ValType::String));
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
    fn test_parse_plist_value() {
        assert_eq!(
            parse_plist_value(plist::Value::Boolean(true)),
            Some("true".to_string())
        );
        assert_eq!(
            parse_plist_value(plist::Value::Integer(42.into())),
            Some("42".to_string())
        );
        assert_eq!(
            parse_plist_value(plist::Value::Real(3.14)),
            Some("3.14".to_string())
        );
        assert_eq!(
            parse_plist_value(plist::Value::String("hello".to_string())),
            Some("hello".to_string())
        );
        assert_eq!(parse_plist_value(plist::Value::Array(vec![])), None);
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
