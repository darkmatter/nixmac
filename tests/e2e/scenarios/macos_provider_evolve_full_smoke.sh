#!/bin/bash
# =============================================================================
# Scenario: macos_provider_evolve_full_smoke
#
# Full macOS-first provider proof: launch the real app, type a descriptor, call
# an OpenAI-compatible provider over HTTP, apply the provider's tool-driven Nix
# edit, mock only the host system rebuild/activation, and continue through the
# Save step with 30 fps video proof.
# =============================================================================

E2E_ADAPTER="nixmac"
export E2E_RECORD_FPS=30
export E2E_RECORDING_STRICT=1

NIXMAC_E2E_DESCRIPTOR_TEXT="Add ripgrep to my system packages"
NIXMAC_E2E_HOST_ATTR="e2e-host"
NIXMAC_E2E_CONFIG_REPO=""
NIXMAC_E2E_ELEMENTS_JSON_FILE="${TMPDIR:-/tmp}/nixmac-e2e-elements-$$.json"
NIXMAC_E2E_PROVIDER_SCRIPT=""
NIXMAC_E2E_PROVIDER_PORT_FILE=""
NIXMAC_E2E_PROVIDER_LOG=""
NIXMAC_E2E_PROVIDER_PID=""
NIXMAC_E2E_COMPLETION_LOG_DIR=""

