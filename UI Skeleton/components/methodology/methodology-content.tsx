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
  {
    id: 'overview',
    title: 'Overview',
    placeholder: [],
    content: (
      <div className="flex flex-col gap-4 text-white/80 leading-relaxed">
        <p>
          Space exploration depends on materials that are costly to launch from Earth. Asteroids may hold useful
          resources, but knowing where resources are is only part of the problem: the materials needed for a product may
          be spread across many bodies. We explore which asteroids to mine and where to place stations that process
          their resources.
        </p>
        <p>
          The long-term idea is a self-sustaining space industry. A station could produce some of the propellant and
          metal needed to build another station, allowing a network of mines and processors to grow with less material
          shipped from Earth.
        </p>
      </div>
    ),
  },
  {
    id: 'data',
    title: 'Data sources',
    placeholder: [],
    content: (
      <div className="flex flex-col gap-4 text-white/80 leading-relaxed">
        <p>
          The asteroid catalogue contains about 65,000 objects from IMCCE’s SsODNet database. Records include orbital
          information, size estimates and a composition class.
        </p>
        <p>
          Composition estimates draw on meteorite research and the project’s mineral and process data. Public interest
          in asteroid resources is also growing: examples cited in the project notes include AstroForge’s work on
          metallic asteroids, TransAstra’s study of capturing a small near-Earth asteroid, and proposals to use space
          resources in future industry.
        </p>
      </div>
    ),
  },
  {
    id: 'resources',
    title: 'Resource model',
    placeholder: [],
    content: (
      <div className="flex flex-col gap-4 text-white/80 leading-relaxed">
        <p>
          The model maps an asteroid’s composition class to likely minerals, then maps those minerals to recoverable
          elements such as water, iron, nickel and aluminium. Their estimated grades and the asteroid’s size are used
          to estimate the material it may contain.
        </p>
        <p>
          Composition is uncertain. Asteroids in the same class use class-level averages, informed largely by remote
          observations and meteorite research. The estimates are therefore more useful for comparing groups, regions
          and asteroid types than for predicting the exact contents of an individual asteroid.
        </p>
      </div>
    ),
  },
  {
    id: 'processes',
    title: 'Process network',
    placeholder: [],
    content: (
      <div className="flex flex-col gap-4 text-white/80 leading-relaxed">
        <p>
          The manufacturing process network links ores to raw materials and then to products. A selected product
          identifies the inputs its production requires, while the network records how those inputs can be made.
        </p>
        <p>
          This makes it possible to ask whether asteroid-sourced materials could support a chain of production. In a
          bootstrapping scenario, one station produces some of the propellant and metal needed to build the next,
          helping a space-based industrial network expand over time.
        </p>
      </div>
    ),
  },
  {
    id: 'placement',
    title: 'Station placement',
    placeholder: [],
    content: (
      <div className="flex flex-col gap-4 text-white/80 leading-relaxed">
        <p>
          For a selected product, the planner groups useful asteroids into station service areas. Weighted k-means
          places each station near the weighted centre of the asteroids assigned to it, so bodies with more of the
          product’s required materials have more influence on the station’s location.
        </p>
        <p>
          The placement objective considers transport cost and whether ore is refined at the mine or shipped as raw
          material. This is a planning approximation: the catalogue positions are a snapshot, and distance is used as
          a stand-in for the effort of reaching and servicing an asteroid.
        </p>
      </div>
    ),
  },
  {
    id: 'validation',
    title: 'Validation',
    placeholder: [],
    content: (
      <div className="flex flex-col gap-4 text-white/80 leading-relaxed">
        <p>
          Mineral make-up varies within asteroid classes, so the planner uses Monte Carlo sampling to explore that
          uncertainty. It samples plausible class compositions and reruns station placement across many trials.
        </p>
        <p>
          The resulting station ranges summarize the 5th to 95th percentiles of those runs. They show how much the
          suggested locations can vary under the composition assumptions; they are not guarantees about the actual
          contents of particular asteroids.
        </p>
      </div>
    ),
  },
  {
    id: 'limits',
    title: 'Limitations and next steps',
    placeholder: [],
    content: (
      <div className="flex flex-col gap-4 text-white/80 leading-relaxed">
        <p>
          The current model is an initial planning tool. Its asteroid sample can be expanded, the process network can
          be made more detailed, and class-level composition estimates can be improved as better observations become
          available.
        </p>
        <p>
          Asteroid positions are represented by a snapshot, so the current placement does not model orbital transfer
          windows. Distance is only a proxy for fuel or travel effort. More realistic planning would add orbital
          mechanics, delta-v estimates, real mission data and spacecraft engine limits.
        </p>
        <p>
          Extraction rates, station throughput and shipping between stations are also not yet modelled. The resource
          estimates describe tonnes that may be present, not tonnes that can be mined or processed per year.
        </p>
      </div>
    ),
  },
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
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link href="/#map" className="btn btn-primary">Back to the map</Link>
          <a href="#overview" className="btn glass btn-glass">Start reading</a>
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
