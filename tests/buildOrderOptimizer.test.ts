import { describe, it, expect } from 'vitest'
import {
  buildPrerequisiteMap,
  repairChromosome,
  computeFitnessBreakdown,
  singlePointCrossover,
  applyOneMutation,
} from '../src/services/buildOrderOptimizer'
import {
  buildUnitIndex,
  buildBuilderCapabilities,
  simulateBuildOrder,
  getDefaultSimConfig,
  isReclaimGene,
  getReclaimTargetId,
  makeReclaimGene,
  RECLAIM_PREFIX,
  RECLAIM_EFFICIENCY,
  BASE_T1_MEX_RATE,
} from '../src/services/economySimulator'
import { defaultFitnessWeights } from '../src/types'
import type { Unit, SimResult, SimSnapshot, FitnessWeights } from '../src/types'

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'testunit',
    name: 'Test Unit',
    faction: 'Armada',
    tier: 'T1',
    unitType: 'Bot',
    metalCost: 100,
    energyCost: 1000,
    buildTime: 2000,
    health: 1000,
    weapons: [],
    movementMode: 'Walking',
    speed: 50,
    sightRange: 500,
    ...overrides,
  } as Unit
}

/** Minimal commander for tests */
const mockCommander = makeUnit({
  id: 'armcom',
  name: 'Commander',
  unitType: 'Commander',
  isCommander: true,
  buildPower: 300,
  metalCost: 0,
  energyCost: 0,
  buildTime: 0,
  canBuild: ['testsolar', 'testmex', 'testfactory'],
})

const mockSolar = makeUnit({
  id: 'testsolar',
  name: 'Solar',
  unitType: 'Building',
  metalCost: 150,
  energyCost: 0,
  buildTime: 3000,
  health: 100,
  energyProduction: 20,
  speed: 0,
  movementMode: 'Static',
})

const mockMex = makeUnit({
  id: 'testmex',
  name: 'Metal Extractor',
  unitType: 'Building',
  metalCost: 50,
  energyCost: 0,
  buildTime: 1500,
  health: 100,
  metalProduction: 1.8,
  speed: 0,
  movementMode: 'Static',
})

const mockFactory = makeUnit({
  id: 'testfactory',
  name: 'Bot Lab',
  unitType: 'Building',
  metalCost: 700,
  energyCost: 2000,
  buildTime: 7000,
  health: 2000,
  buildPower: 100,
  speed: 0,
  movementMode: 'Static',
  canBuild: ['testbot'],
})

const mockBot = makeUnit({
  id: 'testbot',
  name: 'Test Bot',
  unitType: 'Bot',
  metalCost: 80,
  energyCost: 800,
  buildTime: 2400,
  health: 500,
  speed: 60,
  weapons: [{ id: 'w', name: 'Gun', damage: 10, reload: 1, range: 200, projectileType: 'Laser' as const, dps: 10 }],
})

const allMockUnits = [mockCommander, mockSolar, mockMex, mockFactory, mockBot]

function buildTestInfra(units: Unit[] = allMockUnits) {
  const unitIndex = buildUnitIndex(units)
  const builderMap = buildPrerequisiteMap(units, ['armcom'])
  const builderCapabilities = buildBuilderCapabilities(builderMap)
  return { unitIndex, builderMap, builderCapabilities }
}

// ── defaultFitnessWeights ────────────────────────────────────────────────────

