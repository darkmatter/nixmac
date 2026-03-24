//! CLI interface for nixmac - allows running evolve from the command line.
//!
//! Usage:
//!   nixmac evolve "your prompt here"
//!   nixmac evolve "your prompt" --config /path/to/config
//!   nixmac evolve "your prompt" --max-iterations 5 --host aarch64-darwin
//!
//! NOTE NOTE NOTE: If you pass any CLI arguments corresponding to settings that
//! come from the app store, those CLI arguments will override the store values
//! for that run of the evolution.
//! However, the CLI arguments will also update the store with those values,
//! so subsequent runs (even from the UI) will use the CLI-provided values as defaults.
//! This is because we don't currently have a good way to pipe these settings
//! through a single run.
//! This is something we should consider refactoring for in the future.

use clap::{Parser, Subcommand};
use serde_json::json;
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Clone)]
pub struct EvolveConfig {
    pub prompt: String,
    pub config: Option<PathBuf>,
    pub max_iterations: Option<usize>,
    pub evolve_provider: Option<String>,
    pub evolve_model: Option<String>,
    pub summary_provider: Option<String>,
    pub summary_model: Option<String>,
    pub openai_key: Option<String>,
    pub openrouter_key: Option<String>,
    pub ollama_url: Option<String>,
    pub host: Option<String>,
    pub out: Option<PathBuf>,
}

#[derive(Parser)]
#[command(name = "nixmac")]
#[command(about = "macOS nix-darwin configuration manager", long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Commands>,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Run an evolution with the given prompt
    Evolve {
        /// The prompt to use for evolution
        prompt: String,

        /// Path to the config directory
        #[arg(short, long)]
        config: Option<PathBuf>,

        /// Maximum iterations for the evolution
        #[arg(short, long)]
        max_iterations: Option<usize>,

        /// Provider for evolution (e.g., openai, openrouter, ollama)
        #[arg(long)]
        evolve_provider: Option<String>,

        /// Model name for evolution
        #[arg(long)]
        evolve_model: Option<String>,

        /// Provider for summarization
        #[arg(long)]
        summary_provider: Option<String>,

        /// Model name for summarization
        #[arg(long)]
        summary_model: Option<String>,

        /// OpenAI API key
        #[arg(long)]
        openai_key: Option<String>,

        /// OpenRouter API key
        #[arg(long)]
        openrouter_key: Option<String>,

        /// Ollama API base URL
        #[arg(long)]
        ollama_url: Option<String>,

        /// Host attribute (e.g., aarch64-darwin)
        #[arg(long)]
        host: Option<String>,

        /// Optional output file to write JSON result
        #[arg(long)]
        out: Option<PathBuf>,
    },
}

