import Link from 'next/link'
import HelpSearch from './components/HelpSearch'
import { HELP_SECTIONS } from '@/lib/helpNav'

export default function HelpHome() {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">How can we help?</h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
        Guides and reference for every feature in MC Genie. New here? Start with{' '}
        <Link href="/help/what-is-mc-genie" className="font-medium text-accent underline underline-offset-2">
          What is MC Genie?
        </Link>
        .
      </p>
      <div className="mt-6 max-w-2xl">
        <HelpSearch />
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {HELP_SECTIONS.map((section) => (
          <section key={section.title} className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-display text-base font-bold">{section.title}</h2>
            <ul className="mt-3 space-y-1.5">
              {section.articles.map((a) => (
                <li key={a.slug}>
                  <Link href={`/help/${a.slug}`} className="text-sm text-muted-foreground hover:text-foreground">
                    {a.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
