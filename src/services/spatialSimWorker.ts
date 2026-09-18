import { runSpatialSimulation, type SpatialSimConfig } from './spatialCombatSimulator'
import type { Unit } from '../types'

export interface WorkerRequest {
  type: 'run'
  teamA: { unit: Unit; count: number }[]
  teamB: { unit: Unit; count: number }[]
  config: Partial<SpatialSimConfig>
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  if (e.data.type === 'run') {
    const result = runSpatialSimulation(e.data.teamA, e.data.teamB, e.data.config)
    self.postMessage({ type: 'result', result })
  }
}
