import Link from 'next/link'
import type { ReactNode } from 'react'
import stats from '@/public/images/methodology/stats.json'
import { sectionHref } from '@/lib/methodology/sections'
import { Picture } from './blocks'
import { ChainDiagram } from './chain-diagram'
import { ZoomImage } from './zoom-image'

// Chapter text. Keep it short and plain: no Oxford commas, no em dashes.

const fmt = (n: number, digits = 0) => n.toLocaleString('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits })

const net = stats.network
const mc = stats.monteCarlo
const maxDriftLon = Math.max(...mc.drift.map((d) => d.lonDeg))
const maxDriftA = Math.max(...mc.drift.map((d) => d.aPct))
const pct = (v: number) => `${fmt(v * 100, 0)}%`

function To({ slug, children }: { slug: string; children: ReactNode }) {
  return (
    <Link href={sectionHref(slug)} scroll={false} className="text-signal underline-offset-4 hover:underline">
      {children}
    </Link>
  )
}

function Overview() {
  return (
    <>
      <p>
        Everything a mission uses in space has to be launched from Earth, and launching is expensive. Asteroids hold
        water, metals and the raw material for much more. Knowing where those resources are is only half the problem
        though. The materials for one product are usually spread across many different asteroids.
      </p>
      <p>
        eta. tries to answer a practical question. If you wanted to make a particular thing in space, which asteroids
        would you mine and where would you put the stations that process what you mine?
      </p>
      <p>
        We start from 65,128 real asteroids. For each one we estimate what it is made of. We trace a chosen product back
        through the steps needed to make it, find the asteroids that hold its ingredients and place stations among them.
        Then we run the whole thing a thousand more times with different guesses about composition to see how much the
        answer depends on those guesses.
      </p>
      <p>
        The long term idea is an industry that grows itself. One station makes some of the propellant and metal needed
        to build the next, so less and less has to come up from Earth.
      </p>
    </>
  )
}

function Data() {
  return (
    <>
      <p>
        We started from IMCCE’s ssoBFT catalogue: 1,563,708 asteroids and 266 columns of measurements.
      </p>
      <Picture src="/images/methodology/parquet.png" alt="The original ssoBFT catalogue" />
      <h3>What we need from it</h3>
      <p>
        The goal is to make useful things in space from what asteroids contain. Take semiconductors: they need silicon,
        aluminium, oxygen, nitrogen and hydrogen, which can come from water. Steel needs iron and carbon. Solar panels
        need silicon, magnesium and aluminium.
      </p>
      <p>
        So for every asteroid we want one thing: how much of each useful element it holds. Then for any product we can
        find the asteroids that hold its ingredients and decide where to process them.
      </p>
      <h3>Cleaning it</h3>
      <p>
        Three columns let us estimate those elements. The spectral class tells us which minerals, and so which elements,
        an asteroid probably contains. The diameter tells us how much rock there is. The albedo separates classes that
        look alike. Only 65,128 asteroids have all three, so those are the ones we kept. We moved them to the same date
        along their orbits and dropped the columns we don’t use.
      </p>
      <h3>Every asteroid, eventually</h3>
      <p>
        Most known asteroids have never had their spectral class measured. As new surveys fill that gap, the same
        pipeline takes them in, with the aim of covering all 1.5 million.
      </p>
    </>
  )
}

function Resources() {
  return (
    <>
      <p>
        An asteroid’s taxonomy class comes from the colour of the sunlight it reflects. Different minerals absorb
        different colours, so the class tells us roughly what kind of rock it is. Dark C-types are rich in carbon and
        water-bearing clay. S-types are stony silicates. Some X-types are mostly metal.
      </p>
      <p>
        Meteorites let us check this. Many meteorites have been matched to the asteroid class they came from, and their
        minerals have been measured in the lab. So for each of 26 base classes we can reasonably estimate a typical
        mineral make up. A C-type, for example, is mostly water-bearing clay with some magnetite, sulfides and olivine.
      </p>
      <p>
        Each mineral yields a known share of each element. Magnetite is mostly iron and oxygen, clays carry water and
        olivine carries magnesium and silicon. Multiply through by the size of the asteroid and you get an estimate of
        how much of each element it holds.
      </p>
      <p>
        These are class averages, so they are good for comparing regions and types of asteroid rather than predicting
        what is inside one particular rock. That uncertainty is what the <To slug="monte-carlo">Monte Carlo</To> chapter
        deals with.
      </p>
    </>
  )
}

function ProcessNetwork() {
  return (
    <>
      <p>
        To make anything you need a recipe, and recipes depend on other recipes. Our process network records them all:
        which raw materials go into each step, what comes out and what equipment it needs. Products range from aluminium
        and steel for spacecraft to semiconductors and solar panels. Pick one and we can walk backwards through the
        network to the asteroid ores it ultimately comes from.
      </p>
      <h3>A small piece of it</h3>
      <p>
        Here are the first two levels for one ore, olivine, exactly as they appear in the network. Each node is a
        material and each arrow is a process. The dotted lines are where it keeps going.
      </p>
      <Picture alt="A simple process chain">
        <div className="rounded-md bg-black/25 px-5 py-8">
          <ChainDiagram />
        </div>
      </Picture>
      <h3>All of it</h3>
      <p>
        Now zoom out. This is the whole network, with asteroid ore on the left and finished products on the right.
      </p>
      <figure className="my-8">
        <div className="overflow-hidden rounded-md bg-[#04060a] p-2 sm:p-4">
          <ZoomImage src="/images/methodology/process-network-full.svg" alt="The whole process network" />
        </div>
      </figure>
      <p>
        The deepest products sit {fmt(net.layers)} steps away from raw rock. Most of that length isn’t exotic chemistry.
        It is checking materials before the next step will accept them, building the equipment the processes run on and
        the long tail of parts that something like a semiconductor or a robot needs. {fmt(net.earthInputs)} inputs still
        have to come from Earth, and shrinking that number is the whole point of building industry out there.
      </p>
    </>
  )
}

function Stations() {
  return (
    <>
      <p>
        A station is a processing plant floating in space, parked in an orbit among the asteroids it serves. It isn’t
        built on an asteroid. Instead it sits at the best point in its patch, pulled towards where the ore it needs is
        most abundant, so the richest asteroids are the closest.
      </p>
      <p>
        Mining craft bring ore in from the surrounding asteroids, either as raw rock or roughly refined at the mine. The
        station runs the processes for its product: heating, separating, splitting water, reducing metal ore and on
        towards finished parts. Water from the ore becomes hydrogen and oxygen, which is the propellant the mining craft
        need for their next trip. What the station makes goes to another station, to a mission or into building the
        next station.
      </p>
      <p>
        On the map each mining station shows how many asteroids it is connected to and how far it is from the Sun.
      </p>
      <p>
        For now the planner only says where stations should go and what they could draw on. It doesn’t yet size the
        plant, cap how fast it can work or schedule the trips. More on that under{' '}
        <To slug="limits">limitations</To>.
      </p>
    </>
  )
}

function Placement() {
  return (
    <>
      <p>
        For a trip in space, distance on a picture is a poor guide to fuel. Our planner embeds orbital elements in a
        five-dimensional proxy: orbit size, shape, tilt and a phase term that depends on the allowed trip time. Similar
        orbits and asteroids that are easier to catch along an orbit sit close together in this proxy. It estimates
        relative transfer difficulty; it is not a time-dependent Lambert transfer or an exact Δv calculation.
      </p>
      <p>
        We use weighted k-means with several weighted k-means++ starts. Each source belongs to its nearest station in
        the proxy, and the station moves to the weighted mean of its assigned sources. This minimizes squared weighted
        distance in the proxy, not actual mission Δv. The center is then converted to a candidate orbit for a free-flying
        station. Since phase and orbit size are coupled for a real orbit, that conversion is also an approximation to the
        constrained optimum.
      </p>
      <h3>Why more stations help</h3>
      <p>
        With a single station every asteroid ships to the same place. Spread the work over more stations and each one
        gets a smaller, tighter patch with shorter trips, so the same fleet of mining craft can bring in more ore. The
        gains shrink as you add more, and every station has to be built and supplied, so the right number is a trade off.
      </p>
    </>
  )
}

function MonteCarlo() {
  const top = mc.shares[0]
  return (
    <>
      <p>
        We only roughly know what each type of asteroid is made of. So we run the placement 1,000 times, each time with
        a different but believable mineral mix, and see how much the stations move.
      </p>
      <p>
        Types we know well vary a little between runs and poorly known ones vary a lot. Every asteroid of a type shares
        the same draw, because if C-types are wetter than we think, they all are. We report the range covering 90% of
        runs.
      </p>
      <Picture src="/images/methodology/monte-carlo.png" alt="Monte Carlo run for semiconductors with six stations" />
      <Picture src="/images/methodology/monte-carlo-cloud.png" alt="Where each station lands in every run" />
      <p>
        The stations hardly move. In 95% of runs they stay within {fmt(maxDriftLon, 1)}° along their orbits and{' '}
        {fmt(maxDriftA, 1)}% in distance from the Sun, and the biggest holds {pct(top.lo)} to {pct(top.hi)} of the
        material. Where the
        stations go depends mostly on where the asteroids are, not exactly what is in them.
      </p>
      <Picture src="/images/methodology/monte-carlo-1.png" alt="Monte Carlo figure 1" />
      <Picture src="/images/methodology/monte-carlo-2.png" alt="Monte Carlo figure 2" />
    </>
  )
}

function Limits() {
  return (
    <>
      <h3>One product at a time</h3>
      <p>
        Right now you plan stations for a single product, say semiconductors. Real stations would serve several, and
        products share ingredients. Semiconductors and lubricants both need hydrogen, for example. The next step is to
        let you pick semiconductors or lubricants or both. The planner would combine everything they need into one
        weighting and move the stations automatically whenever the choice changes.
      </p>
      <h3>More asteroids</h3>
      <p>
        We use the 65,128 asteroids that have a spectral class today. As surveys classify more of them the same pipeline
        will take them in, and the goal is every known asteroid.
      </p>
      <h3>Orbits and travel</h3>
      <p>
        Positions are a snapshot of one moment, so the planner doesn’t yet look at launch windows or plan real
        trajectories. Our distance is a stand-in for the effort of a trip. Proper orbital mechanics, engine limits and
        real mission data would make it much more realistic.
      </p>
      <h3>Rates</h3>
      <p>
        We estimate how much material is there, not how fast it can be mined or processed. Mining rates, station
        capacity and shipping between stations are still to come.
      </p>
    </>
  )
}

export const CHAPTERS: Record<string, () => ReactNode> = {
  overview: Overview,
  data: Data,
  resources: Resources,
  'process-network': ProcessNetwork,
  stations: Stations,
  placement: Placement,
  'monte-carlo': MonteCarlo,
  limits: Limits,
}
