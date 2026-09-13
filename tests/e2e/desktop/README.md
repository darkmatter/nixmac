# Shared desktop runtime recipe

`recipe.json` is the Nix Mac scenario definition consumed by `@repo/app-testing`
in the agents repository. It runs on a leased GUI session from `@repo/desktop`.
The runtime verifies the supplied DMG SHA-256 before installing
`/Applications/nixmac.app`, records continuous video, captures screenshots,
and retains evidence outside the disposable VM.

The agents repository also supplies `just desktop-smoke <branch|commit|PR>` and
`just desktop-pr <PR>`. Execution requires an authenticated GitHub user with
active `darkmatter` organization membership, including reuse of an existing
build. GitHub's repository write-access requirement for dispatch still applies.
Read-only `--resolve-only` can inspect source without execution authorization.

Manual `build.yaml` requests use the default-branch workflow. Its hosted source
job verifies both the actor and triggering actor using the installed GitHub
App's organization **Members: read** permission before any ARC or Mac job can
start. Missing membership or unavailable credentials stop the request. Manual
reruns are disabled, including selective job reruns; submit a fresh dispatch.
The workflow's `authorize_only=true` input exercises this check and skips every
ARC/Mac job. Confirm the hosted admission job succeeds and all build jobs are
skipped before qualifying a new permission setup. These probe runs cannot be
selected as application builds by the desktop CLI.

Membership authorizes the selected source to run with build/signing access;
it does not isolate that source. This manual gate retains existing push, PR and
merge-group behavior. External PR approvals and runner restrictions remain
separate server controls. No test command posts GitHub comments or issues.

Configure the platform's `DESKTOP_TEST_RECIPE_FILES` with this JSON file's
absolute path. Submit `appId: "nixmac"`, profile `nixmac-prepared`, a candidate
containing the exact release asset URL and SHA-256, and scenario IDs `launch`
or `package-tools`. With a baseline build, the workflow runs the candidate,
baseline, and candidate confirmation sequentially in three fresh VMs.

For a controlled starting state, assign the contents of
`fresh-onboarding.initial-state.json` to the request's `initialState` field.
For the interrupted-onboarding/missing-configuration case, use
`startup-recovery.initial-state.json` with `scenarioIds: ["startup-recovery"]`.
To create a real configuration, use `fresh-onboarding.initial-state.json` with
`scenarioIds: ["create-configuration"]`. This requires the prepared guest's
`admin` account and an absent `/Users/admin/nixmac-desktop-config` destination.
The runtime installs the verified build, writes the supplied JSON to the
recipe's named `stateFiles`, then prepares and launches the app. Each comparison
phase receives the same starting JSON in a fresh VM. These are complete file
replacements; omitted target names retain the VM image's existing state.

The recovery scenario waits for the app's actual `Configuration not found`
repair view and the supplied path. It also checks that the app changed
`completedAt` from `null` to the seeded `lastBuildAt`, and retains that JSON
alongside screenshots and video. The historical build timestamp is a fixture;
this scenario exercises startup recovery and does not execute a Nix build.
The [state guide](STATE.md) maps the files to their production owners,
describes migrations, and distinguishes persisted state from live loading.

The creation scenario selects Start from scratch, scrolls the form into view,
enters the literal host `desktop-test-mac` and destination through native
controls, then submits once. It verifies the app-created flake, committed Git
repository and preferences, quits the app, and verifies the same files and Git
revision survive a new process. The scenario exports the flake, revision and
preferences before/after relaunch alongside its recordings.

The prepared desktop disables automatic capitalization and text substitutions:
macOS otherwise changes the host's first letter when the field loses focus.
WebKit fields use the shared runtime's explicit `foregroundKeyboard` fill mode
because Peekaboo 4.3's AX setter can accept a write without changing these fields.
The runtime reconciles a recognized uncertain typing outcome only after an exact
native readback, retaining the original outcome. Disk checks additionally prove
that Nix Mac's React form state received the typed values.

The launch assertion waits for the rendered `Config Directory` onboarding
content for up to 30 seconds, retaining each observation. A process or empty
native window alone does not satisfy the assertion.

The prepared profile has working Nix and Homebrew and preconfigured desktop
permissions. These scenarios establish install/launch, package-tool readiness,
startup recovery and creation/relaunch persistence. The existing `tests/e2e` and
Computer Use suites provide other product scenarios. This recipe does not claim clean package-manager
installation coverage or permission-prompt coverage.

Reports remain internal to the testing runtime. Public reproduction delivery
must use the existing trusted publisher and its live app attestation,
provider-trace, screenshot, and video requirements.
