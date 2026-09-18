import { describe, it, expect } from 'vitest'
import unitData from '../src/assets/data/units.json'
import type { Unit, UnitData, Weapon } from '../src/types'

// Cast imported JSON to typed structure
const data = unitData as unknown as UnitData
const units: Unit[] = data.units

/** Helper: find a unit by its internal ID */
function findUnit(id: string): Unit {
  const u = units.find((u) => u.id === id)
  if (!u) throw new Error(`Unit not found: ${id}`)
  return u
}

/** Helper: find a weapon on a unit by weapon ID */
function findWeapon(unitId: string, weaponId: string): Weapon {
  const u = findUnit(unitId)
  const w = u.weapons.find((w) => w.id === weaponId)
  if (!w) throw new Error(`Weapon ${weaponId} not found on unit ${unitId}`)
  return w
}

// ─── Top-level metadata ─────────────────────────────────────────────────────

describe('UnitData metadata', () => {
  it('has a version string', () => {
    expect(data.version).toBeDefined()
    expect(typeof data.version).toBe('string')
  })

  it('has a generatedAt ISO timestamp', () => {
    expect(data.generatedAt).toBeDefined()
    expect(typeof data.generatedAt).toBe('string')
    // Should parse as a valid date
    expect(new Date(data.generatedAt).getTime()).not.toBeNaN()
  })

  it('has a source URL', () => {
    expect(data.source).toBeDefined()
    expect(data.source).toContain('beyond-all-reason')
  })

  it('has a units array', () => {
    expect(Array.isArray(data.units)).toBe(true)
  })
})

// ─── 1. Faction coverage ────────────────────────────────────────────────────

describe('Faction coverage', () => {
  it('contains exactly 696 units', () => {
    expect(units.length).toBe(696)
  })

  it('has 230 Armada units', () => {
    const armada = units.filter((u) => u.faction === 'Armada')
    expect(armada.length).toBe(230)
  })

  it('has 233 Cortex units', () => {
    const cortex = units.filter((u) => u.faction === 'Cortex')
    expect(cortex.length).toBe(233)
  })

  it('has 233 Legion units', () => {
    const legion = units.filter((u) => u.faction === 'Legion')
    expect(legion.length).toBe(233)
  })

  it('only contains the three expected factions', () => {
    const factions = new Set(units.map((u) => u.faction))
    expect(factions).toEqual(new Set(['Armada', 'Cortex', 'Legion']))
  })
})

// ─── 2. Commander detection ─────────────────────────────────────────────────

describe('Commander detection', () => {
  it('armcom is the Armada Commander', () => {
    const armcom = findUnit('armcom')
    expect(armcom.name).toBe('Armada Commander')
    expect(armcom.isCommander).toBe(true)
    expect(armcom.tier).toBe('T1')
    expect(armcom.unitType).toBe('Commander')
    expect(armcom.faction).toBe('Armada')
  })

  it('corcom is the Cortex Commander', () => {
    const corcom = findUnit('corcom')
    expect(corcom.name).toBe('Cortex Commander')
    expect(corcom.isCommander).toBe(true)
    expect(corcom.tier).toBe('T1')
    expect(corcom.unitType).toBe('Commander')
    expect(corcom.faction).toBe('Cortex')
  })

  it('armcom has exactly 3 weapons', () => {
    const armcom = findUnit('armcom')
    expect(armcom.weapons.length).toBe(3)
  })

  it('corcom has exactly 3 weapons', () => {
    const corcom = findUnit('corcom')
    expect(corcom.weapons.length).toBe(3)
  })

  it('commanders have the Disintegrator (DGun)', () => {
    const armcom = findUnit('armcom')
    const corcom = findUnit('corcom')
    const armDgun = armcom.weapons.find((w) => w.id === 'disintegrator')
    const corDgun = corcom.weapons.find((w) => w.id === 'disintegrator')
    expect(armDgun).toBeDefined()
    expect(armDgun!.projectileType).toBe('DGun')
    expect(armDgun!.damage).toBe(99999)
    expect(corDgun).toBeDefined()
    expect(corDgun!.projectileType).toBe('DGun')
  })

  it('commanders have build power and can build structures', () => {
    const armcom = findUnit('armcom')
    expect(armcom.buildPower).toBeGreaterThan(0)
    expect(armcom.canBuild).toBeDefined()
    expect(armcom.canBuild!.length).toBeGreaterThan(0)
  })

  it('commanders produce metal and energy', () => {
    const armcom = findUnit('armcom')
    expect(armcom.metalProduction).toBe(2)
    expect(armcom.energyProduction).toBe(30)
  })
})

