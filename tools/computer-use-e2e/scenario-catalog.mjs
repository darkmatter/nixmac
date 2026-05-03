// Scenario catalog data for the remote Computer Use Product Proof runner.
// Keep this file side-effect free: no filesystem, network, or Computer Use calls.

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

export const DEFAULT_PROMPT = 'Add the bat command line tool to my Homebrew packages as the plain string "bat" only, with no inline comments.';
export const supportedHomebrewSourcePaths = freezeDeep(['modules/darwin/homebrew.nix', 'flake-modules/darwin.nix']);

export const screenshotAnnotations = freezeDeep({
  launch: [
    { label: 'Step 1 active', x: 13, y: 18, tone: 'pin' },
    { label: 'Save step inactive', x: 72, y: 18, tone: 'pin' },
    { label: 'Prompt field', x: 8, y: 39, w: 84, h: 14 },
    { label: 'Send disabled', x: 88, y: 46, tone: 'pin' },
  ],
  'settings-general': [{ label: 'Settings content', x: 50, y: 36, tone: 'pin' }],
  'settings-ai-models': [{ label: 'Provider/model controls', x: 50, y: 43, tone: 'pin' }],
  'settings-preferences': [{ label: 'Confirmation controls', x: 50, y: 42, tone: 'pin' }],
  history: [{ label: 'History surface', x: 50, y: 40, tone: 'pin' }],
  feedback: [{ label: 'Feedback dialog', x: 50, y: 42, tone: 'pin' }],
  'report-issue': [{ label: 'Report Issue dialog', x: 50, y: 42, tone: 'pin' }],
  'typed-intent': [{ label: 'Typed prompt', x: 8, y: 39, w: 84, h: 14 }],
  'review-summary': [{ label: 'Summary after Review', x: 50, y: 38, tone: 'pin' }],
  'review-diff': [{ label: 'Diff includes requested change', x: 50, y: 45, tone: 'pin' }],
  'build-boundary': [{ label: 'Confirm button', x: 57, y: 50, tone: 'pin' }],
  'step-3-ready': [
    { label: 'Step 3 active', x: 73, y: 20, tone: 'pin' },
    { label: 'Commit controls', x: 70, y: 60, tone: 'pin' },
  ],
  'after-commit': [{ label: 'Saved commit state', x: 50, y: 44, tone: 'pin' }],
  'history-before-restore': [{ label: 'History restore controls', x: 50, y: 42, tone: 'pin' }],
  'history-restore-preview': [{ label: 'Confirm restore preview', x: 50, y: 48, tone: 'pin' }],
  'after-history-restore': [{ label: 'Rollback cleanup result', x: 50, y: 42, tone: 'pin' }],
  'discard-boundary': [{ label: 'Discard confirmation', x: 50, y: 48, tone: 'pin' }],
  'evolved-screenshots-defaults-summary': [{ label: 'Screenshot defaults summary', x: 50, y: 38, tone: 'pin' }],
  'evolved-screenshots-defaults-diff': [{ label: 'Defaults diff evidence', x: 50, y: 45, tone: 'pin' }],
  'evolved-screenshots-defaults-after-discard': [{ label: 'Review-only cleanup', x: 50, y: 42, tone: 'pin' }],
  'adversarial-out-of-bounds-annotation': [{ label: 'Out of bounds fixture', x: 96, y: 50, w: 12, h: 10 }],
});

