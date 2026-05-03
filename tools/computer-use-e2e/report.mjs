import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { curatedProofKeys, scenarioGroups, screenshotAnnotations } from './scenario-catalog.mjs';
import { failureTaxonomy } from './schemas.mjs';
import { redact } from './redaction.mjs';

function escapeHtml(value) {
  return redact(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
  return { fail: 0, inconclusive: 1, pass: 2 }[status] ?? 3;
}

function statusCounts(state) {
  const counts = { pass: 0, fail: 0, inconclusive: 0 };
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
  if (ungrouped.length) groups.push({ name: 'Other', keys: ungrouped.map((item) => item.key), items: ungrouped });
  return groups;
}

function artifactLinks(state, key, proofForScenario) {
  const proof = proofForScenario(state, key);
  const screenshotLinks = proof.screenshotArtifacts.map((artifact) => `<a href="#screenshot-${escapeHtml(slugify(artifact.label || artifact.path))}"><code>${escapeHtml(artifact.path)}</code></a>`);
  const textLinks = proof.textArtifacts.map((artifact) => `<a href="${escapeHtml(artifact.path)}" target="_blank" rel="noopener"><code>${escapeHtml(artifact.path)}</code></a>`);
  const links = [...screenshotLinks, ...textLinks].join('<br>');
  return links ? `<div class="artifact-list">${links}</div>` : 'No primary artifact linked.';
}

async function readTextExcerpt(state, artifact, maxLines = 10) {
  if (!artifact?.path) return '';
  const fullPath = path.join(state.runDir, artifact.path);
  if (!(await pathExists(fullPath))) return '';
  const text = redact(await readFile(fullPath, 'utf8'));
  return text
    .split('\n')
    .filter((line) => line.trim())
    .slice(0, maxLines)
    .join('\n')
    .slice(0, 1400);
}

function knownCoverageGaps(state) {
  const gaps = [];
  for (const [key, scenario] of Object.entries(state.scenarios)) {
    if (scenario.status !== 'pass') {
      gaps.push({
        label: scenario.label,
        status: scenario.status,
        detail: scenario.notes.join(' ') || 'No detail recorded.',
      });
    }
  }
  if (!state.remoteMachine || !state.remoteApp) {
    gaps.push({
      label: 'Remote Mac/app metadata',
      status: 'inconclusive',
      detail: 'Remote machine identity, OS, hardware, staged app path, bundle version, and signing metadata were not captured.',
    });
  }
  if (!state.processEnvVerification) {
    gaps.push({
      label: 'Credential process-env verification',
      status: 'inconclusive',
      detail: 'The nixmac process and GUI launchd credential environment were not checked with redacted values.',
    });
  }
  if (!state.safety?.disposableConfig) {
    gaps.push({
      label: 'Disposable config proof',
      status: 'inconclusive',
      detail: 'Remote run has not proven nixmac is pointed at a per-run disposable config.',
    });
  }
  return gaps;
}

function annotationClass(item) {
  return ['annotation', item.tone ? `annotation-${item.tone}` : ''].filter(Boolean).join(' ');
}

function annotationStyle(item) {
  if (item.tone === 'pin') {
    return `left:${item.x}%;top:${item.y}%;width:16px;height:16px;transform:translate(-50%,-50%)`;
  }
  return `left:${item.x}%;top:${item.y}%;width:${item.w}%;height:${item.h}%`;
}

function renderAnnotatedImage(shot) {
  const annotations = screenshotAnnotations[shot.label] || [];
  const imageSize = shot.imageSize ? `${shot.imageSize.width}x${shot.imageSize.height}` : 'unknown-size';
  const overlays = annotations
    .map(
      (item) => `<span class="${annotationClass(item)}" style="${annotationStyle(item)}"><span>${escapeHtml(item.label)}</span></span>`,
    )
    .join('\n');
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
      .map((shot) => `<figure>${renderAnnotatedImage(shot)}<figcaption><strong>${escapeHtml(shot.label)}</strong> - ${escapeHtml(shot.note || '')}</figcaption></figure>`)
      .join('\n');
    const excerpts = [];
    for (const artifact of proof.textArtifacts.slice(0, 2)) {
      const excerpt = await readTextExcerpt(state, artifact);
      if (excerpt) excerpts.push(`<details><summary>${escapeHtml(artifact.path)}</summary><pre>${escapeHtml(excerpt)}</pre></details>`);
    }
    cards.push(`<section class="proof-card">
  <h3>${escapeHtml(scenario.label)}</h3>
  <p><span class="verdict ${scenario.status}">${escapeHtml(scenario.status)}</span> <span class="grade">${escapeHtml(proof.grade)}</span></p>
  <p><strong>Assertion:</strong> ${escapeHtml(proof.proof)}</p>
  <p><strong>Not proved:</strong> ${escapeHtml(proof.untested)}</p>
  ${screenshots}
  ${excerpts.join('\n')}
</section>`);
  }
  return cards.length ? cards.join('\n') : '<p>No visual proof cards generated.</p>';
}

