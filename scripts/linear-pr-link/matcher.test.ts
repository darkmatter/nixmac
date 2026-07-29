import { describe, expect, test } from "bun:test";
import {
  evaluateLinearLink,
  parseExemption,
  stripNonPolicyText,
} from "./matcher.ts";

const base = {
  title: "",
  body: "",
  branch: "feature/something",
  authorLogin: "farhankhalaf",
  isDraft: false,
};

describe("stripNonPolicyText", () => {
  test("removes HTML comments", () => {
    expect(stripNonPolicyText("hello <!-- #no-linear: secret --> world")).toBe(
      "hello  world",
    );
  });

  test("removes fenced code blocks", () => {
    expect(stripNonPolicyText("a\n```\nRelated to ENG-1\n```\nb")).toBe(
      "a\n\nb",
    );
  });

  test("removes inline code spans", () => {
    expect(stripNonPolicyText("Document `Related to ENG-123` syntax")).toBe(
      "Document  syntax",
    );
  });

  test("removes unterminated fenced code through end of body", () => {
    expect(stripNonPolicyText("Visible\n```\nRelated to ENG-123")).toBe(
      "Visible\n",
    );
  });

  test("removes unterminated HTML comments through end of body", () => {
    expect(stripNonPolicyText("Visible\n<!-- Related to ENG-123")).toBe(
      "Visible\n",
    );
  });

  test("removes unterminated inline code through end of body", () => {
    expect(stripNonPolicyText("Document `Related to ENG-123")).toBe(
      "Document ",
    );
  });

  test("removes indented Markdown code blocks", () => {
    expect(stripNonPolicyText("Visible\n    Related to ENG-123\nDone")).toBe(
      "Visible\n\nDone",
    );
    expect(stripNonPolicyText("Visible\n\tRelated to ENG-123\nDone")).toBe(
      "Visible\n\nDone",
    );
  });

  test("removes HTML code elements", () => {
    expect(
      stripNonPolicyText(
        'Document <code class="example">Related to ENG-123</code> syntax',
      ),
    ).toBe("Document \n syntax");
    expect(stripNonPolicyText("<pre>Related to ENG-123</pre>")).toBe("\n");
  });
});

describe("parseExemption", () => {
  test("requires same-line reason", () => {
    expect(parseExemption("#no-linear: chore only")).toBe("chore only");
  });

  test("rejects bare #no-linear", () => {
    expect(parseExemption("#no-linear\nRelated stuff")).toBeNull();
  });

  test("rejects empty reason", () => {
    expect(parseExemption("#no-linear:   ")).toBeNull();
  });

  test("rejects placeholder reason", () => {
    expect(parseExemption("#no-linear: <reason>")).toBeNull();
  });

  test("does not match across lines via whitespace", () => {
    expect(parseExemption("#no-linear:\nchore only")).toBeNull();
  });
});

describe("evaluateLinearLink — success paths", () => {
  test("title-only ENG-1", () => {
    const r = evaluateLinearLink({ ...base, title: "feat: foo (ENG-1)" });
    expect(r.policySatisfied).toBe(true);
    expect(r.ciAllowed).toBe(true);
    expect(r.matchedIds).toContain("ENG-1");
  });

  test("branch eng-490 with separator", () => {
    const r = evaluateLinearLink({
      ...base,
      branch: "fkb/eng-494-guided-setup",
    });
    expect(r.policySatisfied).toBe(true);
    expect(r.matchedIds).toContain("ENG-494");
  });

  test("branch eng490 without separator", () => {
    const r = evaluateLinearLink({
      ...base,
      branch: "andrew/eng490-homebrew-onboarding",
    });
    expect(r.policySatisfied).toBe(true);
    expect(r.matchedIds).toContain("ENG-490");
  });

  test("body Related to ENG-1", () => {
    const r = evaluateLinearLink({
      ...base,
      body: "Summary\n\nRelated to ENG-1\n",
    });
    expect(r.policySatisfied).toBe(true);
    expect(r.matchedIds).toContain("ENG-1");
  });

  test("body magic word and ID on separate lines does not link", () => {
    const r = evaluateLinearLink({
      ...base,
      body: "Related to\n\nENG-123\n",
    });
    expect(r.policySatisfied).toBe(false);
  });

  test("body Fixed ENG-1", () => {
    const r = evaluateLinearLink({ ...base, body: "Fixed ENG-9" });
    expect(r.policySatisfied).toBe(true);
    expect(r.matchedIds).toContain("ENG-9");
  });

  test("body Refs ENG-1", () => {
    const r = evaluateLinearLink({ ...base, body: "Refs ENG-502" });
    expect(r.policySatisfied).toBe(true);
  });

  test("body linear issue ENG-1", () => {
    const r = evaluateLinearLink({ ...base, body: "linear issue ENG-12" });
    expect(r.policySatisfied).toBe(true);
  });

  test("body magic word + linear.app URL", () => {
    const r = evaluateLinearLink({
      ...base,
      body: "Related to https://linear.app/darkmatter/issue/ENG-490/title",
    });
    expect(r.policySatisfied).toBe(true);
    expect(r.matchedIds).toContain("ENG-490");
  });

  test("LAB team allowed", () => {
    const r = evaluateLinearLink({ ...base, title: "chore (LAB-10)" });
    expect(r.policySatisfied).toBe(true);
    expect(r.matchedIds).toContain("LAB-10");
  });

  test("multiple IDs", () => {
    const r = evaluateLinearLink({
      ...base,
      body: "Related to ENG-1 and Fixes ENG-2",
    });
    expect(r.policySatisfied).toBe(true);
    expect(r.matchedIds).toEqual(expect.arrayContaining(["ENG-1", "ENG-2"]));
  });

  test("#no-linear: reason exempts", () => {
    const r = evaluateLinearLink({
      ...base,
      body: "#no-linear: dependabot-adjacent tooling",
    });
    expect(r.policySatisfied).toBe(true);
    expect(r.exemption).toContain("dependabot");
  });

  test("dependabot exempt", () => {
    const r = evaluateLinearLink({
      ...base,
      authorLogin: "dependabot[bot]",
      title: "chore(deps): bump x",
    });
    expect(r.policySatisfied).toBe(true);
  });

  test("renovate exempt", () => {
    const r = evaluateLinearLink({
      ...base,
      authorLogin: "renovate[bot]",
    });
    expect(r.policySatisfied).toBe(true);
  });
});