describe('defaultFitnessWeights', () => {
  it('returns expected default values', () => {
    const fw = defaultFitnessWeights()
    expect(fw.ecoBonus).toBe(0.01)
    expect(fw.throughputBonus).toBe(0.00005)
    expect(fw.bankingThreshold).toBe(0.85)
    expect(fw.bankingPenaltyMax).toBe(0.25)
    expect(fw.energyCoverageThreshold).toBe(0.2)
    expect(fw.energyCoverageBonus).toBe(0.15)
    expect(fw.energyDeficitThreshold).toBe(0.05)
    expect(fw.energyDeficitPenaltyMax).toBe(0.8)
    expect(fw.metalWasteMultiplier).toBe(0.7)
    expect(fw.metalWasteMax).toBe(0.35)
    expect(fw.energyWasteMultiplier).toBe(0.3)
    expect(fw.energyWasteMax).toBe(0.15)
    expect(fw.stallMultiplier).toBe(1.0)
    expect(fw.stallMax).toBe(1.5)
    expect(fw.windStoragePenaltyMax).toBe(0.15)
    expect(fw.windBufferTime).toBe(15)
    expect(fw.continuousOvercap).toBe(1.5)
    expect(fw.binaryPartialCredit).toBe(0.1)
  })

  it('returns all 18 weight fields', () => {
    const fw = defaultFitnessWeights()
    expect(Object.keys(fw).length).toBe(18)
  })
})

// ── buildPrerequisiteMap ─────────────────────────────────────────────────────

describe('buildPrerequisiteMap', () => {
  it('maps units to their builders based on canBuild', () => {
    const { builderMap } = buildTestInfra()
    // testsolar is buildable by armcom
    expect(builderMap.get('testsolar')).toContain('armcom')
    // testbot is buildable by testfactory
    expect(builderMap.get('testbot')).toContain('testfactory')
    // testbot is NOT directly buildable by armcom
    expect(builderMap.get('testbot')).not.toContain('armcom')
  })

  it('every unit has an entry in the map', () => {
    const { builderMap } = buildTestInfra()
    for (const unit of allMockUnits) {
      expect(builderMap.has(unit.id)).toBe(true)
    }
  })
})

// ── repairChromosome ─────────────────────────────────────────────────────────

describe('repairChromosome', () => {
  it('preserves valid gene order', () => {
    const { builderMap, unitIndex } = buildTestInfra()
    const genes = ['testsolar', 'testmex', 'testfactory', 'testbot']
    const repaired = repairChromosome(genes, builderMap, ['armcom'], unitIndex)
    expect(repaired).toEqual(genes)
  })

  it('reorders genes when prerequisites are out of order', () => {
    const { builderMap, unitIndex } = buildTestInfra()
    // testbot needs testfactory, but testbot comes first
    const genes = ['testbot', 'testfactory', 'testsolar']
    const repaired = repairChromosome(genes, builderMap, ['armcom'], unitIndex)
    // testfactory must come before testbot
    const factoryIdx = repaired.indexOf('testfactory')
    const botIdx = repaired.indexOf('testbot')
    expect(factoryIdx).toBeLessThan(botIdx)
  })

  it('drops irrecoverable genes', () => {
    const { builderMap, unitIndex } = buildTestInfra()
    // 'nonexistent' has no builder
    const genes = ['testsolar', 'nonexistent']
    const repaired = repairChromosome(genes, builderMap, ['armcom'], unitIndex)
    expect(repaired).toContain('testsolar')
    expect(repaired).not.toContain('nonexistent')
  })

  it('handles reclaim genes correctly', () => {
    const { builderMap, unitIndex } = buildTestInfra()
    const genes = ['testsolar', makeReclaimGene('testsolar')]
    const repaired = repairChromosome(genes, builderMap, ['armcom'], unitIndex)
    expect(repaired.length).toBe(2)
    expect(repaired[0]).toBe('testsolar')
    expect(isReclaimGene(repaired[1])).toBe(true)
  })

  it('drops reclaim gene if nothing built to reclaim', () => {
    const { builderMap, unitIndex } = buildTestInfra()
    // Try to reclaim testsolar without ever building it
    const genes = [makeReclaimGene('testsolar')]
    const repaired = repairChromosome(genes, builderMap, ['armcom'], unitIndex)
    expect(repaired.length).toBe(0)
  })
})

// ── Fitness scoring ──────────────────────────────────────────────────────────

