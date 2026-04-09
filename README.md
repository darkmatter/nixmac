<p align="center">
  <img src="apps/web/public/favicon.svg" width="80" alt="nixmac">
</p>

<h1 align="center">nixmac</h1>

<p align="center">
  An AI-powered macOS configuration manager built on nix-darwin.<br>
  Describe what you want in plain English. nixmac evolves your Nix config, builds it, and applies it.
</p>

<p align="center">
  <a href="https://github.com/darkmatter/nixmac/releases/latest"><img src="https://img.shields.io/github/v/release/darkmatter/nixmac" alt="Latest Release"></a>
  <a href="https://github.com/darkmatter/nixmac/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License"></a>
</p>

---

## What is nixmac?

nixmac is a native macOS app (Tauri + Rust) that puts an AI agent in front of your [nix-darwin](https://github.com/LnL7/nix-darwin) configuration. Instead of hand-editing `.nix` files, you chat with nixmac:

> "Install Tailscale and make it start at login"

The agent reads your config, plans the changes, edits the Nix files, builds the system, and applies it — all while you watch. If something breaks, roll back in one click.

### Key Features

- **Natural-language config evolution** — an agentic loop with tool use (read, edit, search) that iterates until your system matches the prompt
- **Multi-provider AI** — OpenAI/OpenRouter (default), Ollama for fully local operation
- **Tool-augmented agent** — `read_file`, `write_file`, `search_packages`, `search_docs`, `search_code` tools give the model deep context about nix-darwin options and nixpkgs
- **Chat memory** — session context persists across turns for multi-step conversations
- **Smart summarization** — every changeset and commit gets an AI-generated summary with token-budgeted batching
- **Git-native history** — every evolution creates a branch, every apply is a commit; full diff-based change tracking
- **One-click rollback** — revert to any previous system generation
- **Secret scanning** — detects accidentally committed API keys and credentials
- **Sentry integration** — opt-in crash reporting with automatic PII scrubbing
- **CLI + GUI** — use the menu bar app or `nixmac evolve "..."` from the terminal
- **Eval suite** — reproducible benchmarks for measuring agent accuracy across models

## Architecture

```
nixmac/
├── apps/
│   ├── native/        # Tauri + Rust desktop app (core agent, tools, git, nix)
│   ├── web/           # React + TanStack Router frontend (dashboard, onboarding)
│   ├── server/        # Hono + tRPC API server
│   ├── fumadocs/      # Documentation site (Next.js / Fumadocs)
│   └── eval/          # Python eval harness for model benchmarking
├── packages/
│   ├── api/           # Shared business logic
│   ├── auth/          # Better-Auth configuration
│   ├── db/            # Drizzle ORM + PostgreSQL schema
│   ├── ui/            # Shared UI components
│   ├── config/        # Shared config utilities
│   ├── env/           # Environment variable validation
│   ├── hono-api/      # Hono middleware and API helpers
│   └── znv/           # Zod + env parsing
```

### The Evolution Loop

1. **User prompt** → agent receives the request
2. **Tool use** → agent reads config files, searches nix-darwin docs, searches nixpkgs
3. **Edit** → agent writes changes via semantic file edits
4. **Build** → `darwin-rebuild build` validates the configuration
5. **Iterate** → if the build fails, agent reads errors and tries again (up to N iterations)
6. **Apply** → `darwin-rebuild switch` activates the new system generation
7. **Summarize** → changeset and commit get AI-generated descriptions

## Getting Started

### Prerequisites

- macOS (Apple Silicon or Intel)
- [Nix](https://nixos.org/download.html) with flakes enabled ([Determinate Nix Installer](https://github.com/DeterminateSystems/nix-installer) recommended)
- [devenv](https://devenv.sh/) — `nix profile add github:cachix/devenv/latest`
- A nix-darwin flake at `~/.darwin` (see [Setup Guide](#setting-up-nix-darwin) below)

### Install from Release

Download the latest `.dmg` from [Releases](https://github.com/darkmatter/nixmac/releases/latest).

### Build from Source

```bash
git clone https://github.com/darkmatter/nixmac.git
cd nixmac
devenv shell
bun install
cd apps/native && bun run tauri build --bundles app
```

### Development

```bash
devenv shell
bun install

# Start everything (web + server + native app in dev mode)
devenv up

# Or start individual pieces
bun run dev:web        # React frontend at http://localhost:3001
bun run dev:server     # API server at http://localhost:3000
bun run dev:native     # Tauri desktop app
```

### Setting Up nix-darwin

If you don't already have a nix-darwin configuration:

```bash
mkdir -p ~/.darwin && cd ~/.darwin
git init
```

Copy one of the included templates:

| Template | Description |
|----------|-------------|
| [`nix-darwin-determinate`](apps/native/templates/nix-darwin-determinate) | Minimal nix-darwin for Determinate Nix |
| [`nixos-unified`](apps/native/templates/nixos-unified) | Cross-platform (macOS + NixOS) |
| [`minimal`](apps/native/templates/minimal) | Bare-bones starting point |

Then activate:

```bash
sudo cp /etc/{bashrc,zshrc,zshenv} /etc/{bashrc,zshrc,zshenv}.before-nix-darwin
sudo -i nix run nix-darwin/master#darwin-rebuild -- switch --flake ~/.darwin#$HOSTNAME
```

> **Determinate Nix note:** `darwin-rebuild` isn't installed globally. Run it via `sudo -i nix run nix-darwin/master#darwin-rebuild`.

## AI Configuration

nixmac uses separate models for **evolution** (config changes via tool use) and **summarization** (commit messages, UI labels).

| Variable | Default | Description |
|----------|---------|-------------|
| `EVOLVE_PROVIDER` | `openai` | `openai`, `openrouter`, or `ollama` |
| `EVOLVE_MODEL` | `anthropic/claude-sonnet-4` | Model for config evolution |
| `SUMMARY_AI_PROVIDER` | `openai` | Provider for summarization |
| `SUMMARY_MODEL` | `openai/gpt-4o-mini` | Model for summaries |
| `OLLAMA_API_BASE` | `http://localhost:11434` | Ollama endpoint |

For fully local operation: `EVOLVE_PROVIDER=ollama SUMMARY_AI_PROVIDER=ollama devenv up`

> **Note:** Models under ~70B parameters tend to struggle with the multi-tool evolution workflow.

## CLI

```bash
# Basic evolution
nixmac evolve "install ripgrep and fd"

# With options
nixmac evolve "enable Touch ID for sudo" \
  --config ~/.darwin \
  --max-iterations 10 \
  --evolve-provider ollama \
  --evolve-model qwen3-coder:30b

# Dump results to JSON
nixmac evolve "add Homebrew casks for Firefox and 1Password" --out result.json
```

## Eval Suite

The `apps/eval/` directory contains a reproducible benchmark harness for measuring evolution accuracy across models and providers, including support for vLLM and Ollama backends.

```bash
cd apps/eval
uv sync
python run_evals.py --provider ollama --model qwen3-coder:30b
python calc_stats.py
```

## Deployment

The web app deploys via [Alchemy](https://alchemy.run):

```bash
cd apps/web && bun run deploy    # deploy
cd apps/web && bun run destroy   # tear down
```

## Releases

Tagged commits trigger CI to produce signed `.dmg` builds:

```bash
npx release-it   # interactive version bump + tag + GitHub release
```

## Database

nixmac uses PostgreSQL with Drizzle ORM for the web app and server:

```bash
bun run db:push      # apply schema
bun run db:studio    # open Drizzle Studio
bun run db:generate  # generate migrations
```

## Logs

- **darwin-rebuild logs:** `~/Library/Logs/nixmac/`
- **App logs:** stdout/stderr (or set `NIXMAC_LOGFILE` for file output)

```bash
# Merged tail of everything
tail -F ${NIXMAC_LOGFILE} ~/Library/Logs/nixmac/*
```

## License

MIT