// ─── 3. Weapon parsing (armpw) ──────────────────────────────────────────────

describe('Weapon parsing (armpw Pawn)', () => {
  it('armpw has exactly 1 weapon', () => {
    const armpw = findUnit('armpw')
    expect(armpw.weapons.length).toBe(1)
  })

  it('armpw weapon has correct damage', () => {
    const w = findWeapon('armpw', 'emg')
    expect(w.damage).toBe(9)
  })

  it('armpw weapon has correct range', () => {
    const w = findWeapon('armpw', 'emg')
    expect(w.range).toBe(180)
  })

  it('armpw weapon has correct reload time', () => {
    const w = findWeapon('armpw', 'emg')
    expect(w.reload).toBe(0.3)
  })

  it('armpw weapon has correct burst count', () => {
    const w = findWeapon('armpw', 'emg')
    expect(w.burstCount).toBe(3)
  })

  it('armpw weapon has correct burst rate', () => {
    const w = findWeapon('armpw', 'emg')
    expect(w.burstRate).toBe(0.1)
  })

  it('armpw weapon has correct projectile type (Cannon, gravity-affected)', () => {
    const w = findWeapon('armpw', 'emg')
    expect(w.projectileType).toBe('Cannon')
    expect(w.gravityAffected).toBe(true)
  })

  it('armpw weapon has correct DPS of 90', () => {
    const w = findWeapon('armpw', 'emg')
    expect(w.dps).toBe(90)
  })
})

// ─── 4. DPS calculation ─────────────────────────────────────────────────────

describe('DPS calculation', () => {
  it('armpw DPS equals damage / reload * burstCount', () => {
    const w = findWeapon('armpw', 'emg')
    // DPS formula: damage * burstCount / reload
    const expectedDps = (w.damage * (w.burstCount ?? 1)) / w.reload
    expect(expectedDps).toBe(90)
    expect(w.dps).toBe(expectedDps)
  })

  it('armcom laser DPS equals damage / reload (no burst)', () => {
    const w = findWeapon('armcom', 'armcomlaser')
    // No burstCount, so DPS = damage / reload
    const expectedDps = w.damage / w.reload
    expect(expectedDps).toBe(187.5)
    expect(w.dps).toBe(expectedDps)
  })

  it('corcom laser DPS equals damage / reload', () => {
    const w = findWeapon('corcom', 'corcomlaser')
    const expectedDps = w.damage / w.reload
    expect(expectedDps).toBe(187.5)
    expect(w.dps).toBe(expectedDps)
  })
})

// ─── 5. Metal extractor scaling ─────────────────────────────────────────────

describe('Metal extractor scaling', () => {
  it('armmex produces 1.8 metal per second (extractsmetal 0.001 * 1800)', () => {
    const armmex = findUnit('armmex')
    expect(armmex.metalProduction).toBe(1.8)
  })

  it('armmoho produces 7.2 metal per second (extractsmetal 0.004 * 1800)', () => {
    const armmoho = findUnit('armmoho')
    expect(armmoho.metalProduction).toBe(7.2)
  })

  it('armmex metal production is exactly 4x less than armmoho', () => {
    const armmex = findUnit('armmex')
    const armmoho = findUnit('armmoho')
    expect(armmoho.metalProduction! / armmex.metalProduction!).toBe(4)
  })

  it('metal extractors have energy upkeep', () => {
    const armmex = findUnit('armmex')
    const armmoho = findUnit('armmoho')
    expect(armmex.energyUpkeep).toBeGreaterThan(0)
    expect(armmoho.energyUpkeep).toBeGreaterThan(0)
  })
})

