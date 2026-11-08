import Link from 'next/link'

const CARDS = [
  {
    title: 'Start with a product',
    body: 'Choose something to make. We work out which raw materials it needs and which asteroids are likely to hold them.',
  },
  {
    title: 'Place the stations',
    body: 'Stations go among the asteroids that hold the most of those materials, so trips between them stay short.',
  },
  {
    title: 'Allow for uncertainty',
    body: 'We only roughly know what each asteroid is made of, so we repeat the placement with different assumptions and show how much it changes.',
  },
  {
    title: 'Still to come',
    body: 'Mining rates, shipping costs and real trajectories are not modelled yet.',
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
          <p className="max-w-2xl leading-relaxed text-white">
            A short version of how the map works. Treat it as a first pass.
          </p>
          <Link href="/methodology" scroll={false} className="btn glass btn-glass shrink-0 gap-2 self-start sm:self-auto">
            Read the methodology <span aria-hidden="true">→</span>
          </Link>
        </div>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {CARDS.map((card) => (
            <li key={card.title} className="glass flex flex-col gap-3 rounded-md p-6 sm:p-8">
              <p className="font-display text-lg font-medium">{card.title}</p>
              <p className="leading-relaxed text-white">{card.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
