//! Shared contract types exported to TypeScript via Specta.

#[path = "shared_types/account.rs"]
mod account;
#[path = "shared_types/core.rs"]
mod core;
#[path = "shared_types/events.rs"]
mod events;
#[path = "shared_types/evolve.rs"]
mod evolve;
#[path = "shared_types/feedback.rs"]
mod feedback;
#[path = "shared_types/git.rs"]
mod git;
#[path = "shared_types/github.rs"]
mod github;
#[path = "shared_types/managed_edits.rs"]
mod managed_edits;
#[path = "shared_types/onboarding.rs"]
mod onboarding;
#[path = "shared_types/prefs.rs"]
mod prefs;
#[path = "shared_types/settings_io.rs"]
mod settings_io;
#[path = "shared_types/system.rs"]
mod system;

pub use account::*;
pub use core::*;
pub use events::*;
pub use evolve::*;
pub use feedback::*;
pub use git::*;
pub use github::*;
pub use managed_edits::*;
pub use onboarding::*;
pub use prefs::*;
pub use settings_io::*;
pub use system::*;
