import { Wordmark } from './wordmark'

export function Hero() {
  return (
    <section id="top" aria-labelledby="hero-title" className="-mt-18 px-4">
      <div className="mx-auto flex min-h-[92svh] max-w-6xl flex-col justify-end pt-32 pb-24">
        <h1 id="hero-title" className="text-7xl leading-none sm:text-9xl">
          <Wordmark />
        </h1>
        <p className="mt-8 max-w-xl text-lg leading-relaxed text-white sm:text-xl">
          eta. finds asteroids where resource stations could supply deep-space missions with water,
          metals and silicates mined in place, instead of launched from Earth.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <a href="#map" className="btn btn-primary">
            Explore the map
          </a>
          <a href="#about" className="btn glass btn-glass">
            About ISRU
          </a>
        </div>
      </div>
    </section>
  )
}
