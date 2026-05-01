#!/usr/bin/env node

import { execSync } from 'node:child_process';

const suites = [
  'test:wdio:smoke',
  'test:wdio:basic-prompts',
  'test:wdio:discard',
  'test:wdio:modify',
  'test:wdio:onboarding',
];

const results = [];
let failed = false;

console.log('🧪 Running all WDIO test suites...\n');

for (const suite of suites) {
  const displayName = suite.replace('test:wdio:', '').toUpperCase();
  process.stdout.write(`⏳ ${displayName}... `);

  try {
    execSync(`npm run ${suite}`, {
      stdio: 'pipe',
      cwd: process.cwd(),
    });
    console.log('✅');
    results.push({ suite: displayName, passed: true });
  } catch  {
    console.log('❌');
    results.push({ suite: displayName, passed: false });
    failed = true;
  }
}

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
