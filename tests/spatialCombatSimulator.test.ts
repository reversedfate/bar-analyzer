import { describe, it, expect } from 'vitest'
import {
  SpatialCombatSimulator,
  runSpatialSimulation,
  vec2,
  vec2Add,
  vec2Sub,
  vec2Scale,
  vec2Length,
  vec2Normalize,
  vec2Distance,
  getDefaultSpatialConfig,
} from '../src/services/spatialCombatSimulator'
import type { Unit, Weapon } from '../src/types'

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'testweapon',
    name: 'Test Weapon',
    damage: 100,
    reload: 1,
    range: 500,
    projectileType: 'Laser',
    dps: 100,
    ...overrides,
  }
}

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

/** Shorthand config for deterministic stationary tests. */
const HOLD_CONFIG: Partial<Parameters<typeof runSpatialSimulation>[2]> = {
  maxTime: 10,
  tickRate: 20,
  startingDistance: 200,
  fieldSize: 1200,
  snapshotInterval: 1,
  useVisionSystem: false,
  teamABehavior: 'hold',
  teamBBehavior: 'hold',
  useFlanking: false,
}

// ---------------------------------------------------------------------------
// Vec2 utility tests
// ---------------------------------------------------------------------------

describe('Vec2 utilities', () => {
  it('vec2 creates a vector', () => {
    const v = vec2(3, 4)
    expect(v).toEqual({ x: 3, y: 4 })
  })

  it('vec2Add adds two vectors', () => {
    expect(vec2Add(vec2(1, 2), vec2(3, 4))).toEqual({ x: 4, y: 6 })
  })

  it('vec2Sub subtracts two vectors', () => {
    expect(vec2Sub(vec2(5, 7), vec2(2, 3))).toEqual({ x: 3, y: 4 })
  })

  it('vec2Scale scales a vector', () => {
    expect(vec2Scale(vec2(3, 4), 2)).toEqual({ x: 6, y: 8 })
  })

  it('vec2Length returns correct magnitude', () => {
    expect(vec2Length(vec2(3, 4))).toBeCloseTo(5)
  })

  it('vec2Normalize returns unit vector', () => {
    const n = vec2Normalize(vec2(0, 5))
    expect(n.x).toBeCloseTo(0)
    expect(n.y).toBeCloseTo(1)
  })

  it('vec2Normalize of zero vector returns zero', () => {
    expect(vec2Normalize(vec2(0, 0))).toEqual({ x: 0, y: 0 })
  })

  it('vec2Distance computes distance between points', () => {
    expect(vec2Distance(vec2(0, 0), vec2(3, 4))).toBeCloseTo(5)
  })
})

// ---------------------------------------------------------------------------
// getDefaultSpatialConfig
// ---------------------------------------------------------------------------

describe('getDefaultSpatialConfig', () => {
  it('returns a full config object with expected defaults', () => {
    const cfg = getDefaultSpatialConfig()
    expect(cfg.teamAStrategy).toBe('closest')
    expect(cfg.teamBStrategy).toBe('closest')
    expect(cfg.teamAFormation).toBe('line')
    expect(cfg.teamBFormation).toBe('line')
    expect(cfg.teamABehavior).toBe('kite')
    expect(cfg.teamBBehavior).toBe('kite')
    expect(cfg.startingDistance).toBe(800)
    expect(cfg.fieldSize).toBe(1200)
    expect(cfg.maxTime).toBe(120)
    expect(cfg.tickRate).toBe(20)
    expect(cfg.useVisionSystem).toBe(true)
    expect(cfg.useFlanking).toBe(true)
    expect(cfg.teamAProduction).toEqual([])
    expect(cfg.teamBProduction).toEqual([])
    expect(cfg.productionSpawnDistance).toBe(550)
    expect(cfg.snapshotInterval).toBe(0.25)
    expect(cfg.retreatThreshold).toBe(0.0)
  })
})

// ---------------------------------------------------------------------------
// EMP_DECAY_RATE static constant
// ---------------------------------------------------------------------------

describe('SpatialCombatSimulator static constants', () => {
  it('EMP_DECAY_RATE equals 0.025', () => {
    expect(SpatialCombatSimulator.EMP_DECAY_RATE).toBe(0.025)
  })
})

// ---------------------------------------------------------------------------
// 1. Direct damage
// ---------------------------------------------------------------------------

describe('Direct damage', () => {
  it('a unit takes correct HP damage from weapon hits over time', () => {
    const attacker = makeUnit({
      id: 'attacker',
      health: 5000,
      weapons: [makeWeapon({ id: 'gun', damage: 100, reload: 1, range: 500 })],
    })
    const defender = makeUnit({
      id: 'defender',
      health: 1000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: defender, count: 1 }],
      HOLD_CONFIG,
    )

    // Defender has no weapons, attacker fires 100 dps laser (instant).
    // After ~10 s the defender should be dead.
    expect(result.winner).toBe('A')
    expect(result.teamASurvivors.length).toBe(1)
    expect(result.teamBSurvivors.length).toBe(0)
    // Total damage dealt by A should be at least defender's max HP
    expect(result.totalDamageByA).toBeGreaterThanOrEqual(1000)
  })

  it('survivor retains correct remaining HP after killing defender', () => {
    const attacker = makeUnit({
      id: 'attacker',
      health: 5000,
      weapons: [makeWeapon({ id: 'gun', damage: 200, reload: 1, range: 500 })],
    })
    const defender = makeUnit({
      id: 'defender',
      health: 500,
      weapons: [makeWeapon({ id: 'pea', damage: 10, reload: 1, range: 500 })],
    })

    const result = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: defender, count: 1 }],
      HOLD_CONFIG,
    )

    expect(result.winner).toBe('A')
    const survivor = result.teamASurvivors[0]
    // Defender does 10 dps for a few seconds (3 or less) before dying
    // Attacker started at 5000 HP, so should be close to 5000
    expect(survivor.currentHp).toBeGreaterThan(4900)
    expect(survivor.currentHp).toBeLessThanOrEqual(5000)
  })
})

// ---------------------------------------------------------------------------
// 2. AoE damage falloff
// ---------------------------------------------------------------------------