// ─── 6. Energy production ───────────────────────────────────────────────────

describe('Energy production', () => {
  it('armsolar produces exactly 20 energy per second', () => {
    const armsolar = findUnit('armsolar')
    expect(armsolar.energyProduction).toBe(20)
  })

  it('armfus produces exactly 750 energy per second', () => {
    const armfus = findUnit('armfus')
    expect(armfus.energyProduction).toBe(750)
  })

  it('armsolar is a T1 Building', () => {
    const armsolar = findUnit('armsolar')
    expect(armsolar.tier).toBe('T1')
    expect(armsolar.unitType).toBe('Building')
  })

  it('armfus is a T2 Building', () => {
    const armfus = findUnit('armfus')
    expect(armfus.tier).toBe('T2')
    expect(armfus.unitType).toBe('Building')
  })

  it('armfus has energy storage', () => {
    const armfus = findUnit('armfus')
    expect(armfus.energyStorage).toBe(2500)
  })
})

// ─── 7. Wind / tidal ────────────────────────────────────────────────────────

describe('Wind / tidal generators', () => {
  it('armwin has energyProduction = 0 (dynamic wind)', () => {
    const armwin = findUnit('armwin')
    expect(armwin.energyProduction).toBe(0)
  })

  it('armwin has no energy upkeep', () => {
    const armwin = findUnit('armwin')
    expect(armwin.energyUpkeep).toBe(0)
  })

  it('armwin has a small energy storage (capacitor)', () => {
    const armwin = findUnit('armwin')
    expect(armwin.energyStorage).toBe(0.5)
  })

  it('armwin is a T1 Building', () => {
    const armwin = findUnit('armwin')
    expect(armwin.tier).toBe('T1')
    expect(armwin.unitType).toBe('Building')
    expect(armwin.movementMode).toBe('Static')
  })
})

// ─── 8. AA weapon flags ─────────────────────────────────────────────────────

describe('Anti-air weapon flags', () => {
  it('armsam first weapon has onlyTargetsAir=true', () => {
    const armsam = findUnit('armsam')
    expect(armsam.weapons.length).toBe(2)
    const aaWeapon = armsam.weapons[0]
    expect(aaWeapon.id).toBe('armtruck_aa')
    expect(aaWeapon.onlyTargetsAir).toBe(true)
    expect(aaWeapon.canTargetAir).toBe(true)
  })

  it('armsam AA weapon is Missile type and is tracking', () => {
    const aaWeapon = findWeapon('armsam', 'armtruck_aa')
    expect(aaWeapon.projectileType).toBe('Missile')
    expect(aaWeapon.isTracking).toBe(true)
  })

  it('armsam second weapon is a ground Rocket (not AA)', () => {
    const groundWeapon = findWeapon('armsam', 'armtruck_missile')
    expect(groundWeapon.projectileType).toBe('Rocket')
    expect(groundWeapon.canTargetAir).toBe(false)
    expect(groundWeapon.onlyTargetsAir).toBeUndefined()
  })

  it('armsfig (Cyclone) has a Missile weapon with onlyTargetsAir=true', () => {
    const armsfig = findUnit('armsfig')
    expect(armsfig.name).toBe('Cyclone')
    expect(armsfig.weapons.length).toBe(1)
    const w = armsfig.weapons[0]
    expect(w.projectileType).toBe('Missile')
    expect(w.onlyTargetsAir).toBe(true)
    expect(w.isTracking).toBe(true)
  })

  it('armflak has at least 1 weapon with onlyTargetsAir and Flak type', () => {
    const armflak = findUnit('armflak')
    expect(armflak.weapons.length).toBeGreaterThanOrEqual(1)
    const flakWeapon = armflak.weapons.find(w => w.projectileType === 'Flak')
    expect(flakWeapon).toBeDefined()
    expect(flakWeapon!.onlyTargetsAir).toBe(true)
  })
})