/// Runs evolution with provided or default settings
pub async fn handle_evolve_command(app: &AppHandle, cfg: EvolveConfig) -> Result<(), String> {
    let EvolveConfig {
        prompt,
        config,
        max_iterations,
        evolve_provider,
        evolve_model,
        summary_provider,
        summary_model,
        openai_key,
        openrouter_key,
        ollama_url,
        host,
        out,
    } = cfg;
    // Config
    if let Some(config_path) = config {
        crate::store::set_config_dir(app, &config_path.to_string_lossy())
            .map_err(|e| format!("Failed to set config dir: {}", e))?;
    }

    // API keys and URLs
    if let Some(ref key) = openai_key {
        crate::store::set_openai_api_key(app, key)
            .map_err(|e| format!("Failed to set OpenAI key: {}", e))?;
    }

    if let Some(ref key) = openrouter_key {
        crate::store::set_openrouter_api_key(app, key)
            .map_err(|e| format!("Failed to set OpenRouter key: {}", e))?;
    }

    if let Some(ref url) = ollama_url {
        crate::store::set_ollama_api_base_url(app, url)
            .map_err(|e| format!("Failed to set Ollama URL: {}", e))?;
    }

    // Model prefs
    if let Some(ref provider) = evolve_provider {
        crate::store::set_evolve_provider(app, provider)
            .map_err(|e| format!("Failed to set evolve provider: {}", e))?;
    }

    if let Some(ref model) = evolve_model {
        crate::store::set_evolve_model(app, model)
            .map_err(|e| format!("Failed to set evolve model: {}", e))?;
    }

    if let Some(ref provider) = summary_provider {
        crate::store::set_summary_provider(app, provider)
            .map_err(|e| format!("Failed to set summary provider: {}", e))?;
    }

    if let Some(ref model) = summary_model {
        crate::store::set_summary_model(app, model)
            .map_err(|e| format!("Failed to set summary model: {}", e))?;
    }

    // Resolve effective values: prefer CLI-provided, otherwise read from store if available
    let effective_evolve_provider: Option<String> = match &evolve_provider {
        Some(p) => Some(p.clone()),
        None => crate::store::get_evolve_provider(app).ok().flatten(),
    };

    let effective_evolve_model: Option<String> = match &evolve_model {
        Some(m) => Some(m.clone()),
        None => crate::store::get_evolve_model(app).ok().flatten(),
    };

    let effective_summary_provider: Option<String> = match &summary_provider {
        Some(p) => Some(p.clone()),
        None => crate::store::get_summary_provider(app).ok().flatten(),
    };

    let effective_summary_model: Option<String> = match &summary_model {
        Some(m) => Some(m.clone()),
        None => crate::store::get_summary_model(app).ok().flatten(),
    };

    // Effective max iterations: prefer CLI value, otherwise read from store (has default)
    let effective_max_iterations: usize = match max_iterations {
        Some(v) => v,
        None => {
            crate::store::get_max_iterations(app).unwrap_or(crate::store::DEFAULT_MAX_ITERATIONS)
        }
    };

    // Max iterations
    if let Some(iterations) = max_iterations {
        crate::store::set_max_iterations(app, iterations)
            .map_err(|e| format!("Failed to set max iterations: {}", e))?;
    }

    // Host
    if let Some(ref host_attr) = host {
        crate::store::set_host_attr(app, host_attr)
            .map_err(|e| format!("Failed to set host: {}", e))?;
    }

    // DO IT!
    println!("Starting evolution with prompt: {}", prompt);
    let outcome = crate::evolution::evolve_and_commit(app, &prompt).await;

    let (ok, output_value, failure_message) = match outcome {
        Ok(output) => {
            let is_conversational =
                output.telemetry.state == crate::evolve::EvolutionState::Conversational;

            if is_conversational {
                // Print the agent's reply directly to stdout so it is human-readable
                // in terminal sessions and pipe-friendly for scripts.
                let reply = output.summary.instructions.trim();
                println!(
                    "{}",
                    if reply.is_empty() {
                        "(no response)"
                    } else {
                        reply
                    }
                );
            } else {
                println!("Evolution completed successfully");
            }

            let output_value = match serde_json::to_value(&output) {
                Ok(v) => v,
                Err(_) => serde_json::json!({ "raw": format!("{:#?}", output) }),
            };
            (true, output_value, None)
        }
        Err(failure) => {
            println!("Evolution failed: {}", failure.error);
            let output_value = match serde_json::to_value(&failure) {
                Ok(v) => v,
                Err(_) => serde_json::json!({ "error": failure.error.clone() }),
            };
            (false, output_value, Some(failure.error))
        }
    };

    if let Some(out_path) = out {
        // Hoist `state` to the envelope so test suites can branch on it without
        // digging into result.telemetry.state.
        let state_str = output_value
            .get("state")
            .and_then(|v| v.as_str())
            .unwrap_or(if ok { "generated" } else { "failed" });

        let combined = json!({
            "ok": ok,
            "state": state_str,
            "prompt": prompt,
            "maxIterations": effective_max_iterations,
            "evolveProvider": effective_evolve_provider,
            "evolveModel": effective_evolve_model,
            "summaryProvider": effective_summary_provider,
            "summaryModel": effective_summary_model,
            "result": output_value,
        });

        let serialized = serde_json::to_string_pretty(&combined)
            .map_err(|e| format!("Failed to serialize combined output: {}", e))?;

        std::fs::write(&out_path, serialized)
            .map_err(|e| format!("Failed to write output file {}: {}", out_path.display(), e))?;
        println!("Wrote output to {}", out_path.display());
    }

    if let Some(message) = failure_message {
        return Err(format!("Evolution failed: {}", message));
    }

    Ok(())
}

/// Check if CLI mode should be activated based on arguments
pub fn should_run_cli() -> bool {
    let args: Vec<String> = std::env::args().collect();
    // Skip the binary name (args[0])
    if args.len() > 1 {
        let subcommand = &args[1];
        subcommand == "evolve"
    } else {
        false
    }
}

/// Parse args
pub fn parse_cli() -> Result<Cli, String> {
    Cli::try_parse().map_err(|error| error.to_string())
}
