# Privileged helper upgrade contract

Status: normative. This document defines how nixmac's privileged helper is
installed, replaced, retired, and removed, and the guarantees every
participant may rely on. It applies to the `SMAppService` helper on macOS 13
and later; earlier macOS versions use the administrator-password path and
none of this contract.

The GUI's internal reconciliation *procedure* is deliberately not part of
this document — it may change between releases, and is described in
nixmac's internal engineering documentation. The guarantees that
procedure must keep are part of this document, in §8. Everything in this
document — those guarantees included — may not change.

Read §1–§2 for the design. §3–§10 are the rules, in the order an implementor
needs them; everything there is binding.

______________________________________________________________________

## 1. The problem

nixmac uses a privileged helper so an approved installation can activate an
already-built system generation without an administrator password on every
apply. The GUI, the helper, and the background sync agent are separate
processes compiled from the same build.

Replacing `nixmac.app` on disk changes their files, but already-running
processes continue executing the previous build until they exit. So after an
update a new GUI routinely finds an *older* helper still running as root,
and must be able to inspect it, stop it from taking new work, and replace
it — without an administrator password, without interrupting an activation,
and without ever having seen that older build's code.

## 2. The approach

Seven ideas carry the whole design.

1. **Same build activates; any build negotiates.** `TryActivate` requires
   the client's build ID to equal the helper's byte for byte, so an
   activation only ever runs between binaries that shipped together.
   `Status` and `Retire` carry no build ID and work between any two builds,
   forever. That split is the entire cross-version story — there is no
   version negotiation anywhere. (§4, §5)
1. **Fixed rendezvous points.** The launchd label, the socket path, and the
   helper plist filename are identical in every build, permanently. That is
   how a new GUI finds a helper from an arbitrarily old build, skipped
   releases included. (§4)
1. **A frozen control language.** `Status`, `Retire`, and three typed
   refusals never change shape in any future build: a GUI must be able to
   parse what an unknown-vintage helper says, and the reverse. Everything
   outside that frozen set may change freely, because `TryActivate` only ever
   *succeeds* between binaries of the same build. (§4)
1. **One slot, never a queue.** The helper runs at most one activation and
   holds no work. Admission and the state transition are a single atomic
   step; anything it cannot serve right now is refused immediately with a
   typed reply. (§5, §6)
1. **The helper owns retirement.** A new GUI cannot safely kill an old
   helper, so it asks. `Retire` latches "never start another activation";
   the helper answers `Retired` only once nothing is running, and that
   reply — on a connection still open — is the only safe-to-unregister
   signal a live helper can give (§7 rule 1; rules 2 and 3 cover a helper
   that is absent or unverifiable). (§5, §7)
1. **Never interrupt, never guess.** A running activation is root mutation
   in flight; no nixmac code deliberately interrupts it, the two accepted
   windows (§10.1, §10.2) excepted. If a result is lost, the outcome is
   unknown and stays unknown: no automatic retry and no password fallback in
   the flow that lost it. Every trust and termination decision comes from a
   live observation, never from stored state. (§6)
1. **Reconciliation converges; it does not resume.** The GUI has no upgrade
   state machine and remembers no progress between attempts. Each run
   observes the world and drives toward the stored goal; an interrupted run
   is simply re-run. (§8)

### What an upgrade looks like

Illustrative only — the binding rules are §7 and §8. The new GUI is the sole
actor; the old GUI prepares nothing and hands off nothing.

1. The new GUI starts and reads the stored preference — install, keep, or
   remove. That is the *goal*, never a safety input.
1. It observes `SMAppService`. If a helper is listening, it authenticates
   the peer and asks `Status`, learning that helper's build ID and state.
1. Build ID already equal to its own, from `Idle` or plain `Activating`:
   done, nothing to do.
1. Otherwise it sends `Retire` and waits through `Busy(X)` for as long as
   the running activation takes.
1. On `Retired` it confirms, immediately beforehand, that the peer has not
   closed that still-held connection, calls `unregister`, and then registers
   the bundled helper.
1. It verifies the result with an authenticated `Status` reporting its own
   build ID from `Idle` or plain `Activating` (or accepts `requiresApproval`
   as the normal pending state).

