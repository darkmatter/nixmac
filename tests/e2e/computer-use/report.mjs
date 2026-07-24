import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { curatedProofKeys, scenarioGroups, screenshotAnnotations } from "./scenario-catalog.mjs";
import { failureTaxonomy } from "./schemas.mjs";
import { redact } from "./redaction.mjs";
import { formatDuration, sortedTimingPhases, timingTotals } from "./timing.mjs";

function escapeHtml(value) {
  return redact(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function statusRank(status) {
  return { fail: 0, inconclusive: 1, pass: 2, not_required: 3 }[status] ?? 4;
}

function statusCounts(state) {
  const counts = { pass: 0, fail: 0, inconclusive: 0, not_required: 0 };
  for (const scenario of Object.values(state.scenarios)) {
    counts[scenario.status] = (counts[scenario.status] ?? 0) + 1;
  }
  return counts;
}

function groupedScenarios(state) {
  const seen = new Set();
  const groups = scenarioGroups.map((group) => {
    for (const key of group.keys) seen.add(key);
    return {
      ...group,
      items: group.keys
        .filter((key) => state.scenarios[key])
        .map((key) => ({ key, ...state.scenarios[key] }))
        .sort((a, b) => statusRank(a.status) - statusRank(b.status)),
    };
  });
  const ungrouped = Object.entries(state.scenarios)
    .filter(([key]) => !seen.has(key))
    .map(([key, item]) => ({ key, ...item }))
    .sort((a, b) => statusRank(a.status) - statusRank(b.status));
  if (ungrouped.length)
    groups.push({ name: "Other", keys: ungrouped.map((item) => item.key), items: ungrouped });
  return groups;
}

function artifactLinks(state, key, proofForScenario) {
  const proof = proofForScenario(state, key);
  const screenshotLinks = proof.screenshotArtifacts.map(
    (artifact) =>
      `<a href="#screenshot-${escapeHtml(slugify(artifact.label || artifact.path))}"><code>${escapeHtml(artifact.path)}</code></a>`,
  );
  const textLinks = proof.textArtifacts.map(
    (artifact) =>
      `<a href="${escapeHtml(artifact.path)}" target="_blank" rel="noopener"><code>${escapeHtml(artifact.path)}</code></a>`,
  );
  const links = [...screenshotLinks, ...textLinks].join("<br>");
  return links ? `<div class="artifact-list">${links}</div>` : "No primary artifact linked.";
}

async function readTextExcerpt(state, artifact, maxLines = 10) {
  if (!artifact?.path) return "";
  const fullPath = path.join(state.runDir, artifact.path);
  if (!(await pathExists(fullPath))) return "";
  const text = redact(await readFile(fullPath, "utf8"));
  return text
    .split("\n")
    .filter((line) => line.trim())
    .slice(0, maxLines)
    .join("\n")
    .slice(0, 1400);
}

function knownCoverageGaps(state) {
  const gaps = [];
  for (const [key, scenario] of Object.entries(state.scenarios)) {
    if (scenario.status !== "pass" && scenario.status !== "not_required") {
      gaps.push({
        label: scenario.label,
        status: scenario.status,
        detail: scenario.notes.join(" ") || "No detail recorded.",
      });
    }
  }
  if (!state.remoteMachine || !state.remoteApp) {
    gaps.push({
      label: "Remote Mac/app metadata",
      status: "inconclusive",
      detail:
        "Remote machine identity, OS, hardware, staged app path, bundle version, and signing metadata were not captured.",
    });
  }
  if (!state.processEnvVerification) {
    gaps.push({
      label: "Credential process-env verification",
      status: "inconclusive",
      detail:
        "The nixmac process and GUI launchd credential environment were not checked with redacted values.",
    });
  }
  if (!state.safety?.disposableConfig) {
    gaps.push({
      label: "Disposable config proof",
      status: "inconclusive",
      detail: "Remote run has not proven nixmac is pointed at a per-run disposable config.",
    });
  }
  return gaps;
}

function coverageWaivers(state) {
  return state.coverageFreshness?.waivers || [];
}

function knownLimitCount(state) {
  return knownCoverageGaps(state).length + coverageWaivers(state).length;
}

function prSurfaceSummary(state) {
  const pr = state.prFocus || { configured: false, userVisibleFiles: [], scenarioKeys: [] };
  if (!pr.configured) {
    return {
      label: "No PR context",
      detail:
        "No PR metadata was provided, so this run proves baseline product behavior without PR-specific changed-file mapping.",
      status: "inconclusive",
    };
  }
  if (!pr.userVisibleFiles?.length) {
    return {
      label: "Docs/infra or unmapped surface",
      detail:
        "Changed-file metadata did not infer a user-visible app surface; baseline regression coverage still ran.",
      status: "pass",
    };
  }
  if (!pr.scenarioKeys?.length) {
    return {
      label: "User-visible, unmapped",
      detail: `${pr.userVisibleFiles.length} user-visible changed file(s) were inferred, but no dedicated Computer Use scenario mapping exists yet.`,
      status: "inconclusive",
    };
  }
  return {
    label: "Mapped user-visible PR",
    detail: `${pr.userVisibleFiles.length} user-visible changed file(s) mapped to ${pr.scenarioKeys.length} scenario(s).`,
    status: state.scenarios.prSpecificCoverage?.status || "inconclusive",
  };
}

function mergeConfidence(state, counts) {
  const limits = knownLimitCount(state);
  const prSurface = prSurfaceSummary(state);
  if (state.verdict === "fail" || counts.fail > 0) {
    return {
      label: "Not acceptable for E2E gate",
      action: "Inspect failures before approval.",
      detail: "At least one scenario or visual assertion failed.",
      tone: "fail",
    };
  }
  if (state.verdict !== "pass" || counts.inconclusive > 0) {
    return {
      label: "Needs human review",
      action: "Resolve inconclusive evidence before treating the gate as clean.",
      detail: "The run did not produce a clean deterministic pass.",
      tone: "inconclusive",
    };
  }
  if (prSurface.status === "inconclusive" && state.prFocus?.configured) {
    return {
      label: "Baseline pass; PR focus needs review",
      action: "Review PR focus and known limits before approval.",
      detail: prSurface.detail,
      tone: "inconclusive",
    };
  }
  return {
    label: "Acceptable for E2E gate",
    action: limits
      ? `Review ${limits} known limit${limits === 1 ? "" : "s"}, then approve if acceptable.`
      : "Approve if the linked proof matches the PR intent.",
    detail: "The remote run passed every recorded scenario and preserved inspectable evidence.",
    tone: "pass",
  };
}

function annotationClass(item) {
  return ["annotation", item.tone ? `annotation-${item.tone}` : ""].filter(Boolean).join(" ");
}

function annotationStyle(item) {
  if (item.tone === "pin") {
    return `left:${item.x}%;top:${item.y}%;width:16px;height:16px;transform:translate(-50%,-50%)`;
  }
  return `left:${item.x}%;top:${item.y}%;width:${item.w}%;height:${item.h}%`;
}

function renderAnnotatedImage(shot) {
  const annotations = screenshotAnnotations[shot.label] || [];
  const imageSize = shot.imageSize
    ? `${shot.imageSize.width}x${shot.imageSize.height}`
    : "unknown-size";
  const overlays = annotations
    .map(
      (item) =>
        `<span class="${annotationClass(item)}" style="${annotationStyle(item)}"><span>${escapeHtml(item.label)}</span></span>`,
    )
    .join("\n");
  return `<div class="annotated-shot" data-image-size="${escapeHtml(imageSize)}">
  <img src="${escapeHtml(shot.path)}" alt="${escapeHtml(shot.label)}">
  ${overlays}
</div>`;
}

async function renderVisualProofCards(state, keys, proofForScenario) {
  const cards = [];
  for (const key of keys) {
    const scenario = state.scenarios[key];
    if (!scenario) continue;
    const proof = proofForScenario(state, key);
    if (proof.screenshotArtifacts.length === 0 && proof.textArtifacts.length === 0) continue;
    const screenshots = proof.screenshotArtifacts
      .slice(0, 2)
      .map(
        (shot) =>
          `<figure>${renderAnnotatedImage(shot)}<figcaption><strong>${escapeHtml(shot.label)}</strong> - ${escapeHtml(shot.note || "")}</figcaption></figure>`,
      )
      .join("\n");
    const excerpts = [];
    for (const artifact of proof.textArtifacts.slice(0, 2)) {
      const excerpt = await readTextExcerpt(state, artifact);
      if (excerpt)
        excerpts.push(
          `<details><summary>${escapeHtml(artifact.path)}</summary><pre>${escapeHtml(excerpt)}</pre></details>`,
        );
    }
    cards.push(`<section class="proof-card">
  <h3>${escapeHtml(scenario.label)}</h3>
  <p><span class="verdict ${scenario.status}">${escapeHtml(scenario.status)}</span> <span class="grade">${escapeHtml(proof.grade)}</span></p>
  <p><strong>Assertion:</strong> ${escapeHtml(proof.proof)}</p>
  <p><strong>Not proved:</strong> ${escapeHtml(proof.untested)}</p>
  ${screenshots}
  ${excerpts.join("\n")}
</section>`);
  }
  return cards.length ? cards.join("\n") : "<p>No visual proof cards generated.</p>";
}

async function renderVisualProofBoard(state, proofForScenario) {
  const prKeys = new Set(state.prFocus?.scenarioKeys || []);
  const nonPassKeys = Object.entries(state.scenarios)
    .filter(([, scenario]) => scenario.status !== "pass")
    .map(([key]) => key);
  const settingsFocused = [...prKeys].some((key) => /^settings/.test(key));
  const defaultKeys = [
    ...nonPassKeys,
    ...curatedProofKeys.filter(
      (key) => !/^settings/.test(key) || settingsFocused || state.scenarios[key]?.status !== "pass",
    ),
    ...[...prKeys],
  ];
  const uniqueDefaultKeys = [...new Set(defaultKeys)].filter((key) => state.scenarios[key]);
  const allKeys = Object.keys(state.scenarios);
  const additionalKeys = allKeys.filter((key) => !uniqueDefaultKeys.includes(key));
  const defaultCards = await renderVisualProofCards(state, uniqueDefaultKeys, proofForScenario);
  const additionalCards = await renderVisualProofCards(state, additionalKeys, proofForScenario);
  return `<section class="proof-priority">
    ${defaultCards}
    <details>
      <summary>Additional passing visual/text proof (${escapeHtml(String(additionalKeys.length))})</summary>
      ${additionalCards}
    </details>
  </section>`;
}

function renderCoverageGaps(state) {
  const gaps = [
    ...coverageWaivers(state).map((waiver) => ({
      label: waiver.label || waiver.id,
      status: waiver.risk === "high" ? "fail" : "inconclusive",
      detail: `Explicit waiver ${waiver.id || "unknown"} (${waiver.risk || "risk unset"}, owner ${waiver.owner || "unowned"}, review by ${waiver.reviewBy || "unset"}): ${waiver.reason || "No reason recorded."} Exit criteria: ${waiver.exitCriteria || "No exit criteria recorded."}`,
    })),
    ...knownCoverageGaps(state),
  ];
  if (!gaps.length) return "<p>No known runtime gaps or explicit waivers recorded.</p>";
  return `<table>
    <thead><tr><th>Known Limit</th><th>Status</th><th>Detail</th></tr></thead>
    <tbody>
      ${gaps.map((gap) => `<tr><td>${escapeHtml(gap.label)}</td><td><span class="verdict ${gap.status}">${escapeHtml(gap.status)}</span></td><td>${escapeHtml(gap.detail)}</td></tr>`).join("\n")}
    </tbody>
  </table>`;
}

function renderPrFocus(state) {
  const pr = state.prFocus || {
    configured: false,
    changedFiles: [],
    userVisibleFiles: [],
    scenarioKeys: [],
  };
  const changed = pr.changedFiles?.length
    ? pr.changedFiles.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join("\n")
    : "<li>No changed-file metadata provided.</li>";
  const userVisible = pr.userVisibleFiles?.length
    ? pr.userVisibleFiles.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join("\n")
    : "<li>No user-visible changed files inferred from current metadata.</li>";
  const scenarios = pr.scenarioKeys?.length
    ? pr.scenarioKeys
        .map((key) => `<li>${escapeHtml(state.scenarios?.[key]?.label || key)}</li>`)
        .join("\n")
    : "<li>No dedicated scenario mapping inferred from changed files.</li>";
  return `<section class="panel">
    <p><strong>PR:</strong> ${escapeHtml(pr.number || "not provided")} ${pr.title ? `- ${escapeHtml(pr.title)}` : ""}</p>
    <p><strong>Refs:</strong> ${escapeHtml(pr.baseRef || "base ?")} ← ${escapeHtml(pr.headRef || "head ?")}</p>
    <h3>User-Visible Focus Candidates</h3>
    <ul>${userVisible}</ul>
    <h3>Mapped Scenario Focus</h3>
    <ul>${scenarios}</ul>
    <details>
      <summary>Full changed-file list (${escapeHtml(String(pr.changedFiles?.length || 0))})</summary>
      <ul>${changed}</ul>
    </details>
  </section>`;
}

function scenarioRows(state, items, proofForScenario) {
  if (!items.length) return '<tr><td colspan="5">None.</td></tr>';
  return items
    .map((item) => {
      const proof = proofForScenario(state, item.key);
      const contract = state.v2?.scenarioContracts?.[item.key] || {};
      return `<tr><td class="scenario-cell">${escapeHtml(item.label)}<br><small>${item.notes.map(escapeHtml).join("<br>") || "No notes recorded."}</small></td><td class="status-cell"><span class="verdict ${item.status}">${escapeHtml(item.status)}</span></td><td class="grade-cell"><span class="grade">${escapeHtml(proof.grade)}</span><br><span class="strength strength-${escapeHtml(contract.evidenceStrength || "not-proved")}">${escapeHtml(contract.evidenceStrength || "not-proved")}</span></td><td class="artifact-cell">${artifactLinks(state, item.key, proofForScenario)}</td><td class="proof-cell">${escapeHtml(proof.proof)}${contract.failureClass ? `<br><small>Failure class: ${escapeHtml(contract.failureClass)}</small>` : ""}</td></tr>`;
    })
    .join("\n");
}

function scenariosWithStatus(state, status) {
  return Object.entries(state.scenarios)
    .filter(([, item]) => item.status === status)
    .map(([key, item]) => ({ key, ...item }));
}

function renderPriorityTriage(state, proofForScenario) {
  const failed = scenariosWithStatus(state, "fail");
  const inconclusive = scenariosWithStatus(state, "inconclusive");
  const passed = scenariosWithStatus(state, "pass");
  const table = (items) => `<div class="table-scroll"><table class="scenario-table">
    <thead><tr><th class="scenario-col">Scenario</th><th class="status-col">Status</th><th class="grade-col">Evidence Grade</th><th class="artifacts-col">Primary Artifacts</th><th class="proof-col">What Proved It / Why It Matters</th></tr></thead>
    <tbody>${scenarioRows(state, items, proofForScenario)}</tbody>
  </table></div>`;
  return `<section class="priority">
    <h3>Failures</h3>
    ${table(failed)}
    <h3>Inconclusive</h3>
    ${table(inconclusive)}
    <details>
      <summary>Passing Checks (${passed.length})</summary>
      ${table(passed)}
    </details>
  </section>`;
}

function renderPrPriority(state, proofForScenario) {
  const pr = state.prFocus || { configured: false, scenarioKeys: [] };
  if (!pr.configured)
    return `<h2 id="pull-request-focus">Pull Request Focus</h2>${renderPrFocus(state)}`;
  const keys = pr.scenarioKeys?.length ? pr.scenarioKeys : ["prSpecificCoverage"];
  const evidenceRows = keys
    .filter((key) => state.scenarios[key])
    .map((key) => ({ key, ...state.scenarios[key] }))
    .sort((a, b) => statusRank(a.status) - statusRank(b.status));
  return `<h2 id="pull-request-focus">Pull Request Focus</h2>
  ${renderPrFocus(state)}
  <section class="panel">
    <h3>PR-Relevant Evidence</h3>
    <div class="table-scroll"><table class="scenario-table">
      <thead><tr><th class="scenario-col">Scenario</th><th class="status-col">Status</th><th class="grade-col">Evidence Grade</th><th class="artifacts-col">Primary Artifacts</th><th class="proof-col">What Proved It</th></tr></thead>
      <tbody>${scenarioRows(state, evidenceRows, proofForScenario)}</tbody>
    </table></div>
  </section>`;
}

function verificationQueueItems(state) {
  const prKeys = new Set(state.prFocus?.scenarioKeys || []);
  const items = [];
  for (const [key, scenario] of Object.entries(state.scenarios || {})) {
    if (scenario.status === "fail")
      items.push({
        key,
        priority: 10,
        reason: "Blocking failure",
        action: "Inspect expected vs actual evidence.",
      });
    else if (scenario.status === "inconclusive")
      items.push({
        key,
        priority: 20,
        reason: "Inconclusive proof",
        action: "Decide whether this evidence gap blocks approval.",
      });
    else if (scenario.status !== "not_required" && prKeys.has(key))
      items.push({
        key,
        priority: 30,
        reason: "PR-focused scenario",
        action: "Verify this proof covers the changed user-visible surface.",
      });
  }
  for (const key of [
    "saveFlow",
    "rollbackCleanup",
    "visualProofQuality",
    "mainCoverageFreshness",
    "reportInspection",
  ]) {
    if (
      state.scenarios?.[key] &&
      state.scenarios[key].status !== "not_required" &&
      !items.some((item) => item.key === key)
    ) {
      items.push({
        key,
        priority: key === "rollbackCleanup" ? 40 : 50,
        reason: key === "rollbackCleanup" ? "Cleanup proof" : "Trust-critical proof",
        action:
          key === "mainCoverageFreshness"
            ? "Review explicit waivers and drift."
            : "Spot-check the linked primary artifacts.",
      });
    }
  }
  return items
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        statusRank(state.scenarios[a.key]?.status) - statusRank(state.scenarios[b.key]?.status),
    )
    .slice(0, 8);
}

function renderVerificationQueue(state, proofForScenario) {
  const items = verificationQueueItems(state);
  const rows = items.length
    ? items
        .map((item) => {
          const scenario = state.scenarios[item.key];
          const proof = proofForScenario(state, item.key);
          return `<tr id="verify-${escapeHtml(slugify(item.key))}">
            <td>${escapeHtml(item.reason)}<br><small>${escapeHtml(item.action)}</small></td>
            <td>${escapeHtml(scenario.label)}<br><small>${escapeHtml(scenario.notes.join(" ") || "No notes recorded.")}</small></td>
            <td><span class="verdict ${escapeHtml(scenario.status)}">${escapeHtml(scenario.status)}</span></td>
            <td>${artifactLinks(state, item.key, proofForScenario)}</td>
            <td>${escapeHtml(proof.proof)}<br><a class="back-link" href="#summary">Return to decision</a></td>
          </tr>`;
        })
        .join("\n")
    : '<tr><td colspan="5">No prioritized verification rows generated.</td></tr>';
  const limitRows = coverageWaivers(state)
    .map(
      (waiver) => `<tr>
        <td><span class="risk risk-${escapeHtml(waiver.risk || "medium")}">${escapeHtml(waiver.risk || "unset")}</span></td>
        <td>${escapeHtml(waiver.label || waiver.id)}<br><small><code>${escapeHtml(waiver.id || "")}</code></small></td>
        <td>${escapeHtml(waiver.reason || "No reason recorded.")}</td>
        <td>${escapeHtml(waiver.exitCriteria || "No exit criteria recorded.")}</td>
      </tr>`,
    )
    .join("\n");
  return `<h2 id="verification-queue">Verification Queue</h2>
  <section class="panel">
    <p>Review these rows first. They prioritize blockers, inconclusive checks, PR-focused scenarios, cleanup proof, known limits, and sampled core passes before the raw evidence dump.</p>
    <div class="table-scroll"><table class="scenario-table verification-table">
      <thead><tr><th>Why First</th><th>Scenario</th><th>Status</th><th>Primary Artifacts</th><th>What To Verify</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <details ${coverageWaivers(state).length ? "open" : ""}>
      <summary>Explicit waivers and known limits (${escapeHtml(String(coverageWaivers(state).length))})</summary>
      <div class="table-scroll"><table>
        <thead><tr><th>Risk</th><th>Limit</th><th>Reason</th><th>Exit Criteria</th></tr></thead>
        <tbody>${limitRows || '<tr><td colspan="4">No explicit waivers recorded.</td></tr>'}</tbody>
      </table></div>
    </details>
  </section>`;
}

function renderCoverageFreshness(state) {
  const coverage = state.coverageFreshness;
  if (!coverage) return "";
  const driftRows = coverage.drift?.length
    ? coverage.drift
        .map(
          (item) =>
            `<tr><td><span class="verdict fail">drift</span></td><td>${escapeHtml(item)}</td></tr>`,
        )
        .join("\n")
    : '<tr><td><span class="verdict pass">clean</span></td><td>No unmapped user-visible candidate files or manifest mapping errors detected.</td></tr>';
  const waiverRows = coverage.waivers?.length
    ? coverage.waivers
        .map(
          (item) =>
            `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.owner || "unowned")}</td><td>${escapeHtml(item.risk || "unset")}</td><td>${escapeHtml(item.reviewBy || "unset")}</td><td>${escapeHtml(item.reason)}</td><td>${escapeHtml(item.exitCriteria || "No exit criteria recorded.")}${item.validationErrors?.length ? `<br><strong>Validation:</strong> ${escapeHtml(item.validationErrors.join("; "))}` : ""}</td></tr>`,
        )
        .join("\n")
    : '<tr><td colspan="7">No waivers recorded.</td></tr>';
  return `<h2 id="main-coverage">Main Coverage Freshness</h2>
  <section class="panel">
    <p><strong>Manifest v${escapeHtml(String(coverage.manifestVersion))}</strong>: ${escapeHtml(String(coverage.mappedSurfaces))}/${escapeHtml(String(coverage.totalSurfaces))} surfaces have direct scenario mappings; ${escapeHtml(String(coverage.waivedSurfaces))} have explicit waivers; ${escapeHtml(String(coverage.candidateFiles))} user-visible candidate files scanned.</p>
    <h3>Coverage Drift</h3>
    <table><thead><tr><th>Status</th><th>Detail</th></tr></thead><tbody>${driftRows}</tbody></table>
    <h3>Explicit Waivers</h3>
    <table><thead><tr><th>ID</th><th>Surface</th><th>Owner</th><th>Risk</th><th>Review By</th><th>Reason</th><th>Exit Criteria</th></tr></thead><tbody>${waiverRows}</tbody></table>
	  </section>`;
}

function detailRows(object = {}) {
  const entries = Object.entries(object).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  if (!entries.length) return '<tr><td colspan="2">No metadata recorded.</td></tr>';
  return entries
    .map(([key, value]) => {
      const rendered = Array.isArray(value) ? value.join(", ") : String(value);
      return `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(rendered)}</td></tr>`;
    })
    .join("\n");
}

function renderRemoteMetadata(state) {
  const env = state.processEnvVerification || {};
  const machineSummary = [
    state.remoteMachine?.hostname || state.remoteMachine?.localHostName || "unknown host",
    state.remoteMachine?.macosProductVersion
      ? `macOS ${state.remoteMachine.macosProductVersion}`
      : null,
    state.remoteMachine?.architecture,
  ]
    .filter(Boolean)
    .join(" · ");
  const appSummary = [
    state.remoteApp?.bundleName || "nixmac",
    state.remoteApp?.shortVersion || state.remoteApp?.bundleVersion,
    state.remoteApp?.codesignVerified === true ? "codesign verified" : "codesign not verified",
  ]
    .filter(Boolean)
    .join(" · ");
  const envSummary = [
    env.processFound === true ? `process ${env.pid || "found"}` : "process not found",
    `OpenRouter key ${env.openrouterApiKeyInProcess || "unknown"}`,
    env.secretValuesRecorded === false ? "secrets not recorded" : "secret recording unknown",
  ].join(" · ");
  return `<h2 id="remote-metadata">Remote Mac / App Metadata</h2>
  <section class="summary metadata-summary" aria-label="Remote metadata summary">
    <div class="metric"><strong>Machine</strong>${escapeHtml(machineSummary)}</div>
    <div class="metric"><strong>App</strong>${escapeHtml(appSummary)}</div>
    <div class="metric"><strong>Process</strong>${escapeHtml(envSummary)}</div>
  </section>
  <details class="panel">
    <summary>Full remote metadata tables</summary>
    <section class="meta metadata-grid">
    <div class="panel">
      <h3>Remote Mac</h3>
      <table>${detailRows(state.remoteMachine)}</table>
    </div>
    <div class="panel">
      <h3>Staged App</h3>
      <table>${detailRows(state.remoteApp)}</table>
    </div>
    <div class="panel">
      <h3>Credential Environment Verification</h3>
      <table>${detailRows({
        pid: env.pid,
        processFound: env.processFound,
        openrouterApiKeyInProcess: env.openrouterApiKeyInProcess,
        openrouterApiKeyInGuiLaunchd: env.openrouterApiKeyInGuiLaunchd,
        secretValuesRecorded: env.secretValuesRecorded,
        processEnvKeys: env.processEnvKeys,
        note: env.note,
      })}</table>
    </div>
    </section>
  </details>
  ${state.remoteMetadataError ? `<p class="warning"><strong>Metadata capture error:</strong> ${escapeHtml(state.remoteMetadataError)}</p>` : ""}`;
}

function renderEvolvedCaseStrategy(state) {
  const strategy = state.evolvedCaseStrategy || {
    catalog: [],
    defaultCaseIds: [],
    extraCaseIds: [],
    reviewDecision: "",
  };
  const runs = state.evolvedCaseRuns || [];
  const catalogRows = (strategy.catalog || [])
    .map(
      (item) => `<tr>
        <td><code>${escapeHtml(item.id)}</code><br><small>${escapeHtml(item.label)}</small></td>
        <td>${escapeHtml(item.mode)}</td>
        <td>${item.defaultPrLane ? '<span class="verdict pass">default</span>' : '<span class="grade">optional</span>'}</td>
        <td>${escapeHtml(item.source)}</td>
        <td>${escapeHtml(item.note)}</td>
      </tr>`,
    )
    .join("\n");
  const runRows = runs.length
    ? runs
        .map(
          (run) => `<tr>
            <td><code>${escapeHtml(run.id)}</code><br><small>${escapeHtml(run.label || "")}</small></td>
            <td>${escapeHtml(run.mode || "")}</td>
            <td><span class="verdict ${escapeHtml(run.status || "inconclusive")}">${escapeHtml(run.status || "inconclusive")}</span></td>
            <td>${escapeHtml((run.notes || []).join(" "))}</td>
          </tr>`,
        )
        .join("\n")
    : '<tr><td colspan="4">No optional evolved review-only cases were enabled for this run.</td></tr>';
  return `<section>
    <h3>Evolved Flow Case Strategy</h3>
    <p>${escapeHtml(strategy.reviewDecision || "")}</p>
    <p><strong>Default case:</strong> ${escapeHtml((strategy.defaultCaseIds || []).join(", ") || "none")}<br>
    <strong>Enabled extra cases:</strong> ${escapeHtml((strategy.extraCaseIds || []).join(", ") || "none")}</p>
    <h3>Case Catalog</h3>
    <div class="table-scroll"><table class="scenario-table">
      <thead><tr><th>Case</th><th>Mode</th><th>PR Lane</th><th>Source</th><th>Notes</th></tr></thead>
      <tbody>${catalogRows}</tbody>
    </table></div>
    <h3>Optional Case Runs</h3>
    <div class="table-scroll"><table class="scenario-table">
      <thead><tr><th>Case</th><th>Mode</th><th>Status</th><th>Evidence</th></tr></thead>
      <tbody>${runRows}</tbody>
    </table></div>
  </section>`;
}

function derivedVideoChapters(state) {
  const reel = state.derivedVideo || state.video;
  if (reel?.status !== "available" || !state.screenshots?.length) return [];
  const frameDuration = 1.1;
  const candidates = [
    ["launch", "Launch"],
    ["settings-general", "Settings"],
    ["typed-intent", "Prompt"],
    ["provider-progress-01", "Provider"],
    ["review-summary", "Review summary"],
    ["review-diff", "Diff"],
    ["build-boundary", "Build boundary"],
    ["step-3-ready", "Step 3"],
    ["after-commit", "Save"],
    ["history-restore-preview", "Rollback"],
    ["after-history-restore", "Cleanup"],
    ["HTML report inspection", "Report inspection"],
  ];
  return candidates
    .map(([label, title]) => {
      const index = state.screenshots.findIndex((shot) => shot.label === label);
      if (index < 0) return null;
      return { label, title, seconds: Math.max(0, Math.round(index * frameDuration)) };
    })
    .filter(Boolean);
}

function renderVideoChapters(state) {
  const chapters = derivedVideoChapters(state);
  if (!chapters.length) return "";
  return `<div class="video-chapters" aria-label="Derived video chapters">
    <strong>Derived chapters</strong>
    <small>Chapter times are derived from the screenshot slideshow frame order, not exact user-action timestamps.</small>
    <div class="chapter-list">
      ${chapters.map((chapter) => `<button type="button" data-video-seek="${escapeHtml(String(chapter.seconds))}">${escapeHtml(formatDuration(chapter.seconds * 1000))} ${escapeHtml(chapter.title)}</button>`).join("\n")}
    </div>
  </div>`;
}

function renderSummaryVideo(state) {
  const textCount = state.textSnapshots?.length || 0;
  const eventCount = state.events?.length || 0;
  const visualCount = state.visualAssertions?.length || 0;
  const evidencePack = `<div id="evidence-pack" class="evidence-pack" aria-label="Evidence pack">
    <div class="evidence-pack-copy">
      <strong>Evidence pack</strong>
      <small>Concise proof bundle behind the verdict: redacted text, action events, remote state, and screenshot assertions.</small>
    </div>
    <div class="evidence-pack-grid">
      <a href="#raw-evidence"><strong>${escapeHtml(String(textCount))}</strong><span>Text snapshots</span><small>Redacted accessibility state for each major action.</small></a>
      <a href="#scenario-checklist"><strong>${escapeHtml(String(eventCount))}</strong><span>Action events</span><small>Click, type, polling, save, and cleanup trail.</small></a>
      <a href="#visual-assertions"><strong>${escapeHtml(String(visualCount))}</strong><span>Visual assertions</span><small>Binding screenshot signal checks.</small></a>
      <a href="#remote-metadata"><strong>DXU</strong><span>Remote state</span><small>Machine, app, process, and git metadata.</small></a>
    </div>
  </div>`;
  const continuous =
    state.video?.status === "available" &&
    state.video?.kind === "continuous-screen-recording" &&
    state.video.path;
  const derivedReel =
    state.derivedVideo?.status === "available"
      ? state.derivedVideo
      : state.video?.status === "available" && state.video?.kind !== "continuous-screen-recording"
        ? state.video
        : null;
  const derivedReelHtml = derivedReel?.path
    ? `<details class="derived-video">
      <summary>Derived screenshot reel (secondary aid; not continuous evidence)</summary>
      <p><small>${escapeHtml(derivedReel.note || "Screenshot walkthrough compiled from stored proof frames.")}</small></p>
      <video controls preload="metadata" src="${escapeHtml(derivedReel.path)}"></video>
      ${renderVideoChapters(state)}
    </details>`
    : "";
  if (continuous) {
    const samples = (state.video.sampleFrames || [])
      .map(
        (sample) => `<figure>
          <img src="${escapeHtml(sample.path)}" alt="${escapeHtml(sample.label)}">
          <figcaption>${escapeHtml(sample.label)} at ${escapeHtml(formatDuration((sample.seconds || 0) * 1000))}</figcaption>
        </figure>`,
      )
      .join("\n");
    return `<div id="summary-video" class="summary-video">
      <div class="summary-video-copy">
        <strong>Continuous remote-Mac screen recording</strong>
        <small>${escapeHtml(formatDuration((state.video.durationSeconds || 0) * 1000))}, ${escapeHtml(String(state.video.width || "?"))}x${escapeHtml(String(state.video.height || "?"))} at ${escapeHtml(Number(state.video.framesPerSecond || 0).toFixed(2))}fps. Captured ${escapeHtml(state.video.startedAt || "unknown")} to ${escapeHtml(state.video.endedAt || "unknown")} via ${escapeHtml(state.video.captureMethod || "unknown")}.</small>
      </div>
      <video controls preload="metadata" src="${escapeHtml(state.video.path)}"></video>
    </div>
    ${samples ? `<div class="continuous-video-samples">${samples}</div>` : ""}
    ${derivedReelHtml}
    ${evidencePack}`;
  }
  return `<div id="summary-video" class="summary-video summary-video-unavailable">
    <div class="summary-video-copy">
      <strong>Continuous screen recording unavailable</strong>
      <small>${escapeHtml(state.video?.note || "No qualifying continuous remote-Mac recording was attached to this run.")}</small>
    </div>
  </div>
  ${derivedReelHtml}
  ${evidencePack}`;
}

function renderExecutiveSummary(state, counts, evidenceSummary) {
  const pr = state.prFocus || { configured: false };
  const prSurface = prSurfaceSummary(state);
  const confidence = mergeConfidence(state, counts);
  const limits = knownLimitCount(state);
  const videoStatus =
    state.video?.status === "available" && state.video?.kind === "continuous-screen-recording"
      ? "pass"
      : state.video?.kind === "continuous-screen-recording"
        ? "fail"
        : "inconclusive";
  const evidenceStatus = state.scenarios.visualProofQuality?.status || "inconclusive";
  const prLabel = pr.configured
    ? `PR ${pr.number || "?"}${pr.title ? ` - ${pr.title}` : ""}`
    : "No pull request metadata provided";
  const prStatus = state.scenarios.prSpecificCoverage?.status || "inconclusive";
  const coverageStatus = state.scenarios.mainCoverageFreshness?.status || "inconclusive";
  const saveStatus = state.scenarios.saveFlow?.status || "inconclusive";
  const rollbackStatus = state.scenarios.rollbackCleanup?.status || "inconclusive";
  const remoteRestoreStatus = state.cleanup?.restored
    ? "pass"
    : state.cleanup?.attempted
      ? "fail"
      : "inconclusive";
  const metadataStatus = state.remoteMachine && state.remoteApp ? "pass" : "inconclusive";
  const storybook = state.storybookPreview || {
    status: "not_applicable",
    uiFiles: [],
    affectedStories: [],
    missingStoryFiles: [],
  };
  const storybookStatus =
    storybook.status === "ready" || storybook.status === "ready_with_advisories"
      ? "pass"
      : storybook.status === "not_applicable"
        ? "pass"
        : storybook.status === "missing_story" ||
            storybook.status === "build_failed" ||
            storybook.status === "index_unavailable" ||
            storybook.status === "invalid_metadata"
          ? "fail"
          : "inconclusive";
  const nativeSkip = state.nativeComputerUse?.skipped
    ? "Native Computer Use skipped by UI-only Storybook policy."
    : "Native Computer Use required for this change set or not skipped.";
  const scenarioHealth = counts.fail ? "fail" : counts.inconclusive ? "inconclusive" : "pass";
  const scenarioHealthNote = `${counts.pass} passed, ${counts.fail} failed, ${counts.inconclusive} inconclusive${counts.not_required ? `, ${counts.not_required} not required` : ""}.`;
  const signal = (label, status, note) => `<div class="signal signal-${escapeHtml(status)}">
    <span class="verdict ${escapeHtml(status)}">${escapeHtml(status)}</span>
    <strong>${escapeHtml(label)}</strong>
    <small>${escapeHtml(note)}</small>
  </div>`;
  return `<section id="summary" class="executive panel">
    <div class="decision-header">
      <div>
        <h2>Reviewer Decision</h2>
        <p><span class="verdict ${escapeHtml(confidence.tone)}">${escapeHtml(state.verdict)}</span></p>
        <h3>${escapeHtml(confidence.label)}</h3>
        <p>${escapeHtml(confidence.detail)}</p>
        <p><strong>${escapeHtml(prLabel)}</strong><br><small>Head: <code>${escapeHtml(state.github?.headSha || state.sha || "unknown")}</code></small></p>
      </div>
      <aside class="next-action">
        <strong>Next action</strong>
        <p>${escapeHtml(confidence.action)}</p>
        <a href="#verification-queue">Open verification queue</a>
      </aside>
    </div>
    <div class="summary" aria-label="Run summary">
      <div class="metric"><strong>${counts.pass}</strong>Passed</div>
      <div class="metric"><strong>${counts.fail}</strong>Failed</div>
      <div class="metric"><strong>${counts.inconclusive}</strong>Inconclusive</div>
      <div class="metric"><strong>${counts.not_required}</strong>Not Required</div>
      <div class="metric"><strong>${escapeHtml(String(state.screenshots.length))}</strong>Screenshots</div>
    </div>
    ${renderSummaryVideo(state)}
    <div class="signal-grid">
      ${signal("PR focus", prSurface.status || prStatus, `${prSurface.label}: ${prSurface.detail}`)}
      ${signal("Storybook preview", storybookStatus, storybook.uiFiles?.length ? `${storybook.status}: ${storybook.affectedStories?.length || 0} changed file(s) have story links; ${storybook.missingStoryFiles?.length || 0} missing story mapping(s).` : "No changed UI source files require a Storybook preview.")}
      ${signal("Native lane", state.nativeComputerUse?.skipped ? "pass" : metadataStatus, nativeSkip)}
      ${signal("Scenario health", scenarioHealth, scenarioHealthNote)}
      ${signal("Evidence health", evidenceStatus, state.scenarios.visualProofQuality?.notes?.join(" ") || "Visual/text proof quality not recorded.")}
      ${signal("Video", videoStatus, videoStatus === "pass" ? `${formatDuration((state.video.durationSeconds || 0) * 1000)} continuous remote-Mac capture with ${state.video.uniqueSampleHashes || 0} unique visual samples.` : state.video?.note || "No qualifying continuous recording attached.")}
      ${signal("Known limits", limits ? "inconclusive" : "pass", limits ? `${limits} runtime gap(s) or explicit waiver(s) need human acceptance.` : "No runtime gaps or explicit waivers recorded.")}
      ${signal("Remote restore", remoteRestoreStatus, state.cleanup?.note || "Remote app-support restore status was not recorded.")}
      ${signal("Step 3 save", saveStatus, "Disposable config change persisted through the save path.")}
      ${signal("Rollback cleanup", rollbackStatus, "History rollback returned the disposable config to baseline.")}
      ${signal("Remote metadata", metadataStatus, "DXU machine, app, and process metadata were captured.")}
    </div>
    <p class="summary-links">
      <a href="#pull-request-focus">Review PR Focus</a>
      <a href="#storybook-preview">Open Storybook Preview</a>
      <a href="#verification-queue">Verify Queue</a>
      <a href="#findings-first">Inspect Findings</a>
      <a href="#visual-proof">Open Visual Proof</a>
      <a href="#remote-metadata">Check Remote Metadata</a>
    </p>
    <p><small>Evidence footprint: ${escapeHtml(evidenceSummary)}.</small></p>
  </section>`;
}

function navBadge(label, value, tone = "") {
  if (value === undefined || value === null || value === "") return "";
  return `<span class="nav-badge ${escapeHtml(tone)}">${escapeHtml(String(value))}</span>`;
}

function renderReportNav(state, counts) {
  const riskCount = Object.values(state.v2?.scenarioContracts || {}).filter(
    (item) =>
      item.status !== "not_required" &&
      (item.accessibilityRisk === "high" || item.accessibilityRisk === "medium"),
  ).length;
  const storybook = state.storybookPreview || {
    status: "not_applicable",
    affectedStories: [],
    missingStoryFiles: [],
  };
  const storybookTone =
    storybook.status === "ready" || storybook.status === "ready_with_advisories"
      ? "pass"
      : storybook.status === "not_applicable"
        ? ""
        : storybook.status === "missing_story" ||
            storybook.status === "build_failed" ||
            storybook.status === "index_unavailable" ||
            storybook.status === "invalid_metadata"
          ? "fail"
          : "inconclusive";
  return `<aside class="report-nav" aria-label="Report navigation">
    <a href="#summary">Summary</a>
    <a href="#verification-queue">Verify ${navBadge("", knownLimitCount(state), knownLimitCount(state) ? "inconclusive" : "pass")}</a>
    <a href="#timing-breakdown">Timing ${navBadge("", state.timing?.phases?.length || 0)}</a>
    <a href="#storybook-preview">Storybook ${navBadge("", storybook.status === "ready" ? storybook.affectedStories?.length || 0 : storybook.status, storybookTone)}</a>
    <a href="#pull-request-focus">PR Focus ${navBadge("", state.prFocus?.scenarioKeys?.length || 0)}</a>
    <a href="#findings-first">Findings ${navBadge("", counts.fail + counts.inconclusive, counts.fail ? "fail" : counts.inconclusive ? "inconclusive" : "pass")}</a>
    <a href="#evidence-quality">Evidence Quality ${navBadge("", riskCount)}</a>
    <a href="#visual-assertions">Visual Assertions ${navBadge("", state.visualAssertions?.length || 0)}</a>
    <a href="#summary-video">Continuous Video ${navBadge("", state.video?.status === "available" && state.video?.kind === "continuous-screen-recording" ? "available" : "off")}</a>
    <a href="#visual-proof">Visual Proof ${navBadge("", state.screenshots.length)}</a>
    <a href="#scenario-checklist">Scenario Checklist</a>
    <a href="#main-coverage">Coverage</a>
    <a href="#coverage-gaps">Known Limits ${navBadge("", knownLimitCount(state), knownLimitCount(state) ? "inconclusive" : "")}</a>
    <a href="#remote-metadata">Remote Metadata</a>
    <a href="#raw-evidence">Raw Evidence</a>
    <a href="#cleanup">Cleanup</a>
  </aside>`;
}

function renderStorybookPreview(state) {
  const preview = state.storybookPreview || {
    status: "not_applicable",
    baseUrl: "",
    workflowUrl: "",
    uiFiles: [],
    nativeRuntimeFiles: [],
    affectedStories: [],
    missingStoryFiles: [],
    recommendation: "No Storybook preview metadata was recorded.",
  };
  const statusTone =
    preview.status === "ready" || preview.status === "ready_with_advisories"
      ? "pass"
      : preview.status === "not_applicable"
        ? "inconclusive"
        : preview.status === "missing_story" ||
            preview.status === "build_failed" ||
            preview.status === "index_unavailable" ||
            preview.status === "invalid_metadata"
          ? "fail"
          : "inconclusive";
  const affectedRows = preview.affectedStories?.length
    ? preview.affectedStories
        .map((item) => {
          const visibleStories = item.stories.slice(0, 8);
          const hiddenCount = Math.max(0, item.stories.length - visibleStories.length);
          const links = visibleStories
            .map(
              (story) =>
                `<a href="${escapeHtml(story.url || preview.baseUrl || "#")}" target="_blank" rel="noopener">${escapeHtml(story.title || story.id)} - ${escapeHtml(story.name || story.id)}</a>`,
            )
            .join("<br>");
          return `<tr><td><code>${escapeHtml(item.file)}</code></td><td>${links}${hiddenCount ? `<br><small>${escapeHtml(String(hiddenCount))} more story state(s) in Storybook.</small>` : ""}</td></tr>`;
        })
        .join("\n")
    : '<tr><td colspan="2">No affected Storybook story links were resolved.</td></tr>';
  const missingRows = preview.missingStoryFiles?.length
    ? preview.missingStoryFiles
        .map(
          (item) =>
            `<tr><td><code>${escapeHtml(item.file)}</code></td><td>${escapeHtml((item.expectedStories || []).join(", "))}</td></tr>`,
        )
        .join("\n")
    : '<tr><td colspan="2">No missing story mappings recorded.</td></tr>';
  const advisoryRows = preview.advisoryStoryFiles?.length
    ? preview.advisoryStoryFiles
        .map(
          (item) =>
            `<tr><td><code>${escapeHtml(item.file)}</code></td><td>${escapeHtml((item.expectedStories || []).join(", "))}</td></tr>`,
        )
        .join("\n")
    : '<tr><td colspan="2">No advisory story gaps recorded.</td></tr>';
  const uiFileRows = preview.uiFiles?.length
    ? preview.uiFiles.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join("\n")
    : "<li>No changed frontend UI source files detected.</li>";
  const nativeRows = preview.nativeRuntimeFiles?.length
    ? preview.nativeRuntimeFiles
        .map((file) => `<li><code>${escapeHtml(file)}</code></li>`)
        .join("\n")
    : "<li>No native/runtime files detected in the changed-file set.</li>";
  const previewBase =
    preview.status !== "not_applicable" && preview.baseUrl
      ? `<a href="${escapeHtml(preview.baseUrl)}" target="_blank" rel="noopener">${escapeHtml(preview.baseUrl)}</a>`
      : preview.status === "not_applicable"
        ? "not applicable"
        : "not recorded";
  return `<h2 id="storybook-preview">Storybook Preview</h2>
  <section class="panel">
    <p><span class="verdict ${statusTone}">${escapeHtml(preview.status || "unknown")}</span></p>
    <p>${escapeHtml(preview.recommendation || "")}</p>
    ${state.nativeComputerUse?.skipped ? `<p><strong>Native Computer Use:</strong> ${escapeHtml(state.nativeComputerUse.reason || "Skipped by UI-only Storybook policy.")}</p>` : ""}
    <p><strong>Preview base:</strong> ${previewBase}${preview.workflowUrl ? `<br><strong>Workflow:</strong> <a href="${escapeHtml(preview.workflowUrl)}" target="_blank" rel="noopener">${escapeHtml(preview.workflowUrl)}</a>` : ""}</p>
    <div class="quality-grid">
      <div>
        <h3>Affected Story URLs</h3>
        <div class="table-scroll"><table><thead><tr><th>Changed file</th><th>Storybook URL</th></tr></thead><tbody>${affectedRows}</tbody></table></div>
      </div>
      <div>
        <h3>Missing Story Mappings</h3>
        <div class="table-scroll"><table><thead><tr><th>Changed file</th><th>Expected story</th></tr></thead><tbody>${missingRows}</tbody></table></div>
      </div>
      <div>
        <h3>Advisory Story Gaps</h3>
        <div class="table-scroll"><table><thead><tr><th>Changed file</th><th>Nearby expected story</th></tr></thead><tbody>${advisoryRows}</tbody></table></div>
      </div>
    </div>
    <details>
      <summary>Changed UI files (${escapeHtml(String(preview.uiFiles?.length || 0))})</summary>
      <ul>${uiFileRows}</ul>
    </details>
    <details>
      <summary>Native/runtime files (${escapeHtml(String(preview.nativeRuntimeFiles?.length || 0))})</summary>
      <ul>${nativeRows}</ul>
    </details>
  </section>`;
}

function renderVisualAssertionResults(state) {
  const assertions = state.visualAssertions || [];
  if (!assertions.length)
    return "<p>No binding screenshot visual assertions were evaluated for this run.</p>";
  const rows = assertions
    .map((assertion) => {
      const failed = assertion.screenshots.flatMap((shot) =>
        shot.checks
          .filter((check) => check.status === "fail")
          .map((check) => `${shot.label}: ${check.name} - ${check.detail}`),
      );
      const checked = assertion.screenshots.reduce((count, shot) => count + shot.checks.length, 0);
      return `<tr>
        <td>${escapeHtml(assertion.label)}<br><small><code>${escapeHtml(assertion.scenarioKey)}</code></small></td>
        <td><span class="verdict ${escapeHtml(assertion.status)}">${escapeHtml(assertion.status)}</span></td>
        <td>${escapeHtml(String(checked))}</td>
        <td>${failed.length ? escapeHtml(failed.join("; ")) : "Required screenshots decoded and broad visual regions contained visible signal."}</td>
      </tr>`;
    })
    .join("\n");
  return `<div class="table-scroll"><table>
    <thead><tr><th>Scenario</th><th>Visual Status</th><th>Checks</th><th>Result</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderEvidenceQuality(state) {
  const contracts = Object.values(state.v2?.scenarioContracts || {}).filter(
    (item) => item.status !== "not_required",
  );
  const strengthCounts = contracts.reduce((counts, item) => {
    counts[item.evidenceStrength] = (counts[item.evidenceStrength] || 0) + 1;
    return counts;
  }, {});
  const strengthRows = ["strong", "operational", "visual-supported", "weak", "not-proved"]
    .map(
      (strength) =>
        `<tr><td><span class="strength strength-${escapeHtml(strength)}">${escapeHtml(strength)}</span></td><td>${escapeHtml(String(strengthCounts[strength] || 0))}</td></tr>`,
    )
    .join("\n");
  const mappingRows = Object.entries(state.v2?.evidenceGradeMapping || {})
    .map(
      ([legacy, strength]) =>
        `<tr><td><code>${escapeHtml(legacy)}</code></td><td><span class="strength strength-${escapeHtml(strength)}">${escapeHtml(strength)}</span></td></tr>`,
    )
    .join("\n");
  const risky = contracts
    .filter((item) => item.accessibilityRisk === "high" || item.accessibilityRisk === "medium")
    .sort(
      (a, b) =>
        (({ high: 0, medium: 1, low: 2 })[a.accessibilityRisk] ?? 3) -
        ({ high: 0, medium: 1, low: 2 }[b.accessibilityRisk] ?? 3),
    );
  const riskRows = (items) =>
    items.length
      ? items
          .map(
            (item) => `<tr>
              <td>${escapeHtml(item.label)}<br><small>${escapeHtml(item.assertionTypes.join(", "))}</small></td>
              <td><span class="risk risk-${escapeHtml(item.accessibilityRisk)}">${escapeHtml(item.accessibilityRisk)}</span></td>
              <td>${escapeHtml(item.accessibilityRiskReason)}</td>
            </tr>`,
          )
          .join("\n")
      : '<tr><td colspan="3">No elevated assertion-risk scenarios.</td></tr>';
  const nonPassRows = contracts
    .filter((item) => item.status !== "pass")
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.label)}</td>
        <td><span class="verdict ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td>
        <td><span class="failure-class">${escapeHtml(item.failureClass || "unclassified")}</span></td>
        <td>${escapeHtml(failureTaxonomy[item.failureClass] || item.failureClassReason || "No classification recorded.")}</td>
      </tr>`,
    )
    .join("\n");
  const taxonomyRows = Object.entries(failureTaxonomy)
    .map(
      ([key, description]) =>
        `<tr><td><code>${escapeHtml(key)}</code></td><td>${escapeHtml(description)}</td></tr>`,
    )
    .join("\n");
  const boundaryRows = state.confirmationBoundaries.length
    ? state.confirmationBoundaries.map((boundary) => `<li>${escapeHtml(boundary)}</li>`).join("\n")
    : "<li>No confirmation boundaries recorded.</li>";
  return `<h2 id="evidence-quality">Evidence Quality</h2>
  <section class="panel">
    <span id="v2-evidence-model" class="anchor-alias"></span>
    <span id="accessibility-risk" class="anchor-alias"></span>
    <span id="failure-taxonomy" class="anchor-alias"></span>
    <span id="confirmation-boundaries" class="anchor-alias"></span>
    <p><strong>Deterministic verdict remains source of truth.</strong> Evidence strength and assertion risk explain how much independent proof backs each scenario. Safe-to-store screenshots are binding corroborating evidence: missing, blank, occluded, or low-signal required screenshots can fail their owning scenario.</p>
    <h3 id="visual-assertions">Visual Assertion Results</h3>
    ${renderVisualAssertionResults(state)}
    <div class="quality-grid">
      <div>
        <h3>Evidence Strength</h3>
        <table><thead><tr><th>Strength</th><th>Count</th></tr></thead><tbody>${strengthRows}</tbody></table>
      </div>
      <div>
        <h3>Elevated Assertion Risk</h3>
        <table><thead><tr><th>Scenario</th><th>Risk</th><th>Why</th></tr></thead><tbody>${riskRows(risky)}</tbody></table>
      </div>
    </div>
    <h3>Failure Classification</h3>
    ${
      nonPassRows
        ? `<div class="table-scroll"><table><thead><tr><th>Scenario</th><th>Status</th><th>Class</th><th>Meaning</th></tr></thead><tbody>${nonPassRows}</tbody></table></div>`
        : "<p>No non-pass scenarios require failure classification.</p>"
    }
    <details>
      <summary>Confirmation boundaries</summary>
      <ul>${boundaryRows}</ul>
    </details>
    <details>
      <summary>Full assertion-risk table</summary>
      <div class="table-scroll"><table><thead><tr><th>Scenario</th><th>Risk</th><th>Why</th></tr></thead><tbody>${riskRows(contracts)}</tbody></table></div>
    </details>
    <details>
      <summary>Legacy grade mapping</summary>
      <table><thead><tr><th>V1 Grade</th><th>V2 Strength</th></tr></thead><tbody>${mappingRows}</tbody></table>
    </details>
    <details>
      <summary>Taxonomy definitions</summary>
      <table><thead><tr><th>Class</th><th>Definition</th></tr></thead><tbody>${taxonomyRows}</tbody></table>
    </details>
  </section>`;
}

