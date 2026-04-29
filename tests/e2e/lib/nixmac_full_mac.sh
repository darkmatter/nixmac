#!/bin/bash
# =============================================================================
# nixmac full-Mac helpers
#
# Test-only helpers for richer real-desktop journeys. Everything lives under
# tests/e2e so the SSH Mac runner's sparse checkout sees the required assets.
# =============================================================================

nixmac_app_support_dir() {
    echo "$HOME/Library/Application Support/${NIXMAC_BUNDLE_ID:-com.darkmatter.nixmac}"
}

nixmac_settings_path() {
    echo "$(nixmac_app_support_dir)/settings.json"
}

nixmac_e2e_hostname() {
    scutil --get LocalHostName 2>/dev/null || hostname -s 2>/dev/null || echo "localhost"
}

nixmac_platform_triple() {
    local arch
    arch="$(uname -m)"
    case "$arch" in
        arm64) echo "aarch64-darwin" ;;
        x86_64) echo "x86_64-darwin" ;;
        *) echo "${arch}-darwin" ;;
    esac
}

nixmac_create_config_repo() {
    local host="${1:-$(nixmac_e2e_hostname)}"
    local template="$E2E_ROOT/fixtures/nix-config-template"
    local repo

    [ -d "$template" ] || die "nix config template missing at $template"
    repo="$(mktemp -d "${TMPDIR:-/tmp}/nixmac-e2e-config.XXXXXX")" || die "Failed to create temp config repo"
    cp -R "$template/." "$repo/" || die "Failed to copy config template"

    local username platform
    username="${USER:-eval}"
    platform="$(nixmac_platform_triple)"
    find "$repo" -type f -name "*.nix" -print0 \
        | xargs -0 perl -pi -e "s/HOSTNAME_PLACEHOLDER/\\Q$host\\E/g; s/USERNAME_PLACEHOLDER/\\Q$username\\E/g; s/PLATFORM_PLACEHOLDER/\\Q$platform\\E/g"

    printf 'flake.lock\n' > "$repo/.gitignore"
    git -C "$repo" init >/dev/null 2>&1 || die "Failed to init temp config repo"
    git -C "$repo" config user.name eval
    git -C "$repo" config user.email eval@test
    git -C "$repo" add -A
    git -C "$repo" commit -m "initial nix config state" --author "eval <eval@test>" >/dev/null 2>&1 \
        || die "Failed to commit temp config repo"
    git -C "$repo" update-index --refresh >/dev/null 2>&1 || true

    echo "$repo"
}

nixmac_write_settings_json() {
    local config_dir="${NIXMAC_SETTINGS_CONFIG_DIR:-}"
    local host="${NIXMAC_SETTINGS_HOST:-$(nixmac_e2e_hostname)}"
    local evolve_provider="${NIXMAC_SETTINGS_EVOLVE_PROVIDER:-vllm}"
    local evolve_model="${NIXMAC_SETTINGS_EVOLVE_MODEL:-gpt-oss-120b}"
    local summary_provider="${NIXMAC_SETTINGS_SUMMARY_PROVIDER:-vllm}"
    local summary_model="${NIXMAC_SETTINGS_SUMMARY_MODEL:-gpt-oss-120b}"
    local openrouter_key="${NIXMAC_SETTINGS_OPENROUTER_API_KEY:-}"
    local vllm_base="${NIXMAC_SETTINGS_VLLM_BASE_URL:-}"
    local vllm_key="${NIXMAC_SETTINGS_VLLM_API_KEY:-test-vllm-key}"
    local ollama_base="${NIXMAC_SETTINGS_OLLAMA_BASE_URL:-}"
    local max_iterations="${NIXMAC_SETTINGS_MAX_ITERATIONS:-25}"
    local max_build_attempts="${NIXMAC_SETTINGS_MAX_BUILD_ATTEMPTS:-5}"
    local confirm_build="${NIXMAC_SETTINGS_CONFIRM_BUILD:-true}"
    local confirm_clear="${NIXMAC_SETTINGS_CONFIRM_CLEAR:-true}"
    local confirm_rollback="${NIXMAC_SETTINGS_CONFIRM_ROLLBACK:-true}"
    local send_diagnostics="${NIXMAC_SETTINGS_SEND_DIAGNOSTICS:-false}"
    local settings_dir settings_path

    settings_dir="$(nixmac_app_support_dir)"
    settings_path="$(nixmac_settings_path)"
    mkdir -p "$settings_dir" || die "Failed to create app support dir: $settings_dir"

    jq -n \
        --arg host "$host" \
        --arg configDir "$config_dir" \
        --arg evolveProvider "$evolve_provider" \
        --arg evolveModel "$evolve_model" \
        --arg summaryProvider "$summary_provider" \
        --arg summaryModel "$summary_model" \
        --arg openrouterApiKey "$openrouter_key" \
        --arg vllmApiBaseUrl "$vllm_base" \
        --arg vllmApiKey "$vllm_key" \
        --arg ollamaApiBaseUrl "$ollama_base" \
        --argjson maxIterations "$max_iterations" \
        --argjson maxBuildAttempts "$max_build_attempts" \
        --argjson confirmBuild "$confirm_build" \
        --argjson confirmClear "$confirm_clear" \
        --argjson confirmRollback "$confirm_rollback" \
        --argjson sendDiagnostics "$send_diagnostics" \
        '{
            hostAttr: $host,
            configDir: (if $configDir == "" then null else $configDir end),
            openrouterApiKey: (if $openrouterApiKey == "" then null else $openrouterApiKey end),
            vllmApiBaseUrl: (if $vllmApiBaseUrl == "" then null else $vllmApiBaseUrl end),
            vllmApiKey: (if $vllmApiKey == "" then null else $vllmApiKey end),
            ollamaApiBaseUrl: (if $ollamaApiBaseUrl == "" then null else $ollamaApiBaseUrl end),
            evolveProvider: $evolveProvider,
            evolveModel: $evolveModel,
            summaryProvider: $summaryProvider,
            summaryModel: $summaryModel,
            maxIterations: $maxIterations,
            maxBuildAttempts: $maxBuildAttempts,
            sendDiagnostics: $sendDiagnostics,
            confirmBuild: $confirmBuild,
            confirmClear: $confirmClear,
            confirmRollback: $confirmRollback
        } | with_entries(select(.value != null))' > "$settings_path" \
        || die "Failed to write settings JSON"

    log "Seeded nixmac settings: $settings_path"
}