Four branches leave that line (§7, §8.6, §8.9). A registration that is
`enabled` with positively no listener is unregistered directly, with no
protocol exchange (§7 rule 2). A registration at `requiresApproval` is left
pending and mutated in no way (§8.6) — §7 rule 2 also permits unregistering
that one, but only when the goal is removal. A **root** helper whose
signature validates as **invalid** cannot be asked anything, so it is removed
rather than drained (§7 rule 3, §9) — whereas a validation *error*, or a
non-root peer, authorizes nothing. And anything else — any other refusal, a
close, an ambiguous failure — ends the attempt with a report; the next
reconciliation starts over from fresh observation.

______________________________________________________________________

## 3. Definitions

**Build ID** — the opaque string identifying the build a binary came from,
compiled into the GUI, helper, and sync agent of one build. It exists only
to identify a build: the protocol neither requires nor validates any
particular syntax, and two build IDs match only when the strings are
byte-equal. Production builds normally use a Git commit, but nothing in the
protocol depends on that. Every genuine binary carries a non-empty build ID,
enforced when it is built; the wire nevertheless accepts whatever string a
peer sends, including the empty string, which simply cannot equal a non-empty
local ID. No participant may reject an otherwise valid reply merely because
the build ID it reports is empty.

**Signature validation** — evaluating a socket peer's code signature,
identified by its kernel audit token, against nixmac's pinned **per-binary**
code-signing requirements. A client validating the helper evaluates the
helper's requirement; the helper validating a client evaluates the GUI and
sync-agent requirements (mutually exclusive by construction — each pins its
own binary's designated identifier), and the one that matches is the
client's **kind**; nothing the peer sends can influence it. Every
requirement pins **identity** — signing team and designated identifier —
never a build ID, version, release, or executable hash: it must be satisfied
by every past and future build of its binary, because cross-build validation
is what every upgrade depends on. Validation has exactly three results:

- **valid** — the appropriate requirement is satisfied;
- **invalid** — the code demonstrably does not satisfy it, including
  unsigned, ad-hoc-signed, or wrong-identity code and a nixmac binary of the
  wrong kind, even where a platform API expresses that judgment as an error
  code;
- **error** — no judgment could be reached (peer died, resources exhausted,
  evaluation failed). An error is never treated as invalid.

**Authenticated** — the peer's signature validation returned valid, before
any protocol bytes were read from or written to that connection. A client
validating the helper additionally requires the peer to be root. An
unauthenticated peer receives no protocol bytes; the connection is closed.
**Root** always means effective uid 0, everywhere in this document.

**Apply** — the GUI's user-initiated activation flow. The sync agent's
scheduled runs are not Apply. (The helper derives the requesting user's
identity from the kernel, never from request content; which users may
request activation is the application protocol's policy, outside this
document.)

**Activation** — the helper runs the activation script of a built system
generation as root. Activation is ordered root mutation, not a transaction:
interrupting it can leave the system partially mutated.

**Canonical install** — the app is a `.app` bundle whose real,
symlink-resolved path is directly under `/Applications`, not
runtime-translocated.

## 4. What never changes

### Identifiers

The launchd service label, the helper socket path, and the helper plist
filename inside the bundle are identical in every build, permanently — this
is what lets a new GUI find, inspect, and replace a helper from any older
build, including skipped releases. The socket lives in a root-owned
directory; the helper creates the directory and binds the socket at startup,
which requires root.

### The frozen surface

The frozen surface is the cross-build control language: everything a GUI
needs in order to talk to a helper built from any other build. These wire
shapes never change in any future build.

- **How a request states its kind, and how a reply states its kind.** The
  request-kind set (`Status`, `TryActivate`, `Retire`) is closed forever;
  anything else is a request-not-understood refusal.
- **The complete `Status` request and reply**, including X's representation
  (§5). Two more sets close with it: the state set (`Idle`, `Activating`,
  `Retiring`, `Retired`) and the client-kind set (GUI, sync agent). A helper
  of any build reports only those, so a GUI of any build can always parse
  what it finds — a fifth state or a third client kind would leave older
  GUIs unable to read a `Status` they must act on.
- **The complete `Retire` request and its replies** — `Retired` and
  `Busy(X)`, including X's representation.
- **The typed refusal replies**, a closed set of three: build mismatch —
  which reports the helper's own build ID, so a client of any build can say
  what it found — caller not permitted, and request not understood.

Everything else — in particular the `TryActivate` body and its result — may
change between builds, because `TryActivate` only ever succeeds between
binaries of the same build. A helper that receives a newer `TryActivate`
body it cannot understand answers with the frozen request-not-understood
refusal.

There is **no protocol version field**. Each request is one self-describing
tagged shape: `Status` and `Retire` carry nothing but their kind,
`TryActivate` carries the sender's build ID and its activation body.
Cross-build compatibility comes from the frozen surface plus the exact
build-ID check on `TryActivate`, not from version negotiation.

## 5. The helper

### States

The helper is a single-slot state machine, always in exactly one of four
states:

| State | Meaning |
|---|---|
| `Idle` | No activation is running. |
| `Activating(X)` | Activation X is running. When X finishes, the helper returns to `Idle`. |
| `Retiring(X)` | X is running and retirement is latched; the helper enters `Retired` the moment X finishes. |
| `Retired` | No activation is running and the helper will never start another. Permanent for the rest of the process lifetime. |

X identifies the in-flight activation: the client-generated request ID and
activation script path — carried in the `TryActivate` body, which every
future body must include — plus the submitting client's kind, which the
helper takes from its own validation of that client, never from the body.
These fields are informational; no rule in this document branches on them.

X's representation inside `Status` replies and `Retire`'s `Busy(X)` reply is
part of the frozen surface. `TryActivate`'s **state-derived** replies —
`Busy(X)`, `Retired`, and its activation result — are **not** frozen: a
`TryActivate` from a different build never reaches state admission, so those
replies never cross builds. Its typed refusals are frozen like every other
refusal, because those are exactly the ones that do cross builds.

Three structural facts about the slot:

- On any connection the helper accepts, it answers `Status` and `Retire`
  promptly at all times, including while an activation is running.
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

### Requests

The protocol has exactly three requests:

| Request | Permitted caller | Build ID | Stability |
|---|---|---|---|
| `Status` | authenticated GUI only | not carried; answered whatever the caller's build | frozen forever |
| `TryActivate(X)` | authenticated GUI, authenticated sync agent | carried; must equal the helper's exactly | body and result may change between builds |
| `Retire` | authenticated GUI only | not carried; answered whatever the caller's build | frozen forever |

The sync agent is an activation client and nothing else: it sends only
`TryActivate`, and a `Status` or `Retire` from it is refused as
caller-not-permitted.

### Connections

One request per connection: a client opens a connection, sends exactly one
request, and reads exactly one reply; concurrent requests use separate
connections. The helper serves a small fixed number of connections
concurrently (four); a connection beyond that cap is closed before
authentication and before any protocol bytes — there is no wire shape for
it, and a client sees only a closed connection. Requests are size-bounded
(64 KiB); an oversized request is rejected outright and never parsed as a
valid truncated prefix.

After replying, the helper leaves the connection open and ignores further
bytes on it; the helper never closes an authenticated connection while it is
alive (unauthenticated and over-cap connections are the exceptions — closed
before any bytes). Ordinary clients close their own end once they have the
reply.

A peer-side close on a connection the helper has already answered therefore
always means the helper process ended — unregister rule 1 (§7) uses exactly
this as its liveness signal, which is why a replacement holds its answered
`Retire` connection open until the moment it unregisters. A close *before*
any reply is weaker: it may instead be the helper declining a client it
could not validate, or the connection cap; either way the client stops and
re-observes.

### Refusal order

A request may be refusable for several reasons at once; the reply is decided
in this fixed order:

1. a request that cannot be parsed in full — unknown kind, malformed shape,
   malformed activation body, or oversized — is refused as
   request-not-understood;
1. then caller not permitted;
1. then, for `TryActivate`, build mismatch;
1. finally the state-based reply from the table below.

Because the body is parsed before the build ID is compared, a `TryActivate`
from a different build may be refused either as a build mismatch or — if
that helper cannot parse the newer body — as request-not-understood. There
is no promise about which. Both are refusals, neither starts an activation,
and a client treats them the same way: the helper has to be replaced or
disabled, and no activation happened.

### Reply table

| State | `Status` | `TryActivate(Y)` | `Retire` |
|---|---|---|---|
| `Idle` | state, helper build ID | starts Y; state becomes `Activating(Y)`; the reply is sent when Y completes and carries Y's result | state becomes `Retired`, then reply `Retired` |
| `Activating(X)` | state, helper build ID, X | `Busy(X)` | state becomes `Retiring(X)`, then reply `Busy(X)` |
| `Retiring(X)` | state, helper build ID, X | `Retired` (carrying X's info while it finishes) | `Busy(X)` |
| `Retired` | state, helper build ID | `Retired` | `Retired` |

The `Status` reply names the state verbatim — all four states are
distinguishable by any caller. Cross-cutting rows applying in every state: a
`TryActivate` that parses but whose client build ID is not exactly the
helper's gets the typed build-mismatch refusal before any privileged work
(one that does not parse gets request-not-understood instead — see the
refusal order above); `Status` or `Retire` from a sync agent gets
caller-not-permitted; a request that cannot be parsed gets
request-not-understood.

### Reply meanings — read carefully

- **`Status`** is the cross-build discovery exchange: it is how a GUI of any
  build learns what helper is installed — its build ID and its state.
  Together with `Retire`, it is what reconciliation uses against a helper of
  any other build. It is never an admission input for an activation.
- **`Busy(X)` to `TryActivate`**: an activation is running. Transient; a
  later request may succeed.
- **`Retired` to `TryActivate`**: this helper will never start the caller's
  activation. Permanent for this helper process. It does **not** mean the
  helper is in the `Retired` state — activation X may still be finishing.
- **`Busy(X)` to `Retire`**: retirement is latched, X still running. Not
  safe to unregister yet.
- **`Retired` to `Retire`**: the helper is in the `Retired` state **now**.
  This reply — and only this reply — is the safe-to-unregister signal for a
  **running** helper (§7 rule 1). Rules 2 and 3 cover registrations with no
  live authenticated helper and need no reply.
- **Build mismatch** means this helper must be upgraded or disabled before it
  can activate anything for this caller. It is a refusal, never a licence to
  activate some other way.
- **The `TryActivate` result reply** arrives on the same connection when the
  activation completes and carries its success or failure. A client waits for
  it under **one generous bound and nothing shorter** — an activation
  legitimately runs for many minutes, so the bound is set far outside the range
  of any real one. What is binding is that shape — one bound, generous, far out;
  the value itself is a build's own choice and no part of this contract, and it
  is 30 minutes today. Within that range only a peer close or an
  unparseable reply ends the wait. The short read deadlines belong on
  connecting, on `Status`, and on `Retire`, and none of them may be reused
  here: a leash at their scale manufactures unknown outcomes out of ordinary
  long applies, while expiry of a bound this far out is evidence of a wedged
  helper rather than of a slow apply. **Within this protocol, the result reply
  is the only way to learn an activation's
  outcome.** `Status` reports that an activation is running, never whether a
  finished one succeeded. (Inspecting the resulting system state is outside
  the protocol — see §6, unknown outcomes.)

A client that receives a reply it cannot parse treats it as a refusal: do
not activate, do not mutate anything, report and defer.

## 6. Invariants

1. **A running activation is never deliberately interrupted** — not by the
   helper, the GUI, a timeout, or an update. The only exceptions are the
   explicitly accepted residual windows (§10.1's legacy/unverifiable removal
   and §10.2's crash-relaunch windows); nothing may be added to them. If an
   activation truly hangs forever, the recovery boundary is a reboot.
1. **No nixmac code terminates the helper except `SMAppService`
   unregister.** The helper never exits on its own, and its launchd
   configuration keeps it alive rather than expiring it. Crashes remain
   possible — launchd relaunches a crashed helper — which is exactly what
   §7 rule 1's liveness check exists for.
1. **The helper never queues work.** One activation slot; every request that
   cannot be served now is refused immediately with a typed reply.
1. **Synchronization is bounded and never spans external work.** The
   helper's activation slot may wait only to enter a bounded, in-memory
   state-transition critical section. No lock is held across activation,
   authentication, protocol encoding, socket I/O, reply writing, or any
   other external or blocking work. Admission and the transition into
   `Activating` remain one atomic step; an occupied activation state produces
   its immediate state-derived reply and never queues the request.
1. **Helper state is process-lifetime only.** Neither retirement nor the
   activation slot nor any in-flight request is ever persisted. A relaunched
   helper starts `Idle`.
1. **Stored state is never a safety input.** The stored helper preference
   selects the goal — install, keep, or remove — but every trust or
   termination decision comes from live observation: an authenticated peer's
   reply, or the OS-backed observations of unregister rules 2 and 3.
1. **A lost activation result is never compensated automatically** — no
   automatic re-dispatch, no administrator-password fallback within the flow
   that lost it.

### Unknown outcomes

If a client dispatched `TryActivate` and stopped waiting before the result
arrived — the connection was lost, or its one generous bound expired (§5) — the
outcome is unknown: succeeded, failed, or still running.
The flow that lost it stops there (invariant 7). The protocol state remains
observable — `Status` shows whether that activation still runs. A **new**
activation requires fresh intent (the user applying again; the agent's next
scheduled run) and goes through normal admission; nothing about a lost
result blocks a fresh request, and the single slot makes doubling
impossible. Whether the lost activation succeeded is a question about the
resulting system state, answered outside this protocol.

## 7. When unregister is allowed

`unregister` terminates the running helper (Apple-documented). It may be
invoked in exactly three situations and no others.

1. **Retired helper.** The running helper answered `Retired` to `Retire` on a
   connection the caller still holds open, and immediately before invoking
   unregister the caller confirms the peer has not closed it. A peer-side
   close — on that connection or any other the replacement is using — means
   the helper may have died and been relaunched `Idle`: the attempt is
   abandoned and reported, every lock or slot it held is released, and a
   later reconciliation converges from freshly observed state.
1. **No running process.** `SMAppService` reports `requiresApproval` (an
   approval-pending service has no process), or `enabled` with **positively
   no listener** — defined here, once, for the whole document: connection
   attempts fail because the socket is missing or refuses connections,
   repeatedly over a bounded window; a timeout, slow reply, or any ambiguous
   failure never counts as absence. The final absence check is made
   immediately before invoking unregister; the interval between them is a
   residual window of the same kind as rule 1's.
1. **Legacy or unverifiable helper.** The registration under nixmac's
   service label is `enabled` and the socket peer is a root process whose
   validation returned **invalid**. An **error** never selects this rule. The
   classification is re-evaluated from live observation on every run — never
   implement a has-migrated latch (stored state deciding safety, and it would
   make a tampered helper unremovable). It fires once for an intact
   installation, and again only in the tampered case under residual risks.

If the socket peer is not root, no rule applies: report an error and mutate
nothing. A non-root peer can only mean broken permissions or an impostor, and
removal decisions are never made from untrusted observations.

## 8. What reconciliation must guarantee

The GUI reconciles the installed helper with its own build using an internal
procedure that is not part of this contract and may change between releases.
Whatever its shape, it must keep these promises.

**Who may mutate**

- **8.1 Observation-derived, always.** Every step follows from what is observable
  at that moment — `SMAppService` state, authenticated replies, the stored
  preference. No progress is remembered between attempts, and there is no
  recovery mode distinct from the normal one: an interrupted attempt is simply
  re-run, and converges.
- **8.2 Registration requires user opt-in.** Only from a canonical install, and
  only on the explicit Grant action or by adopting a pre-existing registration
  (the pre-contract legacy one included) as the user's earlier opt-in. Never
  otherwise.
- **8.3 Disable sticks.** The explicit Disable action removes the helper — retire
  first if it is running, then unregister — and no automatic path may override
  it, the legacy migration included.
- **8.4 A displaced GUI mutates nothing.** Running from a non-canonical location,
  or with a compiled build ID differing from the on-disk bundle's (the bundle
  was replaced under it): no helper mutation, no stored writes. It only
  reports what the user should do — move the app, restart the app.
- **8.5 The new GUI is the only actor in an upgrade.** Finder replacement (quit,
  replace bundle, relaunch) and the built-in updater (install, relaunch) both
  converge on its ordinary startup reconciliation; the old GUI never prepares,
  drains, or unregisters anything. An activation running across the switch
  finishes under the old helper, and its result goes to a connection that no
  longer exists — an unknown outcome. When a helper connection closes
  mid-activation, the GUI reports that the activation may have been
  interrupted and the system may be partially mutated.

**Approval and verification**

- **8.6 Approval is a state, not an error.** `requiresApproval` means macOS
  registered the helper but the user has not enabled it in System Settings —
  never approved, or later revoked — and it is reported as a persistent
  pending state. Startup and refresh never open System Settings, never
  re-register a registration that is pending approval, never loop; only the
  explicit Grant action may open Login Items, repeatedly if clicked again. No registration churn either way.
  Re-running reconciliation on a cadence is not the loop this rule forbids. A
  run that mutates nothing may be repeated for as long as the state persists —
  an approval may be days away, and re-observing costs nothing. (§8.9's
  indefinite wait is inside a single attempt; this is about repeating whole
  attempts.) Repetition that *mutates* must be bounded: after a
  bounded number of consecutive runs that unregister or register, the GUI
  reports and leaves repair to the next launch or user action. The ban is on
  registration churn and on opening System Settings, not on re-observation.
  While pending, Apply uses the administrator-password path and the sync agent
  defers activation. Approval may arrive weeks later: the next reconciliation
  (startup or any status refresh) observes `enabled` and proceeds normally,
  and a build ID that no longer matches the GUI (approval predating an app
  update) is the ordinary different-build case — retired and replaced.
  This contract does not assume approval survives a bundle replacement; every
  post-approval observation converges through the same reconciliation.
- **8.7 Every registration is verified.** A replacement is complete only when an
  authenticated `Status` reply reports the exact GUI build ID from `Idle` or
  plain `Activating`; `Retired` or `Retiring` is a failure, and
  `requiresApproval` is the normal pending state, not a failure. Anything else
  is reported as a failure and repaired by a later reconciliation, never by an
  unguarded retry loop.

**Admission and waiting**

- **8.8 `TryActivate` is the sole admission check.** No probe result — `Status` or
  otherwise — may gate the dispatch of an activation; the helper decides
  admission atomically (§5). `Status` is reconciliation's discovery exchange,
  and `TryActivate`'s own build-ID check is the race guard that makes a stale
  discovery harmless. Establishing "positively no listener" by its defined
  repeated connection attempts is observation, not a gating probe, and is
  permitted.
- **8.9 Only `Busy(X)` is waited on indefinitely.** During a replacement, an
  authenticated `Busy(X)` is the single outcome reconciliation retries without
  limit: fresh `Retire` requests at bounded intervals, unbounded in total,
  until `Retired`. Every other refusal or communication failure ends the
  attempt with a report, to be repaired by a later reconciliation.
- **8.10 Waiting on the OS is bounded.** That previous rule is about retrying a
  refused or failed exchange; waiting on the OS is different, and
  reconciliation may do it through bounded, explicitly-defined windows that
  cannot mutate anything on their own:
  establishing "positively no listener" by repeated connection attempts,
  letting a freshly registered helper start listening before verification
  judges it missing, and awaiting the unregister completion callback. Each has
  a defined bound, and exceeding it ends the attempt with a report like any
  other failure. A genuinely hung activation stays a reboot boundary and is
  never force-killed.

**The other two activation paths**

- **8.11 The password path needs proven quiet.** The administrator-password path
  itself requires no canonical install, but it is selected only when nixmac
  knows no helper activation is running or was dispatched: no registration
  exists, its service definition is broken (`notFound`), it is pending
  approval, or its socket is positively not listening. That eligibility is
  decided **before** any helper exchange, from reconciled service state.
  nixmac never *selects* the password path while an `enabled` registration
  could still admit sync-agent work — even one the user never granted or has
  since disabled; such a registration is first adopted or removed. The
  guarantee is evaluated when the path is selected; §10.4 records the windows in
  which the world changes after that — one of them lasting as long as the
  activation — overlap included. Once a helper exchange has been attempted,
  nothing it produces can select the password
  path: a build mismatch or any other typed refusal, an unparseable reply, an
  authentication failure, a close, a timeout, an ambiguous connection failure,
  an unknown `TryActivate` outcome, or anything unidentifiable answering the
  helper's socket all stop the flow and report. The path is refused — never
  silently substituted — in every one of those cases, and while an activation
  is running or the helper is being replaced.
- **8.12 The sync agent has no lifecycle role.** It is an ordinary exact-build-ID
  protocol client: it sends only `TryActivate` and never consults the stored
  helper preference. On any obstacle — `Busy`, `Retired`, any typed refusal, a
  helper that fails authentication, an unreachable helper, an unparseable
  reply — it keeps its built result and defers activation to its next
  scheduled run. It never calls `Retire` or `Status` (both refused as
  caller-not-permitted) and never uses the password path. Upgrades never stop,
  kill, or hand off a running agent: killing one is harmless because agents
  perform no root mutation, and an activation already dispatched completes in
  the helper regardless.

## 9. One-time legacy migration

The previously shipped helper is unsigned and predates this contract; it
cannot `Retire`. On the first launch of this release over such an
installation, reconciliation classifies the socket peer — root, validation
**invalid** — as the legacy helper and writes zero protocol bytes to it. An
existing registration counts as the user's earlier opt-in, so migration is
automatic: unregister directly (§7 rule 3), register the bundled helper under
the same verification as any other registration, and proceed through the
normal approval flow if macOS asks again. A user who had explicitly disabled
the helper instead gets removal without replacement.

Only a completed **invalid** judgment authorizes this path. Inability to
reach a judgment authorizes nothing.

Migration is not guaranteed to be one run. A pre-contract GUI still running
in another login session obeys none of this contract and can re-register the
old helper underneath a migration in progress. That is why the classification
is re-derived from live observation every time and never latched: the next
reconciliation simply sees the legacy helper again and migrates again, until
no pre-contract GUI is left running.

Accepted residual risk: this unregister terminates the helper even if it is
mid-activation, and an old client's activation may race the unregister. For an
intact installation it happens exactly once — every contract-era helper
validates as valid and takes the `Retire` path, whatever its build ID, and a
validation error selects nothing. The same removal is deliberately reachable
for a contract-era helper whose signature stops validating (tampered or
corrupted bundle, revoked identity): an invalid root peer cannot prove a
drain — no reply from it can be trusted — so removal is the only sound
direction. Such a helper is treated exactly as legacy, interruption risk
included.

## 10. Residual risks and accepted limits

- **10.1 Legacy migration race** (§9): once for an intact installation, and again
  only if a contract-era helper's signature stops validating — an
  unverifiable root peer is removed, never drained.
- **10.2 Crash-relaunch windows**: between the `Retired` reply and unregister (§7
  rule 1), or between the final absence check and unregister (rule 2), the
  helper could crash or be relaunched `Idle` by launchd's `KeepAlive` and in
  principle admit a fresh activation before unregister lands. The
  immediately-before checks shrink both windows to the interval between check
  and call. Accepted.
- **10.3 Concurrent login sessions converge, not coordinate**: a second user's GUI
  (fast user switching) can interleave reconciliation with the first's.
  Same-build GUIs interleave at worst into a failed register or a failed
  verification, reported and repaired by the next attempt — which may be an
  automatic one on each session's own cadence, bounded per session by the rule
  in §8.6; a different-build
  **contract-era** GUI is displaced (§8) and cannot mutate at all. A
  pre-contract GUI has no such gate and can undo a migration step from a
  second session; convergence there comes from re-classifying live on every
  run, not from displacement. No cross-session lock. Accepted.
- **10.4 The password path is a point-in-time decision**: it is selected from the
  state observed at that moment. nixmac does not register a helper while a
  password activation it started is running — but it only knows one is running
  once that activation has been recorded, and the record is taken after the
  observation that selected the path — so nixmac's own reconciliation can
  complete a replacement in between and leave an eligible helper behind.
  Independent actors need no such window and are not bounded by it: a user
  approving the helper in Login Items, or a `KeepAlive` relaunch after a
  positive-absence observation, can make one eligible at any moment while the
  password activation runs. Either way a scheduled sync-agent run could then
  activate alongside it. Accepted, and closing the record gap would remove only
  the first of the two.
- **10.5 Retirement as denial of convenience**: `Retire` is accepted from any
  authenticated GUI, any build, any location — that breadth is what makes
  cross-build upgrades work. A signature-valid nixmac copy run by any local
  user can therefore retire the helper. Bounded: no privilege gained, no
  activation interrupted, automatic recovery at the next reconciliation.
  Accepted.
- **10.6 Disable completes at the next GUI run**: if the GUI crashes between
  recording the disable and finishing the removal, the still-enabled helper
  keeps serving scheduled sync-agent activations until the next GUI run
  resumes the removal (Apply refuses meanwhile). Bounded by that next run;
  Disable is a preference, not a security boundary. Accepted.
- **10.7 Same-build-ID development rebuilds are invisible** to build-ID-based
  identity. Developers use the explicit Disable/Grant workflow. No
  byte-level code identity is added to compensate.
- **10.8 Connection slots are finite**: the helper accepts four connections at a
  time, and a long activation plus a replacement's held-open `Retire`
  connection already occupy two. Beyond the cap a client sees only a closed
  connection and re-observes later, so a local actor holding slots open can
  stall reconciliation and Apply. Bounded: no privilege gained, no activation
  interrupted, and it clears as soon as those clients close or the machine
  reboots. Accepted.
- **10.9 A wedged helper** — unresponsive, or `Busy(X)` forever because an
  activation truly hangs — is never force-killed. Apply blocks until §5's bound
  expires, then reports an unknown outcome; a later apply is refused `Busy(X)`
  for as long as the activation hangs. The documented recovery is a reboot,
  after which reconciliation converges from observed state.
- **10.10 A result can outlive its reader**: quitting or relaunching the GUI while
  an apply runs loses that activation's result (unknown outcome). The
  activation itself always completes under invariant 1.
- **10.11 Unregister can race a result reply**: X's transition to `Retired` becomes
  observable to a concurrent `Retire` before X's result bytes are written, so
  in principle a `Retire`/unregister pair could terminate the helper between
  the two and leave the apply client reporting an unknown outcome for an
  activation that actually finished. The window is the width of one reply
  write against a full unregister round trip. Nothing is mutated twice and
  invariant 1 is untouched — only the reporting is lost. Accepted, in
  preference to delaying the transition, which is what lets a client holding a
  result re-dispatch immediately.

______________________________________________________________________

## Appendix: design evidence (non-normative)

Added 2026-08-04, after this design was adversarially challenged with
simpler alternatives. This appendix binds nothing; it records what the
rules above rest on, so the next simplification attempt starts from the
evidence instead of rediscovering it.

The load-bearing platform facts, and what each one forces:

- **A replaced daemon executable requires re-registration or the service
  may not launch.** Apple's normative `SMAppService` class documentation
  states that updating a bundled LaunchDaemon executable or property list
  requires re-registration, and recommends unregistering first when the
  executable changed. This forces an upgrade to be unregister → register
  with the GUI as the sole actor — §2.5's shape and §8.5 are consequences
  of the platform, not conventions. It rules out every design in which
  launchd itself starts the new build: on-demand socket activation, and a
  helper that exits upon observing its bundle replaced so that
  `KeepAlive` relaunches the new binary, both depend on launchd
  relaunching a replaced executable without re-registration — the exact
  case Apple documents as unsupported, and one that strands the
  installation with no helper and no actor left to repair it.
- **Unregister terminates the process; its completion callback signals
  process termination.** (Apple's `unregister` documentation.) That
  documentation promises nothing about application-level work — the
  callback is not a transaction barrier for an activation in flight.
  This is the drain protocol's entire justification: a running
  activation must be proven finished
  before unregister, and for a live, verifiable helper only the helper
  itself can prove that — §2.5, §5's `Retire`, §7 rule 1. Rules 2 and 3
  unregister without that proof precisely where no live verifiable
  helper exists to give it, under §10.1's and §10.2's accepted risks.
- **Apple declines to guarantee that unregister/re-register never
  requires renewed user approval.** (Apple DTS, explicitly declining to
  prove that negative.) §8.6's treatment of post-replacement
  `requiresApproval` as a normal pending state rests on this, and any
  redesign would keep it.

What this means for future challenges: the drain protocol is the direct
consequence of the first two facts plus exactly one architectural
choice — the helper is also the process that executes the activation.
Only that choice is revisable: an executor detached from the helper
process, surviving unregister, would make helper replacement harmless by
construction. Revising it is only worthwhile **before** the first
release of this contract — once one build carrying the frozen surface
(§4) ships, that surface is a permanent commitment whatever replaces the
rest.

The challenge also surfaced one sub-window worth naming: the helper
performs post-activation maintenance (updating the system profile to
point at the activated generation) after a successful activation, and
§9's rule-3 unregister can land between the two — the activation
succeeded, but the system profile still names the previous generation.
This is a narrower sub-window of §10.1's accepted interruption risk with
a distinct consequence, noted here so §10.1's acceptance is read as
including it knowingly.
