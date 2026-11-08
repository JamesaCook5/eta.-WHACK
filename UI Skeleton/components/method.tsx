const CARDS = [
  {
    title: 'Resource mapping',
    body: 'Each product in the manufacturing DAG lists the feedstocks it can draw on. Those map to elements (iron, titanium, phosphorus, water…), and each asteroid gets a grade for every element from its taxonomic class: mineral make-up from the chemical DAG times each mineral’s typical yield. X-type classes are split by albedo. Inputs with no asteroid route are listed as imported from Earth.',
    file: 'tools/build_product_supply_data.py → lib/stations/product-supply.ts',
  },
  {
    title: 'Placement',
    body: 'Each station has an orbit and a position along it. The cost of reaching an asteroid is the cheapest way there: the Δv to match its orbit’s size, shape and tilt, plus a phasing manoeuvre to catch up with it along the orbit within the chosen trip time (≈ ⅔ × arc length ÷ trip time). Reach converts that Δv to thrust time at a fixed 0.01 m/s². The optimizer scores supply inside that reach, refines station orbits and positions with gradients, and tries relocations. Asteroid positions are a snapshot; launch windows and propulsion limits are not modelled.',
    file: 'lib/stations/optimise.ts',
  },
  {
    title: 'Output',
    body: 'A station’s output is limited by its scarcest input: for each input it receives a share of the filtered supply, and output follows the smallest share. Supply grows with body size up to 100 km. The DAG gives no quantities yet, so every input counts equally and there is no cost figure.',
    file: 'lib/stations/optimise.ts',
  },
  {
    title: 'Networks',
    body: 'Stations making the same product split any asteroid they both reach, so the optimiser spreads them apart rather than stacking them on the richest spot. Stations for different products, and transport between stations, are not modelled yet.',
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
