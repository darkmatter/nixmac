//! Standalone example for generating TypeScript bindings from schema row types.
//!
//! Run with: cargo run --example specta_gen_ts
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
        .register::<sqlite_types::ChangeSet>()
        .register::<sqlite_types::NixmacBuild>()
        .register::<sqlite_types::DarwinBuild>()
        .register::<sqlite_types::BuildCommit>();

    let output_path = "../src/types/sqlite.ts";

    Typescript::default()
        .bigint(specta_typescript::BigIntExportBehavior::Number)
        .export_to(output_path, types)
        .unwrap();

    println!("Exported sqlite types to {output_path}");

    let mut shared_collection = TypeCollection::default();
    let shared_types_reg = shared_collection
        .register::<shared_types::Config>()
        .register::<shared_types::FeedbackShareOptions>()
        .register::<shared_types::FeedbackSystemInfo>()
        .register::<shared_types::FeedbackAiProviderModelInfo>()
        .register::<shared_types::FeedbackFlakeInputEntry>()
        .register::<shared_types::FeedbackFlakeInputsSnapshot>()
        .register::<shared_types::FeedbackMetadataRequest>()
        .register::<shared_types::FeedbackPanicDetails>()
        .register::<shared_types::EvolveEvent>()
        .register::<shared_types::EvolveEventType>()
        .register::<shared_types::HomebrewState>()
        .register::<shared_types::SummarizedChange>()
        .register::<shared_types::SummarizedChangeSet>()
        .register::<shared_types::ChangeWithSummary>()
        .register::<shared_types::SemanticChangeGroup>()
        .register::<shared_types::SemanticChangeMap>()
        .register::<shared_types::BuildRecord>()
        .register::<shared_types::EvolveStep>()
        .register::<shared_types::EvolveState>()
        .register::<shared_types::HistoryItem>()
        .register::<shared_types::ChangeType>()
        .register::<shared_types::GitFileStatus>()
        .register::<shared_types::GitStatus>()
        .register::<shared_types::WatcherEvent>()
        .register::<shared_types::EvolutionState>()
        .register::<shared_types::EvolutionTelemetry>()
        .register::<shared_types::EvolutionResult>()
        .register::<shared_types::EvolutionFailureResult>()
        .register::<shared_types::RollbackResult>()
        .register::<shared_types::SetDirResult>()
        .register::<shared_types::UiPrefs>()
        .register::<shared_types::UiPrefsUpdate>()
        .register::<shared_types::OkResult>()
        .register::<shared_types::NixCheckResult>()
        .register::<shared_types::BuildCheckResult>()
        .register::<shared_types::ConfigEditApplyResult>()
        .register::<shared_types::CliToolsState>()
        .register::<shared_types::DebugSentryResult>()
        .register::<shared_types::EvolveCancelResult>()
        .register::<shared_types::CommitResult>()
        .register::<shared_types::FinalizeApplyResult>()
        .register::<shared_types::NixInstallPhase>()
        .register::<shared_types::NixInstallErrorType>()
        .register::<shared_types::NixInstallProgressEvent>()
        .register::<shared_types::NixInstallEndEvent>()
        .register::<shared_types::NixDarwinRebuildEndEvent>()
        .register::<shared_types::RebuildErrorType>()
        .register::<shared_types::DarwinApplyDataEvent>()
        .register::<shared_types::DarwinApplySummaryEvent>()
        .register::<shared_types::DarwinApplyEndEvent>()
        .register::<shared_types::SummarizerUpdateEvent>()
        .register::<shared_types::RustPanicEvent>()
        .register::<shared_types::ConfigChangedEvent>()
        .register::<shared_types::PreviewIndicatorState>()
        .register::<shared_types::PermissionStatus>()
        .register::<shared_types::Permission>()
        .register::<shared_types::PermissionsState>()
        .register::<shared_types::SystemDefault>()
        .register::<shared_types::SystemDefaultsScan>()
        .register::<shared_types::RecommendedPrompt>()
        .register::<shared_types::FileEntry>();

    let shared_output_path = "../src/types/shared.ts";

    Typescript::default()
        .bigint(specta_typescript::BigIntExportBehavior::Number)
        .export_to(shared_output_path, shared_types_reg)
        .unwrap();

    println!("Exported shared types to {shared_output_path}");
}