async function renderVisualProofBoard(state, proofForScenario) {
  const prKeys = new Set(state.prFocus?.scenarioKeys || []);
  const nonPassKeys = Object.entries(state.scenarios)
    .filter(([, scenario]) => scenario.status !== 'pass')
    .map(([key]) => key);
  const settingsFocused = [...prKeys].some((key) => /^settings/.test(key));
  const defaultKeys = [
    ...nonPassKeys,
    ...curatedProofKeys.filter((key) => !/^settings/.test(key) || settingsFocused || state.scenarios[key]?.status !== 'pass'),
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
  const gaps = knownCoverageGaps(state);
  if (!gaps.length) return '<p>No known coverage gaps recorded.</p>';
  return `<table>
    <thead><tr><th>Gap</th><th>Status</th><th>Detail</th></tr></thead>
    <tbody>
      ${gaps.map((gap) => `<tr><td>${escapeHtml(gap.label)}</td><td><span class="verdict ${gap.status}">${escapeHtml(gap.status)}</span></td><td>${escapeHtml(gap.detail)}</td></tr>`).join('\n')}
    </tbody>
  </table>`;
}

function renderPrFocus(state) {
  const pr = state.prFocus || { configured: false, changedFiles: [], userVisibleFiles: [], scenarioKeys: [] };
  const changed = pr.changedFiles?.length ? pr.changedFiles.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join('\n') : '<li>No changed-file metadata provided.</li>';
  const userVisible = pr.userVisibleFiles?.length ? pr.userVisibleFiles.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join('\n') : '<li>No user-visible changed files inferred from current metadata.</li>';
  const scenarios = pr.scenarioKeys?.length ? pr.scenarioKeys.map((key) => `<li>${escapeHtml(state.scenarios?.[key]?.label || key)}</li>`).join('\n') : '<li>No dedicated scenario mapping inferred from changed files.</li>';
  return `<section class="panel">
    <p><strong>PR:</strong> ${escapeHtml(pr.number || 'not provided')} ${pr.title ? `- ${escapeHtml(pr.title)}` : ''}</p>
    <p><strong>Refs:</strong> ${escapeHtml(pr.baseRef || 'base ?')} ← ${escapeHtml(pr.headRef || 'head ?')}</p>
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
      return `<tr><td class="scenario-cell">${escapeHtml(item.label)}<br><small>${item.notes.map(escapeHtml).join('<br>') || 'No notes recorded.'}</small></td><td class="status-cell"><span class="verdict ${item.status}">${escapeHtml(item.status)}</span></td><td class="grade-cell"><span class="grade">${escapeHtml(proof.grade)}</span><br><span class="strength strength-${escapeHtml(contract.evidenceStrength || 'not-proved')}">${escapeHtml(contract.evidenceStrength || 'not-proved')}</span></td><td class="artifact-cell">${artifactLinks(state, item.key, proofForScenario)}</td><td class="proof-cell">${escapeHtml(proof.proof)}${contract.failureClass ? `<br><small>Failure class: ${escapeHtml(contract.failureClass)}</small>` : ''}</td></tr>`;
    })
    .join('\n');
}

function scenariosWithStatus(state, status) {
  return Object.entries(state.scenarios)
    .filter(([, item]) => item.status === status)
    .map(([key, item]) => ({ key, ...item }));
}

function renderPriorityTriage(state, proofForScenario) {
  const failed = scenariosWithStatus(state, 'fail');
  const inconclusive = scenariosWithStatus(state, 'inconclusive');
  const passed = scenariosWithStatus(state, 'pass');
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
  if (!pr.configured) return `<h2 id="pull-request-focus">Pull Request Focus</h2>${renderPrFocus(state)}`;
  const keys = pr.scenarioKeys?.length ? pr.scenarioKeys : ['prSpecificCoverage'];
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

function renderCoverageFreshness(state) {
  const coverage = state.coverageFreshness;
  if (!coverage) return '';
  const driftRows = coverage.drift?.length
    ? coverage.drift.map((item) => `<tr><td><span class="verdict fail">drift</span></td><td>${escapeHtml(item)}</td></tr>`).join('\n')
    : '<tr><td><span class="verdict pass">clean</span></td><td>No unmapped user-visible candidate files or manifest mapping errors detected.</td></tr>';
  const waiverRows = coverage.waivers?.length
    ? coverage.waivers.map((item) => `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.owner || 'unowned')}</td><td>${escapeHtml(item.risk || 'unset')}</td><td>${escapeHtml(item.reviewBy || 'unset')}</td><td>${escapeHtml(item.reason)}</td><td>${escapeHtml(item.exitCriteria || 'No exit criteria recorded.')}${item.validationErrors?.length ? `<br><strong>Validation:</strong> ${escapeHtml(item.validationErrors.join('; '))}` : ''}</td></tr>`).join('\n')
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
  const entries = Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!entries.length) return '<tr><td colspan="2">No metadata recorded.</td></tr>';
  return entries
    .map(([key, value]) => {
      const rendered = Array.isArray(value) ? value.join(', ') : String(value);
      return `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(rendered)}</td></tr>`;
    })
    .join('\n');
}

function renderRemoteMetadata(state) {
  const env = state.processEnvVerification || {};
  const machineSummary = [
    state.remoteMachine?.hostname || state.remoteMachine?.localHostName || 'unknown host',
    state.remoteMachine?.macosProductVersion ? `macOS ${state.remoteMachine.macosProductVersion}` : null,
    state.remoteMachine?.architecture,
  ]
    .filter(Boolean)
    .join(' · ');
  const appSummary = [
    state.remoteApp?.bundleName || 'nixmac',
    state.remoteApp?.shortVersion || state.remoteApp?.bundleVersion,
    state.remoteApp?.codesignVerified === true ? 'codesign verified' : 'codesign not verified',
  ]
    .filter(Boolean)
    .join(' · ');
  const envSummary = [
    env.processFound === true ? `process ${env.pid || 'found'}` : 'process not found',
    `OpenRouter key ${env.openrouterApiKeyInProcess || 'unknown'}`,
    env.secretValuesRecorded === false ? 'secrets not recorded' : 'secret recording unknown',
  ].join(' · ');
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
  ${state.remoteMetadataError ? `<p class="warning"><strong>Metadata capture error:</strong> ${escapeHtml(state.remoteMetadataError)}</p>` : ''}`;
}

