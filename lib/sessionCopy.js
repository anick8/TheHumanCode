// Session-type-specific vocabulary. A poll's participant votes, a quiz's
// participant answers, a comments session's participant comments. Keep every
// participant-facing and organizer-facing string derived from here instead of
// hardcoding "vote"/"poll" so quiz screens stop borrowing poll language.
const COPY = {
  poll: {
    typeLabel: 'Voting poll',
    verb: 'vote',
    verbGerund: 'voting',
    verbPast: 'voted',
    noun: 'vote',
    nounPlural: 'votes',
    loadingTitle: 'Loading poll...',
    loadingSubtitle: 'Please wait while we prepare your voting experience.',
    notFoundTitle: 'Poll Not Found',
    resultsTitle: 'Poll Results',
    instructionsTitle: 'Voting Instructions',
    submittedMessage: 'Vote recorded. The next question will appear when the host moves on.',
    closedMessage: 'Voting is closed for this question. The next one will appear when the host moves on.',
    anonymousNote: 'Your vote is anonymous and cannot be changed after submission',
    joinCta: 'Join and vote',
    urlLabel: 'Voting URL',
    lockedLabel: 'Locked after the first vote',
  },
  quiz: {
    typeLabel: 'Quiz',
    verb: 'answer',
    verbGerund: 'answering',
    verbPast: 'answered',
    noun: 'answer',
    nounPlural: 'answers',
    loadingTitle: 'Loading quiz...',
    loadingSubtitle: 'Please wait while we prepare your quiz.',
    notFoundTitle: 'Quiz Not Found',
    resultsTitle: 'Quiz Results',
    instructionsTitle: 'Quiz Instructions',
    submittedMessage: 'Answer locked. Results appear when the host reveals them.',
    closedMessage: 'This question is locked. The next one will appear when the host moves on.',
    anonymousNote: 'Your answer is recorded under your name/ID and cannot be changed after submission',
    joinCta: 'Join and answer',
    urlLabel: 'Quiz URL',
    lockedLabel: 'Locked after the first answer',
  },
  comments: {
    typeLabel: 'Image & comments',
    verb: 'comment',
    verbGerund: 'commenting',
    verbPast: 'commented',
    noun: 'comment',
    nounPlural: 'comments',
    loadingTitle: 'Loading session...',
    loadingSubtitle: 'Please wait while we prepare the session.',
    notFoundTitle: 'Session Not Found',
    resultsTitle: 'Comments',
    instructionsTitle: 'Instructions',
    submittedMessage: 'Comment recorded. The next image will appear when the host moves on.',
    closedMessage: 'Commenting is closed for this image. The next one will appear when the host moves on.',
    anonymousNote: 'Your comment is recorded under your name/ID and cannot be changed after submission',
    joinCta: 'Join and comment',
    urlLabel: 'Session URL',
    lockedLabel: 'Locked after the first comment',
  },
}

export function copyFor(sessionType) {
  return COPY[sessionType] || COPY.poll
}