describe('computeFitnessBreakdown', () => {
  function makeSnapshot(overrides: Partial<SimSnapshot> = {}): SimSnapshot {
    return {
      timeSeconds: 60,
      metalIncome: 5,
      energyIncome: 30,
      totalMetalSpent: 500,
      totalEnergySpent: 3000,
      armyMetalSpent: 0,
      currentArmyMetal: 0,
      currentArmyDps: 0,
      currentArmyHealth: 0,
      currentArmyGroundDps: 0,
      completedCount: 0,
      aliveUnitCounts: {},
      currentMetal: 100,
      currentEnergy: 500,
      metalCap: 1000,
      energyCap: 1000,
      totalMetalWasted: 0,
      totalEnergyWasted: 0,
      buildPowerPotential: 1000,
      buildPowerWasted: 0,
      totalBuildPower: 300,
      windGeneratorCount: 0,
      totalConverterMetalOutput: 0,
      ...overrides,
    }
  }

  function makeResult(snapshots: SimSnapshot[], completedUnitIds: string[] = []): SimResult {
    return {
      snapshots,
      completedUnitIds,
      buildTimeline: [],
      builderTimeline: [],
      isValid: true,
    }
  }

  it('continuous goals scale linearly', () => {
    const snap = makeSnapshot({ timeSeconds: 120, metalIncome: 10 })
    const result = makeResult([snap])
    const fw = defaultFitnessWeights()
    const checkpoints = [
      { type: 'metalIncome' as const, targetTime: 120, targetValue: 20, weight: 1.0 },
    ]
    const breakdown = computeFitnessBreakdown(result, [], checkpoints, fw, () => undefined)
    // achievement = 10/20 = 0.5
    expect(breakdown.checkpointAchievements[0]).toBeCloseTo(0.5, 5)
    expect(breakdown.checkpointScores[0]).toBeCloseTo(0.5, 5)
  })

  it('continuous goals cap at continuousOvercap', () => {
    const snap = makeSnapshot({ timeSeconds: 120, metalIncome: 50 })
    const result = makeResult([snap])
    const fw = defaultFitnessWeights()
    const checkpoints = [
      { type: 'metalIncome' as const, targetTime: 120, targetValue: 10, weight: 1.0 },
    ]
    const breakdown = computeFitnessBreakdown(result, [], checkpoints, fw, () => undefined)
    // 50/10 = 5.0, capped at continuousOvercap = 1.5
    expect(breakdown.checkpointAchievements[0]).toBeCloseTo(1.5, 5)
  })

  it('binary goals are 0 or 1 (or partial credit)', () => {
    const snap = makeSnapshot({ timeSeconds: 120, completedCount: 1 })
    const result = makeResult([snap], ['testsolar'])
    const fw = defaultFitnessWeights()
    const checkpoints = [
      { type: 'building' as const, targetTime: 120, unitId: 'testsolar', weight: 1.0 },
    ]
    const breakdown = computeFitnessBreakdown(result, ['testsolar'], checkpoints, fw, () => undefined)
    expect(breakdown.checkpointAchievements[0]).toBe(1.0)
  })

  it('binary goals give partial credit when in genes but not completed', () => {
    const snap = makeSnapshot({ timeSeconds: 120, completedCount: 0 })
    const result = makeResult([snap], [])
    const fw = defaultFitnessWeights()
    const checkpoints = [
      { type: 'building' as const, targetTime: 120, unitId: 'testsolar', weight: 1.0 },
    ]
    const breakdown = computeFitnessBreakdown(result, ['testsolar'], checkpoints, fw, () => undefined)
    expect(breakdown.checkpointAchievements[0]).toBeCloseTo(fw.binaryPartialCredit, 5)
  })

  it('binary goals are 0 when not in genes at all', () => {
    const snap = makeSnapshot({ timeSeconds: 120, completedCount: 0 })
    const result = makeResult([snap], [])
    const fw = defaultFitnessWeights()
    const checkpoints = [
      { type: 'building' as const, targetTime: 120, unitId: 'testsolar', weight: 1.0 },
    ]
    const breakdown = computeFitnessBreakdown(result, [], checkpoints, fw, () => undefined)
    expect(breakdown.checkpointAchievements[0]).toBe(0)
  })

  it('banking penalty triggers above threshold', () => {
    // currentMetal/metalCap = 950/1000 = 0.95 > bankingThreshold(0.85)
    const snap = makeSnapshot({ currentMetal: 950, metalCap: 1000 })
    const result = makeResult([snap])
    const fw = defaultFitnessWeights()
    const breakdown = computeFitnessBreakdown(result, [], [], fw, () => undefined)
    expect(breakdown.bankingPenalty).toBeLessThan(0)
  })

  it('no banking penalty below threshold', () => {
    const snap = makeSnapshot({ currentMetal: 100, metalCap: 1000 })
    const result = makeResult([snap])
    const fw = defaultFitnessWeights()
    const breakdown = computeFitnessBreakdown(result, [], [], fw, () => undefined)
    expect(breakdown.bankingPenalty).toBe(0)
  })

  it('metal waste penalty is negative when metal is wasted', () => {
    const snap = makeSnapshot({ totalMetalSpent: 900, totalMetalWasted: 100 })
    const result = makeResult([snap])
    const fw = defaultFitnessWeights()
    const breakdown = computeFitnessBreakdown(result, [], [], fw, () => undefined)
    expect(breakdown.metalWastePenalty).toBeLessThan(0)
  })

  it('energy waste penalty is negative when energy is wasted', () => {
    const snap = makeSnapshot({ totalEnergySpent: 800, totalEnergyWasted: 200 })
    const result = makeResult([snap])
    const fw = defaultFitnessWeights()
    const breakdown = computeFitnessBreakdown(result, [], [], fw, () => undefined)
    expect(breakdown.energyWastePenalty).toBeLessThan(0)
  })

  it('stall penalty applies when build power is wasted', () => {
    const snap = makeSnapshot({ buildPowerPotential: 1000, buildPowerWasted: 500 })
    const result = makeResult([snap])
    const fw = defaultFitnessWeights()
    const breakdown = computeFitnessBreakdown(result, [], [], fw, () => undefined)
    expect(breakdown.stallPenalty).toBeLessThan(0)
  })

  it('wind storage penalty applies when insufficient energy storage', () => {
    // windAvg=12.5, windMin=5 → variation=7.5
    // required = 3 * 7.5 * 15 = 337.5, energyCap = 100 → deficit
    const snap = makeSnapshot({ windGeneratorCount: 3, energyCap: 100 })
    const result = makeResult([snap])
    const fw = defaultFitnessWeights()
    const breakdown = computeFitnessBreakdown(result, [], [], fw, () => undefined, 12.5, 5)
    expect(breakdown.windStoragePenalty).toBeLessThan(0)
  })

  it('energy deficit penalty triggers when energy fill is very low', () => {
    // currentEnergy/energyCap = 1/1000 = 0.001 < energyDeficitThreshold(0.05)
    const snap = makeSnapshot({ currentEnergy: 1, energyCap: 1000 })
    const result = makeResult([snap])
    const fw = defaultFitnessWeights()
    const breakdown = computeFitnessBreakdown(result, [], [], fw, () => undefined)
    expect(breakdown.energyDeficitPenalty).toBeLessThan(0)
  })

  it('totalScore = totalGoalScore + totalSanityScore', () => {
    const snap = makeSnapshot({ timeSeconds: 120, metalIncome: 10 })
    const result = makeResult([snap])
    const fw = defaultFitnessWeights()
    const checkpoints = [
      { type: 'metalIncome' as const, targetTime: 120, targetValue: 20, weight: 1.0 },
    ]
    const breakdown = computeFitnessBreakdown(result, [], checkpoints, fw, () => undefined)
    expect(breakdown.totalScore).toBeCloseTo(breakdown.totalGoalScore + breakdown.totalSanityScore, 10)
  })
})

