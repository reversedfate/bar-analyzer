import { describe, it, expect } from 'vitest'
import {
  statDefinitions,
  getStatDef,
  getStatsByCategory,
  calculateDerivedStats,
  formatStatValue,
} from '../src/services/statCalculator'
import type { Unit } from '../src/types'

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'testunit',
    name: 'Test Unit',
    faction: 'Armada',
    tier: 'T1',
    unitType: 'Bot',
    metalCost: 100,
    energyCost: 7000,
    buildTime: 2000,
    health: 1000,
    weapons: [],
    movementMode: 'Walking',
    speed: 50,
    sightRange: 500,
    ...overrides,
  } as Unit
}

describe('statDefinitions', () => {
  it('has 26 stat definitions', () => {
    expect(statDefinitions.length).toBe(26)
  })

  it('every stat returns a number from getValue', () => {
    const unit = makeUnit({
      weapons: [
        { id: 'w1', name: 'Gun', damage: 50, reload: 1, range: 300, projectileType: 'Laser', dps: 50 },
      ],
      buildPower: 100,
      metalProduction: 2,
      energyProduction: 20,
      radarRange: 800,
      sonarRange: 0,
      jammerRange: 0,
    })
    for (const stat of statDefinitions) {
      const val = stat.getValue(unit)
      expect(typeof val).toBe('number')
      expect(Number.isFinite(val)).toBe(true)
    }
  })

  it('every stat with a format function produces a string', () => {
    const unit = makeUnit({
      weapons: [
        { id: 'w1', name: 'Gun', damage: 50, reload: 1, range: 300, projectileType: 'Laser', dps: 50 },
      ],
    })
    for (const stat of statDefinitions) {
      if (stat.format) {
        const val = stat.getValue(unit)
        expect(typeof stat.format(val)).toBe('string')
      }
    }
  })
})

describe('totalCost formula', () => {
  it('computes metalCost + energyCost / 70', () => {
    const unit = makeUnit({ metalCost: 200, energyCost: 7000 })
    const stat = getStatDef('totalCost')!
    expect(stat.getValue(unit)).toBeCloseTo(200 + 7000 / 70, 5)
  })
})

describe('totalDps', () => {
  it('sums all weapon DPS values', () => {
    const unit = makeUnit({
      weapons: [
        { id: 'w1', name: 'A', damage: 10, reload: 1, range: 100, projectileType: 'Laser', dps: 10 },
        { id: 'w2', name: 'B', damage: 20, reload: 2, range: 200, projectileType: 'Plasma', dps: 10 },
      ],
    })
    const stat = getStatDef('totalDps')!
    expect(stat.getValue(unit)).toBeCloseTo(20, 5)
  })

  it('returns 0 for units with no weapons', () => {
    const unit = makeUnit({ weapons: [] })
    const stat = getStatDef('totalDps')!
    expect(stat.getValue(unit)).toBe(0)
  })
})

describe('maxRange', () => {
  it('returns maximum weapon range', () => {
    const unit = makeUnit({
      weapons: [
        { id: 'w1', name: 'A', damage: 10, reload: 1, range: 200, projectileType: 'Laser', dps: 10 },
        { id: 'w2', name: 'B', damage: 10, reload: 1, range: 500, projectileType: 'Laser', dps: 10 },
      ],
    })
    const stat = getStatDef('maxRange')!
    expect(stat.getValue(unit)).toBe(500)
  })

  it('returns 0 with no weapons', () => {
    const unit = makeUnit({ weapons: [] })
    expect(getStatDef('maxRange')!.getValue(unit)).toBe(0)
  })
})

describe('burstDamage', () => {
  it('sums damage × burstCount for all weapons', () => {
    const unit = makeUnit({
      weapons: [
        { id: 'w1', name: 'A', damage: 50, reload: 1, range: 100, projectileType: 'Laser', burstCount: 3, dps: 150 },
        { id: 'w2', name: 'B', damage: 100, reload: 2, range: 200, projectileType: 'Plasma', dps: 50 },
      ],
    })
    const stat = getStatDef('burstDamage')!
    // 50*3 + 100*1 = 250
    expect(stat.getValue(unit)).toBe(250)
  })
})

describe('healthPerMetal', () => {
  it('computes health / metalCost', () => {
    const unit = makeUnit({ health: 2000, metalCost: 100 })
    expect(getStatDef('healthPerMetal')!.getValue(unit)).toBeCloseTo(20, 5)
  })

  it('returns 0 when metalCost is 0', () => {
    const unit = makeUnit({ health: 2000, metalCost: 0 })
    expect(getStatDef('healthPerMetal')!.getValue(unit)).toBe(0)
  })
})

