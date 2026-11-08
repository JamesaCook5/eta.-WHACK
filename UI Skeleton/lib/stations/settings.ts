/** What the user picks in the Stations controls. */
export interface PlanSettings {
  /** Product id from the manufacturing DAG's catalogue. */
  productId: string
  stations: number
  /** Estimated one-way maneuver time under the planner's fixed-acceleration proxy. */
  reachHours: number
  /** Time allowed for a phasing drift to an asteroid along the orbit, years. */
  tripYears: number
}

export const DEFAULT_PLAN: PlanSettings = {
  productId: 'steel',
  stations: 3,
  reachHours: 24,
  tripYears: 2,
}

export const STATION_LIMITS = { min: 1, max: 6 }
export const TRIP_LIMITS = { min: 0.5, max: 10, step: 0.5 }
export const REACH_LIMITS = { min: 12, max: 96, step: 12 }