scenario_create_config_repo() {
    NIXMAC_E2E_CONFIG_REPO=$(mktemp -d "${TMPDIR:-/tmp}/nixmac-e2e-config.XXXXXX") \
        || die "Failed to create temporary config repo"

    cat > "$NIXMAC_E2E_CONFIG_REPO/flake.nix" <<'NIX'
{
  description = "nixmac E2E provider evolve fixture";

  outputs = { self, nixpkgs, nix-darwin }: {
    darwinConfigurations.e2e-host = nix-darwin.lib.darwinSystem {
      system = "aarch64-darwin";
      modules = [
        ({ pkgs, ... }: {
          environment.systemPackages = with pkgs; [
          ];
        })
      ];
    };
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

scenario_start_provider() {
    command -v python3 >/dev/null 2>&1 || die "python3 is required for provider smoke"

    NIXMAC_E2E_PROVIDER_SCRIPT=$(mktemp "${TMPDIR:-/tmp}/nixmac-e2e-provider.XXXXXX.py") \
        || die "Failed to create provider script"
    NIXMAC_E2E_PROVIDER_PORT_FILE=$(mktemp "${TMPDIR:-/tmp}/nixmac-e2e-provider-port.XXXXXX") \
        || die "Failed to create provider port file"
    NIXMAC_E2E_PROVIDER_LOG=$(mktemp "${TMPDIR:-/tmp}/nixmac-e2e-provider-calls.XXXXXX.jsonl") \
        || die "Failed to create provider log"

    cat > "$NIXMAC_E2E_PROVIDER_SCRIPT" <<'PY'
#!/usr/bin/env python3
import json
import os
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT_FILE = os.environ["NIXMAC_E2E_PROVIDER_PORT_FILE"]
CALL_LOG = os.environ["NIXMAC_E2E_PROVIDER_LOG"]


def completion(content=None, tool_calls=None):
    message = {"role": "assistant"}
    if content is not None:
        message["content"] = content
    if tool_calls:
        message["tool_calls"] = tool_calls
        finish_reason = "tool_calls"
    else:
        finish_reason = "stop"
    return {
        "id": "chatcmpl-nixmac-e2e",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": "nixmac-e2e-provider",
        "choices": [{"index": 0, "message": message, "finish_reason": finish_reason}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
    }


def tool_call(call_id, name, args):
    return {
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(args)},
    }


def hashes_from_prompt(prompt):
    seen = []
    for value in re.findall(r"hash:\s*([a-f0-9]{8,64})", prompt, re.I):
        if value not in seen:
            seen.append(value)
    return seen


def content_for(body):
    messages = body.get("messages") or []
    prompt = "\n".join(str((message.get("content") or "")) for message in messages)

    if "conventional commit message" in prompt:
        return json.dumps({"message": "feat(e2e): add ripgrep package"})

    if "group new nix-darwin configuration changes" in prompt:
        hashes = hashes_from_prompt(prompt)
        return json.dumps({
            "changes": [
                {"hash": h, "group_id": None, "reason": "Standalone ripgrep package addition."}
                for h in hashes
            ]
        })

    if '"group":' in prompt and '"changes":' in prompt:
        hashes = hashes_from_prompt(prompt)
        return json.dumps({
            "changes": [
                {
                    "hash": h,
                    "title": "System Packages",
                    "description": "Adds ripgrep to environment.systemPackages.",
                }
                for h in hashes
            ],
            "group": {
                "title": "System Packages",
                "description": "Adds ripgrep to environment.systemPackages.",
            },
        })

    return json.dumps({
        "title": "System Packages",
        "description": "Adds ripgrep to environment.systemPackages.",
    })


def response_for(body):
    if body.get("tools"):
        calls = [
            tool_call(
                "call_think",
                "think",
                {
                    "category": "planning",
                    "thought": "Add ripgrep to the existing system packages list and verify with build_check.",
                },
            ),
            tool_call(
                "call_edit",
                "edit_file",
                {
                    "path": "flake.nix",
                    "search": "environment.systemPackages = with pkgs; [\n          ];",
                    "replace": "environment.systemPackages = with pkgs; [\n            ripgrep\n          ];",
                },
            ),
            tool_call("call_build", "build_check", {"show_trace": False}),
            tool_call(
                "call_done",
                "done",
                {"summary": "Added ripgrep to environment.systemPackages."},
            ),
        ]
        return completion("Calling tools to update and validate the config.", calls)

    return completion(content_for(body))


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("content-length", "0"))
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            body = {}

        with open(CALL_LOG, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({
                "ts": time.time(),
                "path": self.path,
                "body": body,
            }) + "\n")

        payload = json.dumps(response_for(body)).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args):
        return


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
with open(PORT_FILE, "w", encoding="utf-8") as fh:
    fh.write(str(server.server_address[1]))
server.serve_forever()
PY
    chmod +x "$NIXMAC_E2E_PROVIDER_SCRIPT"

    NIXMAC_E2E_PROVIDER_PORT_FILE="$NIXMAC_E2E_PROVIDER_PORT_FILE" \
    NIXMAC_E2E_PROVIDER_LOG="$NIXMAC_E2E_PROVIDER_LOG" \
        python3 "$NIXMAC_E2E_PROVIDER_SCRIPT" &
    NIXMAC_E2E_PROVIDER_PID=$!

    local elapsed=0
    while [ "$elapsed" -lt 20 ]; do
        if [ -s "$NIXMAC_E2E_PROVIDER_PORT_FILE" ]; then
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done

    die "Provider stub did not start"
}

scenario_seed_settings() {
    local settings_dir="$HOME/Library/Application Support/${NIXMAC_BUNDLE_ID}"
    local settings_path="$settings_dir/settings.json"
    local provider_port provider_base_url

    provider_port=$(cat "$NIXMAC_E2E_PROVIDER_PORT_FILE")
    provider_base_url="http://127.0.0.1:${provider_port}/v1"
    NIXMAC_E2E_COMPLETION_LOG_DIR=$(mktemp -d "${TMPDIR:-/tmp}/nixmac-e2e-completions.XXXXXX") \
        || die "Failed to create completion log dir"

    mkdir -p "$settings_dir" || die "Failed to create nixmac settings directory"
    jq -n \
        --arg configDir "$NIXMAC_E2E_CONFIG_REPO" \
        --arg hostAttr "$NIXMAC_E2E_HOST_ATTR" \
        --arg providerBaseUrl "$provider_base_url" \
        '{
            configDir: $configDir,
            hostAttr: $hostAttr,
            evolveProvider: "vllm",
            summaryProvider: "vllm",
            evolveModel: "nixmac-e2e-provider",
            summaryModel: "nixmac-e2e-provider",
            vllmApiBaseUrl: $providerBaseUrl,
            vllmApiKey: "e2e",
            maxIterations: 3,
            maxBuildAttempts: 1,
            sendDiagnostics: false,
            confirmBuild: false,
            confirmClear: true,
            confirmRollback: true
        }' > "$settings_path" || die "Failed to write nixmac settings"

    log "Seeded nixmac settings at $settings_path with provider $provider_base_url"
}

scenario_find_element() {
    local pattern="$1"
    local role="${2:-}"
    local timeout="${3:-30}"
    local elapsed=0
    local json element

    while [ "$elapsed" -lt "$timeout" ]; do
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
            printf '%s' "$json" > "$NIXMAC_E2E_ELEMENTS_JSON_FILE"
            printf '%s\n' "$element"
            return 0
        fi

        sleep 2
        elapsed=$((elapsed + 2))
    done

    return 1
}

