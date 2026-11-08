/// Runs the station optimiser off the main thread.
import { optimiseStations, type PlanParams, type StationProblem } from './optimise'

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
    scope.postMessage({ id, result: optimiseStations(problem, params) })
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
