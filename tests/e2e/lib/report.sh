#!/bin/bash
# =============================================================================
# macos-e2e — report contract
#
# Converts the bash runner's phase/video/screenshot artifacts into the shared
# nixmac E2E report schema used by the Tauri WDIO lane.
# =============================================================================

e2e_report_write() {
    local scenario="${E2E_SCENARIO_NAME:-unknown}"
    local status="passed"
    if [ "${_E2E_FAIL_COUNT:-0}" -gt 0 ]; then
        status="failed"
    fi

    local artifact_root="${E2E_ARTIFACT_ROOT:-/tmp/e2e-artifacts}"
    local scenario_dir="$artifact_root/$scenario"
    mkdir -p "$scenario_dir"

    local report_path="$scenario_dir/e2e-report.json"
    local phases_json="[]"
    local proof_json="[]"
    local primary_proof=""
    local failure_proof=""
    local failure_screenshot=""
    local failure_video=""
    local capture_limitations_json="[]"

    if [ -n "${E2E_CAPTURE_LIMITATIONS:-}" ]; then
        capture_limitations_json=$(printf '%s' "$E2E_CAPTURE_LIMITATIONS" \
            | tr ',' '\n' \
            | jq -R 'select(length > 0)' \
            | jq -s 'unique')
    fi

    for result in "${_E2E_PHASE_RESULTS[@]}"; do
        local phase_status phase_num phase_msg normalized_status error_msg
        phase_status=$(echo "$result" | cut -d'|' -f1)
        phase_num=$(echo "$result" | cut -d'|' -f2)
        phase_msg=$(echo "$result" | cut -d'|' -f3-)
        normalized_status="passed"
        error_msg="null"
        if [ "$phase_status" != "PASS" ]; then
            normalized_status="failed"
            error_msg=$(jq -Rn --arg value "$phase_msg" '$value')
        fi

        phases_json=$(echo "$phases_json" | jq \
            --arg name "$phase_msg" \
            --arg status "$normalized_status" \
            --argjson error "$error_msg" \
            '. + [{
                name: $name,
                status: $status,
                startedAt: null,
                finishedAt: null,
                durationMs: 0,
                assertions: [$name],
                proof: [],
                error: $error
            }]')
    done

    if [ "${#_E2E_PHASE_RESULTS[@]}" -eq 0 ]; then
        status="infra_failed"
    fi

    if [ -d "$E2E_SCREENSHOT_DIR" ]; then
        while IFS= read -r screenshot; do
            [ -f "$screenshot" ] || continue
            local dest rel caption is_failure
            dest="$scenario_dir/$(basename "$screenshot")"
            cp "$screenshot" "$dest"
            rel="$scenario/$(basename "$screenshot")"
            caption="$(basename "$screenshot")"
            is_failure=false
            if echo "$caption" | grep -qi "failure\\|error\\|failed"; then
                is_failure=true
            fi
            if [ "$is_failure" = true ] && [ -z "$failure_proof" ]; then
                failure_proof="$rel"
                failure_screenshot="$rel"
            fi
            proof_json=$(echo "$proof_json" | jq \
                --arg path "$rel" \
                --arg caption "$caption" \
                --argjson isFailure "$is_failure" \
                '. + [{
                    kind: "screenshot",
                    path: $path,
                    url: null,
                    thumbnailUrl: null,
                    timestampMs: null,
                    phase: "macos-e2e",
                    caption: $caption,
                    isPrimary: false,
                    isFailureProof: $isFailure
                }]')
        done < <(find "$E2E_SCREENSHOT_DIR" -type f -name "*.png" | sort)
    fi

    if [ -f "$E2E_VIDEO_FILE" ]; then
        local video_dest video_rel
        video_dest="$scenario_dir/$(basename "$E2E_VIDEO_FILE")"
        cp "$E2E_VIDEO_FILE" "$video_dest"
        video_rel="$scenario/$(basename "$E2E_VIDEO_FILE")"
        primary_proof="$video_rel"
        if [ "$status" != "passed" ]; then
            failure_video="$video_rel"
            [ -z "$failure_proof" ] && failure_proof="$video_rel"
        fi
        proof_json=$(echo "$proof_json" | jq \
            --arg path "$video_rel" \
            --argjson isFailure "$([ "$status" != "passed" ] && echo true || echo false)" \
            '. + [{
                kind: "video",
                path: $path,
                url: null,
                thumbnailUrl: null,
                timestampMs: null,
                phase: "macos-e2e",
                caption: "Full screen recording",
                isPrimary: true,
                isFailureProof: $isFailure
            }]')
    fi

    if [ -z "$primary_proof" ]; then
        primary_proof=$(echo "$proof_json" | jq -r '.[0].path // empty')
        if [ -n "$primary_proof" ]; then
            proof_json=$(echo "$proof_json" | jq 'if length > 0 then .[0].isPrimary = true else . end')
        fi
    fi

    local started_at finished_at duration_ms
    started_at=$(date -u -r "${_E2E_START_TIME:-$(date +%s)}" +"%Y-%m-%dT%H:%M:%SZ")
    finished_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    duration_ms=$(( ($(date +%s) - ${_E2E_START_TIME:-$(date +%s)}) * 1000 ))

    jq -n \
        --arg repo "${GITHUB_REPOSITORY:-darkmatter/nixmac}" \
        --argjson prNumber "${GITHUB_PR_NUMBER:-null}" \
        --arg headSha "${E2E_HEAD_SHA:-${COMMIT_SHA:-${GITHUB_SHA:-unknown}}}" \
        --arg baseSha "${E2E_BASE_SHA:-}" \
        --arg workflowRunId "${GITHUB_RUN_ID:-}" \
        --argjson attempt "${GITHUB_RUN_ATTEMPT:-null}" \
        --arg scenario "$scenario" \
        --arg startedAt "$started_at" \
        --arg finishedAt "$finished_at" \
        --argjson durationMs "$duration_ms" \
        --arg status "$status" \
        --argjson phases "$phases_json" \
        --argjson proof "$proof_json" \
        --argjson captureLimitations "$capture_limitations_json" \
        --arg primaryProofUrl "$primary_proof" \
        --arg failureProofUrl "$failure_proof" \
        --arg failureScreenshotUrl "$failure_screenshot" \
        --arg failureVideoUrl "$failure_video" \
        '{
            schemaVersion: 1,
            repo: $repo,
            prNumber: $prNumber,
            headSha: $headSha,
            baseSha: (($baseSha | select(length > 0)) // null),
            workflowRunId: (($workflowRunId | select(length > 0)) // null),
            attempt: $attempt,
            lane: "full-mac",
            scenario: $scenario,
            runnerId: (env.RUNNER_NAME // "macos-e2e"),
            runnerKind: "full-mac",
            startedAt: $startedAt,
            finishedAt: $finishedAt,
            durationMs: $durationMs,
            status: $status,
            htmlReportUrl: null,
            primaryProofUrl: (($primaryProofUrl | select(length > 0)) // null),
            failureProofUrl: (($failureProofUrl | select(length > 0)) // null),
            failureScreenshotUrl: (($failureScreenshotUrl | select(length > 0)) // null),
            failureVideoUrl: (($failureVideoUrl | select(length > 0)) // null),
            failureTimestampMs: null,
            replayCommand: ("tests/e2e/run.sh " + $scenario),
            localReproCommand: ("tests/e2e/run.sh " + $scenario),
            phases: $phases,
            captureLimitations: $captureLimitations,
            proof: $proof
        }' > "$report_path"

    log "E2E report written: $report_path"
}
