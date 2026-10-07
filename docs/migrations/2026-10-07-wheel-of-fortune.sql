-- ============================================================================
-- Wheel of Fortune session type (spec #6, ticket #7)
-- ============================================================================
-- Safe to re-run. Apply to production by pasting into the Supabase SQL editor.
--
-- A wheel session is identified (name required, no ID), never scored. Each
-- attendee who joins is put on the wheel as a joined Entry; the organizer may
-- add manual Entries. The organizer Spins: the SERVER picks one active Entry
-- uniformly at random and records a Spin. Phones never read Entries - only the
-- latest Pick, through a join-token-scoped read.

-- ---- session type ----------------------------------------------------------
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_session_type_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_session_type_check
  CHECK (session_type IN ('poll', 'quiz', 'comments', 'treasure_hunt', 'wheel'));

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_type_consistency;
ALTER TABLE sessions ADD CONSTRAINT sessions_type_consistency CHECK (
     (session_type = 'poll'          AND participation_mode = 'anonymous'  AND NOT is_scored)
  OR (session_type = 'quiz'          AND participation_mode = 'identified')
  OR (session_type = 'comments'      AND participation_mode = 'identified' AND NOT is_scored)
  OR (session_type = 'treasure_hunt' AND participation_mode = 'anonymous'  AND NOT is_scored)
  OR (session_type = 'wheel'         AND participation_mode = 'identified' AND NOT is_scored
                                     AND identity_requires_name AND NOT identity_requires_id)
);

-- ---- Entries ---------------------------------------------------------------
-- One row per segment on the wheel. removed_at NULL = active.
CREATE TABLE IF NOT EXISTS wheel_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES participants(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 24),
  kind text NOT NULL CHECK (kind IN ('joined', 'manual')),
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'joined') = (participant_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_wheel_entries_session ON wheel_entries(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wheel_entries_participant
  ON wheel_entries(participant_id) WHERE participant_id IS NOT NULL;

-- ---- Spins -----------------------------------------------------------------
-- One row per Spin. entry_id goes NULL if the Entry row is ever deleted; the
-- label snapshot keeps the history honest either way.
CREATE TABLE IF NOT EXISTS wheel_spins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  entry_id uuid REFERENCES wheel_entries(id) ON DELETE SET NULL,
  label text NOT NULL,
  removed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wheel_spins_session ON wheel_spins(session_id, created_at DESC);

-- ---- RLS: organizer reads; every write goes through the RPCs below ----------
ALTER TABLE wheel_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE wheel_spins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Organizers can view their wheel entries" ON wheel_entries;
CREATE POLICY "Organizers can view their wheel entries" ON wheel_entries FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM sessions s WHERE s.id = wheel_entries.session_id AND s.owner_id = auth.uid()));

DROP POLICY IF EXISTS "Organizers can view their wheel spins" ON wheel_spins;
CREATE POLICY "Organizers can view their wheel spins" ON wheel_spins FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM sessions s WHERE s.id = wheel_spins.session_id AND s.owner_id = auth.uid()));

-- ---- Joining puts the Participant on the wheel -----------------------------
-- A trigger, so join_session's rejoin/upsert logic stays untouched. Raising
-- here rolls the Participant insert back, so an over-long name leaves nothing.
CREATE OR REPLACE FUNCTION public.add_joined_wheel_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = NEW.session_id AND s.session_type = 'wheel') THEN
    IF char_length(NEW.name) > 24 THEN
      RAISE EXCEPTION 'A name can be at most 24 characters';
    END IF;
    INSERT INTO public.wheel_entries (session_id, participant_id, label, kind)
    VALUES (NEW.session_id, NEW.id, NEW.name, 'joined');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.add_joined_wheel_entry() FROM public;

DROP TRIGGER IF EXISTS add_joined_wheel_entry ON participants;
CREATE TRIGGER add_joined_wheel_entry AFTER INSERT ON participants
  FOR EACH ROW EXECUTE FUNCTION public.add_joined_wheel_entry();

