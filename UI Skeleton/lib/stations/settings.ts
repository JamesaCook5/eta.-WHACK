/** What the user picks in the Stations controls. */
export interface PlanSettings {
  /** Product id from the manufacturing DAG's catalogue. */
  productId: string
  stations: number
  /** Reach λ in km/s. */
  reachKmS: number
}

export const DEFAULT_PLAN: PlanSettings = {
  productId: 'steel',
  stations: 3,
  reachKmS: 1,
}

export const STATION_LIMITS = { min: 1, max: 6 }
export const REACH_LIMITS = { min: 0.5, max: 3, step: 0.25 }
