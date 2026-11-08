import { cn } from '@/lib/utils'

type Card = {
  label: string
  body: string
  className: string
}

// Bento layout on a 6-column grid (lg). The section has one heading, in the
// first card; the other cards carry short labels rather than headings.
// Each use appears in one card only.
const CARDS: Card[] = [
  {
    label: 'Launch cost',
    body: 'Just getting into low Earth orbit takes around 9–10 km/s of Δv, before the journey has properly started. Material that is already out in space skips that climb, so far less propellant goes into moving it to where it is needed.',
    className: 'lg:col-span-2',
  },
  {
    label: 'Water and volatiles',
    body: 'Dark, carbon-rich asteroids hold water locked inside their clay minerals. Bake it out and you have water for crews to drink, and, split into hydrogen and oxygen, both air to breathe and rocket propellant.',
    className: 'lg:col-span-2',
  },
  {
    label: 'Metals',
    body: 'M-type asteroids look to be made largely of iron–nickel metal: the raw stock for beams, pressure tanks and printed spare parts. Some featureless X-types may be metallic too, so we count them as possible candidates when their brightness fits.',
    className: 'lg:col-span-2',
  },
  {
    label: 'Silicates',
    body: 'Stony asteroids are mostly rock: silicate minerals like olivine and pyroxene. Piled around a habitat it blocks radiation. Melted down it gives glass and fibre, and refined further it yields silicon for solar cells.',
    className: 'lg:col-span-2',
  },
  {
    label: 'Carbon and organics',
    body: 'Carbonaceous asteroids carry a few percent of carbon-rich organic matter. That is the starting point for plastics and polymers. It also supplies the carbon that turns asteroid iron into steel.',
    className: 'lg:col-span-2',
  },
  {
    label: 'Platinum-group metals',
    body: 'Metal-rich asteroids hold platinum, palladium and their relatives at parts per million. Tiny amounts go a long way as catalysts and electrical contacts, and they are among the few materials valuable enough to send back to Earth.',
    className: 'lg:col-span-2',
  },
  {
    label: 'Sulfur and phosphorus',
    body: 'Sulfide and phosphate minerals are easy to overlook. Sulfur makes the acids used to pull metals out of ore and phosphorus is fertiliser for growing food far from home.',
    className: 'lg:col-span-2',
  },
]

export function About() {
  return (
    <section id="about" aria-labelledby="about-title" className="px-4 pt-24 pb-44">
      <ul className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <li className="glass flex flex-col rounded-md p-8 sm:col-span-2 sm:p-10 lg:col-span-4">
          <h2 id="about-title" className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
            In-situ resource utilisation
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white">
            Every kilogram launched from Earth is expensive. ISRU is the idea of making what a mission
            needs (propellant, water, oxygen, building material) from what is already out there,
            rather than hauling all of it up from the ground.
          </p>
        </li>

        {CARDS.map((card) => (
          <li key={card.label} className={cn('glass flex flex-col gap-3 rounded-md p-6 sm:p-8', card.className)}>
            <p className="font-display text-lg font-medium">{card.label}</p>
            <p className="leading-relaxed text-white">{card.body}</p>
          </li>
        ))}

        <li className="glass flex flex-col gap-6 rounded-md p-6 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between sm:p-8 lg:col-span-6">
          <div className="flex max-w-2xl flex-col gap-3">
            <p className="font-display text-lg font-medium">Choosing a site</p>
            <p className="leading-relaxed text-white">
              A station only makes sense where the asteroids nearby have the right material and
              building there saves more than it costs. eta. weighs what each asteroid is made of
              against where it sits, and ranks the best places to put one.
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
