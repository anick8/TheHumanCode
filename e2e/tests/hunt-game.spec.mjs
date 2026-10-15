import { readFileSync } from 'node:fs'
import { test, expect } from '../support/fixtures.mjs'
import { seedGameHunt } from '../support/seed.mjs'
import { signInOrganizer } from '../support/signIn.mjs'

async function openRunHunt(organizer, hunt) {
  await signInOrganizer(organizer, hunt.organizer)
  await organizer.goto(`/dashboard/sessions/${hunt.sessionId}/hunt`)
  await expect(organizer.getByRole('heading', { name: 'Run hunt' })).toBeVisible()
}

async function joinAs(player, hunt, name) {
  await player.goto(`/h/${hunt.clueTokens[0]}`)
  await expect(player).toHaveURL(new RegExp(`/hunt/${hunt.slug}`))
  await player.getByLabel('Name').fill(name)
  await player.getByRole('button', { name: 'Join the hunt' }).click()
  await expect(player.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible()
}

test('full hunt journey: join, approve, start, scan, pick, stop, rank, CSV, reset', async ({ organizer, player }) => {
  const hunt = await seedGameHunt()
  await openRunHunt(organizer, hunt)

  // 1-2. Scan before joining -> join page; enter a name -> pending.
  await joinAs(player, hunt, 'Alice')

  // 3. Organizer approves; the player sees the waiting screen.
  await expect(organizer.getByText('Waiting for approval (1)')).toBeVisible()
  await organizer.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(organizer.getByText('Players and leaderboard (1)')).toBeVisible()
  await expect(player.getByRole('heading', { name: "You're in" })).toBeVisible()
  await expect(player.getByText('Waiting for the host to start the hunt')).toBeVisible()

  // 4. Start with 2 minutes.
  await organizer.getByPlaceholder('No limit').fill('2')
  await organizer.getByRole('button', { name: 'Start hunt' }).click()
  await expect(organizer.getByRole('button', { name: 'Stop hunt' })).toBeVisible()

  // 5. The player is returned to clue 1 and sees its message.
  await expect(player).toHaveURL(new RegExp(`/h/${hunt.clueTokens[0]}`))
  await expect(player.getByText('Clue one: start at the fountain')).toBeVisible()

  // Clue 2: pick with a confirm dialog, reload, still locked.
  await player.goto(`/h/${hunt.clueTokens[1]}`)
  await expect(player.getByText('Clue two: the old bridge')).toBeVisible()
  await player.getByRole('button', { name: 'Cross the bridge' }).click()
  await expect(player.getByRole('dialog')).toBeVisible()
  await player.getByRole('button', { name: 'Yes, reveal it' }).click()
  await expect(player.getByText('Treasure is under the east arch')).toBeVisible()
  await player.reload()
  await expect(player.getByText('Treasure is under the east arch')).toBeVisible()
  await expect(player.getByRole('button', { name: 'Cross the bridge' })).toBeDisabled()
  await expect(player.getByRole('button', { name: 'Follow the river' })).toBeDisabled()

  // 6. Board shows 2 found.
  await expect(organizer.getByRole('row', { name: /Alice/ })).toContainText('2 of 3')

  // 7. Stop; the player sees their rank.
  await organizer.getByRole('button', { name: 'Stop hunt' }).click()
  await expect(organizer.getByRole('button', { name: 'Download CSV' })).toBeVisible()
  await player.goto(`/hunt/${hunt.slug}`)
  await expect(player.getByRole('heading', { name: 'The hunt is over' })).toBeVisible()
  await expect(player.getByText('1st place')).toBeVisible()
  await expect(player.getByText('2 of 3 clues found')).toBeVisible()

  // 8. CSV download.
  const [download] = await Promise.all([
    organizer.waitForEvent('download'),
    organizer.getByRole('button', { name: 'Download CSV' }).click(),
  ])
  const text = readFileSync(await download.path(), 'utf8').replace(/^﻿/, '')
  const lines = text.trim().split(/\r?\n/)
  expect(lines[0]).toBe(
    'Rank,Name,Clues found,Last scan,Clue 1 scan,Clue 1 pick,Clue 2 scan,Clue 2 pick,Clue 3 scan,Clue 3 pick'
  )
  expect(lines).toHaveLength(2)
  const cells = lines[1].split(',')
  expect(cells.slice(0, 3)).toEqual(['1', 'Alice', '2'])
  expect(cells[3]).not.toBe('')
  expect(cells[4]).not.toBe('') // clue 1 scanned
  expect(cells[5]).toBe('') // no pick on clue 1
  expect(cells[6]).not.toBe('') // clue 2 scanned
  expect(cells[7]).toBe('Cross the bridge')
  expect(cells[8]).toBe('') // clue 3 never found
  expect(cells[9]).toBe('')

  // 9. Reset empties the board.
  await organizer.getByRole('button', { name: 'Reset hunt' }).click()
  await organizer.getByRole('dialog').getByRole('button', { name: 'Reset hunt' }).click()
  await expect(organizer.getByText('No approved players yet.')).toBeVisible()
  await expect(organizer.getByRole('button', { name: 'Start hunt' })).toBeVisible()
})

test('joining after the hunt has started shows joining closed', async ({ organizer, player }) => {
  const hunt = await seedGameHunt()
  await openRunHunt(organizer, hunt)
  await organizer.getByRole('button', { name: 'Start hunt' }).click()
  await expect(organizer.getByRole('button', { name: 'Stop hunt' })).toBeVisible()

  await player.goto(`/hunt/${hunt.slug}`)
  await expect(player.getByRole('heading', { name: 'Joining is closed' })).toBeVisible()
})

test('a rejected player scanning a clue sees the removed screen', async ({ organizer, player }) => {
  const hunt = await seedGameHunt()
  await openRunHunt(organizer, hunt)
  await joinAs(player, hunt, 'Mallory')

  await expect(organizer.getByText('Waiting for approval (1)')).toBeVisible()
  await organizer.getByRole('button', { name: 'Reject' }).click()
  await expect(organizer.getByText('Nobody is waiting.')).toBeVisible()

  await player.goto(`/h/${hunt.clueTokens[0]}`)
  await expect(player.getByRole('heading', { name: 'You were removed from this hunt' })).toBeVisible()
})
