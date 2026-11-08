import Link from 'next/link'

const CARDS = [
  {
    title: 'Resource mapping',
    body: 'We start from the product. Each one in the manufacturing DAG lists the feedstocks it can use, and those break down into elements such as iron, titanium, phosphorus and water. Every asteroid then gets a grade for each element based on its class: the minerals the chemical DAG expects it to contain, multiplied by how much of that element each mineral typically gives up. X-types are split by albedo, and anything with no asteroid source is marked as imported from Earth.',
    file: 'tools/build_product_supply_data.py → lib/stations/product-supply.ts',
  },
  {
    title: 'Placement',
    body: 'Each station sits on an orbit, at a particular point along it. To judge how hard an asteroid is to reach, we take the cheapest option: the Δv needed to match its orbit’s size, shape and tilt, plus a phasing burn to catch up with it within the chosen trip time (roughly ⅔ × arc length ÷ trip time). That Δv becomes thrust time at a steady 0.01 m/s², which sets the station’s reach. The optimiser then scores the supply inside that reach, nudges orbits and positions with gradients, and tries moving stations elsewhere. Asteroid positions are a single snapshot, and launch windows and engine limits are not modelled.',
    file: 'lib/stations/optimise.ts',
  },
  {
    title: 'Output',
    body: 'A station can only make as much as its scarcest input allows. Each input gets a share of the available supply, and output follows whichever share is smallest. Supply grows with asteroid size up to 100 km. The DAG has no quantities yet, so every input counts equally and there is no cost figure.',
    file: 'lib/stations/optimise.ts',
  },
  {
    title: 'Networks',
    body: 'When two stations make the same product, they split any asteroid both can reach, so the optimiser spreads them out rather than piling them onto the richest spot. Stations making different products, and shipping between stations, are not modelled yet.',
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