function renderScenarioChecklist(state, groupedScenarioHtml) {
  return `<h2 id="scenario-checklist">Scenario Checklist</h2>
  <p>Grouped scenario tables are collapsed by default so reviewers can drill into a specific surface without reading the whole suite linearly.</p>
  ${groupedScenarioHtml}`;
}

function renderRunMetadata(state, evidenceSummary) {
  const buildGate = state.buildGate || {};
  const buildGateSummary = buildGate.status
    ? [
        buildGate.status,
        buildGate.requiredHeadSha ? `head ${buildGate.requiredHeadSha}` : "",
        buildGate.buildRunId ? `run ${buildGate.buildRunId}` : "",
        buildGate.reason || "",
      ]
        .filter(Boolean)
        .join(" - ")
    : "not recorded";
  return `<section class="meta run-metadata">
    <div class="panel"><strong>Timestamp</strong><br>${escapeHtml(state.startedAt)}</div>
    <div class="panel"><strong>Branch</strong><br>${escapeHtml(state.branch)}</div>
    <div class="panel"><strong>SHA</strong><br><code>${escapeHtml(state.sha)}</code></div>
    <div class="panel"><strong>Build Gate</strong><br>${escapeHtml(buildGateSummary)}</div>
    <div class="panel"><strong>macOS</strong><br>${escapeHtml(state.remoteMachine?.macosProductVersion || state.macosVersion)}</div>
    <div class="panel"><strong>App</strong><br><code>${escapeHtml(state.app)}</code></div>
    <div class="panel"><strong>Provider</strong><br><code>${escapeHtml(state.provider.kind)}</code><br>${escapeHtml(state.provider.note)}</div>
    <div class="panel"><strong>Prompt</strong><br>${escapeHtml(state.prompt)}</div>
    <div class="panel"><strong>Evidence</strong><br>${escapeHtml(evidenceSummary)}</div>
  </section>`;
}

