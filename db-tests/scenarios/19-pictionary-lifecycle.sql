-- Ticket: Pictionary schema, hidden Words and the Round lifecycle (no guessing).
\ir ../helpers.sql
BEGIN;

-- Settings, Start refusals and the type lock.
DO $$
DECLARE
  v_session uuid := pg_temp.make_pictionary(E'cat\ndog');
  v_err text;
BEGIN
  IF (SELECT pictionary_round_count FROM public.sessions WHERE id = v_session) <> 8
     OR (SELECT pictionary_round_seconds FROM public.sessions WHERE id = v_session) <> 80 THEN
    RAISE EXCEPTION 'defaults should be 8 rounds of 80 seconds';
  END IF;

  v_err := pg_temp.error_of(format('SELECT public.start_pictionary_round(%L)', v_session));
  IF v_err IS NULL OR v_err NOT LIKE '%at least 2%' THEN
    RAISE EXCEPTION 'Start should need 2 Participants, got: %', v_err;
  END IF;
  PERFORM pg_temp.join_as(v_session, 'Ann');
  PERFORM pg_temp.join_as(v_session, 'Ben');
  v_err := pg_temp.error_of(format('SELECT public.start_pictionary_round(%L)', v_session));
  IF v_err IS NULL OR v_err NOT LIKE '%at least 3 words%' THEN
    RAISE EXCEPTION 'Start should need 3 Words, got: %', v_err;
  END IF;

  PERFORM public.set_pictionary_words(v_session, E'  Cat \n\nDOG\ncat\nfish');
  IF public.get_pictionary_words(v_session) <> E'Cat\nDOG\nfish' THEN
    RAISE EXCEPTION 'word list should be trimmed and de-duplicated, got %', public.get_pictionary_words(v_session);
  END IF;

  PERFORM public.start_pictionary_round(v_session);
  v_err := pg_temp.error_of(format('UPDATE public.sessions SET session_type = %L, is_scored = false WHERE id = %L', 'comments', v_session));
  IF v_err IS NULL OR v_err NOT LIKE '%cannot be changed%' THEN
    RAISE EXCEPTION 'type should lock with the first Round, got: %', v_err;
  END IF;
  v_err := pg_temp.error_of(format('SELECT public.start_pictionary_round(%L)', v_session));
  IF v_err IS NULL OR v_err NOT LIKE '%still in progress%' THEN
    RAISE EXCEPTION 'a second Round cannot start over a live one, got: %', v_err;
  END IF;
END $$;

-- Round count is enforced.
DO $$
DECLARE
  v_session uuid := pg_temp.make_pictionary();
  v_err text;
BEGIN
  PERFORM pg_temp.join_as(v_session, 'Ann');
  PERFORM pg_temp.join_as(v_session, 'Ben');
  UPDATE public.sessions SET pictionary_round_count = 1 WHERE id = v_session;
  PERFORM public.start_pictionary_round(v_session);
  PERFORM public.skip_pictionary_round(v_session);
  v_err := pg_temp.error_of(format('SELECT public.start_pictionary_round(%L)', v_session));
  IF v_err IS NULL OR v_err NOT LIKE '%All rounds have been played%' THEN
    RAISE EXCEPTION 'Start past the last Round should be refused, got: %', v_err;
  END IF;
END $$;

-- Secrecy: only the Drawer (and the owner) can get Words.
DO $$
DECLARE
  v_session uuid := pg_temp.make_pictionary();
  v_a text := pg_temp.join_as(v_session, 'Ann');
  v_b text := pg_temp.join_as(v_session, 'Ben');
  v_c text := pg_temp.join_as(v_session, 'Cy');
  v_drawer text; v_other text;
  v_word uuid; v_text text; v_n integer; v_err text;
  r public.pictionary_rounds;
