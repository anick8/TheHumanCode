# 0003 — Game hunts have identity and a server-enforced lock

- **Status:** accepted
- **Date:** 2026-10-16
- **Supersedes:** parts of [0002](0002-clue-choices-as-reveal-text.md) (facts 2 and the honour-system lock)

## Context

ADR 0002 kept hunts anonymous, so the server could not enforce "you already chose". Organizers now
want a competition: who took part, when each Clue was found, who won, and who may play at all.
Recording that needs participants, which 0002 deliberately avoided inventing.

## Decision

A Treasure Hunt gains a per-hunt switch (`sessions.hunt_game`). When on, the hunt is a **game**:

- Players are rows in the existing `participants` table, identified by the per-phone join token,
  with an approval status the organizer controls. There is no recovery code.
- One `hunt_scans` row per (participant, Clue) holds the first-scan time and the first pick.
  The primary key makes both "first only". Only the owner can read it; writes go through
  SECURITY DEFINER RPCs.
- `get_clue` and `reveal_clue_choice` take the join token and enforce approval, the hunt clock and
  the pick lock on the server. The clock lives in one database rule, so phone clocks never matter.
- `join_hunt` returns the existing rejected row for a rejected or removed token instead of refusing outright; the phone stays blocked and sees "removed", which deviates from the spec's word "refused".
- Clues stay unchained and picks carry no points or right answer; choices still reveal text only.

Hunts with the switch off (every hunt that predates it) keep the anonymous model and the
phone-local lock from 0002 unchanged: no join step, nothing recorded.

## Consequences

- Two behaviours live behind one RPC pair, so `get_clue` changed shape and the app and database
  deploy together.
- A game's lock holds across reloads, cleared data and second phones. A phone that loses its token
  rejoins as a new pending player and the organizer must approve again.
- Reset deletes the run (players, scans, picks); the CSV is the only archive.
- Chained or scored choices remain a separate decision; the identity model now exists to build on.
