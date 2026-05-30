#!/usr/bin/env node

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Launcher } from '@wdio/cli';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const APPS_NATIVE_DIR = path.resolve(THIS_DIR, '..');
const E2E_DIR = path.resolve(APPS_NATIVE_DIR, 'e2e-tauri');

const suites = [
  { name: 'smoke', config: path.resolve(E2E_DIR, 'wdio.smoke.conf.mjs') },
  { name: 'basic-prompts', config: path.resolve(E2E_DIR, 'wdio.basic-prompts.conf.mjs') },
  { name: 'conversational', config: path.resolve(E2E_DIR, 'wdio.conversational.conf.mjs') },
  { name: 'discard', config: path.resolve(E2E_DIR, 'wdio.discard.conf.mjs') },
  { name: 'modify', config: path.resolve(E2E_DIR, 'wdio.modify.conf.mjs') },
  { name: 'manual-changes', config: path.resolve(E2E_DIR, 'wdio.manual-changes.conf.mjs') },
  { name: 'onboarding', config: path.resolve(E2E_DIR, 'wdio.onboarding.conf.mjs') },
];

const results = [];
let failed = false;

function cleanupAppProcess() {
  try {
    console.log('killing nixmac process...');
    execSync('pkill -x nixmac || true', { stdio: 'ignore' });
  } catch {
    // Best-effort cleanup only.
  } finally {
    console.log('nixmac process killed.');
  }
}

console.log('🧪 Building e2e tests...\n');
execSync('tsc -p e2e-tauri/tsconfig.json', {
  stdio: 'inherit',
  cwd: APPS_NATIVE_DIR,
});

console.log('\n🧪 Running all WDIO test suites...\n');

for (const suite of suites) {
  const displayName = suite.name.toUpperCase();
  process.stdout.write(`⏳ ${displayName}... `);

  try {
    cleanupAppProcess();
    const launcher = new Launcher(suite.config);
    const exitCode = await launcher.run();
    cleanupAppProcess();

    if (exitCode === 0) {
      console.log('✅');
      results.push({ suite: displayName, passed: true });
    } else {
      console.log('❌');
      results.push({ suite: displayName, passed: false });
      failed = true;
    }
  } catch (error) {
    cleanupAppProcess();
    console.log('❌');
    console.error(error);
    results.push({ suite: displayName, passed: false });
    failed = true;
  }
}

cleanupAppProcess();

console.log('\n' + '='.repeat(50));
console.log('📊 Test Results Summary');
console.log('='.repeat(50));

const passed = results.filter((r) => r.passed).length;
const total = results.length;

results.forEach((result) => {
  const status = result.passed ? '✅' : '❌';
  console.log(`  ${status} ${result.suite}`);
});

console.log('='.repeat(50));
console.log(`\n${passed}/${total} suites passed\n`);

if (failed) {
  process.exit(1);
}
