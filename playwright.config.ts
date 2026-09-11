import { defineConfig, devices } from '@playwright/test'

// Use one worker: mockd’s mode, recording and reset are process-wide, so parallel tests
// would reset one another.
export default defineConfig({
  testDir: './test',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    ...devices['Desktop Chrome'],
    // The intercepted public fixture origin sends to loopback mockd. Disable only Local
    // Network Access checks for that test topology; keep browser security enabled so CSP
    // and origin rules remain testable.
    launchOptions: {
      args: [
        '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults',
      ],
    },
    // Every URL in the suite is absolute and served by a route handler; there
    // is no origin to be relative to.
    trace: 'retain-on-failure',
  },
  globalSetup: './test/global-setup.ts',
})
