# nixmac GitHub App — server-side contract & implementation prompt

This is the contract the nixmac **desktop app** (Tauri) is being built against. Implement these
endpoints on the nixmac server (the service the desktop already talks to via `VITE_SERVER_URL`).

______________________________________________________________________

## Prompt for the server-side agent

> You're working on the **nixmac backend server** — the same service the desktop app already
> authenticates to for account sync. We're adding a server-brokered **GitHub App** connection so the
> macOS app can list a user's repos and clone private ones during onboarding, without ever holding
> the App's private key or a long-lived GitHub token.
>
> **Already done (by us):** a GitHub App is registered with **Contents: Read-only** + **Metadata:
> Read-only** permissions, "Request user authorization (OAuth) during installation" enabled, and its
> callback URL pointed at `<SERVER>/auth/github/callback`. You'll be given, as server secrets/config:
> `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` (PEM), `GITHUB_APP_CLIENT_ID`,
> `GITHUB_APP_CLIENT_SECRET`, and (if webhooks are on) `GITHUB_APP_WEBHOOK_SECRET`.
>
> **Auth:** every desktop request to `/github/*` (except the public browser callback) carries a
> **per-device Better Auth API key** (`@better-auth/api-key`, `nixmac_…` prefix) in the `x-api-key`
> header (a `Bearer` `Authorization` header is also accepted). Resolve the **account** by verifying
> the key (`auth.api.verifyApiKey`) and reading its `referenceId` (the Better Auth user id). The
> desktop mints this key once per device via Better Auth (`POST /api/auth/sign-in/email` →
> `POST /api/auth/api-key/create`) and stores it in the OS keychain.
>
> **Build these endpoints** (all JSON, all `camelCase`):
>
> 1. `POST /github/connect/start` — *(api-key-authed)*
>
>    - Generate a random `state`, persist `state → { accountId, createdAt }` with a short TTL (~10 min).
>    - Return `{ "installUrl": string, "state": string }` where `installUrl` =
>      `https://github.com/apps/<GITHUB_APP_SLUG>/installations/new?state=<state>`.
>
> 1. `GET /auth/github/callback?installation_id=…&setup_action=…&state=…&code=…` — *(public; GitHub
>    redirects the browser here)*
>
>    - Look up `state` → `accountId` (reject if missing/expired).
>    - Persist the mapping `accountId → installationId` (upsert; this is the durable link).
>    - If `code` is present, exchange it (client_id/secret) for a user access token and read
>      `GET /user` to store the account's GitHub `login` for display. The user token may then be
>      discarded — all repo/clone access uses **installation** tokens, not the user token.
>    - Respond with a minimal self-contained HTML page: "✓ Connected to nixmac — you can close this
>      tab and return to the app." (No redirect needed; the app polls.)
>
> 1. `GET /github/status` — *(api-key-authed)*
>
>    - Return `{ "connected": boolean, "login": string | null, "installationId": number | null }`
>      for the calling account.
>
> 1. `GET /github/repos` — *(api-key-authed)*
>
>    - Mint an **installation access token** for the account's installation (sign a short-lived JWT
>      with `GITHUB_APP_PRIVATE_KEY`/`GITHUB_APP_ID`, then `POST /app/installations/{id}/access_tokens`).
>    - `GET /installation/repositories` (paginate all pages).
>    - For each repo, determine whether a **`flake.nix` exists at the default branch** — prefer one
>      `GET /repos/{owner}/{repo}/git/trees/{defaultBranch}` (top-level tree, look for `flake.nix`)
>      to avoid N content calls; fall back to `GET /repos/{o}/{r}/contents/flake.nix` (200 vs 404).
>    - Return `{ "repos": [ { "owner": string, "name": string, "private": boolean, "updatedAt": string /* ISO-8601 */, "defaultBranch": string, "hasFlake": boolean } ] }`.
>      Sort newest-updated first.
>    - If the account has no installation, return `409` with `{ "error": "not_connected" }`.
>
> 1. `POST /github/clone-token` — *(api-key-authed)* Body: `{ "owner": string, "repo": string }`
>
>    - Mint an installation token **scoped to that single repo** with **`contents: read`** only
>      (`POST /app/installations/{id}/access_tokens` with `repositories: ["<repo>"]` and
>      `permissions: { "contents": "read" }`). Verify `owner` matches the installation account.
>    - Return `{ "token": string, "expiresAt": string /* ISO-8601 */, "cloneUrl": "https://github.com/<owner>/<repo>.git" }`.
>    - The desktop clones with `x-access-token:<token>` and discards it immediately. Keep TTL short
>      (GitHub default is 1h; fine).
>
> 1. `POST /github/disconnect` — *(api-key-authed; optional but nice)*
>
>    - Delete the `accountId → installationId` mapping (this does **not** uninstall the App; the user
>      revokes in GitHub settings). Return `{ "ok": true }`.
>
> **Security requirements:**
>
> - `GITHUB_APP_PRIVATE_KEY` / client secret **never** leave the server.
> - The desktop only ever receives **short-lived, repo-scoped, read-only** installation tokens (from
>   `/github/clone-token`) and the proxied repo list — never the App JWT or a user token.
> - Validate `state` (CSRF) on the callback; bind it to the account; expire it.
> - Rate-limit `/github/repos` and `/github/clone-token` per account.
>
> **Acceptance:** a desktop client that is signed in to a nixmac account can call
> `connect/start` → open the returned URL → install on selected repos → see `status.connected=true`
> → `repos` returns the selected repos with correct `hasFlake` → `clone-token` returns a working
> read-only token that clones the private repo over HTTPS.

______________________________________________________________________

## Notes for the desktop (Tauri) side

- Desktop commands map 1:1: `github_connect_start` → `/github/connect/start`, `github_status` →
  `/github/status`, `github_list_repos` → `/github/repos`, `github_import` → `/github/clone-token`
  then `clone_repo` with the token, `github_disconnect` → `/github/disconnect`.
- The desktop persists **no** GitHub secret — the per-device Better Auth API key (`nixmac_…`) in the
  OS keychain is the only credential it sends. Installation linkage lives server-side, keyed by
  account.
- `hasFlake=false` repos are shown disabled in the picker (matches the current UI).
