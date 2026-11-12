import { createClient } from '@supabase/supabase-js'

export const drawingChannelName = (sessionId) => `drawing:${sessionId}`

// For the host's "Clear canvas" button: broadcasts a clear that the Drawer's canvas (and viewers) honour.
// Uses its own client: the SSR browser client is a singleton and would hand back (then remove) the
// channel of any canvas mounted on the same page, e.g. the presenter's.
export function sendCanvasClear(sessionId) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const ch = supabase.channel(drawingChannelName(sessionId))
  ch.subscribe((status) => {
    if (status !== 'SUBSCRIBED') return
    ch.send({ type: 'broadcast', event: 'clear', payload: {} }).finally(() => supabase.removeChannel(ch))
  })
}
