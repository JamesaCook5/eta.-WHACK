import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ChapterPage } from '@/components/methodology/chapter-page'
import { SECTIONS, findSection } from '@/lib/methodology/sections'

type Props = { params: Promise<{ section: string }> }

export const dynamicParams = false

export function generateStaticParams() {
  return SECTIONS.filter((s) => s.slug !== 'overview').map((s) => ({ section: s.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = findSection((await params).section)
  if (!found) return {}
  return { title: `${found.section.title} | Methodology | eta.`, description: found.section.summary }
}

export default async function MethodologyChapter({ params }: Props) {
  const { section } = await params
  if (section === 'overview' || !findSection(section)) notFound()
  return <ChapterPage slug={section} />
}
