/**
 * Shared Linear ↔ PR link policy for nixmac.
 *
 * Contract for agents / PR-create tools:
 * - Pass a Linear issue id (ENG-N / LAB-N) or an explicit `#no-linear: <reason>`
 * - Prefer body line: `Related to ENG-N` (non-closing) and title suffix `(ENG-N)`
 *
 * Used by Danger and the `linear-pr-link` GitHub Action.
 */

export const ALLOWED_TEAMS = ["ENG", "LAB"] as const;
export type AllowedTeam = (typeof ALLOWED_TEAMS)[number];

export const EXEMPT_BOT_LOGINS = new Set(["dependabot[bot]", "renovate[bot]"]);

/** Linear magic words that attach a PR to an issue (closing + non-closing). */
const MAGIC_WORDS = [
  "close",
  "closes",
  "closed",
  "closing",
  "fix",
  "fixes",
  "fixed",
  "fixing",
  "resolve",
  "resolves",
  "resolved",
  "resolving",
  "complete",
  "completes",
  "completed",
  "completing",
  "implement",
  "implements",
  "implemented",
  "implementing",
  "ref",
  "refs",
  "references",
  "part of",
  "related to",
  "relates to",
  "contributes to",
  "toward",
  "towards",
  "linear issue",
] as const;

/** Words that tell Linear *not* to link even if branch/title mention the ID. */
const UNLINK_WORDS = ["skip", "ignore"] as const;

const TEAM_ALT = ALLOWED_TEAMS.join("|");

/** Canonical ID: ENG-123 / LAB-456 */
const CANONICAL_ID_RE = new RegExp(`\\b(?:${TEAM_ALT})-(\\d+)\\b`, "gi");

/**
 * Branch forms used in the wild: eng-494, eng_494, eng490 (no separator).
 * Captures team + number for normalization to TEAM-N.
 */
const BRANCH_ID_RE = new RegExp(
  `(?:^|[^A-Za-z0-9])(?:${TEAM_ALT})[-_]?(\\d+)\\b`,
  "gi",
);

const MAGIC_WORD_ALT = MAGIC_WORDS.map(escapeRegExp).join("|");
const UNLINK_WORD_ALT = UNLINK_WORDS.map(escapeRegExp).join("|");

/** Magic word + canonical ID, or magic word + linear.app URL containing the ID. */
const MAGIC_LINK_RE = new RegExp(
  `\\b(?:${MAGIC_WORD_ALT})\\s+(?:(?:${TEAM_ALT})-(\\d+)|https?://linear\\.app/[^\\s]*?/(?:issue|issues)/(?:${TEAM_ALT})-(\\d+)(?:\\b|/|\\?))`,
  "gi",
);

const UNLINK_RE = new RegExp(
  `\\b(?:${UNLINK_WORD_ALT})\\s+(?:${TEAM_ALT})-(\\d+)\\b`,
  "gi",
);

/** Same-line exemption: `#no-linear: reason` — spaces/tabs only after colon (no newlines). */
const EXEMPTION_LINE_RE = /^[^\S\n]*#no-linear:[ \t]*(\S[^\n]*)$/im;

export type LinearLinkInput = {
  title: string;
  body: string;
  branch: string;
  authorLogin?: string;
  isDraft?: boolean;
};

export type LinearLinkResult = {
  /** Policy satisfied (linked, exempt bot, or reasoned exemption). */
  policySatisfied: boolean;
  /** CI / required-check may pass (policy satisfied OR draft soft path). */
  ciAllowed: boolean;
  /** Draft missing link — Danger should warn; Action succeeds. */
  softDraft: boolean;
  reason: string;
  matchedIds: string[];
  skippedIds: string[];
  exemption: string | null;
};

