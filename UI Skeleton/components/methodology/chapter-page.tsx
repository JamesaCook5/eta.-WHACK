import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SECTIONS, findSection, sectionHref } from '@/lib/methodology/sections'
import { CHAPTERS } from './chapters'

export function ChapterPage({ slug }: { slug: string }) {
  const found = findSection(slug)
  const Chapter = CHAPTERS[slug]
  if (!found || !Chapter) notFound()
  const { index, section } = found
  const prev = SECTIONS[index - 1]
  const next = SECTIONS[index + 1]

  return (
    <article aria-labelledby="chapter-title">
      <div className="glass rounded-md px-6 py-8 sm:px-12 sm:py-12">
        <h2 id="chapter-title" className="font-[family-name:var(--font-serif)] text-3xl tracking-tight sm:text-4xl">
          {section.title}
        </h2>
        <div className="chapter mt-6 max-w-[42rem]">
          <Chapter />
        </div>
      </div>

      <nav aria-label="Chapters" className="mt-6 flex items-center justify-between gap-4 text-sm">
        {prev ? (
          <Link href={sectionHref(prev.slug)} scroll={false} className="text-white transition-opacity hover:opacity-70">
            ← {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={sectionHref(next.slug)} scroll={false} className="text-right text-white transition-opacity hover:opacity-70">
            {next.title} →
          </Link>
        ) : (
          <Link href="/#map" className="btn btn-primary">
            Open the map
          </Link>
        )}
      </nav>
    </article>
  )
}