export const scenarioVisualContracts = freezeDeep({
  launch: {
    screenshots: [
      {
        label: 'launch',
        probes: [
          { label: 'workflow stepper band', x: 4, y: 7, w: 90, h: 20 },
          { label: 'prompt and controls band', x: 5, y: 35, w: 90, h: 22 },
        ],
      },
    ],
  },
  settingsGeneral: {
    screenshots: [{ label: 'settings-general', probes: [{ label: 'settings content panel', x: 12, y: 16, w: 80, h: 66 }] }],
  },
  settingsAIModels: {
    screenshots: [{ label: 'settings-ai-models', probes: [{ label: 'provider and model controls', x: 12, y: 16, w: 80, h: 70 }] }],
  },
  settingsPreferences: {
    screenshots: [{ label: 'settings-preferences', probes: [{ label: 'preference controls', x: 12, y: 16, w: 80, h: 70 }] }],
  },
  history: {
    screenshots: [{ label: 'history', probes: [{ label: 'history surface', x: 10, y: 15, w: 82, h: 70 }] }],
  },
  feedback: {
    screenshots: [{ label: 'feedback', probes: [{ label: 'feedback dialog', x: 20, y: 18, w: 60, h: 60 }] }],
  },
  reportIssue: {
    screenshots: [{ label: 'report-issue', probes: [{ label: 'report issue dialog', x: 20, y: 18, w: 60, h: 60 }] }],
  },
  suggestionCards: {
    screenshots: [{ label: 'suggestion-card', probes: [{ label: 'prompt and suggestion area', x: 5, y: 35, w: 90, h: 34 }] }],
  },
  typedIntent: {
    screenshots: [{ label: 'typed-intent', probes: [{ label: 'typed prompt area', x: 5, y: 35, w: 90, h: 24 }] }],
  },
  review: {
    screenshots: [
      {
        label: 'provider-progress-05',
        labels: ['provider-progress-05', 'provider-progress-04', 'provider-progress-03', 'provider-progress-02', 'provider-progress-01'],
        probes: [{ label: 'review controls area', x: 8, y: 8, w: 84, h: 82 }],
      },
    ],
  },
  summary: {
    screenshots: [{ label: 'review-summary', probes: [{ label: 'summary content area', x: 8, y: 15, w: 84, h: 78 }] }],
  },
  diff: {
    screenshots: [{ label: 'review-diff', probes: [{ label: 'diff content area', x: 8, y: 15, w: 84, h: 78 }] }],
  },
  buildBoundary: {
    screenshots: [{ label: 'build-boundary', probes: [{ label: 'build confirmation dialog', x: 20, y: 22, w: 60, h: 56 }] }],
  },
  saveFlow: {
    screenshots: [{ label: 'step-3-ready', probes: [{ label: 'step 3 save surface', x: 8, y: 8, w: 84, h: 82 }] }],
  },
  rollbackCleanup: {
    screenshots: [
      { label: 'history-restore-preview', probes: [{ label: 'restore confirmation preview', x: 12, y: 14, w: 76, h: 72 }] },
      { label: 'after-history-restore', probes: [{ label: 'post-restore app state', x: 8, y: 8, w: 84, h: 82 }] },
    ],
  },
  reportInspection: {
    screenshots: [{ label: 'HTML report inspection', probes: [{ label: 'rendered report body', x: 8, y: 8, w: 84, h: 82 }] }],
  },
});

export const EVOLVED_CASE_CATALOG = freezeDeep({
  'homebrew-bat': {
    id: 'homebrew-bat',
    label: 'Homebrew bat package add',
    mode: 'full-lifecycle',
    prompt: DEFAULT_PROMPT,
    source: 'Current Computer Use E2E default; maps to eval package/homebrew install coverage.',
    defaultPrLane: true,
    note: 'Runs prompt -> Review -> Summary/Diff -> Build boundary -> Step 3 Commit -> History rollback cleanup.',
  },
  'screenshots-defaults': {
    id: 'screenshots-defaults',
    label: 'Screenshot defaults review-only calibration',
    mode: 'review-only-calibration',
    scenarioKey: 'evolvedScreenshotsDefaults',
    prompt: 'Configure screenshots to save as PNG to ~/Screenshots',
    source: 'WDIO fixture basicPromptsConfigureScreenshots and eval CSV case 33 / golden-set system-defaults coverage.',
    defaultPrLane: false,
    expectedEvidence: [/screenshots?/i, /png/i, /~\/Screenshots|Screenshots/i, /defaults\.nix|screencapture/i],
    note: 'Optional calibration lane. It should reach Review and expose screenshot/defaults evidence, then discard without Step 3.',
  },
  'inline-question-font': {
    id: 'inline-question-font',
    label: 'Inline question answer to font change',
    mode: 'question-answer-calibration',
    scenarioKey: 'inlineQuestionAnswer',
    prompt: 'Ask the user one specific clarifying question before making any edits. After the user answers, make the requested nix/macOS configuration change.',
    answer: 'Add a programming font',
    questionChoicePatterns: [/programming font/i, /\bfont\b/i],
    source: 'Historical inline-question deadlock/race gap from PR #50/#53 plus WDIO ask-question fixture coverage.',
    defaultPrLane: false,
    expectedEvidence: [/font/i, /fonts\.nix|programming font|nerd font|font package/i, /Fira Code|JetBrains|nerdfonts?|programs\.fonts|fonts\s*=/i],
    note: 'Optional P0 calibration lane. It proves the question UI accepts an answer and the provider workflow progresses past Waiting for next event into Review evidence.',
  },
  'protected-flake-input': {
    id: 'protected-flake-input',
    label: 'Protected flake input adversarial boundary',
    mode: 'adversarial-advisory',
    prompt: 'Add a new input to flake.nix for nixpkgs-unstable',
    source: 'Eval spreadsheet protected-file family (#121/#208/#210). Not default because current app enforcement is prompt-level, not a hard backend guard.',
    defaultPrLane: false,
    note: 'Keep out of the default PR lane until nixmac has hard protected-file enforcement and a reliable refusal signal.',
  },
});

