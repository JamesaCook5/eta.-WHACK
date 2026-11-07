const CARDS = [
  {
    title: 'Resource mapping',
    body: 'Each asteroid is placed in a composition category: Carbon supplies water and volatiles, Metallic supplies metals, Silicates supply bulk silicate. Classes that could be more than one (featureless X-types, and labels such as CX or SQ) are split by each asteroid’s albedo. No yield estimates are used yet.',
    file: 'lib/mission/resources.ts',
  },
  {
    title: 'Placement',
    body: 'Where a station goes is set with the map filters: orbital region, semi-major axis, inclination and size. Launch and transfer from Earth are out of scope.',
    file: 'lib/asteroids/regions.ts',
  },
  {
    title: 'Manufacturing cost',
    body: 'Until the cost model exists, candidates are ranked on two proxies: body size as a stand-in for available feedstock, and sunlight at the orbit (falling as 1/a²) as a stand-in for processing power. The slider sets the balance.',
    file: 'lib/mission/scoring.ts',
  },
  {
    title: 'Networks',
    body: 'Stations are scored one at a time. How several stations would share material between them is not modelled yet.',
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
          The scoring and routing models are placeholders while the algorithms are designed. This is
          how the explorer currently works.
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
