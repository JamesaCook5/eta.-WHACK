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
const sweep = stats.stations.sweep
const at = (k: number) => sweep.find((r) => r.k === k)!
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
        A spectral class tells us roughly what kind of rock an asteroid is. For each of 26 base types we have a typical
        mineral make up. A C-type, for example, is mostly water-bearing clay with some magnetite, sulfides and olivine.
        Classes that sit between two types are treated as a blend of both.
      </p>
      <p>
        Each mineral yields a known share of each element. Magnetite is mostly iron and oxygen, clays carry water and
        olivine carries magnesium and silicon. Multiply through and you get kilograms of each element per tonne of rock.
      </p>
      <p>
        For the amount of rock we use the asteroid’s diameter and a typical density for its class. Anything wider than
        100 km is counted as if it were 100 km across. Nobody is going to mine all of Ceres, and the giants would
        otherwise swamp everything else.
      </p>
      <p>
        These are class averages, and most of them carry low or medium confidence. They are good for comparing regions
        and types of asteroid but not for predicting what is inside one particular rock. That uncertainty is what the{' '}
        <To slug="monte-carlo">Monte Carlo</To> chapter deals with.
      </p>
    </>
  )
}

function ProcessNetwork() {
  return (
    <>
      <p>
        To make anything you need a recipe, and recipes depend on other recipes. Our process network records them all:
        which raw materials go into each step, what comes out and what equipment it needs. Pick a product and we can walk
        backwards through the network to the asteroid ores it ultimately comes from.
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
        built on an asteroid. Sitting in the middle of its patch means none of its asteroids is too far away.
      </p>
      <p>
        Mining craft bring ore in from the surrounding asteroids, either as raw rock or roughly refined at the mine. The
        station runs the processes for its product: heating, separating, splitting water, reducing metal ore and on
        towards finished parts. Water from the ore becomes hydrogen and oxygen, which is the propellant the mining craft
        need for their next trip. What the station makes goes to another station, to a mission or into building the
        next station.
      </p>
      <p>
        On the map each station shows how far it is from the Sun, how many asteroids it serves, what share of the
        product’s raw material they hold and how hard a typical trip to one of them is.
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
  const one = at(1)
  const twelve = at(12)
  const fortyEight = at(48)
  const max = at(250)
  return (
    <>
      <p>
        For a trip in space what matters is how much the craft has to change its speed, not how far apart two points
        look on a map. So before placing anything we put every asteroid in a space where distance means that change in
        speed. Orbits of a similar size, shape and tilt end up close together. So do asteroids that sit near each other
        along the same orbit, as long as the craft has enough time to catch up.
      </p>
      <p>
        Then we use weighted k-means. Each station sits at the centre of the asteroids nearest to it, with the asteroids
        holding the most of the product’s ingredients pulling hardest. Every asteroid belongs to its nearest station.
      </p>
      <h3>Why more stations help</h3>
      <p>
        With a single station every asteroid that holds a semiconductor ingredient, all {fmt(one.perStation)} of them,
        ships to the same place, and a typical trip costs {fmt(one.dvMedian, 1)} km/s. Spread the work over more stations
        and each one gets a smaller, tighter patch.
      </p>
      <p>
        Fewer asteroids per station means a patch a station can actually work through. At {fmt(max.k)} stations each
        one serves about {fmt(max.perStation)} asteroids instead of tens of thousands.
      </p>
      <p>
        Shorter trips mean more throughput. A mining craft with a fixed engine spends less time on each round trip, so
        the same fleet brings in more ore every year and burns less propellant doing it. Going from one station to{' '}
        {fmt(max.k)} cuts a typical trip from {fmt(one.dvMedian, 1)} to {fmt(max.dvMedian, 1)} km/s, roughly{' '}
        {fmt(one.dvMedian / max.dvMedian, 0)} times as many trips for the same craft.
      </p>
      <p>
        The gains shrink as you go. Four times as many stations, from 12 to 48, only takes a typical trip from{' '}
        {fmt(twelve.dvMedian, 1)} to {fmt(fortyEight.dvMedian, 1)} km/s. Every station has to be built and supplied, so the
        right number is a trade off rather than as many as possible.
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
