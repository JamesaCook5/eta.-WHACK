/** What the user picks in the Stations controls. */
export interface PlanSettings {
  /** Product id from the manufacturing DAG's catalogue. */
  productId: string
  /** k in k-means. */
  stations: number
  /** Time allowed for a phasing drift to an asteroid along the orbit, years. */
  tripYears: number
  /** Include Centaurs and Kuiper-belt objects (far outliers that each pull a station to themselves). */
  includeOuter: boolean
  hierarchical: boolean
}

export const DEFAULT_PLAN: PlanSettings = {
  productId: 'steel',
  stations: 3,
  tripYears: 2,
  includeOuter: false,
  hierarchical: true,
}

/** k in k-means; the Python planner allows up to 250 (assignment is one byte per asteroid). */
export const STATION_LIMITS = { min: 1, max: 250 }
/** Quick picks for the station count. */
export const STATION_PRESETS = [3, 10, 25, 50, 100, 200] as const
export const TRIP_LIMITS = { min: 0.5, max: 10, step: 0.5 }
/** Monte Carlo draws over class compositions. */
export const MONTE_CARLO_DRAWS = 1000
/** Thrust used to turn Δv into a time, m/s² (continuous low thrust). */
export const ASSUMED_ACCELERATION_M_S2 = 0.01
