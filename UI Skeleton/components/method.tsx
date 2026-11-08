import Link from 'next/link'

const CARDS = [
  {
    title: 'Resource mapping',
    body: 'We start from the product. Each one in the manufacturing DAG lists the feedstocks it can use, and those break down into elements such as iron, titanium, phosphorus and water. Every asteroid then gets a grade for each element based on its class: the minerals the chemical DAG expects it to contain, multiplied by how much of that element each mineral typically gives up. X-types are split by albedo, and anything with no asteroid source is marked as imported from Earth.',
    file: 'asteroid_industry/product_supply.py',
  },
  {
    title: 'Placement',
    body: 'Stations are placed with weighted k-means over every filtered asteroid. Each asteroid goes to its nearest station, with no distance limit and no sharing, and each station sits at the tonnage-weighted centre of its asteroids. Distance is the cheapest way there: the Δv to match the asteroid’s orbit (size, shape and tilt), plus a phasing burn to catch up with it within the chosen trip time (roughly ⅔ × arc length ÷ trip time). Each asteroid is weighted by the tonnes of the product’s inputs it holds. Centaurs and Kuiper-belt objects are left out unless you include them, because k-means would give each one a station of its own.',
    file: 'asteroid_industry/stations.py',
  },
  {
    title: 'Output and ranges',
    body: 'A station yields what its asteroids contain, in that ratio: magnetite gives iron and oxygen together, so co-products are listed alongside the product’s inputs. Mineral make-ups are uncertain, so a Monte Carlo resamples every class’s mix 1000 times (more widely for classes the lookup rates as low confidence) and re-runs k-means each time. Ranges are the 5th to 95th percentiles, and faint dots on the map show where each station landed.',
    file: 'asteroid_industry/stations.py',
  },
  {
    title: 'Not modelled yet',
    body: 'Extraction rates, shipping between stations, launch windows and engine limits. Asteroid positions are a single snapshot, and yields are tonnes held, not tonnes per year.',
    file: null,
  },
]

export function Method() {
  return (
    <section id="method" aria-labelledby="method-title" className="px-4 py-24">
      <div className="mx-auto max-w-6xl">
        <h2 id="method-title" className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
          Method
        </h2>
        <div className="mt-4 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <p className="max-w-2xl leading-relaxed text-white/80">
            Station placement currently runs on the process DAGs and the asteroid catalogue. Costs and
            routing are not modelled yet, so treat this as a first pass. Here is how it works today.
          </p>
          <Link href="/methodology" scroll={false} className="btn glass btn-glass shrink-0 gap-2 self-start sm:self-auto">
            Full methodology <span aria-hidden="true">→</span>
          </Link>
        </div>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {CARDS.map((card) => (
            <li key={card.title} className="glass flex flex-col gap-3 rounded-md p-6 sm:p-8">
              <p className="font-display text-lg font-medium">{card.title}</p>
              <p className="leading-relaxed text-white/80">{card.body}</p>
              {card.file && (
                <p className="mt-auto pt-2 font-mono text-xs text-muted-foreground">{card.file}</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