BEGIN
  PERFORM public.start_pictionary_round(v_session);
  v_drawer := pg_temp.drawer_token(v_session);
  v_other := CASE WHEN v_drawer = v_a THEN v_b ELSE v_a END;

  v_err := pg_temp.error_of(format('SELECT * FROM public.get_pictionary_choices(%L)', v_other));
  IF v_err IS NULL THEN RAISE EXCEPTION 'a non-Drawer saw the choices'; END IF;
  v_err := pg_temp.error_of(format('SELECT * FROM public.get_pictionary_choices(%L)', 'nope'));
  IF v_err IS NULL THEN RAISE EXCEPTION 'an unknown token saw the choices'; END IF;

  SELECT count(*) INTO v_n FROM public.get_pictionary_choices(v_drawer);
  IF v_n <> 3 THEN RAISE EXCEPTION 'Drawer should be offered 3 Words, got %', v_n; END IF;
  SELECT word_id INTO v_word FROM public.get_pictionary_choices(v_drawer) LIMIT 1;

  -- The Word cannot be read before it is picked.
  v_err := pg_temp.error_of(format('SELECT public.get_pictionary_word(%L, %L)', v_session, v_drawer));
  IF v_err IS NULL THEN RAISE EXCEPTION 'Drawer read a Word before picking'; END IF;

  -- Only the Drawer may pick, and only an offered Word.
  v_err := pg_temp.error_of(format('SELECT public.choose_pictionary_word(%L, %L)', v_other, v_word));
  IF v_err IS NULL THEN RAISE EXCEPTION 'a non-Drawer picked a Word'; END IF;
  v_err := pg_temp.error_of(format('SELECT public.choose_pictionary_word(%L, %L)', v_drawer, gen_random_uuid()));
  IF v_err IS NULL THEN RAISE EXCEPTION 'an unoffered Word was accepted'; END IF;

  PERFORM public.choose_pictionary_word(v_drawer, v_word);
  r := pg_temp.latest_round(v_session);
  IF r.status <> 'drawing' OR r.started_at IS NULL OR r.ends_at <> r.started_at + interval '80 seconds'
     OR r.word IS NOT NULL THEN
    RAISE EXCEPTION 'pick should start the timer and keep the Word secret: %', to_jsonb(r);
  END IF;
  v_err := pg_temp.error_of(format('SELECT public.choose_pictionary_word(%L, %L)', v_drawer, v_word));
  IF v_err IS NULL THEN RAISE EXCEPTION 'a Word was picked twice'; END IF;

  v_text := public.get_pictionary_word(v_session, v_drawer);
  IF v_text NOT IN ('cat','dog','fish','bird','horse') THEN RAISE EXCEPTION 'Drawer got %', v_text; END IF;
  v_err := pg_temp.error_of(format('SELECT public.get_pictionary_word(%L, %L)', v_session, v_other));
  IF v_err IS NULL THEN RAISE EXCEPTION 'a non-Drawer read the Word'; END IF;
  v_err := pg_temp.error_of(format('SELECT public.get_pictionary_word(%L, NULL)', v_session));
  IF v_err IS NOT NULL THEN RAISE EXCEPTION 'the owner should read the Word, got %', v_err; END IF;
  PERFORM pg_temp.act_as_stranger();
  v_err := pg_temp.error_of(format('SELECT public.get_pictionary_word(%L, NULL)', v_session));
  IF v_err IS NULL THEN RAISE EXCEPTION 'a stranger read the Word'; END IF;
  PERFORM pg_temp.act_as_owner(v_session);

  -- Skip reveals the Word on the public Round record.
  PERFORM public.skip_pictionary_round(v_session);
  IF (pg_temp.latest_round(v_session)).word <> v_text THEN RAISE EXCEPTION 'Skip should reveal the Word'; END IF;
END $$;

-- Roles: the store is invisible to clients, the Round record is public, and
-- owner-only functions are closed to anon.
DO $$
DECLARE
  v_session uuid := pg_temp.make_pictionary();
  v_n integer; v_role text;
