#!/usr/bin/env bun
/**
 * CI entrypoint for the linear-pr-link required check.
 *
 * pull_request: evaluate title/body/branch/author/draft from the event.
 * merge_group: re-check every PR associated with the head SHA via the API
 *   (merge_group payloads do not include PR title/body). If no PRs are
 *   associated, allow with a notice — PR-stage is the admission gate.
 *
 * Local dry-run:
 *   PR_TITLE=... PR_BODY=... PR_BRANCH=... PR_AUTHOR=... PR_DRAFT=true \
 *     bun scripts/linear-pr-link/check.ts
 */

import { readFileSync } from "node:fs";
import { evaluateLinearLink, type LinearLinkInput } from "./matcher.ts";

type GhPull = {
  title?: string;
  body?: string | null;
  draft?: boolean;
  user?: { login?: string } | null;
  head?: { ref?: string } | null;
  number?: number;
  html_url?: string;
};

type EvalItem = { label: string; input: LinearLinkInput };

async function main(): Promise<void> {
  const resolved = await resolveInputs();
  if (resolved.kind === "allow") {
    console.log(resolved.message);
    process.exit(0);
  }

  const inputs = resolved.items;
  if (inputs.length === 0) {
    console.error("linear-pr-link: no PR metadata to evaluate");
    process.exit(1);
  }

  let failed = false;
  for (const { label, input } of inputs) {
    const result = evaluateLinearLink(input);
    const tag = label ? `[${label}] ` : "";
    if (result.ciAllowed) {
      if (result.softDraft) {
        console.log(`${tag}draft PR — advisory only: ${result.reason}`);
      } else {
        console.log(`${tag}ok: ${result.reason}`);
      }
      continue;
    }
    failed = true;
    console.error(`${tag}FAIL: ${result.reason}`);
  }

  process.exit(failed ? 1 : 0);
}

type Resolved =
  | { kind: "eval"; items: EvalItem[] }
  | { kind: "allow"; message: string };

async function resolveInputs(): Promise<Resolved> {
  if (process.env.PR_TITLE !== undefined || process.env.PR_BRANCH !== undefined) {
    return {
      kind: "eval",
      items: [
        {
          label: "env",
          input: {
            title: process.env.PR_TITLE ?? "",
            body: process.env.PR_BODY ?? "",
            branch: process.env.PR_BRANCH ?? "",
            authorLogin: process.env.PR_AUTHOR ?? "",
            isDraft: process.env.PR_DRAFT === "true",
          },
        },
      ],
    };
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    console.error("linear-pr-link: set GITHUB_EVENT_PATH or PR_* env vars");
    process.exit(1);
  }

  const event = JSON.parse(readFileSync(eventPath, "utf8")) as Record<string, unknown>;
  const eventName = process.env.GITHUB_EVENT_NAME ?? "";

  if (eventName === "pull_request" || event.pull_request) {
    const pr = (event.pull_request ?? {}) as GhPull;
    return {
      kind: "eval",
      items: [
        {
          label: pr.number ? `PR #${pr.number}` : "pull_request",
          input: {
            title: pr.title ?? "",
            body: pr.body ?? "",
            branch: pr.head?.ref ?? "",
            authorLogin: pr.user?.login ?? "",
            isDraft: pr.draft === true,
          },
        },
      ],
    };
  }

  if (eventName === "merge_group" || event.merge_group) {
    return resolveMergeGroup(event);
  }

  console.error(`linear-pr-link: unsupported event ${eventName || "(unknown)"}`);
  process.exit(1);
}

async function resolveMergeGroup(event: Record<string, unknown>): Promise<Resolved> {
  const mg = (event.merge_group ?? {}) as { head_sha?: string; head_ref?: string };
  const headSha = mg.head_sha;
  if (!headSha) {
    console.error("linear-pr-link: merge_group missing head_sha");
    process.exit(1);
  }

  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!repo || !token) {
    return {
      kind: "allow",
      message:
        `linear-pr-link: merge_group without GITHUB_TOKEN — allowing ` +
        `(PR-stage gate is authoritative; head ${headSha.slice(0, 7)})`,
    };
  }

  const url = `https://api.github.com/repos/${repo}/commits/${headSha}/pulls`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "nixmac-linear-pr-link",
    },
  });

  if (!res.ok) {
    console.error(
      `linear-pr-link: failed to list PRs for ${headSha}: ${res.status} ${await res.text()}`,
    );
    process.exit(1);
  }

  const pulls = (await res.json()) as GhPull[];
  if (!Array.isArray(pulls) || pulls.length === 0) {
    return {
      kind: "allow",
      message:
        `linear-pr-link: no PRs associated with ${headSha.slice(0, 7)}; ` +
        "allowing (PR-stage gate is authoritative for merge-queue admission)",
    };
  }

  return {
    kind: "eval",
    items: pulls.map((pr) => ({
      label: pr.number ? `PR #${pr.number}` : (pr.html_url ?? "pr"),
      input: {
        title: pr.title ?? "",
        body: pr.body ?? "",
        branch: pr.head?.ref ?? "",
        authorLogin: pr.user?.login ?? "",
        isDraft: pr.draft === true,
      },
    })),
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
