/**
 * Unit category detection for the BAR build-order optimizer.
 *
 * Based on analysis of the actual BAR game source code:
 *   https://github.com/beyond-all-reason/Beyond-All-Reason
 *
 * All functions use only the fields available in the exported units.json.
 * Detection is name / description / field-based since the JSON lacks explicit
 * category tags (the `category` field is never populated in the export).
 */

import type { Unit, UnitPoolFilters, UnitCategoryId } from '../types'

// ── Tech Level ────────────────────────────────────────────────────────────────

/**
 * T1.5: tier=T1 but labeled "Advanced" — requires a T1 constructor, NOT the
 * commander. E.g. armalab (Advanced Bot Lab), armadvsol (Advanced Solar).
 */
export function isTech15ByName(u: Unit): boolean {
  return u.tier === 'T1' && u.name.toLowerCase().includes('advanced')
}

/**
 * T1.5 by stealth-MEX pattern: cloakable/stealth MEX units.
 * armamex (Twilight) and legmext15 (Overcharged MEX) are NOT in the
 * commander's buildoptions per the BAR game source, but have neither "Advanced"
 * in their name nor tier=T2. Detect via stealth flag + metalProduction.
 */
export function isStealthOrOverchargedMex(u: Unit): boolean {
  return (
    u.tier === 'T1' &&
    (u.metalProduction ?? 0) > 0 &&
    (u.canCloak === true || u.stealth === true)
  )
}

/** T2: data tier is 'T2' */
export function isTech2(u: Unit): boolean {
  return u.tier === 'T2'
}

/**
 * T3 / Experimental: tier=T3 OR "Experimental" in name.
 * BAR labels Experimental factories (armhalab, armhaap, etc.) as tier=T1 in
 * the data even though they need T2 constructors in-game. The name check
 * catches them.
 */
export function isTech3(u: Unit): boolean {
  return u.tier === 'T3' || u.name.toLowerCase().includes('experimental')
}

// ── Unit Type ─────────────────────────────────────────────────────────────────

/** Aircraft or any flying unit */
export function isAirUnit(u: Unit): boolean {
  return u.unitType === 'Aircraft' || u.movementMode === 'Flying'
}

/**
 * Naval unit: ships, submarines, hover units, and naval yards.
 * Covers anything that operates primarily on or under water.
 */
export function isNavalUnit(u: Unit): boolean {
  if (u.movementMode === 'Sailing' || u.movementMode === 'Submarine') return true
  if (u.unitType === 'Ship') return true
  // Naval buildings: shipyards and naval labs/factories identified by name
  if (u.unitType === 'Building') {
    const name = u.name.toLowerCase()
    const id = u.id.toLowerCase()
    if (name.includes('shipyard') || name.includes('naval') || name.includes('torpedo plant')) return true
    // Seaplane platforms and construction seaplanes (armplat, corplat, legsplab, armseap, corseap, armcsa, corcsa, legspcon)
    if (name.includes('seaplane') || name.includes('offshore')) return true
    if (u.movementMode === 'Flying') return true  // construction seaplanes: Building type + Flying movement
    // BAR IDs: armsy, corsy, legsy (shipyards), armtl/cortl/legtl (torpedo launchers are naval)
    // armfrt/corfrt/legfrt (floating radar — requires open water, minwaterdepth > 0)
    // armfhp/corfhp/legfhp (floating hard point / platform — water-only)
    // armtide/cortide/legtide (tidal generators — require minwaterdepth = 20)
    // armuwms/coruwms (underwater metal storage), armuwes/coruwes (underwater energy storage)
    // armuwg/coruwg (underwater geothermal — water-only geo plants)
    if (id.endsWith('sy') && id.length <= 6) return true   // *sy = shipyard
    if (id.endsWith('frt')) return true                    // floating radar
    if (id.endsWith('fhp')) return true                    // floating hard point / platform
    if (id.endsWith('tide')) return true                   // tidal generator (water-only)
    if (id.includes('uwm') || id.includes('uwe')) return true  // underwater storage
    if (id.includes('uwg')) return true                    // underwater geothermal
  }
  return false
}

