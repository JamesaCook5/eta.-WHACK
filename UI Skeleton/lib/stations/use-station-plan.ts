'use client'

import { useEffect, useRef, useState } from 'react'
import { planStations, type PlanMessage, type PlanParams, type PlanResult, type StationProblem } from './optimise'

/** idle → clustering (k-means) → sampling (Monte Carlo) → done. */
export type PlanStatus = 'idle' | 'clustering' | 'sampling' | 'done' | 'error'

export interface PlanState {
  status: PlanStatus
  /** Latest plan; the k-means result arrives first, then the same plan with ranges. */
  result: PlanResult | null
  /** Monte Carlo draws done so far. */
  progress: { done: number; total: number } | null
  /** The request the result belongs to. */
  key: string | null
  /** The problem the result was computed for (row order of result.assignment). */
  problem: StationProblem | null
  error: string | null
}

const DEBOUNCE_MS = 200

type WorkerMessage = { id: number } & (PlanMessage | { kind: 'error'; error: string })

/**
 * Runs the planner in a Web Worker whenever the problem or parameters change.
 * A new request replaces a running one (the worker is restarted). Falls back to
 * the main thread if workers are unavailable.
 */
export function useStationPlan(problem: StationProblem | null, params: PlanParams, key: string | null): PlanState {
  const [state, setState] = useState<PlanState>({
    status: 'idle',
    result: null,
    progress: null,
    key: null,
    problem: null,
    error: null,
  })
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

  const { stations, tripYears, draws } = params
  useEffect(() => {
    if (!problem || !key) {
      setState((s) => ({ ...s, status: 'idle', progress: null }))
      return
    }
    const id = ++requestRef.current
    setState((s) => ({ ...s, status: 'clustering', progress: null, error: null }))

    const receive = (m: PlanMessage | { kind: 'error'; error: string }) => {
      if (id !== requestRef.current) return
      if (m.kind === 'error') {
        busyRef.current = false
        setState({ status: 'error', result: null, progress: null, key, problem, error: m.error })
      } else if (m.kind === 'progress') {
        setState((s) => ({ ...s, progress: { done: m.done, total: m.total } }))
      } else if (m.kind === 'nominal') {
        setState({ status: 'sampling', result: m.result, progress: { done: 0, total: draws }, key, problem, error: null })
      } else {
        busyRef.current = false
        setState({ status: 'done', result: m.result, progress: null, key, problem, error: null })
      }
    }
    const runHere = () =>
      window.setTimeout(() => {
        try {
          planStations(problem, { stations, tripYears, draws }, receive)
        } catch (err) {
          receive({ kind: 'error', error: err instanceof Error ? err.message : String(err) })
        }
      }, 30)

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
        runHere()
        return
      }
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        if (event.data.id !== requestRef.current) return
        receive(event.data)
      }
      worker.onerror = (event) => {
        event.preventDefault()
        workerRef.current?.terminate()
        workerRef.current = null
        runHere()
      }
      busyRef.current = true
      worker.postMessage({ id, problem, params: { stations, tripYears, draws } })
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [problem, stations, tripYears, draws, key])

  return state
}