scenario_click_element() {
    local pattern="$1"
    local role="${2:-}"
    local timeout="${3:-30}"
    local element json

    element=$(scenario_find_element "$pattern" "$role" "$timeout") || return 1
    json=$(cat "$NIXMAC_E2E_ELEMENTS_JSON_FILE" 2>/dev/null || true)
    [ -n "$json" ] || return 1
    log "Clicking element $element matching '$pattern'"
    peek_click "$element" "$json"
}

scenario_wait_for_text() {
    local pattern="$1"
    local timeout="${2:-30}"
    local elapsed=0 text

    while [ "$elapsed" -lt "$timeout" ]; do
        text=$(nixmac_text)
        if echo "$text" | grep -qiE "$pattern"; then
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done

    return 1
}

scenario_wait_for_prompt_value() {
    local expected="$1"
    local timeout="${2:-20}"
    local elapsed=0 json

    while [ "$elapsed" -lt "$timeout" ]; do
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
        elapsed=$((elapsed + 2))
    done

    return 1
}

scenario_provider_log_has() {
    local filter="$1"
    jq -e "$filter" "$NIXMAC_E2E_PROVIDER_LOG" >/dev/null 2>&1
}

scenario_wait_for_provider_log() {
    local filter="$1"
    local timeout="${2:-30}"
    local elapsed=0

    while [ "$elapsed" -lt "$timeout" ]; do
        if scenario_provider_log_has "$filter"; then
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done

    return 1
}

scenario_provider_request_count() {
    jq -s 'length' "$NIXMAC_E2E_PROVIDER_LOG" 2>/dev/null || echo 0
}

