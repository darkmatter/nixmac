import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  setupNixmacTestEnvironment,
  teardownNixmacTestEnvironment,
} from './tests/wdio/helpers/test-env.mjs';

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
    },
    async onComplete() {
      await teardownNixmacTestEnvironment(testEnvironment);
    },
  };
}
