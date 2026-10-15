import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'
import { loadE2eEnv } from './e2e/support/env.mjs'

const PORT = 3100
// `npm run test:e2e` runs e2e/bootstrap.mjs first, which writes this file.
const stack = existsSync('./e2e/.env.e2e') ? loadE2eEnv() : {}

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: stack.NEXT_PUBLIC_SUPABASE_URL ?? '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${PORT}`,
    },
  },
})
