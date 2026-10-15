# 0002 — Clue choices reveal text, they do not link clues

- **Status:** accepted (partly superseded by [0003](0003-hunt-game-identity.md): game hunts now have an identity model and a server-enforced lock)
- **Date:** 2026-10-13

## Context

Organizers want a Treasure Hunt Clue to offer two buttons so that a finder is given a further clue
depending on the button tapped, sending teams down different paths.

The obvious model is a graph: each choice points at another Clue (`next_clue_id`), and the player
page navigates to it. Three facts about this codebase argued against that:

1. Clues are deliberately unchained. `CONTEXT.md` defines a Treasure Hunt as "scattered, not
   chained: any order, no dependency between them", and `order_index` only numbers the printed
   QR codes. Links would make the hunt a graph with loops, orphans and unreachable clues, and the
   editor would need to prevent or explain each of those.
2. A hunt records nothing about finders. There are no teams, participants or progress rows, so the
   server cannot enforce "you already chose" or "you may only reach this clue from that one". Any
   such guarantee would have to be invented along with an identity model.
3. `questions` rows of a hunt are hidden from the public by RLS; a clue is reachable only through
   `get_clue(token)`, scoped to its own token. Handing out a link to another clue would hand out
   that clue's token, which is exactly the thing the model keeps private.

## Decision

A choice is `{label, reveal}` stored as `questions.clue_choices jsonb` (null, or 2-4 entries,
enforced by a CHECK). It carries organizer-written reveal text, not a pointer to another Clue.

- `get_clue` returns the labels only.
- `reveal_clue_choice(token, index)` returns one reveal text under the same live/closed gate as
  `get_clue`, so a curious finder cannot read the other branch from the network tab.
- The choice is remembered per phone (localStorage, index only; the reveal text is re-fetched so
  edits and closing the hunt take effect). Nothing about the tap is stored server-side.
- Per clue, the organizer may ask finders to confirm a tap (`questions.clue_confirm_choice`, surfaced
  by `get_clue` as `confirm_choice`). The confirmation box is browser-only; the RPC does not enforce it.

## Consequences

- Hunts stay anonymous and unchained; the feature adds one column and one RPC.
- Locking is honour-system: a second phone, or cleared site data, sees the buttons again. Accepted
  for an in-person game.
- A reveal can name the location of the next QR code, but the app does not verify that a finder
  went where they were told.
- If chained, multi-level choices are wanted later, that is a new decision: it needs an identity or
  progress model first.