describe("evaluateLinearLink — failure paths", () => {
  test("missing everything", () => {
    const r = evaluateLinearLink({ ...base });
    expect(r.policySatisfied).toBe(false);
    expect(r.ciAllowed).toBe(false);
    expect(r.softDraft).toBe(false);
  });

  test("bare body ENG-1 without magic word", () => {
    const r = evaluateLinearLink({ ...base, body: "See ENG-1 for details" });
    expect(r.policySatisfied).toBe(false);
  });

  test("FOO-1 not allowed team", () => {
    const r = evaluateLinearLink({ ...base, title: "feat FOO-1" });
    expect(r.policySatisfied).toBe(false);
  });

  test("vitest-3 branch is not a linear id", () => {
    const r = evaluateLinearLink({
      ...base,
      branch: "dependabot/npm_and_yarn/apps/native/vitest-3.2.6",
      authorLogin: "someone",
    });
    expect(r.policySatisfied).toBe(false);
  });

  test("placeholder ENG-___ not an id", () => {
    const r = evaluateLinearLink({
      ...base,
      body: "Related to ENG-___",
    });
    expect(r.policySatisfied).toBe(false);
  });

  test("HTML comment cannot exempt", () => {
    const r = evaluateLinearLink({
      ...base,
      body: "Summary\n\n<!-- #no-linear: fake -->\n",
    });
    expect(r.policySatisfied).toBe(false);
  });

  test("HTML comment cannot link", () => {
    const r = evaluateLinearLink({
      ...base,
      body: "Summary\n\n<!-- Related to ENG-99 -->\n",
    });
    expect(r.policySatisfied).toBe(false);
  });

  test("code fence cannot link", () => {
    const r = evaluateLinearLink({
      ...base,
      body: "```\nRelated to ENG-99\n```\n",
    });
    expect(r.policySatisfied).toBe(false);
  });

  test("inline code cannot link", () => {
    const r = evaluateLinearLink({
      ...base,
      body: "Document `Related to ENG-99` syntax",
    });
    expect(r.policySatisfied).toBe(false);
  });

  test("unterminated hidden blocks cannot link", () => {
    for (const body of [
      "```\nRelated to ENG-99",
      "<!-- Related to ENG-99",
      "`Related to ENG-99",
    ]) {
      expect(evaluateLinearLink({ ...base, body }).policySatisfied).toBe(false);
    }
  });

  test("indented and HTML code cannot link", () => {
    for (const body of [
      "    Related to ENG-99",
      "\tRelated to ENG-99",
      "<code>Related to ENG-99</code>",
      "<pre>Related to ENG-99</pre>",
    ]) {
      expect(evaluateLinearLink({ ...base, body }).policySatisfied).toBe(false);
    }
  });

  test("#trivial is not an exemption", () => {
    const r = evaluateLinearLink({ ...base, body: "#trivial\n" });
    expect(r.policySatisfied).toBe(false);
  });

  test("bare #no-linear without reason fails", () => {
    const r = evaluateLinearLink({ ...base, body: "#no-linear\n" });
    expect(r.policySatisfied).toBe(false);
  });

  test("darkmatter[bot] not exempt", () => {
    const r = evaluateLinearLink({
      ...base,
      authorLogin: "darkmatter[bot]",
      title: "feat: agent change",
    });
    expect(r.policySatisfied).toBe(false);
  });

  test("skip ENG-1 suppresses title link", () => {
    const r = evaluateLinearLink({
      ...base,
      title: "feat (ENG-1)",
      body: "skip ENG-1",
    });
    expect(r.policySatisfied).toBe(false);
    expect(r.skippedIds).toContain("ENG-1");
  });

  test("ignore ENG-1 suppresses branch link", () => {
    const r = evaluateLinearLink({
      ...base,
      branch: "eng-1-fix",
      body: "ignore ENG-1",
    });
    expect(r.policySatisfied).toBe(false);
  });
});

describe("evaluateLinearLink — draft soft path", () => {
  test("draft missing link: not policy-satisfied but ciAllowed", () => {
    const r = evaluateLinearLink({ ...base, isDraft: true });
    expect(r.policySatisfied).toBe(false);
    expect(r.ciAllowed).toBe(true);
    expect(r.softDraft).toBe(true);
  });

  test("non-draft WIP title missing link fails", () => {
    const r = evaluateLinearLink({
      ...base,
      title: "WIP: experiment",
      isDraft: false,
    });
    expect(r.policySatisfied).toBe(false);
    expect(r.ciAllowed).toBe(false);
  });
});
