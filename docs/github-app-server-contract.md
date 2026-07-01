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
> callback URL pointed at `<SERVER>/api/auth/github/callback`. You'll be given, as server secrets/config:
> `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` (PEM), `GITHUB_APP_CLIENT_ID`,
> `GITHUB_APP_CLIENT_SECRET`, and (if webhooks are on) `GITHUB_APP_WEBHOOK_SECRET`.
>
> **Auth:** the desktop now prefers a **GitHub-first bootstrap** before it has a Better Auth API key.
> The public bootstrap endpoints below are the only unauthenticated desktop JSON endpoints. After
> bootstrap completes, every regular desktop request to `/api/auth/github/*` carries a **per-device Better
> Auth API key** (`@better-auth/api-key`, `nixmac_…` prefix) in the `x-api-key` header (a `Bearer`
> `Authorization` header is also accepted). Resolve the **account** by verifying the key
> (`auth.api.verifyApiKey`) and reading its `referenceId` (the Better Auth user id). Email OTP remains
> a desktop fallback for cases where GitHub cannot provide enough identity or the server explicitly
> requires fallback.
>
> **Build these endpoints** (all JSON, all `camelCase`):
>
> 1. `POST /api/auth/github/bootstrap/start` — *(public desktop bootstrap)*
>
>    - Generate a random high-entropy `state`, persist `state → { createdAt }` with a short TTL (~10
>      min), and treat the state as a one-time bearer secret for the desktop poller.
>    - Return `{ "installUrl": string, "state": string }` where `installUrl` =
>      `https://github.com/apps/<GITHUB_APP_SLUG>/installations/new?state=<state>`.
>
> 1. `GET /api/auth/github/callback?installation_id=…&setup_action=…&state=…&code=…` — *(public; GitHub
>    redirects the browser here)*
>
>    - If `state` belongs to a bootstrap flow, exchange `code` for a GitHub user token and read the
>      GitHub user identity. Prefer a verified/user email returned by GitHub OAuth. If GitHub does not
>      return an email, create the Better Auth user with the recommended temporary shape
>      `<sanitized_github_username>.users@nixmac.com`.
>    - Bind or create the Better Auth user, persist `accountId → installationId`, store the GitHub
>      `login` for display, mint a per-device Better Auth API key named for the desktop device or
>      bootstrap flow, and persist it with the bootstrap state for one successful poll.
>    - If GitHub cannot provide enough identity, the OAuth exchange fails unrecoverably, or policy
>      requires an email challenge, mark the bootstrap state as `fallbackRequired` with a readable
>      `fallbackReason`; the desktop will show email OTP.
>    - If `state` belongs to an authenticated `/api/auth/github/connect/start` flow, keep the existing behavior:
>      look up `state → accountId`, persist `accountId → installationId`, store the GitHub `login` if
>      `code` is present, and do not mint a new desktop key.
>    - Respond with a minimal self-contained HTML page: "✓ Connected to nixmac — you can close this
>      tab and return to the app." (No redirect needed; the app polls.)
>
> 1. `GET /api/auth/github/bootstrap/status?state=…` — *(public desktop bootstrap poll)*
>
>    - Return pending while the callback has not completed:
>      `{ "status": "pending", "connected": false }`.
>    - Return fallback when bootstrap cannot complete:
>      `{ "status": "fallbackRequired", "connected": false, "fallbackRequired": true, "fallbackReason": string }`.
>    - Return complete exactly once after successful callback/account binding:
>      `{ "status": "complete", "connected": true, "login": string | null, "installationId": number | null, "accountId": string, "email": string, "apiKey": string }`.
>      The desktop stores `apiKey` in the OS keychain and does not expose it to the webview. Expire or
>      consume the stored plaintext key after the first successful poll.
>    - Return `status: "expired"` or HTTP `410` when the state has expired.
>
> 1. `POST /api/auth/github/connect/start` — *(api-key-authed)*
>
>    - Generate a random `state`, persist `state → { accountId, createdAt }` with a short TTL (~10 min).
>    - Return `{ "installUrl": string, "state": string }` where `installUrl` =
>      `https://github.com/apps/<GITHUB_APP_SLUG>/installations/new?state=<state>`.
>
> 1. `GET /api/auth/github/status` — *(api-key-authed)*
>
>    - Return `{ "connected": boolean, "login": string | null, "installationId": number | null }`
>      for the calling account.
>
> 1. `GET /api/auth/github/repos` — *(api-key-authed)*
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
> 1. `POST /api/auth/github/clone-token` — *(api-key-authed)* Body: `{ "owner": string, "repo": string }`
>
>    - Mint an installation token **scoped to that single repo** with **`contents: read`** only
>      (`POST /app/installations/{id}/access_tokens` with `repositories: ["<repo>"]` and
>      `permissions: { "contents": "read" }`). Verify `owner` matches the installation account.
>    - Return `{ "token": string, "expiresAt": string /* ISO-8601 */, "cloneUrl": "https://github.com/<owner>/<repo>.git" }`.
>    - The desktop clones with `x-access-token:<token>` and discards it immediately. Keep TTL short
>      (GitHub default is 1h; fine).
>
> 1. `POST /api/auth/github/disconnect` — *(api-key-authed; optional but nice)*
>
>    - Delete the `accountId → installationId` mapping (this does **not** uninstall the App; the user
>      revokes in GitHub settings). Return `{ "ok": true }`.
>
> **Security requirements:**
>
> - `GITHUB_APP_PRIVATE_KEY` / client secret **never** leave the server.
> - The desktop only ever receives **short-lived, repo-scoped, read-only** installation tokens (from
>   `/api/auth/github/clone-token`) and the proxied repo list — never the App JWT or a user token.
> - Validate `state` (CSRF) on the callback; bind authenticated connect states to the account and
>   treat bootstrap states as one-time bearer secrets until consumed or expired.
> - Rate-limit `/api/auth/github/repos` and `/api/auth/github/clone-token` per account.
>
> **Acceptance:** a fresh desktop client can call `bootstrap/start` → open the returned URL → install
> on selected repos → poll `bootstrap/status` until the native app receives and stores `apiKey` → call
> `repos` with that key and receive selected repos with correct `hasFlake` → `clone-token` returns a
> working read-only token that clones the private repo over HTTPS. A signed-in client can still use
> the existing `connect/start` path.

