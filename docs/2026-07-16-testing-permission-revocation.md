# Manually testing permission revocation

How to exercise the post-onboarding permission-repair surfaces: the launch
banner (`apps/native/src/components/widget/repair/`) and the
Settings → Permissions tab
(`apps/native/src/components/widget/settings/permissions-tab.tsx`).

## What the app checks

Defined in `apps/native/src-tauri/src/system/permissions.rs`:

| id | macOS surface | required |
| --- | --- | --- |
| `desktop` | Files & Folders → Desktop | yes |
| `documents` | Files & Folders → Documents | yes |
| `admin` | membership in `admin`/`wheel` group | yes |
| `full-disk` | Full Disk Access | yes |
| `app-management` | App Management | no (recommended; macOS exposes no probe, stays Pending) |
| `privileged-helper` | Login Items & Extensions (SMAppService daemon) | yes |

Accessibility, Automation/AppleEvents, and Screen Recording are **not** part of
the checked set.

## Use a real installed build

`tauri dev` cannot exercise this properly:

- TCC grants attach to the signing identity and bundle path, not the app name.
- The `privileged-helper` check is forced to Pending outside an installed
  `.app` bundle.
- In debug builds, `NIXMAC_SKIP_PERMISSIONS` / `VITE_NIXMAC_SKIP_PERMISSIONS`
  short-circuit all checks to granted (and suppress the repair banner). Both
  are compiled out of release builds.

Build and install:

```sh
cd apps/native
bun run desktop:build:local
```

then move the produced `nixmac.app` into `/Applications` and launch it from
there (the permissions panel itself warns when the bundle is misplaced —
grants won't stick from a DMG or the build output directory).

## Revoking permissions

The app is **nixmac**, bundle id `com.darkmatter.nixmac` — see
`apps/native/src-tauri/tauri.conf.json` for the authoritative value.

Via System Settings → **Privacy & Security**:

- **Full Disk Access** → toggle off nixmac (primary, load-bearing permission).
- **App Management** → toggle off nixmac.
- **Files & Folders** → expand nixmac → toggle off Desktop / Documents.

Or from a terminal, which makes macOS forget the grant entirely so the app
re-prompts:

```sh
tccutil reset SystemPolicyAllFiles com.darkmatter.nixmac        # Full Disk Access
tccutil reset SystemPolicyDesktopFolder com.darkmatter.nixmac
tccutil reset SystemPolicyDocumentsFolder com.darkmatter.nixmac
tccutil reset SystemPolicyAppBundles com.darkmatter.nixmac      # App Management
```

## What to expect

- **Quit the app, revoke, relaunch.** The repair evaluation is launch-scoped
  (`useLaunchRepair` runs once on hydration); revoking while the app is
  running shows nothing until relaunch, a "Check again", or a build that fails
  on a probeable permission error.
- On relaunch with a required permission missing you get the amber
  "Required permission(s) revoked" banner with **Open Settings** (jumps to
  Settings → Permissions) and **Check again** (re-probes and clears the banner
  once fixed).
- Settings → Permissions shows the same panel as onboarding: re-probe on
  open, per-permission grant/request buttons that deep-link the relevant
  System Settings pane.
- The onboarding wizard must **not** reappear — post-completion regressions
  are banners/cards, never a takeover (design decision D7 in
  `docs/2026-07-08-onboarding-state-ownership.md`).

## Gotchas

- The Full Disk Access probe reads real TCC-gated paths (Safari bookmarks,
  `~/Library/Mail`, the TCC database). A grant that is toggled on in System
  Settings but tied to a stale code signature (e.g. after replacing the app
  in place with a differently-signed build) correctly reports **Denied**.
  Remove the entry and re-add the current bundle if that happens.
- `admin` can't be revoked from Privacy & Security — it's group membership.
  Testing it requires a non-admin macOS account.
- `app-management` is Recommended-only and never blocks; macOS gives no way
  to probe it, so its row stays Pending even when granted.
