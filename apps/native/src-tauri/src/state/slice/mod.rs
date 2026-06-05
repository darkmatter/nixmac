//! Runtime registry for `Configurable` state. The registry is scheduled for
//! deletion in the `inventory`-based redesign tracked as B1; for now it lives
//! here as the last vestige of the old `state/slice/` namespace.

pub mod registry;

pub use registry::{RegisteredSliceConfig, SliceRegistry};
