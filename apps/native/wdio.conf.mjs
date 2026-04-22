export const config = {
  runner: 'local',
  port: 4444,
  connectionRetryCount: 10,
  connectionRetryTimeout: 120000,
  waitforTimeout: 45000,
  specs: ['./e2e-tauri/tests/wdio/**/*.spec.mjs'],
  maxInstances: 1,
  capabilities: [
    {
      'tauri:options': {
        binary: '../../target/debug/nixmac',
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
};