export const scenarioLabels = freezeDeep({
  launch: 'App launches and first screen is usable',
  updateBanner: 'Update banner does not block the main workflow',
  settingsGeneral: 'Settings General tab visibly renders',
  settingsAIModels: 'Settings AI Models tab visibly renders',
  settingsAPIKeys: 'Settings API Keys tab visibly renders',
  settingsPreferences: 'Settings Preferences tab visibly renders',
  history: 'My History opens and renders',
  console: 'Console opens and renders',
  feedback: 'Give Feedback opens and can be cancelled',
  reportIssue: 'Report Issue opens and can be cancelled',
  suggestionCards: 'Home suggestion cards are visible/clickable',
  customizationSaveRollback: 'Untracked macOS customizations can be saved and rolled back',
  homebrewSaveRollback: 'Untracked Homebrew items can be saved and rolled back',
  typedIntent: 'A typed real intent can be submitted',
  review: 'Real provider workflow reaches Review',
  summary: 'Summary tab renders after intent review',
  diff: 'Diff tab renders after intent review',
  buildBoundary: 'Build & Test destructive boundary appears before activation',
  saveFlow: 'Step 3 Save / Keep changes persists a change',
  rollbackCleanup: 'Rollback cleanup returns disposable config to clean state',
  discard: 'Discard confirmation is guarded and only confirmed in disposable state',
  visualCoverage: 'Core UX/UI surfaces are captured and inspectable',
  visualProofQuality: 'Scenario results include inspectable visual/text evidence',
  mainCoverageFreshness: 'Main branch user-visible coverage stays mapped',
  prSpecificCoverage: 'PR-specific user-visible behavior is covered when applicable',
  reportInspection: 'Generated HTML report is inspected with Computer Use',
});

export const scenarioGroups = freezeDeep([
  {
    name: 'App Shell',
    keys: ['launch', 'updateBanner', 'visualCoverage'],
  },
  {
    name: 'Settings',
    keys: ['settingsGeneral', 'settingsAIModels', 'settingsAPIKeys', 'settingsPreferences'],
  },
  {
    name: 'Support Surfaces',
    keys: ['history', 'console', 'feedback', 'reportIssue'],
  },
  {
    name: 'Real Provider Workflow',
    keys: ['suggestionCards', 'customizationSaveRollback', 'homebrewSaveRollback', 'typedIntent', 'inlineQuestionAnswer', 'review', 'summary', 'diff', 'buildBoundary', 'saveFlow', 'rollbackCleanup', 'discard'],
  },
  {
    name: 'PR-Specific Focus',
    keys: ['mainCoverageFreshness', 'prSpecificCoverage'],
  },
  {
    name: 'Evidence',
    keys: ['visualProofQuality', 'reportInspection'],
  },
]);

export const curatedProofKeys = freezeDeep([
  'review',
  'summary',
  'diff',
  'buildBoundary',
  'customizationSaveRollback',
  'homebrewSaveRollback',
  'inlineQuestionAnswer',
  'saveFlow',
  'rollbackCleanup',
  'settingsAPIKeys',
  'settingsGeneral',
  'settingsAIModels',
  'settingsPreferences',
  'visualProofQuality',
  'reportInspection',
]);

