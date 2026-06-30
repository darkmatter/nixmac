//! Darwin apply / evolve / rollback procedures — parallel to `commands::{evolve,apply,rollback}`.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::{apply, evolve, rollback};
use crate::privileged_helper::{
    protocol::{HelperServiceStatus, SyncAgentLaunchConfig},
    service,
    sync_agent::{self, SyncAgentStatus},
};
use crate::shared_types::{
    BuildCheckResult, EtcClobberCheckResult, EvolveCancelResult, OkResult, RebuildStatus,
    RollbackResult,
};
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct EvolveInput {
    description: String,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct EvolveAnswerInput {
    answer: String,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct ApplyStreamStartInput {
    host_override: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct ActivateStorePathInput {
    store_path: String,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct FinalizeRollbackInput {
    store_path: Option<String>,
    #[specta(type = Option<f64>)]
    changeset_id: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct RestoreTargetInput {
    target_hash: String,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct InstallSyncAgentInput {
    config: Option<SyncAgentLaunchConfig>,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct AdoptManualChangesResult {
    #[specta(type = f64)]
    evolution_id: i64,
}

async fn evolve_handler(ctx: OrpcCtx, input: EvolveInput) -> Result<(), ORPCError> {
    evolve::run_evolve(ctx.app, input.description)
        .await
        .map_err(|error| internal_err("darwin.evolve", error))
}

async fn evolve_cancel(_ctx: OrpcCtx, _input: ()) -> Result<EvolveCancelResult, ORPCError> {
    evolve::cancel_evolve()
        .await
        .map_err(|error| internal_err("darwin.evolveCancel", error))
}

async fn evolve_answer(_ctx: OrpcCtx, input: EvolveAnswerInput) -> Result<OkResult, ORPCError> {
    evolve::answer_evolve_question(input.answer)
        .await
        .map_err(|error| internal_err("darwin.evolveAnswer", error))
}

async fn build_check(ctx: OrpcCtx, _input: ()) -> Result<BuildCheckResult, ORPCError> {
    rollback::run_build_check(ctx.app)
        .await
        .map_err(|error| internal_err("darwin.buildCheck", error))
}

async fn evolve_from_manual(
    ctx: OrpcCtx,
    _input: (),
) -> Result<AdoptManualChangesResult, ORPCError> {
    rollback::adopt_manual_changes(ctx.app)
        .await
        .map(|evolution_id| AdoptManualChangesResult { evolution_id })
        .map_err(|error| internal_err("darwin.evolveFromManual", error))
}

async fn apply_stream_start(
    ctx: OrpcCtx,
    input: ApplyStreamStartInput,
) -> Result<OkResult, ORPCError> {
    apply::start_apply_stream(ctx.app, input.host_override)
        .await
        .map_err(|error| internal_err("darwin.applyStreamStart", error))
}

async fn check_etc_clobber(ctx: OrpcCtx, _input: ()) -> Result<EtcClobberCheckResult, ORPCError> {
    apply::check_etc_clobber(ctx.app)
        .await
        .map_err(|error| internal_err("darwin.checkEtcClobber", error))
}

async fn activate_store_path(
    ctx: OrpcCtx,
    input: ActivateStorePathInput,
) -> Result<OkResult, ORPCError> {
    apply::activate_store_path(ctx.app, input.store_path)
        .await
        .map_err(|error| internal_err("darwin.activateStorePath", error))
}

async fn finalize_apply_handler(ctx: OrpcCtx, _input: ()) -> Result<(), ORPCError> {
    apply::run_finalize_apply(ctx.app)
        .await
        .map_err(|error| internal_err("darwin.finalizeApply", error))
}

async fn finalize_rollback_handler(
    ctx: OrpcCtx,
    input: FinalizeRollbackInput,
) -> Result<(), ORPCError> {
    apply::run_finalize_rollback(ctx.app, input.store_path, input.changeset_id)
        .await
        .map_err(|error| internal_err("darwin.finalizeRollback", error))
}

async fn rollback_erase(ctx: OrpcCtx, _input: ()) -> Result<RollbackResult, ORPCError> {
    rollback::run_rollback_erase(ctx.app)
        .await
        .map_err(|error| internal_err("darwin.rollbackErase", error))
}

async fn prepare_restore(ctx: OrpcCtx, input: RestoreTargetInput) -> Result<(), ORPCError> {
    crate::commands::summarize::run_prepare_restore(ctx.app, input.target_hash)
        .await
        .map_err(|error| internal_err("darwin.prepareRestore", error))
}

async fn abort_restore(ctx: OrpcCtx, _input: ()) -> Result<(), ORPCError> {
    crate::commands::summarize::run_abort_restore(ctx.app)
        .await
        .map_err(|error| internal_err("darwin.abortRestore", error))
}

async fn finalize_restore(ctx: OrpcCtx, input: RestoreTargetInput) -> Result<(), ORPCError> {
    crate::commands::summarize::run_finalize_restore(ctx.app, input.target_hash)
        .await
        .map_err(|error| internal_err("darwin.finalizeRestore", error))
}

async fn rebuild_status(ctx: OrpcCtx, _input: ()) -> Result<RebuildStatus, ORPCError> {
    apply::fetch_rebuild_status(ctx.app)
        .await
        .map_err(|error| internal_err("darwin.rebuildStatus", error))
}

async fn helper_status(_ctx: OrpcCtx, _input: ()) -> Result<HelperServiceStatus, ORPCError> {
    Ok(service::status())
}

async fn helper_register(_ctx: OrpcCtx, _input: ()) -> Result<HelperServiceStatus, ORPCError> {
    service::register().map_err(|error| internal_err("darwin.helperRegister", error))
}

async fn helper_unregister(_ctx: OrpcCtx, _input: ()) -> Result<HelperServiceStatus, ORPCError> {
    service::unregister().map_err(|error| internal_err("darwin.helperUnregister", error))
}

async fn sync_agent_status(_ctx: OrpcCtx, _input: ()) -> Result<SyncAgentStatus, ORPCError> {
    Ok(sync_agent::status())
}

async fn sync_agent_install(
    _ctx: OrpcCtx,
    input: InstallSyncAgentInput,
) -> Result<SyncAgentStatus, ORPCError> {
    let program_path = sync_agent::bundled_sync_agent_path()
        .ok_or_else(|| ORPCError::internal_server_error("sync agent path unavailable"))?;
    sync_agent::install(&program_path, input.config.as_ref())
        .map_err(|error| internal_err("darwin.syncAgentInstall", error))
}

async fn sync_agent_uninstall(_ctx: OrpcCtx, _input: ()) -> Result<SyncAgentStatus, ORPCError> {
    sync_agent::uninstall().map_err(|error| internal_err("darwin.syncAgentUninstall", error))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "evolve" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<EvolveInput>())
            .handler(evolve_handler),
        "evolveCancel" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<EvolveCancelResult>())
            .handler(evolve_cancel),
        "evolveAnswer" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<EvolveAnswerInput>())
            .output(orpc_specta::specta::<OkResult>())
            .handler(evolve_answer),
        "buildCheck" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<BuildCheckResult>())
            .handler(build_check),
        "evolveFromManual" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<AdoptManualChangesResult>())
            .handler(evolve_from_manual),
        "applyStreamStart" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<ApplyStreamStartInput>())
            .output(orpc_specta::specta::<OkResult>())
            .handler(apply_stream_start),
        "checkEtcClobber" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<EtcClobberCheckResult>())
            .handler(check_etc_clobber),
        "activateStorePath" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<ActivateStorePathInput>())
            .output(orpc_specta::specta::<OkResult>())
            .handler(activate_store_path),
        "finalizeApply" => os::<OrpcCtx>()
            .handler(finalize_apply_handler),
        "finalizeRollback" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<FinalizeRollbackInput>())
            .handler(finalize_rollback_handler),
        "rollbackErase" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<RollbackResult>())
            .handler(rollback_erase),
        "prepareRestore" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<RestoreTargetInput>())
            .handler(prepare_restore),
        "abortRestore" => os::<OrpcCtx>()
            .handler(abort_restore),
        "finalizeRestore" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<RestoreTargetInput>())
            .handler(finalize_restore),
        "rebuildStatus" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<RebuildStatus>())
            .handler(rebuild_status),
        "helperStatus" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<HelperServiceStatus>())
            .handler(helper_status),
        "helperRegister" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<HelperServiceStatus>())
            .handler(helper_register),
        "helperUnregister" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<HelperServiceStatus>())
            .handler(helper_unregister),
        "syncAgentStatus" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<SyncAgentStatus>())
            .handler(sync_agent_status),
        "syncAgentInstall" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<InstallSyncAgentInput>())
            .output(orpc_specta::specta::<SyncAgentStatus>())
            .handler(sync_agent_install),
        "syncAgentUninstall" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<SyncAgentStatus>())
            .handler(sync_agent_uninstall),
    }
}
