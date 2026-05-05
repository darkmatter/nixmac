#!/bin/bash
# Shared helpers for nixmac Peekaboo Product Proof scenarios.

NIXMAC_PP_ELEMENTS_JSON_FILE="${NIXMAC_PP_ELEMENTS_JSON_FILE:-${TMPDIR:-/tmp}/nixmac-e2e-elements-$$.json}"

nixmac_pp_repo_root() {
    cd "$E2E_ROOT/../.." && pwd
}

nixmac_pp_create_basic_config_repo() {
    local description="${1:-nixmac E2E fixture}"
    NIXMAC_E2E_CONFIG_REPO=$(mktemp -d "${TMPDIR:-/tmp}/nixmac-e2e-config.XXXXXX") \
        || die "Failed to create temporary config repo"

    cat > "$NIXMAC_E2E_CONFIG_REPO/flake.nix" <<NIX
{
  description = "$description";

  outputs = { self }: {
    darwinConfigurations.e2e-host = {};
  };
}
NIX

    git -C "$NIXMAC_E2E_CONFIG_REPO" init >/dev/null 2>&1 \
        || die "Failed to initialize temporary config repo"
    git -C "$NIXMAC_E2E_CONFIG_REPO" config user.name "nixmac e2e"
    git -C "$NIXMAC_E2E_CONFIG_REPO" config user.email "e2e@nixmac.local"
    git -C "$NIXMAC_E2E_CONFIG_REPO" add flake.nix
    git -C "$NIXMAC_E2E_CONFIG_REPO" commit -m "initial e2e config" >/dev/null 2>&1 \
        || die "Failed to commit temporary config repo"
}

nixmac_pp_seed_local_validation_settings() {
    local settings_dir="$HOME/Library/Application Support/${NIXMAC_BUNDLE_ID}"
    local settings_path="$settings_dir/settings.json"
    local config_dir="${1:-$NIXMAC_E2E_CONFIG_REPO}"
    local host_attr="${2:-${NIXMAC_E2E_HOST_ATTR:-e2e-host}}"

    mkdir -p "$settings_dir" || die "Failed to create nixmac settings directory"
    jq -n \
        --arg configDir "$config_dir" \
        --arg hostAttr "$host_attr" \
        '{
            configDir: $configDir,
            hostAttr: $hostAttr,
            evolveProvider: "vllm",
            summaryProvider: "vllm",
            evolveModel: "gpt-oss-120b",
            summaryModel: "gpt-oss-120b",
            maxIterations: 1,
            maxBuildAttempts: 1,
            sendDiagnostics: false,
            confirmBuild: true,
            confirmClear: true,
            confirmRollback: true
        }' > "$settings_path" || die "Failed to write nixmac settings"

    log "Seeded nixmac settings at $settings_path"
}