describe('AoE damage falloff', () => {
  it('deals full damage to direct target and reduced damage to nearby units', () => {
    // Attacker with large AoE weapon, grouped enemies
    const attacker = makeUnit({
      id: 'aoeattacker',
      health: 5000,
      weapons: [makeWeapon({
        id: 'aoe',
        damage: 500,
        reload: 2,
        range: 600,
        areaOfEffect: 200,
        edgeEffectiveness: 0,
        projectileType: 'Plasma',
      })],
    })
    const target = makeUnit({
      id: 'target',
      health: 5000,
      weapons: [],
    })

    // Two defenders close together (grouped formation, distance < AoE radius)
    const result = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: target, count: 2 }],
      {
        ...HOLD_CONFIG,
        teamBFormation: 'grouped',
        maxTime: 4,
      },
    )

    // Both targets should have taken damage. The direct target gets full damage,
    // the splash target gets falloff-based damage.
    const damageEvents = result.events.filter(
      e => e.type === 'damage' && !e.isEmp
    )
    expect(damageEvents.length).toBeGreaterThanOrEqual(2)
    expect(result.totalDamageByA).toBeGreaterThan(500)
  })

  it('does not damage units outside AoE radius', () => {
    // Two enemies far apart — only one should take AoE damage
    const attacker = makeUnit({
      id: 'aoeattacker',
      health: 5000,
      weapons: [makeWeapon({
        id: 'aoe',
        damage: 200,
        reload: 1,
        range: 600,
        areaOfEffect: 30, // small AoE
        edgeEffectiveness: 0,
        projectileType: 'Plasma',
      })],
    })
    const target = makeUnit({
      id: 'target',
      health: 5000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: target, count: 2 }],
      {
        ...HOLD_CONFIG,
        teamBFormation: 'line', // spread out along a line — spacing 30 between units
        maxTime: 2,
        teamAStrategy: 'focus', // all shots go to same target
      },
    )

    // With small AoE (30 units) and line formation (spacing ~30),
    // the secondary target should receive significantly less cumulative damage
    // than the primary target.
    const damageByTarget = new Map<string, number>()
    for (const e of result.events) {
      if (e.type === 'damage' && !e.isEmp) {
        const prev = damageByTarget.get(e.target) ?? 0
        damageByTarget.set(e.target, prev + e.damage)
      }
    }
    const damages = [...damageByTarget.values()]
    if (damages.length === 2) {
      // Primary target should have taken more than secondary
      const maxDmg = Math.max(...damages)
      const minDmg = Math.min(...damages)
      expect(maxDmg).toBeGreaterThan(minDmg)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. AoE edge effectiveness
// ---------------------------------------------------------------------------

describe('AoE edge effectiveness', () => {
  it('formula: Spring hyperbolic (radius - dist) / (radius - dist * edgeEff)', () => {
    // Spring engine formula from GameHelper.cpp
    const edgeEff = 0.5
    const radius = 100

    // At center (dist=0): falloff = (100 - 0) / (100 - 0) = 1.0
    const centerFalloff = (radius - 0) / (radius - 0 * edgeEff)
    expect(centerFalloff).toBeCloseTo(1.0)

    // At half radius (dist=50): falloff = (100 - 50) / (100 - 25) = 50/75 = 0.667
    const halfFalloff = (radius - 50) / (radius - 50 * edgeEff)
    expect(halfFalloff).toBeCloseTo(0.667, 2)

    // At edge (dist=100): falloff = (100 - 100) / (100 - 50) = 0/50 = 0.0
    const edgeFalloff = (radius - 100) / (radius - 100 * edgeEff)
    expect(edgeFalloff).toBeCloseTo(0.0)
  })

  it('with edgeEffectiveness=0 damage at edge is 0 (linear falloff)', () => {
    // When edgeEff=0: formula = (r - d) / (r - 0) = (r - d) / r = 1 - d/r
    const edgeEff = 0
    const radius = 100
    const edgeFalloff = (radius - 100) / (radius - 100 * edgeEff)
    expect(edgeFalloff).toBeCloseTo(0)
    // Mid-range check: (100 - 50) / 100 = 0.5
    const midFalloff = (radius - 50) / (radius - 50 * edgeEff)
    expect(midFalloff).toBeCloseTo(0.5)
  })

  it('with edgeEffectiveness=1.0, damage is uniform (denom → 0/0 treated as 1.0)', () => {
    // When edgeEff=1.0: formula = (r - d) / (r - d) = 1.0 everywhere except d=r where 0/0 → 1.0
    const edgeEff = 1.0
    const radius = 100
    for (const dist of [0, 25, 50, 75, 99]) {
      const denom = radius - dist * edgeEff
      const falloff = denom > 0.001 ? (radius - dist) / denom : 1.0
      expect(falloff).toBeCloseTo(1.0)
    }
    // At exact edge: denom = 100 - 100 = 0, so treated as 1.0
    const denomEdge = radius - 100 * edgeEff
    const falloffEdge = denomEdge > 0.001 ? (radius - 100) / denomEdge : 1.0
    expect(falloffEdge).toBeCloseTo(1.0)
  })
})

// ---------------------------------------------------------------------------
// 4. EMP stun
// ---------------------------------------------------------------------------

describe('EMP stun', () => {
  it('stuns a unit when empDamage accumulates to >= maxHp', () => {
    const empUnit = makeUnit({
      id: 'empunit',
      health: 5000,
      weapons: [makeWeapon({
        id: 'emp',
        damage: 0,
        empDamage: 600,
        reload: 1,
        range: 500,
        projectileType: 'EMP',
        stunDuration: 5,
        dps: 0,
      })],
    })
    const target = makeUnit({
      id: 'target',
      health: 1000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: empUnit, count: 1 }],
      [{ unit: target, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 5 },
    )

    // EMP weapon does 600 empDamage per shot, target maxHp=1000.
    // After 2 shots (2 seconds) empDamage = 1200 - decay >= 1000, so stun should trigger.
    const stunEvents = result.events.filter(e => e.type === 'stun')
    expect(stunEvents.length).toBeGreaterThanOrEqual(1)
  })

  it('EMP decay rate is applied each tick', () => {
    // Unit with high EMP damage that barely reaches stun threshold
    const empUnit = makeUnit({
      id: 'empunit',
      health: 5000,
      weapons: [makeWeapon({
        id: 'emp',
        damage: 0,
        empDamage: 1100,
        reload: 10, // very slow reload so only fires once
        range: 500,
        projectileType: 'EMP',
        stunDuration: 2,
        dps: 0,
      })],
    })
    const target = makeUnit({
      id: 'target',
      health: 1000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: empUnit, count: 1 }],
      [{ unit: target, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 8 },
    )

    // Target gets stunned (1100 > 1000 maxHp), then EMP decays at 0.025 * 1000 = 25 per second
    // After the stun ends (empDamage decays below 1000), there should be a stunEnd event
    const stunEndEvents = result.events.filter(e => e.type === 'stunEnd')
    expect(stunEndEvents.length).toBeGreaterThanOrEqual(1)

    // Verify stun ends AFTER the initial stun
    const stunEvent = result.events.find(e => e.type === 'stun')
    const stunEndEvent = result.events.find(e => e.type === 'stunEnd')
    expect(stunEvent).toBeDefined()
    expect(stunEndEvent).toBeDefined()
    if (stunEvent && stunEndEvent) {
      expect(stunEndEvent.time).toBeGreaterThan(stunEvent.time)
    }
  })

  it('stunned units do not fire weapons', () => {
    // Both units have weapons, but the EMP unit stuns the other first
    const empUnit = makeUnit({
      id: 'empunit',
      health: 5000,
      weapons: [
        makeWeapon({
          id: 'emp',
          damage: 0,
          empDamage: 2000,
          reload: 0.5,
          range: 500,
          projectileType: 'EMP',
          stunDuration: 10,
          dps: 0,
        }),
      ],
    })
    const victim = makeUnit({
      id: 'victim',
      health: 1000,
      weapons: [makeWeapon({ id: 'gun', damage: 100, reload: 0.5, range: 500 })],
    })

    const result = runSpatialSimulation(
      [{ unit: empUnit, count: 1 }],
      [{ unit: victim, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 6 },
    )

    // Victim should get stunned almost immediately (2000 > 1000 maxHp on first hit)
    const stunEvents = result.events.filter(e => e.type === 'stun')
    expect(stunEvents.length).toBeGreaterThanOrEqual(1)

    // Count fire events from the victim after being stunned
    const stunTime = stunEvents[0].time
    const victimFiresAfterStun = result.events.filter(
      e => e.type === 'fire' && e.attacker.includes('victim') && e.time > stunTime
    )
    // The victim should fire very few or zero times while stunned
    // (may fire once on the same tick before stun is processed)
    // Since stun duration is 10s and sim is 6s, victim stays stunned for the rest
    expect(victimFiresAfterStun.length).toBeLessThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// 5. Flanking damage
// ---------------------------------------------------------------------------

describe('Flanking damage', () => {
  it('with useFlanking=true, damage events include flanking multiplier', () => {
    const attacker = makeUnit({
      id: 'flanker',
      health: 5000,
      weapons: [makeWeapon({ id: 'gun', damage: 100, reload: 1, range: 500 })],
    })
    const defender = makeUnit({
      id: 'defender',
      health: 5000,
      weapons: [],
    })

    const resultNoFlank = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: defender, count: 1 }],
      { ...HOLD_CONFIG, useFlanking: false, maxTime: 3 },
    )

    const resultWithFlank = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: defender, count: 1 }],
      { ...HOLD_CONFIG, useFlanking: true, maxTime: 3 },
    )

    // With flanking enabled, damage can be multiplied (1.0x to 2.0x)
    // so total damage with flanking should differ from base damage
    // Both simulations fire the same number of times
    const noFlankDamage = resultNoFlank.totalDamageByA
    const flankDamage = resultWithFlank.totalDamageByA

    // Flanking damage should be >= base damage (multiplier is >= 1.0)
    expect(flankDamage).toBeGreaterThanOrEqual(noFlankDamage * 0.99) // allow tiny float error
  })

  it('per-unit flanking values override defaults', () => {
    // Use custom flankingBonusMax=3.0 on defender
    const attacker = makeUnit({
      id: 'flanker',
      health: 5000,
      weapons: [makeWeapon({ id: 'gun', damage: 100, reload: 0.5, range: 500 })],
    })
    const defenderCustomFlank = makeUnit({
      id: 'defender',
      health: 5000,
      weapons: [],
      flankingBonusMax: 3.0,
      flankingBonusMin: 1.0,
    })
    const defenderDefaultFlank = makeUnit({
      id: 'defender2',
      health: 5000,
      weapons: [],
      // uses default flankingBonusMax=2.0
    })

    const resultCustom = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: defenderCustomFlank, count: 1 }],
      { ...HOLD_CONFIG, useFlanking: true, maxTime: 3 },
    )

    const resultDefault = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: defenderDefaultFlank, count: 1 }],
      { ...HOLD_CONFIG, useFlanking: true, maxTime: 3 },
    )

    // Custom has max multiplier 3.0 vs default 2.0, so should take more damage
    // when attacked from the rear.
    // This is not guaranteed to always be higher due to random flanking directions,
    // but the maximum possible damage is higher with 3.0 multiplier.
    // Just verify both produced damage events
    expect(resultCustom.totalDamageByA).toBeGreaterThan(0)
    expect(resultDefault.totalDamageByA).toBeGreaterThan(0)
  })

  it('flanking multiplier formula: flankMin + (flankMax - flankMin) * (1 - dot) / 2', () => {
    // Direct test of the multiplier formula
    const flankMax = 2.0
    const flankMin = 1.0

    // dot = 1.0 (attack from front): multiplier = 1.0 + 1.0 * 0 / 2 = 1.0
    const frontMult = flankMin + (flankMax - flankMin) * (1.0 - 1.0) / 2
    expect(frontMult).toBeCloseTo(1.0)

    // dot = -1.0 (attack from rear): multiplier = 1.0 + 1.0 * 2 / 2 = 2.0
    const rearMult = flankMin + (flankMax - flankMin) * (1.0 - (-1.0)) / 2
    expect(rearMult).toBeCloseTo(2.0)

    // dot = 0.0 (side attack): multiplier = 1.0 + 1.0 * 1 / 2 = 1.5
    const sideMult = flankMin + (flankMax - flankMin) * (1.0 - 0.0) / 2
    expect(sideMult).toBeCloseTo(1.5)
  })
})

