import { test, expect } from '../support/fixtures.mjs'
import { seedHunt } from '../support/seed.mjs'

test('a clue page of a hunt that is not a game shows its message and locks after a choice', async ({ player }) => {
  const hunt = await seedHunt({
    clueMessage: 'Look under the old oak bench',
    choices: [
      { label: 'Go left', reveal: 'The key is behind the fountain' },
      { label: 'Go right', reveal: 'The key is inside the library' },
    ],
  })

  await player.goto(`/h/${hunt.clueToken}`)
  await expect(player.getByText('Look under the old oak bench')).toBeVisible()

  await player.getByRole('button', { name: 'Go left' }).click()
  await expect(player.getByText('The key is behind the fountain')).toBeVisible()
  await expect(player.getByRole('button', { name: 'Go left' })).toBeDisabled()
  await expect(player.getByRole('button', { name: 'Go right' })).toBeDisabled()
})