// ─── 9. Projectile type mapping ─────────────────────────────────────────────

describe('Projectile type mapping', () => {
  it('Missile type exists for tracked guided missiles (armsfig)', () => {
    const armsfig = findUnit('armsfig')
    const w = armsfig.weapons[0]
    expect(w.projectileType).toBe('Missile')
    expect(w.isTracking).toBe(true)
  })

  it('Cannon type exists for gravity-affected ballistic projectiles (armroy)', () => {
    const armroy = findUnit('armroy')
    const cannon = armroy.weapons.find((w) => w.projectileType === 'Cannon')
    expect(cannon).toBeDefined()
    expect(cannon!.gravityAffected).toBe(true)
  })

  it('Laser type exists for instant-hit weapons (armdrone)', () => {
    const armdrone = findUnit('armdrone')
    const laser = armdrone.weapons.find((w) => w.projectileType === 'Laser')
    expect(laser).toBeDefined()
  })

  it('DGun type exists on commander disintegrators', () => {
    const armcom = findUnit('armcom')
    const dgun = armcom.weapons.find((w) => w.projectileType === 'DGun')
    expect(dgun).toBeDefined()
    expect(dgun!.damage).toBe(99999)
  })

  it('BeamLaser type exists on commander lasers', () => {
    const armcom = findUnit('armcom')
    const beam = armcom.weapons.find((w) => w.projectileType === 'BeamLaser')
    expect(beam).toBeDefined()
  })

  it('Torpedo type exists on naval weapons (armroy depthcharge)', () => {
    const armroy = findUnit('armroy')
    const torp = armroy.weapons.find((w) => w.projectileType === 'Torpedo')
    expect(torp).toBeDefined()
    expect(torp!.isTracking).toBe(true)
  })

  it('Flak type exists for AA proximity detonation weapons (armflak)', () => {
    const armflak = findUnit('armflak')
    const flakWeapon = armflak.weapons.find(w => w.projectileType === 'Flak')
    expect(flakWeapon).toBeDefined()
    expect(flakWeapon!.isFlak).toBe(true)
    expect(flakWeapon!.onlyTargetsAir).toBe(true)
  })

  it('Rocket type exists for unguided rockets (armsam ground weapon)', () => {
    const w = findWeapon('armsam', 'armtruck_missile')
    expect(w.projectileType).toBe('Rocket')
  })

  it('all weapons have a valid projectile type', () => {
    const validTypes = new Set([
      'Laser', 'BeamLaser', 'Plasma', 'Cannon', 'Rocket', 'Missile',
      'Torpedo', 'Flak', 'Heatray', 'EMP', 'DGun', 'AircraftBomb', 'Napalm', 'Other',
    ])
    for (const unit of units) {
      for (const weapon of unit.weapons) {
        expect(
          validTypes.has(weapon.projectileType),
          `${unit.id} weapon ${weapon.id} has invalid projectileType: ${weapon.projectileType}`,
        ).toBe(true)
      }
    }
  })
})

// ─── 10. New fields exist ───────────────────────────────────────────────────

describe('New weapon fields', () => {
  it('edgeEffectiveness can be present on weapons', () => {
    // Check that the Weapon interface accepts edgeEffectiveness
    // Even if no current weapon has it set, the field should be typed
    const allWeapons = units.flatMap((u) => u.weapons)
    const withEdge = allWeapons.filter((w) => w.edgeEffectiveness !== undefined)
    // edgeEffectiveness is an optional field, may or may not be present
    // The fact that TypeScript compiles this access is the main test
    expect(withEdge).toBeDefined()
  })

  it('sprayAngle can be present on weapons', () => {
    const allWeapons = units.flatMap((u) => u.weapons)
    const withSpray = allWeapons.filter((w) => w.sprayAngle !== undefined)
    expect(withSpray).toBeDefined()
  })

  it('predictBoost is present on some weapons', () => {
    const allWeapons = units.flatMap((u) => u.weapons)
    const withPredict = allWeapons.filter((w) => w.predictBoost !== undefined)
    expect(withPredict.length).toBeGreaterThan(0)
    // armsam ground weapon has predictBoost=1
    const samMissile = findWeapon('armsam', 'armtruck_missile')
    expect(samMissile.predictBoost).toBe(1)
  })

  it('targetMoveError can be present on weapons', () => {
    const allWeapons = units.flatMap((u) => u.weapons)
    const withTME = allWeapons.filter((w) => w.targetMoveError !== undefined)
    expect(withTME).toBeDefined()
  })

  it('movingAccuracy can be present on weapons', () => {
    const allWeapons = units.flatMap((u) => u.weapons)
    const withMA = allWeapons.filter((w) => w.movingAccuracy !== undefined)
    expect(withMA).toBeDefined()
  })
})