nixmac_seed_vllm_settings() {
    local config_dir="$1"
    local host="$2"
    local base_url="$3"
    NIXMAC_SETTINGS_CONFIG_DIR="$config_dir" \
    NIXMAC_SETTINGS_HOST="$host" \
    NIXMAC_SETTINGS_VLLM_BASE_URL="$base_url" \
    NIXMAC_SETTINGS_EVOLVE_PROVIDER="vllm" \
    NIXMAC_SETTINGS_SUMMARY_PROVIDER="vllm" \
    nixmac_write_settings_json
}

nixmac_seed_vllm_missing_base_settings() {
    local config_dir="$1"
    local host="$2"
    NIXMAC_SETTINGS_CONFIG_DIR="$config_dir" \
    NIXMAC_SETTINGS_HOST="$host" \
    NIXMAC_SETTINGS_VLLM_BASE_URL="" \
    NIXMAC_SETTINGS_EVOLVE_PROVIDER="vllm" \
    NIXMAC_SETTINGS_SUMMARY_PROVIDER="vllm" \
    nixmac_write_settings_json
}

nixmac_seed_openrouter_settings() {
    local config_dir="$1"
    local host="$2"
    local api_key="$3"
    local model="${4:-openai/gpt-4.1}"
    local summary_model="${5:-openai/gpt-4o-mini}"
    NIXMAC_SETTINGS_CONFIG_DIR="$config_dir" \
    NIXMAC_SETTINGS_HOST="$host" \
    NIXMAC_SETTINGS_OPENROUTER_API_KEY="$api_key" \
    NIXMAC_SETTINGS_EVOLVE_PROVIDER="openai" \
    NIXMAC_SETTINGS_EVOLVE_MODEL="$model" \
    NIXMAC_SETTINGS_SUMMARY_PROVIDER="openai" \
    NIXMAC_SETTINGS_SUMMARY_MODEL="$summary_model" \
    nixmac_write_settings_json
}

nixmac_wait_settings_jq() {
    local filter="$1"
    local description="$2"
    local timeout="${3:-10}"
    local interval="${4:-1}"
    local settings_path
    settings_path="$(nixmac_settings_path)"

    local elapsed=0
    while [ "$elapsed" -lt "$timeout" ]; do
        if [ -f "$settings_path" ] && jq -e "$filter" "$settings_path" >/dev/null 2>&1; then
            pass "$description"
            return 0
        fi
        sleep "$interval"
        elapsed=$((elapsed + interval))
    done

    warn "Last settings content for failed assertion:"
    [ -f "$settings_path" ] && cat "$settings_path" | tee -a "$E2E_LOG_FILE" || true
    fail "$description"
    return 1
}

nixmac_git_diff_contains() {
    local repo="$1"
    local expected="$2"
    git -C "$repo" diff -- | grep -qiF "$expected"
}