describe('dpsPerMetal', () => {
  it('computes totalDps / metalCost', () => {
    const unit = makeUnit({
      metalCost: 200,
      weapons: [{ id: 'w1', name: 'A', damage: 100, reload: 1, range: 300, projectileType: 'Laser', dps: 100 }],
    })
    expect(getStatDef('dpsPerMetal')!.getValue(unit)).toBeCloseTo(0.5, 5)
  })
})

describe('effectiveHealth', () => {
  it('computes health * (1 + speed / 200)', () => {
    const unit = makeUnit({ health: 1000, speed: 100 })
    // 1000 * (1 + 100/200) = 1000 * 1.5 = 1500
    expect(getStatDef('effectiveHealth')!.getValue(unit)).toBeCloseTo(1500, 5)
  })

  it('equals health when speed is 0', () => {
    const unit = makeUnit({ health: 1000, speed: 0 })
    expect(getStatDef('effectiveHealth')!.getValue(unit)).toBeCloseTo(1000, 5)
  })
})

describe('combatValue', () => {
  it('computes dps * (1 + range/500) * (1 + health/1000)', () => {
    const unit = makeUnit({
      health: 2000,
      weapons: [{ id: 'w1', name: 'A', damage: 100, reload: 1, range: 500, projectileType: 'Laser', dps: 100 }],
    })
    // 100 * (1 + 500/500) * (1 + 2000/1000) = 100 * 2 * 3 = 600
    expect(getStatDef('combatValue')!.getValue(unit)).toBeCloseTo(600, 5)
  })
})

describe('getStatDef', () => {
  it('returns stat by key', () => {
    expect(getStatDef('health')).toBeDefined()
    expect(getStatDef('health')!.key).toBe('health')
  })

  it('returns undefined for unknown key', () => {
    expect(getStatDef('nonexistent')).toBeUndefined()
  })
})

describe('getStatsByCategory', () => {
  it('groups stats into categories', () => {
    const grouped = getStatsByCategory()
    expect(grouped['cost']).toBeDefined()
    expect(grouped['combat']).toBeDefined()
    expect(grouped['movement']).toBeDefined()
    expect(grouped['vision']).toBeDefined()
    expect(grouped['economy']).toBeDefined()
    expect(grouped['derived']).toBeDefined()
  })

  it('all stats are accounted for', () => {
    const grouped = getStatsByCategory()
    const totalGrouped = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0)
    expect(totalGrouped).toBe(statDefinitions.length)
  })
})

describe('calculateDerivedStats', () => {
  it('computes correct derived stats', () => {
    const unit = makeUnit({
      metalCost: 200,
      energyCost: 7000,
      health: 2000,
      speed: 60,
      buildPower: 100,
      metalProduction: 2,
      energyProduction: 20,
      weapons: [
        { id: 'w1', name: 'A', damage: 50, reload: 1, range: 300, projectileType: 'Laser', dps: 50, burstCount: 2 },
        { id: 'w2', name: 'B', damage: 100, reload: 2, range: 500, projectileType: 'Plasma', dps: 50 },
      ],
    })
    const stats = calculateDerivedStats(unit)
    expect(stats.totalDps).toBeCloseTo(100, 5)
    expect(stats.maxRange).toBe(500)
    expect(stats.minRange).toBe(300)
    expect(stats.burstDamage).toBe(50 * 2 + 100 * 1)
    expect(stats.healthPerMetal).toBeCloseTo(10, 5)
    expect(stats.dpsPerMetal).toBeCloseTo(0.5, 5)
    const totalCost = 200 + 7000 / 70
    expect(stats.healthPerTotalCost).toBeCloseTo(2000 / totalCost, 3)
    expect(stats.dpsPerTotalCost).toBeCloseTo(100 / totalCost, 3)
    expect(stats.buildPowerPerMetal).toBeCloseTo(0.5, 5)
    expect(stats.metalPerSecondPerCost).toBeCloseTo(2 / 200, 5)
    expect(stats.energyPerSecondPerCost).toBeCloseTo(20 / 200, 5)
    expect(stats.speedPerCost).toBeCloseTo(60 / 200, 5)
  })
})

describe('formatStatValue', () => {
  it('uses stat-specific format when available', () => {
    // totalCost has format: v.toFixed(1)
    const result = formatStatValue('totalCost', 123.456)
    expect(result).toBe('123.5')
  })

  it('falls back to integer for whole numbers', () => {
    expect(formatStatValue('health', 1000)).toBe('1000')
  })

  it('falls back to 2 decimal places for floats', () => {
    expect(formatStatValue('health', 123.456)).toBe('123.46')
  })
})
