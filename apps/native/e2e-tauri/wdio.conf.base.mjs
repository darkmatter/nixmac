import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  setupNixmacTestEnvironment,
  teardownNixmacTestEnvironment,
} from '../dist-e2e/tests/wdio/helpers/test-env.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const APPS_NATIVE_DIR = path.resolve(THIS_DIR, '..');

/**
 * Create a WDIO config for a specific test suite.
 *
 * @param {object} opts
 * @param {string | string[]} opts.specs  - glob(s) for spec files, relative to apps/native/e2e-tauri/
 * @param {object} [opts.setupOptions]    - options forwarded to setupNixmacTestEnvironment
 */
export function createWdioConfig({ specs, setupOptions = {} }) {
  let testEnvironment;
  let teardownPromise = null;
  let signalHandlersRegistered = false;

  const performTeardownOnce = async () => {
    if (teardownPromise) {
      return teardownPromise;
    }

    teardownPromise = teardownNixmacTestEnvironment(testEnvironment).catch((error) => {
      console.error('[wdio:test-env] Teardown failed', error);
      throw error;
    });

    return teardownPromise;
  };

  const handleSigint = async () => {
    console.log('[wdio:test-env] Caught SIGINT, running teardown before exit');
    try {
      await performTeardownOnce();
    } finally {
      process.exit(130);
    }
  };

  const handleSigterm = async () => {
    console.log('[wdio:test-env] Caught SIGTERM, running teardown before exit');
    try {
      await performTeardownOnce();
    } finally {
      process.exit(143);
    }
  };

  const registerSignalHandlers = () => {
    if (signalHandlersRegistered) {
      return;
    }

    process.once('SIGINT', handleSigint);
    process.once('SIGTERM', handleSigterm);
    signalHandlersRegistered = true;
  };

  const unregisterSignalHandlers = () => {
    if (!signalHandlersRegistered) {
      return;
    }

    process.off('SIGINT', handleSigint);
    process.off('SIGTERM', handleSigterm);
    signalHandlersRegistered = false;
  };

  const resolvedSpecs = (Array.isArray(specs) ? specs : [specs]).map((s) =>
    path.resolve(THIS_DIR, s),
  );

  return {
    runner: 'local',
    port: 4444,
    connectionRetryCount: 10,
    connectionRetryTimeout: 120000,
    waitforTimeout: 45000,
    specs: resolvedSpecs,
    maxInstances: 1,
    capabilities: [
      {
        'tauri:options': {
          binary: path.resolve(APPS_NATIVE_DIR, '../../target/debug/nixmac'),
        },
      },
    ],
    logLevel: 'info',
    framework: 'mocha',
    reporters: ['spec'],
    mochaOpts: {
      ui: 'bdd',
      timeout: 120000,
    },
    async onPrepare() {
      testEnvironment = await setupNixmacTestEnvironment(setupOptions);
      registerSignalHandlers();
    },
    async onComplete() {
      unregisterSignalHandlers();
      await performTeardownOnce();
    },
  };
}
