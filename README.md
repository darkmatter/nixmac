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