BEGIN
  PERFORM pg_temp.join_as(v_session, 'Ann');
  PERFORM pg_temp.join_as(v_session, 'Ben');
  PERFORM public.start_pictionary_round(v_session);
  PERFORM set_config('scn.session', v_session::text, true);

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    BEGIN
      SELECT count(*) INTO v_n FROM public.pictionary_words;
    EXCEPTION WHEN insufficient_privilege THEN v_n := 0;
    END;
    IF v_n <> 0 THEN EXECUTE 'RESET ROLE'; RAISE EXCEPTION '% read % Words', v_role, v_n; END IF;
    SELECT count(*) INTO v_n FROM public.pictionary_rounds WHERE session_id = current_setting('scn.session')::uuid;
    IF v_n <> 1 THEN EXECUTE 'RESET ROLE'; RAISE EXCEPTION '% should see the Round record, saw %', v_role, v_n; END IF;
    EXECUTE 'RESET ROLE';
  END LOOP;

  IF has_function_privilege('anon', 'public.start_pictionary_round(uuid, uuid)', 'execute')
     OR has_function_privilege('anon', 'public.skip_pictionary_round(uuid)', 'execute')
     OR has_function_privilege('anon', 'public.get_pictionary_words(uuid)', 'execute') THEN
    RAISE EXCEPTION 'anon can execute an owner function';
  END IF;
  IF has_function_privilege('anon', 'public.end_pictionary_round(uuid, text)', 'execute')
     OR has_function_privilege('authenticated', 'public.end_pictionary_round(uuid, text)', 'execute') THEN
    RAISE EXCEPTION 'the internal end_pictionary_round is callable by clients';
  END IF;
END $$;

-- Pool: unchosen Words return; fewer than 3 left offers what is left; an
-- empty pool starts over.
DO $$
DECLARE
  v_session uuid := pg_temp.make_pictionary(E'cat\ndog\nfish');
  v_offered text[];
  v_pick uuid; v_pick_text text;
BEGIN
  PERFORM pg_temp.join_as(v_session, 'Ann');
  PERFORM pg_temp.join_as(v_session, 'Ben');

  PERFORM public.start_pictionary_round(v_session);
  SELECT array_agg(word ORDER BY word) INTO v_offered FROM public.get_pictionary_choices(pg_temp.drawer_token(v_session));
  IF v_offered <> ARRAY['cat','dog','fish'] THEN RAISE EXCEPTION 'round 1 offers %', v_offered; END IF;
  SELECT word_id, word INTO v_pick, v_pick_text FROM public.get_pictionary_choices(pg_temp.drawer_token(v_session)) ORDER BY word LIMIT 1;
  PERFORM public.choose_pictionary_word(pg_temp.drawer_token(v_session), v_pick);
  PERFORM public.skip_pictionary_round(v_session);

  -- Round 2: exactly the two that were not chosen came back.
  PERFORM public.start_pictionary_round(v_session);
  SELECT array_agg(word ORDER BY word) INTO v_offered FROM public.get_pictionary_choices(pg_temp.drawer_token(v_session));
  IF v_offered <> (SELECT array_agg(w ORDER BY w) FROM unnest(ARRAY['cat','dog','fish']) w WHERE w <> v_pick_text) THEN
    RAISE EXCEPTION 'round 2 should offer the unchosen two, got %', v_offered;
  END IF;
  SELECT word_id INTO v_pick FROM public.get_pictionary_choices(pg_temp.drawer_token(v_session)) LIMIT 1;
  PERFORM public.choose_pictionary_word(pg_temp.drawer_token(v_session), v_pick);
  PERFORM public.skip_pictionary_round(v_session);

  -- Round 3: one Word left.
  PERFORM public.start_pictionary_round(v_session);
  IF (SELECT count(*) FROM public.get_pictionary_choices(pg_temp.drawer_token(v_session))) <> 1 THEN
    RAISE EXCEPTION 'round 3 should offer what is left (1)';
  END IF;
  SELECT word_id INTO v_pick FROM public.get_pictionary_choices(pg_temp.drawer_token(v_session));
  PERFORM public.choose_pictionary_word(pg_temp.drawer_token(v_session), v_pick);
  PERFORM public.skip_pictionary_round(v_session);

  -- Round 4: every Word has been used, so the pool starts over.
  PERFORM public.start_pictionary_round(v_session);
  IF (SELECT count(*) FROM public.get_pictionary_choices(pg_temp.drawer_token(v_session))) <> 3 THEN
    RAISE EXCEPTION 'an exhausted pool should start over with 3';
  END IF;
END $$;

