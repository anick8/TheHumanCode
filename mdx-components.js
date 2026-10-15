import Link from 'next/link'
import Callout from '@/app/help/components/Callout'
import ShortcutTable from '@/app/help/components/ShortcutTable'
import PresetSwatches from '@/app/help/components/PresetSwatches'

const components = {
  h1: (p) => <h1 className="font-display text-3xl font-bold text-foreground" {...p} />,
  h2: (p) => <h2 className="mt-10 font-display text-xl font-bold text-foreground" {...p} />,
  h3: (p) => <h3 className="mt-6 text-base font-semibold text-foreground" {...p} />,
  p: (p) => <p className="mt-4 leading-7 text-muted-foreground" {...p} />,
  ul: (p) => <ul className="mt-4 list-disc space-y-2 pl-6 text-muted-foreground marker:text-accent" {...p} />,
  ol: (p) => <ol className="mt-4 list-decimal space-y-2 pl-6 text-muted-foreground marker:text-accent" {...p} />,
  li: (p) => <li className="leading-7" {...p} />,
  strong: (p) => <strong className="font-semibold text-foreground" {...p} />,
  code: (p) => <code className="rounded bg-muted px-1.5 py-0.5 text-sm text-foreground" {...p} />,
  a: ({ href = '', ...rest }) =>
    href.startsWith('/') ? (
      <Link href={href} className="font-medium text-accent underline underline-offset-2 hover:text-foreground" {...rest} />
    ) : (
      <a href={href} className="font-medium text-accent underline underline-offset-2 hover:text-foreground" {...rest} />
    ),
  table: (p) => (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm" {...p} />
    </div>
  ),
  th: (p) => <th className="border-b border-border px-3 py-2 font-semibold text-foreground" {...p} />,
  td: (p) => <td className="border-b border-border px-3 py-2 text-muted-foreground" {...p} />,
  Callout,
  ShortcutTable,
  PresetSwatches,
}

export function useMDXComponents() {
  return components
}
