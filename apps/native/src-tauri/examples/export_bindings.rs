//! Standalone example for generating TypeScript bindings from schema row types.
//!
//! Run with: cargo run --example export_bindings
//! Output: apps/native/src/types/sqlite.ts
//!         apps/native/src/types/queries.ts
//!
//! Re-run whenever sqlite_types.rs or query_return_types.rs changes.

#[path = "../src/sqlite_types.rs"]
mod sqlite_types;

#[path = "../src/query_return_types.rs"]
mod query_return_types;

use specta::TypeCollection;
use specta_typescript::Typescript;

fn main() {
    let mut collection = TypeCollection::default();
    let types = collection
        .register::<sqlite_types::CommitRow>()
        .register::<sqlite_types::SquashedCommitRow>()
        .register::<sqlite_types::EvolutionRow>()
        .register::<sqlite_types::EvolutionCommitRow>()
        .register::<sqlite_types::SummaryRow>()
        .register::<sqlite_types::PromptRow>()
        .register::<sqlite_types::Change>()
        .register::<sqlite_types::ChangeSummary>()
        .register::<sqlite_types::ChangeSet>();

    let output_path = "../src/types/sqlite.ts";

    Typescript::default()
        .bigint(specta_typescript::BigIntExportBehavior::Number)
        .export_to(output_path, types)
        .unwrap();

    println!("Exported history types to {output_path}");

    let mut qrt_collection = TypeCollection::default();
    let qrt_types = qrt_collection
        .register::<query_return_types::SummarizedChange>()
        .register::<query_return_types::SummarizedChanges>()
        .register::<query_return_types::FoundChanges>();

    let qrt_output_path = "../src/types/queries.ts";

    Typescript::default()
        .bigint(specta_typescript::BigIntExportBehavior::Number)
        .export_to(qrt_output_path, qrt_types)
        .unwrap();

    println!("Exported query return types to {qrt_output_path}");
}