/**
 * Wind generator: energy building that produces variable power based on wind speed.
 * BAR IDs: armwin, corwin, legwin.
 * These have energyProduction: 0 in the exported JSON — their actual output is
 * computed dynamically from windgenerator × windSpeed / windMax.
 */
export function isWindGenerator(u: Unit): boolean {
  return u.unitType === 'Building' && u.id.toLowerCase().endsWith('win')
}

/**
 * Tidal generator: energy building that requires water (minwaterdepth = 20).
 * BAR IDs: armtide, cortide, legtide.
 * Output = tidalStrength × tidalgenerator (which equals 1 in BAR source).
 * Already covered by isNavalUnit; exported here for effective-production overrides.
 */
export function isTidalGenerator(u: Unit): boolean {
  return u.unitType === 'Building' && u.id.toLowerCase().endsWith('tide')
}

/**
 * Ground attacker: a non-aircraft, non-building combat unit.
 * Bots, Vehicles, Hovercraft, Ships, and Commanders with weapons are all
 * considered capable of attacking ground targets.
 * Aircraft are excluded regardless of weapons (they use their own roles).
 */
export function isGroundAttacker(u: Unit): boolean {
  return (
    u.weapons.length > 0 &&
    u.unitType !== 'Aircraft' &&
    u.unitType !== 'Building'
  )
}

/**
 * Fighter aircraft: aircraft primarily designed for air-to-air combat.
 * Detected by "Fighter" or "Interceptor" in the unit name.
 */
export function isFighter(u: Unit): boolean {
  if (u.unitType !== 'Aircraft') return false
  const name = u.name.toLowerCase()
  return name.includes('fighter') || name.includes('interceptor')
}

/**
 * Bomber / gunship aircraft: aircraft designed to attack ground targets.
 * Detected by "Bomber" or "Gunship" in the unit name, or by the presence of
 * AircraftBomb or Napalm weapons.
 */
export function isBomber(u: Unit): boolean {
  if (u.unitType !== 'Aircraft') return false
  const name = u.name.toLowerCase()
  return (
    name.includes('bomber') ||
    name.includes('gunship') ||
    u.weapons.some(
      (w) => w.projectileType === 'AircraftBomb' || w.projectileType === 'Napalm',
    )
  )
}

/**
 * Defensive building: Building with weapons but zero build-power,
 * zero metal production, and zero energy production.
 * Covers turrets, rocket towers, torpedoes, depth charges, AA guns, etc.
 */
export function isDefense(u: Unit): boolean {
  return (
    u.unitType === 'Building' &&
    u.weapons.length > 0 &&
    (u.buildPower ?? 0) === 0 &&
    (u.metalProduction ?? 0) === 0 &&
    (u.energyProduction ?? 0) === 0
  )
}

/** Metal extractor: positive metalProduction */
export function isMetalExtractor(u: Unit): boolean {
  return (u.metalProduction ?? 0) > 0
}

/**
 * Energy converter: converts energy → metal.
 * armmmkr / cormmkr (Advanced Energy Converter, 600E→10.3M/s),
 * armmakr / cormakr (Energy Converter, 70E→1M/s), and Legion equivalents.
 * Reliable marker: "Converter" in name.
 */
export function isEnergyConverter(u: Unit): boolean {
  return u.name.toLowerCase().includes('converter')
}

/** Fusion reactor (any tier) */
export function isFusion(u: Unit): boolean {
  return u.name.toLowerCase().includes('fusion')
}

/**
 * Geothermal power plant — occupies a geo spot on the map.
 * IDs: armgeo, corgeo, leggeo (basic), armgeofus, corgeofus (geo+fusion hybrid).
 * Detected by ID suffix or "geothermal" in name.
 */
export function isGeothermal(u: Unit): boolean {
  const id = u.id.toLowerCase()
  const name = u.name.toLowerCase()
  return id.endsWith('geo') || id.endsWith('geofus') || name.includes('geothermal')
}

