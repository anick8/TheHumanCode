import { test as base, expect } from '@playwright/test'

// `organizer`: a desktop-sized page. `player`: a phone-sized page in its own
// browser context, so the two never share cookies or storage.
export const test = base.extend({
  organizer: async ({ browser }, use) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await use(await context.newPage())
    await context.close()
  },
  player: async ({ browser }, use) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })
    await use(await context.newPage())
    await context.close()
  },
})

export { expect }
