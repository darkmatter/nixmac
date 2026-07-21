#![allow(unused_imports)]
//! Darwin-rebuild pipeline: build, activate, finalize, and rollback.

pub mod darwin;
pub mod finalize_apply;
pub mod finalize_restore;
pub mod rollback;

// Re-export the key public API so callers can use short paths.
#[allow(unused_imports)]
pub use darwin::{
    activate_store_path_stream, apply_stream, dry_run_build_check, dry_run_build_check_streaming,
    preflight_app_management, preflight_etc_clobber, read_latest_rebuild_log_tail,
};
#[allow(unused_imports)]
pub use finalize_apply::{finalize_apply, finalize_rollback};
#[allow(unused_imports)]
pub use finalize_restore::finalize_restore;
#[allow(unused_imports)]
pub use rollback::rollback_erase;
