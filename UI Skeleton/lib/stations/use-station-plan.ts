'use client'

import { useEffect, useRef, useState } from 'react'
import { optimiseStations, type PlanParams, type PlanResult, type StationProblem } from './optimise'

export type PlanStatus = 'idle' | 'running' | 'done' | 'error'

export interface PlanState {
  status: PlanStatus
  /** Last finished plan; kept on screen while a new one runs. */
  result: PlanResult | null
  /** The request the result belongs to. */
  key: string | null
  error: string | null
}

const DEBOUNCE_MS = 200

/**
 * Runs the optimiser in a Web Worker whenever the problem or parameters change.
 * A new request replaces a running one (the worker is restarted). Falls back to
 * the main thread if workers are unavailable.
 */
export function useStationPlan(problem: StationProblem | null, params: PlanParams, key: string | null): PlanState {
  const [state, setState] = useState<PlanState>({ status: 'idle', result: null, key: null, error: null })
  const workerRef = useRef<Worker | null>(null)
  const busyRef = useRef(false)
  const requestRef = useRef(0)

  useEffect(
    () => () => {
      workerRef.current?.terminate()
      workerRef.current = null
    },
    [],
  )

  const { stations, reachHours, tripYears } = params
  useEffect(() => {
    if (!problem || !key) {
      setState((s) => ({ ...s, status: 'idle' }))
      return
    }
    const id = ++requestRef.current
    setState((s) => ({ ...s, status: 'running', error: null }))

    const finish = (result: PlanResult | null, error: string | null) => {
      if (id !== requestRef.current) return
      busyRef.current = false
      setState(
        error
          ? { status: 'error', result: null, key, error }
          : { status: 'done', result, key, error: null },
      )
    }

    const timer = window.setTimeout(() => {
      let worker = workerRef.current
      // A worker can't be interrupted, so replace one that is still busy with an old request.
      if (worker && busyRef.current) {
        worker.terminate()
        worker = null
      }
      if (!worker) {
        try {
          worker = new Worker(new URL('./optimise.worker.ts', import.meta.url), { type: 'module' })
        } catch {
          worker = null
        }
        workerRef.current = worker
      }
      if (!worker) {
        // No worker support: run here, after the "running" state has painted.
        window.setTimeout(() => {
          try {
            finish(optimiseStations(problem, { stations, reachHours, tripYears }), null)
          } catch (err) {
            finish(null, err instanceof Error ? err.message : String(err))
          }
        }, 30)
        return
      }
      worker.onmessage = (event: MessageEvent<{ id: number; result?: PlanResult; error?: string }>) => {
        if (event.data.id !== requestRef.current) return
        finish(event.data.result ?? null, event.data.error ?? null)
      }
      worker.onerror = (event) => {
        event.preventDefault()
        workerRef.current?.terminate()
        workerRef.current = null
        // Retry on the main thread.
        try {
            finish(optimiseStations(problem, { stations, reachHours, tripYears }), null)
        } catch (err) {
          finish(null, err instanceof Error ? err.message : String(err))
        }
      }
      busyRef.current = true
      worker.postMessage({ id, problem, params: { stations, reachHours, tripYears } })
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [problem, stations, reachHours, tripYears, key])

  return state
}
