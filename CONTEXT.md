# LivePolls

A live audience-response tool. An organizer runs a Session of questions that a room of attendees respond to from their phones - a Poll or Comments session self-paced or driven by the organizer's presenter screen, a Quiz always driven by it.

## Language

**Session**:
A set of questions an organizer runs for a room. Has exactly one Session type (Poll, Quiz or Comments), which fixes its vocabulary and its participation mode for its whole life.
_Avoid_: Poll (as a synonym for any session - "poll" names one specific session type, not the container).

**Session type**:
One of five fixed presets: Poll (anonymous voting, never scored), Quiz (named participants, always scored), Comments (named participants, free-text reactions to images, never scored), Treasure Hunt (anonymous, no Participants at all - each Clue is reached only by scanning its own QR code), Wheel of Fortune (named participants who put themselves on the wheel; never scored). Chosen at creation and locked once the session has its first response.

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

**Wheel of Fortune**:
A Session type for a random draw: attendees join with a name (required, trimmed, at most 24 characters; duplicates allowed), which puts them on the wheel automatically, and the organizer may add manual Entries. The session is the wheel - one per session, no Questions. The organizer Spins from the presenter screen; the server chooses the Pick. The type is locked once the first Spin exists and unlocks again after Reset.
_Avoid_: "Winner" and "prize" (a Pick is not necessarily a win - it may be a cold call or a presenter order), "segment" (only the visual slice of an Entry).

**Entry**:
One item on the wheel: either *joined* (created when a Participant joins, labelled with their name) or *manual* (organizer-typed text, single or pasted one per line). Active until removed; a removed Entry stays listed greyed out and can be Restored. Removing an Entry never rewrites past Spins. There is no cap on Entries and duplicate labels are kept.

**Spin**:
One server-side random choice of a Pick among the Entries active at that moment (uniform; refused with fewer than 2 active Entries; organizer only). Recorded with a snapshot of the Pick's label, its time, and whether the organizer then removed the Pick. The full list of Spins is the wheel's history.

**Pick**:
The Entry a Spin landed on. After each Spin the organizer resolves it: *remove* the Pick from the wheel (raffle) or *keep* it (repeat picks allowed). Phones see only the latest Pick's label and whether it is theirs - never the Entry list.

**Reset**:
The organizer's action that clears a wheel's Spin history and restores every removed Entry, keeping the joined Participants so the same room can play again.

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
A Participant's act of committing their selected option as their final Answer to the open Quiz question. Before Lock, they can change their selection freely; after Lock it is final and no longer editable. A locked Answer carries no correctness or points yet - those wait for Reveal. A Lock is refused once the question's Time limit has passed (a 1-second grace covers network delay); the Participant then has no Answer for that question.

**Time limit**:
How long a Quiz question accepts a Lock, counted from when the host first opens it. Set per question (default 20 seconds, between 5 and 120) and frozen once the question has any Answers.

**Reveal**:
The host's action, from the presenter screen, that judges every Participant's locked Answer for the open Quiz question against its correct option, awards points, and shows the correct option on every device. Nothing about correctness is visible to any Participant before Reveal - not even in the Leaderboard or vote totals.

**Comment**:
A Participant's free-text response to a Comments-session image.

**Response time**:
How long a Participant took on a Quiz question: from the host first opening it to the Participant's Lock. A wrong Answer counts its real time; a question they never Locked counts as its full Time limit. It is added up across the questions revealed so far, and a Participant who joins late starts as if they had missed every question already revealed.
_Avoid_: speed, answer time.

**Tiebreak**:
How Participants on the same Score are ordered: lowest cumulative Response time first. Speed never changes Score, and Participants with exactly the same Score and cumulative Response time share a rank. A Legacy quiz still orders ties by when each Participant finished.
_Avoid_: speed bonus - no bonus points exist.

**Score**:
A Participant's running total of points earned from correct Quiz Answers. Only exists on Quiz sessions.

**Leaderboard**:
The ranking of Quiz Participants by Score, then by Tiebreak, shown between questions and as the final ranking once the quiz is closed.
