# macos-e2e — API Reference

## Writing a Scenario

Create a file in `scenarios/<name>.sh`:

```bash
#!/bin/bash
# Scenario: <one-line description>
# <detailed description of what this tests>

E2E_ADAPTER="nixmac"          # Which app adapter to load (adapters/<name>.sh)
E2E_FIXTURE="clean-machine"   # Precondition fixture (fixtures/<name>.sh)

scenario_test() {
    # Your test logic here
    phase "Step name"
    # ... do stuff ...
    phase_pass "Step name"
}

scenario_cleanup() {
    # Optional: extra cleanup beyond adapter_cleanup
    :
}
```

## Core API (`lib/core.sh`)

### Logging

| Function | Description |
|----------|-------------|
| `log "message"` | Timestamped info log |
| `debug "message"` | Only shown when `E2E_VERBOSE=1` |
| `warn "message"` | Yellow warning |
| `pass "message"` | Green pass (increments pass count) |
| `fail "message"` | Red fail (increments fail count) |
| `die "message"` | Fail + screenshot + exit |

### Phases

| Function | Description |
|----------|-------------|
| `phase "name"` | Start a new numbered phase |
| `phase_pass "msg"` | Record phase as passed |
| `phase_fail "msg"` | Record phase as failed |

### Assertions

| Function | Signature | Description |
|----------|-----------|-------------|
| `assert_true` | `"desc" command args...` | Pass if command exits 0 |
| `assert_equals` | `"desc" expected actual` | Pass if strings equal |
| `assert_contains` | `"desc" haystack needle` | Pass if haystack contains needle (case-insensitive) |
| `assert_not_contains` | `"desc" haystack needle` | Pass if haystack does NOT contain needle |
| `assert_file_exists` | `path ["desc"]` | Pass if file exists |
| `assert_command` | `"desc" command args...` | Pass if command exits 0, prints stdout |

### Results

| Function | Description |
|----------|-------------|
| `print_results` | Print phase results table |
| `results_json` | Return JSON summary (for CI) |

## Peekaboo API (`lib/peekaboo.sh`)

### Low-level

| Function | Description |
|----------|-------------|
| `peek_elements [app]` | Get all UI elements as JSON |
| `peek_snapshot_id json` | Extract snapshot ID from JSON |
| `peek_find_button json "pattern"` | Find button by label regex |
| `peek_find_element json "role" "pattern"` | Find any element by role + label |
| `peek_click element_id json` | Click element using snapshot |
| `peek_type "text"` | Type text via keyboard |
| `peek_key "combo"` | Press key combo (e.g., `command+q`) |
| `peek_text [app]` | Get all visible text from app UI |

### High-level

| Function | Signature | Description |
|----------|-----------|-------------|
| `screenshot` | `"name" [app]` | Take annotated screenshot |
| `wait_for_text` | `"pattern" [--app name] [--timeout 60] [--interval 3]` | Wait for text to appear |
| `wait_for_button` | `"pattern" [--app name] [--timeout 60]` | Wait for button, returns element ID |
| `click_button` | `"pattern" [--app name] [--timeout 30]` | Find and click a button |
| `dismiss_dialogs` | `[max_attempts]` | Dismiss Allow/OK/Continue system dialogs |
| `peekaboo_check` | | Verify Bridge + permissions |

## App API (`lib/app.sh`)

| Function | Signature | Description |
|----------|-----------|-------------|
| `app_launch` | `path [name] [wait_secs]` | Open app, verify process |
| `app_quit` | `name` | Graceful quit via Peekaboo, fallback kill |
| `app_is_running` | `name` | Check if process exists |
| `app_wait_for_process` | `name [timeout]` | Wait for process to appear |
| `app_wait_for_exit` | `name [timeout]` | Wait for process to disappear |
| `pkg_install` | `path [target]` | Install .pkg via `sudo installer` |
| `pkg_find` | `"pattern"` | Search for .pkg in temp dirs |
| `installer_kill` | | Kill macOS Installer.app |

## Recording API (`lib/recording.sh`)

| Function | Signature | Description |
|----------|-----------|-------------|
| `start_recording` | `[output] [fps] [max_duration]` | Start ffmpeg screen recording; defaults to `E2E_RECORD_FPS` or 20 fps |
| `stop_recording` | `[output]` | Stop recording, log file size |

## nixmac Adapter (`adapters/nixmac.sh`)

### Nix Helpers

| Function | Description |
|----------|-------------|
| `nix_is_installed` | Check if Nix binary exists and works |
| `nix_version` | Get `nix --version` output |
| `nix_uninstall` | Run `nix-installer uninstall --no-confirm` |
| `nix_ensure_clean` | Uninstall Nix if present |
| `nix_verify` | Assert Nix binary works |
| `nix_wait_for_binary [timeout]` | Poll until Nix binary appears |

### App Helpers

| Function | Description |
|----------|-------------|
| `nixmac_launch [wait]` | Launch nixmac.app |
| `nixmac_quit` | Quit nixmac |
| `nixmac_text` | Get all visible text |
| `nixmac_screenshot "name"` | Screenshot of nixmac window |
| `nixmac_click_button "pattern"` | Click button in nixmac |
| `nixmac_wait_for_text "pattern"` | Wait for text in nixmac |
| `nixmac_wait_for_button "pattern"` | Wait for button in nixmac |

### Flow Helpers

| Function | Description |
|----------|-------------|
| `nixmac_wait_for_install_screen [timeout]` | Wait for Install Nix button |
| `nixmac_click_install` | Dismiss dialogs + click Install |
| `nixmac_wait_for_download [timeout]` | Wait for Installer.app (download done) |
| `nixmac_handle_pkg_install` | Kill GUI installer, run CLI install |
| `nixmac_wait_for_detection [timeout]` | Wait for app to detect Nix |
| `nixmac_wait_for_prefetch [timeout]` | Wait for darwin-rebuild prefetch |

## Available Fixtures

| Fixture | Description | Preconditions |
|---------|-------------|---------------|
| `clean-machine` | Nix uninstalled, app not running | Peekaboo OK, app at path |
| `nix-installed` | Nix present, app through setup | Runs install flow if needed |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `E2E_RECORD` | `1` | Enable screen recording |
| `E2E_RECORD_FPS` | `20` | Full-Mac ffmpeg recording frame rate |
| `E2E_CLEANUP_NIX` | `1` | Uninstall Nix after test |
| `E2E_VERBOSE` | `0` | Debug logging |
| `E2E_JSON` | `0` | Write JSON results file |
| `E2E_SCREENSHOT_DIR` | `/tmp/e2e-screenshots` | Screenshot output |
| `E2E_LOG_FILE` | `/tmp/e2e-test.log` | Log file path |
| `E2E_VIDEO_FILE` | `/tmp/e2e-recording.mp4` | Video output path |
| `NIXMAC_APP_PATH` | `/Applications/nixmac.app` | App location |
