import { expect } from '@playwright/test'

// Signs the organizer in through the real /login form.
export async function signInOrganizer(page, organizer) {
  await page.goto('/login')
  await page.getByPlaceholder('name@example.com').fill(organizer.email)
  await page.getByPlaceholder('Enter your password').fill(organizer.password)
  await page.getByRole('button', { name: 'Sign In', exact: true }).last().click()
  await expect(page).toHaveURL(/\/dashboard/)
}
