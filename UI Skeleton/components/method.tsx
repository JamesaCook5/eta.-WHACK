const CARDS = [
  {
    title: 'Resource mapping',
    body: 'Each product in the manufacturing DAG lists the feedstocks it can draw on. Those map to elements (iron, titanium, phosphorus, water…), and each asteroid gets a grade for every element from its taxonomic class: mineral make-up from the chemical DAG times each mineral’s typical yield. X-type classes are split by albedo. Inputs with no asteroid route are listed as imported from Earth.',
    file: 'tools/build_product_supply_data.py → lib/stations/product-supply.ts',
  },
  {
    title: 'Placement',
    body: 'Weighted k-means over every filtered asteroid: each asteroid goes to its nearest station, with no distance limit and no sharing, and each station sits at the tonnage-weighted centre of its asteroids. Distance is the Δv to match an asteroid’s orbit (size, shape, tilt) plus the phasing Δv to catch up with it along the orbit within the trip time (≈ ⅔ × arc ÷ trip time). Weight is the tonnes of the product’s inputs in each body. Centaurs and Kuiper-belt objects are left out unless included, because k-means would give each a station.',
    file: 'lib/stations/optimise.ts',
  },
  {
    title: 'Output and ranges',
    body: 'A station yields what its asteroids contain, in that ratio: magnetite gives iron and oxygen together, so co-products are listed alongside the product’s inputs. Mineral make-ups are uncertain, so a Monte Carlo resamples every class’s mix 1000 times (wider for classes the lookup rates low-confidence) and re-runs k-means each time. Ranges are the 5th–95th percentiles; faint dots on the map show where each station landed.',
    file: 'lib/stations/optimise.ts',
  },
  {
    title: 'Not modelled yet',
    body: 'Extraction rates, transport schedules between stations, launch windows and propulsion limits. Asteroid positions are a snapshot, and the yields are tonnes held, not tonnes per year.',
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
        <p className="mt-4 max-w-2xl leading-relaxed text-white/80">
          Station placement runs on the DAGs and the asteroid data; cost and routing models are still to
          come. This is how the explorer currently works.
        </p>
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
