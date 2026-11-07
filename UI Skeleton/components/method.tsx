const CARDS = [
  {
    title: 'Resource mapping',
    body: 'Each taxonomic class is mapped to the resource it is likely to contain. The current mapping is a placeholder grouping by spectral complex and carries no yield estimates.',
    file: 'lib/mission/resources.ts',
  },
  {
    title: 'Transfer cost',
    body: 'Δv and transfer time are estimated with a Hohmann transfer between circular orbits plus a plane change. Eccentricity, phasing and launch windows are not yet modelled.',
    file: 'lib/mission/scoring.ts',
  },
  {
    title: 'Ranking',
    body: 'Asteroids that pass the filters, match the target resource and fit the Δv budget and mission duration are ranked by the share of the budget they leave unused.',
    file: 'lib/mission/rank.ts',
  },
  {
    title: 'Routing',
    body: 'Multi-stop routes between stations are not implemented. Candidates are scored independently from the starting body.',
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