function renderTimingBreakdown(state) {
  const timing = state.timing || { phases: [] };
  const phases = sortedTimingPhases(timing);
  const totals = timingTotals(timing);
  const rows = phases.length
    ? phases
        .map(
          (phase) => `<tr>
      <td>${escapeHtml(phase.label)}<br><small><code>${escapeHtml(phase.id)}</code></small></td>
      <td><span class="timing-status timing-${escapeHtml(phase.status)}">${escapeHtml(phase.status)}</span></td>
      <td>${escapeHtml(formatDuration(phase.durationMs))}</td>
      <td>${escapeHtml(phase.source || "unknown")}</td>
      <td>${escapeHtml(phase.note || (phase.observable === false ? "Not observable in this run." : ""))}</td>
    </tr>`,
        )
        .join("\n")
    : '<tr><td colspan="5">No phase timing metadata was recorded for this run.</td></tr>';
  return `<h2 id="timing-breakdown">Timing Breakdown</h2>
  <section class="panel">
    <p><strong>Observed total:</strong> ${escapeHtml(formatDuration(totals.totalObservedMs))} across ${escapeHtml(String(totals.observedCount))}/${escapeHtml(String(totals.phaseCount))} phases. ${escapeHtml(totals.unavailableCount ? `${totals.unavailableCount} phases were unavailable or not observable.` : "All recorded phases had observable status.")}</p>
    <p><small>${escapeHtml(timing.note || "")}</small></p>
    <div class="table-scroll"><table class="timing-table">
      <thead><tr><th>Phase</th><th>Status</th><th>Duration</th><th>Source</th><th>Note</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

function renderRawEvidence(state, screenshotHtml) {
  return `<h2 id="raw-evidence">Raw Evidence</h2>
  <section class="panel">
    <span id="screenshots" class="anchor-alias"></span>
    <span id="narrative" class="anchor-alias"></span>
    <span id="claims" class="anchor-alias"></span>
    <span id="pr-specific-focus" class="anchor-alias"></span>
    <details>
      <summary>Full screenshot gallery (${escapeHtml(String(state.screenshots.length))})</summary>
      ${screenshotHtml}
    </details>
    <details>
      <summary>Human QA narrative (${escapeHtml(String(state.narrative.length))})</summary>
      ${
        state.narrative.length
          ? `<ul>${state.narrative.map((item) => `<li>${escapeHtml(item.ts)} - ${escapeHtml(item.text)}</li>`).join("\n")}</ul>`
          : "<p>No narrative recorded.</p>"
      }
    </details>
    <details>
      <summary>Claims vs evidence (${escapeHtml(String(state.claims.length))})</summary>
      <table>
        <thead><tr><th>Claim</th><th>Status</th><th>Evidence</th></tr></thead>
        <tbody>
          ${
            state.claims.length
              ? state.claims
                  .map(
                    (claim) =>
                      `<tr><td>${escapeHtml(claim.claim)}</td><td><span class="verdict ${claim.status}">${escapeHtml(claim.status)}</span></td><td>${escapeHtml(claim.evidence)}</td></tr>`,
                  )
                  .join("\n")
              : '<tr><td colspan="3">No claims recorded.</td></tr>'
          }
        </tbody>
      </table>
    </details>
    <details>
      <summary>Run metadata</summary>
      ${renderRunMetadata(state, `${state.screenshots.length} screenshots, ${state.textSnapshots.length} redacted text snapshots`)}
    </details>
    <details>
      <summary>Phase timing JSON (${escapeHtml(String(state.timing?.phases?.length || 0))})</summary>
      <pre>${escapeHtml(JSON.stringify(state.timing || { phases: [] }, null, 2))}</pre>
    </details>
  </section>`;
}

function renderCleanupStatus(state) {
  const rollback = state.scenarios.rollbackCleanup || { status: "inconclusive", notes: [] };
  const discard = state.scenarios.discard || { status: "inconclusive", notes: [] };
  const remoteRestoreStatus = state.cleanup?.restored
    ? "pass"
    : state.cleanup?.attempted
      ? "fail"
      : "inconclusive";
  return `<h2 id="cleanup">Cleanup / Restore Status</h2>
  <section class="panel cleanup-grid">
    <div class="cleanup-card">
      <h3>Disposable Config Rollback</h3>
      <p><span class="verdict ${escapeHtml(rollback.status)}">${escapeHtml(rollback.status)}</span></p>
      <p>${escapeHtml(rollback.notes.join(" ") || "No disposable rollback note recorded.")}</p>
      <p><a class="back-link" href="#verification-queue">Review cleanup proof</a></p>
    </div>
    <div class="cleanup-card">
      <h3>Discard Boundary</h3>
      <p><span class="verdict ${escapeHtml(discard.status)}">${escapeHtml(discard.status)}</span></p>
      <p>${escapeHtml(discard.notes.join(" ") || "No discard-boundary note recorded.")}</p>
    </div>
    <div class="cleanup-card">
      <h3>Remote App-Support Restore</h3>
      <p><span class="verdict ${escapeHtml(remoteRestoreStatus)}">${escapeHtml(remoteRestoreStatus)}</span></p>
      <p>${escapeHtml(state.cleanup?.note || "No remote cleanup status recorded.")}</p>
    </div>
  </section>`;
}

function renderGroupedScenarioHtml(state, proofForScenario) {
  return groupedScenarios(state)
    .map((group) => {
      const groupCounts = {
        pass: group.items.filter((item) => item.status === "pass").length,
        fail: group.items.filter((item) => item.status === "fail").length,
        inconclusive: group.items.filter((item) => item.status === "inconclusive").length,
        notRequired: group.items.filter((item) => item.status === "not_required").length,
      };
      return `<details class="group">
  <summary>${escapeHtml(group.name)} <span class="nav-badge pass">${groupCounts.pass} pass</span>${groupCounts.fail ? ` <span class="nav-badge fail">${groupCounts.fail} fail</span>` : ""}${groupCounts.inconclusive ? ` <span class="nav-badge inconclusive">${groupCounts.inconclusive} inconclusive</span>` : ""}${groupCounts.notRequired ? ` <span class="nav-badge not_required">${groupCounts.notRequired} not required</span>` : ""}</summary>
  <div class="table-scroll"><table class="scenario-table">
    <thead><tr><th class="scenario-col">Scenario</th><th class="status-col">Status</th><th class="grade-col">Evidence Grade</th><th class="artifacts-col">Primary Artifacts</th><th class="proof-col">What Proved It</th><th class="untested-col">Still Untested</th></tr></thead>
    <tbody>
      ${group.items
        .map((item) => {
          const proof = proofForScenario(state, item.key);
          const contract = state.v2?.scenarioContracts?.[item.key] || {};
          return `<tr><td class="scenario-cell">${escapeHtml(item.label)}<br><small>${item.notes.map(escapeHtml).join("<br>") || "No notes recorded."}</small></td><td class="status-cell"><span class="verdict ${item.status}">${escapeHtml(item.status)}</span></td><td class="grade-cell"><span class="grade">${escapeHtml(proof.grade)}</span><br><span class="strength strength-${escapeHtml(contract.evidenceStrength || "not-proved")}">${escapeHtml(contract.evidenceStrength || "not-proved")}</span></td><td class="artifact-cell">${artifactLinks(state, item.key, proofForScenario)}</td><td class="proof-cell">${escapeHtml(proof.proof)}${contract.failureClass ? `<br><small>Failure class: ${escapeHtml(contract.failureClass)}</small>` : ""}</td><td>${escapeHtml(proof.untested)}</td></tr>`;
        })
        .join("\n")}
    </tbody>
  </table></div>
  </details>`;
    })
    .join("\n");
}

export async function renderReportHtml(state, { proofForScenario }) {
  const verdict = state.verdict;
  const coverageFreshnessHtml = renderCoverageFreshness(state);
  const screenshotHtml = state.screenshots.length
    ? state.screenshots
        .map(
          (shot) => `<figure id="screenshot-${escapeHtml(slugify(shot.label || shot.path))}">
  <img src="${escapeHtml(shot.path)}" alt="${escapeHtml(shot.label)}">
  <figcaption><strong>${escapeHtml(shot.label)}</strong> - ${escapeHtml(shot.note || "No note")} (${escapeHtml(shot.capturedAt)})</figcaption>
</figure>`,
        )
        .join("\n")
    : "<p>No screenshots captured.</p>";
  const counts = statusCounts(state);
  const groupedScenarioHtml = renderGroupedScenarioHtml(state, proofForScenario);
  let evidenceSummary = `${state.screenshots.length} screenshots, ${state.textSnapshots.length} redacted text snapshots`;
  const coverageGapsHtml = renderCoverageGaps(state);
  const prPriorityHtml = renderPrPriority(state, proofForScenario);
  const priorityTriageHtml = renderPriorityTriage(state, proofForScenario);
  const verificationQueueHtml = renderVerificationQueue(state, proofForScenario);
  if (state.video?.status === "available" && state.video?.kind === "continuous-screen-recording") {
    evidenceSummary += ", 1 continuous screen recording";
  } else if (state.video?.status === "available") {
    evidenceSummary += ", 1 derived screenshot reel (not continuous evidence)";
  }
  const executiveSummaryHtml = renderExecutiveSummary(state, counts, evidenceSummary);
  const reportNavHtml = renderReportNav(state, counts);
  const storybookPreviewHtml = renderStorybookPreview(state);
  const evidenceQualityHtml = renderEvidenceQuality(state);
  const visualProofHtml = await renderVisualProofBoard(state, proofForScenario);
  const remoteMetadataHtml = renderRemoteMetadata(state);
  const timingBreakdownHtml = renderTimingBreakdown(state);
  const rawEvidenceHtml = renderRawEvidence(state, screenshotHtml);
  const scenarioChecklistHtml = renderScenarioChecklist(state, groupedScenarioHtml);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>nixmac Computer Use E2E Evidence</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #111318; color: #eef1f5; }
    main { max-width: 1460px; margin: 0 auto; padding: 32px 20px 56px; }
    h1, h2, h3 { margin: 0 0 12px; }
    h1 { font-size: 28px; letter-spacing: 0; }
    html { scroll-behavior: smooth; }
    h2 { font-size: 18px; margin-top: 30px; letter-spacing: 0; }
    h2[id], .anchor-alias { scroll-margin-top: 18px; }
    h3 { font-size: 15px; margin-top: 18px; color: #f6f8fb; letter-spacing: 0; }
    p, li { color: #c5cbd3; line-height: 1.5; }
    .lede { max-width: 850px; color: #d9dee6; }
    .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 18px 0; }
    .panel { border: 1px solid #303640; border-radius: 8px; padding: 14px; background: #171a21; overflow-wrap: anywhere; }
    .metadata-grid .panel { overflow-x: auto; }
    .report-shell { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 22px; align-items: start; margin-top: 22px; }
    .report-nav { position: sticky; top: 14px; display: grid; gap: 8px; padding: 12px; border: 1px solid #303640; border-radius: 8px; background: rgba(17, 19, 24, 0.96); backdrop-filter: blur(8px); }
    .report-nav a, .summary-links a { border: 1px solid #3c4654; border-radius: 999px; padding: 7px 10px; color: #dce3ec; text-decoration: none; font-size: 13px; line-height: 1.15; background: #171a21; }
    .report-nav a:hover, .summary-links a:hover { border-color: #7fbfff; color: #a7d7ff; }
    .report-content { min-width: 0; }
    .warning { color: #ffd36e; }
    .metric { border: 1px solid #303640; border-radius: 8px; padding: 14px; background: #171a21; }
    .metric strong { display: block; font-size: 28px; color: #fff; margin-bottom: 4px; }
    .executive { border-color: #3c4654; background: #151922; }
    .decision-header { display: grid; grid-template-columns: minmax(0, 1fr) minmax(230px, 0.34fr); gap: 16px; align-items: start; }
    .decision-header h3 { font-size: 22px; margin-top: 8px; }
    .next-action { border: 1px solid #3c4654; border-radius: 8px; padding: 14px; background: #10131a; }
    .next-action strong { display: block; color: #fff; margin-bottom: 6px; }
    .next-action a, .back-link { color: #a7d7ff; text-decoration: none; font-weight: 700; }
    .next-action a:hover, .back-link:hover { text-decoration: underline; }
    .signal-grid, .quality-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; margin: 16px 0; }
    .signal { border: 1px solid #303640; border-radius: 8px; padding: 10px; background: #111318; }
    .signal strong { display: block; margin: 8px 0 4px; }
    .summary-links { display: flex; flex-wrap: wrap; gap: 8px; }
    .nav-badge { display: inline-flex; align-items: center; justify-content: center; border: 1px solid #3c4654; border-radius: 999px; padding: 2px 6px; margin-left: 4px; font-size: 11px; color: #dce3ec; background: #20242d; }
    .verdict { display: inline-block; border-radius: 999px; padding: 5px 10px; font-weight: 700; text-transform: uppercase; }
    .pass { background: #123d2a; color: #8bf0bb; }
    .fail { background: #471a1a; color: #ff9e9e; }
    .inconclusive { background: #443512; color: #ffd36e; }
    .not_required { background: #222936; color: #b8c3d1; }
    .group { margin-top: 18px; }
    table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 8px; }
    .table-scroll { width: 100%; overflow-x: auto; border-radius: 8px; }
    .scenario-table { min-width: 1050px; table-layout: fixed; }
    th, td { border: 1px solid #303640; padding: 10px; text-align: left; vertical-align: top; }
    th { background: #20242d; }
    .scenario-table th { white-space: nowrap; }
    .scenario-table .scenario-col { width: 30%; }
    .scenario-table .status-col { width: 92px; }
    .scenario-table .grade-col { width: 138px; }
    .scenario-table .artifacts-col { width: 190px; }
    .scenario-table .proof-col { width: 29%; }
    .scenario-table .untested-col { width: 20%; }
    img { width: 100%; max-width: 100%; border: 1px solid #303640; border-radius: 8px; background: #000; }
    small { color: #9ba3ae; }
    pre { max-height: 280px; overflow: auto; white-space: pre-wrap; border: 1px solid #303640; border-radius: 8px; padding: 10px; background: #0d0f14; color: #dce3ec; }
    details { margin: 10px 0; }
    summary { cursor: pointer; color: #a7d7ff; }
    details > summary { font-weight: 700; margin: 12px 0; }
    .grade { display: inline-flex; align-items: center; justify-content: center; border: 1px solid #3c4654; border-radius: 999px; padding: 4px 8px; color: #dce3ec; background: #20242d; font-size: 12px; line-height: 1.15; white-space: nowrap; }
    .verdict { white-space: nowrap; text-align: center; }
    .scenario-table .status-cell { width: 92px; min-width: 92px; text-align: center; }
    .scenario-table .grade-cell { width: 138px; min-width: 138px; text-align: center; }
    .scenario-table .status-cell .verdict { min-width: 54px; padding-left: 8px; padding-right: 8px; }
    .strength, .risk, .failure-class { display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; padding: 4px 8px; font-size: 12px; line-height: 1.15; font-weight: 700; white-space: nowrap; }
    .strength { margin-top: 6px; border: 1px solid #3c4654; background: #20242d; color: #dce3ec; }
    .strength-strong { background: #103829; color: #8bf0bb; border-color: #236b4c; }
    .strength-operational { background: #173247; color: #a7d7ff; border-color: #315f82; }
    .strength-visual-supported { background: #342f18; color: #ffe08a; border-color: #66592a; }
    .strength-weak, .risk-high { background: #471a1a; color: #ffb0b0; border-color: #744; }
    .strength-not-proved, .risk-medium { background: #443512; color: #ffd36e; border-color: #705c22; }
    .risk-low { background: #123d2a; color: #8bf0bb; border-color: #236b4c; }
    .failure-class { background: #20242d; color: #dce3ec; border: 1px solid #3c4654; }
    .timing-table { min-width: 850px; table-layout: fixed; }
    .timing-table th:nth-child(1) { width: 28%; }
    .timing-table th:nth-child(2) { width: 112px; }
    .timing-table th:nth-child(3) { width: 112px; }
    .timing-table th:nth-child(4) { width: 130px; }
    .timing-status { display: inline-flex; align-items: center; justify-content: center; border: 1px solid #3c4654; border-radius: 999px; padding: 4px 8px; font-size: 12px; line-height: 1.15; font-weight: 700; white-space: nowrap; background: #20242d; color: #dce3ec; }
    .timing-success { background: #123d2a; color: #8bf0bb; border-color: #236b4c; }
    .timing-failure { background: #471a1a; color: #ffb0b0; border-color: #744; }
    .timing-skipped, .timing-unavailable, .timing-pending { background: #443512; color: #ffd36e; border-color: #705c22; }
    .timing-in_progress { background: #173247; color: #a7d7ff; border-color: #315f82; }
    .artifact-list { max-height: 230px; overflow: auto; padding-right: 4px; }
    .priority table { margin-bottom: 18px; }
    .proof-card { margin-top: 18px; border: 1px solid #303640; border-radius: 8px; padding: 14px; background: #151922; }
    .annotated-shot { position: relative; overflow: hidden; border: 1px solid #303640; border-radius: 8px; background: #000; }
    .annotated-shot img { display: block; border: 0; border-radius: 0; }
    .annotation { position: absolute; box-sizing: border-box; border: 1.5px solid rgba(255, 214, 94, 0.95); border-radius: 5px; background: rgba(255, 214, 94, 0.10); box-shadow: inset 0 0 0 1px rgba(20, 19, 13, 0.35), 0 8px 24px rgba(0,0,0,0.28); pointer-events: none; }
    .annotation::after { content: ""; position: absolute; inset: -4px; border: 1px solid rgba(255, 214, 94, 0.28); border-radius: 8px; }
    .annotation span { position: absolute; left: 6px; top: 6px; max-width: min(260px, calc(100% - 12px)); border-radius: 4px; padding: 3px 6px; background: rgba(255, 214, 94, 0.95); color: #111318; font-size: 12px; line-height: 1.15; font-weight: 700; white-space: normal; box-shadow: 0 2px 8px rgba(0,0,0,0.22); }
    .annotation-pin { border-radius: 999px; }
    .annotation-pin::after { border-radius: 999px; inset: -5px; }
    .annotation-pin span { left: 50%; top: -28px; transform: translateX(-50%); white-space: nowrap; max-width: none; }
    .anchor-alias { display: block; height: 0; overflow: hidden; }
    .summary-video { margin: 24px 0; display: grid; grid-template-columns: minmax(220px, 0.42fr) minmax(360px, 1fr); gap: 18px; align-items: start; padding: 16px; border: 1px solid #2e3541; border-radius: 8px; background: #10131a; }
    .summary-video-copy strong { display: block; margin-bottom: 6px; }
    .summary-video-copy small { color: #b8c0cb; line-height: 1.45; }
    .summary-video video { width: 100%; max-height: 520px; border: 1px solid #2e3541; border-radius: 6px; background: #050609; }
    .summary-video-unavailable { display: block; }
    .derived-video { margin: 14px 0 24px; padding: 12px 16px; border: 1px solid #2e3541; border-radius: 8px; background: #0d1016; }
    .derived-video video { width: 100%; max-height: 420px; margin-top: 10px; background: #050609; }
    .continuous-video-samples { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: -10px 0 24px; }
    .continuous-video-samples figure { margin: 0; }
    .continuous-video-samples img { width: 100%; border: 1px solid #2e3541; border-radius: 6px; }
    .video-chapters { margin-top: 14px; display: grid; gap: 8px; }
    .chapter-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .chapter-list button { border: 1px solid #3c4654; border-radius: 999px; padding: 6px 9px; background: #171a21; color: #dce3ec; cursor: pointer; font: inherit; font-size: 12px; }
    .chapter-list button:hover { border-color: #7fbfff; color: #a7d7ff; }
    .evidence-pack { margin: -8px 0 22px; display: grid; grid-template-columns: minmax(220px, 0.42fr) minmax(360px, 1fr); gap: 18px; align-items: stretch; padding: 14px 16px; border: 1px solid #2e3541; border-radius: 8px; background: #10131a; }
    .evidence-pack-copy strong { display: block; margin-bottom: 6px; }
    .evidence-pack-copy small { color: #b8c0cb; line-height: 1.45; }
    .evidence-pack-grid { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 10px; }
    .evidence-pack-grid a { display: block; min-height: 86px; border: 1px solid #303640; border-radius: 8px; padding: 10px; background: #151922; color: #dce3ec; text-decoration: none; }
    .evidence-pack-grid a:hover { border-color: #7fbfff; }
    .evidence-pack-grid strong { display: block; color: #fff; font-size: 20px; line-height: 1.1; margin-bottom: 6px; }
    .evidence-pack-grid span { display: block; color: #f6f8fb; font-weight: 700; margin-bottom: 4px; }
    .evidence-pack-grid small { display: block; color: #9ba3ae; line-height: 1.35; }
    figure { margin: 0 0 18px; }
    figcaption { margin-top: 6px; color: #c5cbd3; font-size: 13px; }
    code { color: #a7d7ff; overflow-wrap: anywhere; }
    .copy-anchor { margin-left: 8px; color: #7fbfff; text-decoration: none; font-size: 12px; opacity: 0.65; }
    .copy-anchor:hover { opacity: 1; }
    .verification-table th:nth-child(1) { width: 170px; }
    .cleanup-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .cleanup-card { border: 1px solid #303640; border-radius: 8px; padding: 12px; background: #111318; }
    ul { padding-left: 20px; }
    @media (max-width: 860px) {
      main { padding: 24px 12px 44px; }
      .report-shell { display: block; }
      .decision-header, .cleanup-grid { grid-template-columns: 1fr; }
      .report-nav { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: nowrap; overflow-x: auto; margin: 18px 0; }
      .report-nav a { white-space: nowrap; }
      .summary-video, .evidence-pack { grid-template-columns: 1fr; }
      .evidence-pack-grid { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
    }
  </style>
</head>
<body>
<main>
  <h1>nixmac Computer Use E2E Evidence</h1>
  <p class="lede">Remote desktop QA driven through Codex Computer Use against the real macOS app. The report summarizes major feature coverage, functional UX/UI checks, screenshots, redacted text evidence, and remote machine metadata.</p>
  <p><span class="verdict ${verdict}">Verdict: ${verdict}</span></p>

  ${executiveSummaryHtml}

  <div class="report-shell">
    ${reportNavHtml}
    <div class="report-content">
      ${storybookPreviewHtml}

      ${prPriorityHtml}

      ${verificationQueueHtml}

      ${timingBreakdownHtml}

      <h2 id="findings-first">Findings</h2>
      <p>Failures are shown first, then inconclusive checks. Passing checks stay collapsed unless a reviewer wants the full inventory.</p>
      ${priorityTriageHtml}

      ${evidenceQualityHtml}

      <h2 id="visual-proof">Visual Proof</h2>
      <p>Screenshots are binding corroborating assertions for safe-to-store visual scenarios. Accessibility text, action events, provider state, and remote git state remain the semantic proof; screenshot signal checks catch missing, blank, occluded, or low-signal visual evidence.</p>
      ${visualProofHtml}

      ${scenarioChecklistHtml}

      ${coverageFreshnessHtml}

      <h2 id="coverage-gaps">Coverage Gaps / Not Proved</h2>
      ${coverageGapsHtml}

      ${remoteMetadataHtml}

      <details class="panel" id="evolved-flow">
        <summary>Evolved Flow Case Strategy</summary>
        ${renderEvolvedCaseStrategy(state)}
      </details>

      ${rawEvidenceHtml}

      ${renderCleanupStatus(state)}
    </div>
  </div>
</main>
<script>
  (() => {
    const video = document.querySelector('#summary-video video');
    for (const button of document.querySelectorAll('[data-video-seek]')) {
      button.addEventListener('click', () => {
        if (!video) return;
        video.currentTime = Number(button.dataset.videoSeek || 0);
        video.play?.();
      });
    }
    for (const heading of document.querySelectorAll('h2[id], h3[id], figure[id]')) {
      if (heading.querySelector?.('.copy-anchor')) continue;
      const link = document.createElement('a');
      link.className = 'copy-anchor';
      link.href = '#' + heading.id;
      link.textContent = '#';
      link.title = 'Copy link to this section';
      link.addEventListener('click', async (event) => {
        event.preventDefault();
        const url = location.href.split('#')[0] + '#' + heading.id;
        try {
          await navigator.clipboard.writeText(url);
          link.textContent = 'copied';
          setTimeout(() => { link.textContent = '#'; }, 1000);
        } catch {
          location.hash = heading.id;
        }
      });
      heading.appendChild(link);
    }
  })();
</script>
</body>
</html>
`;
}
