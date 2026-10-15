# LivePolls

A live audience-response tool. An organizer runs a Session of questions that a room of attendees respond to from their phones - a Poll or Comments session self-paced or driven by the organizer's presenter screen, a Quiz always driven by it.

## Language

**Session**:
A set of questions an organizer runs for a room. Has exactly one Session type (Poll, Quiz or Comments), which fixes its vocabulary and its participation mode for its whole life.
_Avoid_: Poll (as a synonym for any session - "poll" names one specific session type, not the container).

**Session type**:
One of five fixed presets: Poll (anonymous voting, never scored), Quiz (named participants, always scored), Comments (named participants, free-text reactions to images, never scored), Treasure Hunt (each Clue is reached only by scanning its own QR code; a Hunt game has approved Participants, otherwise anonymous with no Participants), Wheel of Fortune (named participants who put themselves on the wheel; never scored). Chosen at creation and locked once the session has its first response.

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
A Session type where the organizer hides physical QR codes, each printed for one Clue. Either a Hunt game (named, approved Participants, timed and ranked) or anonymous (no Participants, nothing recorded about who found what, no join step). Clues are scattered, not chained: any order, no dependency between them.

**Hunt game**:
A Treasure Hunt with the "Players join and are timed" switch on (default for new hunts; off for hunts that predate it). Players join by scanning the hunt's join QR code and entering a name (required, at most 40 characters), the organizer gives Approval, and the Hunt clock decides when Scans count. Players are ranked by Clues found, then by earliest last Scan. Hunts without the switch stay anonymous and behave as before.
_Avoid_: "Competition mode", "team hunt" (players are individuals).

**Hunt clock**:
The server-decided span in which a Hunt game accepts Scans and picks: started by the organizer, ended by Stop or, when a length in minutes was set, by its end time. Joining closes at the start. Before it a scan shows "not started" without revealing the Clue; after it, "over". Reset clears it.

**Approval**:
The organizer's per-Participant decision (pending, approved or rejected) on who may play a Hunt game. Only approved Participants have Scans counted; a pending one sees a waiting screen and no Clue. Approval can be given in bulk, and may be given after the start (time still counts from the hunt start). A rejected or removed token cannot join again.

**Scan**:
An approved Participant's first opening of a Clue while the Hunt clock runs, recorded once per Participant and Clue with its time. Rescanning shows the Clue again and never changes the first time.

**Wheel of Fortune**:
A Session type for a random draw: attendees join with a name (required, trimmed, at most 24 characters; duplicates allowed), which puts them on the wheel automatically, and the organizer may add manual Entries. The session is the wheel - one per session, no Questions. The organizer Spins from the presenter screen; the server chooses the Pick. The type is locked once the first Spin exists and unlocks again after Reset.
_Avoid_: "Winner" and "prize" (a Pick is not necessarily a win - it may be a cold call or a presenter order), "segment" (only the visual slice of an Entry).

**Entry**:
One item on the wheel: either *joined* (created when a Participant joins, labelled with their name) or *manual* (organizer-typed text, single or pasted one per line). Active until removed; a removed Entry stays listed greyed out and can be Restored. Removing an Entry never rewrites past Spins. There is no cap on Entries (the Join limit caps joined Participants only) and duplicate labels are kept.

**Spin**:
One server-side random choice of a Pick among the Entries active at that moment (uniform; refused with fewer than 2 active Entries; organizer only). Recorded with a snapshot of the Pick's label, its time, and whether the organizer then removed the Pick. The full list of Spins is the wheel's history.

**Pick**:
The Entry a Spin landed on. After each Spin the organizer resolves it: *remove* the Pick from the wheel (raffle) or *keep* it (repeat picks allowed). Phones see only the latest Pick's label and whether it is theirs - never the Entry list.

**Reset**:
The organizer's action that clears a wheel's Spin history and restores every removed Entry, keeping the joined Participants so the same room can play again. On a Hunt game it deletes the Participants, Scans and picks and clears the Hunt clock, keeping the Clues and their QR codes.

**Clue**:
One message in a Treasure Hunt, reached only by scanning its own QR code (never by browsing the session). Its QR code carries a random, permanent token that never changes, even when the organizer edits the Clue's message later - only deleting the Clue invalidates its printed code. The message is shown only while the session is active; scanning an inactive session's Clue, or a deleted Clue's code, shows a status message instead. A Clue may also carry an organizer-only label (default "Clue #N") printed under its QR code; finders never see it. A Clue may also offer Clue choices.
_Avoid_: Question (the underlying database row a Clue reuses, but "Clue" is the organizer- and finder-facing term).

**Clue choice**:
One of 2-4 buttons an organizer can put on a Clue; each has a button label and a reveal text (the further clue). Tapping a button shows its reveal text on that Clue's page - it does not link to another Clue, so Clues stay unchained. In a Hunt game the server records each Participant's first pick and its time and locks it for that Participant (the pick has no right answer and no points). In an anonymous hunt the finder's phone remembers and locks the choice and the server records nothing. Labels are public with the Clue; a reveal text is released only when its button is tapped, and only while the session is active (in a Hunt game, only while the Hunt clock runs).
_Avoid_: "Branch" or "path" (a choice never leads to another Clue), "answer" (there is no right or wrong choice).

