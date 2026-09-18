import { runOptimizer } from './buildOrderOptimizer'
import type { WorkerInboundMessage } from '../types'

let stopRequested = false

self.onmessage = (e: MessageEvent<WorkerInboundMessage>) => {
  if (e.data.type === 'stop') {
    stopRequested = true
    return
  }
  if (e.data.type === 'start') {
    stopRequested = false
    console.log('[optimizer-worker] start: units=', e.data.units.length, 'faction=', e.data.config.faction)
    try {
      runOptimizer(
        e.data.config,
        e.data.units,
        (msg) => self.postMessage(msg),
        () => stopRequested,
        (result) => {
          console.log('[optimizer-worker] done: genes=', result.bestChromosome.genes.length, 'gens=', result.totalGenerations)
          self.postMessage(result)
        },
      )
    } catch (err) {
      console.error('[optimizer-worker] CRASH:', err)
      self.postMessage({ type: 'error', message: String(err) })
    }
  }
}

self.onerror = (err) => {
  console.error('[optimizer-worker] onerror:', err)
}