scenario_test() {
    phase "Prepare provider-backed macOS fixture"
    peekaboo_check
    scenario_create_config_repo
    scenario_start_provider
    nixmac_clear_state
    scenario_seed_settings
    export NIXMAC_E2E_MOCK_SYSTEM=1
    export NIXMAC_RECORD_COMPLETIONS=1
    export NIXMAC_COMPLETION_LOG_DIR="$NIXMAC_E2E_COMPLETION_LOG_DIR"
    launchctl setenv NIXMAC_E2E_MOCK_SYSTEM 1
    launchctl setenv NIXMAC_RECORD_COMPLETIONS 1
    launchctl setenv NIXMAC_COMPLETION_LOG_DIR "$NIXMAC_E2E_COMPLETION_LOG_DIR"
    phase_pass "Prepared config repo, deterministic HTTP provider, completion logging, and mock rebuild flag"

    phase "Launch nixmac app"
    nixmac_launch || die "App failed to launch"
    nixmac_screenshot "01-launched"
    phase_pass "App launched"

    phase "Submit descriptor into real prompt"
    if ! scenario_wait_for_text "Describe changes|configuration" 45; then
        nixmac_screenshot "missing-descriptor-prompt"
        die "Descriptor prompt screen did not become visible"
    fi
    scenario_click_element "evolve-prompt-input|Configuration change descriptor" "textField" \
        || die "Descriptor prompt input was not reachable by accessibility metadata"
    peek_hotkey "cmd+a" >/dev/null 2>&1 || true
    peek_type "$NIXMAC_E2E_DESCRIPTOR_TEXT" || die "Failed to type descriptor"
    scenario_wait_for_prompt_value "$NIXMAC_E2E_DESCRIPTOR_TEXT" 20 \
        || die "Typed descriptor was not visible in the prompt input"
    nixmac_screenshot "02-descriptor-typed"
    scenario_click_element "evolve-prompt-send|Submit configuration change descriptor" "" 20 \
        || die "Submit target was not reachable by accessibility metadata"
    phase_pass "Descriptor submitted"

    phase "Verify provider-driven evolution reaches Review"
    if ! scenario_wait_for_text "Evolution complete|What.s changed|Build & Test|Ready to test-drive" 120; then
        nixmac_screenshot "provider-evolution-did-not-complete"
        die "Provider-backed evolution did not reach review"
    fi
    if ! grep -q "ripgrep" "$NIXMAC_E2E_CONFIG_REPO/flake.nix"; then
        nixmac_screenshot "ripgrep-edit-missing"
        die "Provider tool call did not edit flake.nix"
    fi
    if ! scenario_provider_log_has 'select(.body.tools and (.body.tools | length > 0))'; then
        nixmac_screenshot "provider-tool-call-missing"
        die "Provider did not receive a tool-enabled evolve completion request"
    fi
    if ! scenario_provider_log_has 'select(.body.response_format.type == "json_object")'; then
        nixmac_screenshot "summary-provider-call-missing"
        die "Summary provider JSON request was not observed"
    fi
    nixmac_screenshot "03-review-provider-evolved"
    phase_pass "Provider calls observed and Review step reached"

    phase "Build and Test through mocked macOS activation"
    scenario_click_element "Build & Test" "button" 30 \
        || die "Build & Test button was not reachable"
    if ! scenario_wait_for_text "Commit Changes|All changes active|Save|Commit" 90; then
        nixmac_screenshot "commit-step-not-reached"
        die "Build & Test did not advance to Save/commit step"
    fi
    nixmac_screenshot "04-save-step-after-build"
    phase_pass "Build & Test advanced to Save step using explicit E2E mock activation"

    phase "Commit saved changes"
    if scenario_wait_for_provider_log 'select([.body.messages[]?.content? // ""] | join(" ") | test("conventional commit message"; "i"))' 10; then
        log "Observed commit-message provider request"
    else
        log "Commit-message provider request was not observed before manual commit; continuing after evolve and summary provider calls were verified"
    fi
    if scenario_find_element "Loading|feat\\(e2e\\)|commit" "textField" 10 >/dev/null; then
        scenario_click_element "Loading|feat\\(e2e\\)|commit" "textField" 10 || true
        peek_hotkey "cmd+a" >/dev/null 2>&1 || true
        peek_type "feat(e2e): add ripgrep package" || true
    fi
    scenario_click_element "^Commit$" "button" 30 \
        || die "Commit button was not reachable"
    if ! scenario_wait_for_text "Describe changes|What to change" 45; then
        nixmac_screenshot "begin-step-not-restored"
        die "Commit did not return to begin step"
    fi
    local latest_message
    latest_message=$(git -C "$NIXMAC_E2E_CONFIG_REPO" log -1 --pretty=%s)
    if [ "$latest_message" != "feat(e2e): add ripgrep package" ]; then
        nixmac_screenshot "unexpected-commit-message"
        die "Expected saved commit message, got: $latest_message"
    fi
    if [ -n "$(git -C "$NIXMAC_E2E_CONFIG_REPO" status --short)" ]; then
        nixmac_screenshot "repo-not-clean-after-commit"
        die "Config repo was not clean after commit"
    fi
    nixmac_screenshot "05-returned-to-describe"
    phase_pass "Save step committed changes and returned to Describe"

    phase "Audit provider evidence"
    local request_count
    request_count=$(scenario_provider_request_count)
    if [ "$request_count" -lt 3 ]; then
        die "Expected at least 3 provider requests, observed $request_count"
    fi
    log "Provider request log: $NIXMAC_E2E_PROVIDER_LOG"
    log "Completion log dir: $NIXMAC_E2E_COMPLETION_LOG_DIR"
    phase_pass "Observed $request_count provider HTTP requests across evolve and summary paths"
}

scenario_cleanup() {
    nixmac_quit
    launchctl unsetenv NIXMAC_E2E_MOCK_SYSTEM 2>/dev/null || true
    launchctl unsetenv NIXMAC_RECORD_COMPLETIONS 2>/dev/null || true
    launchctl unsetenv NIXMAC_COMPLETION_LOG_DIR 2>/dev/null || true
    if [ -n "$NIXMAC_E2E_PROVIDER_PID" ]; then
        kill "$NIXMAC_E2E_PROVIDER_PID" 2>/dev/null || true
    fi
    if [ -n "$NIXMAC_E2E_CONFIG_REPO" ]; then
        rm -rf "$NIXMAC_E2E_CONFIG_REPO" 2>/dev/null || true
    fi
    rm -f "$NIXMAC_E2E_ELEMENTS_JSON_FILE" "$NIXMAC_E2E_PROVIDER_SCRIPT" \
        "$NIXMAC_E2E_PROVIDER_PORT_FILE" "$NIXMAC_E2E_PROVIDER_LOG" 2>/dev/null || true
    if [ -n "$NIXMAC_E2E_COMPLETION_LOG_DIR" ]; then
        rm -rf "$NIXMAC_E2E_COMPLETION_LOG_DIR" 2>/dev/null || true
    fi
}