-- Drawers: random cycles through everyone; explicit and replacement Drawers.
DO $$
DECLARE
  v_session uuid := pg_temp.make_pictionary();
  v_ann uuid; v_foreign uuid; v_other_session uuid;
  v_seen uuid[] := '{}'; v_d uuid; v_old uuid; v_err text;
BEGIN
  PERFORM pg_temp.join_as(v_session, 'Ann');
  PERFORM pg_temp.join_as(v_session, 'Ben');
  PERFORM pg_temp.join_as(v_session, 'Cy');
  SELECT id INTO v_ann FROM public.participants WHERE session_id = v_session AND name = 'Ann';

  FOR i IN 1..3 LOOP
    PERFORM public.start_pictionary_round(v_session);
    v_d := (pg_temp.latest_round(v_session)).drawer_id;
    IF v_d = ANY (v_seen) THEN RAISE EXCEPTION 'Drawer % repeated before everyone drew (round %)', v_d, i; END IF;
    v_seen := v_seen || v_d;
    PERFORM public.skip_pictionary_round(v_session);
  END LOOP;
  -- Everyone has drawn: it starts over.
  PERFORM public.start_pictionary_round(v_session);
  IF (pg_temp.latest_round(v_session)).drawer_id IS NULL THEN RAISE EXCEPTION 'no Drawer after reset'; END IF;
  PERFORM public.skip_pictionary_round(v_session);

  -- Organizer chooses the Drawer.
  PERFORM public.start_pictionary_round(v_session, v_ann);
  IF (pg_temp.latest_round(v_session)).drawer_id <> v_ann THEN RAISE EXCEPTION 'chosen Drawer ignored'; END IF;

  -- Pick another Drawer mid-round: back to Choosing with fresh Words.
  PERFORM public.choose_pictionary_word(pg_temp.drawer_token(v_session),
    (SELECT word_id FROM public.get_pictionary_choices(pg_temp.drawer_token(v_session)) LIMIT 1));
  v_old := v_ann;
  PERFORM public.pick_another_pictionary_drawer(v_session);
  IF (pg_temp.latest_round(v_session)).drawer_id = v_old
     OR (pg_temp.latest_round(v_session)).status <> 'choosing'
     OR (pg_temp.latest_round(v_session)).started_at IS NOT NULL THEN
    RAISE EXCEPTION 'replacement should be a new Drawer, choosing again: %', to_jsonb(pg_temp.latest_round(v_session));
  END IF;
  IF (SELECT count(*) FROM public.get_pictionary_choices(pg_temp.drawer_token(v_session))) <> 3 THEN
    RAISE EXCEPTION 'the new Drawer should be offered 3 Words';
  END IF;
  IF (SELECT count(*) FROM public.pictionary_rounds WHERE session_id = v_session) <> 5 THEN
    RAISE EXCEPTION 'replacing a Drawer must not add a Round';
  END IF;
  PERFORM public.pick_another_pictionary_drawer(v_session, v_old);
  IF (pg_temp.latest_round(v_session)).drawer_id <> v_old THEN RAISE EXCEPTION 'explicit replacement ignored'; END IF;
  v_err := pg_temp.error_of(format('SELECT public.pick_another_pictionary_drawer(%L, %L)', v_session, v_old));
  IF v_err IS NULL THEN RAISE EXCEPTION 'replacing a Drawer with themself should be refused'; END IF;

  -- A Participant of another session cannot be Drawer.
  v_other_session := pg_temp.make_pictionary();
  PERFORM pg_temp.join_as(v_other_session, 'Zed');
  SELECT id INTO v_foreign FROM public.participants WHERE session_id = v_other_session;
  PERFORM pg_temp.act_as_owner(v_session);
  v_err := pg_temp.error_of(format('SELECT public.pick_another_pictionary_drawer(%L, %L)', v_session, v_foreign));
  IF v_err IS NULL THEN RAISE EXCEPTION 'a foreign Participant became Drawer'; END IF;
END $$;

-- Time boundaries: auto-pick at 15s, timeout at the limit; nothing awarded.
DO $$
DECLARE
  v_session uuid := pg_temp.make_pictionary();
  v_err text; r public.pictionary_rounds;
