# Product Proof And Eval Suite

Product Proof is nixmac's strongest app-level evidence lane, but it is currently
stale/advisory per ADR 0002.

## Current Contract

The durable operational docs live under `tests/e2e/computer-use/`:

- `README.md` - Product Proof policy and PR workflow.
- `ARCHITECTURE.md` - modularization and preservation contract.
- `OPERATIONS.md` - remote Mac operations playbook.
- `coverage-manifest.json` - scenario coverage map.
- `scenario-catalog.mjs` - scenario metadata.

## What It Proves When Fresh

Product Proof can drive the macOS app through real user journeys, collect
screenshots/text snapshots/video/report evidence, and show uncertainty rather
than hiding weak or stale proof.

## Current Use

- Do not run Product Proof as part of normal docs or code review unless a
  maintainer explicitly asks.
- Do not claim Product Proof passed from old artifacts.
- For Product Proof refresh work, start from the existing README, architecture,
  operations, coverage manifest, and scenario catalog.

## AI Eval Suite

The AI eval suite is distinct from Product Proof. It measures evolve-agent
quality against scenario prompts and expected outcomes. It should support:

- multiple starting configurations, including real-ish multi-host repos;
- model/provider comparison with timestamped provider identity;
- case-level HTML or structured reports humans can inspect;
- timing, token, retry, and cost fields where available;
- custom oracles when configs differ;
- nonblocking PR comments before any deterministic merge gate is justified.

Do not use scenarios distilled into docs as held-out scoring tasks. Do not store
live evaluation credential homes under the repo tree; use temp directories for
OAuth/provider state or purge token files before preserving reports.

## Future Refresh Criteria

Before promotion back to a required gate:

- current same-SHA workflow evidence exists;
- stale queued runs skip before touching the remote Mac;
- singleton Mac capacity and host rotation are owned;
- screenshots/text/video/report sections render reliably;
- real-world user-config cases and multi-config scenarios are represented;
- override policy is tested and documented.
