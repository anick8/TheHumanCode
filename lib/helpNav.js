// Single source of truth for the Help Center. The sidebar, search, static
// params, prev/next links and scripts/check-help-links.mjs all read this.
// Each article is content/help/<slug>.mdx.
export const HELP_SECTIONS = [
  {
    title: 'Getting started',
    articles: [
      { slug: 'what-is-mc-genie', title: 'What is MC Genie?', summary: 'What the app does and who it is for.', keywords: 'overview intro organizer participant qr session' },
      { slug: 'create-your-first-session', title: 'Create your first session', summary: 'Title, URL, session type and the basic settings.', keywords: 'new create slug url type active title' },
      { slug: 'run-it-live', title: 'Run it live', summary: 'Share the QR code and present to the room.', keywords: 'present qr code share launch start lobby' },
    ],
  },
  {
    title: 'Session types',
    articles: [
      { slug: 'poll', title: 'Poll', summary: 'Anonymous voting with aggregate results.', keywords: 'vote voting anonymous results chart' },
      { slug: 'quiz', title: 'Quiz', summary: 'Scored questions, time limits, leaderboards and round-by-round.', keywords: 'lock reveal time limit score leaderboard tiebreak classic round recap board' },
      { slug: 'comments', title: 'Image & comments', summary: 'Participants comment on images you upload.', keywords: 'comments images wall upload' },
      { slug: 'treasure-hunt', title: 'Treasure Hunt', summary: 'Hide printed QR clues, with optional choices.', keywords: 'clue clues choice qr print label scavenger' },
      { slug: 'wheel-of-fortune', title: 'Wheel of Fortune', summary: 'Random draws from joined participants and manual entries.', keywords: 'spin pick entries raffle join limit reset draw' },
    ],
  },
  {
    title: 'Building',
    articles: [
      { slug: 'question-editor', title: 'Question editor', summary: 'Add and edit questions, options and images.', keywords: 'questions options correct answer images order' },
      { slug: 'ai-assistant', title: 'AI assistant', summary: 'Draft questions with AI, then apply what you like.', keywords: 'ai assistant generate draft propose create with ai allowance' },
      { slug: 'session-settings', title: 'Session settings', summary: 'Results mode, identity, locks and clearing responses.', keywords: 'settings results mode live after all identity name id clear responses lock' },
    ],
  },
  {
    title: 'Presenting',
    articles: [
      { slug: 'presenter-mode', title: 'Presenter mode & shortcuts', summary: 'The full-screen presenter and its keyboard shortcuts.', keywords: 'present fullscreen keyboard shortcuts next reveal instagram' },
      { slug: 'managing-the-room', title: 'Managing the room', summary: 'Close entries, join limit and removing participants.', keywords: 'close entries join limit remove participant kick room' },
    ],
  },
  {
    title: 'Design',
    articles: [
      { slug: 'design-your-session', title: 'Design your session', summary: 'Presets, colours, fonts and your logo.', keywords: 'design theme preset fine-tune colors fonts logo brand contrast preview' },
    ],
  },
  {
    title: 'Results',
    articles: [
      { slug: 'results-and-export', title: 'Results & export', summary: 'Read results and export JSON or CSV.', keywords: 'results export csv json share scores participants spins' },
    ],
  },
  {
    title: 'Account',
    articles: [
      { slug: 'account-and-access', title: 'Account, plan & access', summary: 'Profile, access status, AI allowance and what happens when access ends.', keywords: 'account profile instagram plan grant access expired lapsed pending ai allowance password' },
    ],
  },
  {
    title: 'For participants',
    articles: [
      { slug: 'joining-a-session', title: 'Joining a session', summary: 'Scan the QR code and join, no account needed.', keywords: 'join scan qr code name id participant phone entries closed full' },
      { slug: 'playing', title: 'Playing along', summary: 'Voting, answering, commenting, the wheel and treasure hunts.', keywords: 'vote answer lock comment wheel clue participant play' },
    ],
  },
  {
    title: 'Help',
    articles: [
      { slug: 'faq', title: 'FAQ & troubleshooting', summary: 'Common questions and fixes.', keywords: 'faq troubleshooting problem fix not working support contact' },
    ],
  },
]

export const HELP_ARTICLES = HELP_SECTIONS.flatMap((section) =>
  section.articles.map((article) => ({ ...article, section: section.title })),
)

export function getArticle(slug) {
  return HELP_ARTICLES.find((a) => a.slug === slug) || null
}

export function getNeighbours(slug) {
  const i = HELP_ARTICLES.findIndex((a) => a.slug === slug)
  if (i === -1) return { prev: null, next: null }
  return { prev: HELP_ARTICLES[i - 1] || null, next: HELP_ARTICLES[i + 1] || null }
}
