//! `build_check` tool: dry-run nix build to validate the flake.

use anyhow::Result;
use log::{debug, error, info};

use crate::evolve::messages::Tool;

use super::{ToolCtx, ToolResult};

pub(crate) fn definition() -> Tool {
    Tool {
        name: "build_check".to_string(),
        description: "Validate the Nix flake by running a dry-run build. This checks for syntax \
                     errors and evaluation errors WITHOUT actually building derivations. \
                     Call this BEFORE calling 'done' to ensure your changes are valid. \
                     If the build fails, analyze the error and fix it before trying again."
            .to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "show_trace": {
                    "type": "boolean",
                    "description": "Include --show-trace in nix build for deeper stack traces (default: false)"
                }
            },
        }),
    }
}

pub(crate) fn execute(ctx: &ToolCtx) -> Result<ToolResult> {
    let host_attr = ctx.host_attr;
    let config_dir = ctx.config_dir;
    let show_trace = ctx.args["show_trace"].as_bool().unwrap_or(false);
    info!(
        "Running build check for host: {}, show_trace: {}, config_dir: {}",
        host_attr, show_trace, config_dir
    );

    let (passed, stdout, stderr) =
        crate::rebuild::dry_run_build_check(config_dir, host_attr, show_trace)?;

    if passed {
        info!("Build check passed for host: {}", host_attr);
        Ok(ToolResult::BuildResult {
            success: true,
            output: format!("✓ Build check passed for '{}'", host_attr),
            stdout,
            stderr,
        })
    } else {
        error!("Build check failed for host: {}", host_attr);
        debug!("Build error output: stderr: {}, stdout: {}", stderr, stdout);
        Ok(ToolResult::BuildResult {
            success: false,
            output: format!(
                "✗ Build check FAILED for '{}':\n\nTip: Re-run build_check with show_trace=true if you need additional debugging details.",
                host_attr,
            ),
            stdout,
            stderr,
        })
    }
}