BEGIN
  PERFORM pg_temp.join_as(v_session, 'Ann');
  PERFORM pg_temp.join_as(v_session, 'Ben');
  PERFORM public.start_pictionary_round(v_session);

  v_err := pg_temp.error_of(format('SELECT public.auto_pick_pictionary_word(%L)', v_session));
  IF v_err IS NULL OR v_err NOT LIKE '%not up yet%' THEN RAISE EXCEPTION 'auto-pick must wait 15s, got: %', v_err; END IF;
  r := pg_temp.latest_round(v_session);
  IF r.choose_deadline <> r.created_at + interval '15 seconds' THEN RAISE EXCEPTION 'choose window is not 15s'; END IF;

  UPDATE public.pictionary_rounds SET choose_deadline = now() - interval '1 second' WHERE id = r.id;
  PERFORM public.auto_pick_pictionary_word(v_session);
  r := pg_temp.latest_round(v_session);
  IF r.status <> 'drawing' OR r.started_at IS NULL OR r.ends_at <> r.started_at + interval '80 seconds' THEN
    RAISE EXCEPTION 'auto-pick should start the timer: %', to_jsonb(r);
  END IF;
  v_err := pg_temp.error_of(format('SELECT public.auto_pick_pictionary_word(%L)', v_session));
  IF v_err IS NULL THEN RAISE EXCEPTION 'auto-pick must only act on a Choosing Round'; END IF;

  v_err := pg_temp.error_of(format('SELECT public.timeout_pictionary_round(%L)', v_session));
  IF v_err IS NULL OR v_err NOT LIKE '%not up yet%' THEN RAISE EXCEPTION 'timeout must wait, got: %', v_err; END IF;
  UPDATE public.pictionary_rounds SET ends_at = now() - interval '1 second' WHERE id = r.id;
  PERFORM public.timeout_pictionary_round(v_session);
  r := pg_temp.latest_round(v_session);
  IF r.status <> 'revealed' OR r.end_reason <> 'timeout' OR r.word IS NULL
     OR r.winner_participant_id IS NOT NULL OR r.winner_points IS NOT NULL OR r.drawer_points <> 0 THEN
    RAISE EXCEPTION 'timeout should reveal the Word and award nothing: %', to_jsonb(r);
  END IF;

  -- Skip: no points either.
  PERFORM public.start_pictionary_round(v_session);
  PERFORM public.skip_pictionary_round(v_session);
  r := pg_temp.latest_round(v_session);
  IF r.status <> 'revealed' OR r.end_reason <> 'skipped' OR r.winner_participant_id IS NOT NULL OR r.drawer_points <> 0 THEN
    RAISE EXCEPTION 'skip should award nothing: %', to_jsonb(r);
  END IF;
  v_err := pg_temp.error_of(format('SELECT public.skip_pictionary_round(%L)', v_session));
  IF v_err IS NULL THEN RAISE EXCEPTION 'a revealed Round cannot be skipped'; END IF;
END $$;

-- Non-owners are refused on every organizer function.
DO $$
DECLARE
  v_session uuid := pg_temp.make_pictionary();
  v_fn text; v_err text;
BEGIN
  PERFORM pg_temp.join_as(v_session, 'Ann');
  PERFORM pg_temp.join_as(v_session, 'Ben');
  PERFORM public.start_pictionary_round(v_session);
  UPDATE public.pictionary_rounds SET choose_deadline = now() - interval '1 second' WHERE session_id = v_session;
  PERFORM pg_temp.act_as_stranger();

  FOREACH v_fn IN ARRAY ARRAY[
    'public.set_pictionary_words(%L, ''a'')', 'public.get_pictionary_words(%L)',
    'public.start_pictionary_round(%L)', 'public.auto_pick_pictionary_word(%L)',
    'public.skip_pictionary_round(%L)', 'public.timeout_pictionary_round(%L)',
    'public.pick_another_pictionary_drawer(%L)'] LOOP
    v_err := pg_temp.error_of(format('SELECT ' || v_fn, v_session));
    IF v_err IS NULL OR v_err NOT LIKE '%Not authorized%' THEN
      RAISE EXCEPTION '% should refuse a stranger, got: %', v_fn, v_err;
    END IF;
  END LOOP;
END $$;

ROLLBACK;
