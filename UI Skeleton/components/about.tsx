import { cn } from '@/lib/utils'

type Card = {
  label: string
  tag?: string
  body: string
  className: string
}

// Bento layout on a 6-column grid (lg). The section has one heading, in the
// first card; the other cards carry short labels rather than headings.
const CARDS: Card[] = [
  {
    label: 'Launch cost',
    body: 'Reaching low Earth orbit alone takes roughly 9–10 km/s of Δv. Material sourced in space starts outside that gravity well, so far less propellant is spent moving it to where it is used.',
    className: 'lg:col-span-2',
  },
  {
    label: 'Water and volatiles',
    tag: 'Carbon',
    body: 'Carbonaceous asteroids contain hydrated minerals. Extracted water can be drunk, used as radiation shielding, or split into hydrogen and oxygen for propellant.',
    className: 'lg:col-span-2',
  },
  {
    label: 'Metals',
    tag: 'Metallic',
    body: 'M-type asteroids are thought to be rich in iron–nickel metal: a candidate feedstock for structures built in space. Featureless X-types with moderate albedo are counted as possibly metallic.',
    className: 'lg:col-span-2',
  },
  {
    label: 'Silicates',
    tag: 'Silicates',
    body: 'Stony asteroids are dominated by silicate minerals such as olivine and pyroxene, usable as bulk material for shielding and construction.',
    className: 'lg:col-span-2',
  },
]

export function About() {
  return (
    <section id="about" aria-labelledby="about-title" className="px-4 py-24">
      <ul className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <li className="glass flex flex-col rounded-md p-8 sm:col-span-2 sm:p-10 lg:col-span-4">
          <h2 id="about-title" className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
            In-situ resource utilisation
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/80">
            ISRU means producing what a mission needs (propellant, water, oxygen, building material)
            from resources found where it operates, instead of carrying all of it from Earth.
          </p>
        </li>

        {CARDS.map((card) => (
          <li key={card.label} className={cn('glass flex flex-col gap-3 rounded-md p-6 sm:p-8', card.className)}>
            <div className="flex items-baseline justify-between gap-4">
              <p className="font-display text-lg font-medium">{card.label}</p>
              {card.tag && <p className="font-mono text-xs text-signal">{card.tag}</p>}
            </div>
            <p className="leading-relaxed text-white/75">{card.body}</p>
          </li>
        ))}

        <li className="glass flex flex-col gap-6 rounded-md p-6 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between sm:p-8 lg:col-span-6">
          <div className="flex max-w-2xl flex-col gap-3">
            <p className="font-display text-lg font-medium">Choosing a site</p>
            <p className="leading-relaxed text-white/75">
              A station is only worth building where the asteroid holds the right material and
              manufacturing there is affordable. eta. combines composition with where the asteroid
              sits to rank candidate station sites.
            </p>
          </div>
          <a href="#map" className="btn btn-primary self-start sm:self-center">
            Explore the map
          </a>
        </li>
      </ul>
    </section>
  )
}
