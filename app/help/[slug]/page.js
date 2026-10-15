import Link from 'next/link'
import { notFound } from 'next/navigation'
import { HELP_ARTICLES, getArticle, getNeighbours } from '@/lib/helpNav'

export const dynamicParams = false

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }))
}

export async function generateMetadata({ params }) {
  const { slug } = await params
  const article = getArticle(slug)
  if (!article) return {}
  return { title: `${article.title} · MC Genie Help`, description: article.summary }
}

export default async function HelpArticle({ params }) {
  const { slug } = await params
  const article = getArticle(slug)
  if (!article) notFound()

  const { default: Content } = await import(`@/content/help/${slug}.mdx`)
  const { prev, next } = getNeighbours(slug)

  return (
    <article className="max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{article.section}</p>
      <div className="mt-2">
        <Content />
      </div>
      <nav aria-label="Article navigation" className="mt-12 flex justify-between gap-4 border-t border-border pt-6 text-sm">
        {prev ? (
          <Link href={`/help/${prev.slug}`} className="text-muted-foreground hover:text-foreground">
            ← {prev.title}
          </Link>
        ) : <span />}
        {next ? (
          <Link href={`/help/${next.slug}`} className="text-right text-muted-foreground hover:text-foreground">
            {next.title} →
          </Link>
        ) : <span />}
      </nav>
    </article>
  )
}
