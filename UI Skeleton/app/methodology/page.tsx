import type { Metadata } from 'next'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'
import { MethodologyContent } from '@/components/methodology/methodology-content'

export const metadata: Metadata = {
  title: 'Methodology — eta.',
  description: 'How eta. models asteroid resources, processing chains and station placement.',
}

export default function MethodologyPage() {
  return (
    <>
      <SiteHeader current="methodology" />
      <MethodologyContent />
      <SiteFooter />
    </>
  )
}
