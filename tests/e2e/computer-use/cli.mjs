export function remoteCuaUsage({ defaultWs, defaultApp }) {
  return `Usage:
  node tests/e2e/computer-use/run-remote-cua.mjs run
  node tests/e2e/computer-use/run-remote-cua.mjs render-unavailable --note "..."
  node tests/e2e/computer-use/run-remote-cua.mjs render-storybook-only --note "..."
  node tests/e2e/computer-use/run-remote-cua.mjs render-existing --run-dir artifacts/computer-use-remote/<timestamp>
  node tests/e2e/computer-use/run-remote-cua.mjs self-test

Environment:
  NIXMAC_COMPUTER_USE_WS       WebSocket for Codex app-server (default ${defaultWs})
  NIXMAC_COMPUTER_USE_APP      Bundle id/app name (default ${defaultApp})
  NIXMAC_E2E_REMOTE_SSH_DEST   Optional ssh destination, e.g. admin@38.79.97.120
  NIXMAC_E2E_SSH_KEY           Optional ssh private key path
  NIXMAC_E2E_SSH_KNOWN_HOSTS   Optional known_hosts path for strict SSH verification
  NIXMAC_E2E_REMOTE_REPORT_DIR Optional remote report copy dir for browser inspection
  NIXMAC_E2E_EXTRA_EVOLVED_CASES Optional comma/newline list of calibrated non-default evolved cases, e.g. screenshots-defaults
  NIXMAC_E2E_APP_COMMAND       App command metadata
  NIXMAC_E2E_DISPOSABLE_CONFIG Set true only when the app is proven to use per-run disposable config
  NIXMAC_E2E_ALLOW_BUILD_CONFIRM Set true only when Build & Test may run against disposable config
  NIXMAC_E2E_ALLOW_DISCARD_CONFIRM Set true only when Discard may run against disposable config
  NIXMAC_E2E_REMOTE_CONFIG_DIR Optional explicit remote disposable config path for git proof
  NIXMAC_E2E_PR_CHANGED_FILES  Newline/comma separated PR changed files for PR-specific focus
  NIXMAC_E2E_WORKFLOW_TIMINGS  Optional workflow timing metadata JSON to merge into reports
`;
}

export function localCuaUsage({ defaultApp }) {
  return `Usage:
  node tests/e2e/computer-use/run-cua-driver.mjs run --run-dir <artifact-run-dir>
  node tests/e2e/computer-use/run-cua-driver.mjs smoke --run-dir <artifact-run-dir>
  node tests/e2e/computer-use/run-cua-driver.mjs self-test

Execution topology:
  local-cua-driver (on-Mac only; no remote transport)

Environment:
  NIXMAC_COMPUTER_USE_APP       Bundle id (default ${defaultApp})
  NIXMAC_CUA_DRIVER_BINARY      Pinned CuaDriver CLI executable (default cua-driver)
  NIXMAC_CUA_DRIVER_SOCKET      Optional owned run-specific daemon socket
  NIXMAC_E2E_DISPOSABLE_CONFIG Must be exactly true
  NIXMAC_E2E_APP_ARTIFACT_SHA  Full lowercase 40-character source SHA
  NIXMAC_E2E_APP_PATH          Exact canonical staged .app bundle path
`;
}

export async function dispatchLocalCuaCommand(argv, handlers, options = {}) {
  const [command, ...args] = argv;
  const usage = options.usage ?? (() => {});
  const exit =
    options.exit ??
    ((code) => {
      process.exitCode = code;
    });
  const onError = options.onError ?? (() => {});
  const handler = {
    run: handlers.run,
    "self-test": handlers.selfTest,
    smoke: handlers.smoke,
  }[command];
  if (!handler) {
    usage();
    const exitCode = command ? 1 : 0;
    exit(exitCode);
    return { command, args, exitCode };
  }
  try {
    if (command === "self-test") await handler();
    else await handler(args);
    return { command, args, exitCode: 0 };
  } catch (error) {
    await onError(error, { command, args });
    exit(1);
    return { command, args, error, exitCode: 1 };
  }
}

export async function dispatchRemoteCuaCommand(argv, handlers, options = {}) {
  const [command, ...args] = argv;
  const usage = options.usage ?? (() => {});
  // Library default is non-terminating; the executable wrapper injects process.exit.
  const exit =
    options.exit ??
    ((code) => {
      process.exitCode = code;
    });
  const onError = options.onError ?? (() => {});
  const routes = {
    run: handlers.run,
    "render-unavailable": handlers.renderUnavailable,
    "render-storybook-only": handlers.renderStorybookOnly,
    "render-existing": handlers.renderExisting,
    "self-test": handlers.selfTest,
  };

  const handler = routes[command];
  if (!handler) {
    usage();
    const exitCode = command ? 1 : 0;
    exit(exitCode);
    return { command, args, exitCode };
  }

  try {
    if (command === "self-test") await handler();
    else await handler(args);
    return { command, args, exitCode: 0 };
  } catch (error) {
    await onError(error, { command, args });
    exit(1);
    return { command, args, error, exitCode: 1 };
  }
}