**Close entries**:
The host's manual toggle that stops new people getting in. In a Quiz, Comments or Wheel of Fortune session nobody new can join (a device that already joined keeps playing, and the join gate says entries are closed; on a wheel the organizer can still add manual Entries); a Poll has no join step, so it closes voting for everyone instead. Never automatic, and the host can reopen at any time.
_Avoid_: "Lock" (that is a Participant committing an Answer), "end session" (the session stays active).

**Join limit**:
An optional cap the organizer sets on a Wheel of Fortune session (`max_participants`; blank means no limit) on how many Participants may join. Once that many have joined, new joins are refused and the join gate says the wheel is full; the presenter shows "Wheel is full". Manual Entries never count, and a joined Entry the organizer removed still holds its Participant's place. The organizer can raise or clear the limit at any time. Unlike Close entries it is not a switch: it applies by count.

**Remove participant**:
The host's action to kick a Participant out of a Quiz or Comments session. A hard delete: their Answers or Comments go with them and the Leaderboard re-ranks without them. They may rejoin while entries are open. A Poll has nobody to remove (votes are anonymous). The host can also delete a single Comment.

**Participant**:
A person taking part in a Session, identified by name and/or ID in Quiz and Comments sessions. The generic term used across the UI regardless of session type (in a Hunt game, the player who joined by name) - a Participant votes in a Poll, answers in a Quiz, and comments in a Comments session.
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

**Quiz format**:
A setting on a Quiz: Classic (the default, everything above) or Round-by-round. Chosen at creation or in settings and locked once the Quiz has its first Answer. Join, Lock, Reveal, Time limit, Close entries and Remove participant behave the same in both.

**Round-by-round**:
A Quiz format with no cumulative result. After each Reveal the Question board shows only the Participants who got that question right, fastest first; the next question starts a fresh board. Points and Score are not shown or entered. The quiz ends with a Round recap, never a total. Because nothing accumulates, Participants may join mid-game while entries are open: the presenter keeps a small join QR in the corner during questions (the host can hide it) and a latecomer plays from the current question. Classic shows the QR only in the lobby.
_Avoid_: "Sprint", "rapid fire"; calling its board "the Leaderboard" (that is the cumulative Classic ranking).

**Question board**:
The ranking of one revealed question in a Round-by-round Quiz: only correct Participants, ordered by Response time, exactly equal times share a rank. The presenter shows the top 10 and "+N more got it right"; phones show everyone with their own row highlighted.

**Round recap**:
The end-of-quiz list for a Round-by-round Quiz: each revealed question with its fastest correct Participant(s) and time ("Nobody got this one" when none). Joint winners on an exact tie. There is deliberately no tally of wins.

**Score**:
A Participant's running total of points earned from correct Quiz Answers. Only exists on Classic Quiz sessions (it is still accrued under the hood in Round-by-round but never shown).

**Leaderboard**:
The ranking of Classic Quiz Participants by Score, then by Tiebreak, shown between questions and as the final ranking once the quiz is closed. A Round-by-round Quiz has a Question board per question and a Round recap instead.

**Organizer**:
A signed-in person who may create, edit and present Sessions. Access comes from a Grant (or from being a Super admin). Attendees are not Organizers and need no account.
_Avoid_: Renter, host (host names the Organizer acting on the presenter screen), admin (that is the Super admin).

**Super admin**:
An Organizer who also manages everyone else's access from `/admin`: grants, extends, revokes and deletes Grants and sees Leads. Always has access and unlimited AI, needing no Grant of their own. Added and removed from the backend, never from the app.

**Grant**:
One email's permission to be an Organizer, for a date range (start, optional end; blank end never expires) with an optional AI allowance. Statuses: active, upcoming, expired, revoked. Extending a Grant moves its start to the renewal moment, which restarts the AI allowance count. Revoking takes effect at once with no grace; an expired Grant keeps a short grace so a live event can finish. Payment happens outside the app.

**Lead**:
Someone who signed in without a Grant. Listed on `/admin` so a Super admin can turn them into a Grant.

**Lapsed Organizer**:
An Organizer whose Grant has expired (past the grace) or been revoked. Soft-locked: read-only, nothing deleted. They can still sign in and view their own Sessions and results but cannot create, edit, present, upload or use the AI assistant, and their attendees see "This session is closed". Renewing the Grant restores everything as it was.
_Avoid_: "Deleted" or "suspended" account (no data is removed and the account still signs in).

**AI allowance**:
The number of assistant calls a Grant permits, counted from the Grant's start through its end plus the grace; blank means unlimited. Checked after the hourly limit and before usage is recorded. Super admins are exempt.
