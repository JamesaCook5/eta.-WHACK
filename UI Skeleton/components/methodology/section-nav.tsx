'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { SECTIONS, sectionHref } from '@/lib/methodology/sections'
import { cn } from '@/lib/utils'

/** Chapter list: a sticky rail on desktop, scrolling chips on mobile. Each entry is its own page. */
export function SectionNav() {
  const pathname = usePathname()
  const first = useRef(true)

  // Links use scroll={false} (Next's own scroll fights the site's smooth scrolling).
  // Arriving from elsewhere starts at the top; switching chapter brings the chapter into view.
  useEffect(() => {
    if (first.current) {
      first.current = false
      if (!window.location.hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
      return
    }
    const chapter = document.getElementById('chapter')
    if (!chapter) return
    const top = chapter.getBoundingClientRect().top + window.scrollY - 96
    if (window.scrollY > top) window.scrollTo({ top, left: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])

  // Keep the active chip visible in the mobile strip.
  useEffect(() => {
    document.querySelector('[data-chapter-active="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [pathname])

  return (
    <aside aria-label="Chapters" className="min-w-0 lg:sticky lg:top-28 lg:self-start">
      <ol className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0 lg:pb-0">
        {SECTIONS.map((section) => {
          const href = sectionHref(section.slug)
          const isActive = pathname === href
          return (
            <li key={section.slug} className="shrink-0">
              <Link
                href={href}
                scroll={false}
                aria-current={isActive ? 'page' : undefined}
                data-chapter-active={isActive}
                className={cn(
                  'block rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors lg:rounded-none lg:border-l lg:py-1.5 lg:pl-4',
                  'border border-white/10 lg:border-y-0 lg:border-r-0',
                  isActive ? 'bg-white/[0.06] text-white lg:border-white lg:bg-transparent' : 'text-white hover:opacity-70 lg:border-white/10',
                )}
              >
                {section.title}
              </Link>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}