function renderEvolvedCaseStrategy(state) {
  const strategy = state.evolvedCaseStrategy || { catalog: [], defaultCaseIds: [], extraCaseIds: [], reviewDecision: '' };
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
    .join('\n');
  const runRows = runs.length
    ? runs
        .map(
          (run) => `<tr>
            <td><code>${escapeHtml(run.id)}</code><br><small>${escapeHtml(run.label || '')}</small></td>
            <td>${escapeHtml(run.mode || '')}</td>
            <td><span class="verdict ${escapeHtml(run.status || 'inconclusive')}">${escapeHtml(run.status || 'inconclusive')}</span></td>
            <td>${escapeHtml((run.notes || []).join(' '))}</td>
          </tr>`,
        )
        .join('\n')
    : '<tr><td colspan="4">No optional evolved review-only cases were enabled for this run.</td></tr>';
  return `<section>
    <h3>Evolved Flow Case Strategy</h3>
    <p>${escapeHtml(strategy.reviewDecision || '')}</p>
    <p><strong>Default case:</strong> ${escapeHtml((strategy.defaultCaseIds || []).join(', ') || 'none')}<br>
    <strong>Enabled extra cases:</strong> ${escapeHtml((strategy.extraCaseIds || []).join(', ') || 'none')}</p>
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
  if (state.video?.status === 'available' && state.video.path) {
    return `<div id="summary-video" class="summary-video">
      <div class="summary-video-copy">
        <strong>Evidence video</strong>
        <small>Screenshot walkthrough compiled from ${escapeHtml(String(state.video.frames || state.screenshots.length))} safe-to-store frames.</small>
      </div>
      <video controls preload="metadata" src="${escapeHtml(state.video.path)}"></video>
    </div>
    ${evidencePack}`;
  }
  return `<div id="summary-video" class="summary-video summary-video-unavailable">
    <div class="summary-video-copy">
      <strong>Evidence video unavailable</strong>
      <small>${escapeHtml(state.video?.note || 'No screenshot compilation video was generated for this run.')}</small>
    </div>
  </div>
  ${evidencePack}`;
}

function renderExecutiveSummary(state, counts, evidenceSummary) {
  const pr = state.prFocus || { configured: false };
  const prLabel = pr.configured ? `PR ${pr.number || '?'}${pr.title ? ` - ${pr.title}` : ''}` : 'No pull request metadata provided';
  const prStatus = state.scenarios.prSpecificCoverage?.status || 'inconclusive';
  const coverageStatus = state.scenarios.mainCoverageFreshness?.status || 'inconclusive';
  const saveStatus = state.scenarios.saveFlow?.status || 'inconclusive';
  const rollbackStatus = state.scenarios.rollbackCleanup?.status || 'inconclusive';
  const metadataStatus = state.remoteMachine && state.remoteApp ? 'pass' : 'inconclusive';
  const interpretation =
    state.verdict === 'pass'
      ? 'The PR-head run passed on the DXU remote Mac with no failed or inconclusive scenario checks.'
      : state.verdict === 'fail'
        ? 'The run has failures that should be inspected before treating this PR as E2E-clean.'
        : 'The run is inconclusive; inspect setup, provider, and coverage notes before relying on it.';
  const signal = (label, status, note) => `<div class="signal signal-${escapeHtml(status)}">
    <span class="verdict ${escapeHtml(status)}">${escapeHtml(status)}</span>
    <strong>${escapeHtml(label)}</strong>
    <small>${escapeHtml(note)}</small>
  </div>`;
  return `<section id="summary" class="executive panel">
    <div>
      <h2>Review Summary</h2>
      <p>${escapeHtml(interpretation)}</p>
      <p><strong>${escapeHtml(prLabel)}</strong><br><small>Head: <code>${escapeHtml(state.github?.headSha || state.sha || 'unknown')}</code></small></p>
    </div>
    <div class="summary" aria-label="Run summary">
      <div class="metric"><strong>${counts.pass}</strong>Passed</div>
      <div class="metric"><strong>${counts.fail}</strong>Failed</div>
      <div class="metric"><strong>${counts.inconclusive}</strong>Inconclusive</div>
      <div class="metric"><strong>${escapeHtml(String(state.screenshots.length))}</strong>Screenshots</div>
    </div>
    ${renderSummaryVideo(state)}
    <div class="signal-grid">
      ${signal('PR focus', prStatus, pr.configured ? 'Mapped PR-relevant scenarios were evaluated.' : 'No PR metadata was provided.')}
      ${signal('Coverage freshness', coverageStatus, 'Main user-visible surfaces remain mapped or explicitly waived.')}
      ${signal('Step 3 save', saveStatus, 'Disposable config change persisted through the save path.')}
      ${signal('Rollback cleanup', rollbackStatus, 'History rollback returned the disposable config to baseline.')}
      ${signal('Remote metadata', metadataStatus, 'DXU machine, app, and process metadata were captured.')}
    </div>
    <p class="summary-links">
      <a href="#pull-request-focus">Review PR Focus</a>
      <a href="#findings-first">Inspect Findings</a>
      <a href="#visual-proof">Open Visual Proof</a>
      <a href="#remote-metadata">Check Remote Metadata</a>
    </p>
    <p><small>Evidence footprint: ${escapeHtml(evidenceSummary)}.</small></p>
  </section>`;
}

function navBadge(label, value, tone = '') {
  if (value === undefined || value === null || value === '') return '';
  return `<span class="nav-badge ${escapeHtml(tone)}">${escapeHtml(String(value))}</span>`;
}

function renderReportNav(state, counts) {
  const riskCount = Object.values(state.v2?.scenarioContracts || {}).filter((item) => item.accessibilityRisk === 'high' || item.accessibilityRisk === 'medium').length;
  return `<aside class="report-nav" aria-label="Report navigation">
    <a href="#summary">Summary</a>
    <a href="#pull-request-focus">PR Focus ${navBadge('', state.prFocus?.scenarioKeys?.length || 0)}</a>
    <a href="#findings-first">Findings ${navBadge('', counts.fail + counts.inconclusive, counts.fail ? 'fail' : counts.inconclusive ? 'inconclusive' : 'pass')}</a>
    <a href="#evidence-quality">Evidence Quality ${navBadge('', riskCount)}</a>
    <a href="#visual-assertions">Visual Assertions ${navBadge('', state.visualAssertions?.length || 0)}</a>
    <a href="#summary-video">Evidence Video ${navBadge('', state.video?.status === 'available' ? 'available' : 'off')}</a>
    <a href="#visual-proof">Visual Proof ${navBadge('', state.screenshots.length)}</a>
    <a href="#scenario-checklist">Scenario Checklist</a>
    <a href="#main-coverage">Coverage</a>
    <a href="#remote-metadata">Remote Metadata</a>
    <a href="#raw-evidence">Raw Evidence</a>
    <a href="#cleanup">Cleanup</a>
  </aside>`;
}

function renderVisualAssertionResults(state) {
  const assertions = state.visualAssertions || [];
  if (!assertions.length) return '<p>No binding screenshot visual assertions were evaluated for this run.</p>';
  const rows = assertions
    .map((assertion) => {
      const failed = assertion.screenshots.flatMap((shot) => shot.checks.filter((check) => check.status === 'fail').map((check) => `${shot.label}: ${check.name} - ${check.detail}`));
      const checked = assertion.screenshots.reduce((count, shot) => count + shot.checks.length, 0);
      return `<tr>
        <td>${escapeHtml(assertion.label)}<br><small><code>${escapeHtml(assertion.scenarioKey)}</code></small></td>
        <td><span class="verdict ${escapeHtml(assertion.status)}">${escapeHtml(assertion.status)}</span></td>
        <td>${escapeHtml(String(checked))}</td>
        <td>${failed.length ? escapeHtml(failed.join('; ')) : 'Required screenshots decoded and broad visual regions contained visible signal.'}</td>
      </tr>`;
    })
    .join('\n');
  return `<div class="table-scroll"><table>
    <thead><tr><th>Scenario</th><th>Visual Status</th><th>Checks</th><th>Result</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderEvidenceQuality(state) {
  const contracts = Object.values(state.v2?.scenarioContracts || {});
  const strengthCounts = contracts.reduce((counts, item) => {
    counts[item.evidenceStrength] = (counts[item.evidenceStrength] || 0) + 1;
    return counts;
  }, {});
  const strengthRows = ['strong', 'operational', 'visual-supported', 'weak', 'not-proved']
    .map((strength) => `<tr><td><span class="strength strength-${escapeHtml(strength)}">${escapeHtml(strength)}</span></td><td>${escapeHtml(String(strengthCounts[strength] || 0))}</td></tr>`)
    .join('\n');
  const mappingRows = Object.entries(state.v2?.evidenceGradeMapping || {})
    .map(([legacy, strength]) => `<tr><td><code>${escapeHtml(legacy)}</code></td><td><span class="strength strength-${escapeHtml(strength)}">${escapeHtml(strength)}</span></td></tr>`)
    .join('\n');
  const risky = contracts
    .filter((item) => item.accessibilityRisk === 'high' || item.accessibilityRisk === 'medium')
    .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.accessibilityRisk] ?? 3) - ({ high: 0, medium: 1, low: 2 }[b.accessibilityRisk] ?? 3));
  const riskRows = (items) =>
    items.length
      ? items
          .map(
            (item) => `<tr>
              <td>${escapeHtml(item.label)}<br><small>${escapeHtml(item.assertionTypes.join(', '))}</small></td>
              <td><span class="risk risk-${escapeHtml(item.accessibilityRisk)}">${escapeHtml(item.accessibilityRisk)}</span></td>
              <td>${escapeHtml(item.accessibilityRiskReason)}</td>
            </tr>`,
          )
          .join('\n')
      : '<tr><td colspan="3">No elevated assertion-risk scenarios.</td></tr>';
  const nonPassRows = contracts
    .filter((item) => item.status !== 'pass')
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.label)}</td>
        <td><span class="verdict ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td>
        <td><span class="failure-class">${escapeHtml(item.failureClass || 'unclassified')}</span></td>
        <td>${escapeHtml(failureTaxonomy[item.failureClass] || item.failureClassReason || 'No classification recorded.')}</td>
      </tr>`,
    )
    .join('\n');
  const taxonomyRows = Object.entries(failureTaxonomy)
    .map(([key, description]) => `<tr><td><code>${escapeHtml(key)}</code></td><td>${escapeHtml(description)}</td></tr>`)
    .join('\n');
  const boundaryRows = state.confirmationBoundaries.length
    ? state.confirmationBoundaries.map((boundary) => `<li>${escapeHtml(boundary)}</li>`).join('\n')
    : '<li>No confirmation boundaries recorded.</li>';
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
        : '<p>No non-pass scenarios require failure classification.</p>'
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
        buildGate.requiredHeadSha ? `head ${buildGate.requiredHeadSha}` : '',
        buildGate.buildRunId ? `run ${buildGate.buildRunId}` : '',
        buildGate.reason || '',
      ].filter(Boolean).join(' - ')
    : 'not recorded';
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
          ? `<ul>${state.narrative.map((item) => `<li>${escapeHtml(item.ts)} - ${escapeHtml(item.text)}</li>`).join('\n')}</ul>`
          : '<p>No narrative recorded.</p>'
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
                  .map((claim) => `<tr><td>${escapeHtml(claim.claim)}</td><td><span class="verdict ${claim.status}">${escapeHtml(claim.status)}</span></td><td>${escapeHtml(claim.evidence)}</td></tr>`)
                  .join('\n')
              : '<tr><td colspan="3">No claims recorded.</td></tr>'
          }
        </tbody>
      </table>
    </details>
    <details>
      <summary>Run metadata</summary>
      ${renderRunMetadata(state, `${state.screenshots.length} screenshots, ${state.textSnapshots.length} redacted text snapshots`)}
    </details>
  </section>`;
}