nixmac_wait_git_diff_contains() {
    local repo="$1"
    local expected="$2"
    local timeout="${3:-60}"
    local elapsed=0
    while [ "$elapsed" -lt "$timeout" ]; do
        if nixmac_git_diff_contains "$repo" "$expected"; then
            pass "Config repo diff contains $expected"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done

    git -C "$repo" diff -- | tee -a "$E2E_LOG_FILE" || true
    fail "Config repo diff did not contain $expected"
    return 1
}

nixmac_start_mock_vllm() {
    local response_files="$1"
    local context_file log_file
    context_file="$(mktemp "${TMPDIR:-/tmp}/nixmac-mock-vllm.XXXXXX.json")"
    log_file="$(mktemp "${TMPDIR:-/tmp}/nixmac-mock-vllm.XXXXXX.log")"
    rm -f "$context_file"

    if command -v perl >/dev/null 2>&1; then
        log "Starting mock vLLM server with perl"
        perl "$E2E_ROOT/lib/mock-vllm-server.pl" \
            --context "$context_file" \
            --data-dir "$E2E_ROOT/data" \
            --response-files "$response_files" \
            >"$log_file" 2>&1 &
    elif command -v python3 >/dev/null 2>&1; then
        log "Starting mock vLLM server with python3"
        python3 -u "$E2E_ROOT/lib/mock-vllm-server.py" \
            --context "$context_file" \
            --data-dir "$E2E_ROOT/data" \
            --response-files "$response_files" \
            >"$log_file" 2>&1 &
    elif command -v node >/dev/null 2>&1; then
        log "Starting mock vLLM server with node"
        node "$E2E_ROOT/lib/mock-vllm-server.mjs" \
            --context "$context_file" \
            --data-dir "$E2E_ROOT/data" \
            --response-files "$response_files" \
            >"$log_file" 2>&1 &
    else
        die "Mock vLLM server requires node or python3"
    fi
    NIXMAC_MOCK_VLLM_PID=$!
    NIXMAC_MOCK_VLLM_CONTEXT="$context_file"
    NIXMAC_MOCK_VLLM_LOG="$log_file"
    export NIXMAC_MOCK_VLLM_PID NIXMAC_MOCK_VLLM_CONTEXT NIXMAC_MOCK_VLLM_LOG

    local elapsed=0
    local ready_timeout="${NIXMAC_MOCK_VLLM_READY_TIMEOUT:-45}"
    while [ "$elapsed" -lt "$ready_timeout" ]; do
        if [ -s "$context_file" ]; then
            NIXMAC_MOCK_VLLM_ORIGIN="$(jq -r '.origin' "$context_file")"
            NIXMAC_MOCK_VLLM_BASE_URL="$(jq -r '.baseUrl' "$context_file")"
            export NIXMAC_MOCK_VLLM_ORIGIN NIXMAC_MOCK_VLLM_BASE_URL
            if curl -fsS "$NIXMAC_MOCK_VLLM_ORIGIN/health" >/dev/null; then
                pass "Mock vLLM server ready at $NIXMAC_MOCK_VLLM_BASE_URL"
                return 0
            fi
        fi
        if ! kill -0 "$NIXMAC_MOCK_VLLM_PID" 2>/dev/null; then
            cat "$log_file" | tee -a "$E2E_LOG_FILE" || true
            die "Mock vLLM server exited before becoming ready"
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done

    cat "$log_file" | tee -a "$E2E_LOG_FILE" || true
    die "Mock vLLM server did not become ready within ${ready_timeout}s"
}

nixmac_set_mock_vllm_files() {
    local response_files="$1"
    [ -n "${NIXMAC_MOCK_VLLM_ORIGIN:-}" ] || die "Mock vLLM server is not running"
    jq -n --arg files "$response_files" '{responseFiles: ($files | split(",") | map(select(length > 0)))}' \
        | curl -fsS -X POST \
            -H 'content-type: application/json' \
            --data-binary @- \
            "$NIXMAC_MOCK_VLLM_ORIGIN/__admin/mock-responses" >/dev/null \
        || die "Failed to reset mock vLLM responses"
    pass "Mock vLLM responses reset: $response_files"
}

nixmac_stop_mock_vllm() {
    if [ -n "${NIXMAC_MOCK_VLLM_PID:-}" ] && kill -0 "$NIXMAC_MOCK_VLLM_PID" 2>/dev/null; then
        kill "$NIXMAC_MOCK_VLLM_PID" 2>/dev/null || true
        wait "$NIXMAC_MOCK_VLLM_PID" 2>/dev/null || true
    fi
}

nixmac_settings_tab_coords() {
    case "$1" in
        General) echo "180,235" ;;
        "AI Models") echo "180,271" ;;
        "API Keys") echo "180,307" ;;
        Preferences) echo "180,343" ;;
        *) return 1 ;;
    esac
}

