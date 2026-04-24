# macos-e2e

GUI test framework for macOS apps. Uses [Peekaboo](https://peekaboo.boo) for accessibility-based automation over SSH, with ffmpeg screen recording.

> Built for [nixmac](https://github.com/darkmatter/nixmac), designed to be extracted as a standalone tool.

## Quick start

```bash
# Run the Nix install flow test
./run.sh nix-install

# List available scenarios
./run.sh --list

# Run without recording
./run.sh nix-install --no-record

# Keep Nix installed after test (inspect state)
./run.sh nix-install --no-cleanup

# Verbose + JSON output
./run.sh nix-install --verbose --json
```

## Architecture

```
tests/e2e/
├── run.sh                  # CLI entry point
├── ci-runner.sh            # GitHub Actions SSH entry point
├── setup-runner.sh         # One-time runner provisioning
├── lib/
│   ├── core.sh             # Logging, assertions, phases, results
│   ├── peekaboo.sh         # GUI automation (click, type, wait, screenshot)
│   ├── recording.sh        # ffmpeg AVFoundation screen capture
│   ├── app.sh              # App lifecycle (launch, quit, pkg install)
│   ├── runner.sh           # Test orchestration (lock, source, cleanup)
│   └── API.md              # Full API reference
├── adapters/
│   └── nixmac.sh           # nixmac-specific helpers (Nix, app flow)
├── fixtures/
│   ├── clean-machine.sh    # Nix uninstalled, app not running
│   └── nix-installed.sh    # Nix present, app through setup
└── scenarios/
    ├── install_nix_clean_machine.sh             # Full install flow test
    ├── nix-install.sh                           # Legacy alias for install flow
    └── release_dmg_app_translocation_smoke.sh   # Installed app launch smoke
```

### How it works

```
┌──────────┐    SSH     ┌─────────────────────────────────┐
│ CI / You │───────────▶│  macOS Test Runner               │
│          │            │                                   │
│ run.sh   │            │  ┌────────┐   ┌──────────────┐  │
│ scenario │            │  │ App    │◀──│ Peekaboo     │  │
│          │            │  │ Under  │   │ Bridge       │  │
│          │            │  │ Test   │   │ (GUI proxy)  │  │
│          │            │  └────────┘   └──────────────┘  │
│          │            │                                   │
│          │            │  ffmpeg (AVFoundation)            │
│          │            │  → screen recording               │
└──────────┘            └─────────────────────────────────┘
```

- **Peekaboo Bridge**: Desktop app holds Screen Recording + Accessibility TCC grants. CLI connects via Unix socket, allowing SSH sessions to drive the GUI.
- **ffmpeg**: Records via `open -a Terminal` (inherits Terminal.app's Screen Recording permission).
- **Adapters**: App-specific logic lives in `adapters/`. The core framework is app-agnostic.
- **Fixtures**: Reusable precondition states. Scenarios declare which fixture they need.

## Writing a new scenario

```bash
#!/bin/bash
# scenarios/my-feature.sh
# Scenario: Test my feature does the thing

E2E_ADAPTER="nixmac"          # Load nixmac helpers
E2E_FIXTURE="nix-installed"   # Start with Nix already installed

scenario_test() {
    phase "Navigate to settings"
    nixmac_click_button "Settings"
    nixmac_screenshot "settings-page"
    phase_pass "Settings page loaded"

    phase "Verify feature toggle"
    nixmac_wait_for_text "My Feature" --timeout 10
    assert_contains "Feature visible" "$(nixmac_text)" "My Feature"
    phase_pass "Feature toggle present"
}
```

See `lib/API.md` for the full API reference.

## Writing an adapter (for other apps)

Create `adapters/<appname>.sh`:

```bash
#!/bin/bash
MY_APP_NAME="myapp"
MY_APP_PATH="/Applications/MyApp.app"

myapp_launch() { app_launch "$MY_APP_PATH" "$MY_APP_NAME"; }
myapp_quit()   { app_quit "$MY_APP_NAME"; }
myapp_text()   { peek_text "$MY_APP_NAME"; }
# ... app-specific helpers

adapter_cleanup() {
    myapp_quit
}
```

Then reference it in your scenario: `E2E_ADAPTER="myapp"`

## Runner setup (one-time)

### Prerequisites

- macOS machine (Apple Silicon, macOS 15+)
- SSH access with passwordless sudo
- GUI session active (Peekaboo + screen recording need it)

### Provision

```bash
# Install tools
brew install steipete/tap/peekaboo gh ffmpeg

# Install Peekaboo.app and grant permissions:
#   System Settings → Privacy & Security → Screen Recording → Peekaboo ✓
#   System Settings → Privacy & Security → Accessibility → Peekaboo ✓
#   System Settings → Privacy & Security → Screen Recording → Terminal ✓
curl -L -o /tmp/Peekaboo.app.zip \
  "https://github.com/steipete/Peekaboo/releases/latest/download/Peekaboo.app.zip"
sudo unzip -o /tmp/Peekaboo.app.zip -d /Applications/
open /Applications/Peekaboo.app

# Passwordless sudo
sudo sh -c 'echo "$(whoami) ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/e2e && chmod 440 /etc/sudoers.d/e2e'
```

Or use: `./setup-runner.sh --branch <branch>`

### Verify

```bash
peekaboo bridge status         # "remote gui via ..."
peekaboo permissions           # Screen Recording: Granted, Accessibility: Granted
sudo -n whoami                 # "root"
```

## CI

The workflow (`.github/workflows/e2e.yml`) resolves required scenarios from PR labels and changed paths.

### Manual workflow validation

Use `workflow_dispatch` on the feature branch to validate the gate without opening
or editing a validation PR:

```bash
gh workflow run "nixmac E2E Gate" \
  --ref <feature-branch> \
  -f scenario=all \
  -f pr_side_effects=skip
```

That run publishes a workflow summary preview plus run-scoped report/video links
under `e2e/manual/<run-id>/<head-sha>`.

To test PR-aware scenario selection without changing the PR comment/check/status,
pass a PR number and keep side effects skipped:

```bash
gh workflow run "nixmac E2E Gate" \
  --ref <feature-branch> \
  -f scenario=pr \
  -f pr_number=<pr-number> \
  -f pr_side_effects=skip
```

That publishes preview links under
`e2e/pr-preview/pr-<pr-number>/<run-id>/<head-sha>` so it does not overwrite the
links shown in the live PR comment.

Use `pr_side_effects=auto` only when the run should update the sticky PR comment,
the `nixmac E2E Report` check, and the `nixmac/e2e` commit status.

### Secrets

Full-Mac CI uses direct GitHub Secrets for the remote runner. `SOPS_AGE_KEY` is still required by shared workflow setup.

| Secret                   | Description                                                |
| ------------------------ | ---------------------------------------------------------- |
| `MAC_E2E_HOST`           | Remote macOS runner host or IP address                     |
| `MAC_E2E_USER`           | SSH user for the remote macOS runner                       |
| `MAC_E2E_SSH_KEY`        | Private SSH key with access to the remote macOS runner     |
| `MAC_E2E_ADMIN_PASSWORD` | Admin password used by install/uninstall flows when needed |
| `SOPS_AGE_KEY`           | age private key to decrypt `ops/secrets/secrets.yaml`      |

### Outputs

| Artifact         | Path                         |
| ---------------- | ---------------------------- |
| Screen recording | `/tmp/e2e-recording.mp4`     |
| Screenshots      | `/tmp/e2e-screenshots/`      |
| Test log         | `/tmp/e2e-test.log`          |
| JSON results     | `/tmp/e2e-test-results.json` |


## Limitations

- Requires persistent GUI session on the runner
- One test at a time per machine (file-based lock)
- SecurityAgent can't be automated → uses CLI `.pkg` install bypass
- Peekaboo.app must be running before tests start
