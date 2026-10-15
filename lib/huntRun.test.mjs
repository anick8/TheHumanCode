import test from 'node:test'
import assert from 'node:assert/strict'
import { formatDuration, huntClock, buildHuntCsv, splitBoard } from './huntRun.js'

test('formatDuration renders m:ss and h:mm:ss, clamping negatives', () => {
  assert.equal(formatDuration(0), '0:00')
  assert.equal(formatDuration(65000), '1:05')
  assert.equal(formatDuration(3725000), '1:02:05')
  assert.equal(formatDuration(-500), '0:00')
})

test('huntClock reports not started, counting up, counting down, and over', () => {
  const t0 = '2026-01-01T10:00:00Z'
  const at = (s) => new Date(Date.parse(t0) + s * 1000).toISOString()
  assert.deepEqual(huntClock({ started_at: null }, at(5)), { state: 'not_started', label: '0:00' })
  assert.deepEqual(huntClock({ started_at: t0 }, at(90)), { state: 'running', label: '1:30', countdown: false })
  assert.deepEqual(huntClock({ started_at: t0, ends_at: at(600) }, at(90)), { state: 'running', label: '8:30', countdown: true })
  assert.deepEqual(huntClock({ started_at: t0, ends_at: at(600) }, at(700)), { state: 'over', label: '0:00', countdown: true })
  assert.deepEqual(huntClock({ started_at: t0, stopped_at: at(120) }, at(900)), { state: 'over', label: '2:00', countdown: false })
})

test('splitBoard separates pending from approved and drops rejected', () => {
  const rows = [
    { participant_id: 'a', approval_status: 'approved', rank: 2 },
    { participant_id: 'b', approval_status: 'pending' },
    { participant_id: 'c', approval_status: 'rejected' },
    { participant_id: 'd', approval_status: 'approved', rank: 1 },
  ]
  const { pending, approved } = splitBoard(rows)
  assert.deepEqual(pending.map((r) => r.participant_id), ['b'])
  assert.deepEqual(approved.map((r) => r.participant_id), ['d', 'a'])
})

test('buildHuntCsv writes rank, name, found, last scan, then per-clue time and pick', () => {
  const start = '2026-01-01T10:00:00Z'
  const board = [
    {
      name: 'Asha, "A"', approval_status: 'approved', rank: 1, clues_found: 2,
      last_scan_at: '2026-01-01T10:03:05Z',
      scans: [
        { clue_number: 2, scanned_at: '2026-01-01T10:03:05Z', picked_label: 'Left' },
        { clue_number: 1, scanned_at: '2026-01-01T10:01:00Z', picked_label: null },
      ],
    },
    { name: 'Ben', approval_status: 'approved', rank: 2, clues_found: 0, last_scan_at: null, scans: [] },
    { name: 'Pending Pat', approval_status: 'pending', scans: [] },
  ]
  const csv = buildHuntCsv(board, [1, 2], start)
  assert.equal(
    csv,
    [
      'Rank,Name,Clues found,Last scan,Clue 1 scan,Clue 1 pick,Clue 2 scan,Clue 2 pick',
      '1,"Asha, ""A""",2,3:05,1:00,,3:05,Left',
      '2,Ben,0,,,,,',
    ].join('\r\n') + '\r\n'
  )
})
