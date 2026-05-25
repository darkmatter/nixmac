//! Shared contract types exported to TypeScript via Specta.

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
#[path = "shared_types/prefs.rs"]
mod prefs;
#[path = "shared_types/settings_io.rs"]
mod settings_io;
#[path = "shared_types/system.rs"]
mod system;

pub use core::*;
pub use events::*;
pub use evolve::*;
pub use feedback::*;
pub use git::*;
pub use prefs::*;
pub use settings_io::*;
pub use system::*;