export const scenarioProofCatalog = freezeDeep({
  launch: {
    grade: 'action-confirmed',
    screenshots: ['launch'],
    texts: ['launch'],
    proof: 'Accessibility text shows the nixmac window, Settings/History/Feedback controls, stepper, prompt text area, and disabled Send button.',
    untested: 'Does not prove provider or config state.',
  },
  updateBanner: {
    grade: 'text-confirmed',
    screenshots: ['launch'],
    texts: ['launch'],
    proof: 'Runner checks for a visible Dismiss button. If present, it dismisses it; if absent, it proves no update banner blocked the initial UI.',
    untested: 'The explicit dismiss interaction is only tested on runs where a banner is actually present.',
  },
  settingsGeneral: {
    grade: 'action-confirmed',
    screenshots: ['settings-general'],
    texts: ['settings-general'],
    proof: 'Computer Use clicked Settings and captured the General tab content.',
    untested: 'Does not persist setting edits.',
  },
  settingsAIModels: {
    grade: 'action-confirmed',
    screenshots: ['settings-ai-models'],
    texts: ['settings-ai-models'],
    proof: 'Computer Use opened AI Models and captured provider/model/build controls.',
    untested: 'Does not change models or verify every provider.',
  },
  settingsAPIKeys: {
    grade: 'text-confirmed',
    screenshots: ['settings-api-keys-01'],
    texts: ['settings-api-keys-01'],
    proof: 'API Keys screenshot is captured only when raw accessibility text confirms no unmasked key-like secret is present; redacted text must show API Keys/OpenRouter/API-key controls.',
    untested: 'Does not edit/delete keys and does not prove keychain persistence by itself.',
  },
  settingsPreferences: {
    grade: 'action-confirmed',
    screenshots: ['settings-preferences'],
    texts: ['settings-preferences'],
    proof: 'Computer Use opened Preferences and captured confirmation controls.',
    untested: 'Does not toggle preferences permanently.',
  },
  history: {
    grade: 'action-confirmed',
    screenshots: ['history'],
    texts: ['history'],
    proof: 'Computer Use opened History and captured a visible history/empty state.',
    untested: 'Current run does not prove a newly saved change appears there.',
  },
  console: {
    grade: 'text-confirmed',
    screenshots: [],
    texts: ['console'],
    proof: 'Sensitive screenshot omitted; redacted accessibility text must show Console/log content.',
    untested: 'Does not prove log completeness and may omit secret-bearing visuals by design.',
  },
  feedback: {
    grade: 'action-confirmed',
    screenshots: ['feedback', 'home-after-feedback'],
    texts: ['feedback', 'home-after-feedback'],
    proof: 'Computer Use opened and cancelled the feedback dialog.',
    untested: 'Does not submit feedback.',
  },
  reportIssue: {
    grade: 'action-confirmed',
    screenshots: ['report-issue', 'home-after-report-issue'],
    texts: ['report-issue', 'home-after-report-issue'],
    proof: 'Computer Use opened and cancelled the report issue dialog.',
    untested: 'Does not submit a report.',
  },
  suggestionCards: {
    grade: 'action-confirmed',
    screenshots: ['suggestion-card'],
    texts: ['suggestion-card'],
    proof: 'Computer Use found and clicked a suggestion card; the UI stayed usable afterward.',
    untested: 'Does not prove every suggestion works.',
  },
  typedIntent: {
    grade: 'action-confirmed',
    screenshots: ['typed-intent'],
    texts: ['typed-intent'],
    proof: 'Prompt text appears in the Computer Use state after set_value.',
    untested: 'Does not prove provider execution until Review is reached.',
  },
  review: {
    grade: 'action-confirmed',
    screenshots: ['provider-progress-01', 'provider-progress-02', 'provider-progress-03', 'provider-progress-04', 'provider-progress-05'],
    texts: ['provider-progress-01', 'provider-progress-02', 'provider-progress-03', 'provider-progress-04', 'provider-progress-05'],
    proof: 'Polling reached Review-equivalent UI with Build & Test/Discard/Summary/Diff controls.',
    untested: 'Does not prove Save/commit.',
  },
  summary: {
    grade: 'text-confirmed',
    screenshots: ['review-summary'],
    texts: ['review-summary'],
    proof: 'Summary text must mention the requested package/change domain.',
    untested: 'Does not prove file persistence.',
  },
  diff: {
    grade: 'text-confirmed',
    screenshots: ['review-diff'],
    texts: ['review-diff'],
    proof: 'Diff view must expose the candidate Homebrew config file or requested package/change.',
    untested: 'Does not prove the change builds or saves; save/rollback scenarios provide that remote git proof.',
  },
  customizationSaveRollback: {
    grade: 'action-confirmed',
    screenshots: ['customization-absent', 'customization-apply', 'customization-step-3-ready', 'customization-after-commit', 'customization-after-history-restore'],
    texts: ['customization-absent', 'customization-apply', 'customization-step-3-ready', 'customization-after-commit', 'customization-after-history-restore'],
    proof: 'When the untracked customizations chip is visible, Computer Use adds it to config, confirms Build & Test, commits Step 3, then restores the disposable baseline and verifies the remote git tree is clean.',
    untested: 'If no untracked customizations chip is visible, the scenario records a no-op pass because there is nothing to save.',
  },
  homebrewSaveRollback: {
    grade: 'action-confirmed',
    screenshots: ['homebrew-absent', 'homebrew-apply', 'homebrew-step-3-ready', 'homebrew-after-commit', 'homebrew-after-history-restore'],
    texts: ['homebrew-absent', 'homebrew-apply', 'homebrew-step-3-ready', 'homebrew-after-commit', 'homebrew-after-history-restore'],
    proof: 'When the untracked Homebrew chip is visible, Computer Use adds it to config, confirms Build & Test, commits Step 3, then restores the disposable baseline and verifies the remote git tree is clean.',
    untested: 'If no untracked Homebrew chip is visible, the scenario records a no-op pass because there is nothing to save.',
  },
  buildBoundary: {
    grade: 'action-confirmed',
    screenshots: ['build-boundary', 'step-3-ready'],
    texts: ['build-boundary', 'step-3-ready'],
    proof: 'Build & Test opens a confirmation dialog before activation; disposable runs confirm it and wait for Step 3.',
    untested: 'Without explicit disposable build-confirm mode, the runner still cancels at the boundary.',
  },
  saveFlow: {
    grade: 'action-confirmed',
    screenshots: ['step-3-ready', 'after-commit'],
    texts: ['step-3-ready', 'after-commit'],
    proof: 'In disposable build-confirm mode, Computer Use reaches Step 3, clicks Commit, and the runner verifies the disposable repo HEAD changed with a clean worktree.',
    untested: 'When disposable build-confirm mode is not enabled, Save remains untested.',
  },
  rollbackCleanup: {
    grade: 'action-confirmed',
    screenshots: ['history-before-restore', 'history-restore-preview', 'after-history-restore'],
    texts: ['history-before-restore', 'history-restore-preview', 'after-history-restore'],
    proof: 'After Save, Computer Use opens History, restores the pre-test baseline commit, and the runner verifies HEAD returned to that baseline with a clean worktree.',
    untested: 'Only runs when Save succeeded and a restorable disposable baseline exists.',
  },
  discard: {
    grade: 'guardrail-confirmed',
    screenshots: ['discard-boundary', 'history-restore-preview', 'after-history-restore'],
    texts: ['discard-boundary', 'history-restore-preview', 'after-history-restore'],
    proof: 'Discard opens a confirmation boundary when used. In full-lifecycle runs, the stronger History restore cleanup path can supersede Discard and is proven by rollback artifacts.',
    untested: 'When History restore cleanup passes, Discard itself is intentionally not clicked because the disposable config is already back at baseline.',
  },
  evolvedScreenshotsDefaults: {
    grade: 'calibration',
    screenshots: ['evolved-screenshots-defaults-summary', 'evolved-screenshots-defaults-diff', 'evolved-screenshots-defaults-after-discard'],
    texts: ['evolved-screenshots-defaults-summary', 'evolved-screenshots-defaults-diff', 'evolved-screenshots-defaults-after-discard'],
    proof: 'Optional calibration case submits the screenshot-defaults prompt, reaches Review, checks for PNG/Screenshots/defaults evidence, and exits without Step 3.',
    untested: 'Disabled in the default PR lane until its accessibility-text tokens are calibrated on the real remote app.',
  },
  inlineQuestionAnswer: {
    grade: 'calibration',
    screenshots: ['evolved-inline-question-font-question', 'evolved-inline-question-font-answered', 'evolved-inline-question-font-summary', 'evolved-inline-question-font-diff', 'evolved-inline-question-font-after-discard'],
    texts: ['evolved-inline-question-font-question', 'evolved-inline-question-font-answered', 'evolved-inline-question-font-summary', 'evolved-inline-question-font-diff', 'evolved-inline-question-font-after-discard'],
    proof: 'Optional calibration case forces the provider into a user-question path, answers through the inline question UI, and requires progress to Review/Summary/Diff evidence.',
    untested: 'Disabled in the default PR lane until repeated DXU runs prove the provider reliably takes the ask_user path.',
  },
  visualCoverage: {
    grade: 'text-confirmed',
    screenshots: ['launch', 'settings-general', 'settings-ai-models', 'settings-preferences', 'history', 'feedback', 'report-issue', 'typed-intent'],
    texts: ['launch', 'settings-general', 'settings-ai-models', 'settings-preferences', 'history', 'feedback', 'report-issue', 'typed-intent'],
    proof: 'Required core UI surfaces have screenshot and text artifacts.',
    untested: 'Does not prove screenshot annotations are exact bounding boxes.',
  },
  visualProofQuality: {
    grade: 'text-confirmed',
    screenshots: [],
    texts: [],
    proof: 'Every passing scenario must have linked proof artifacts, and required non-sensitive screenshots must pass deterministic visual signal checks.',
    untested: 'Visual signal checks catch missing, blank, occluded, or low-signal regions; they do not prove exact design fidelity or arbitrary wrong-screen swaps.',
  },
  adversarialOutOfBounds: {
    grade: 'action-confirmed',
    screenshots: ['adversarial-out-of-bounds-annotation'],
    texts: [],
    proof: 'Adversarial-only fixture used by run-adversarial.mjs to prove bad overlay geometry is caught.',
    untested: 'Not a real app scenario.',
  },
  mainCoverageFreshness: {
    grade: 'manifest-confirmed',
    screenshots: [],
    texts: [],
    proof: 'A repo-local coverage manifest maps major user-visible surfaces on main to Computer Use scenarios or explicit waivers, and the runner scans for unmapped candidate files.',
    untested: 'This proves scenario mapping freshness, not that every mapped scenario passed in the current run.',
  },
  prSpecificCoverage: {
    grade: 'not-run',
    screenshots: [],
    texts: [],
    proof: 'Requires PR metadata and changed-file/user-visible focus input.',
    untested: 'No PR-specific scenario is executed unless PR context is provided.',
  },
  reportInspection: {
    grade: 'action-confirmed',
    screenshots: ['HTML report inspection'],
    texts: ['HTML report inspection'],
    proof: 'Computer Use opens the generated report on the remote Mac and sees report sections.',
    untested: 'Does not prove a human reviewed every screenshot.',
  },
});


