'use client'

import { usePathname } from 'next/navigation'
import { BlackHoleBackground } from './black-hole-background'
import { SpaceBackground } from './space-background'

/** One WebGL background at a time: the black hole on /methodology, the asteroid scene elsewhere. */
export function SiteBackground() {
  const pathname = usePathname()
  return pathname?.startsWith('/methodology') ? <BlackHoleBackground /> : <SpaceBackground />
}
