//! Persistent usage statistics tracking for evolution operations.
//!
//! This module provides functions to track evolution outcomes and compute
//! success rates. All stats are stored persistently using tauri-plugin-store.

use crate::{store, types};
use anyhow::Result;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

const STATS_KEY: &str = "usageStatistics";

/// Internal statistics data stored in the persistent store.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoredStatistics {
    total_evolutions: u32,
    successful_evolutions: u32,
    failed_evolutions: u32,
    total_iterations: u32,
    #[serde(default)]
    last_updated_at: Option<String>,
}

/// Increment the total evolution counter and mark as successful.
/// Should be called when an evolution completes successfully.
pub fn record_evolution_success<R: Runtime>(
    app: &AppHandle<R>,
    iteration_count: usize,
) -> Result<()> {
    let store = store::get_store(app)?;

    let mut stats: StoredStatistics = store
        .get(STATS_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    stats.total_evolutions += 1;
    stats.successful_evolutions += 1;
    stats.total_iterations += iteration_count as u32;
    stats.last_updated_at = Some(Utc::now().to_rfc3339());

    store.set(STATS_KEY, serde_json::to_value(&stats)?);
    store.save()?;

    Ok(())
}

/// Increment the total evolution counter and mark as failed.
/// Should be called when an evolution fails or is aborted.
pub fn record_evolution_failure<R: Runtime>(
    app: &AppHandle<R>,
    iteration_count: usize,
) -> Result<()> {
    let store = store::get_store(app)?;

    let mut stats: StoredStatistics = store
        .get(STATS_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    stats.total_evolutions += 1;
    stats.failed_evolutions += 1;
    stats.total_iterations += iteration_count as u32;
    stats.last_updated_at = Some(Utc::now().to_rfc3339());

    store.set(STATS_KEY, serde_json::to_value(&stats)?);
    store.save()?;

    Ok(())
}

/// Retrieve current usage statistics and compute derived metrics.
/// Returns statistics formatted for the feedback system.
pub fn get_usage_statistics<R: Runtime>(app: &AppHandle<R>) -> Result<types::FeedbackUsageStats> {
    let store = store::get_store(app)?;

    let stats: StoredStatistics = store
        .get(STATS_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    // Compute success rate
    let success_rate = if stats.total_evolutions > 0 {
        Some((stats.successful_evolutions as f64 / stats.total_evolutions as f64) * 100.0)
    } else {
        None
    };

    // Compute average iterations per evolution
    let avg_iterations = if stats.total_evolutions > 0 {
        Some(stats.total_iterations as f64 / stats.total_evolutions as f64)
    } else {
        None
    };

    Ok(types::FeedbackUsageStats {
        total_evolutions: Some(stats.total_evolutions as u64),
        success_rate,
        avg_iterations,
        last_computed_at: Some(Utc::now().to_rfc3339()),
        extra: Some(serde_json::json!({
            "successful_evolutions": stats.successful_evolutions,
            "failed_evolutions": stats.failed_evolutions,
            "total_iterations": stats.total_iterations,
            "last_updated_at": stats.last_updated_at,
        })),
    })
}
