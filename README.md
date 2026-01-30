# nixmac

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines React, TanStack Router, Hono, TRPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **TanStack Router** - File-based routing with full type safety
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **shadcn/ui** - Reusable UI components
- **Hono** - Lightweight, performant server framework
- **tRPC** - End-to-end type-safe APIs
- **Bun** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth
- **Biome** - Linting and formatting
- **Starlight** - Documentation site with Astro
- **Tauri** - Build native desktop applications
- **Turborepo** - Optimized monorepo build system

## Getting Started

### Install nix

Recommendation: Use [Determinate](https://docs.determinate.systems/).

```sh
nix --version
nix-store --version
```

### Install devenv

```sh
nix profile add github:cachix/devenv/latest
devenv --version
```

### Install the dependencies in the shell:

```bash
devenv shell
bun install
```

### Install and Use nix-darwin

By default, nixmac expects to find a flake-enabled nix configuration at `~/.darwin`. Here is how you can create a minimalist one if you don't already have such a thing *assuming you are using Determinate* since non-Determinate steps will be slightly different:

1. `cd ~ && mkdir ./darwin`
1. `git init`.
   1. Add `result` to `.gitignore`.
1. Copy a `flake.nix` to `~/.darwin`, you can find a basic one [here](./apps/native/templates/nix-darwin-determinate/flake.nix).
1. This nix setup is going to take over management of your shell files in `/etc` and you need to back them up first or else the following command will fail:
   1. `sudo cp /etc/bashrc /etc/bashrc.before-nix-darwin`
   1. `sudo cp /etc/zshrc /etc/zshrc.before-nix-darwin`
   1. `sudo cp /etc/zshenv /etc/zshenv.before-nix-darwin`
1. `sudo -i nix run nix-darwin/master#darwin-rebuild -- switch --flake ~/.darwin#$HOSTNAME`
1. Verify it "worked":
   1. `ls -l /nix/var/nix/profiles/system` should point to system link.
   1. `sudo -i nix run nix-darwin/master#darwin-rebuild --version` should return something, namely "Determinate Nix" if you're using Determinate.
1. **NOTE**: Determinate does not install `darwin-rebuild` globally to the Mac system path. So to do the usual workflow to update your system after making flake changes, execute it with:
   1. `sudo -i nix run nix-darwin/master#darwin-rebuild`

### Run apps

```sh
export SOPS_AGE_KEY={your_sops_key} devenv up
```

or add `your_sops_key` to `~/.config/sops/age/keys.txt`
Key doesn't have to be formatted a certain way (just the key on its own line somewhere)

## AI Setup

We have a pluggable "provider" design for AI models. Currently we have the following implementations:

- OpenAI / OpenRouter (default)
- Ollama

NOTE: By default, we use OpenAI with *anthropic/claude-sonnet-4* for configuration evolution and *openai/gpt-4o-mini* for summarization, and OpenRouter at https://openrouter.ai/api/v1.

### Configuration

We allow you to set the "summarize" (for commit and UI messages) and "evolve" messages separately, primarily because evolving your nix config is implemented as a "tool" and a lot of otherwise-good models don't do tools particularly well.

Environment variables:

- `SUMMARY_AI_PROVIDER` (default = openai)
- `EVOLVE_PROVIDER` (default = openai)

#### OpenAI Configuration:

- `SUMMARY_MODEL` (default = "openai/gpt-4o-mini")
- `EVOLVE_MODEL` (default = "anthropic/claude-sonnet-4")

#### Ollama Configuration:

Quick dev: `SUMMARY_AI_PROVIDER=ollama EVOLVE_PROVIDER=ollama devenv up`

Environment variables:

- `OLLAMA_API_BASE` (default = "http://localhost:11434")
- `SUMMARY_MODEL` (default = "llama3.1")
- `EVOLVE_MODEL` (default = "qwen2.5-coder:7b")

**IMPORTANT NOTE**: Empirically, models under 70B parameters don't seem to do well with the Nix "evolve" tool workflow, either losing tool context and exiting or (if you're lucky) making suboptimal changes.

## Database Setup

This project uses PostgreSQL with Drizzle ORM.

1. Make sure you have a PostgreSQL database set up.

1. Update your `apps/server/.env` and `apps/web/.env` files with your PostgreSQL connection details as `DATABASE_URL`.

1. Apply the schema to your database:

```bash
bun run db:push
```

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
The API is running at [http://localhost:3000](http://localhost:3000).

## Deployment (Alchemy)

- Web dev: cd apps/web && bun run dev
- Web deploy: cd apps/web && bun run deploy
- Web destroy: cd apps/web && bun run destroy

## Project Structure

```
nixmac/
├── apps/
│   ├── web/         # Frontend application (React + TanStack Router)
│   ├── docs/        # Documentation site (Astro Starlight)
│   └── server/      # Backend API (Hono, TRPC)
├── packages/
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:server`: Start only the server
- `bun run check-types`: Check TypeScript types across all apps
- `bun run db:push`: Push schema changes to database
- `bun run db:studio`: Open database studio UI
- `bun run check`: Run Biome formatting and linting
- `cd apps/web && bun run desktop:dev`: Start Tauri desktop app in development
- `cd apps/web && bun run desktop:build`: Build Tauri desktop app
- `cd apps/docs && bun run dev`: Start documentation site
- `cd apps/docs && bun run build`: Build documentation site