nixmac_pp_find_element() {
    local pattern="$1"
    local role="${2:-}"
    local timeout="${3:-30}"
    local deadline json element

    deadline=$(($(date +%s) + timeout))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        json=$(peek_elements "$NIXMAC_APP_NAME")
        element=$(echo "$json" | jq -r --arg pattern "$pattern" --arg role "$role" '
            .data.ui_elements[]? |
            select($role == "" or .role == $role) |
            select([
                .identifier? // "",
                .label? // "",
                .title? // "",
                .value? // "",
                .description? // ""
            ] | join(" ") | test($pattern; "i")) |
            .id
        ' 2>/dev/null | head -1)

        if [ -n "$element" ]; then
            printf '%s' "$json" > "$NIXMAC_PP_ELEMENTS_JSON_FILE"
            printf '%s\n' "$element"
            return 0
        fi
        sleep 2
    done

    return 1
}

nixmac_pp_click_element() {
    local pattern="$1"
    local role="${2:-}"
    local timeout="${3:-30}"
    local element json

    element=$(nixmac_pp_find_element "$pattern" "$role" "$timeout") || return 1
    json=$(cat "$NIXMAC_PP_ELEMENTS_JSON_FILE" 2>/dev/null || true)
    [ -n "$json" ] || return 1
    log "Clicking element $element matching '$pattern'"
    peekaboo_run app switch --to "$NIXMAC_APP_NAME" >/dev/null 2>&1 || true
    sleep 0.2
    peek_click "$element" "$json"
}

nixmac_pp_click_window_ratio() {
    local label="$1"
    local x_ratio="$2"
    local y_ratio="$3"
    local bounds coords window_json

    window_json=$(peekaboo_run window list --app "$NIXMAC_APP_NAME" --json 2>/dev/null || true)
    bounds=$(echo "$window_json" | jq -r '
        .data.windows
        | map(select(.bounds?.x != null and .bounds?.y != null and .bounds?.width != null and .bounds?.height != null))
        | sort_by(
            if ((.window_title? // "") | test("^nixmac$"; "i")) then 1 else 0 end,
            (.bounds.width * .bounds.height)
        )
        | reverse
        | .[0].bounds? |
        select(.x != null and .y != null and .width != null and .height != null) |
        "\(.x),\(.y),\(.width),\(.height)"
    ' 2>/dev/null | head -1)
    if [ -z "$bounds" ]; then
        warn "Coordinate fallback could not resolve nixmac window bounds for $label"
        return 1
    fi
    coords=$(printf '%s\n' "$bounds" | awk -F, -v xr="$x_ratio" -v yr="$y_ratio" '
        NF == 4 { printf "%d,%d", $1 + ($3 * xr), $2 + ($4 * yr) }
    ')
    [ -n "$coords" ] || return 1
    log "Coordinate fallback click for $label at $coords"
    peekaboo_run app switch --to "$NIXMAC_APP_NAME" >/dev/null 2>&1 || true
    sleep 0.2
    peekaboo_run click --coords "$coords" >/dev/null 2>&1
}

nixmac_pp_wait_for_text() {
    local pattern="$1"
    local timeout="${2:-30}"
    local deadline text

    deadline=$(($(date +%s) + timeout))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        text=$(nixmac_text)
        if echo "$text" | grep -qiE "$pattern"; then
            return 0
        fi
        sleep 2
    done

    return 1
}

nixmac_pp_wait_for_prompt_value() {
    local expected="$1"
    local timeout="${2:-20}"
    local deadline json

    deadline=$(($(date +%s) + timeout))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        json=$(peek_elements "$NIXMAC_APP_NAME")
        if echo "$json" | jq -e --arg expected "$expected" '
            .data.ui_elements[]? |
            select([
                .identifier? // "",
                .label? // "",
                .title? // "",
                .value? // "",
                .description? // ""
            ] | join(" ") | contains($expected))
        ' >/dev/null 2>&1; then
            return 0
        fi
        sleep 2
    done

    return 1
}

nixmac_pp_wait_for_prompt_value_exact() {
    local expected="$1"
    local timeout="${2:-20}"
    local deadline json

    deadline=$(($(date +%s) + timeout))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        json=$(peek_elements "$NIXMAC_APP_NAME")
        if echo "$json" | jq -e --arg expected "$expected" '
            .data.ui_elements[]? |
            select(
                ((.identifier? // "") | test("evolve-prompt-input|Configuration change descriptor"; "i")) or
                ((.label? // "") | test("evolve-prompt-input|Configuration change descriptor|Describe changes"; "i")) or
                ((.description? // "") | test("evolve-prompt-input|Configuration change descriptor|Describe changes"; "i"))
            ) |
            select((.value? // "") == $expected)
        ' >/dev/null 2>&1; then
            return 0
        fi
        sleep 2
    done

    return 1
}

nixmac_pp_redacted_text_snapshot() {
    local label="$1"
    local dir path raw
    dir="$E2E_DIAGNOSTIC_DIR/text"
    mkdir -p "$dir"
    path="$dir/${label//[^a-zA-Z0-9._-]/_}.txt"
    raw=$(nixmac_text)

    printf '%s' "$raw" | node --input-type=module -e '
import path from "node:path";

const repoRoot = process.argv[1];
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", async () => {
  const text = Buffer.concat(chunks).toString("utf8");
  const modulePath = path.join(repoRoot, "tools/computer-use-e2e/redaction.mjs");
  const { redact, containsUnmaskedSecret } = await import(`file://${modulePath}`);
  process.stdout.write(`${redact(text)}\n`);
  if (containsUnmaskedSecret(text)) process.exit(3);
});
' "$(nixmac_pp_repo_root)" > "$path"
    local status=$?
    if [ "$status" -eq 3 ]; then
        fail "Unmasked secret detected while capturing $label text"
        return 1
    fi
    if [ "$status" -ne 0 ]; then
        fail "Failed to redact $label text"
        return 1
    fi
    log "Redacted text snapshot saved: $path"
}

nixmac_pp_cleanup_common() {
    launchctl unsetenv NIXMAC_E2E_MOCK_SYSTEM 2>/dev/null || true
    launchctl unsetenv NIXMAC_E2E_OPAQUE_WINDOW 2>/dev/null || true
    launchctl unsetenv OPENAI_API_KEY 2>/dev/null || true
    launchctl unsetenv OPENROUTER_API_KEY 2>/dev/null || true
    launchctl unsetenv VLLM_API_KEY 2>/dev/null || true
    rm -f "$NIXMAC_PP_ELEMENTS_JSON_FILE" 2>/dev/null || true
    if [ -n "${NIXMAC_E2E_CONFIG_REPO:-}" ]; then
        rm -rf "$NIXMAC_E2E_CONFIG_REPO" 2>/dev/null || true
    fi
}

nixmac_pp_set_e2e_launch_env() {
    export NIXMAC_E2E_MOCK_SYSTEM=1
    export NIXMAC_E2E_OPAQUE_WINDOW=1
    export OPENAI_API_KEY="[REDACTED]"
    export OPENROUTER_API_KEY="[REDACTED]"
    export VLLM_API_KEY=e2e
    launchctl setenv NIXMAC_E2E_MOCK_SYSTEM 1
    launchctl setenv NIXMAC_E2E_OPAQUE_WINDOW 1
    launchctl setenv OPENAI_API_KEY "$OPENAI_API_KEY"
    launchctl setenv OPENROUTER_API_KEY "$OPENROUTER_API_KEY"
    launchctl setenv VLLM_API_KEY "$VLLM_API_KEY"
}
