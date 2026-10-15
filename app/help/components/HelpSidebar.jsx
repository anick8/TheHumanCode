'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { HELP_SECTIONS } from '@/lib/helpNav'

export default function HelpSidebar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <div className="lg:w-60 lg:shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="help-nav"
        className="mb-4 flex w-full items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground lg:hidden"
      >
        Browse articles
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      <nav
        id="help-nav"
        aria-label="Help articles"
        className={`${open ? 'block' : 'hidden'} lg:sticky lg:top-6 lg:block lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto`}
      >
        {HELP_SECTIONS.map((section) => (
          <div key={section.title} className="mb-5">
            <p className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section.title}</p>
            <ul className="mt-1.5">
              {section.articles.map((a) => {
                const href = `/help/${a.slug}`
                const active = pathname === href
                return (
                  <li key={a.slug}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => setOpen(false)}
                      className={`block rounded-lg px-3 py-1.5 text-sm transition-colors ${
                        active ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {a.title}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  )
}
