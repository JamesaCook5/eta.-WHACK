/// Runs the station planner off the main thread, posting the k-means result
/// first and the Monte Carlo ranges when the draws finish.
import { planStations, type PlanParams, type StationProblem } from './optimise'

interface Request {
  id: number
  problem: StationProblem
  params: PlanParams
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null
  postMessage: (message: unknown) => void
}

scope.onmessage = (event) => {
  const { id, problem, params } = event.data
  try {
    planStations(problem, params, (message) => scope.postMessage({ id, ...message }))
  } catch (err) {
    scope.postMessage({ id, kind: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}
