# nixmac

A Tauri-based macOS desktop app that brings a friendly UI to [nix-darwin](https://github.com/LnL7/nix-darwin) — install packages, tweak system settings, and manage your configuration with natural-language prompts backed by an AI provider of your choice.

Apple Silicon only.

## Install

Download the latest signed DMG from [Releases](https://github.com/darkmatter/nixmac/releases) and drag `nixmac.app` into `/Applications`. The app will walk you through installing Nix, setting up your configuration directory, and granting the macOS permissions it needs.

## Local development

Prerequisites: [Bun](https://bun.sh) 1.3+, Rust (via [rustup](https://rustup.rs)), and Xcode command-line tools.

```bash
bun install
bun -F native desktop:dev   # Tauri dev server with hot reload
```

Other useful scripts:

```bash
bun -F native dev            # Vite dev server only (browser preview)
bun -F native desktop:build  # Production Tauri build
bun -F native test           # Vitest suite
bun -F native lint           # Oxlint
```

### Nix / devenv shell

A [devenv](https://devenv.sh) shell is provided for a reproducible toolchain:

```bash
devenv shell
```

## Repository layout

```
apps/native/             Tauri app (React + Rust)
  src/                   Frontend (React 19, Tailwind, Radix, Zustand)
  src-tauri/             Rust backend (Tauri 2, nix-darwin integration)
  templates/             Bundled nix-darwin starter configs copied on first run
.github/workflows/       Signed/notarized DMG build + R2 upload for the updater
ops/secrets/             SOPS-encrypted secrets (decrypted in CI via SOPS_AGE_KEY)
```

## Contributing

Issues and pull requests welcome. Please:

1. Run `bun -F native lint` and `bun -F native test` before opening a PR.
2. Format with `npx ultracite fix` (Biome-based).
3. Keep commits focused — the main branch is protected and releases are cut from tags.

## License

[MIT](./LICENSE)
