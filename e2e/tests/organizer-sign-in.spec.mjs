import { test, expect } from '../support/fixtures.mjs'
import { seedOrganizer } from '../support/seed.mjs'
import { signInOrganizer } from '../support/signIn.mjs'

test('a seeded organizer signs in and reaches the dashboard', async ({ organizer }) => {
  const account = await seedOrganizer()
  await signInOrganizer(organizer, account)
  await expect(organizer).toHaveURL(/\/dashboard/)
})
