import type { ReactNode } from 'react'
import { Source_Serif_4 } from 'next/font/google'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'
import { SectionNav } from '@/components/methodology/section-nav'

// A reading face for the long-form chapters.
const serif = Source_Serif_4({ subsets: ['latin'], variable: '--font-serif', display: 'swap', style: ['normal', 'italic'] })

export default function MethodologyLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader current="methodology" />
      <main className={`${serif.variable} px-4 pb-24`}>
        <section aria-labelledby="methodology-title" className="mx-auto max-w-5xl pt-20 pb-10 sm:pt-28">
          <h1 id="methodology-title" className="font-[family-name:var(--font-serif)] text-5xl tracking-tight sm:text-6xl">
            Methodology
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-white">
            How we go from a list of asteroids to a plan for where to mine and where to put the stations.
          </p>
        </section>

        <div id="chapter" className="mx-auto grid max-w-5xl scroll-mt-24 gap-10 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <SectionNav />
          <div className="min-w-0">{children}</div>
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
