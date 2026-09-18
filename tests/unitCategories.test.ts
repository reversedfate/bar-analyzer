import { describe, it, expect } from 'vitest'
import {
  isWindGenerator,
  isTidalGenerator,
  isGeothermal,
  isDefense,
  isAirUnit,
  isNavalUnit,
  isFighter,
  isBomber,
  isFusion,
  isMetalExtractor,
  isEnergyConverter,
  isUnitExcluded,
  matchesUnitCategory,
  isTech15ByName,
  isTech2,
  isTech3,
  isGroundAttacker,
} from '../src/services/unitCategories'
import type { Unit, UnitPoolFilters } from '../src/types'

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

function defaultFilters(overrides: Partial<UnitPoolFilters> = {}): UnitPoolFilters {
  return {
    includeExtraUnits: false,
    includeScavengers: false,
    excludeTech15: false,
    excludeTech2: false,
    excludeTech3: false,
    excludeAir: false,
    excludeNaval: false,
    excludeDefenses: false,
    excludeMetalExtractors: false,
    excludeEnergyConverters: false,
    excludeFusion: false,
    excludeTacticalMissiles: false,
    excludeNuclearMissiles: false,
    excludeAntiNuke: false,
    excludeLongRangeArtillery: false,
    excludeEndgameArtillery: false,
    ...overrides,
  }
}

describe('isWindGenerator', () => {
  it('returns true for IDs ending in "win"', () => {
    expect(isWindGenerator(makeUnit({ id: 'armwin', unitType: 'Building' }))).toBe(true)
    expect(isWindGenerator(makeUnit({ id: 'corwin', unitType: 'Building' }))).toBe(true)
    expect(isWindGenerator(makeUnit({ id: 'legwin', unitType: 'Building' }))).toBe(true)
  })

  it('returns false for non-wind buildings', () => {
    expect(isWindGenerator(makeUnit({ id: 'armsolar', unitType: 'Building' }))).toBe(false)
  })

  it('returns false for non-buildings even with matching ID', () => {
    expect(isWindGenerator(makeUnit({ id: 'armwin', unitType: 'Bot' }))).toBe(false)
  })
})

describe('isTidalGenerator', () => {
  it('returns true for IDs ending in "tide"', () => {
    expect(isTidalGenerator(makeUnit({ id: 'armtide', unitType: 'Building' }))).toBe(true)
    expect(isTidalGenerator(makeUnit({ id: 'cortide', unitType: 'Building' }))).toBe(true)
  })

  it('returns false for non-tidal', () => {
    expect(isTidalGenerator(makeUnit({ id: 'armsolar', unitType: 'Building' }))).toBe(false)
  })
})

describe('isGeothermal', () => {
  it('returns true for IDs ending in "geo"', () => {
    expect(isGeothermal(makeUnit({ id: 'armgeo' }))).toBe(true)
    expect(isGeothermal(makeUnit({ id: 'corgeo' }))).toBe(true)
  })

  it('returns true for IDs ending in "geofus"', () => {
    expect(isGeothermal(makeUnit({ id: 'armgeofus' }))).toBe(true)
  })

  it('returns true for units with "geothermal" in name', () => {
    expect(isGeothermal(makeUnit({ id: 'xunit', name: 'Geothermal Powerplant' }))).toBe(true)
  })

  it('returns false for non-geo', () => {
    expect(isGeothermal(makeUnit({ id: 'armsolar', name: 'Solar Collector' }))).toBe(false)
  })
})

describe('isDefense', () => {
  it('returns true for buildings with weapons, no eco, no buildPower', () => {
    const turret = makeUnit({
      unitType: 'Building',
      weapons: [{ id: 'w', name: 'Gun', damage: 50, reload: 1, range: 300, projectileType: 'Laser', dps: 50 }],
      buildPower: 0,
      metalProduction: 0,
      energyProduction: 0,
    })
    expect(isDefense(turret)).toBe(true)
  })

  it('returns false for buildings with buildPower (factories)', () => {
    const factory = makeUnit({
      unitType: 'Building',
      weapons: [{ id: 'w', name: 'Gun', damage: 50, reload: 1, range: 300, projectileType: 'Laser', dps: 50 }],
      buildPower: 100,
    })
    expect(isDefense(factory)).toBe(false)
  })

  it('returns false for non-buildings', () => {
    const bot = makeUnit({
      unitType: 'Bot',
      weapons: [{ id: 'w', name: 'Gun', damage: 50, reload: 1, range: 300, projectileType: 'Laser', dps: 50 }],
    })
    expect(isDefense(bot)).toBe(false)
  })

  it('returns false for buildings with no weapons', () => {
    expect(isDefense(makeUnit({ unitType: 'Building', weapons: [] }))).toBe(false)
  })
})