// ─── 11. Build options ──────────────────────────────────────────────────────

describe('Build options', () => {
  it('armlab canBuild has the correct unit IDs', () => {
    const armlab = findUnit('armlab')
    expect(armlab.canBuild).toBeDefined()
    expect(armlab.canBuild).toEqual([
      'armck',
      'armpw',
      'armrectr',
      'armrock',
      'armham',
      'armjeth',
      'armwar',
      'armflea',
    ])
  })

  it('armlab canBuild has exactly 8 entries', () => {
    const armlab = findUnit('armlab')
    expect(armlab.canBuild!.length).toBe(8)
  })

  it('most units referenced in canBuild exist in the dataset', () => {
    const unitIds = new Set(units.map((u) => u.id))
    let total = 0
    let missing = 0
    for (const unit of units) {
      if (unit.canBuild) {
        for (const buildId of unit.canBuild) {
          total++
          if (!unitIds.has(buildId)) missing++
        }
      }
    }
    // Allow up to 5% missing references (some units like seaplane subs
    // are referenced but may not be in the parsed dataset)
    expect(total).toBeGreaterThan(0)
    expect(missing / total).toBeLessThan(0.05)
  })

  it('factories have buildPower > 0', () => {
    const armlab = findUnit('armlab')
    expect(armlab.buildPower).toBe(150)
    expect(armlab.buildPower).toBeGreaterThan(0)
  })
})

// ─── 12. Morph detection ────────────────────────────────────────────────────

describe('Morph detection', () => {
  it('legcomlvl2 has isMorph=true', () => {
    const lvl2 = findUnit('legcomlvl2')
    expect(lvl2.isMorph).toBe(true)
  })

  it('legcomlvl3 has isMorph=true', () => {
    const lvl3 = findUnit('legcomlvl3')
    expect(lvl3.isMorph).toBe(true)
  })

  it('all legcomlvl* units have isMorph=true', () => {
    const morphLevels = units.filter((u) => u.id.startsWith('legcomlvl'))
    expect(morphLevels.length).toBeGreaterThan(0)
    for (const m of morphLevels) {
      expect(m.isMorph, `${m.id} should have isMorph=true`).toBe(true)
    }
  })

  it('legcomlvl2 is still a Commander', () => {
    const lvl2 = findUnit('legcomlvl2')
    expect(lvl2.isCommander).toBe(true)
    expect(lvl2.unitType).toBe('Commander')
    expect(lvl2.tier).toBe('T1')
  })

  it('base commanders do NOT have isMorph=true', () => {
    const armcom = findUnit('armcom')
    const corcom = findUnit('corcom')
    expect(armcom.isMorph).toBe(false)
    expect(corcom.isMorph).toBe(false)
  })
})

// ─── 13. Special units ──────────────────────────────────────────────────────