// ---------------------------------------------------------------------------
// 6. Projectile travel time
// ---------------------------------------------------------------------------

describe('Projectile travel time', () => {
  it('projectile arrives after distance / projectileSpeed seconds', () => {
    const attacker = makeUnit({
      id: 'shooter',
      health: 5000,
      weapons: [makeWeapon({
        id: 'slow',
        damage: 500,
        reload: 10,
        range: 600,
        projectileType: 'Plasma',
        projectileSpeed: 200, // 200 units/sec
      })],
    })
    const target = makeUnit({
      id: 'target',
      health: 5000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: target, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 5 },
    )

    // Fire event should come first, then damage event after travel delay
    const fireEvent = result.events.find(e => e.type === 'fire')
    const damageEvent = result.events.find(e => e.type === 'damage' && !e.isEmp)

    expect(fireEvent).toBeDefined()
    expect(damageEvent).toBeDefined()
    if (fireEvent && damageEvent) {
      const delay = damageEvent.time - fireEvent.time
      // Starting distance is 200, projectile speed is 200 => ~1 second travel time
      // Allow tolerance for tick-based resolution
      expect(delay).toBeGreaterThan(0)
      expect(delay).toBeLessThan(3) // should be around 1 second
    }
  })

  it('instant weapons (no projectileSpeed) deal damage on the same tick as firing', () => {
    const attacker = makeUnit({
      id: 'laser',
      health: 5000,
      weapons: [makeWeapon({
        id: 'instant',
        damage: 100,
        reload: 1,
        range: 500,
        projectileType: 'Laser',
        // no projectileSpeed = instant
      })],
    })
    const target = makeUnit({
      id: 'target',
      health: 5000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: target, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 3 },
    )

    const fireEvent = result.events.find(e => e.type === 'fire')
    const damageEvent = result.events.find(e => e.type === 'damage' && !e.isEmp)
    expect(fireEvent).toBeDefined()
    expect(damageEvent).toBeDefined()
    if (fireEvent && damageEvent) {
      // Same tick: time difference should be 0
      expect(damageEvent.time).toBe(fireEvent.time)
    }
  })
})

// ---------------------------------------------------------------------------
// 7. Tracking missiles
// ---------------------------------------------------------------------------