describe('isAirUnit', () => {
  it('returns true for Aircraft unitType', () => {
    expect(isAirUnit(makeUnit({ unitType: 'Aircraft' }))).toBe(true)
  })

  it('returns true for Flying movementMode', () => {
    expect(isAirUnit(makeUnit({ unitType: 'Building', movementMode: 'Flying' }))).toBe(true)
  })

  it('returns false for ground units', () => {
    expect(isAirUnit(makeUnit({ unitType: 'Bot', movementMode: 'Walking' }))).toBe(false)
  })
})

describe('isNavalUnit', () => {
  it('returns true for Sailing movement', () => {
    expect(isNavalUnit(makeUnit({ movementMode: 'Sailing' }))).toBe(true)
  })

  it('returns true for Submarine movement', () => {
    expect(isNavalUnit(makeUnit({ movementMode: 'Submarine' }))).toBe(true)
  })

  it('returns true for Ship unitType', () => {
    expect(isNavalUnit(makeUnit({ unitType: 'Ship' }))).toBe(true)
  })

  it('returns true for shipyard buildings', () => {
    expect(isNavalUnit(makeUnit({ unitType: 'Building', name: 'Shipyard', id: 'armsy' }))).toBe(true)
  })

  it('returns true for tidal buildings', () => {
    expect(isNavalUnit(makeUnit({ unitType: 'Building', name: 'Tidal Generator', id: 'armtide' }))).toBe(true)
  })

  it('returns false for land bots', () => {
    expect(isNavalUnit(makeUnit({ unitType: 'Bot', movementMode: 'Walking' }))).toBe(false)
  })
})

describe('isFighter', () => {
  it('returns true for aircraft with "Fighter" in name', () => {
    expect(isFighter(makeUnit({ unitType: 'Aircraft', name: 'Light Fighter' }))).toBe(true)
  })

  it('returns true for aircraft with "Interceptor" in name', () => {
    expect(isFighter(makeUnit({ unitType: 'Aircraft', name: 'Fast Interceptor' }))).toBe(true)
  })

  it('returns false for non-aircraft', () => {
    expect(isFighter(makeUnit({ unitType: 'Bot', name: 'Fighter Bot' }))).toBe(false)
  })

  it('returns false for aircraft without fighter/interceptor in name', () => {
    expect(isFighter(makeUnit({ unitType: 'Aircraft', name: 'Heavy Bomber' }))).toBe(false)
  })
})

describe('isBomber', () => {
  it('returns true for aircraft with "Bomber" in name', () => {
    expect(isBomber(makeUnit({ unitType: 'Aircraft', name: 'Heavy Bomber' }))).toBe(true)
  })

  it('returns true for aircraft with "Gunship" in name', () => {
    expect(isBomber(makeUnit({ unitType: 'Aircraft', name: 'Attack Gunship' }))).toBe(true)
  })

  it('returns true for aircraft with AircraftBomb weapon', () => {
    expect(isBomber(makeUnit({
      unitType: 'Aircraft',
      name: 'Stealth Plane',
      weapons: [{ id: 'b', name: 'Bomb', damage: 500, reload: 5, range: 100, projectileType: 'AircraftBomb', dps: 100 }],
    }))).toBe(true)
  })

  it('returns false for non-aircraft', () => {
    expect(isBomber(makeUnit({ unitType: 'Bot', name: 'Bomber Bot' }))).toBe(false)
  })
})

describe('isFusion', () => {
  it('returns true for units with "Fusion" in name', () => {
    expect(isFusion(makeUnit({ name: 'Fusion Reactor' }))).toBe(true)
    expect(isFusion(makeUnit({ name: 'Advanced Fusion Power Plant' }))).toBe(true)
  })

  it('returns false for non-fusion', () => {
    expect(isFusion(makeUnit({ name: 'Solar Collector' }))).toBe(false)
  })
})

