'use client'

import { useCallback, useEffect, useState } from 'react'
import { PlannerUnavailableError, requestPlan, type PlanRequest, type PlanResult } from './api'

/** idle → clustering (nominal k-means) → sampling (Monte Carlo) → done. */
export type PlanStatus = 'idle' | 'clustering' | 'sampling' | 'done' | 'error'

export interface PlanState {
  status: PlanStatus
  /** Latest plan; the nominal k-means arrives first, then the same plan with ranges. */
  result: PlanResult | null
  /** Monte Carlo draws requested for the result still running. */
  draws: number
  /** The request (without draws) the result belongs to. */
  key: string | null
  error: string | null
  /** True when the Python planner could not be reached at all. */
  offline: boolean
  /** Send the current request again (after starting the planner, say). */
  retry: () => void
}

const DEBOUNCE_MS = 200

/**
 * Asks the Python planner for a plan whenever the request changes: first with
 * no draws (k-means only, fast), then with the Monte Carlo. A newer request
 * aborts the older one's fetches.
 */
export function useStationPlan(request: Omit<PlanRequest, 'draws'> | null, draws: number): PlanState {
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const [state, setState] = useState<Omit<PlanState, 'retry'>>({
    status: 'idle',
    result: null,
    draws,
    key: null,
    error: null,
    offline: false,
  })
  const key = request ? JSON.stringify(request) : null

  useEffect(() => {
    if (!request || !key) {
      setState((s) => ({ ...s, status: 'idle' }))
      return
    }
    const abort = new AbortController()
    setState((s) => ({ ...s, status: 'clustering', error: null }))
    const timer = window.setTimeout(async () => {
      try {
        const nominal = await requestPlan({ ...request, draws: 0 }, abort.signal)
        if (abort.signal.aborted) return
        const sampling = draws > 0 && nominal.stations.length > 0
        setState({ status: sampling ? 'sampling' : 'done', result: nominal, draws, key, error: null, offline: false })
        if (!sampling) return
        const full = await requestPlan({ ...request, draws }, abort.signal)
        if (abort.signal.aborted) return
        setState({ status: 'done', result: full, draws, key, error: null, offline: false })
      } catch (err) {
        if (abort.signal.aborted) return
        setState((s) => ({
          status: 'error',
          // Keep a nominal plan for this request if the Monte Carlo alone failed.
          result: s.key === key ? s.result : null,
          draws,
          key,
          error: err instanceof Error ? err.message : String(err),
          offline: err instanceof PlannerUnavailableError,
        }))
      }
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      abort.abort()
    }
    // `key` stands for `request`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, draws, attempt])

  return { ...state, retry }
}
