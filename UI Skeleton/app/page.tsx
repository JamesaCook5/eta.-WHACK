import { SiteHeader } from '@/components/site-header'
import { Hero } from '@/components/hero'
import { About } from '@/components/about'
import { MapSection } from '@/components/map/map-section'
import { Method } from '@/components/method'
import { SiteFooter } from '@/components/site-footer'

export default function Page() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <About />
        <MapSection />
        <Method />
      </main>
      <SiteFooter />
    </>
  )
}
