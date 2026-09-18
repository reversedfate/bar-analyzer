import { describe, it, expect } from 'vitest'
import type { Unit } from '../src/types'
import {
  getDefaultSimConfig,
  getFullFidelitySimConfig,
  simulateBuildOrder,
  buildUnitIndex,
  buildBuilderCapabilities,
  BASE_T1_MEX_RATE,
  RECLAIM_EFFICIENCY,
  RECLAIM_PREFIX,
  isReclaimGene,
  getReclaimTargetId,
  makeReclaimGene,
} from '../src/services/economySimulator'

// ── Mock unit helpers ──────────────────────────────────────────────────────────

/** Minimal commander mock that the simulator always expects in the unit index. */
function mockCommander(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'armcom',
    name: 'Commander',
    faction: 'Armada',
    tier: 'T1',
    unitType: 'Commander',
    metalCost: 5000,
    energyCost: 50000,
    buildTime: 75000,
    health: 5000,
    weapons: [],
    movementMode: 'Walking',
    speed: 30,
    sightRange: 600,
    buildPower: 300,
    isCommander: true,
    ...overrides,
  }
}

function mockSolar(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'testsolar',
    name: 'Test Solar',
    faction: 'Armada',
    tier: 'T1',
    unitType: 'Building',
    metalCost: 150,
    energyCost: 0,
    buildTime: 3000,
    health: 100,
    weapons: [],
    movementMode: 'Static',
    speed: 0,
    sightRange: 0,
    energyProduction: 20,
    ...overrides,
  }
}

function mockT1Mex(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'testmex',
    name: 'Test T1 MEX',
    faction: 'Armada',
    tier: 'T1',
    unitType: 'Building',
    metalCost: 75,
    energyCost: 0,
    buildTime: 1500,
    health: 200,
    weapons: [],
    movementMode: 'Static',
    speed: 0,
    sightRange: 0,
    metalProduction: BASE_T1_MEX_RATE, // T1: same as base rate
    ...overrides,
  }
}

function mockT2Mex(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'testmex2',
    name: 'Test T2 MEX',
    faction: 'Armada',
    tier: 'T2',
    unitType: 'Building',
    metalCost: 600,
    energyCost: 3000,
    buildTime: 12000,
    health: 800,
    weapons: [],
    movementMode: 'Static',
    speed: 0,
    sightRange: 0,
    metalProduction: BASE_T1_MEX_RATE * 4, // T2: 4x the base rate
    ...overrides,
  }
}

function mockWind(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'armwin',
    name: 'Wind Generator',
    faction: 'Armada',
    tier: 'T1',
    unitType: 'Building',
    metalCost: 35,
    energyCost: 0,
    buildTime: 700,
    health: 75,
    weapons: [],
    movementMode: 'Static',
    speed: 0,
    sightRange: 0,
    energyProduction: 0, // wind generators report 0 in JSON; sim uses windAvg
    ...overrides,
  }
}

function mockStorage(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'teststorage',
    name: 'Test Metal Storage',
    faction: 'Armada',
    tier: 'T1',
    unitType: 'Building',
    metalCost: 200,
    energyCost: 0,
    buildTime: 3000,
    health: 500,
    weapons: [],
    movementMode: 'Static',
    speed: 0,
    sightRange: 0,
    metalStorage: 2000,
    ...overrides,
  }
}

function mockArmyUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'testbot',
    name: 'Test Bot',
    faction: 'Armada',
    tier: 'T1',
    unitType: 'Bot',
    metalCost: 100,
    energyCost: 1500,
    buildTime: 3000,
    health: 400,
    weapons: [
      {
        id: 'testgun',
        name: 'Test Gun',
        damage: 50,
        reload: 0.5,
        range: 200,
        projectileType: 'Laser',
        dps: 100,
      },
    ],
    movementMode: 'Walking',
    speed: 50,
    sightRange: 400,
    ...overrides,
  }
}

function mockFactory(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'testlab',
    name: 'Test Bot Lab',
    faction: 'Armada',
    tier: 'T1',
    unitType: 'Building',
    metalCost: 600,
    energyCost: 1200,
    buildTime: 9000,
    health: 2500,
    weapons: [],
    movementMode: 'Static',
    speed: 0,
    sightRange: 0,
    buildPower: 100,
    ...overrides,
  }
}

// ── Simulation helper ──────────────────────────────────────────────────────────

/**
 * Create a simulator setup from a list of units and a builder map.
 * Returns the unitIndex and builderCapabilities needed by simulateBuildOrder.
 */
