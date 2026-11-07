const PARAGRAPHS = [
  'In-situ resource utilisation (ISRU) means producing what a mission needs — propellant, water, oxygen, structural material — from resources found where the mission operates, rather than carrying all of it from Earth.',
  'Every kilogram launched from Earth has to climb out of a deep gravity well. Material sourced in space starts much higher up, so less propellant is spent moving it to where it is used.',
  'Asteroids hold the materials ISRU depends on. Carbonaceous bodies carry water and other volatiles that can be split into propellant. Metallic bodies contain iron and nickel. Stony bodies are rich in silicates usable for shielding and construction.',
  'Which asteroid is useful depends on what it is made of and how much energy it takes to reach it. eta. combines both to rank candidate locations for resource stations.',
]

export function About() {
  return (
    <section id="about" aria-labelledby="about-title" className="px-4 py-24">
      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-12">
        <div className="glass rounded-md p-8 sm:p-10 lg:col-span-7 lg:col-start-6">
          <h2 id="about-title" className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
            In-situ resource utilisation
          </h2>
          <div className="mt-6 flex flex-col gap-4 leading-relaxed text-white/80">
            {PARAGRAPHS.map((p) => (
              <p key={p.slice(0, 24)}>{p}</p>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
