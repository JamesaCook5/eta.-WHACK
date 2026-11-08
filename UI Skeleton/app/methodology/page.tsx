import type { Metadata } from 'next'
import { ChapterPage } from '@/components/methodology/chapter-page'

export const metadata: Metadata = {
  title: 'Methodology | eta.',
  description: 'How eta. models asteroid resources, processing chains and station placement.',
}

export default function MethodologyPage() {
  return <ChapterPage slug="overview" />
}
