# Privileged helper upgrade contract

Status: normative. This document defines the protocol and the guarantees by
which nixmac's privileged helper is installed, replaced, retired, and
removed. It applies to the `SMAppService` helper on macOS 13 and later;
earlier macOS versions use the administrator-password path and none of this
contract. The GUI's internal reconciliation procedure is deliberately not
part of this document — it may change between releases; everything here may
not.

nixmac uses a privileged helper so an approved installation can activate an
already-built system generation without an administrator password on every
apply. The GUI, the helper, and the background sync agent are separate
processes compiled from the same release. Replacing `nixmac.app` on disk
changes their files, but already-running processes continue executing the
previous release until they exit.

## Definitions

- **Release commit** — the full lowercase hex Git commit of the packaged
  source, compiled into the GUI, helper, and sync agent of one release.
  Commits match only when the strings are byte-equal.
- **Signature validation** — evaluating a socket peer's code signature,
  identified by its kernel audit token, against nixmac's pinned
  **per-binary** code-signing requirements. A client validating the helper
  evaluates the helper's requirement; the helper validating a client
  evaluates the GUI and sync-agent requirements (mutually exclusive by
  construction — each pins its own binary's designated identifier), and the
  one that matches is the client's **kind**; nothing the peer sends can
  influence it. Every requirement pins **identity** — signing team and
  designated identifier — never a version, hash, or release: it must be
  satisfied by every past and future release of its binary, because
  cross-release validation is what every upgrade depends on. Validation has
  exactly three results: **valid** — the appropriate requirement is
  satisfied; **invalid** — the code demonstrably does not satisfy it,
  including unsigned, ad-hoc-signed, or wrong-identity code and a nixmac
  binary of the wrong kind, even where a platform API expresses that
  judgment as an error code; **error** — no judgment could be reached (peer
  died, resources exhausted, evaluation failed). An error is never treated
  as invalid.
- **Authenticated** — the peer's signature validation returned valid, before
  any protocol bytes were read from or written to that connection. A client
  validating the helper additionally requires the peer to be root. An
  unauthenticated peer receives no protocol bytes; the connection is closed.
  **Root** always means effective uid 0, everywhere in this document.
- **Apply** — the GUI's user-initiated activation flow. The sync agent's
  scheduled runs are not Apply. (The helper derives the requesting user's
  identity from the kernel, never from request content; which users may
  request activation is the application protocol's policy, outside this
  document.)
- **Activation** — the helper runs the activation script of a built system
  generation as root. Activation is ordered root mutation, not a
  transaction: interrupting it can leave the system partially mutated.
- **Canonical install** — the app is a `.app` bundle whose real,
  symlink-resolved path is directly under `/Applications`, not
  runtime-translocated.

## Identifiers that never change

The launchd service label, the helper socket path, and the helper plist
filename inside the bundle are identical in every release, permanently —
this is what lets a new GUI find, inspect, and replace a helper from any
older release, including skipped releases. The socket lives in a root-owned
directory; the helper creates the directory and binds the socket at
startup, which requires root.

## Helper states

The helper is a single-slot state machine, always in exactly one of four
states:

| State | Meaning |
|---|---|
| `Idle` | No activation is running. |
| `Activating(X)` | Activation X is running. When X finishes, the helper returns to `Idle`. |
| `Activating(X, retirement requested)` | X is running; the helper enters `Retired` the moment X finishes. |
| `Retired` | No activation is running and the helper will never start another. Permanent for the rest of the process lifetime. |

X identifies the in-flight activation: the client-generated request ID and
activation script path — carried in the `TryActivate` body, which every
future body must include — plus the submitting client's kind, which the
helper takes from its own validation of that client, never from the body.
These fields are informational; no rule in this document branches on them.
Their representation inside `Status` replies and `Retire`'s `Busy(X)` reply
is part of the frozen surface; the `Busy(X)` refusal to `TryActivate` is
**not** frozen — the commit check precedes it, so it never crosses releases.

Three structural facts about the slot:

- The helper answers `Status` and `Retire` promptly at all times, including
  while an activation is running.
- At most one activation exists at any instant, regardless of how many
  connections are open: the admission decision and the transition into
  `Activating` are one atomic step, serialized across all connections.
- Every state transition takes effect **before** the reply that reports it
  is sent — including the end of an activation: when X finishes, the
  transition to `Idle` (or `Retired`, if latched) takes effect before X's
  result reply is sent, so a client holding a result may immediately
  re-dispatch. In particular, a `Retired` reply **to a `Retire` request** is
  sent only from the `Retired` state, so no concurrent request can be
  admitted after it.

## Requests

The protocol has exactly three requests:

| Request | Permitted caller | Commit rule | Stability |
|---|---|---|---|
| `Status` | authenticated GUI, authenticated sync agent | any commit | frozen forever |
| `TryActivate(X)` | authenticated GUI, authenticated sync agent | exact commit required | body may change between releases |
| `Retire` | authenticated GUI only | any commit | frozen forever |

### Connections and ordering

One request per connection: a client opens a connection, sends exactly one
request, and reads exactly one reply; concurrent requests use separate
connections. After replying, the helper leaves the connection open and
ignores further bytes on it; the helper never closes an authenticated
connection while it is alive (unauthenticated connections are the one
exception — closed before any bytes). A peer-side close on a connection the
helper has already answered therefore always means the helper process ended
— unregister rule 1 uses exactly this as its liveness signal.
A close *before* any reply is weaker: it may instead be the helper declining
a client it could not validate; either way the client stops and re-observes.

The envelope's protocol version tells the receiver how to parse the request
body, nothing more. `Status`, `Retire`, and the typed refusals are answered
whatever the version. Version comparison is never an admission input —
commit equality already implies both ends are the same release, and the
commit check precedes body parsing, so a cross-release `TryActivate` is
refused as a commit mismatch before its version could matter. The version in
the `Status` reply is diagnostic.

A request may be refusable for several reasons at once; the reply is decided
in this fixed order: unreadable envelope → request-not-understood; caller
not permitted; commit mismatch (for `TryActivate`, checked before the body
is parsed); readable envelope with unparseable body → request-not-understood;
finally the state-based reply from the table below.

### The frozen surface

These wire shapes never change in any future release:

- the outer request envelope — how every request states its request kind
  (`Status`, `TryActivate`, or `Retire`), its protocol version, and the
  sender's release commit. The kind set is closed forever; an envelope
  carrying anything else is an unreadable envelope (request-not-understood
  refusal);
- the complete `Status` request and reply, including X's representation;
- the complete `Retire` request and its replies — `Retired` and `Busy(X)`
  (including X's representation) — plus, as for every request, the typed
  refusals below;
- the typed refusal replies: commit mismatch, caller not permitted, request
  not understood.

Everything else — in particular the `TryActivate` body and its result — may
change between releases, because `TryActivate` only ever succeeds between
binaries of the same release. A helper that receives a newer `TryActivate`
body it cannot understand still reads the envelope and answers with the
frozen request-not-understood refusal.

### Reply table

| State | `Status` | `TryActivate(Y)` | `Retire` |
|---|---|---|---|
| `Idle` | state, helper commit, protocol version | starts Y; state becomes `Activating(Y)`; the reply is sent when Y completes and carries Y's result | state becomes `Retired`, then reply `Retired` |
| `Activating(X)` | state, helper commit, protocol version, X | `Busy(X)` | state becomes `Activating(X, retirement requested)`, then reply `Busy(X)` |
| `Activating(X, retirement requested)` | state, helper commit, protocol version, X | `Retired` (carrying X's info while it finishes) | `Busy(X)` |
| `Retired` | state, helper commit, protocol version | `Retired` | `Retired` |

The `Status` reply names the state verbatim — all four states are
distinguishable by any caller. Cross-cutting rows applying in every state:
a `TryActivate` whose client commit is not exactly the helper's gets the
typed commit-mismatch refusal before any privileged work; `Retire` from a
sync agent gets caller-not-permitted; a request unparseable beyond the
envelope gets request-not-understood.

### Reply meanings — read carefully

- **`Busy(X)` to `TryActivate`**: an activation is running. Transient; a
  later request may succeed.
- **`Retired` to `TryActivate`**: this helper will never start the caller's
  activation. Permanent for this helper process. It does **not** mean the
  helper is in the `Retired` state — activation X may still be finishing.
- **`Busy(X)` to `Retire`**: retirement is latched, X still running. Not
  safe to unregister yet.
- **`Retired` to `Retire`**: the helper is in the `Retired` state **now**.
  This reply — and only this reply — is the safe-to-unregister signal for a
  **running** helper (rule 1). Rules 2 and 3 cover registrations with no
  live authenticated helper and need no reply.
- **The `TryActivate` result reply** arrives on the same connection when
  the activation completes and carries its success or failure. **Within
  this protocol, it is the only way to learn an activation's outcome.**
  `Status` reports that an activation is running, never whether a finished
  one succeeded. (Inspecting the resulting system state is outside the
  protocol — see "Unknown outcomes".)

A client that receives a reply it cannot parse treats it as a refusal: do
not activate, do not mutate anything, report and defer.

## Invariants

1. **A running activation is never deliberately interrupted** — not by the
   helper, the GUI, a timeout, or an update. The only exceptions are the
   explicitly accepted residual windows (the legacy/unverifiable removal
   and the crash-relaunch windows); nothing may be added to them. If an
   activation truly hangs forever, the recovery boundary is a reboot.
1. **No nixmac code terminates the helper except `SMAppService`
   unregister.** The helper never exits on its own, and its launchd
   configuration keeps it alive rather than expiring it. Crashes remain
   possible — launchd relaunches a crashed helper — which is exactly what
   rule 1's liveness check exists for.
1. **The helper never queues work.** One activation slot; every request
   that cannot be served now is refused immediately with a typed reply.
1. **Synchronization is bounded and never spans external work.** The
   helper's activation slot may wait only to enter a bounded, in-memory
   state-transition critical section. No lock is held across activation,
   authentication, protocol encoding, socket I/O, reply writing, or any
   other external or blocking work. Admission and the transition into
   `Activating` remain one atomic step; an occupied activation state
   produces its immediate state-derived reply and never queues the request.
   The GUI's single-flight reconciliation slot remains try-acquire and
   answers `Busy` immediately.
1. **Retirement is process-lifetime only.** Never persisted. A relaunched
   helper starts `Idle`.
1. **Stored state is never a safety input.** The stored helper preference
   selects the goal — install, keep, or remove — but every trust or
   termination decision comes from live observation: an authenticated
   peer's reply, or the OS-backed observations of unregister rules 2 and 3.
1. **A lost activation result is never compensated automatically** — no
   automatic re-dispatch, no administrator-password fallback within the
   flow that lost it.

## Unknown outcomes

If a client dispatched `TryActivate` and lost the connection before the
result arrived, the outcome is unknown: succeeded, failed, or still
running. The flow that lost it stops there (invariant 7). The protocol
state remains observable — `Status` shows whether that activation still
runs. A **new** activation requires fresh intent (the user applying again;
the agent's next scheduled run) and goes through normal admission; nothing
about a lost result blocks a fresh request, and the single slot makes
doubling impossible. Whether the lost activation succeeded is a question
about the resulting system state, answered outside this protocol.

## When unregister is allowed

`unregister` terminates the running helper (Apple-documented). It may be
invoked in exactly three situations and no others:

1. **Retired helper.** The running helper answered `Retired` to `Retire` on
   a connection the caller still holds open, and immediately before
   invoking unregister the caller confirms the peer has not closed it. A
   peer-side close — on that connection or any other the replacement is
   using — means the helper may have died and been relaunched `Idle`: the
   attempt is abandoned and reported, every lock or slot it held is
   released, and a later reconciliation converges from freshly observed
   state.
1. **No running process.** `SMAppService` reports `requiresApproval` (an
   approval-pending service has no process), or `enabled` with **positively
   no listener** — defined here, once, for the whole document: connection
   attempts fail because the socket is missing or refuses connections,
   repeatedly over a bounded window; a timeout, slow reply, or any
   ambiguous failure never counts as absence. The final absence check is
   made immediately before invoking unregister; the interval between them
   is a residual window of the same kind as rule 1's.
1. **Legacy or unverifiable helper.** The registration under nixmac's
   service label is `enabled` and the socket peer is a root process whose
   validation returned **invalid**. An **error** never selects this rule.
   The classification is re-evaluated from live observation on every run —
   never implement a has-migrated latch (stored state deciding safety, and
   it would make a tampered helper unremovable). It fires once for an
   intact installation, and again only in the tampered case under residual
   risks.

If the socket peer is not root, no rule applies: report an error and mutate
nothing. A non-root peer can only mean broken permissions or an impostor,
and removal decisions are never made from untrusted observations.

## Reconciliation guarantees

The GUI reconciles the installed helper with its own release using an
internal procedure that is not part of this contract and may change between
releases. Whatever its shape, it must keep these promises:

- **Observation-derived, always.** Reconciliation derives every step from
  what is observable at that moment — `SMAppService` state, authenticated
  replies, the stored preference — and remembers no progress between
  attempts. There is no recovery mode distinct from the normal mode. An
  interrupted attempt is simply re-run and converges.
- **Registration requires user opt-in.** A helper is registered only from a
  canonical install, and only when the user granted it — by the explicit
  Grant action, or by adopting a pre-existing registration as the user's
  earlier opt-in (the pre-contract legacy registration included). No
  registration ever happens without one of those two.
- **Disable sticks.** The explicit Disable action removes the helper
  (retire first if it is running, then unregister) and is never overridden
  by any automatic path, the legacy migration included.
- **A displaced GUI mutates nothing.** A GUI running from a non-canonical
  location, or whose compiled commit differs from the on-disk bundle (the
  bundle was replaced under it), performs no helper mutation and no stored
  writes; it only reports what the user should do (move the app / restart
  the app).
- **Approval is a state, not an error.** `requiresApproval` means macOS
  registered the helper but the user has not enabled it in System Settings
  — never approved, or later revoked. It is reported as a persistent
  pending state. Startup and refresh never open System Settings, never
  re-register, never loop; only the explicit Grant action may open Login
  Items, repeatedly if clicked again — no registration churn either way.
  While pending, Apply uses the administrator-password path and the sync
  agent defers activation. Approval may arrive weeks later: the next
  reconciliation (startup or any status refresh) observes `enabled` and
  proceeds normally — a commit that no longer matches the GUI (approval
  predating an app update) is the ordinary different-commit case, retired
  and replaced. This contract does not assume approval survives a bundle
  replacement; every post-approval observation converges through the same
  reconciliation.
- **Every registration is verified.** A replacement is complete only when
  an authenticated `Status` reply reports the exact GUI commit from `Idle`
  or plain `Activating` (a `Retired` or retirement-latched state is a
  failure). A registration that ends at `requiresApproval` is the normal
  pending state, not a failure. Anything else is reported as a failure and
  repaired by a later reconciliation, never by an unguarded retry loop.
- **`TryActivate` is the sole admission check.** No probe result — `Status`
  or otherwise — may gate the dispatch of an activation; admission is
  decided atomically by the helper (structural facts above). Establishing
  "positively no listener" by its defined repeated connection attempts is
  observation, not a gating probe, and is permitted.
- **The new GUI is the only actor in an upgrade.** Finder replacement
  (quit, replace bundle, relaunch) and the built-in updater (install,
  relaunch) converge on the new GUI's ordinary startup reconciliation. The
  old GUI never prepares, drains, or unregisters anything. An activation
  running across the switch finishes under the old helper; its result goes
  to a connection that no longer exists and becomes an unknown outcome. If
  a helper's connection closes while an activation was running, the GUI
  reports that the activation may have been interrupted and the system may
  be partially mutated.
- **The password path needs proven quiet.** The administrator-password path
  (which itself requires no canonical install) is selected only when nixmac
  knows no helper activation is running or was dispatched: no registration
  exists, its service definition is broken (`notFound`), it is pending
  approval, or its socket is positively not listening. nixmac never password-activates while an `enabled`
  registration could still admit sync-agent work — even one the user never
  granted or has disabled; such a registration is first adopted or removed.
  The password path is refused — never silently substituted — when an
  activation is running, when the helper is being replaced, on a typed
  commit-mismatch or any other typed refusal, on an unparseable reply, on
  an ambiguous connection failure, when a `TryActivate` outcome is unknown,
  or when anything unidentifiable answers the helper's socket.
- **The sync agent has no lifecycle role.** It is an ordinary exact-commit
  protocol client that never consults the stored helper preference: on any
  obstacle — `Busy`, `Retired`, any typed refusal,
  a helper that fails authentication, an unreachable helper, an unparseable
  reply — it keeps its built result and defers activation to its next
  scheduled run. It never calls `Retire` (refused as caller-not-permitted)
  and never uses the password path. Upgrades never stop, kill, or hand off
  a running agent; killing an agent is harmless because agents perform no
  root mutation, and an activation already dispatched completes in the
  helper regardless.

## One-time legacy migration

The previously shipped helper is unsigned and predates this contract; it
cannot `Retire`. On the first launch of this release over such an
installation, reconciliation classifies the socket peer — root, validation
**invalid** — as the legacy helper and writes zero protocol bytes to it. An
existing registration counts as the user's earlier opt-in, so migration is
automatic: unregister directly (rule 3), register the bundled helper under
the same verification as any other registration, and proceed through the
normal approval flow if macOS asks again. A user who had explicitly
disabled the helper instead gets removal without replacement.

Accepted residual risk: this unregister terminates the helper even if it is
mid-activation, and an old client's activation may race the unregister. For
an intact installation it happens exactly once — every contract-era helper
validates as valid and takes the `Retire` path, whatever its commit, and a
validation error selects nothing. The same removal is deliberately
reachable for a contract-era helper whose signature stops validating
(tampered or corrupted bundle, revoked identity): an invalid root peer
cannot prove a drain — no reply from it can be trusted — so removal is the
only sound direction. Such a helper is treated exactly as legacy,
interruption risk included.

## Residual risks and accepted limits

- **Legacy migration race** (above): once for an intact installation, and
  again only if a contract-era helper's signature stops validating — an
  unverifiable root peer is removed, never drained.
- **Crash-relaunch windows**: between the `Retired` reply and unregister
  (rule 1), or between the final absence check and unregister (rule 2),
  the helper could crash or be relaunched `Idle` by launchd's `KeepAlive`
  and in principle admit a fresh activation before unregister lands. The
  immediately-before checks shrink both windows to the interval between
  check and call. Accepted.
- **Concurrent login sessions converge, not coordinate**: a second user's
  GUI (fast user switching) can interleave reconciliation with the first's.
  Same-release GUIs interleave at worst into a failed register or a failed
  verification, reported and repaired by the next attempt; a
  different-release GUI is displaced (see reconciliation guarantees) and
  cannot mutate at all. No cross-session lock. Accepted.
- **The password path is a point-in-time decision**: it is selected from
  the state observed at that moment. nixmac never invalidates its own
  decision (it does not register a helper while its own password activation
  runs), but an independent actor can: a user approving the helper in Login
  Items mid-activation, or a `KeepAlive` relaunch after a positive-absence
  observation, can make a helper eligible, and a scheduled sync-agent run
  could then activate while the password activation still runs. Accepted.
- **Retirement as denial of convenience**: `Retire` is accepted from any
  authenticated GUI, any commit, any location — that breadth is what makes
  cross-release upgrades work. A signature-valid nixmac copy run by any
  local user can therefore retire the helper. Bounded: no privilege gained,
  no activation interrupted, automatic recovery at the next
  reconciliation. Accepted.
- **Disable completes at the next GUI run**: if the GUI crashes between
  recording the disable and finishing the removal, the still-enabled helper
  keeps serving scheduled sync-agent activations until the next GUI run
  resumes the removal (Apply refuses meanwhile). Bounded by that next run;
  Disable is a preference, not a security boundary. Accepted.
- **Same-commit development rebuilds are invisible** to commit-based
  identity. Developers use the explicit Disable/Grant workflow. No
  byte-level code identity is added to compensate.
- **A wedged helper** — unresponsive, or `Busy(X)` forever because an
  activation truly hangs — is never force-killed. Apply stays blocked; the
  documented recovery is a reboot, after which reconciliation converges
  from observed state.
- **A result can outlive its reader**: quitting or relaunching the GUI
  while an apply runs loses that activation's result (unknown outcome). The
  activation itself always completes under invariant 1.

## Pending ingestion: agreed simplification decisions

The following decisions were agreed after PR 1 review. They are recorded
here for later ingestion into the contract as a whole; until that rewrite,
they supersede conflicting terminology and protocol details above.

### Build identity and wire protocol

- The build identifier exists only to identify a build. Production builds
  will normally use a Git commit, but the protocol neither requires nor
  validates Git syntax. Equality is exact string equality.
- Rename `releaseCommit` to `buildId`, `helperCommit` to
  `helperBuildId`, and `CommitMismatch` to `BuildMismatch`. Rename the
  corresponding build environment variable, constants, modules, tests, and
  internal terminology from release-commit names to build-ID names; retain
  no compatibility aliases in code.
- A genuine local binary must never silently embed an empty build ID.
  Packaged builds fail during the build when `NIXMAC_BUILD_ID` is missing
  or exactly empty. Development builds may use one fixed, non-empty fallback.
  Otherwise the supplied identifier is embedded byte-for-byte: no trimming,
  Git parsing, length rule, or character validation.
- Wire parsers accept every string as a peer build ID, including the empty
  string. A peer's empty ID is readable and simply cannot equal the local,
  non-empty ID. In particular, clients must not reject an otherwise valid
  `Status` or `BuildMismatch` solely because its helper build ID is empty.
- Remove `protocolVersion` completely. There is no replacement version
  field.
- Use direct tagged request shapes:
  - `Status` is a kind-only request.
  - `Retire` is a kind-only request.
  - `TryActivate` carries `buildId` and its activation body.
    Internally these deserialize directly to the request enum; remove the
    generic request envelope, deferred/raw-body parsing, and multi-stage
    request parser.
- Parse a complete request normally. A malformed request or activation body
  receives `RequestNotUnderstood`. For a valid `TryActivate`, compare its
  build ID only after parsing: a differing ID receives `BuildMismatch`, and
  an equal ID proceeds to state admission. There is no promise that a build
  mismatch is detected before parsing the activation body.
- `Status` is the authoritative cross-build discovery exchange used by
  reconciliation. `TryActivate` retains its own exact build-ID check as a
  race/admission guard, but no `Status` preflight may gate activation
  dispatch.
- The permanently frozen surface is limited to the cross-build control
  language: `Status`, `Retire`, their replies, and the typed refusals.
  `TryActivate` bodies and results may evolve between builds. Every frozen
  wire shape has an exact byte-string golden fixture explicitly marked as
  never changeable; ordinary round-trip tests cover the changeable payload.

### State, callers, and connections

- Keep the four in-memory states exactly: `Idle`, `Activating(X)`,
  `Retiring(X)`, and `Retired`. `Retire` during activation latches retirement
  and replies `Busy(X)`; a subsequent `TryActivate` replies `Retired`; after
  X finishes, the helper enters `Retired` before sending X's result. No slot,
  retirement, migration, or active-request state is persisted, and every new
  helper process starts `Idle`.
- Implement the slot as a private mutex with narrow `snapshot`, `retire`,
  `admit`, and activation-finish operations. Admission returns an activation
  permit whose destruction finishes the transition. Remove the generic
  event/outcome state-machine abstraction; no guard, mutable state, generic
  closure API, or lock spans external work.
- The GUI may send `Status`, `Retire`, and `TryActivate`. The sync agent may
  send only `TryActivate`; it has no lifecycle role. A recognized but
  unauthorized caller/request pairing receives the frozen typed refusal.
- Authenticate before reading or writing protocol bytes. Unauthenticated
  connections are closed without a typed reply. Keep the hard concurrent
  connection cap of four; the fifth connection is closed before
  authentication and before any protocol bytes, with no `AtCapacity` wire
  shape. Keep the 64 KiB request-line limit and never parse an oversized
  request as a valid prefix.
- A live helper never closes an authenticated connection after replying and
  ignores further bytes. Normal clients close their end after the reply; a
  replacement client holds the answered `Retire` connection through the
  immediately-before-unregister liveness check. A close then proves that the
  exact retired process died and may have been relaunched, so replacement
  aborts.

### Failure and reconciliation policy

- Preserve signature validation's exact `valid` / `invalid` / `error`
  trichotomy. Only a completed invalid judgment may authorize legacy
  migration; inability to reach a judgment never authorizes mutation.
  Signing requirements pin binary identity and signing team only, never a
  build ID, version, release, or executable hash.
- Preserve legacy migration: an enabled service with a root socket peer
  definitively judged invalid may be unregistered without a protocol drain.
  A validation error or a non-root peer never authorizes removal. The
  one-time interruption race remains an accepted migration cost.
- `BuildMismatch` means the helper must be upgraded or disabled. It is a
  refusal, not permission to use administrator-password activation.
  Likewise, no helper-exchange error selects the password path. Password
  eligibility is decided before dispatch from reconciled service state;
  once a helper exchange is attempted, every refusal, malformed reply,
  authentication failure, close, timeout, or other error stops and reports.
- If a dispatched `TryActivate` result is lost, its outcome is unknown. That
  flow stops and reports; it never automatically retries or falls back to
  password activation.
- During replacement, an authenticated `Busy(X)` is the only outcome that
  reconciliation retries. It sends fresh `Retire` requests at bounded
  intervals for an unbounded total until `Retired`. Every other refusal or
  communication failure stops and reports. A genuinely hung activation
  remains a reboot boundary; it is never force-killed.