describe('isMetalExtractor', () => {
  it('returns true for positive metalProduction', () => {
    expect(isMetalExtractor(makeUnit({ metalProduction: 1.8 }))).toBe(true)
  })

  it('returns false for zero metalProduction', () => {
    expect(isMetalExtractor(makeUnit({ metalProduction: 0 }))).toBe(false)
  })

  it('returns false for undefined metalProduction', () => {
    expect(isMetalExtractor(makeUnit())).toBe(false)
  })
})

describe('isEnergyConverter', () => {
  it('returns true for units with "Converter" in name', () => {
    expect(isEnergyConverter(makeUnit({ name: 'Energy Converter' }))).toBe(true)
    expect(isEnergyConverter(makeUnit({ name: 'Advanced Energy Converter' }))).toBe(true)
  })

  it('returns false for non-converters', () => {
    expect(isEnergyConverter(makeUnit({ name: 'Metal Maker' }))).toBe(false)
  })
})

describe('isTech15ByName', () => {
  it('returns true for T1 units with "Advanced" in name', () => {
    expect(isTech15ByName(makeUnit({ tier: 'T1', name: 'Advanced Bot Lab' }))).toBe(true)
  })

  it('returns false for T2 units with "Advanced" in name', () => {
    expect(isTech15ByName(makeUnit({ tier: 'T2', name: 'Advanced Tank' }))).toBe(false)
  })

  it('returns false for T1 units without "Advanced"', () => {
    expect(isTech15ByName(makeUnit({ tier: 'T1', name: 'Bot Lab' }))).toBe(false)
  })
})

describe('isGroundAttacker', () => {
  it('returns true for armed bots', () => {
    expect(isGroundAttacker(makeUnit({
      unitType: 'Bot',
      weapons: [{ id: 'w', name: 'Gun', damage: 10, reload: 1, range: 200, projectileType: 'Laser', dps: 10 }],
    }))).toBe(true)
  })

  it('returns false for aircraft', () => {
    expect(isGroundAttacker(makeUnit({
      unitType: 'Aircraft',
      weapons: [{ id: 'w', name: 'Gun', damage: 10, reload: 1, range: 200, projectileType: 'Laser', dps: 10 }],
    }))).toBe(false)
  })

  it('returns false for buildings', () => {
    expect(isGroundAttacker(makeUnit({
      unitType: 'Building',
      weapons: [{ id: 'w', name: 'Gun', damage: 10, reload: 1, range: 200, projectileType: 'Laser', dps: 10 }],
    }))).toBe(false)
  })

  it('returns false for unarmed bots', () => {
    expect(isGroundAttacker(makeUnit({ unitType: 'Bot', weapons: [] }))).toBe(false)
  })
})