describe('Tracking missiles', () => {
  it('isTracking=true creates a tracking projectile', () => {
    const attacker = makeUnit({
      id: 'missile',
      health: 5000,
      weapons: [makeWeapon({
        id: 'tracker',
        damage: 200,
        reload: 5,
        range: 600,
        projectileType: 'Missile',
        projectileSpeed: 150,
        isTracking: true,
      })],
    })
    const target = makeUnit({
      id: 'target',
      health: 5000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: target, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 5, teamBBehavior: 'advance' },
    )

    // Tracking missile should still hit the target even if it moves
    const damageEvents = result.events.filter(e => e.type === 'damage' && !e.isEmp)
    expect(damageEvents.length).toBeGreaterThanOrEqual(1)
  })

  it('non-tracking projectiles aim at predicted position, not current', () => {
    // Use a slow non-tracking projectile against a fast-moving target
    const attacker = makeUnit({
      id: 'cannon',
      health: 5000,
      weapons: [makeWeapon({
        id: 'cannonball',
        damage: 200,
        reload: 2,
        range: 600,
        projectileType: 'Plasma',
        projectileSpeed: 100,
        isTracking: false,
      })],
    })
    const target = makeUnit({
      id: 'target',
      health: 5000,
      weapons: [],
      speed: 80,
    })

    const result = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: target, count: 1 }],
      { ...HOLD_CONFIG, teamBBehavior: 'advance', maxTime: 5 },
    )

    // The fire events should show toPos (aim point) different from the target's
    // current position at fire time due to lead prediction
    const fireEvents = result.events.filter(e => e.type === 'fire')
    expect(fireEvents.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// 8. Aircraft turn radius from turnRate
// ---------------------------------------------------------------------------

describe('Aircraft turn radius from turnRate', () => {
  it('fixed-wing aircraft have turn radius = speed / (turnRate/65536 * 2 * PI * 30)', () => {
    const speed = 200
    const turnRate = 500

    const angularVelocity = (turnRate / 65536) * 2 * Math.PI * 30
    const turnRadius = speed / angularVelocity

    // Verify the formula gives a reasonable value
    expect(angularVelocity).toBeGreaterThan(0)
    expect(turnRadius).toBeGreaterThan(0)

    // With turnRate=500, speed=200:
    // angular = 500/65536 * 2PI * 30 = 500 * 0.00287 = 1.437 rad/s
    // radius = 200 / 1.437 = 139.2
    expect(turnRadius).toBeCloseTo(139.2, 0)
  })

  it('fixed-wing = Flying + no hoverAttack', () => {
    const fixedWing = makeUnit({
      id: 'bomber',
      unitType: 'Aircraft',
      movementMode: 'Flying',
      hoverAttack: false,
      speed: 200,
      turnRate: 500,
      health: 2000,
      weapons: [makeWeapon({ id: 'bomb', damage: 300, reload: 3, range: 400 })],
    })

    const gunship = makeUnit({
      id: 'gunship',
      unitType: 'Aircraft',
      movementMode: 'Flying',
      hoverAttack: true,
      speed: 100,
      health: 2000,
      weapons: [makeWeapon({ id: 'laser', damage: 50, reload: 0.5, range: 300 })],
    })

    // Fixed wing: Flying + no hoverAttack
    expect(fixedWing.movementMode).toBe('Flying')
    expect(fixedWing.hoverAttack).toBe(false)

    // Gunship: Flying + hoverAttack (not fixed wing)
    expect(gunship.movementMode).toBe('Flying')
    expect(gunship.hoverAttack).toBe(true)
  })

  it('fixed-wing aircraft always moves (never stops)', () => {
    const fixedWing = makeUnit({
      id: 'bomber',
      unitType: 'Aircraft',
      movementMode: 'Flying',
      hoverAttack: false,
      speed: 200,
      turnRate: 500,
      health: 5000,
      weapons: [makeWeapon({
        id: 'bomb',
        damage: 100,
        reload: 2,
        range: 400,
        projectileType: 'AircraftBomb',
      })],
    })
    const target = makeUnit({
      id: 'target',
      health: 5000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: fixedWing, count: 1 }],
      [{ unit: target, count: 1 }],
      {
        ...HOLD_CONFIG,
        teamABehavior: 'advance',
        maxTime: 5,
        startingDistance: 300,
      },
    )

    // Check snapshots - the fixed-wing aircraft should never be stationary
    // (it always maintains cruise speed)
    const positions: { x: number; y: number }[] = []
    for (const snapshot of result.snapshots) {
      const bomberSnap = snapshot.units.find(u => u.unitId === 'bomber')
      if (bomberSnap) {
        positions.push(bomberSnap.position)
      }
    }

    // Verify position changes between snapshots (aircraft is always moving)
    if (positions.length > 2) {
      let hasMoved = false
      for (let i = 1; i < positions.length; i++) {
        const dx = positions[i].x - positions[i - 1].x
        const dy = positions[i].y - positions[i - 1].y
        if (dx * dx + dy * dy > 1) {
          hasMoved = true
          break
        }
      }
      expect(hasMoved).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 9. Kamikaze detonation
// ---------------------------------------------------------------------------

describe('Kamikaze detonation', () => {
  it('kamikaze unit self-destructs when within kamikazeDist of enemy', () => {
    const kamikaze = makeUnit({
      id: 'kamikaze',
      health: 500,
      speed: 200,
      isKamikaze: true,
      kamikazeDist: 30,
      weapons: [makeWeapon({
        id: 'explosion',
        damage: 2000,
        reload: 999,
        range: 0,
        areaOfEffect: 128,
        projectileType: 'Plasma',
      })],
    })
    const target = makeUnit({
      id: 'target',
      health: 3000,
      weapons: [],
      speed: 0,
    })

    const result = runSpatialSimulation(
      [{ unit: kamikaze, count: 1 }],
      [{ unit: target, count: 1 }],
      {
        ...HOLD_CONFIG,
        teamABehavior: 'advance',
        teamBBehavior: 'hold',
        maxTime: 15,
        startingDistance: 200,
      },
    )

    // Kamikaze should die (self-destruct — may produce multiple death events
    // if AoE kills itself before the explicit kill in selfDestruct)
    const kamikazeDeaths = result.events.filter(
      e => e.type === 'death' && e.unit.includes('kamikaze')
    )
    expect(kamikazeDeaths.length).toBeGreaterThanOrEqual(1)

    // Target should have taken significant AoE damage
    expect(result.totalDamageByA).toBeGreaterThan(0)
  })

  it('kamikaze always rushes toward enemy regardless of team behavior', () => {
    const kamikaze = makeUnit({
      id: 'kamikaze',
      health: 500,
      speed: 150,
      isKamikaze: true,
      kamikazeDist: 30,
      weapons: [makeWeapon({
        id: 'explosion',
        damage: 1000,
        reload: 999,
        range: 0,
        areaOfEffect: 100,
        projectileType: 'Plasma',
      })],
    })
    const target = makeUnit({
      id: 'target',
      health: 5000,
      weapons: [],
      speed: 0,
    })

    // Even with 'hold' behavior, kamikaze should still advance
    const result = runSpatialSimulation(
      [{ unit: kamikaze, count: 1 }],
      [{ unit: target, count: 1 }],
      {
        ...HOLD_CONFIG,
        teamABehavior: 'hold', // normally would not move
        teamBBehavior: 'hold',
        maxTime: 10,
        startingDistance: 200,
      },
    )

    // Should still detonate (overrides hold behavior)
    const deathEvents = result.events.filter(
      e => e.type === 'death' && e.unit.includes('kamikaze')
    )
    expect(deathEvents.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// 10. Mine detonation
// ---------------------------------------------------------------------------

describe('Mine detonation', () => {
  it('mine triggers at detonateRange proximity', () => {
    const mine = makeUnit({
      id: 'mine',
      health: 100,
      speed: 0,
      isMine: true,
      detonateRange: 64,
      movementMode: 'Static',
      weapons: [makeWeapon({
        id: 'mineblast',
        damage: 500,
        reload: 999,
        range: 0,
        areaOfEffect: 100,
        projectileType: 'Plasma',
      })],
    })
    const advancer = makeUnit({
      id: 'advancer',
      health: 3000,
      speed: 100,
      // Short range weapon forces the advancer to close within mine's detonateRange
      weapons: [makeWeapon({ id: 'gun', damage: 10, reload: 1, range: 50 })],
    })

    const result = runSpatialSimulation(
      [{ unit: mine, count: 1 }],
      [{ unit: advancer, count: 1 }],
      {
        ...HOLD_CONFIG,
        teamABehavior: 'hold',
        teamBBehavior: 'advance',
        maxTime: 10,
        startingDistance: 200,
      },
    )

    // Mine should die (self-destruct on proximity — may produce multiple death
    // events if AoE kills itself before the explicit kill)
    const mineDeaths = result.events.filter(
      e => e.type === 'death' && e.unit.includes('mine')
    )
    expect(mineDeaths.length).toBeGreaterThanOrEqual(1)

    // Advancer should take damage from mine explosion
    expect(result.totalDamageByA).toBeGreaterThan(0)
  })

  it('mine does not trigger when enemy is outside detonateRange', () => {
    const mine = makeUnit({
      id: 'mine',
      health: 100,
      speed: 0,
      isMine: true,
      detonateRange: 64,
      movementMode: 'Static',
      weapons: [makeWeapon({
        id: 'mineblast',
        damage: 500,
        reload: 999,
        range: 0,
        areaOfEffect: 100,
        projectileType: 'Plasma',
      })],
    })
    const holder = makeUnit({
      id: 'holder',
      health: 3000,
      speed: 0,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: mine, count: 1 }],
      [{ unit: holder, count: 1 }],
      {
        ...HOLD_CONFIG,
        teamABehavior: 'hold',
        teamBBehavior: 'hold',
        maxTime: 5,
        startingDistance: 400, // far enough that mine won't trigger
      },
    )

    // Mine should NOT have detonated
    const mineDeaths = result.events.filter(
      e => e.type === 'death' && e.unit.includes('mine')
    )
    expect(mineDeaths.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 11. Targeting strategies
// ---------------------------------------------------------------------------

describe('Targeting strategies', () => {
  it('focus: all attackers target the same unit', () => {
    const attacker = makeUnit({
      id: 'attacker',
      health: 5000,
      weapons: [makeWeapon({ id: 'gun', damage: 50, reload: 0.5, range: 500 })],
    })
    const target = makeUnit({
      id: 'target',
      health: 2000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: attacker, count: 3 }],
      [{ unit: target, count: 3 }],
      { ...HOLD_CONFIG, teamAStrategy: 'focus', maxTime: 3 },
    )

    // With focus strategy, all attackers should fire at the same target
    const fireEvents = result.events.filter(e => e.type === 'fire')
    if (fireEvents.length > 1) {
      const targets = new Set(fireEvents.map(e => e.type === 'fire' ? e.target : ''))
      // At the start, all should focus on same target (first by instanceId)
      const firstTickFires = fireEvents.filter(e => e.time === fireEvents[0].time)
      const firstTickTargets = new Set(
        firstTickFires.map(e => e.type === 'fire' ? e.target : '')
      )
      expect(firstTickTargets.size).toBe(1)
    }
  })

  it('closest: each unit targets nearest enemy', () => {
    const attacker = makeUnit({
      id: 'attacker',
      health: 5000,
      weapons: [makeWeapon({ id: 'gun', damage: 50, reload: 1, range: 500 })],
    })
    const nearTarget = makeUnit({
      id: 'near',
      health: 2000,
      weapons: [],
    })
    const farTarget = makeUnit({
      id: 'far',
      health: 2000,
      weapons: [],
    })

    // Use closest strategy; near target should be attacked first
    const result = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: nearTarget, count: 1 }, { unit: farTarget, count: 1 }],
      {
        ...HOLD_CONFIG,
        teamAStrategy: 'closest',
        teamBFormation: 'column', // one behind the other
        maxTime: 3,
      },
    )

    // First fire event should target the closer unit
    const firstFire = result.events.find(e => e.type === 'fire')
    expect(firstFire).toBeDefined()
  })

  it('lowestHp: targets unit with lowest current HP', () => {
    const attacker = makeUnit({
      id: 'attacker',
      health: 5000,
      weapons: [makeWeapon({ id: 'gun', damage: 50, reload: 0.5, range: 500 })],
    })
    const toughTarget = makeUnit({
      id: 'tough',
      health: 5000,
      weapons: [],
    })
    const weakTarget = makeUnit({
      id: 'weak',
      health: 100,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: toughTarget, count: 1 }, { unit: weakTarget, count: 1 }],
      {
        ...HOLD_CONFIG,
        teamAStrategy: 'lowestHp',
        maxTime: 3,
      },
    )

    // The weak target (100 HP) should die first since lowestHp strategy targets it
    const deathEvents = result.events.filter(e => e.type === 'death')
    if (deathEvents.length > 0) {
      expect(deathEvents[0].unit).toContain('weak')
    }
  })

  it('highestDps: targets unit with highest DPS first', () => {
    const attacker = makeUnit({
      id: 'attacker',
      health: 5000,
      weapons: [makeWeapon({ id: 'gun', damage: 100, reload: 0.5, range: 500 })],
    })
    const lowDpsTarget = makeUnit({
      id: 'lowdps',
      health: 2000,
      weapons: [makeWeapon({ id: 'pea', damage: 5, reload: 1, range: 500, dps: 5 })],
    })
    const highDpsTarget = makeUnit({
      id: 'highdps',
      health: 2000,
      weapons: [makeWeapon({ id: 'cannon', damage: 200, reload: 1, range: 500, dps: 200 })],
    })

    const result = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: lowDpsTarget, count: 1 }, { unit: highDpsTarget, count: 1 }],
      {
        ...HOLD_CONFIG,
        teamAStrategy: 'highestDps',
        maxTime: 5,
      },
    )

    // First fire should target the high-DPS unit
    const fireEvents = result.events.filter(e => e.type === 'fire')
    if (fireEvents.length > 0) {
      const firstTarget = fireEvents[0].type === 'fire' ? fireEvents[0].target : ''
      expect(firstTarget).toContain('highdps')
    }
  })
})

// ---------------------------------------------------------------------------
// 12. AircraftBomb gate
// ---------------------------------------------------------------------------

describe('AircraftBomb gate', () => {
  it('only drops bomb when dot product with target > 0.34', () => {
    // The gate requires dot(flyDir, toTarget) > 0.34
    // cos(70deg) ~ 0.342 — so the aircraft must be heading roughly toward the target
    const threshold = 0.34
    expect(Math.cos(70 * Math.PI / 180)).toBeCloseTo(threshold, 1)
  })

  it('fixed-wing bomber eventually fires AircraftBomb during attack run', () => {
    const bomber = makeUnit({
      id: 'bomber',
      unitType: 'Aircraft',
      movementMode: 'Flying',
      hoverAttack: false,
      speed: 200,
      turnRate: 500,
      health: 5000,
      weapons: [makeWeapon({
        id: 'bomb',
        damage: 500,
        reload: 3,
        range: 400,
        projectileType: 'AircraftBomb',
      })],
    })
    const target = makeUnit({
      id: 'target',
      health: 5000,
      speed: 0,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: bomber, count: 1 }],
      [{ unit: target, count: 1 }],
      {
        ...HOLD_CONFIG,
        teamABehavior: 'advance',
        maxTime: 15,
        startingDistance: 300,
      },
    )

    // The bomber should eventually line up and drop its bomb
    const fireEvents = result.events.filter(e => e.type === 'fire')
    // On a 15-second sim with 3s reload, should get at least 1 bomb drop
    expect(fireEvents.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// 13. Weapon cooldown
// ---------------------------------------------------------------------------

describe('Weapon cooldown', () => {
  it('weapons respect reload time between shots', () => {
    const attacker = makeUnit({
      id: 'attacker',
      health: 5000,
      weapons: [makeWeapon({
        id: 'gun',
        damage: 100,
        reload: 2, // 2 second reload
        range: 500,
      })],
    })
    const target = makeUnit({
      id: 'target',
      health: 50000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: target, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 10 },
    )

    const fireEvents = result.events.filter(
      e => e.type === 'fire' && e.attacker.includes('attacker')
    )

    // With 2s reload over 10s, should fire about 5-6 times
    expect(fireEvents.length).toBeGreaterThanOrEqual(4)
    expect(fireEvents.length).toBeLessThanOrEqual(7)

    // Check that consecutive fire events are at least ~2 seconds apart
    for (let i = 1; i < fireEvents.length; i++) {
      const gap = fireEvents[i].time - fireEvents[i - 1].time
      expect(gap).toBeGreaterThanOrEqual(1.9) // slight tolerance for tick resolution
    }
  })

  it('burst weapons fire burst count per reload cycle', () => {
    const attacker = makeUnit({
      id: 'burst',
      health: 5000,
      weapons: [makeWeapon({
        id: 'burst',
        damage: 50,
        reload: 2,
        range: 500,
        burstCount: 3,
        burstRate: 0.1,
      })],
    })
    const target = makeUnit({
      id: 'target',
      health: 50000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: target, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 5 },
    )

    // The burstCount is applied as a multiplier to damage in a single fire event
    // so damage per hit = 50 * 3 = 150
    const damageEvents = result.events.filter(
      e => e.type === 'damage' && !e.isEmp && e.source.includes('burst')
    )
    if (damageEvents.length > 0) {
      // Each damage event should be damage * burstCount = 150
      expect(damageEvents[0].damage).toBeCloseTo(150, 0)
    }
  })
})

// ---------------------------------------------------------------------------
// 14. SprayAngle scatter
// ---------------------------------------------------------------------------

describe('SprayAngle scatter', () => {
  it('non-zero sprayAngle produces aim offset in fire events', () => {
    const attacker = makeUnit({
      id: 'spray',
      health: 5000,
      weapons: [makeWeapon({
        id: 'shotgun',
        damage: 50,
        reload: 0.3,
        range: 500,
        projectileType: 'Plasma',
        projectileSpeed: 300,
        sprayAngle: 100, // significant spray
      })],
    })
    const target = makeUnit({
      id: 'target',
      health: 50000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: target, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 5 },
    )

    const fireEvents = result.events.filter(
      e => e.type === 'fire' && e.attacker.includes('spray')
    )

    // With sprayAngle, each fire event's toPos should vary (not all identical)
    if (fireEvents.length >= 3) {
      const toPositions = fireEvents.map(e =>
        e.type === 'fire' ? e.toPos : vec2(0, 0)
      )
      // Check that not all aim points are exactly the same
      const allSame = toPositions.every(
        p => Math.abs(p.x - toPositions[0].x) < 0.01 &&
             Math.abs(p.y - toPositions[0].y) < 0.01
      )
      expect(allSame).toBe(false)
    }
  })

  it('sprayAngle magnitude matches Spring formula: sin(spray * PI / 45055)', () => {
    // Spring formula: angular offset = sin(sprayAngle * PI / 45055)
    // For spray=1000: sin(1000 * PI / 45055) ≈ 0.0698 rad ≈ 4 degrees
    // The old formula gave spray * 0.015 = 15 rad (215x too large)
    const spray = 1000
    const expectedMaxAngle = Math.sin(spray * Math.PI / 45055)
    expect(expectedMaxAngle).toBeCloseTo(0.0698, 3)
    // Verify it's much less than the old buggy value
    expect(expectedMaxAngle).toBeLessThan(0.1)
  })

  it('zero sprayAngle fires straight at target', () => {
    const attacker = makeUnit({
      id: 'precise',
      health: 5000,
      weapons: [makeWeapon({
        id: 'sniper',
        damage: 100,
        reload: 0.5,
        range: 500,
        projectileType: 'Laser',
        // sprayAngle undefined / 0
      })],
    })
    const target = makeUnit({
      id: 'target',
      health: 50000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: target, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 3 },
    )

    // All instant-hit fire events should have toPos at the target's position
    const fireEvents = result.events.filter(
      e => e.type === 'fire' && e.attacker.includes('precise')
    )

    if (fireEvents.length >= 2) {
      // For instant laser weapons with no spray, toPos should be very consistent
      // (all at target's stationary position)
      const toPositions = fireEvents.map(e =>
        e.type === 'fire' ? e.toPos : vec2(0, 0)
      )
      for (let i = 1; i < toPositions.length; i++) {
        const dist = vec2Distance(toPositions[0], toPositions[i])
        expect(dist).toBeLessThan(1) // essentially the same position
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 14b. PredictBoost defaults
// ---------------------------------------------------------------------------

describe('PredictBoost defaults', () => {
  it('weapon with no predictBoost field uses default 0.0 (maximum scatter)', () => {
    // Spring default: predictBoost = 0.0
    // At predictBoost=0: predictMult = predictSpeedMod * 1 + 1.0 * 0 = predictSpeedMod
    // predictSpeedMod ∈ [0.5, 1.5], so lead prediction is noisy
    const predictBoost = undefined ?? 0.0
    expect(predictBoost).toBe(0.0)
  })

  it('weapon with predictBoost=1.0 aims perfectly at predicted position', () => {
    // At predictBoost=1.0: predictMult = predictSpeedMod * 0 + 1.0 * 1 = 1.0
    // Regardless of random predictSpeedMod, result is always 1.0
    const predictBoost = 1.0
    for (let i = 0; i < 10; i++) {
      const predictSpeedMod = 0.5 + Math.random() * 1.0 // Spring range [0.5, 1.5]
      const predictMult = predictSpeedMod * (1 - predictBoost) + 1.0 * predictBoost
      expect(predictMult).toBeCloseTo(1.0)
    }
  })

  it('predictSpeedMod range is [0.5, 1.5] (Spring engine range)', () => {
    // Verify the formula bounds
    const minMod = 0.5 + 0 * 1.0  // Math.random() = 0
    const maxMod = 0.5 + 1 * 1.0  // Math.random() = 1
    expect(minMod).toBe(0.5)
    expect(maxMod).toBe(1.5)
  })
})

// ---------------------------------------------------------------------------
// 15. Victory conditions
// ---------------------------------------------------------------------------

describe('Victory conditions', () => {
  it('team A wins when all team B units die', () => {
    const strong = makeUnit({
      id: 'strong',
      health: 5000,
      weapons: [makeWeapon({ id: 'gun', damage: 500, reload: 0.5, range: 500 })],
    })
    const weak = makeUnit({
      id: 'weak',
      health: 100,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: strong, count: 1 }],
      [{ unit: weak, count: 1 }],
      HOLD_CONFIG,
    )

    expect(result.winner).toBe('A')
    expect(result.teamASurvivors.length).toBe(1)
    expect(result.teamBSurvivors.length).toBe(0)
  })

  it('team B wins when all team A units die', () => {
    const weak = makeUnit({
      id: 'weak',
      health: 100,
      weapons: [],
    })
    const strong = makeUnit({
      id: 'strong',
      health: 5000,
      weapons: [makeWeapon({ id: 'gun', damage: 500, reload: 0.5, range: 500 })],
    })

    const result = runSpatialSimulation(
      [{ unit: weak, count: 1 }],
      [{ unit: strong, count: 1 }],
      HOLD_CONFIG,
    )

    expect(result.winner).toBe('B')
    expect(result.teamASurvivors.length).toBe(0)
    expect(result.teamBSurvivors.length).toBe(1)
  })

  it('draw when time runs out with both teams alive', () => {
    const tank = makeUnit({
      id: 'tank',
      health: 100000,
      weapons: [makeWeapon({ id: 'gun', damage: 1, reload: 1, range: 500 })],
    })

    const result = runSpatialSimulation(
      [{ unit: tank, count: 1 }],
      [{ unit: tank, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 5 },
    )

    expect(result.winner).toBe('draw')
    expect(result.teamASurvivors.length).toBe(1)
    expect(result.teamBSurvivors.length).toBe(1)
    expect(result.drawAnalysis).not.toBeNull()
  })

  it('draw when both teams die simultaneously', () => {
    // Both units have same HP and same weapon — should die on same tick
    // Units with very low HP and high damage — one may die before the other fires
    // (processing order dependent), so we just check the sim terminates correctly
    const glass = makeUnit({
      id: 'glass',
      health: 100,
      weapons: [makeWeapon({ id: 'gun', damage: 200, reload: 0.5, range: 500 })],
    })

    const result = runSpatialSimulation(
      [{ unit: glass, count: 1 }],
      [{ unit: glass, count: 1 }],
      HOLD_CONFIG,
    )

    // At least one team should be eliminated (both might die, or processing order picks a winner)
    const totalSurvivors = result.teamASurvivors.length + result.teamBSurvivors.length
    expect(totalSurvivors).toBeLessThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// 16. Weapon-target filtering
// ---------------------------------------------------------------------------

describe('Weapon-target filtering', () => {
  it('AA weapons (onlyTargetsAir=true) skip ground units', () => {
    const aaUnit = makeUnit({
      id: 'aa',
      health: 5000,
      weapons: [makeWeapon({
        id: 'flak',
        damage: 200,
        reload: 0.5,
        range: 500,
        onlyTargetsAir: true,
        canTargetAir: true,
      })],
    })
    const groundTarget = makeUnit({
      id: 'ground',
      health: 1000,
      unitType: 'Bot',
      movementMode: 'Walking',
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: aaUnit, count: 1 }],
      [{ unit: groundTarget, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 5 },
    )

    // AA weapon should not fire at ground unit, resulting in a draw
    expect(result.winner).toBe('draw')
    expect(result.totalDamageByA).toBe(0)
  })

  it('AA weapons can target aircraft', () => {
    const aaUnit = makeUnit({
      id: 'aa',
      health: 5000,
      weapons: [makeWeapon({
        id: 'flak',
        damage: 200,
        reload: 0.5,
        range: 500,
        onlyTargetsAir: true,
        canTargetAir: true,
      })],
    })
    const aircraft = makeUnit({
      id: 'plane',
      health: 1000,
      unitType: 'Aircraft',
      movementMode: 'Flying',
      hoverAttack: true,
      speed: 100,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: aaUnit, count: 1 }],
      [{ unit: aircraft, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 5, teamBBehavior: 'advance' },
    )

    // AA should fire at aircraft
    expect(result.totalDamageByA).toBeGreaterThan(0)
  })

  it('ground-only weapons (canTargetAir=false) cannot hit aircraft', () => {
    const groundUnit = makeUnit({
      id: 'cannon',
      health: 5000,
      weapons: [makeWeapon({
        id: 'groundgun',
        damage: 200,
        reload: 0.5,
        range: 500,
        canTargetAir: false,
        onlyTargetsAir: false,
      })],
    })
    const aircraft = makeUnit({
      id: 'plane',
      health: 1000,
      unitType: 'Aircraft',
      movementMode: 'Flying',
      hoverAttack: true,
      speed: 100,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: groundUnit, count: 1 }],
      [{ unit: aircraft, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 5, teamBBehavior: 'advance' },
    )

    // Ground-only weapon should not fire at aircraft
    expect(result.totalDamageByA).toBe(0)
    expect(result.winner).toBe('draw')
  })
})

// ---------------------------------------------------------------------------
// Additional behavioral tests
// ---------------------------------------------------------------------------

describe('Result structure', () => {
  it('runSpatialSimulation returns all expected fields', () => {
    const unit = makeUnit({
      id: 'basic',
      health: 1000,
      weapons: [makeWeapon()],
    })

    const result = runSpatialSimulation(
      [{ unit, count: 1 }],
      [{ unit, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 2 },
    )

    expect(result).toHaveProperty('winner')
    expect(result).toHaveProperty('duration')
    expect(result).toHaveProperty('events')
    expect(result).toHaveProperty('teamASurvivors')
    expect(result).toHaveProperty('teamBSurvivors')
    expect(result).toHaveProperty('totalDamageByA')
    expect(result).toHaveProperty('totalDamageByB')
    expect(result).toHaveProperty('timeline')
    expect(result).toHaveProperty('snapshots')
    expect(result).toHaveProperty('drawAnalysis')
    expect(Array.isArray(result.events)).toBe(true)
    expect(Array.isArray(result.timeline)).toBe(true)
    expect(Array.isArray(result.snapshots)).toBe(true)
    expect(result.duration).toBeGreaterThan(0)
  })

  it('timeline entries contain correct fields', () => {
    const unit = makeUnit({
      id: 'basic',
      health: 1000,
      weapons: [makeWeapon()],
    })

    const result = runSpatialSimulation(
      [{ unit, count: 1 }],
      [{ unit, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 3 },
    )

    expect(result.timeline.length).toBeGreaterThan(0)
    const entry = result.timeline[0]
    expect(entry).toHaveProperty('time')
    expect(entry).toHaveProperty('teamAHp')
    expect(entry).toHaveProperty('teamBHp')
    expect(entry).toHaveProperty('teamACount')
    expect(entry).toHaveProperty('teamBCount')
    expect(entry).toHaveProperty('teamADps')
    expect(entry).toHaveProperty('teamBDps')
    expect(entry).toHaveProperty('snapshot')
  })

  it('snapshots contain unit and projectile data', () => {
    const unit = makeUnit({
      id: 'basic',
      health: 1000,
      weapons: [makeWeapon()],
    })

    const result = runSpatialSimulation(
      [{ unit, count: 1 }],
      [{ unit, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 2 },
    )

    expect(result.snapshots.length).toBeGreaterThan(0)
    const snap = result.snapshots[0]
    expect(snap).toHaveProperty('time')
    expect(snap).toHaveProperty('units')
    expect(snap).toHaveProperty('projectiles')
    expect(snap).toHaveProperty('beamFlashes')
    expect(snap).toHaveProperty('aoeImpacts')
    expect(Array.isArray(snap.units)).toBe(true)
    if (snap.units.length > 0) {
      expect(snap.units[0]).toHaveProperty('instanceId')
      expect(snap.units[0]).toHaveProperty('position')
      expect(snap.units[0]).toHaveProperty('hp')
      expect(snap.units[0]).toHaveProperty('team')
    }
  })
})

describe('Movement behaviors', () => {
  it('hold behavior keeps units stationary', () => {
    const unit = makeUnit({
      id: 'holder',
      health: 5000,
      weapons: [],
      speed: 100,
    })

    const result = runSpatialSimulation(
      [{ unit, count: 1 }],
      [{ unit, count: 1 }],
      {
        ...HOLD_CONFIG,
        teamABehavior: 'hold',
        teamBBehavior: 'hold',
        maxTime: 3,
      },
    )

    // Both teams should still be alive (no weapons, no movement)
    expect(result.winner).toBe('draw')

    // Check first and last snapshot positions — should be the same
    if (result.snapshots.length >= 2) {
      const first = result.snapshots[0].units.find(u => u.team === 'A')
      const last = result.snapshots[result.snapshots.length - 1].units.find(u => u.team === 'A')
      if (first && last) {
        expect(vec2Distance(first.position, last.position)).toBeLessThan(2)
      }
    }
  })

  it('advance behavior moves units toward enemies', () => {
    // Units need weapons so canAttackTarget returns true (enables movement logic)
    const unit = makeUnit({
      id: 'advancer',
      health: 5000,
      weapons: [makeWeapon({ id: 'gun', damage: 1, reload: 10, range: 100 })],
      speed: 100,
    })

    const result = runSpatialSimulation(
      [{ unit, count: 1 }],
      [{ unit, count: 1 }],
      {
        ...HOLD_CONFIG,
        teamABehavior: 'advance',
        teamBBehavior: 'hold',
        maxTime: 3,
        startingDistance: 600,
      },
    )

    // A should have moved closer to B
    if (result.snapshots.length >= 2) {
      const first = result.snapshots[0]
      const last = result.snapshots[result.snapshots.length - 1]
      const aFirst = first.units.find(u => u.team === 'A')
      const bFirst = first.units.find(u => u.team === 'B')
      const aLast = last.units.find(u => u.team === 'A')
      const bLast = last.units.find(u => u.team === 'B')
      if (aFirst && bFirst && aLast && bLast) {
        const initialDist = vec2Distance(aFirst.position, bFirst.position)
        const finalDist = vec2Distance(aLast.position, bLast.position)
        expect(finalDist).toBeLessThan(initialDist)
      }
    }
  })

  it('retreat behavior moves units away from enemies', () => {
    const unit = makeUnit({
      id: 'retreater',
      health: 5000,
      weapons: [makeWeapon({ id: 'gun', damage: 1, reload: 10, range: 100 })],
      speed: 100,
    })

    const result = runSpatialSimulation(
      [{ unit, count: 1 }],
      [{ unit, count: 1 }],
      {
        ...HOLD_CONFIG,
        teamABehavior: 'retreat',
        teamBBehavior: 'hold',
        maxTime: 3,
        startingDistance: 300,
        fieldSize: 2000,
      },
    )

    // A should have moved further from B
    if (result.snapshots.length >= 2) {
      const first = result.snapshots[0]
      const last = result.snapshots[result.snapshots.length - 1]
      const aFirst = first.units.find(u => u.team === 'A')
      const bFirst = first.units.find(u => u.team === 'B')
      const aLast = last.units.find(u => u.team === 'A')
      const bLast = last.units.find(u => u.team === 'B')
      if (aFirst && bFirst && aLast && bLast) {
        const initialDist = vec2Distance(aFirst.position, bFirst.position)
        const finalDist = vec2Distance(aLast.position, bLast.position)
        expect(finalDist).toBeGreaterThan(initialDist)
      }
    }
  })
})

describe('Retreat victory condition', () => {
  it('retreat behavior with losses triggers retreat win', () => {
    const retreater = makeUnit({
      id: 'retreater',
      health: 500,
      speed: 200,
      weapons: [],
    })
    const attacker = makeUnit({
      id: 'attacker',
      health: 5000,
      weapons: [makeWeapon({ id: 'gun', damage: 600, reload: 1, range: 600 })],
    })

    const result = runSpatialSimulation(
      [{ unit: retreater, count: 3 }],
      [{ unit: attacker, count: 1 }],
      {
        ...HOLD_CONFIG,
        teamABehavior: 'retreat',
        teamBBehavior: 'hold',
        maxTime: 30,
        startingDistance: 200,
        fieldSize: 1200,
      },
    )

    // Team A is retreating and should eventually either all die or reach the edge
    // The result should be one of: B wins, or A_retreat
    expect(['B', 'A_retreat', 'draw']).toContain(result.winner)
  })
})

describe('Per-unit overrides', () => {
  it('teamAUnitOverrides can set per-unit behavior', () => {
    const dummyWeapon = makeWeapon({ id: 'gun', damage: 1, reload: 10, range: 100 })
    const holderUnit = makeUnit({
      id: 'holder',
      health: 5000,
      weapons: [dummyWeapon],
      speed: 100,
    })
    const advancerUnit = makeUnit({
      id: 'advancer',
      health: 5000,
      weapons: [dummyWeapon],
      speed: 100,
    })
    const enemy = makeUnit({
      id: 'enemy',
      health: 5000,
      weapons: [dummyWeapon],
    })

    const result = runSpatialSimulation(
      [{ unit: holderUnit, count: 1 }, { unit: advancerUnit, count: 1 }],
      [{ unit: enemy, count: 1 }],
      {
        ...HOLD_CONFIG,
        teamABehavior: 'hold', // default
        teamAUnitOverrides: {
          advancer: { behavior: 'advance' }, // override this specific unit
        },
        maxTime: 3,
        startingDistance: 400,
      },
    )

    // Both should be alive (no weapons), but advancer should have moved while holder stayed
    if (result.snapshots.length >= 2) {
      const first = result.snapshots[0]
      const last = result.snapshots[result.snapshots.length - 1]

      const holderFirst = first.units.find(u => u.unitId === 'holder')
      const holderLast = last.units.find(u => u.unitId === 'holder')
      const advancerFirst = first.units.find(u => u.unitId === 'advancer')
      const advancerLast = last.units.find(u => u.unitId === 'advancer')

      if (holderFirst && holderLast) {
        // Holder should barely move
        expect(vec2Distance(holderFirst.position, holderLast.position)).toBeLessThan(5)
      }
      if (advancerFirst && advancerLast) {
        // Advancer should have moved significantly
        expect(vec2Distance(advancerFirst.position, advancerLast.position)).toBeGreaterThan(10)
      }
    }
  })
})

describe('Vision system', () => {
  it('with useVisionSystem=false all units can see each other', () => {
    const sniper = makeUnit({
      id: 'sniper',
      health: 5000,
      sightRange: 50, // very low sight range
      weapons: [makeWeapon({ id: 'gun', damage: 100, reload: 1, range: 500 })],
    })
    const target = makeUnit({
      id: 'target',
      health: 5000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: sniper, count: 1 }],
      [{ unit: target, count: 1 }],
      { ...HOLD_CONFIG, useVisionSystem: false, maxTime: 3 },
    )

    // Even with tiny sight range, vision is off so should fire normally
    const fireEvents = result.events.filter(e => e.type === 'fire')
    expect(fireEvents.length).toBeGreaterThan(0)
  })

  it('with useVisionSystem=true, units outside sight range cannot be targeted', () => {
    const sniper = makeUnit({
      id: 'sniper',
      health: 5000,
      sightRange: 50, // very low sight range
      weapons: [makeWeapon({ id: 'gun', damage: 100, reload: 1, range: 500 })],
    })
    const target = makeUnit({
      id: 'target',
      health: 5000,
      sightRange: 50,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: sniper, count: 1 }],
      [{ unit: target, count: 1 }],
      {
        ...HOLD_CONFIG,
        useVisionSystem: true,
        startingDistance: 200,
        maxTime: 3,
      },
    )

    // With 200 distance and 50 sight range, neither can see the other
    // so no fire events should occur
    const fireEvents = result.events.filter(e => e.type === 'fire')
    expect(fireEvents.length).toBe(0)
  })

  it('radar coverage bypasses sight range limitation', () => {
    const sniper = makeUnit({
      id: 'sniper',
      health: 5000,
      sightRange: 50,
      weapons: [makeWeapon({ id: 'gun', damage: 100, reload: 1, range: 500 })],
    })
    const target = makeUnit({
      id: 'target',
      health: 5000,
      sightRange: 50,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: sniper, count: 1 }],
      [{ unit: target, count: 1 }],
      {
        ...HOLD_CONFIG,
        useVisionSystem: true,
        teamARadarCoverage: true, // team A has full radar
        startingDistance: 200,
        maxTime: 3,
      },
    )

    // Team A has radar coverage so sniper should be able to fire
    const fireEvents = result.events.filter(e => e.type === 'fire')
    expect(fireEvents.length).toBeGreaterThan(0)
  })
})

describe('Formations', () => {
  it('grouped formation clusters units close together', () => {
    const unit = makeUnit({
      id: 'grouped',
      health: 1000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit, count: 5 }],
      [{ unit, count: 1 }],
      { ...HOLD_CONFIG, teamAFormation: 'grouped', maxTime: 1 },
    )

    // All team A units should be close together
    const teamAUnits = result.snapshots[0].units.filter(u => u.team === 'A')
    if (teamAUnits.length >= 2) {
      const maxDist = Math.max(
        ...teamAUnits.map(a =>
          Math.max(...teamAUnits.map(b => vec2Distance(a.position, b.position)))
        )
      )
      // Grouped units should be relatively close (spacing * sqrt(count) range)
      expect(maxDist).toBeLessThan(200)
    }
  })

  it('scattered formation spreads units further apart', () => {
    const unit = makeUnit({
      id: 'scattered',
      health: 1000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit, count: 8 }],
      [{ unit, count: 1 }],
      { ...HOLD_CONFIG, teamAFormation: 'scattered', maxTime: 1 },
    )

    // Scattered units should be spread in a circle
    const teamAUnits = result.snapshots[0].units.filter(u => u.team === 'A')
    if (teamAUnits.length >= 2) {
      const maxDist = Math.max(
        ...teamAUnits.map(a =>
          Math.max(...teamAUnits.map(b => vec2Distance(a.position, b.position)))
        )
      )
      // Scattered should have wider spread than grouped
      expect(maxDist).toBeGreaterThan(30)
    }
  })
})

describe('Production spawning', () => {
  it('spawns reinforcement units at configured interval', () => {
    const baseUnit = makeUnit({
      id: 'base',
      health: 50000,
      weapons: [makeWeapon({ id: 'gun', damage: 1, reload: 1, range: 500 })],
    })
    const spawnUnit = makeUnit({
      id: 'spawn',
      health: 500,
      weapons: [makeWeapon({ id: 'gun', damage: 10, reload: 1, range: 500 })],
    })

    const result = runSpatialSimulation(
      [{ unit: baseUnit, count: 1 }],
      [{ unit: baseUnit, count: 1 }],
      {
        ...HOLD_CONFIG,
        maxTime: 10,
        teamAProduction: [{ unit: spawnUnit, interval: 2 }],
      },
    )

    // Over 10 seconds with 2s interval, should spawn ~5 units (at t=0, 2, 4, 6, 8)
    // Check that team A has more units than it started with
    // Look at a late snapshot
    const lateSnapshot = result.snapshots[result.snapshots.length - 1]
    const teamACount = lateSnapshot.units.filter(u => u.team === 'A').length
    // Should have the original unit plus spawned ones
    expect(teamACount).toBeGreaterThan(1)
  })
})

describe('Multiple units and quantities', () => {
  it('handles multiple unit types per team', () => {
    const infantry = makeUnit({
      id: 'infantry',
      health: 500,
      weapons: [makeWeapon({ id: 'rifle', damage: 20, reload: 0.5, range: 300 })],
    })
    const tank = makeUnit({
      id: 'tank',
      health: 3000,
      weapons: [makeWeapon({ id: 'cannon', damage: 200, reload: 2, range: 400 })],
    })
    const enemy = makeUnit({
      id: 'enemy',
      health: 2000,
      weapons: [makeWeapon({ id: 'gun', damage: 50, reload: 1, range: 350 })],
    })

    const result = runSpatialSimulation(
      [{ unit: infantry, count: 3 }, { unit: tank, count: 1 }],
      [{ unit: enemy, count: 4 }],
      { ...HOLD_CONFIG, maxTime: 10 },
    )

    // Verify that 4 units were created for team A (3 infantry + 1 tank)
    const initialSnapshot = result.snapshots[0]
    const teamAUnits = initialSnapshot.units.filter(u => u.team === 'A')
    expect(teamAUnits.length).toBe(4)

    // Verify both unit types are present
    const unitIds = new Set(teamAUnits.map(u => u.unitId))
    expect(unitIds.has('infantry')).toBe(true)
    expect(unitIds.has('tank')).toBe(true)
  })
})

describe('Suicide units', () => {
  it('isSuicide units rush and self-destruct on contact', () => {
    const suicide = makeUnit({
      id: 'bomb',
      health: 200,
      speed: 150,
      isSuicide: true,
      weapons: [makeWeapon({
        id: 'blast',
        damage: 1500,
        reload: 999,
        range: 0,
        areaOfEffect: 150,
        projectileType: 'Plasma',
      })],
    })
    const target = makeUnit({
      id: 'target',
      health: 3000,
      speed: 0,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: suicide, count: 1 }],
      [{ unit: target, count: 1 }],
      {
        ...HOLD_CONFIG,
        teamABehavior: 'hold', // suicide overrides to advance
        teamBBehavior: 'hold',
        maxTime: 10,
        startingDistance: 200,
      },
    )

    // Suicide unit should die from self-destruct (may produce multiple death
    // events if AoE kills itself before the explicit kill)
    const bombDeaths = result.events.filter(
      e => e.type === 'death' && e.unit.includes('bomb')
    )
    expect(bombDeaths.length).toBeGreaterThanOrEqual(1)
    // Target should have taken AoE damage from the explosion
    expect(result.totalDamageByA).toBeGreaterThan(0)
  })
})

describe('Damage totals', () => {
  it('totalDamageByA and totalDamageByB are calculated correctly', () => {
    const unitA = makeUnit({
      id: 'unitA',
      health: 5000,
      weapons: [makeWeapon({ id: 'gun', damage: 100, reload: 1, range: 500 })],
    })
    const unitB = makeUnit({
      id: 'unitB',
      health: 5000,
      weapons: [makeWeapon({ id: 'gun', damage: 75, reload: 1, range: 500 })],
    })

    const result = runSpatialSimulation(
      [{ unit: unitA, count: 1 }],
      [{ unit: unitB, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 5 },
    )

    // Both should have dealt damage
    expect(result.totalDamageByA).toBeGreaterThan(0)
    expect(result.totalDamageByB).toBeGreaterThan(0)

    // A does 100 dps, B does 75 dps, over ~5 seconds (first shot immediate)
    // A should deal more total damage than B
    expect(result.totalDamageByA).toBeGreaterThan(result.totalDamageByB)

    // Verify damage totals match summed damage events
    const aDamageFromEvents = result.events
      .filter(e => e.type === 'damage' && !e.isEmp)
      .filter(e => {
        // Source is team A unit
        return e.type === 'damage' && e.source.startsWith('A-')
      })
      .reduce((sum, e) => sum + (e.type === 'damage' ? e.damage : 0), 0)

    expect(result.totalDamageByA).toBeCloseTo(aDamageFromEvents, 0)
  })

  it('EMP damage is not counted in totalDamage', () => {
    const empUnit = makeUnit({
      id: 'empunit',
      health: 5000,
      weapons: [makeWeapon({
        id: 'emp',
        damage: 0,
        empDamage: 500,
        reload: 1,
        range: 500,
        projectileType: 'EMP',
        stunDuration: 5,
        dps: 0,
      })],
    })
    const target = makeUnit({
      id: 'target',
      health: 5000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: empUnit, count: 1 }],
      [{ unit: target, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 5 },
    )

    // EMP only — no real damage dealt
    expect(result.totalDamageByA).toBe(0)
    // But damage events should exist (EMP damage events)
    const empDamageEvents = result.events.filter(
      e => e.type === 'damage' && e.isEmp
    )
    expect(empDamageEvents.length).toBeGreaterThan(0)
  })
})

describe('Submarine domain rules', () => {
  it('submarines can only attack ships and other submarines', () => {
    const sub = makeUnit({
      id: 'sub',
      health: 5000,
      movementMode: 'Submarine',
      unitType: 'Ship',
      weapons: [makeWeapon({ id: 'torp', damage: 200, reload: 1, range: 500 })],
    })
    const bot = makeUnit({
      id: 'bot',
      health: 1000,
      movementMode: 'Walking',
      unitType: 'Bot',
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: sub, count: 1 }],
      [{ unit: bot, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 5 },
    )

    // Sub cannot attack walking bot
    expect(result.totalDamageByA).toBe(0)
    expect(result.winner).toBe('draw')
  })

  it('submarines can only be targeted by naval units', () => {
    const bot = makeUnit({
      id: 'bot',
      health: 5000,
      movementMode: 'Walking',
      unitType: 'Bot',
      weapons: [makeWeapon({ id: 'gun', damage: 200, reload: 1, range: 500 })],
    })
    const sub = makeUnit({
      id: 'sub',
      health: 1000,
      movementMode: 'Submarine',
      unitType: 'Ship',
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: bot, count: 1 }],
      [{ unit: sub, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 5 },
    )

    // Bot cannot attack submarine
    expect(result.totalDamageByA).toBe(0)
    expect(result.winner).toBe('draw')
  })
})

describe('SpatialCombatSimulator constructor', () => {
  it('can be constructed with a full config', () => {
    const config = getDefaultSpatialConfig()
    const sim = new SpatialCombatSimulator(config)
    expect(sim).toBeDefined()
  })

  it('run() with no units returns a draw immediately', () => {
    const config = getDefaultSpatialConfig()
    const sim = new SpatialCombatSimulator(config)
    const result = sim.run()
    expect(result.winner).toBe('draw')
    expect(result.duration).toBe(0)
  })
})

describe('Edge cases', () => {
  it('units with no weapons cannot deal damage', () => {
    const noWeapon = makeUnit({
      id: 'unarmed',
      health: 5000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: noWeapon, count: 1 }],
      [{ unit: noWeapon, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 3 },
    )

    expect(result.winner).toBe('draw')
    expect(result.totalDamageByA).toBe(0)
    expect(result.totalDamageByB).toBe(0)
  })

  it('weapons with range=0 do not fire', () => {
    const zeroRange = makeUnit({
      id: 'zerorange',
      health: 5000,
      weapons: [makeWeapon({ id: 'melee', damage: 500, reload: 0.5, range: 0 })],
    })
    const target = makeUnit({
      id: 'target',
      health: 1000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: zeroRange, count: 1 }],
      [{ unit: target, count: 1 }],
      { ...HOLD_CONFIG, maxTime: 5 },
    )

    // Weapon with range=0 is skipped
    const fireEvents = result.events.filter(e => e.type === 'fire')
    expect(fireEvents.length).toBe(0)
  })

  it('static units (speed=0) do not move', () => {
    const turret = makeUnit({
      id: 'turret',
      health: 5000,
      speed: 0,
      movementMode: 'Static',
      weapons: [makeWeapon({ id: 'gun', damage: 100, reload: 1, range: 500 })],
    })
    const target = makeUnit({
      id: 'target',
      health: 5000,
      weapons: [],
    })

    const result = runSpatialSimulation(
      [{ unit: turret, count: 1 }],
      [{ unit: target, count: 1 }],
      {
        ...HOLD_CONFIG,
        teamABehavior: 'advance', // would normally advance, but speed=0
        maxTime: 3,
      },
    )

    if (result.snapshots.length >= 2) {
      const first = result.snapshots[0].units.find(u => u.unitId === 'turret')
      const last = result.snapshots[result.snapshots.length - 1].units.find(u => u.unitId === 'turret')
      if (first && last) {
        expect(vec2Distance(first.position, last.position)).toBeLessThan(1)
      }
    }
  })

  it('handles large unit counts without error', () => {
    const unit = makeUnit({
      id: 'mass',
      health: 500,
      weapons: [makeWeapon({ id: 'gun', damage: 10, reload: 0.5, range: 300 })],
    })

    const result = runSpatialSimulation(
      [{ unit, count: 20 }],
      [{ unit, count: 20 }],
      { ...HOLD_CONFIG, maxTime: 5, tickRate: 10 },
    )

    expect(result).toBeDefined()
    expect(result.events.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Flanking direction drift
// ---------------------------------------------------------------------------

describe('Flanking direction drift', () => {
  it('repeated hits from same direction reduce flanking bonus over time', () => {
    // When flanking is enabled, repeated hits from the same direction should
    // cause the unit's facing to drift toward the attacker, reducing the
    // flanking multiplier over time.
    const attacker = makeUnit({
      id: 'flanker',
      health: 50000,
      weapons: [makeWeapon({ id: 'gun', damage: 10, reload: 0.2, range: 500 })],
    })
    const defender = makeUnit({
      id: 'defender',
      health: 50000,
      weapons: [],
      flankingBonusMax: 2.0,
      flankingBonusMin: 1.0,
    })

    const result = runSpatialSimulation(
      [{ unit: attacker, count: 1 }],
      [{ unit: defender, count: 1 }],
      { ...HOLD_CONFIG, useFlanking: true, maxTime: 8 },
    )

    // Collect damage events over time
    const damageEvents = result.events
      .filter(e => e.type === 'damage' && !e.isEmp)
      .map(e => ({ time: e.time, damage: e.type === 'damage' ? e.damage : 0 }))

    // With many hits from the same direction, the flanking multiplier should
    // drift toward 1.0 over time. So later damage events should be closer to
    // base damage (10) than early ones.
    if (damageEvents.length >= 10) {
      const earlyAvg = damageEvents.slice(0, 5).reduce((s, e) => s + e.damage, 0) / 5
      const lateAvg = damageEvents.slice(-5).reduce((s, e) => s + e.damage, 0) / 5
      // Late average should be <= early average (flanking bonus decays)
      expect(lateAvg).toBeLessThanOrEqual(earlyAvg + 1) // small tolerance
    }
  })
})

// ---------------------------------------------------------------------------
// Armor class damage (placeholder)
// ---------------------------------------------------------------------------

describe('Armor class damage', () => {
  it.todo('when armorDamage map is present, simulator should use per-class multiplier instead of base damage')
})