// ── Special Weapons ───────────────────────────────────────────────────────────

/**
 * Nuclear missile silo / submarine launcher.
 * IDs: armsilo (Armageddon), corsilo (Apocalypse), legsilo (Supernova),
 *      armseadragon, cordesolator.
 * Detected by "Nuclear ICBM Launcher" in description.
 */
export function isNuclearMissile(u: Unit): boolean {
  const desc = (u.description ?? '').toLowerCase()
  return desc.includes('nuclear icbm') || desc.includes('nuclear missile launcher')
}

/**
 * Anti-nuke defense system.
 * IDs: armamd (Citadel), corfmd (Prevailer), legabm (Aegis),
 *      armscab (mobile), cormabm (mobile), legavantinuke (mobile).
 * Detected by "Anti-Nuke" in description.
 */
export function isAntiNuke(u: Unit): boolean {
  const desc = (u.description ?? '').toLowerCase()
  return desc.includes('anti-nuke') || desc.includes('anti nuke')
}

/**
 * Tactical missile launcher or EMP platform.
 * Excludes nuclear missiles and anti-nuke (handled by their own filters).
 * Detected by: EMP weapon type OR "missile" in description for buildings.
 */
export function isTacticalMissileOrEMP(u: Unit): boolean {
  if (isNuclearMissile(u) || isAntiNuke(u)) return false
  if (u.weapons.some((w) => w.projectileType === 'EMP')) return true
  const desc = (u.description ?? '').toLowerCase()
  if (u.unitType === 'Building' && desc.includes('missile') && !desc.includes('anti')) return true
  return false
}

/**
 * Long-range artillery (Bertha class: armbrtha, corbrtha).
 * BAR file: units/ArmBuildings/LandDefenceOffence/armbrtha.lua
 * Also catches units with "artillery" in name for buildings.
 */
export function isLongRangeArtillery(u: Unit): boolean {
  const id = u.id.toLowerCase()
  const name = u.name.toLowerCase()
  return (
    id.includes('brtha') ||
    id.includes('brth') ||
    name.includes('bertha') ||
    (u.unitType === 'Building' && name.includes('artillery'))
  )
}

/**
 * Endgame / planet-cracker artillery (Intimidator class, T3 artillery).
 * Catches "Intimidator" in ID/name and T3 long-range platforms.
 */
export function isEndgameArtillery(u: Unit): boolean {
  const id = u.id.toLowerCase()
  const name = u.name.toLowerCase()
  return (
    id.includes('intim') ||
    name.includes('intimidator') ||
    name.includes('planet') ||
    (isTech3(u) && isLongRangeArtillery(u))
  )
}

// ── Game-Mode Packs ───────────────────────────────────────────────────────────

/**
 * Scavenger mode units.
 *
 * In BAR, scavenger units are generated at runtime with a "_scav" suffix
 * (e.g. armpw_scav). The current units.json export does NOT include them
 * (they're synthesised by the engine), so this returns false for all current
 * data. The toggle is provided for forward-compatibility once the data is
 * updated, and to give users a clear UI option matching the game lobby option
 * "scavunitsforplayers".
 */
export function isScavengerUnit(u: Unit): boolean {
  return u.id.endsWith('_scav') || u.name.toLowerCase().includes('scavenger')
}

/**
 * Extra units pack (game option: experimentalextraunits).
 *
 * These are community-designed units in units/Scavengers/ that are either
 * too powerful or too quirky for standard PvP. Known IDs end in "t4", "boss",
 * or have specific names. Like scavenger units, they may not be present in
 * the current data export; the toggle is provided for forward-compatibility.
 */
export function isExtraUnit(u: Unit): boolean {
  const id = u.id.toLowerCase()
  return (
    id.endsWith('t4') ||
    id.includes('boss') ||
    id.includes('epoch') ||
    id.includes('lunchbox') ||
    id.includes('meatball') ||
    id.includes('assimilator') ||
    id.includes('zapper') ||    // cortorch, armzapper
    id.includes('thermite') ||
    id.includes('_old')         // legeheatraymech_old
  )
}