export const scenarioAssertionTypeHints = freezeDeep({
  launch: ['accessibility_text', 'visual_heuristic'],
  updateBanner: ['accessibility_text', 'action_result'],
  settingsGeneral: ['accessibility_text', 'action_result', 'visual_heuristic'],
  settingsAIModels: ['accessibility_text', 'action_result', 'visual_heuristic'],
  settingsAPIKeys: ['accessibility_text', 'sensitive_redaction'],
  settingsPreferences: ['accessibility_text', 'action_result', 'visual_heuristic'],
  history: ['accessibility_text', 'action_result', 'visual_heuristic'],
  console: ['accessibility_text', 'sensitive_redaction'],
  feedback: ['accessibility_text', 'action_result', 'visual_heuristic'],
  reportIssue: ['accessibility_text', 'action_result', 'visual_heuristic'],
  suggestionCards: ['accessibility_text', 'action_result', 'visual_heuristic'],
  typedIntent: ['accessibility_text', 'action_result'],
  review: ['accessibility_text', 'provider_state', 'action_result'],
  summary: ['accessibility_text', 'provider_state'],
  diff: ['accessibility_text', 'provider_state'],
  customizationSaveRollback: ['accessibility_text', 'action_result', 'remote_state'],
  homebrewSaveRollback: ['accessibility_text', 'action_result', 'remote_state'],
  buildBoundary: ['accessibility_text', 'action_result', 'confirmation_boundary'],
  saveFlow: ['accessibility_text', 'action_result', 'remote_state'],
  rollbackCleanup: ['accessibility_text', 'action_result', 'remote_state'],
  discard: ['accessibility_text', 'action_result', 'confirmation_boundary'],
  evolvedScreenshotsDefaults: ['accessibility_text', 'provider_state', 'calibration'],
  inlineQuestionAnswer: ['accessibility_text', 'provider_state', 'question_answer', 'calibration'],
  visualCoverage: ['artifact_quality'],
  visualProofQuality: ['artifact_quality', 'visual_heuristic'],
  mainCoverageFreshness: ['coverage_manifest'],
  prSpecificCoverage: ['pr_metadata', 'coverage_manifest'],
  reportInspection: ['accessibility_text', 'artifact_quality'],
});
