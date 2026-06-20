# macos-e2e

GUI test framework for macOS apps. Uses [Peekaboo](https://peekaboo.boo) for accessibility-based automation over SSH, with ffmpeg screen recording.

> Built for [nixmac](https://github.com/darkmatter/nixmac), designed to be extracted as a standalone tool.

## Quick start

```bash
# Run the Nix install flow test
./run.sh nix-install

# Run the non-destructive descriptor prompt smoke test
./run.sh macos_descriptor_prompt_smoke --no-cleanup

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
├── computer-use/           # Computer Use E2E runners, reports, and fixtures
├── lib/
│   ├── core.sh             # Logging, assertions, phases, results
│   ├── peekaboo.sh         # GUI automation (click, type, wait, screenshot)
│   ├── recording.sh        # ffmpeg AVFoundation screen capture
│   ├── app.sh              # App lifecycle (launch, quit, pkg install)
│   ├── runner.sh           # Test orchestration (lock, source, cleanup)
│   ├── report.sh           # Structured E2E report writer
│   └── API.md              # Full API reference
├── adapters/
│   └── nixmac.sh           # nixmac-specific helpers (Nix, app flow)
├── fixtures/
│   ├── clean-machine.sh    # Nix uninstalled, app not running
│   └── nix-installed.sh    # Nix present, app through setup
└── scenarios/
    ├── nix-install.sh                       # Full install flow test
    ├── macos_descriptor_prompt_smoke.sh     # Fast local descriptor proof
    └── macos_provider_evolve_full_smoke.sh  # Provider-backed local proof
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

## Product Proof Smoke

`macos_descriptor_prompt_smoke` is the safe inner-loop scenario used by
`tests/e2e/computer-use/run-local.mjs run-peekaboo`. It launches the real app,
drives the descriptor prompt through Peekaboo accessibility metadata, captures
screenshots/video/logs, and does not install, uninstall, build, save, discard,
or mutate system Nix state. It does write temporary nixmac settings; the
`run-peekaboo` bridge backs up and restores Application Support around the run.

`macos_provider_evolve_full_smoke` is the stronger local proof. It owns a local
OpenAI-compatible provider stub, applies a tool-driven config edit, mocks only
host rebuild/activation, and continues through the Save step.

`nix-install` remains the full-system install scenario. It can uninstall and
reinstall Nix and should run only on a disposable runner.

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

The workflow (`.github/workflows/e2e-nix-install.yml`) triggers on PRs modifying `apps/native/src-tauri/**` or `tests/e2e/**`.

### Secrets (via SOPS)

Only one GitHub Secret needed:

| Secret | Description |
|--------|-------------|
| `SOPS_AGE_KEY` | age private key to decrypt `ops/secrets/e2e.enc.yaml` |

### Outputs

| Artifact | Path |
|----------|------|
| Screen recording | `/tmp/e2e-recording.mp4` |
| Screenshots | `/tmp/e2e-screenshots/` |
| Test log | `/tmp/e2e-test.log` |
| JSON results | `/tmp/e2e-test-results.json` |

## Limitations

- Requires persistent GUI session on the runner
- One test at a time per machine (file-based lock)
- SecurityAgent can't be automated → uses CLI `.pkg` install bypass
- Peekaboo.app must be running before tests start