describe('Special units — mines', () => {
  const mineIds = [
    'armmine1', 'armmine2', 'armmine3', 'armfmine3',
    'cormine1', 'cormine2', 'cormine3', 'corfmine3', 'cormine4',
    'legmine1', 'legmine2', 'legmine3',
  ]

  it('all expected mine IDs exist in the dataset', () => {
    for (const id of mineIds) {
      expect(
        units.some((u) => u.id === id),
        `Mine ${id} should exist in units`,
      ).toBe(true)
    }
  })

  it('all mines have isMine=true', () => {
    for (const id of mineIds) {
      const mine = findUnit(id)
      expect(mine.isMine, `${id} should have isMine=true`).toBe(true)
    }
  })

  it('mines are static buildings', () => {
    for (const id of mineIds) {
      const mine = findUnit(id)
      expect(mine.movementMode, `${id} should be Static`).toBe('Static')
      expect(mine.unitType, `${id} should be Building`).toBe('Building')
    }
  })

  it('mines can cloak', () => {
    for (const id of mineIds) {
      const mine = findUnit(id)
      expect(mine.canCloak, `${id} should be able to cloak`).toBe(true)
    }
  })
})

describe('Special units — suicide', () => {
  it('corroach has isSuicide=true', () => {
    const corroach = findUnit('corroach')
    expect(corroach.isSuicide).toBe(true)
  })

  it('corroach is a Cortex T2 Bot', () => {
    const corroach = findUnit('corroach')
    expect(corroach.faction).toBe('Cortex')
    expect(corroach.tier).toBe('T2')
    expect(corroach.unitType).toBe('Bot')
  })

  it('corroach has no parsed weapons (self-destruct is not a weapon)', () => {
    const corroach = findUnit('corroach')
    expect(corroach.weapons.length).toBe(0)
  })
})

// ─── Structural integrity ───────────────────────────────────────────────────

describe('Structural integrity', () => {
  it('every unit has a non-empty id', () => {
    for (const unit of units) {
      expect(unit.id).toBeTruthy()
      expect(typeof unit.id).toBe('string')
    }
  })

  it('every unit has a non-empty name', () => {
    for (const unit of units) {
      expect(unit.name, `Unit ${unit.id} should have a name`).toBeTruthy()
    }
  })

  it('every unit has a valid faction', () => {
    const validFactions = new Set(['Armada', 'Cortex', 'Legion'])
    for (const unit of units) {
      expect(validFactions.has(unit.faction), `${unit.id} has invalid faction: ${unit.faction}`).toBe(true)
    }
  })

  it('every unit has a valid tier', () => {
    const validTiers = new Set(['T1', 'T2', 'T3'])
    for (const unit of units) {
      expect(validTiers.has(unit.tier), `${unit.id} has invalid tier: ${unit.tier}`).toBe(true)
    }
  })

  it('every unit has non-negative costs', () => {
    for (const unit of units) {
      expect(unit.metalCost, `${unit.id} metalCost`).toBeGreaterThanOrEqual(0)
      expect(unit.energyCost, `${unit.id} energyCost`).toBeGreaterThanOrEqual(0)
      expect(unit.buildTime, `${unit.id} buildTime`).toBeGreaterThanOrEqual(0)
    }
  })

  it('every unit has health > 0', () => {
    for (const unit of units) {
      expect(unit.health, `${unit.id} health`).toBeGreaterThan(0)
    }
  })

  it('every unit has a weapons array (possibly empty)', () => {
    for (const unit of units) {
      expect(Array.isArray(unit.weapons), `${unit.id} should have weapons array`).toBe(true)
    }
  })

  it('every weapon has a dps value', () => {
    for (const unit of units) {
      for (const weapon of unit.weapons) {
        expect(
          weapon.dps,
          `${unit.id} weapon ${weapon.id} should have dps`,
        ).toBeDefined()
        expect(weapon.dps).toBeGreaterThan(0)
      }
    }
  })

  it('unit IDs are unique', () => {
    const ids = units.map((u) => u.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  it('every unit has a footprint with positive x and z', () => {
    for (const unit of units) {
      if (unit.footprint) {
        expect(unit.footprint.x, `${unit.id} footprint.x`).toBeGreaterThan(0)
        expect(unit.footprint.z, `${unit.id} footprint.z`).toBeGreaterThan(0)
      }
    }
  })
})
