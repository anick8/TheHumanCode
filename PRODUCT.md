# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are conference and meetup organizers/speakers who create poll sessions for a live talk or event. Attendees are the voters: they scan a QR code from their seat and vote anonymously on their phone, no signup or app install. A secondary role is the presenter at the podium/projector, who may be the same person as the organizer, driving the session live.

## Product Purpose

MC Genie lets an organizer create a poll session (a set of questions with options), generate a QR code for it, and run it live during an event: attendees scan to join and vote, and the presenter controls pacing from a projected screen. Success is a room voting together in real time with results everyone can see, without friction (no attendee accounts, no app).

## Positioning

The mechanism worth protecting is presenter-driven live pacing: the presenter's screen (`/present/[sessionId]`) controls which question is open and when results reveal, and every attendee device follows that state live over Supabase Realtime (`sessions.current_question_index`, `results_revealed`). This makes MC Genie a shared-room moment rather than an async survey tool (Google Forms, Typeform) — the room moves together, and nobody sees results before the presenter shows them. This is distinct from per-session branding and from the zero-friction QR join, which are real but secondary strengths.

## Operating Context

- **Presenter/projector:** `/present/[sessionId]`, full-screen, keyboard-clicker friendly (ArrowRight/PageDown advance). Shows a QR code lobby, then one question at a time, then results.
- **Attendee's phone:** `/vote/[slug]`, mobile-first, scanned from the QR code, anonymous voting via a browser-stored voter token.
- **Organizer dashboard:** `/dashboard`, authenticated via email/password (owner-only), for creating/editing sessions, questions, and per-session design (colors, fonts, logo).
- Two results modes exist: Live (a results page after each question) and After All Questions (one summary at the end) — both work in presenter-led and self-paced (no presenter) sessions.

## Capabilities and Constraints

- Anonymous, account-less voting: attendees never sign in; identity is a localStorage token, one vote per question per browser.
- Only the session owner can authenticate, present, and edit sessions; RLS enforces this at the database level.
- Real-time sync via Supabase Realtime with a polling fallback (venue Wi-Fi can drop websockets).
- Sessions can also run self-paced (no live presenter), where results modes still apply per-voter.
- Each session can be branded independently (primary color, background/foreground, card color, heading/body font, logo) without touching the app's own default look.
- Known open gap (from an earlier security review in this session, not yet built): the database does not yet enforce that a vote's session is active or that the question is the one currently open — validation is currently client-side only. Noting this so future work doesn't assume it's already enforced.

## Brand Commitments

The name "LivePolls" and its current default theme (charcoal/orange primary, Montserrat body font, Orbitron display font) are the app's own fixed brand identity, confirmed by the user — not open for casual redesign. Per-session theming is a deliberate feature that lets an organizer override this default for their own session; it does not change the app's own identity.

## Evidence on Hand

No real customer testimonials, case studies, or usage metrics exist yet. Two demo/seed sessions (`conf2024`, `team-q2`) exist in the database for internal testing only — not real evidence and not to be presented as such.

## Product Principles

1. The room moves together: no attendee should see results, or be able to vote, ahead of what the presenter has opened — live state is authoritative.
2. Joining is frictionless: scan, vote, done — no accounts, no app installs, no signup screens for attendees.
3. Presenters are always in control: pacing, reveal timing, and the two results modes are presenter/organizer decisions, not automatic.
4. A session can look like the event it belongs to (branding) without the app's own identity changing underneath it.
5. Anonymity is the default: voting is not traceable to a person, only to a disposable per-browser token.

## Accessibility & Inclusion

No specific accessibility standard was confirmed by the user; none is asserted here beyond what's already implemented (e.g. WCAG-style contrast warnings in the design editor). Flag this as unconfirmed rather than inventing a compliance target.
