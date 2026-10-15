import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { loadE2eEnv } from './env.mjs'

export const ORGANIZER_PASSWORD = 'e2e-password-123'

async function withDb(fn) {
  const client = new pg.Client({ connectionString: loadE2eEnv().E2E_DB_URL })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

// An active Organizer: a confirmed auth user plus an allowed_emails Grant.
export async function seedOrganizer() {
  const email = `e2e-${randomBytes(4).toString('hex')}@example.test`
  const id = await withDb(async (db) => {
    const { rows } = await db.query(
      `insert into auth.users (
         instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
         confirmation_token, recovery_token, email_change_token_new, email_change)
       values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
         $1, extensions.crypt($2, extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
       returning id`,
      [email, ORGANIZER_PASSWORD]
    )
    const userId = rows[0].id
    await db.query(
      `insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
       values (gen_random_uuid(), $1::uuid, $1::text, 'email', jsonb_build_object('sub', $1::text, 'email', $2::text), now(), now(), now())`,
      [userId, email]
    )
    await db.query('insert into public.allowed_emails (email, note) values ($1, $2)', [email, 'e2e organizer'])
    return userId
  })
  return { id, email, password: ORGANIZER_PASSWORD }
}

// A live treasure hunt (not a game) with one clue; returns the clue's token.
export async function seedHunt({ clueMessage = 'Find the red door', choices = null, owner } = {}) {
  const organizer = owner ?? (await seedOrganizer())
  const slug = `e2e-${randomBytes(5).toString('hex')}`
  return withDb(async (db) => {
    const s = await db.query(
      `insert into public.sessions (owner_id, title, slug, is_active, session_type, participation_mode, is_scored)
       values ($1, 'E2E Hunt', $2, true, 'treasure_hunt', 'anonymous', false) returning id`,
      [organizer.id, slug]
    )
    const q = await db.query(
      `insert into public.questions (session_id, text, order_index, clue_choices)
       values ($1, $2, 0, $3::jsonb) returning clue_token`,
      [s.rows[0].id, clueMessage, choices ? JSON.stringify(choices) : null]
    )
    return { organizer, sessionId: s.rows[0].id, slug, clueToken: q.rows[0].clue_token }
  })
}

// A live game hunt (hunt_game = true) with three clues. Clue 2 has two choices
// and a confirm step; clue 3 has two choices without one. Returns the tokens.
export async function seedGameHunt({ owner } = {}) {
  const organizer = owner ?? (await seedOrganizer())
  const slug = `e2e-${randomBytes(5).toString('hex')}`
  const clues = [
    { text: 'Clue one: start at the fountain', choices: null, confirm: false },
    {
      text: 'Clue two: the old bridge',
      choices: [
        { label: 'Cross the bridge', reveal: 'Treasure is under the east arch' },
        { label: 'Follow the river', reveal: 'Treasure is by the willow' },
      ],
      confirm: true,
    },
    {
      text: 'Clue three: the clock tower',
      choices: [
        { label: 'Climb up', reveal: 'Look at the weathervane' },
        { label: 'Look around', reveal: 'Look behind the door' },
      ],
      confirm: false,
    },
  ]
  return withDb(async (db) => {
    const s = await db.query(
      `insert into public.sessions (owner_id, title, slug, is_active, session_type, participation_mode, is_scored, hunt_game)
       values ($1, 'E2E Game Hunt', $2, true, 'treasure_hunt', 'anonymous', false, true) returning id`,
      [organizer.id, slug]
    )
    const sessionId = s.rows[0].id
    const clueTokens = []
    for (const [i, c] of clues.entries()) {
      const q = await db.query(
        `insert into public.questions (session_id, text, order_index, clue_choices, clue_confirm_choice)
         values ($1, $2, $3, $4::jsonb, $5) returning clue_token`,
        [sessionId, c.text, i, c.choices ? JSON.stringify(c.choices) : null, c.confirm]
      )
      clueTokens.push(q.rows[0].clue_token)
    }
    return { organizer, sessionId, slug, clueTokens }
  })
}
