//! Standalone example for generating TypeScript bindings from schema row types.
//!
//! Run with: cargo run --example export_bindings
//! Output: apps/native/src/types/sqlite.ts
//!         apps/native/src/types/shared.ts
//!
//! Re-run whenever sqlite_types.rs or shared_types.rs changes.

#[path = "../src/sqlite_types.rs"]
mod sqlite_types;

#[path = "../src/shared_types.rs"]
mod shared_types;

use specta::TypeCollection;
use specta_typescript::Typescript;

fn main() {
    let mut collection = TypeCollection::default();
    let types = collection
        .register::<sqlite_types::Commit>()
        .register::<sqlite_types::Evolution>()
        .register::<sqlite_types::Prompt>()
        .register::<sqlite_types::Change>()
        .register::<sqlite_types::ChangeSummary>()
        .register::<sqlite_types::ChangeSet>();

    let output_path = "../src/types/sqlite.ts";

    Typescript::default()
        .bigint(specta_typescript::BigIntExportBehavior::Number)
        .export_to(output_path, types)
        .unwrap();

    println!("Exported sqlite types to {output_path}");

    let mut shared_collection = TypeCollection::default();
    let shared_types_reg = shared_collection
        .register::<shared_types::SummarizedChange>()
        .register::<shared_types::SummarizedChangeSet>()
        .register::<shared_types::ChangeWithSummary>()
        .register::<shared_types::SemanticChangeGroup>()
        .register::<shared_types::SemanticChangeMap>()
        .register::<shared_types::EvolveStep>()
        .register::<shared_types::EvolveState>()
        .register::<shared_types::HistoryItem>()
        .register::<shared_types::ChangeType>()
        .register::<shared_types::GitFileStatus>()
        .register::<shared_types::GitStatus>()
        .register::<shared_types::WatcherEvent>();

    let shared_output_path = "../src/types/shared.ts";

    Typescript::default()
        .bigint(specta_typescript::BigIntExportBehavior::Number)
        .export_to(shared_output_path, shared_types_reg)
        .unwrap();

    println!("Exported shared types to {shared_output_path}");
}