describe('matchesUnitCategory', () => {
  it('anyT1Factory matches T1 building with lab/plant in name and buildPower', () => {
    expect(matchesUnitCategory(
      makeUnit({ unitType: 'Building', tier: 'T1', name: 'Bot Lab', buildPower: 100 }),
      'anyT1Factory',
    )).toBe(true)
  })

  it('anyT1Factory does not match T2 factory', () => {
    expect(matchesUnitCategory(
      makeUnit({ unitType: 'Building', tier: 'T2', name: 'Advanced Bot Lab', buildPower: 100 }),
      'anyT1Factory',
    )).toBe(false)
  })

  it('anyT2Factory matches T2 building with plant in name', () => {
    expect(matchesUnitCategory(
      makeUnit({ unitType: 'Building', tier: 'T2', name: 'Vehicle Plant', buildPower: 200 }),
      'anyT2Factory',
    )).toBe(true)
  })

  it('anyT3Factory matches T3 gantry', () => {
    expect(matchesUnitCategory(
      makeUnit({ unitType: 'Building', tier: 'T3', name: 'Experimental Gantry', buildPower: 300 }),
      'anyT3Factory',
    )).toBe(true)
  })

  it('anyT1Constructor matches T1 mobile builder', () => {
    expect(matchesUnitCategory(
      makeUnit({ unitType: 'Bot', tier: 'T1', name: 'Construction Bot', buildPower: 100 }),
      'anyT1Constructor',
    )).toBe(true)
  })

  it('anyT1Constructor does not match commander', () => {
    expect(matchesUnitCategory(
      makeUnit({ unitType: 'Commander', tier: 'T1', name: 'Commander', buildPower: 300 }),
      'anyT1Constructor',
    )).toBe(false)
  })

  it('anyT2Constructor matches T2 mobile builder', () => {
    expect(matchesUnitCategory(
      makeUnit({ unitType: 'Bot', tier: 'T2', name: 'Adv Constructor', buildPower: 200 }),
      'anyT2Constructor',
    )).toBe(true)
  })

  it('anyFusion matches unit with Fusion in name', () => {
    expect(matchesUnitCategory(
      makeUnit({ name: 'Fusion Reactor' }),
      'anyFusion',
    )).toBe(true)
  })

  it('anyFighter matches aircraft with Fighter in name', () => {
    expect(matchesUnitCategory(
      makeUnit({ unitType: 'Aircraft', name: 'Light Fighter' }),
      'anyFighter',
    )).toBe(true)
  })

  it('anyBomber matches aircraft with Bomber in name', () => {
    expect(matchesUnitCategory(
      makeUnit({ unitType: 'Aircraft', name: 'Heavy Bomber' }),
      'anyBomber',
    )).toBe(true)
  })
})

describe('isUnitExcluded', () => {
  it('excludes air units when excludeAir is true', () => {
    const unit = makeUnit({ unitType: 'Aircraft' })
    expect(isUnitExcluded(unit, defaultFilters({ excludeAir: true }))).toBe(true)
    expect(isUnitExcluded(unit, defaultFilters({ excludeAir: false }))).toBe(false)
  })

  it('excludes naval units when excludeNaval is true', () => {
    const unit = makeUnit({ movementMode: 'Sailing' })
    expect(isUnitExcluded(unit, defaultFilters({ excludeNaval: true }))).toBe(true)
    expect(isUnitExcluded(unit, defaultFilters({ excludeNaval: false }))).toBe(false)
  })

  it('excludes T2 when excludeTech2 is true', () => {
    const unit = makeUnit({ tier: 'T2' })
    expect(isUnitExcluded(unit, defaultFilters({ excludeTech2: true }))).toBe(true)
  })

  it('excludes T3 when excludeTech3 is true', () => {
    const unit = makeUnit({ tier: 'T3' })
    expect(isUnitExcluded(unit, defaultFilters({ excludeTech3: true }))).toBe(true)
  })

  it('excludes defenses when excludeDefenses is true', () => {
    const turret = makeUnit({
      unitType: 'Building',
      weapons: [{ id: 'w', name: 'Gun', damage: 50, reload: 1, range: 300, projectileType: 'Laser', dps: 50 }],
      buildPower: 0,
      metalProduction: 0,
      energyProduction: 0,
    })
    expect(isUnitExcluded(turret, defaultFilters({ excludeDefenses: true }))).toBe(true)
  })

  it('excludes metal extractors when excludeMetalExtractors is true', () => {
    const mex = makeUnit({ metalProduction: 1.8 })
    expect(isUnitExcluded(mex, defaultFilters({ excludeMetalExtractors: true }))).toBe(true)
  })

  it('excludes fusion when excludeFusion is true', () => {
    const fusion = makeUnit({ name: 'Fusion Reactor' })
    expect(isUnitExcluded(fusion, defaultFilters({ excludeFusion: true }))).toBe(true)
  })

  it('excludes energy converters when excludeEnergyConverters is true', () => {
    const conv = makeUnit({ name: 'Energy Converter' })
    expect(isUnitExcluded(conv, defaultFilters({ excludeEnergyConverters: true }))).toBe(true)
  })

  it('does not exclude with all filters off', () => {
    const unit = makeUnit()
    expect(isUnitExcluded(unit, defaultFilters())).toBe(false)
  })

  it('excludes T1.5 when excludeTech15 is true', () => {
    const unit = makeUnit({ tier: 'T1', name: 'Advanced Solar Collector' })
    expect(isUnitExcluded(unit, defaultFilters({ excludeTech15: true }))).toBe(true)
  })
})