function renderGroupedScenarioHtml(state, proofForScenario) {
  return groupedScenarios(state)
    .map(
      (group) => {
        const groupCounts = {
          pass: group.items.filter((item) => item.status === 'pass').length,
          fail: group.items.filter((item) => item.status === 'fail').length,
          inconclusive: group.items.filter((item) => item.status === 'inconclusive').length,
        };
        return `<details class="group">
  <summary>${escapeHtml(group.name)} <span class="nav-badge pass">${groupCounts.pass} pass</span>${groupCounts.fail ? ` <span class="nav-badge fail">${groupCounts.fail} fail</span>` : ''}${groupCounts.inconclusive ? ` <span class="nav-badge inconclusive">${groupCounts.inconclusive} inconclusive</span>` : ''}</summary>
  <div class="table-scroll"><table class="scenario-table">
    <thead><tr><th class="scenario-col">Scenario</th><th class="status-col">Status</th><th class="grade-col">Evidence Grade</th><th class="artifacts-col">Primary Artifacts</th><th class="proof-col">What Proved It</th><th class="untested-col">Still Untested</th></tr></thead>
    <tbody>
      ${group.items
        .map((item) => {
          const proof = proofForScenario(state, item.key);
          const contract = state.v2?.scenarioContracts?.[item.key] || {};
          return `<tr><td class="scenario-cell">${escapeHtml(item.label)}<br><small>${item.notes.map(escapeHtml).join('<br>') || 'No notes recorded.'}</small></td><td class="status-cell"><span class="verdict ${item.status}">${escapeHtml(item.status)}</span></td><td class="grade-cell"><span class="grade">${escapeHtml(proof.grade)}</span><br><span class="strength strength-${escapeHtml(contract.evidenceStrength || 'not-proved')}">${escapeHtml(contract.evidenceStrength || 'not-proved')}</span></td><td class="artifact-cell">${artifactLinks(state, item.key, proofForScenario)}</td><td class="proof-cell">${escapeHtml(proof.proof)}${contract.failureClass ? `<br><small>Failure class: ${escapeHtml(contract.failureClass)}</small>` : ''}</td><td>${escapeHtml(proof.untested)}</td></tr>`;
        })
        .join('\n')}
    </tbody>
  </table></div>
  </details>`;
      },
    )
    .join('\n');
}