export function evaluateLinearLink(input: LinearLinkInput): LinearLinkResult {
  const title = input.title ?? "";
  const branch = input.branch ?? "";
  const authorLogin = input.authorLogin ?? "";
  const isDraft = input.isDraft === true;
  const bodyVisible = stripNonPolicyText(input.body ?? "");

  if (EXEMPT_BOT_LOGINS.has(authorLogin)) {
    return {
      policySatisfied: true,
      ciAllowed: true,
      softDraft: false,
      reason: `Exempt bot author \`${authorLogin}\``,
      matchedIds: [],
      skippedIds: [],
      exemption: null,
    };
  }

  const exemption = parseExemption(bodyVisible);
  if (exemption) {
    return {
      policySatisfied: true,
      ciAllowed: true,
      softDraft: false,
      reason: `Exempt via #no-linear: ${exemption}`,
      matchedIds: [],
      skippedIds: [],
      exemption,
    };
  }

  // Bare `#no-linear` without reason — not exempt
  if (/#no-linear\b/i.test(bodyVisible) && !exemption) {
    // fall through; still may have a real link
  }

  const skippedIds = uniqueIds(findAll(UNLINK_RE, bodyVisible, normalizeUnlink));
  const titleIds = uniqueIds(findAll(CANONICAL_ID_RE, title, normalizeCanonical));
  const branchIds = uniqueIds(findBranchIds(branch));
  const bodyMagicIds = uniqueIds(findAll(MAGIC_LINK_RE, bodyVisible, normalizeMagic));

  const linked = uniqueIds([...titleIds, ...branchIds, ...bodyMagicIds]).filter(
    (id) => !skippedIds.includes(id),
  );

  if (linked.length > 0) {
    return {
      policySatisfied: true,
      ciAllowed: true,
      softDraft: false,
      reason: `Linked via ${linked.join(", ")}`,
      matchedIds: linked,
      skippedIds,
      exemption: null,
    };
  }

  if (skippedIds.length > 0 && titleIds.length + branchIds.length > 0) {
    // Explicit skip/ignore of the only IDs present
    const msg =
      `Linear link suppressed by skip/ignore for ${skippedIds.join(", ")}. ` +
      `Add a different issue ref or \`#no-linear: <reason>\`.`;
    return failResult(msg, [], skippedIds, isDraft);
  }

  const msg =
    "No Linear issue reference found. Add `ENG-123` (or `LAB-123`) to the PR title or branch, " +
    "or a magic-word line in the body such as `Related to ENG-123`, " +
    "or `#no-linear: <reason>` if intentionally untracked.";
  return failResult(msg, [], skippedIds, isDraft);
}

function failResult(
  reason: string,
  matchedIds: string[],
  skippedIds: string[],
  isDraft: boolean,
): LinearLinkResult {
  return {
    policySatisfied: false,
    ciAllowed: isDraft,
    softDraft: isDraft,
    reason,
    matchedIds,
    skippedIds,
    exemption: null,
  };
}

/** Strip HTML comments and fenced code blocks so templates/snippets cannot satisfy the gate. */
export function stripNonPolicyText(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "");
}

export function parseExemption(bodyVisible: string): string | null {
  const m = bodyVisible.match(EXEMPTION_LINE_RE);
  if (!m) {
    return null;
  }
  const reason = m[1]?.trim() ?? "";
  // Reject pure placeholders
  if (!reason || /^<?reason>?$/i.test(reason) || /^_+$/.test(reason)) {
    return null;
  }
  return reason;
}

function findBranchIds(branch: string): string[] {
  const out: string[] = [];
  const re = new RegExp(BRANCH_ID_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(branch)) !== null) {
    // m[0] includes possible leading separator; re-parse team from match
    const chunk = m[0].replace(/^[^A-Za-z]+/, "");
    const parts = chunk.match(new RegExp(`^(${TEAM_ALT})[-_]?(\\d+)$`, "i"));
    if (parts) {
      out.push(`${parts[1].toUpperCase()}-${parts[2]}`);
    }
  }
  return out;
}

function findAll(
  re: RegExp,
  text: string,
  normalize: (m: RegExpExecArray) => string | null,
): string[] {
  const out: string[] = [];
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const local = new RegExp(re.source, flags);
  let m: RegExpExecArray | null;
  while ((m = local.exec(text)) !== null) {
    const id = normalize(m);
    if (id) {
      out.push(id);
    }
  }
  return out;
}

function normalizeCanonical(m: RegExpExecArray): string | null {
  const full = m[0];
  const num = m[1];
  const team = full.split("-")[0]?.toUpperCase();
  if (!team || !num || !isAllowedTeam(team)) {
    return null;
  }
  return `${team}-${num}`;
}

function normalizeMagic(m: RegExpExecArray): string | null {
  const num = m[1] ?? m[2];
  if (!num) {
    return null;
  }
  // Recover team from full match
  const teamMatch = m[0].match(new RegExp(`(?:${TEAM_ALT})-(\\d+)`, "i"));
  if (!teamMatch) {
    return null;
  }
  return `${teamMatch[0].split("-")[0].toUpperCase()}-${teamMatch[1]}`;
}

function normalizeUnlink(m: RegExpExecArray): string | null {
  const num = m[1];
  const teamMatch = m[0].match(new RegExp(`(?:${TEAM_ALT})-(\\d+)`, "i"));
  if (!teamMatch || !num) {
    return null;
  }
  return `${teamMatch[0].split("-")[0].toUpperCase()}-${num}`;
}

function isAllowedTeam(team: string): boolean {
  return (ALLOWED_TEAMS as readonly string[]).includes(team.toUpperCase());
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