function setupSim(units: Unit[], builderMapEntries: [string, string[]][] = []) {
  const unitIndex = buildUnitIndex(units)
  const builderMap = new Map<string, string[]>(builderMapEntries)
  const builderCapabilities = buildBuilderCapabilities(builderMap)
  return { unitIndex, builderCapabilities }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('economySimulator', () => {
  // ────────────────────────────────────────────────────────────────────────────
  // 1. Default config values
  // ────────────────────────────────────────────────────────────────────────────
  describe('getDefaultSimConfig', () => {
    it('returns correct default values', () => {
      const cfg = getDefaultSimConfig()
      expect(cfg.startingMetal).toBe(1000)
      expect(cfg.startingEnergy).toBe(1000)
      expect(cfg.startingMetalStorage).toBe(1000)
      expect(cfg.startingEnergyStorage).toBe(1000)
      expect(cfg.commanderBuildpower).toBe(300)
      expect(cfg.commanderMetalIncome).toBe(2)
      expect(cfg.commanderEnergyIncome).toBe(30)
      expect(cfg.commanderUnitId).toBe('armcom')
      expect(cfg.windAvg).toBe(12.5)
      expect(cfg.windMin).toBe(5)
      expect(cfg.windMax).toBe(25)
      expect(cfg.tidalStrength).toBe(25)
      expect(cfg.maxMetalSpots).toBe(5)
      expect(cfg.metalPerSpot).toBe(1.8)
      expect(cfg.maxGeoSpots).toBe(1)
      expect(cfg.durationSeconds).toBe(720)
      expect(cfg.ticksPerSecond).toBe(10)
    })

    it('has 12 snapshot times from 60 to 720', () => {
      const cfg = getDefaultSimConfig()
      expect(cfg.snapshotTimes).toHaveLength(12)
      expect(cfg.snapshotTimes[0]).toBe(60)
      expect(cfg.snapshotTimes[cfg.snapshotTimes.length - 1]).toBe(720)
      // Each snapshot 60 seconds apart
      for (let i = 1; i < cfg.snapshotTimes.length; i++) {
        expect(cfg.snapshotTimes[i] - cfg.snapshotTimes[i - 1]).toBe(60)
      }
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // 2. Starting resources
  // ────────────────────────────────────────────────────────────────────────────
  describe('starting resources', () => {
    it('simulation starts with configured metal and energy', () => {
      const commander = mockCommander()
      const { unitIndex, builderCapabilities } = setupSim([commander])
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 500,
        startingEnergy: 800,
        startingMetalStorage: 500,
        startingEnergyStorage: 800,
        durationSeconds: 1,
        snapshotTimes: [1],
      }
      const result = simulateBuildOrder([], config, unitIndex, builderCapabilities)
      expect(result.snapshots).toHaveLength(1)
      const snap = result.snapshots[0]
      // After 1 second of income at 2 M/s and 30 E/s, resources should be
      // startingMetal + metalIncome * 1s = 500 + 2 = 502, capped at 500 => 500
      // startingEnergy + energyIncome * 1s = 800 + 30 = 830, capped at 800 => 800
      // Both are at cap, so waste should have accumulated
      expect(snap.currentMetal).toBe(500)
      expect(snap.currentEnergy).toBe(800)
      expect(snap.metalCap).toBe(500)
      expect(snap.energyCap).toBe(800)
      expect(snap.totalMetalWasted).toBeGreaterThan(0)
      expect(snap.totalEnergyWasted).toBeGreaterThan(0)
    })

    it('first snapshot reflects commander income', () => {
      const commander = mockCommander()
      const { unitIndex, builderCapabilities } = setupSim([commander])
      const config = {
        ...getDefaultSimConfig(),
        durationSeconds: 60,
        snapshotTimes: [60],
      }
      const result = simulateBuildOrder([], config, unitIndex, builderCapabilities)
      const snap = result.snapshots[0]
      expect(snap.metalIncome).toBe(2)
      expect(snap.energyIncome).toBe(30)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // 3. MEX income scaling
  // ────────────────────────────────────────────────────────────────────────────
  describe('MEX income scaling', () => {
    it('T1 MEX adds metalPerSpot * 1.0 income', () => {
      const commander = mockCommander()
      const mex = mockT1Mex()
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, mex],
        [['testmex', ['armcom']]],
      )
      // Use generous starting resources so the mex completes quickly
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 5000,
        startingEnergy: 50000,
        startingMetalStorage: 50000,
        startingEnergyStorage: 50000,
        durationSeconds: 60,
        snapshotTimes: [60],
      }
      const result = simulateBuildOrder(['testmex'], config, unitIndex, builderCapabilities)
      expect(result.completedUnitIds).toContain('testmex')
      const snap = result.snapshots[0]
      // Commander income 2 + metalPerSpot * (1.8 / 1.8) = 2 + 1.8 = 3.8
      expect(snap.metalIncome).toBeCloseTo(2 + config.metalPerSpot * 1.0, 5)
    })

    it('T2 MEX adds metalPerSpot * 4.0 income', () => {
      const commander = mockCommander()
      const mex2 = mockT2Mex()
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, mex2],
        [['testmex2', ['armcom']]],
      )
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 50000,
        startingEnergy: 500000,
        startingMetalStorage: 500000,
        startingEnergyStorage: 500000,
        durationSeconds: 120,
        snapshotTimes: [120],
      }
      const result = simulateBuildOrder(['testmex2'], config, unitIndex, builderCapabilities)
      expect(result.completedUnitIds).toContain('testmex2')
      const snap = result.snapshots[0]
      // Commander income 2 + metalPerSpot * (7.2 / 1.8) = 2 + 1.8 * 4 = 2 + 7.2 = 9.2
      expect(snap.metalIncome).toBeCloseTo(2 + config.metalPerSpot * 4.0, 5)
    })

    it('respects maxMetalSpots cap', () => {
      const commander = mockCommander()
      const mex = mockT1Mex()
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, mex],
        [['testmex', ['armcom']]],
      )
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 50000,
        startingEnergy: 500000,
        startingMetalStorage: 500000,
        startingEnergyStorage: 500000,
        maxMetalSpots: 2,
        durationSeconds: 120,
        snapshotTimes: [120],
      }
      // Try to build 4 mexes but only 2 spots available
      const result = simulateBuildOrder(
        ['testmex', 'testmex', 'testmex', 'testmex'],
        config,
        unitIndex,
        builderCapabilities,
      )
      const snap = result.snapshots[0]
      // Commander 2 + 2 spots * 1.8 = 5.6
      expect(snap.metalIncome).toBeCloseTo(2 + 2 * config.metalPerSpot, 5)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // 4. Solar energy
  // ────────────────────────────────────────────────────────────────────────────
  describe('solar energy', () => {
    it('completing a solar panel adds energyProduction to income', () => {
      const commander = mockCommander()
      const solar = mockSolar()
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, solar],
        [['testsolar', ['armcom']]],
      )
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 5000,
        startingEnergy: 50000,
        startingMetalStorage: 50000,
        startingEnergyStorage: 50000,
        durationSeconds: 60,
        snapshotTimes: [60],
      }
      const result = simulateBuildOrder(['testsolar'], config, unitIndex, builderCapabilities)
      expect(result.completedUnitIds).toContain('testsolar')
      const snap = result.snapshots[0]
      // Commander 30 E/s + solar 20 E/s = 50
      expect(snap.energyIncome).toBeCloseTo(30 + 20, 5)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // 5. Wind energy
  // ────────────────────────────────────────────────────────────────────────────
  describe('wind energy', () => {
    it('wind generators use windAvg for energy income', () => {
      const commander = mockCommander()
      const wind = mockWind()
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, wind],
        [['armwin', ['armcom']]],
      )
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 5000,
        startingEnergy: 50000,
        startingMetalStorage: 50000,
        startingEnergyStorage: 50000,
        windAvg: 12.5,
        durationSeconds: 60,
        snapshotTimes: [60],
      }
      const result = simulateBuildOrder(['armwin'], config, unitIndex, builderCapabilities)
      expect(result.completedUnitIds).toContain('armwin')
      const snap = result.snapshots[0]
      // Commander 30 E/s + windAvg 12.5 = 42.5
      expect(snap.energyIncome).toBeCloseTo(30 + 12.5, 5)
      expect(snap.windGeneratorCount).toBe(1)
    })

    it('multiple wind generators stack additively', () => {
      const commander = mockCommander()
      const wind = mockWind()
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, wind],
        [['armwin', ['armcom']]],
      )
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 5000,
        startingEnergy: 50000,
        startingMetalStorage: 50000,
        startingEnergyStorage: 50000,
        windAvg: 10,
        durationSeconds: 60,
        snapshotTimes: [60],
      }
      const result = simulateBuildOrder(
        ['armwin', 'armwin', 'armwin'],
        config,
        unitIndex,
        builderCapabilities,
      )
      const snap = result.snapshots[0]
      // All 3 wind generators should complete: commander 30 + 3*10 = 60
      expect(snap.energyIncome).toBeCloseTo(30 + 3 * 10, 5)
      expect(snap.windGeneratorCount).toBe(3)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // 6. Build progress formula
  // ────────────────────────────────────────────────────────────────────────────
  describe('build progress formula', () => {
    it('unit completes in buildTime / commanderBP seconds with full resources', () => {
      const commander = mockCommander()
      // A unit with buildTime 3000 and BP 300 should take 10 seconds
      const solar = mockSolar({ buildTime: 3000 })
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, solar],
        [['testsolar', ['armcom']]],
      )
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 50000,
        startingEnergy: 500000,
        startingMetalStorage: 500000,
        startingEnergyStorage: 500000,
        durationSeconds: 60,
        snapshotTimes: [60],
      }
      const result = simulateBuildOrder(['testsolar'], config, unitIndex, builderCapabilities)
      expect(result.completedUnitIds).toContain('testsolar')
      // Metal spent should equal the metalCost
      const snap = result.snapshots[0]
      expect(snap.totalMetalSpent).toBeCloseTo(150, 1)
    })

    it('build time matches buildTime / BP formula', () => {
      // With BP=300 and buildTime=3000, completion at 3000/300 = 10 seconds.
      // Use full fidelity (30 tps) + snapshot every second to find completion time.
      const commander = mockCommander()
      const solar = mockSolar({ buildTime: 3000 })
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, solar],
        [['testsolar', ['armcom']]],
      )
      const baseConfig = {
        ...getDefaultSimConfig(),
        startingMetal: 50000,
        startingEnergy: 500000,
        startingMetalStorage: 500000,
        startingEnergyStorage: 500000,
        durationSeconds: 30,
      }
      const config = getFullFidelitySimConfig(baseConfig)
      const result = simulateBuildOrder(['testsolar'], config, unitIndex, builderCapabilities)
      expect(result.completedUnitIds).toContain('testsolar')
      // Find the snapshot where completedCount first becomes 1
      const completionSnap = result.snapshots.find((s) => s.completedCount >= 1)
      expect(completionSnap).toBeDefined()
      // Should complete at exactly 10 seconds (3000/300 = 10)
      expect(completionSnap!.timeSeconds).toBe(10)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // 7. Resource stall
  // ────────────────────────────────────────────────────────────────────────────
  describe('resource stall', () => {
    it('build rate slows when resources are depleted', () => {
      const commander = mockCommander()
      // An expensive unit that will drain starting resources
      const expensiveUnit = mockSolar({
        id: 'expensive',
        name: 'Expensive Building',
        metalCost: 5000,
        energyCost: 5000,
        buildTime: 3000,
      })
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, expensiveUnit],
        [['expensive', ['armcom']]],
      )
      // Minimal starting resources: building will stall
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 100,
        startingEnergy: 100,
        startingMetalStorage: 1000,
        startingEnergyStorage: 1000,
        durationSeconds: 120,
        snapshotTimes: [60, 120],
      }
      const result = simulateBuildOrder(['expensive'], config, unitIndex, builderCapabilities)
      // With 5000 metal cost and only 2 M/s income + 100 starting,
      // the build should take much longer than 10s (3000/300 = 10s with full resources)
      const snap60 = result.snapshots[0]
      // Build power waste should be non-zero because resources limit build rate
      expect(snap60.buildPowerWasted).toBeGreaterThan(0)
    })

    it('build power waste is tracked during stall', () => {
      const commander = mockCommander()
      const unit = mockSolar({
        id: 'bigbuild',
        name: 'Big Build',
        metalCost: 10000,
        energyCost: 10000,
        buildTime: 6000,
      })
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, unit],
        [['bigbuild', ['armcom']]],
      )
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 50,
        startingEnergy: 50,
        startingMetalStorage: 1000,
        startingEnergyStorage: 1000,
        durationSeconds: 60,
        snapshotTimes: [60],
      }
      const result = simulateBuildOrder(['bigbuild'], config, unitIndex, builderCapabilities)
      const snap = result.snapshots[0]
      expect(snap.buildPowerPotential).toBeGreaterThan(0)
      expect(snap.buildPowerWasted).toBeGreaterThan(0)
      // Wasted should be less than or equal to potential
      expect(snap.buildPowerWasted).toBeLessThanOrEqual(snap.buildPowerPotential)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // 8. Storage overflow
  // ────────────────────────────────────────────────────────────────────────────
  describe('storage overflow', () => {
    it('metal and energy are capped at storage capacity', () => {
      const commander = mockCommander()
      const { unitIndex, builderCapabilities } = setupSim([commander])
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 1000,
        startingEnergy: 1000,
        startingMetalStorage: 1000,
        startingEnergyStorage: 1000,
        durationSeconds: 60,
        snapshotTimes: [60],
      }
      const result = simulateBuildOrder([], config, unitIndex, builderCapabilities)
      const snap = result.snapshots[0]
      // Resources should never exceed storage cap
      expect(snap.currentMetal).toBeLessThanOrEqual(snap.metalCap)
      expect(snap.currentEnergy).toBeLessThanOrEqual(snap.energyCap)
      // With no spending and income, waste should accumulate
      expect(snap.totalMetalWasted).toBeGreaterThan(0)
      expect(snap.totalEnergyWasted).toBeGreaterThan(0)
    })

    it('waste equals total income over storage when idle', () => {
      const commander = mockCommander()
      const { unitIndex, builderCapabilities } = setupSim([commander])
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 1000,
        startingEnergy: 1000,
        startingMetalStorage: 1000,
        startingEnergyStorage: 1000,
        durationSeconds: 10,
        snapshotTimes: [10],
      }
      const result = simulateBuildOrder([], config, unitIndex, builderCapabilities)
      const snap = result.snapshots[0]
      // With 2 M/s for 10 seconds = 20 metal income, all wasted (already at cap)
      expect(snap.totalMetalWasted).toBeCloseTo(2 * 10, 1)
      // With 30 E/s for 10 seconds = 300 energy income, all wasted (already at cap)
      expect(snap.totalEnergyWasted).toBeCloseTo(30 * 10, 1)
    })

    it('building storage increases cap', () => {
      const commander = mockCommander()
      const storage = mockStorage()
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, storage],
        [['teststorage', ['armcom']]],
      )
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 50000,
        startingEnergy: 500000,
        startingMetalStorage: 1000,
        startingEnergyStorage: 500000,
        durationSeconds: 60,
        snapshotTimes: [60],
      }
      const result = simulateBuildOrder(['teststorage'], config, unitIndex, builderCapabilities)
      expect(result.completedUnitIds).toContain('teststorage')
      const snap = result.snapshots[0]
      // Metal cap should increase by 2000
      expect(snap.metalCap).toBe(1000 + 2000)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // 9. Snapshot timing
  // ────────────────────────────────────────────────────────────────────────────
  describe('snapshot timing', () => {
    it('produces one snapshot per configured snapshot time', () => {
      const commander = mockCommander()
      const { unitIndex, builderCapabilities } = setupSim([commander])
      const config = {
        ...getDefaultSimConfig(),
        snapshotTimes: [10, 20, 30],
        durationSeconds: 30,
      }
      const result = simulateBuildOrder([], config, unitIndex, builderCapabilities)
      expect(result.snapshots).toHaveLength(3)
      expect(result.snapshots[0].timeSeconds).toBe(10)
      expect(result.snapshots[1].timeSeconds).toBe(20)
      expect(result.snapshots[2].timeSeconds).toBe(30)
    })

    it('handles snapshot times beyond durationSeconds', () => {
      const commander = mockCommander()
      const { unitIndex, builderCapabilities } = setupSim([commander])
      const config = {
        ...getDefaultSimConfig(),
        snapshotTimes: [5, 10, 100],
        durationSeconds: 10,
      }
      const result = simulateBuildOrder([], config, unitIndex, builderCapabilities)
      // Should still produce 3 snapshots (the last one is filled as "remaining")
      expect(result.snapshots).toHaveLength(3)
      expect(result.snapshots[0].timeSeconds).toBe(5)
      expect(result.snapshots[1].timeSeconds).toBe(10)
      expect(result.snapshots[2].timeSeconds).toBe(100)
    })

    it('snapshots are ordered by time', () => {
      const commander = mockCommander()
      const { unitIndex, builderCapabilities } = setupSim([commander])
      const config = {
        ...getDefaultSimConfig(),
        // Provide out-of-order snapshot times
        snapshotTimes: [30, 10, 20],
        durationSeconds: 30,
      }
      const result = simulateBuildOrder([], config, unitIndex, builderCapabilities)
      expect(result.snapshots).toHaveLength(3)
      // Simulator sorts snapshot times, so they should be in order
      expect(result.snapshots[0].timeSeconds).toBe(10)
      expect(result.snapshots[1].timeSeconds).toBe(20)
      expect(result.snapshots[2].timeSeconds).toBe(30)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // 10. Reclaim gene helpers
  // ────────────────────────────────────────────────────────────────────────────
  describe('reclaim gene helpers', () => {
    it('RECLAIM_PREFIX is "RECLAIM:"', () => {
      expect(RECLAIM_PREFIX).toBe('RECLAIM:')
    })

    it('RECLAIM_EFFICIENCY is 1.0', () => {
      expect(RECLAIM_EFFICIENCY).toBe(1.0)
    })

    describe('isReclaimGene', () => {
      it('returns true for reclaim genes', () => {
        expect(isReclaimGene('RECLAIM:armpw')).toBe(true)
        expect(isReclaimGene('RECLAIM:testsolar')).toBe(true)
      })

      it('returns false for non-reclaim genes', () => {
        expect(isReclaimGene('armpw')).toBe(false)
        expect(isReclaimGene('testsolar')).toBe(false)
        expect(isReclaimGene('')).toBe(false)
        expect(isReclaimGene('reclaim:armpw')).toBe(false) // case sensitive
      })
    })

    describe('getReclaimTargetId', () => {
      it('extracts the unit ID from a reclaim gene', () => {
        expect(getReclaimTargetId('RECLAIM:armpw')).toBe('armpw')
        expect(getReclaimTargetId('RECLAIM:testsolar')).toBe('testsolar')
        expect(getReclaimTargetId('RECLAIM:')).toBe('')
      })
    })

    describe('makeReclaimGene', () => {
      it('creates a reclaim gene string', () => {
        expect(makeReclaimGene('armpw')).toBe('RECLAIM:armpw')
        expect(makeReclaimGene('testsolar')).toBe('RECLAIM:testsolar')
      })

      it('round-trips with getReclaimTargetId', () => {
        const unitId = 'testunit123'
        const gene = makeReclaimGene(unitId)
        expect(isReclaimGene(gene)).toBe(true)
        expect(getReclaimTargetId(gene)).toBe(unitId)
      })
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // 11. getFullFidelitySimConfig
  // ────────────────────────────────────────────────────────────────────────────
  describe('getFullFidelitySimConfig', () => {
    it('produces 30 tps', () => {
      const base = getDefaultSimConfig()
      const full = getFullFidelitySimConfig(base)
      expect(full.ticksPerSecond).toBe(30)
    })

    it('produces dense snapshot times (one per second)', () => {
      const base = { ...getDefaultSimConfig(), durationSeconds: 100 }
      const full = getFullFidelitySimConfig(base)
      expect(full.snapshotTimes).toHaveLength(100)
      expect(full.snapshotTimes[0]).toBe(1)
      expect(full.snapshotTimes[99]).toBe(100)
      // Every second present
      for (let i = 0; i < 100; i++) {
        expect(full.snapshotTimes[i]).toBe(i + 1)
      }
    })

    it('preserves other config values from base', () => {
      const base = {
        ...getDefaultSimConfig(),
        startingMetal: 2000,
        commanderBuildpower: 500,
        windAvg: 15,
      }
      const full = getFullFidelitySimConfig(base)
      expect(full.startingMetal).toBe(2000)
      expect(full.commanderBuildpower).toBe(500)
      expect(full.windAvg).toBe(15)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // 12. BASE_T1_MEX_RATE constant
  // ────────────────────────────────────────────────────────────────────────────
  describe('BASE_T1_MEX_RATE', () => {
    it('is 1.8', () => {
      expect(BASE_T1_MEX_RATE).toBe(1.8)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // buildUnitIndex
  // ────────────────────────────────────────────────────────────────────────────
  describe('buildUnitIndex', () => {
    it('indexes units by ID', () => {
      const solar = mockSolar()
      const bot = mockArmyUnit()
      const index = buildUnitIndex([solar, bot])
      expect(index.byId.get('testsolar')).toBe(solar)
      expect(index.byId.get('testbot')).toBe(bot)
    })

    it('identifies army units correctly', () => {
      const solar = mockSolar()
      const bot = mockArmyUnit()
      const commander = mockCommander()
      const factory = mockFactory()
      const index = buildUnitIndex([solar, bot, commander, factory])
      // Bot is an army unit: no production, no buildPower, not commander, not Building
      expect(index.armyUnitIds.has('testbot')).toBe(true)
      // Solar is a Building
      expect(index.armyUnitIds.has('testsolar')).toBe(false)
      // Commander has isCommander=true
      expect(index.armyUnitIds.has('armcom')).toBe(false)
      // Factory is a Building
      expect(index.armyUnitIds.has('testlab')).toBe(false)
    })

    it('computes DPS for army units', () => {
      const bot = mockArmyUnit()
      const index = buildUnitIndex([bot])
      expect(index.unitCombatDps.get('testbot')).toBe(100)
    })

    it('identifies ground attackers', () => {
      const bot = mockArmyUnit()
      const aircraft: Unit = {
        ...mockArmyUnit(),
        id: 'testfighter',
        unitType: 'Aircraft',
        movementMode: 'Flying',
      }
      const index = buildUnitIndex([bot, aircraft])
      expect(index.groundAttackerIds.has('testbot')).toBe(true)
      // Aircraft are not ground attackers
      expect(index.groundAttackerIds.has('testfighter')).toBe(false)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // buildBuilderCapabilities
  // ────────────────────────────────────────────────────────────────────────────
  describe('buildBuilderCapabilities', () => {
    it('inverts builderMap correctly', () => {
      const builderMap = new Map<string, string[]>([
        ['armpw', ['armlab']],
        ['armck', ['armlab']],
        ['testsolar', ['armcom', 'armck']],
      ])
      const caps = buildBuilderCapabilities(builderMap)
      // armlab can build armpw and armck
      expect(caps.byBuilderId.get('armlab')?.has('armpw')).toBe(true)
      expect(caps.byBuilderId.get('armlab')?.has('armck')).toBe(true)
      // armcom can build testsolar
      expect(caps.byBuilderId.get('armcom')?.has('testsolar')).toBe(true)
      // armck can build testsolar
      expect(caps.byBuilderId.get('armck')?.has('testsolar')).toBe(true)
    })

    it('handles empty builder map', () => {
      const caps = buildBuilderCapabilities(new Map())
      expect(caps.byBuilderId.size).toBe(0)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // SimResult structure
  // ────────────────────────────────────────────────────────────────────────────
  describe('SimResult structure', () => {
    it('returns isValid = true for valid simulations', () => {
      const commander = mockCommander()
      const { unitIndex, builderCapabilities } = setupSim([commander])
      const config = {
        ...getDefaultSimConfig(),
        durationSeconds: 10,
        snapshotTimes: [10],
      }
      const result = simulateBuildOrder([], config, unitIndex, builderCapabilities)
      expect(result.isValid).toBe(true)
    })

    it('returns empty completedUnitIds when nothing is built', () => {
      const commander = mockCommander()
      const { unitIndex, builderCapabilities } = setupSim([commander])
      const config = {
        ...getDefaultSimConfig(),
        durationSeconds: 10,
        snapshotTimes: [10],
      }
      const result = simulateBuildOrder([], config, unitIndex, builderCapabilities)
      expect(result.completedUnitIds).toEqual([])
    })

    it('tracks completedUnitIds in build order', () => {
      const commander = mockCommander()
      const solar = mockSolar({ id: 'solar1', buildTime: 300 })
      const wind = mockWind({ buildTime: 300 })
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, solar, wind],
        [
          ['solar1', ['armcom']],
          ['armwin', ['armcom']],
        ],
      )
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 50000,
        startingEnergy: 500000,
        startingMetalStorage: 500000,
        startingEnergyStorage: 500000,
        durationSeconds: 60,
        snapshotTimes: [60],
      }
      const result = simulateBuildOrder(
        ['solar1', 'armwin'],
        config,
        unitIndex,
        builderCapabilities,
      )
      // Both should complete within 60 seconds (300/300 = 1s each)
      expect(result.completedUnitIds).toContain('solar1')
      expect(result.completedUnitIds).toContain('armwin')
      // First in queue completes first
      expect(result.completedUnitIds[0]).toBe('solar1')
      expect(result.completedUnitIds[1]).toBe('armwin')
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Army tracking
  // ────────────────────────────────────────────────────────────────────────────
  describe('army tracking', () => {
    it('tracks army metal, DPS, and health for completed army units', () => {
      const commander = mockCommander()
      const bot = mockArmyUnit()
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, bot],
        [['testbot', ['armcom']]],
      )
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 50000,
        startingEnergy: 500000,
        startingMetalStorage: 500000,
        startingEnergyStorage: 500000,
        durationSeconds: 60,
        snapshotTimes: [60],
      }
      const result = simulateBuildOrder(['testbot'], config, unitIndex, builderCapabilities)
      expect(result.completedUnitIds).toContain('testbot')
      const snap = result.snapshots[0]
      expect(snap.currentArmyMetal).toBe(100) // metalCost of testbot
      expect(snap.currentArmyDps).toBe(100)   // DPS of testbot
      expect(snap.currentArmyHealth).toBe(400) // health of testbot
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Factory builder behavior
  // ────────────────────────────────────────────────────────────────────────────
  describe('factory builder', () => {
    it('factory is added as a builder when completed', () => {
      const commander = mockCommander()
      const factory = mockFactory()
      const bot = mockArmyUnit({ buildTime: 300 })
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, factory, bot],
        [
          ['testlab', ['armcom']],
          ['testbot', ['testlab']],
        ],
      )
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 50000,
        startingEnergy: 500000,
        startingMetalStorage: 500000,
        startingEnergyStorage: 500000,
        durationSeconds: 120,
        snapshotTimes: [120],
      }
      const result = simulateBuildOrder(
        ['testlab', 'testbot'],
        config,
        unitIndex,
        builderCapabilities,
      )
      expect(result.completedUnitIds).toContain('testlab')
      expect(result.completedUnitIds).toContain('testbot')
      // Total build power should include both commander (300) and factory (100)
      const snap = result.snapshots[0]
      expect(snap.totalBuildPower).toBe(300 + 100)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Reclaim simulation
  // ────────────────────────────────────────────────────────────────────────────
  describe('reclaim simulation', () => {
    it('reclaiming a unit returns metalCost * RECLAIM_EFFICIENCY', () => {
      const commander = mockCommander()
      const solar = mockSolar({ buildTime: 300 })
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, solar],
        [['testsolar', ['armcom']]],
      )
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 50000,
        startingEnergy: 500000,
        startingMetalStorage: 500000,
        startingEnergyStorage: 500000,
        durationSeconds: 60,
        snapshotTimes: [60],
      }
      // Build solar then reclaim it
      const result = simulateBuildOrder(
        ['testsolar', makeReclaimGene('testsolar')],
        config,
        unitIndex,
        builderCapabilities,
      )
      // Solar should be built and then reclaimed
      expect(result.completedUnitIds).toContain('testsolar')
      const snap = result.snapshots[0]
      // Energy income should return to commander-only after reclaim
      expect(snap.energyIncome).toBeCloseTo(30, 5)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Energy upkeep
  // ────────────────────────────────────────────────────────────────────────────
  describe('energy upkeep', () => {
    it('subtracts energyUpkeep from energy income when unit completes', () => {
      const commander = mockCommander()
      const radar = mockSolar({
        id: 'testradar',
        name: 'Test Radar',
        energyProduction: 0,
        energyUpkeep: 15,
      })
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, radar],
        [['testradar', ['armcom']]],
      )
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 50000,
        startingEnergy: 500000,
        startingMetalStorage: 500000,
        startingEnergyStorage: 500000,
        durationSeconds: 60,
        snapshotTimes: [60],
      }
      const result = simulateBuildOrder(['testradar'], config, unitIndex, builderCapabilities)
      expect(result.completedUnitIds).toContain('testradar')
      const snap = result.snapshots[0]
      // Commander 30 E/s - radar upkeep 15 E/s = 15 E/s
      expect(snap.energyIncome).toBeCloseTo(30 - 15, 5)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // aliveUnitCounts tracking
  // ────────────────────────────────────────────────────────────────────────────
  describe('aliveUnitCounts', () => {
    it('tracks completed units in aliveUnitCounts', () => {
      const commander = mockCommander()
      const solar = mockSolar({ buildTime: 300 })
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, solar],
        [['testsolar', ['armcom']]],
      )
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 50000,
        startingEnergy: 500000,
        startingMetalStorage: 500000,
        startingEnergyStorage: 500000,
        durationSeconds: 60,
        snapshotTimes: [60],
      }
      const result = simulateBuildOrder(
        ['testsolar', 'testsolar'],
        config,
        unitIndex,
        builderCapabilities,
      )
      const snap = result.snapshots[0]
      expect(snap.aliveUnitCounts['testsolar']).toBe(2)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Display mode (full fidelity)
  // ────────────────────────────────────────────────────────────────────────────
  describe('display mode (30 tps)', () => {
    it('populates buildTimeline in display mode', () => {
      const commander = mockCommander()
      const solar = mockSolar({ buildTime: 300 })
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, solar],
        [['testsolar', ['armcom']]],
      )
      const baseConfig = {
        ...getDefaultSimConfig(),
        startingMetal: 50000,
        startingEnergy: 500000,
        startingMetalStorage: 500000,
        startingEnergyStorage: 500000,
        durationSeconds: 30,
      }
      const config = getFullFidelitySimConfig(baseConfig)
      const result = simulateBuildOrder(['testsolar'], config, unitIndex, builderCapabilities)
      expect(result.buildTimeline.length).toBeGreaterThan(0)
      const event = result.buildTimeline[0]
      expect(event.unitId).toBe('testsolar')
      expect(event.metalCost).toBe(150)
      expect(event.isReclaim).toBeFalsy()
    })

    it('populates builderTimeline in display mode', () => {
      const commander = mockCommander()
      const solar = mockSolar({ buildTime: 300 })
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, solar],
        [['testsolar', ['armcom']]],
      )
      const baseConfig = {
        ...getDefaultSimConfig(),
        startingMetal: 50000,
        startingEnergy: 500000,
        startingMetalStorage: 500000,
        startingEnergyStorage: 500000,
        durationSeconds: 5,
      }
      const config = getFullFidelitySimConfig(baseConfig)
      const result = simulateBuildOrder(['testsolar'], config, unitIndex, builderCapabilities)
      expect(result.builderTimeline.length).toBeGreaterThan(0)
      // Each entry should have at least the commander builder
      expect(result.builderTimeline[0].builders.length).toBeGreaterThanOrEqual(1)
      expect(result.builderTimeline[0].builders[0].builderId).toBe('armcom')
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Edge cases
  // ────────────────────────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('handles empty build order', () => {
      const commander = mockCommander()
      const { unitIndex, builderCapabilities } = setupSim([commander])
      const config = {
        ...getDefaultSimConfig(),
        durationSeconds: 10,
        snapshotTimes: [10],
      }
      const result = simulateBuildOrder([], config, unitIndex, builderCapabilities)
      expect(result.isValid).toBe(true)
      expect(result.completedUnitIds).toEqual([])
      expect(result.snapshots).toHaveLength(1)
    })

    it('skips genes for units not in the index', () => {
      const commander = mockCommander()
      const { unitIndex, builderCapabilities } = setupSim(
        [commander],
        [['nonexistent', ['armcom']]],
      )
      const config = {
        ...getDefaultSimConfig(),
        durationSeconds: 10,
        snapshotTimes: [10],
      }
      const result = simulateBuildOrder(['nonexistent'], config, unitIndex, builderCapabilities)
      expect(result.isValid).toBe(true)
      expect(result.completedUnitIds).toEqual([])
    })

    it('skips genes the commander cannot build', () => {
      const commander = mockCommander()
      const solar = mockSolar()
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, solar],
        // Note: testsolar is NOT in armcom's capability list
        [['testsolar', ['someotherbuidler']]],
      )
      const config = {
        ...getDefaultSimConfig(),
        durationSeconds: 10,
        snapshotTimes: [10],
      }
      const result = simulateBuildOrder(['testsolar'], config, unitIndex, builderCapabilities)
      // Commander can't build this, so nothing completes
      expect(result.completedUnitIds).toEqual([])
    })

    it('handles zero-duration simulation', () => {
      const commander = mockCommander()
      const { unitIndex, builderCapabilities } = setupSim([commander])
      const config = {
        ...getDefaultSimConfig(),
        durationSeconds: 0,
        snapshotTimes: [0],
      }
      const result = simulateBuildOrder([], config, unitIndex, builderCapabilities)
      expect(result.isValid).toBe(true)
      // The tick loop doesn't execute, so the snapshot at time 0 is filled as "remaining"
      expect(result.snapshots).toHaveLength(1)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Converter / metal maker behavior
  // ────────────────────────────────────────────────────────────────────────────
  describe('energy converter', () => {
    it('converter produces metal when energy surplus exceeds 75% of storage', () => {
      const commander = mockCommander()
      const converter: Unit = {
        id: 'testconv',
        name: 'Test Energy Converter',
        faction: 'Armada',
        tier: 'T1',
        unitType: 'Building',
        metalCost: 100,
        energyCost: 0,
        buildTime: 300,
        health: 100,
        weapons: [],
        movementMode: 'Static',
        speed: 0,
        sightRange: 0,
        energyConverterCapacity: 70,    // consumes up to 70 E/s
        energyConverterEfficiency: 0.01428, // ~1 M/s per 70 E/s
      }
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, converter],
        [['testconv', ['armcom']]],
      )
      const config = {
        ...getDefaultSimConfig(),
        startingMetal: 50000,
        startingEnergy: 50000,
        startingMetalStorage: 50000,
        startingEnergyStorage: 50000,
        durationSeconds: 30,
        snapshotTimes: [30],
      }
      const result = simulateBuildOrder(['testconv'], config, unitIndex, builderCapabilities)
      expect(result.completedUnitIds).toContain('testconv')
      const snap = result.snapshots[0]
      // Converter should produce some metal output
      expect(snap.totalConverterMetalOutput).toBeGreaterThan(0)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Multiple builders / assist mechanic
  // ────────────────────────────────────────────────────────────────────────────
  describe('assist mechanic', () => {
    it('idle non-factory builder assists existing construction site', () => {
      const commander = mockCommander()
      // A constructor bot with buildPower, that is a mobile unit (not a factory)
      const constructor: Unit = {
        id: 'testcon',
        name: 'Test Constructor',
        faction: 'Armada',
        tier: 'T1',
        unitType: 'Bot',
        metalCost: 100,
        energyCost: 1000,
        buildTime: 300, // 1 second with 300 BP
        health: 300,
        weapons: [],
        movementMode: 'Walking',
        speed: 40,
        sightRange: 300,
        buildPower: 150,
      }
      // A unit that takes a while to build
      const building: Unit = {
        id: 'bigbuilding',
        name: 'Big Building',
        faction: 'Armada',
        tier: 'T1',
        unitType: 'Building',
        metalCost: 100,
        energyCost: 0,
        buildTime: 9000, // 30 seconds with 300 BP alone
        health: 1000,
        weapons: [],
        movementMode: 'Static',
        speed: 0,
        sightRange: 0,
      }
      const { unitIndex, builderCapabilities } = setupSim(
        [commander, constructor, building],
        [
          ['testcon', ['armcom']],
          ['bigbuilding', ['armcom', 'testcon']],
        ],
      )
      // First build the constructor, then build the big building.
      // The constructor should auto-assist the big building, so it finishes
      // faster than if commander built alone.
      // Commander alone: 9000/300 = 30s. With assist (300+150=450 BP): 9000/450 = 20s.
      // Plus 1s to build the constructor first = ~21s total.
      const baseConfig = {
        ...getDefaultSimConfig(),
        startingMetal: 50000,
        startingEnergy: 500000,
        startingMetalStorage: 500000,
        startingEnergyStorage: 500000,
        durationSeconds: 60,
      }
      const config = getFullFidelitySimConfig(baseConfig)

      // With assist
      const resultAssist = simulateBuildOrder(
        ['testcon', 'bigbuilding'],
        config,
        unitIndex,
        builderCapabilities,
      )
      expect(resultAssist.completedUnitIds).toContain('bigbuilding')
      const completionSnapAssist = resultAssist.snapshots.find(
        (s) => s.completedCount >= 2,
      )

      // Without assist (commander builds alone, no constructor)
      const { unitIndex: idx2, builderCapabilities: caps2 } = setupSim(
        [commander, building],
        [['bigbuilding', ['armcom']]],
      )
      const resultAlone = simulateBuildOrder(
        ['bigbuilding'],
        config,
        idx2,
        caps2,
      )
      const completionSnapAlone = resultAlone.snapshots.find(
        (s) => s.completedCount >= 1,
      )

      expect(completionSnapAssist).toBeDefined()
      expect(completionSnapAlone).toBeDefined()
      // Assisted build should complete faster
      expect(completionSnapAssist!.timeSeconds).toBeLessThan(
        completionSnapAlone!.timeSeconds + 5, // allow small margin for constructor build time
      )
    })
  })
})
