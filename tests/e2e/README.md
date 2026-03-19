# E2E Test — Nix Installation Flow

Automated end-to-end test of the full Nix installation flow in the nixmac native app. Uses [Peekaboo](https://peekaboo.boo) for GUI automation over SSH, with ffmpeg screen recording.

## What it tests

1. Launch nixmac app on a clean macOS machine (no Nix installed)
2. Click "Install Nix" button via GUI automation
3. App downloads the Determinate Nix `.pkg` and opens macOS Installer.app
4. Nix is installed via CLI (`sudo installer -pkg`)
5. App detects Nix and begins darwin-rebuild prefetch
6. Prefetch completes → app shows "Welcome to nixmac" setup wizard
7. Verifies `nix --version` and darwin-rebuild availability
8. Cleans up (uninstalls Nix for repeatable runs)

## Architecture

```
┌──────────────┐     SSH      ┌──────────────────────────────┐
│  GitHub       │────────────▶│  macOS Test Runner            │
│  Actions      │             │  (MacInCloud / Tart VM)       │
│               │             │                               │
│  ci-runner.sh │             │  ┌─────────┐  ┌───────────┐  │
│               │             │  │ nixmac  │  │ Peekaboo  │  │
│               │             │  │  .app   │◀─│  Bridge    │  │
│               │             │  └─────────┘  └───────────┘  │
│               │             │                               │
│               │             │  ffmpeg (AVFoundation)        │
│               │             │  → screen recording           │
└──────────────┘             └──────────────────────────────┘
```

- **Peekaboo Bridge**: Peekaboo.app runs on the Mac and holds Screen Recording + Accessibility permissions. The CLI connects via a local Unix socket, allowing SSH sessions to automate the GUI.
- **ffmpeg AVFoundation**: Records the screen via `open -a Terminal` (inherits Terminal.app's Screen Recording permission).
- **CLI install bypass**: The macOS Installer password dialog (SecurityAgent) can't be automated via Accessibility APIs, so we kill the GUI installer and run `sudo installer -pkg ... -target /` instead. The app only cares that Nix appears on the system.

## Runner setup (one-time)

### Prerequisites

- Dedicated macOS machine (Apple Silicon, macOS 15+)
- SSH access with passwordless sudo
- GUI session active (for Peekaboo Bridge + screen recording)

### Provision the runner

```bash
ssh admin@<host>

# Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
eval "$(/opt/homebrew/bin/brew shellenv zsh)"

# Install tools
brew install steipete/tap/peekaboo gh ffmpeg

# Install Peekaboo.app (Bridge host)
curl -L -o /tmp/Peekaboo.app.zip \
  "https://github.com/steipete/Peekaboo/releases/latest/download/Peekaboo.app.zip"
sudo unzip -o /tmp/Peekaboo.app.zip -d /Applications/

# Launch Peekaboo.app and grant permissions:
#   System Settings → Privacy & Security → Screen Recording → Peekaboo ✓
#   System Settings → Privacy & Security → Accessibility → Peekaboo ✓
open /Applications/Peekaboo.app

# Set up passwordless sudo
sudo sh -c 'echo "admin ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/admin && chmod 440 /etc/sudoers.d/admin'

# Authenticate GitHub CLI
gh auth login
```

Or use the setup script:

```bash
./setup-runner.sh --branch <branch-name>
```

### Verify

```bash
peekaboo bridge status          # Should show "remote gui via ..."
peekaboo permissions             # Screen Recording: Granted, Accessibility: Granted
sudo -n whoami                   # Should print "root" (no password)
```

## Running manually

```bash
ADMIN_PASSWORD=<pw> ./run-e2e.sh

# Or from your local machine via SSH
ssh admin@<host> 'cd /path/to/tests/e2e && ADMIN_PASSWORD=<pw> bash run-e2e.sh'
```

### Options

| Command | Description |
|---------|-------------|
| `./run-e2e.sh` | Full test run |
| `./run-e2e.sh --cleanup-only` | Just uninstall Nix and quit the app |
| `CLEANUP_ON_SUCCESS=0 ./run-e2e.sh` | Don't cleanup after success (inspect state) |

### Outputs

| Artifact | Path |
|----------|------|
| Screen recording | `/tmp/e2e-recording.mp4` |
| Screenshots | `/tmp/e2e-screenshots/` |
| Test log | `/tmp/e2e-test.log` |

## CI

The workflow (`.github/workflows/e2e-nix-install.yml`) triggers on PRs that modify `apps/native/src-tauri/**` or `tests/e2e/**`, plus manual dispatch.

### Required secrets

| Secret | Description |
|--------|-------------|
| `MAC_E2E_HOST` | Runner IP/hostname |
| `MAC_E2E_USER` | SSH username |
| `MAC_E2E_SSH_KEY` | SSH private key |
| `MAC_E2E_ADMIN_PW` | macOS admin password |

## Limitations

- Requires a persistent macOS GUI session (screen recording and Peekaboo Bridge need it)
- One test at a time per runner (shared system state)
- SecurityAgent can't be GUI-automated; uses CLI installer bypass
- Runner needs Peekaboo.app running before tests start