export async function renderReportHtml(state, { proofForScenario }) {
  const verdict = state.verdict;
  const coverageFreshnessHtml = renderCoverageFreshness(state);
  const screenshotHtml = state.screenshots.length
    ? state.screenshots
        .map(
          (shot) => `<figure id="screenshot-${escapeHtml(slugify(shot.label || shot.path))}">
  <img src="${escapeHtml(shot.path)}" alt="${escapeHtml(shot.label)}">
  <figcaption><strong>${escapeHtml(shot.label)}</strong> - ${escapeHtml(shot.note || 'No note')} (${escapeHtml(shot.capturedAt)})</figcaption>
</figure>`,
        )
        .join('\n')
    : '<p>No screenshots captured.</p>';
  const counts = statusCounts(state);
  const groupedScenarioHtml = renderGroupedScenarioHtml(state, proofForScenario);
  let evidenceSummary = `${state.screenshots.length} screenshots, ${state.textSnapshots.length} redacted text snapshots`;
  const coverageGapsHtml = renderCoverageGaps(state);
  const prPriorityHtml = renderPrPriority(state, proofForScenario);
  const priorityTriageHtml = renderPriorityTriage(state, proofForScenario);
  if (state.video?.status === 'available') evidenceSummary += ', 1 screenshot video';
  const executiveSummaryHtml = renderExecutiveSummary(state, counts, evidenceSummary);
  const reportNavHtml = renderReportNav(state, counts);
  const evidenceQualityHtml = renderEvidenceQuality(state);
  const visualProofHtml = await renderVisualProofBoard(state, proofForScenario);
  const remoteMetadataHtml = renderRemoteMetadata(state);
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
    .signal-grid, .quality-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; margin: 16px 0; }
    .signal { border: 1px solid #303640; border-radius: 8px; padding: 10px; background: #111318; }
    .signal strong { display: block; margin: 8px 0 4px; }
    .summary-links { display: flex; flex-wrap: wrap; gap: 8px; }
    .nav-badge { display: inline-flex; align-items: center; justify-content: center; border: 1px solid #3c4654; border-radius: 999px; padding: 2px 6px; margin-left: 4px; font-size: 11px; color: #dce3ec; background: #20242d; }
    .verdict { display: inline-block; border-radius: 999px; padding: 5px 10px; font-weight: 700; text-transform: uppercase; }
    .pass { background: #123d2a; color: #8bf0bb; }
    .fail { background: #471a1a; color: #ff9e9e; }
    .inconclusive { background: #443512; color: #ffd36e; }
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
    ul { padding-left: 20px; }
    @media (max-width: 860px) {
      main { padding: 24px 12px 44px; }
      .report-shell { display: block; }
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
      ${prPriorityHtml}

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

      <h2 id="cleanup">Cleanup / Restore Status</h2>
      <section class="panel">
        <p>${escapeHtml(state.cleanup.note)}</p>
      </section>
    </div>
  </div>
</main>
</body>
</html>
`;
}