// ── Unit Category Matching ────────────────────────────────────────────────────

export const UNIT_CATEGORY_LABELS: Record<UnitCategoryId, string> = {
  anyT1Factory:     'Any T1 Factory (lab / plant)',
  anyT2Factory:     'Any T2 Factory',
  anyT3Factory:     'Any Experimental Factory',
  anyT1Constructor: 'Any T1 Constructor',
  anyT2Constructor: 'Any T2 Constructor',
  anyFusion:        'Any Fusion Reactor',
  anyFighter:       'Any Fighter / Interceptor aircraft',
  anyBomber:        'Any Bomber / Gunship aircraft',
}

/**
 * Returns true if the unit matches the given broad category.
 * Used for unitCategory checkpoints so goals can target "any T2 factory"
 * instead of a specific unit ID.
 */
export function matchesUnitCategory(unit: Unit, categoryId: UnitCategoryId): boolean {
  const name = unit.name.toLowerCase()

  // Factory = stationary building that queues production of mobile units.
  // Detected via common name fragments; construction towers are excluded by
  // absence of 'lab', 'plant', 'hangar', 'shipyard' in their names.
  const isFactory =
    unit.unitType === 'Building' &&
    (unit.buildPower ?? 0) > 0 &&
    (name.includes('lab') ||
      name.includes('plant') ||
      name.includes('hangar') ||
      name.includes('shipyard') ||
      name.includes('gantry'))

  // Mobile constructor: has build power, is not a static building, not commander
  const isMobileConstructor =
    (unit.buildPower ?? 0) > 0 &&
    unit.unitType !== 'Building' &&
    unit.unitType !== 'Commander'

  switch (categoryId) {
    case 'anyT1Factory':     return isFactory && unit.tier === 'T1' && !isTech3(unit)
    case 'anyT2Factory':     return isFactory && unit.tier === 'T2'
    case 'anyT3Factory':     return isFactory && (unit.tier === 'T3' || isTech3(unit))
    case 'anyT1Constructor': return isMobileConstructor && unit.tier === 'T1'
    case 'anyT2Constructor': return isMobileConstructor && unit.tier === 'T2'
    case 'anyFusion':        return isFusion(unit)
    case 'anyFighter':       return isFighter(unit)
    case 'anyBomber':        return isBomber(unit)
    default:                 return false
  }
}

// ── Master Exclusion Check ────────────────────────────────────────────────────

/**
 * Returns true if the unit should be EXCLUDED from the optimizer pool
 * under the given filter settings.
 */
export function isUnitExcluded(u: Unit, filters: UnitPoolFilters): boolean {
  if (!filters.includeExtraUnits && isExtraUnit(u)) return true
  if (!filters.includeScavengers && isScavengerUnit(u)) return true
  if (filters.excludeTech15 && (isTech15ByName(u) || isStealthOrOverchargedMex(u))) return true
  if (filters.excludeTech2 && isTech2(u)) return true
  if (filters.excludeTech3 && isTech3(u)) return true
  if (filters.excludeAir && isAirUnit(u)) return true
  if (filters.excludeNaval && isNavalUnit(u)) return true
  if (filters.excludeDefenses && isDefense(u)) return true
  if (filters.excludeMetalExtractors && isMetalExtractor(u)) return true
  if (filters.excludeEnergyConverters && isEnergyConverter(u)) return true
  if (filters.excludeFusion && isFusion(u)) return true
  if (filters.excludeTacticalMissiles && isTacticalMissileOrEMP(u)) return true
  if (filters.excludeNuclearMissiles && isNuclearMissile(u)) return true
  if (filters.excludeAntiNuke && isAntiNuke(u)) return true
  if (filters.excludeLongRangeArtillery && isLongRangeArtillery(u)) return true
  if (filters.excludeEndgameArtillery && isEndgameArtillery(u)) return true
  return false
}