-- ---- Entry management (organizer only) -------------------------------------
-- add_wheel_entries: one path for a single add and a bulk paste. Trims, drops
-- blank lines, truncates to 24 characters. Returns how many Entries it added.
CREATE OR REPLACE FUNCTION public.add_wheel_entries(p_session_id uuid, p_labels text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_added integer;
BEGIN
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_session.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_session.session_type <> 'wheel' THEN
    RAISE EXCEPTION 'This session is not a Wheel of Fortune';
  END IF;

  WITH cleaned AS (
    SELECT left(btrim(l.label), 24) AS label, l.ord
      FROM unnest(coalesce(p_labels, '{}'::text[])) WITH ORDINALITY AS l(label, ord)
     WHERE btrim(coalesce(l.label, '')) <> ''
  ), ins AS (
    INSERT INTO public.wheel_entries (session_id, label, kind, created_at)
    SELECT p_session_id, c.label, 'manual', clock_timestamp() + c.ord * interval '1 microsecond'
      FROM cleaned c ORDER BY c.ord
    RETURNING 1
  )
  SELECT count(*) INTO v_added FROM ins;
  RETURN v_added;
END;
$$;

REVOKE ALL ON FUNCTION public.add_wheel_entries(uuid, text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.add_wheel_entries(uuid, text[]) TO authenticated;

-- remove_wheel_entry / restore_wheel_entry: flip removed_at. Past Spins keep
-- their label snapshot, so removal never rewrites history.
CREATE OR REPLACE FUNCTION public.remove_wheel_entry(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entry public.wheel_entries%ROWTYPE;
BEGIN
  SELECT e.* INTO v_entry FROM public.wheel_entries e
    JOIN public.sessions s ON s.id = e.session_id
   WHERE e.id = p_entry_id AND s.owner_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.wheel_entries SET removed_at = coalesce(removed_at, now()) WHERE id = p_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_wheel_entry(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.remove_wheel_entry(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_wheel_entry(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entry public.wheel_entries%ROWTYPE;
BEGIN
  SELECT e.* INTO v_entry FROM public.wheel_entries e
    JOIN public.sessions s ON s.id = e.session_id
   WHERE e.id = p_entry_id AND s.owner_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.wheel_entries SET removed_at = NULL WHERE id = p_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_wheel_entry(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.restore_wheel_entry(uuid) TO authenticated;

-- ---- Spin ------------------------------------------------------------------
-- The SERVER chooses the Pick: uniformly at random among the Entries active at
-- this moment, recorded before the presenter animates, so the draw is fair and
-- survives a reload. Needs at least 2 active Entries.
CREATE OR REPLACE FUNCTION public.spin_wheel(p_session_id uuid)
RETURNS TABLE (spin_id uuid, entry_id uuid, label text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_entry public.wheel_entries%ROWTYPE;
  v_active integer;
BEGIN
  -- Locks the session row so two simultaneous Spins are serialised.
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_session.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_session.session_type <> 'wheel' THEN
    RAISE EXCEPTION 'This session is not a Wheel of Fortune';
  END IF;

  SELECT count(*) INTO v_active FROM public.wheel_entries e
   WHERE e.session_id = p_session_id AND e.removed_at IS NULL;
  IF v_active < 2 THEN
    RAISE EXCEPTION 'Add at least 2 entries before spinning';
  END IF;

  SELECT * INTO v_entry FROM public.wheel_entries e
   WHERE e.session_id = p_session_id AND e.removed_at IS NULL
   ORDER BY random() LIMIT 1;

  RETURN QUERY
    INSERT INTO public.wheel_spins AS w (session_id, entry_id, label)
    VALUES (p_session_id, v_entry.id, v_entry.label)
    RETURNING w.id, w.entry_id, w.label, w.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.spin_wheel(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.spin_wheel(uuid) TO authenticated;

-- resolve_wheel_pick: the organizer's choice after a Spin. Remove takes the
-- Pick's Entry off the wheel and marks the Spin; keep changes nothing.
CREATE OR REPLACE FUNCTION public.resolve_wheel_pick(p_spin_id uuid, p_remove boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_spin public.wheel_spins%ROWTYPE;
BEGIN
  SELECT w.* INTO v_spin FROM public.wheel_spins w
    JOIN public.sessions s ON s.id = w.session_id
   WHERE w.id = p_spin_id AND s.owner_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_remove IS TRUE THEN
    UPDATE public.wheel_entries SET removed_at = coalesce(removed_at, now()) WHERE id = v_spin.entry_id;
    UPDATE public.wheel_spins SET removed = true WHERE id = p_spin_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_wheel_pick(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_wheel_pick(uuid, boolean) TO authenticated;

-- ---- Reset -----------------------------------------------------------------
-- Clears the Spin history and puts every Entry back on the wheel. Participants
-- (and their joined Entries) stay, so the same room can play again.
CREATE OR REPLACE FUNCTION public.reset_wheel(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_session.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_session.session_type <> 'wheel' THEN
    RAISE EXCEPTION 'This session is not a Wheel of Fortune';
  END IF;
  DELETE FROM public.wheel_spins WHERE session_id = p_session_id;
  UPDATE public.wheel_entries SET removed_at = NULL
   WHERE session_id = p_session_id AND removed_at IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_wheel(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reset_wheel(uuid) TO authenticated;

-- ---- Session type lock -----------------------------------------------------
-- As before (votes lock the type), plus: a wheel session counts Spins as
-- responses. The type changes freely until the first Spin and unlocks again
-- once no Spins remain (after Reset).
CREATE OR REPLACE FUNCTION public.prevent_identity_change_after_votes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (NEW.participation_mode IS DISTINCT FROM OLD.participation_mode
      OR NEW.identity_requires_name IS DISTINCT FROM OLD.identity_requires_name
      OR NEW.identity_requires_id IS DISTINCT FROM OLD.identity_requires_id
      OR NEW.is_scored IS DISTINCT FROM OLD.is_scored
      OR NEW.score_time_limit_seconds IS DISTINCT FROM OLD.score_time_limit_seconds)
     AND EXISTS (
       SELECT 1 FROM public.votes v
       JOIN public.questions q ON q.id = v.question_id
       WHERE q.session_id = NEW.id
     )
  THEN
    RAISE EXCEPTION 'The session type cannot be changed after voting has started';
  END IF;

  -- Wheel -> Comments changes no flag above, so the type itself is checked.
  IF (NEW.session_type IS DISTINCT FROM OLD.session_type
      OR NEW.participation_mode IS DISTINCT FROM OLD.participation_mode
      OR NEW.identity_requires_name IS DISTINCT FROM OLD.identity_requires_name
      OR NEW.identity_requires_id IS DISTINCT FROM OLD.identity_requires_id
      OR NEW.is_scored IS DISTINCT FROM OLD.is_scored)
     AND EXISTS (SELECT 1 FROM public.wheel_spins w WHERE w.session_id = NEW.id)
  THEN
    RAISE EXCEPTION 'The session type cannot be changed after the wheel has been spun';
  END IF;
  RETURN NEW;
END;
$$;

-- ---- Phone read ------------------------------------------------------------
-- The latest Pick, scoped by join token. Returns no row before the first Spin.
-- Never exposes the Entry list or anyone else's identity beyond the Pick's
-- label, which the whole room sees on the presenter screen anyway.
CREATE OR REPLACE FUNCTION public.get_wheel_latest_pick(p_join_token text)
RETURNS TABLE (spin_id uuid, label text, picked_at timestamptz, is_you boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_participant public.participants%ROWTYPE;
BEGIN
  SELECT * INTO v_participant FROM public.participants WHERE join_token = p_join_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown participant';
  END IF;

  RETURN QUERY
    SELECT w.id, w.label, w.created_at,
           coalesce(w.entry_id = (SELECT e.id FROM public.wheel_entries e
                                   WHERE e.participant_id = v_participant.id), false)
      FROM public.wheel_spins w
     WHERE w.session_id = v_participant.session_id
     ORDER BY w.created_at DESC, w.id DESC
     LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_wheel_latest_pick(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_wheel_latest_pick(text) TO anon, authenticated;