______________________________________________________________________

## Notes for the desktop (Tauri) side

- Desktop commands map 1:1: `github_connect_start` → `/api/auth/github/connect/start`, `github_status` →
  `/api/auth/github/status`, `github_list_repos` → `/api/auth/github/repos`, →
  `/api/auth/github/clone-token` then `clone_repo` with the token, `github_disconnect` →
  `/api/auth/github/disconnect`.
- Repo clone command is in `/commands/config.rs` as `config_import_github` to be consistent with other
  config-bootstrapping methods.
- GitHub-first onboarding uses `github_bootstrap_start` → `/api/auth/github/bootstrap/start`, then polls
  `github_bootstrap_status` → `/api/auth/github/bootstrap/status?state=…`. Native Rust stores the returned
  `apiKey` and only exposes non-secret account/linkage status to the React UI.
- The desktop persists **no** GitHub secret — the per-device Better Auth API key (`nixmac_…`) in the
  OS keychain is the only credential it sends. Installation linkage lives server-side, keyed by
  account.
- If bootstrap returns `fallbackRequired`, `expired`, or an unsupported/error response, the desktop
  reveals the existing Better Auth email OTP fallback. After OTP verification mints a device API key,
  the desktop resumes the authenticated `/api/auth/github/connect/start` install flow.
- `hasFlake=false` repos are shown disabled in the picker (matches the current UI).
