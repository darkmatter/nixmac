const fs = require('node:fs');
const path = require('node:path');

module.exports = async function publishE2ePrSummary({ github, context, core }) {
  const marker = "<!-- nixmac-e2e-gate -->";
  const status = process.env.E2E_STATUS || "";
  const reason = process.env.E2E_REASON || "";
  const required = process.env.E2E_REQUIRED === "true";
  const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
  const artifactRoot = process.env.E2E_ARTIFACT_ROOT || "e2e-artifacts";
  const prNumber = Number(process.env.E2E_PR_NUMBER || 0);
  const prSideEffectsEnabled = process.env.E2E_PR_SIDE_EFFECTS_ENABLED === "true";
  let testedCommit = process.env.E2E_HEAD_SHA || context.sha;
  const conclusion = process.env.E2E_CONCLUSION || "failure";
  const providerEnvironmentTextPattern =
    /provider_environment_failed|out of credits|billing limit|provider'?s billing|insufficient[_ -]?quota|payment required|(?:provider|api|account|openrouter|openai|billing|quota|rate limit|status|error|code).{0,48}\b(?:402|429)\b|\b(?:402|429)\b.{0,48}(?:provider|api|account|openrouter|openai|billing|quota|rate limit)|(?:provider|api|account|openrouter|openai).{0,48}rate limit|rate limit.{0,48}(?:provider|api|account|openrouter|openai|billing|quota)/i;

  function findReports(root) {
    const reports = [];
    if (!fs.existsSync(root)) return reports;
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.name === "e2e-report.json") {
          try {
            reports.push(JSON.parse(fs.readFileSync(fullPath, "utf8")));
          } catch (error) {
            reports.push({
              scenario: path.basename(path.dirname(fullPath)),
              lane: "unknown",
              status: "infra_failed",
              primaryProofUrl: null,
              replayCommand: null,
            });
          }
        }
      }
    }
    return reports.sort((a, b) => String(a.scenario).localeCompare(String(b.scenario)));
  }

  function findFirstFile(root, fileName) {
    if (!fs.existsSync(root)) return null;
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.name === fileName) {
          return fullPath;
        }
      }
    }
    return null;
  }

  function readSelection(root) {
    const selectionPath = findFirstFile(root, "e2e-selection.json");
    if (!selectionPath) return null;
    try {
      return JSON.parse(fs.readFileSync(selectionPath, "utf8"));
    } catch {
      return null;
    }
  }

  function isPublicUrl(value) {
    return /^https?:\/\//.test(String(value || ""));
  }

  function publicOrArtifact(value) {
    return isPublicUrl(value) ? value : "workflow artifact";
  }

  function linkOrArtifact(value, label) {
    return isPublicUrl(value) ? `[${label}](${value})` : "workflow artifact";
  }

  function linkIfPublic(value, label) {
    return isPublicUrl(value) ? `[${label}](${value})` : null;
  }

  function markdownText(value) {
    return String(value ?? "")
      .replace(/[\r\n]+/g, " ")
      .replace(/\|/g, "\\|")
      .trim();
  }

  function markdownCode(value) {
    return markdownText(value).replace(/`/g, "\\`");
  }

  function tableCell(value) {
    return markdownText(value) || "";
  }

  const captureLimitationLabels = new Map([
    ["full_mac_runner_unavailable", "Full-Mac runner was unreachable or did not produce a scenario report"],
    ["provider_environment_failed", "Live provider/API account failed before product assertions could complete"],
    ["live_provider_preflight_failed", "Live provider/API key failed the preflight auth or model-call check"],
    ["screen_recording_invalid", "Screen recording was produced but failed validation"],
    ["screen_recording_missing", "No screen recording was captured for this run"],
    ["webview_recording_invalid", "Legacy webview frame-replay MP4 was produced but failed validation"],
    ["webview_recording_missing", "No legacy webview frame-replay MP4 was captured for this run"],
    ["webview_frame_timeline_invalid", "Webview frame timeline proof could not be built for this run"],
    ["webview_frame_timeline_low_information", "Webview frame timeline was suppressed because captured frames were not visually informative"],
    ["webview_frame_timeline_missing", "No webview frame timeline proof was captured for this run"],
  ]);

  function humanizeCaptureLimitation(value) {
    const raw = String(value || "").trim();
    return captureLimitationLabels.get(raw) || raw.replaceAll("_", " ");
  }

  function normalizeDiagnosticText(value) {
    return String(value || "").replace(/\r\n?/g, "\n").trim();
  }

  function diagnosticLines(value) {
    return normalizeDiagnosticText(value)
      .replace(/\s+(\[[a-z]+\]\s+)/gi, "\n$1")
      .replace(/\s+(?=(?:ERROR|Error|error|fatal|Failed|failed|End-of-central-directory|unzip:|find:|bash:)\b)/g, "\n")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }

  function isSignalLine(line) {
    return /(\bERROR\b|\berror\b|\bfatal\b|\bfailed\b|No \.app bundle|End-of-central-directory|cannot find zipfile|Terminated:|timed out|Missing full-Mac E2E GitHub secrets)/i.test(line);
  }

  function truncate(value, maxLength) {
    const text = String(value || "");
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
  }

  function scenarioMeta(selection, scenarioName) {
    const selected = selection?.selected || [];
    const attention = selection?.attention || [];
    return selected.find((scenario) => scenario.name === scenarioName)
      || attention.find((scenario) => scenario.name === scenarioName)
      || {};
  }

  function formatCount(value) {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  function formatScope(selection, reports, isRequired) {
    if (!isRequired) {
      return selection?.reason || "No E2E scenarios selected for this PR.";
    }
    const selected = selection?.selected || [];
    const configured = selection?.configured || {};
    const total = formatCount(configured.total) || selected.length || reports.length;
    const tauriTotal = formatCount(configured.tauri);
    const macTotal = formatCount(configured.fullMac);
    const tauriSelected = selected.filter((scenario) => scenario.lane === "tauri-wdio").length;
    const macSelected = selected.filter((scenario) => scenario.lane === "full-mac").length;
    const mode = selection?.selectionMode || "unknown";
    const detail = `${selected.length || reports.length}/${total} configured scenarios (${tauriSelected}/${tauriTotal} hosted, ${macSelected}/${macTotal} full-Mac)`;
    if (mode === "all-label") {
      return `Ran all configured scenarios: ${detail}. PR-matched files are called out below as adversarial focus.`;
    }
    if (mode === "pr-default-plus-label") {
      return `Ran the standard hosted PR pack, requested label scope, and any matched full-Mac/adversarial scenarios: ${detail}.`;
    }
    if (mode === "scenario-label" || mode === "full-mac-label") {
      return `Ran requested E2E label scope: ${detail}.`;
    }
    if (mode === "manual") {
      return `Ran manually dispatched scenario scope: ${detail}.`;
    }
    return `Ran the standard hosted PR pack plus any matched full-Mac/adversarial scenarios: ${detail}.`;
  }

  function markdownList(items) {
    return (items || [])
      .map((item) => `- ${markdownText(item)}`)
      .join("\n");
  }

  function renderAdversarialFocus(selection) {
    if (!selection) return "";
    const changedCount = formatCount(selection.changedFileCount);
    const attention = selection.attention || [];
    const sample = selection.changedFileSample || [];
    const sampleItems = sample.map((file) => "`" + markdownCode(file) + "`");
    const sampleText = sample.length
      ? `\n\n<details><summary>Changed files sampled (${sample.length}${changedCount > sample.length ? ` of ${changedCount}` : ""})</summary>\n\n${markdownList(sampleItems)}\n\n</details>`
      : "";
    const heading = selection.validationMode === "workflow_dispatch_manual"
      ? "Dispatch Focus"
      : "PR-specific Focus";
    const runModel = selection.selectionMode === "all-label"
      ? "All configured scenarios ran; PR path matches are called out as extra focus."
      : selection.standardPackRan
        ? "The standard hosted PR pack still ran; labels and path matches are additive focus, not a replacement."
        : "The selected E2E scope ran; labels and path matches define the focus for this run.";
    if (!attention.length) {
      return `### ${heading}\n\n${runModel}\n\nChanged files considered: **${changedCount}**. No scenario-specific path match beyond the selected scope.${sampleText}`;
    }
    const detailLines = attention.map((scenario) => {
      const matched = (scenario.matchedFiles || []).slice(0, 4);
      const matchedList = matched.map((file) => "`" + markdownCode(file) + "`").join(", ");
      const files = matched.length
        ? ` Matched: ${matchedList}${scenario.matchedFileCount > matched.length ? ", ..." : ""}.`
        : "";
      const gaps = (scenario.knownGaps || []).length
        ? ` Known gap: ${markdownText((scenario.knownGaps || []).join(" "))}`
        : "";
      return `- **${markdownText(scenario.title || scenario.name)}**:${files}${gaps}`;
    });
    const details = `<details><summary>Matched files and known gaps</summary>\n\n${detailLines.join("\n")}\n\n</details>`;
    const selectedCount = (selection.selected || []).length;
    if (selectedCount > 0 && attention.length >= selectedCount) {
      return `### ${heading}\n\n${runModel}\n\nChanged files considered: **${changedCount}**. All selected scenarios matched PR risk areas; matched files and known gaps are collapsed below.\n\n${details}${sampleText}`;
    }
    const lines = attention.map((scenario) => {
      return `- **${markdownText(scenario.title || scenario.name)}**: ${markdownText(scenario.summary)}`;
    });
    return `### ${heading}\n\n${runModel}\n\nChanged files considered: **${changedCount}**. Scenario-specific risk matches:\n\n${lines.join("\n")}\n\n${details}${sampleText}`;
  }

  function summarizeError(error) {
    const raw = normalizeDiagnosticText(error);
    if (!raw) {
      return { summary: "No error message captured.", signals: [] };
    }
    const lines = diagnosticLines(raw);
    const signals = lines.filter(isSignalLine);
    const summaryLine = signals.at(-1) || lines.at(-1) || raw;
    const summary = summaryLine
      .replace(/^\[[a-z]+\]\s+/i, "")
      .replace(/^(?:ERROR|Error|error):\s*/, "")
      .trim();
    return {
      summary: summary.length > 220 ? `${summary.slice(0, 217)}...` : summary,
      signals: signals.slice(-3).map((line) => truncate(line, 180)),
    };
  }

  function nextActionForError(error, report) {
    const text = String(error || "");
    if (/Missing full-Mac E2E GitHub secrets/i.test(text)) {
      return "Add the missing MAC_E2E_* GitHub secrets, then rerun the E2E gate.";
    }
    if (/No \.app bundle in artifact|End-of-central-directory|cannot find zipfile/i.test(text)) {
      return "Verify the Build macOS App artifact for this commit, then rerun once artifact download and extraction succeed.";
    }
    if (/Full-Mac runner did not produce|full_mac_runner_unavailable|SSH status/i.test(text)) {
      return "Check the configured Mac runner reachability and scenario log, then rerun the full-Mac lane.";
    }
    if (providerEnvironmentTextPattern.test(text)) {
      return "Top up or rotate the live provider/API key, confirm its billing limit, then rerun the live provider lane.";
    }
    if (/WDIO scenario command failed|Failed to create a session|plugin request failed|no window/i.test(text)) {
      return "Inspect the WDIO diagnostic log and confirm the hosted runner built and launched the Tauri debug app before rerunning.";
    }
    if (/webview_frame_timeline_(invalid|missing|low_information)/i.test(text)) {
      return "Inspect the hosted WDIO screenshot proof and frame-timeline diagnostics, then rerun the scenario.";
    }
    if (/webview_recording_(invalid|missing)/i.test(text)) {
      return "Inspect the hosted WDIO legacy frame-replay diagnostics, then rerun the scenario.";
    }
    if (/screen_recording_(invalid|missing)|recording/i.test(text)) {
      return "Inspect screenshots and confirm Screen Recording permission on the Mac runner.";
    }
    if (report.htmlReportUrl) {
      return "Open the full report and workflow logs for the failing phase, then rerun the replay command after fixing the cause.";
    }
    return "Inspect the workflow logs for the failing phase, then rerun the replay command after fixing the cause.";
  }

  function primaryProofLabel(report) {
    const proofs = report.proof || [];
    const primary = proofs.find((proof) => proof.isPrimary)
      || proofs.find((proof) => proof.kind === "video")
      || proofs[0];
    if (primary?.visualAnalysis?.source === "wdio-source-frames") {
      return "Webview frame timeline";
    }
    if (primary?.kind === "video" && report.lane === "tauri-wdio") {
      return "Legacy webview frame-replay";
    }
    if (primary?.kind === "video") {
      return "Full-screen recording";
    }
    if (primary?.kind === "screenshot") {
      return "Screenshot";
    }
    if (primary?.kind === "log") {
      return "Diagnostic log";
    }
    return "Proof";
  }

  const reports = findReports(artifactRoot);
  const selection = readSelection(artifactRoot);
  testedCommit = selection?.headSha || testedCommit;
  const table = reports.length
    ? [
        "| Scenario | Lane | Result | What it checks | Report | Proof |",
        "| --- | --- | --- | --- | --- | --- |",
        ...reports.map((report) => {
          const meta = scenarioMeta(selection, report.scenario);
          const proofUrl = report.primaryProofUrl || report.failureProofUrl;
          const proof = isPublicUrl(proofUrl)
            ? linkOrArtifact(proofUrl, primaryProofLabel(report))
            : publicOrArtifact(proofUrl);
          const reportUrl = linkOrArtifact(report.htmlReportUrl, "Report");
          const checks = meta.summary || "Scenario coverage metadata unavailable.";
          return "| `" + markdownCode(report.scenario) + "` | " + tableCell(report.lane) + " | **" + tableCell(report.status) + "** | " + tableCell(checks) + " | " + tableCell(reportUrl) + " | " + tableCell(proof) + " |";
        }),
      ].join("\n")
    : required
      ? "_No report JSON found. Check workflow artifacts/logs._"
      : "";
  const failureSections = reports
    .filter((report) => report.status !== "passed")
    .map((report) => {
      const meta = scenarioMeta(selection, report.scenario);
      const phase = (report.phases || []).find((item) => item.status !== "passed");
      const heading = `### Failure: \`${markdownCode(report.scenario)}\``;
      const analysis = summarizeError(phase?.error);
      const coverage = (meta.coverage || []).length
        ? `\n\n**Expected coverage:** ${markdownText(meta.coverage.join("; "))}`
        : "";
      const gaps = (meta.knownGaps || []).length
        ? `\n\n**Known gap:** ${markdownText(meta.knownGaps.join(" "))}`
        : "";
      const matchedFileList = (meta.matchedFiles || []).map((file) => "`" + markdownCode(file) + "`").join(", ");
      const matchedFiles = (meta.matchedFiles || []).length
        ? `\n\n**PR focus files:** ${markdownText(matchedFileList)}`
        : "";
      const phaseText = phase
        ? `**Phase:** ${markdownText(phase.name)}\n\n**What happened:** ${markdownText(analysis.summary)}\n\n**Next action:** ${markdownText(nextActionForError(phase.error, report))}`
        : "**Error:** No failing phase captured";
      const limitations = report.captureLimitations?.length
        ? `\n\n**Capture limitations:** ${markdownText(report.captureLimitations.map(humanizeCaptureLimitation).join(", "))}`
        : "";
      const signals = analysis.signals.length > 1
        ? `\n\n**Diagnostic signal:** ${markdownText(analysis.signals.join(" | "))}`
        : "";
      const image = isPublicUrl(report.failureScreenshotUrl)
        ? `\n\n![Failure proof](${report.failureScreenshotUrl})`
        : "";
      const videoLink = isPublicUrl(report.failureVideoUrl)
        ? `\n\n[${report.lane === "tauri-wdio" ? "Failure legacy webview frame-replay" : "Failure full-screen recording"}](${report.failureVideoUrl})`
        : "";
      const logProof = (report.proof || []).find((proof) => proof.kind === "log" && isPublicUrl(proof.url));
      const logLink = logProof
        ? `\n\n[Diagnostic log](${logProof.url})`
        : "";
      const reportLink = isPublicUrl(report.htmlReportUrl)
        ? `\n\n[Full HTML report](${report.htmlReportUrl})`
        : "";
      const replay = report.replayCommand
        ? `\n\n**Replay:** \`${markdownCode(report.replayCommand)}\``
        : "";
      return `${heading}\n\n${phaseText}${coverage}${gaps}${matchedFiles}${limitations}${signals}${image}${videoLink}${logLink}${reportLink}${replay}`;
    })
    .join("\n\n");
  const scope = formatScope(selection, reports, required);
  const runShape = selection?.selectionMode === "all-label"
    ? "`e2e:all` forced the full validation pack, including full-Mac. Normal PRs keep this format but only run full-Mac when labels or matched full-Mac paths select it."
    : "";
  const attentionSection = renderAdversarialFocus(selection);
  const coverageNote = selection?.note || "Scripted product-surface E2E pack runs first; PR-matched risk areas are called out as adversarial focus. Coverage is broad, not exhaustive.";
  const reportIndexUrl = selection?.reportPrefix
    ? `https://releases.nixmac.com/${selection.reportPrefix}/index.html`
    : "";
  const aiQaReportUrl = selection?.reportPrefix
    ? `https://releases.nixmac.com/${selection.reportPrefix}/ai-qa/index.html`
    : "";
  const previewNotice = prSideEffectsEnabled
    ? ""
    : "\n\n> Preview only: no PR comment, check run, or commit status was updated.";

  const detailsBody = [
    "## nixmac E2E",
    previewNotice.trim(),
    `**Status:** ${status}`,
    `**Why this ran:** ${reason}`,
    `**Scope:** ${scope}`,
    runShape ? `**Run shape:** ${runShape}` : "",
    `**Coverage note:** ${coverageNote}`,
    `**Tested commit:** \`${testedCommit}\``,
    attentionSection,
    required ? table : "",
    failureSections,
    aiQaReportUrl ? `[AI QA evidence packet](${aiQaReportUrl})` : "",
    `[Workflow run](${runUrl})`,
  ].filter((section) => String(section || "").trim()).join("\n\n");

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${detailsBody}\n`);
  }

  if (!prSideEffectsEnabled) {
    core.info("PR side effects disabled for this run; wrote workflow summary preview only.");
    return;
  }

  if (!prNumber) {
    core.info("No PR number resolved; skipping PR comment, check run, and commit status.");
    return;
  }

  let checkHtmlUrl = runUrl;
  const checkName = "nixmac E2E Report";
  const checkConclusion = ["success", "failure", "neutral", "cancelled", "skipped", "timed_out", "action_required"].includes(conclusion)
    ? conclusion
    : "failure";
  const checkSummary = [
    `**Status:** ${status}`,
    `**Why this ran:** ${reason}`,
    `**Scope:** ${scope}`,
    runShape ? `**Run shape:** ${runShape}` : "",
    `**Coverage note:** ${coverageNote}`,
    `**Tested commit:** \`${testedCommit}\``,
  ].join("\n\n");
  const checkText = [
    attentionSection,
    required ? table : "",
    failureSections,
    aiQaReportUrl ? `[AI QA evidence packet](${aiQaReportUrl})` : "",
    `[Workflow run](${runUrl})`,
  ].filter(Boolean).join("\n\n");
  const failedReports = reports.filter((report) => report.status !== "passed");
  const compactFailures = failedReports.length
    ? `**Failed:** ${failedReports.map((report) => {
        const reportUrl = isPublicUrl(report.htmlReportUrl)
          ? `[${markdownCode(report.scenario)}](${report.htmlReportUrl})`
          : "`" + markdownCode(report.scenario) + "`";
        return reportUrl;
      }).join(", ")}`
    : "";
  const checkRunPayload = {
    owner: context.repo.owner,
    repo: context.repo.repo,
    name: checkName,
    status: "completed",
    conclusion: checkConclusion,
    details_url: runUrl,
    output: {
      title: `nixmac E2E ${status}`,
      summary: checkSummary,
      text: checkText,
    },
    completed_at: new Date().toISOString(),
  };
  try {
    const checkRuns = await github.rest.checks.listForRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: testedCommit,
      check_name: checkName,
      per_page: 100,
    });
    const existingCheck = checkRuns.data.check_runs.find((check) => check.name === checkName);
    checkHtmlUrl = existingCheck?.html_url || checkHtmlUrl;
    const checkResponse = existingCheck
      ? await github.rest.checks.update({
          ...checkRunPayload,
          check_run_id: existingCheck.id,
        })
      : await github.rest.checks.create({
          ...checkRunPayload,
          head_sha: testedCommit,
        });
    checkHtmlUrl = checkResponse.data?.html_url || checkHtmlUrl;
  } catch (error) {
    core.warning(
      `Failed to publish nixmac E2E Report check: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const body = [
    marker,
    "## nixmac E2E",
    previewNotice.trim(),
    `**Status:** ${status}`,
    compactFailures,
    `**Scope:** ${scope}`,
    runShape ? `**Run shape:** ${runShape}` : "",
    `**Tested commit:** \`${testedCommit}\``,
    reportIndexUrl ? `[Reports & proof](${reportIndexUrl})` : "",
    `[GitHub E2E details](${checkHtmlUrl})`,
    `[Workflow run](${runUrl})`,
  ].filter((section) => String(section || "").trim()).join("\n\n");

  const comments = await github.paginate(github.rest.issues.listComments, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: prNumber,
    per_page: 100,
  });
  const existing = comments.find((comment) => comment.body?.includes(marker));
  if (existing) {
    await github.rest.issues.updateComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: existing.id,
      body,
    });
  } else {
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      body,
    });
  }

  const statusState = checkConclusion === "success" ? "success" : checkConclusion === "cancelled" ? "error" : "failure";
  await github.rest.repos.createCommitStatus({
    owner: context.repo.owner,
    repo: context.repo.repo,
    sha: testedCommit,
    state: statusState,
    target_url: runUrl,
    description: truncate(`E2E ${status}: ${reason}`, 140),
    context: "nixmac/e2e",
  });

};
