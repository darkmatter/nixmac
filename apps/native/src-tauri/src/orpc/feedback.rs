//! Feedback metadata gathering and submission.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::feedback as cmd;
use crate::shared_types::{FeedbackMetadata, FeedbackMetadataRequest};
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct GatherMetadataInput {
    request: FeedbackMetadataRequest,
}

async fn gather_metadata(
    ctx: OrpcCtx,
    input: GatherMetadataInput,
) -> Result<FeedbackMetadata, ORPCError> {
    cmd::feedback_gather_metadata(ctx.app, input.request)
        .await
        .map_err(|e| internal_err("feedback.gatherMetadata", e))
}

async fn submit(ctx: OrpcCtx, payload: String) -> Result<bool, ORPCError> {
    cmd::feedback_submit(ctx.app, payload)
        .await
        .map_err(|e| internal_err("feedback.submit", e))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "gatherMetadata" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<GatherMetadataInput>())
            .output(orpc_specta::specta::<FeedbackMetadata>())
            .handler(gather_metadata),
        "submit" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<String>())
            .output(orpc_specta::specta::<bool>())
            .handler(submit),
    }
}