// ── Simulation integration (light) ──────────────────────────────────────────

describe('simulateBuildOrder integration', () => {
  it('builds a solar and increases energy income', () => {
    const { unitIndex, builderCapabilities } = buildTestInfra()
    const config = {
      ...getDefaultSimConfig(),
      commanderUnitId: 'armcom',
      durationSeconds: 120,
      ticksPerSecond: 10,
      snapshotTimes: [60, 120],
    }
    const result = simulateBuildOrder(['testsolar'], config, unitIndex, builderCapabilities)
    expect(result.isValid).toBe(true)
    expect(result.snapshots.length).toBe(2)
    // After building a solar, energy income should have increased
    const lastSnap = result.snapshots[result.snapshots.length - 1]
    expect(lastSnap.energyIncome).toBeGreaterThan(config.commanderEnergyIncome)
  })

  it('builds a mex and increases metal income', () => {
    const { unitIndex, builderCapabilities } = buildTestInfra()
    const config = {
      ...getDefaultSimConfig(),
      commanderUnitId: 'armcom',
      durationSeconds: 120,
      ticksPerSecond: 10,
      snapshotTimes: [60, 120],
    }
    const result = simulateBuildOrder(['testmex'], config, unitIndex, builderCapabilities)
    const lastSnap = result.snapshots[result.snapshots.length - 1]
    expect(lastSnap.metalIncome).toBeGreaterThan(config.commanderMetalIncome)
  })

  it('empty build order produces valid result', () => {
    const { unitIndex, builderCapabilities } = buildTestInfra()
    const config = {
      ...getDefaultSimConfig(),
      commanderUnitId: 'armcom',
      durationSeconds: 60,
      ticksPerSecond: 10,
      snapshotTimes: [30, 60],
    }
    const result = simulateBuildOrder([], config, unitIndex, builderCapabilities)
    expect(result.isValid).toBe(true)
    expect(result.completedUnitIds.length).toBe(0)
    expect(result.snapshots.length).toBe(2)
    // Income should be commander-only
    expect(result.snapshots[0].metalIncome).toBe(config.commanderMetalIncome)
    expect(result.snapshots[0].energyIncome).toBe(config.commanderEnergyIncome)
  })
})