nixmac_open_settings_tab() {
    local tab="$1"
    local expected="$2"
    local coords=""
    local tab_pattern="(^| )${tab}($| )"

    log "Opening settings tab: $tab"
    if nixmac_click_element_matching "$tab_pattern" --role button --timeout 12 --optional; then
        sleep 2
        if nixmac_wait_for_text "$expected" --timeout 12 --interval 2; then
            pass "Settings tab rendered: $tab"
            return 0
        fi
    fi

    coords="$(nixmac_settings_tab_coords "$tab" || true)"
    if [ -n "$coords" ]; then
        osascript -e "tell application \"${NIXMAC_APP_NAME}\" to activate" >/dev/null 2>&1 || true
        sleep 1
        log "Clicking settings tab via coordinates: $tab at $coords"
        peekaboo_run click --coords "$coords" >/dev/null 2>&1 || true
        sleep 2
        if nixmac_wait_for_text "$expected" --timeout 12 --interval 2; then
            pass "Settings tab rendered: $tab"
            return 0
        fi
    fi

    warn "Settings tab text was not confirmed by Peekaboo capture: $tab"
    return 1
}

nixmac_click_element_matching() {
    local pattern="$1"
    local role=""
    local timeout=30
    local optional=0
    shift
    while [ $# -gt 0 ]; do
        case "$1" in
            --optional) optional=1; shift ;;
            --role) role="$2"; shift 2 ;;
            --timeout) timeout="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    local elapsed=0 json element
    while [ "$elapsed" -lt "$timeout" ]; do
        json="$(peek_elements "$NIXMAC_APP_NAME")"
        element="$(echo "$json" | jq -r --arg pattern "$pattern" --arg role "$role" '
            .data.ui_elements[]? |
            select($role == "" or .role == $role) |
            select([
                .label? // "",
                .title? // "",
                .value? // "",
                .identifier? // "",
                .description? // ""
            ] | join(" ") | test($pattern; "i")) |
            .id
        ' 2>/dev/null | head -1)"
        if [ -n "$element" ]; then
            log "Clicking element: $element (matched '$pattern')"
            peek_click "$element" "$json"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done

    if [ "$optional" = "1" ]; then
        warn "Optional element matching '$pattern' not found"
    else
        nixmac_screenshot "missing-element-$(echo "$pattern" | tr '[:upper:] ' '[:lower:]-' | tr -cd '[:alnum:]-')"
        fail "Element matching '$pattern' not found"
    fi
    return 1
}

nixmac_submit_prompt_from_suggestion() {
    local suggestion="${1:-Install vim}"
    nixmac_click_button "^${suggestion}$" --timeout 30 || return 1
    sleep 1
    nixmac_click_prompt_submit || return 1
}

nixmac_click_prompt_submit() {
    local pattern="evolve-prompt-send|Submit configuration change descriptor|(^| )Send($| )"
    nixmac_click_element_matching "$pattern" --role button --timeout 20 --optional && return 0
    nixmac_click_element_matching "$pattern" --timeout 10 \
        || return 1
}

nixmac_type_text() {
    local text="$1"
    local timeout="${NIXMAC_E2E_TYPE_TIMEOUT:-90}"
    local previous_timeout="${PEEKABOO_COMMAND_TIMEOUT:-15}"
    local status=0

    PEEKABOO_COMMAND_TIMEOUT="$timeout"
    peek_type "$text"
    status=$?
    PEEKABOO_COMMAND_TIMEOUT="$previous_timeout"
    [ "$status" -eq 0 ] && return 0

    warn "Peekaboo type timed out or failed; retrying text entry via clipboard paste"
    nixmac_paste_text "$text" || return "$status"
}

nixmac_paste_text() {
    local text="$1"

    command -v pbcopy >/dev/null 2>&1 || return 1
    printf '%s' "$text" | pbcopy || return 1
    peek_hotkey "cmd+a" || true
    sleep 0.5
    peek_hotkey "cmd+v" || return 1
}

nixmac_type_prompt_and_submit() {
    local prompt="$1"
    nixmac_click_element_matching "Describe changes|Describe additional|evolve-prompt-input|prompt" --timeout 30 || return 1
    peek_hotkey "cmd+a" || true
    nixmac_type_text "$prompt" || return 1
    sleep 1
    nixmac_click_prompt_submit || return 1
}

nixmac_answer_inline_question() {
    local answer="$1"
    nixmac_click_element_matching "question|answer|question-prompt-input" --timeout 30 || return 1
    peek_hotkey "cmd+a" || true
    nixmac_type_text "$answer" || return 1
    sleep 1
    nixmac_click_element_matching "submit|send|question-prompt-submit" --timeout 30 || return 1
}
