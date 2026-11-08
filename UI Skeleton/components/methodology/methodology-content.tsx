'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Block = 'text' | 'figure' | 'equation' | 'table'

interface Section {
  id: string
  title: string
  /** Replace the placeholder blocks by giving a section real content. */
  content?: ReactNode
  /** Placeholder layout shown until content is written. */
  placeholder: Block[]
}

// Edit titles and add `content` to fill the page in. Order = table of contents.
const SECTIONS: Section[] = [
  { id: 'overview', title: 'Overview', placeholder: ['text', 'text'] },
  { id: 'data', title: 'Data sources', placeholder: ['text', 'table'] },
  { id: 'resources', title: 'Resource model', placeholder: ['text', 'equation', 'text'] },
  { id: 'processes', title: 'Process network', placeholder: ['text', 'figure'] },
  { id: 'placement', title: 'Station placement', placeholder: ['text', 'equation', 'figure'] },
  { id: 'validation', title: 'Validation', placeholder: ['text', 'table'] },
  { id: 'limits', title: 'Limitations and next steps', placeholder: ['text'] },
]

const LINE_WIDTHS = ['w-full', 'w-11/12', 'w-full', 'w-10/12', 'w-9/12']

function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('block h-2.5 animate-pulse rounded-full bg-white/[0.07]', className)} />
}

function Placeholder({ block, index }: { block: Block; index: number }) {
  if (block === 'text') {
    return (
      <div className="flex flex-col gap-3">
        {LINE_WIDTHS.slice(0, 3 + (index % 3)).map((w, i) => (
          <Skeleton key={i} className={w} />
        ))}
      </div>
    )
  }
  if (block === 'equation') {
    return (
      <div className="flex items-center justify-center gap-3 rounded-md border border-white/8 bg-black/25 px-6 py-7">
        <span className="font-mono text-sm text-white/30">( )</span>
        <Skeleton className="w-40" />
        <span className="font-mono text-sm text-white/30">=</span>
        <Skeleton className="w-24" />
      </div>
    )
  }
  if (block === 'table') {
    return (
      <div className="overflow-hidden rounded-md border border-white/8">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className={cn('grid grid-cols-3 gap-4 px-4 py-3', row === 0 ? 'bg-white/[0.04]' : 'border-t border-white/6')}>
            {[0, 1, 2].map((col) => (
              <Skeleton key={col} className={row === 0 ? 'w-2/3 bg-white/[0.12]' : col === 0 ? 'w-3/4' : 'w-1/2'} />
            ))}
          </div>
        ))}
      </div>
    )
  }
  return (
    <figure className="flex aspect-[16/7] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-white/15 bg-black/20">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 text-white/30" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 16l5-5 4 4 3-3 6 6" />
      </svg>
      <figcaption className="font-mono text-[11px] text-white/35">Figure</figcaption>
    </figure>
  )
}

export function MethodologyContent() {
  const [active, setActive] = useState(SECTIONS[0].id)

  // Links here use scroll={false} (Next's own scroll fights the site's smooth
  // scrolling), so start at the top unless the URL targets a section.
  useEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
  }, [])

  // Highlight the section being read.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-25% 0px -60% 0px' },
    )
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  return (
    <main className="px-4 pb-24">
      {/* Hero */}
      <section aria-labelledby="methodology-title" className="mx-auto max-w-6xl pt-24 pb-16 sm:pt-32">
        <nav aria-label="Breadcrumb" className="font-mono text-xs text-muted-foreground">
          <Link href="/" className="hover:text-white">eta.</Link>
          <span className="px-2 text-white/25">/</span>
          <span className="text-white/80">Methodology</span>
        </nav>
        <h1 id="methodology-title" className="mt-6 font-display text-5xl font-medium tracking-tight sm:text-7xl">
          Methodology
        </h1>
        <div className="mt-8 flex max-w-xl flex-col gap-3">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-10/12" />
          <Skeleton className="h-3 w-7/12" />
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link href="/#map" className="btn btn-primary">Back to the map</Link>
          <a href="#overview" className="btn glass btn-glass">Start reading</a>
          <span className="ml-1 inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 font-mono text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-amber-300/80" aria-hidden="true" />
            Draft
          </span>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[13rem_minmax(0,1fr)]">
        {/* Contents: sticky rail on desktop, scrolling chips on mobile */}
        <aside aria-label="Contents" className="min-w-0 lg:sticky lg:top-28 lg:self-start">
          <p className="hidden text-[10px] font-medium tracking-wider text-muted-foreground uppercase lg:block">Contents</p>
          <ol className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 lg:mx-0 lg:mt-4 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0">
            {SECTIONS.map((section, i) => {
              const isActive = active === section.id
              return (
                <li key={section.id} className="shrink-0">
                  <a
                    href={`#${section.id}`}
                    aria-current={isActive ? 'true' : undefined}
                    className={cn(
                      'group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                      'border border-white/10 lg:border-0 lg:border-l-2 lg:rounded-none lg:rounded-r-md',
                      isActive ? 'bg-white/[0.06] text-white lg:border-signal' : 'text-muted-foreground hover:text-white lg:border-transparent',
                    )}
                  >
                    <span className={cn('font-mono text-[11px] tabular-nums', isActive ? 'text-signal' : 'text-white/35')}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="whitespace-nowrap">{section.title}</span>
                  </a>
                </li>
              )
            })}
          </ol>
        </aside>

        {/* Sections */}
        <div className="flex min-w-0 flex-col gap-6">
          {SECTIONS.map((section, i) => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="glass scroll-mt-28 rounded-md p-6 sm:p-10">
              <div className="flex items-baseline gap-4">
                <span className="font-mono text-sm text-signal tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                <h2 id={`${section.id}-title`} className="font-display text-2xl font-medium tracking-tight sm:text-3xl">
                  {section.title}
                </h2>
              </div>
              <div className="mt-8 flex flex-col gap-8">
                {section.content ?? section.placeholder.map((block, j) => <Placeholder key={j} block={block} index={i + j} />)}
              </div>
            </section>
          ))}

          <div className="flex flex-col items-start justify-between gap-4 rounded-md border border-white/10 p-6 sm:flex-row sm:items-center sm:p-8">
            <p className="text-white/80">Seen enough theory? The explorer puts it to work.</p>
            <Link href="/#map" className="btn btn-primary">Open the map</Link>
          </div>
        </div>
      </div>
    </main>
  )
}