// ── Mutation operators ─────────────────────────────────────────────────────

describe('applyOneMutation', () => {
  const factionUnits = allMockUnits.filter(u => !u.isCommander)

  it('swap: two positions are exchanged, length unchanged', () => {
    // Run many trials — at least one should trigger the swap branch (roll < 0.35)
    let swapSeen = false
    for (let trial = 0; trial < 200; trial++) {
      const genes = ['testsolar', 'testmex', 'testfactory']
      const original = [...genes]
      const result = applyOneMutation(genes, 1, 10, factionUnits)
      if (result.length === original.length) {
        // Check if exactly two elements were swapped
        let diffs = 0
        for (let i = 0; i < result.length; i++) {
          if (result[i] !== original[i]) diffs++
        }
        if (diffs === 2 || diffs === 0) { swapSeen = true; break }
      }
    }
    expect(swapSeen).toBe(true)
  })

  it('replace: one gene is replaced, length unchanged', () => {
    let replaceSeen = false
    for (let trial = 0; trial < 200; trial++) {
      const genes = ['testsolar', 'testmex', 'testfactory']
      const result = applyOneMutation([...genes], 1, 10, factionUnits)
      if (result.length === genes.length && result[0] === genes[0] && result[2] === genes[2] && result[1] !== genes[1]) {
        replaceSeen = true; break
      }
    }
    expect(replaceSeen).toBe(true)
  })

  it('insert build: length increases by 1', () => {
    let insertSeen = false
    for (let trial = 0; trial < 200; trial++) {
      const genes = ['testsolar', 'testmex']
      const result = applyOneMutation([...genes], 1, 10, factionUnits)
      if (result.length === 3) { insertSeen = true; break }
    }
    expect(insertSeen).toBe(true)
  })

  it('insert reclaim: inserts a reclaim gene for a previously-built unit', () => {
    let reclaimSeen = false
    for (let trial = 0; trial < 200; trial++) {
      const genes = ['testsolar', 'testmex', 'testfactory']
      const result = applyOneMutation([...genes], 2, 10, factionUnits)
      const reclaimGenes = result.filter(g => isReclaimGene(g))
      if (reclaimGenes.length > 0) {
        const target = getReclaimTargetId(reclaimGenes[0])
        // Target should be a gene that appeared before the insert position
        expect(genes.slice(0, 2)).toContain(target)
        reclaimSeen = true; break
      }
    }
    expect(reclaimSeen).toBe(true)
  })

  it('delete: length decreases by 1', () => {
    let deleteSeen = false
    for (let trial = 0; trial < 200; trial++) {
      const genes = ['testsolar', 'testmex', 'testfactory']
      const result = applyOneMutation([...genes], 1, 10, factionUnits)
      if (result.length === 2) { deleteSeen = true; break }
    }
    expect(deleteSeen).toBe(true)
  })
})

