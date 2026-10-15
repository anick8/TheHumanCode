import Link from 'next/link'
import HelpSidebar from './components/HelpSidebar'
import { SUPPORT_EMAIL } from '@/lib/support'

export const metadata = {
  title: 'Help · MC Genie',
  description: 'Guides and reference for running polls, quizzes, comment walls, treasure hunts and wheels with MC Genie.',
}

export default function HelpLayout({ children }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/help" className="flex items-center gap-2.5">
            <img src="/mcgenie.png" alt="" className="h-8 w-8 rounded-lg object-cover" />
            <span className="font-display text-base font-bold tracking-wide">MC Genie</span>
            <span className="text-sm text-muted-foreground">Help</span>
          </Link>
          <Link href="/dashboard" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Back to dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:flex lg:gap-12">
        <HelpSidebar />
        <main className="min-w-0 flex-1 pb-16">{children}</main>
      </div>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-muted-foreground sm:px-6">
          Still stuck? Email{' '}
          <a className="font-medium text-accent underline underline-offset-2" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          . Taking part in someone else’s session? Ask the event organizer.
        </div>
      </footer>
    </div>
  )
}
