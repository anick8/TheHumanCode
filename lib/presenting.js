// Shared "start presenting" logic for the session detail page and the
// dashboard inspector, so both reset the lobby the same way.

// A run is in progress when the presenter has moved past the lobby but not
// beyond the last question.
export function isInProgress(session, questionCount) {
  const idx = session?.current_question_index
  return idx !== null && idx !== undefined && idx < questionCount
}

export function presentLabel(session, questionCount) {
  return isInProgress(session, questionCount) ? 'Resume' : 'Start'
}

// Start (or resume) a host-driven presentation. An unfinished run resumes
// where it left off; otherwise reset to the lobby (-1), which puts every
// attendee device on the "waiting for the host" screen. A wheel has no
// questions to step through, so it goes straight to the presenter.
//
// Returns { error } when the reset fails; the caller decides how to surface it.
export async function startPresentation(supabase, session, questionCount) {
  if (session.session_type === 'wheel') return { error: null }
  if (isInProgress(session, questionCount)) return { error: null }

  const { data, error } = await supabase
    .from('sessions')
    .update({ current_question_index: -1, results_revealed: false })
    .eq('id', session.id)
    .select('id')
  if (error || !data?.length) {
    return { error: error?.message || 'Could not start the presentation.' }
  }
  return { error: null }
}