// ── Crossover ──────────────────────────────────────────────────────────────

describe('singlePointCrossover', () => {
  it('produces two children', () => {
    const p1 = ['testsolar', 'testmex']
    const p2 = ['testfactory', 'testbot']
    const [c1, c2] = singlePointCrossover(p1, p2, 10)
    expect(Array.isArray(c1)).toBe(true)
    expect(Array.isArray(c2)).toBe(true)
  })

  it('children contain genes from both parents (across many trials)', () => {
    const p1 = ['testsolar', 'testsolar', 'testsolar']
    const p2 = ['testbot', 'testbot', 'testbot']
    let childHadBoth = false
    for (let trial = 0; trial < 100; trial++) {
      const [c1] = singlePointCrossover(p1, p2, 10)
      const hasSolar = c1.includes('testsolar')
      const hasBot = c1.includes('testbot')
      if (hasSolar && hasBot) { childHadBoth = true; break }
    }
    expect(childHadBoth).toBe(true)
  })

  it('children respect maxLength cap', () => {
    const p1 = ['testsolar', 'testmex', 'testfactory', 'testbot']
    const p2 = ['testbot', 'testfactory', 'testmex', 'testsolar']
    const maxLength = 3
    for (let trial = 0; trial < 50; trial++) {
      const [c1, c2] = singlePointCrossover(p1, p2, maxLength)
      expect(c1.length).toBeLessThanOrEqual(maxLength)
      expect(c2.length).toBeLessThanOrEqual(maxLength)
    }
  })

  it('handles empty parent gracefully', () => {
    const [c1, c2] = singlePointCrossover([], ['testbot', 'testsolar'], 10)
    expect(c1).toEqual([])
    expect(c2.length).toBeGreaterThan(0)
  })
})

// ── Untested checkpoint types ──────────────────────────────────────────────

