# LivePolls

A live audience-response tool. An organizer runs a Session of questions that a room of attendees respond to from their phones - a Poll or Comments session self-paced or driven by the organizer's presenter screen, a Quiz always driven by it.

## Language

**Session**:
A set of questions an organizer runs for a room. Has exactly one Session type (Poll, Quiz or Comments), which fixes its vocabulary and its participation mode for its whole life.
_Avoid_: Poll (as a synonym for any session - "poll" names one specific session type, not the container).

**Session type**:
One of four fixed presets: Poll (anonymous voting, never scored), Quiz (named participants, always scored), Comments (named participants, free-text reactions to images, never scored), Treasure Hunt (anonymous, no Participants at all - each Clue is reached only by scanning its own QR code). Chosen at creation and locked once the session has its first response.

**Poll**:
A Session type where anonymous attendees vote on options and see aggregate results.

**Quiz**:
A Session type where named Participants answer questions with one correct option each, earn points, and see a Leaderboard. Every Quiz is scored - there is no unscored quiz option in the UI - and host-paced: there is no self-paced quiz mode.
_Avoid_: "Scored quiz" as if scoring were a separate mode - it no longer is. "Self-paced quiz" - removed; every Quiz now follows the host.

**Legacy quiz**:
A Quiz created before every quiz was always scored, whose `is_scored` stayed false because it already had Votes when the migration ran (its points/answer key are frozen and can't be retrofitted). Shown in the UI with a "Legacy" badge; behaves like the old opt-in-scoring quiz.

**Comments**:
A Session type where named Participants leave free-text comments on images the organizer uploads.

**Treasure Hunt**:
A Session type with no Participants: the organizer hides physical QR codes, each printed for one Clue. Scanning is anonymous - nothing is recorded about who found what, and there is no join step. Clues are scattered, not chained: any order, no dependency between them.

**Clue**:
One message in a Treasure Hunt, reached only by scanning its own QR code (never by browsing the session). Its QR code carries a random, permanent token that never changes, even when the organizer edits the Clue's message later - only deleting the Clue invalidates its printed code. The message is shown only while the session is active; scanning an inactive session's Clue, or a deleted Clue's code, shows a status message instead. A Clue may also carry an organizer-only label (default "Clue #N") printed under its QR code; finders never see it.
_Avoid_: Question (the underlying database row a Clue reuses, but "Clue" is the organizer- and finder-facing term).

**Participant**:
A person taking part in a Session, identified by name and/or ID in Quiz and Comments sessions. The generic term used across the UI regardless of session type - a Participant votes in a Poll, answers in a Quiz, and comments in a Comments session.
_Avoid_: Voter, Player, Contestant, Attendee (as the primary UI term - "Participant" is canonical; "Attendee" still appears in some organizer-facing copy referring to the room in general).

**Vote**:
A Participant's response to a Poll question. Anonymous, aggregated into counts.
_Avoid_: Answer, response (for Poll responses specifically).

**Answer**:
A Participant's response to a Quiz question. Judged server-side against the question's correct option to award points.
_Avoid_: Vote (for Quiz responses - a Quiz Participant answers, they don't vote).

**Lock**:
A Participant's act of committing their selected option as their final Answer to the open Quiz question. Before Lock, they can change their selection freely; after Lock it is final and no longer editable. A locked Answer carries no correctness or points yet - those wait for Reveal.

**Reveal**:
The host's action, from the presenter screen, that judges every Participant's locked Answer for the open Quiz question against its correct option, awards points, and shows the correct option on every device. Nothing about correctness is visible to any Participant before Reveal - not even in the Leaderboard or vote totals.

**Comment**:
A Participant's free-text response to a Comments-session image.

**Score**:
A Participant's running total of points earned from correct Quiz Answers. Only exists on Quiz sessions.

**Leaderboard**:
The ranking of Quiz Participants by Score, shown between questions and as the final ranking once the quiz is closed.