describe('computeFitnessBreakdown — additional checkpoint types', () => {
  function makeSnapshot(overrides: Partial<SimSnapshot> = {}): SimSnapshot {
    return {
      timeSeconds: 60,
      metalIncome: 5,
      energyIncome: 30,
      totalMetalSpent: 500,
      totalEnergySpent: 3000,
      armyMetalSpent: 0,
      currentArmyMetal: 0,
      currentArmyDps: 0,
      currentArmyHealth: 0,
      currentArmyGroundDps: 0,
      completedCount: 0,
      aliveUnitCounts: {},
      currentMetal: 100,
      currentEnergy: 500,
      metalCap: 1000,
      energyCap: 1000,
      totalMetalWasted: 0,
      totalEnergyWasted: 0,
      buildPowerPotential: 1000,
      buildPowerWasted: 0,
      totalBuildPower: 300,
      windGeneratorCount: 0,
      totalConverterMetalOutput: 0,
      ...overrides,
    }
  }

  function makeResult(snapshots: SimSnapshot[], completedUnitIds: string[] = []): SimResult {
    return {
      snapshots,
      completedUnitIds,
      buildTimeline: [],
      builderTimeline: [],
      isValid: true,
    }
  }

  it('energyIncome checkpoint: linear scaling like metalIncome', () => {
    const snap = makeSnapshot({ timeSeconds: 120, energyIncome: 50 })
    const result = makeResult([snap])
    const fw = defaultFitnessWeights()
    const checkpoints = [
      { type: 'energyIncome' as const, targetTime: 120, targetValue: 100, weight: 1.0 },
    ]
    const breakdown = computeFitnessBreakdown(result, [], checkpoints, fw, () => undefined)
    // achievement = 50/100 = 0.5
    expect(breakdown.checkpointAchievements[0]).toBeCloseTo(0.5, 5)
  })

  it('armyMetal checkpoint: uses currentArmyMetal (alive units)', () => {
    const snap = makeSnapshot({ timeSeconds: 120, currentArmyMetal: 500 })
    const result = makeResult([snap])
    const fw = defaultFitnessWeights()
    const checkpoints = [
      { type: 'armyMetal' as const, targetTime: 120, targetValue: 1000, weight: 1.0 },
    ]
    const breakdown = computeFitnessBreakdown(result, [], checkpoints, fw, () => undefined)
    expect(breakdown.checkpointAchievements[0]).toBeCloseTo(0.5, 5)
  })

  it('armyDps checkpoint: uses currentArmyDps', () => {
    const snap = makeSnapshot({ timeSeconds: 120, currentArmyDps: 300 })
    const result = makeResult([snap])
    const fw = defaultFitnessWeights()
    const checkpoints = [
      { type: 'armyDps' as const, targetTime: 120, targetValue: 600, weight: 1.0 },
    ]
    const breakdown = computeFitnessBreakdown(result, [], checkpoints, fw, () => undefined)
    expect(breakdown.checkpointAchievements[0]).toBeCloseTo(0.5, 5)
  })

  it('armyHealth checkpoint: uses currentArmyHealth', () => {
    const snap = makeSnapshot({ timeSeconds: 120, currentArmyHealth: 2000 })
    const result = makeResult([snap])
    const fw = defaultFitnessWeights()
    const checkpoints = [
      { type: 'armyHealth' as const, targetTime: 120, targetValue: 4000, weight: 1.0 },
    ]
    const breakdown = computeFitnessBreakdown(result, [], checkpoints, fw, () => undefined)
    expect(breakdown.checkpointAchievements[0]).toBeCloseTo(0.5, 5)
  })

  it('unitCount checkpoint: tracks aliveUnitCounts', () => {
    const snap = makeSnapshot({ timeSeconds: 120, aliveUnitCounts: { testbot: 3 } })
    const result = makeResult([snap])
    const fw = defaultFitnessWeights()
    const checkpoints = [
      { type: 'unitCount' as const, targetTime: 120, unitId: 'testbot', targetCount: 6, weight: 1.0 },
    ]
    const breakdown = computeFitnessBreakdown(result, [], checkpoints, fw, () => undefined)
    expect(breakdown.checkpointAchievements[0]).toBeCloseTo(0.5, 5)
  })

  it('buildPower checkpoint: uses totalBuildPower', () => {
    const snap = makeSnapshot({ timeSeconds: 120, totalBuildPower: 450 })
    const result = makeResult([snap])
    const fw = defaultFitnessWeights()
    const checkpoints = [
      { type: 'buildPower' as const, targetTime: 120, targetValue: 900, weight: 1.0 },
    ]
    const breakdown = computeFitnessBreakdown(result, [], checkpoints, fw, () => undefined)
    expect(breakdown.checkpointAchievements[0]).toBeCloseTo(0.5, 5)
  })
})
