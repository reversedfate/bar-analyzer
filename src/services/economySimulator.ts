import type {
  Unit,
  SimConfig,
  SimResult,
  SimSnapshot,
  BuildEvent,
  BuilderTimelineEntry,
  BuilderTimelineSnapshot,
} from '../types'
import { isGeothermal, isWindGenerator, isTidalGenerator, isGroundAttacker } from './unitCategories'

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Metal production of a T1 MEX on a standard BAR map (extractsmetal=0.001 at density 1800).
 * Used to scale MEX income by tier: T2 MEX has extractsmetal=0.004, producing 4× more.
 * In the sim: `metalIncome += metalPerSpot * (unit.metalProduction / BASE_T1_MEX_RATE)`
 */
export const BASE_T1_MEX_RATE = 1.8

// ── Reclaim gene helpers ──────────────────────────────────────────────────────

export const RECLAIM_PREFIX = 'RECLAIM:'

/** Fraction of a unit's metal cost returned when reclaiming it (BAR default ≈ 100 %). */
export const RECLAIM_EFFICIENCY = 1.0

export function isReclaimGene(gene: string): boolean {
  return gene.startsWith(RECLAIM_PREFIX)
}

/** Extract the target unit ID from a reclaim gene string. */
export function getReclaimTargetId(gene: string): string {
  return gene.slice(RECLAIM_PREFIX.length)
}

/** Build a reclaim gene string from a unit ID. */
export function makeReclaimGene(unitId: string): string {
  return RECLAIM_PREFIX + unitId
}

// ── Indexes / capability maps ─────────────────────────────────────────────────

export interface UnitIndex {
  byId: Map<string, Unit>
  armyUnitIds: Set<string>          // no eco production, no buildpower, not commander
  unitCombatDps: Map<string, number> // pre-computed DPS for each army unit
  groundAttackerIds: Set<string>    // army units that are ground attackers (non-aircraft)
}

/**
 * Inverse of builderMap: for each builder unit, the set of unit IDs it can produce.
 * Pre-computed once per run so the hot-path sim can do O(1) capability lookups.
 */
export interface BuilderCapabilities {
  byBuilderId: Map<string, Set<string>>
}

/** Build a fast lookup index from a unit list. Call once per GA run. */
export function buildUnitIndex(units: Unit[]): UnitIndex {
  const byId = new Map<string, Unit>()
  const armyUnitIds = new Set<string>()
  const unitCombatDps = new Map<string, number>()
  const groundAttackerIds = new Set<string>()
  for (const unit of units) {
    byId.set(unit.id, unit)
    if (
      (unit.metalProduction ?? 0) === 0 &&
      (unit.energyProduction ?? 0) === 0 &&
      (unit.buildPower ?? 0) === 0 &&
      !unit.isCommander &&
      unit.unitType !== 'Building'
    ) {
      armyUnitIds.add(unit.id)
      const dps = unit.weapons.reduce(
        (sum, w) => sum + (w.dps != null ? w.dps : w.reload > 0 ? w.damage / w.reload : 0),
        0,
      )
      unitCombatDps.set(unit.id, dps)
      if (isGroundAttacker(unit)) groundAttackerIds.add(unit.id)
    }
  }
  return { byId, armyUnitIds, unitCombatDps, groundAttackerIds }
}

/**
 * Invert a builderMap (unitId → builderIds[]) into a capabilities map
 * (builderId → Set of buildable unit IDs).  Call once per run.
 */
export function buildBuilderCapabilities(
  builderMap: Map<string, string[]>,
): BuilderCapabilities {
  const byBuilderId = new Map<string, Set<string>>()
  for (const [unitId, builderIds] of builderMap) {
    for (const bId of builderIds) {
      if (!byBuilderId.has(bId)) byBuilderId.set(bId, new Set())
      byBuilderId.get(bId)!.add(unitId)
    }
  }
  return { byBuilderId }
}

// ── Internal construction site ────────────────────────────────────────────────

/**
 * A shared work item that one or more builders contribute build power to.
 *
 * Build sites:    cost metal+energy; progress scales with total assigned BP.
 * Reclaim sites:  return metal; progress always at full BP (no resource ratio).
 *
 * Multiple mobile constructors (and the commander) can be assigned to the same
 * site simultaneously, combining their build powers — exactly like BAR's assist
 * mechanic.  Factory-type builders (armlab, armvp, …) only work on their own
 * gene claim and never assist other sites.
 */
interface ConstructionSite {
  id: number
  targetUnitId: string
  targetUnit: Unit
  isReclaimSite: boolean
  buildTime: number
  progress: number
}

// ── Active builder struct ─────────────────────────────────────────────────────

/** Internal per-builder state during simulation. */
interface ActiveBuilder {
  id: string
  dead: boolean
  /**
   * true for Building-type units with buildPower (labs, vehicle plants, air plants…).
   * Factory builders only work on their own gene; they never assist another site.
   * Mobile constructors (Bot/Vehicle/Aircraft/Commander with buildPower) are NOT factories.
   */
  isFactory: boolean
  caps: Set<string> | undefined   // cached capability set (build only — not reclaim)
  buildPower: number
  buildPowerPerTick: number       // buildPower / tps — pre-computed constant
  /** Construction site this builder is currently working on. null = idle. */
  siteId: number | null
}

// ── Main simulation ───────────────────────────────────────────────────────────

/**
 * Multi-builder simulation of a build order.
 *
 * Resource spending follows BAR's formula exactly:
 *   metalPerTick = metalCost × (builderBP / buildTime / tps)
 *   — same for every builder contributing to a site; demands add linearly.
 *
 * Assist mechanic:
 *   Any idle non-factory builder that has no gene to claim will automatically
 *   assist the oldest in-progress construction site (including factory queues),
 *   combining build power to finish it faster and consuming more resources per
 *   second proportionally — matching the in-game nano/assist behaviour.
 *
 * Factory isolation:
 *   Factory-type builders (unitType === 'Building' with buildPower) only work on
 *   their own internally-queued genes.  They never assist other sites.
 */
export function simulateBuildOrder(
  buildOrder: string[],
  config: SimConfig,
  unitIndex: UnitIndex,
  builderCapabilities: BuilderCapabilities,
): SimResult {
  let metal = config.startingMetal
  let energy = config.startingEnergy
  let metalCap = config.startingMetalStorage
  let energyCap = config.startingEnergyStorage
  let metalIncome = config.commanderMetalIncome
  let energyIncome = config.commanderEnergyIncome
  let mexBuilt = 0
  let geoBuilt = 0
  const maxMetalSpots = config.maxMetalSpots
  const metalPerSpot = config.metalPerSpot
  const maxGeoSpots = config.maxGeoSpots

  const tps = config.ticksPerSecond
  const builders: ActiveBuilder[] = []
  const sites: ConstructionSite[] = []
  let nextSiteId = 0

  function isFactoryUnit(u: Unit): boolean {
    return u.unitType === 'Building' && (u.buildPower ?? 0) > 0 && !u.isCommander
  }

  function addBuilder(id: string, bp: number, factory: boolean): void {
    builders.push({
      id,
      dead: false,
      isFactory: factory,
      caps: builderCapabilities.byBuilderId.get(id),
      buildPower: bp,
      buildPowerPerTick: bp / tps,
      siteId: null,
    })
  }

  const cmdUnit = unitIndex.byId.get(config.commanderUnitId)
  addBuilder(
    config.commanderUnitId,
    config.commanderBuildpower,
    cmdUnit ? isFactoryUnit(cmdUnit) : false,
  )

  // aliveCount: how many of each unit are currently on-field and reclaimable.
  // Decremented when a reclaim gene is claimed (prevents double-claiming).
  const aliveCount = new Map<string, number>()

  for (const uid of config.additionalStartingUnitIds ?? []) {
    const u = unitIndex.byId.get(uid)
    if (!u) continue
    if ((u.buildPower ?? 0) > 0) addBuilder(uid, u.buildPower!, isFactoryUnit(u))
    metalIncome += u.metalProduction ?? 0
    energyIncome += u.energyProduction ?? 0
    energyIncome -= u.energyUpkeep ?? 0
    metalCap += u.metalStorage ?? 0
    energyCap += u.energyStorage ?? 0
    if ((u.metalProduction ?? 0) > 0) mexBuilt++
    if (isGeothermal(u)) geoBuilt++
    if (u.energyConverterCapacity) addConverter(u)
    aliveCount.set(uid, (aliveCount.get(uid) ?? 0) + 1)
  }

  // ── Sim state ────────────────────────────────────────────────────────────

  const totalTicks = config.durationSeconds * tps
  const snapshotTimes = [...config.snapshotTimes].sort((a, b) => a - b)
  const isDisplayMode = tps >= 30

  const snapshots: SimSnapshot[] = []
  const buildTimeline: BuildEvent[] = []
  const builderTimeline: BuilderTimelineSnapshot[] = []
  const completedUnitIds: string[] = []

  const queue = [...buildOrder]
  let totalMetalSpent = 0
  let totalEnergySpent = 0
  let armyMetalSpent = 0
  let currentArmyMetal = 0
  let currentArmyDps = 0
  let currentArmyHealth = 0
  let currentArmyGroundDps = 0
  let totalMetalWasted = 0
  let totalEnergyWasted = 0
  let buildPowerPotential = 0
  let buildPowerWasted = 0
  let windGeneratorCount = 0
  let totalConverterMetalOutput = 0
  let snapshotPointer = 0

  // ── Energy converters (metal makers) ─────────────────────────────────────
  // Each entry: energy consumed per tick and metal produced per energy unit.
  // Sorted by efficiency descending (highest-efficiency converters run first)
  // to match the BAR gadget's eSteps ordering.
  // The mmLevel threshold (0.75) means converters only run when energy is above
  // 75% of storage capacity — matching game_energy_conversion.lua.
  const CONVERTER_MM_LEVEL = 0.75
  interface ActiveConverter { capacityPerTick: number; efficiency: number }
  const activeConverters: ActiveConverter[] = []

  function addConverter(unit: Unit): void {
    activeConverters.push({
      capacityPerTick: unit.energyConverterCapacity! / tps,
      efficiency: unit.energyConverterEfficiency!,
    })
    // Keep sorted by efficiency descending (highest-efficiency first, matching the game)
    activeConverters.sort((a, b) => b.efficiency - a.efficiency)
  }

  function removeConverter(unit: Unit): void {
    const target = unit.energyConverterCapacity! / tps
    const eff = unit.energyConverterEfficiency!
    const idx = activeConverters.findIndex(
      (c) => Math.abs(c.capacityPerTick - target) < 1e-6 && Math.abs(c.efficiency - eff) < 1e-9,
    )
    if (idx >= 0) activeConverters.splice(idx, 1)
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Create a new build site from a gene and assign it to a builder. */
  function claimBuildGene(builder: ActiveBuilder, qi: number): void {
    const gene = queue[qi]
    const unit = unitIndex.byId.get(gene)
    if (!unit) { queue.splice(qi, 1); return }
    queue.splice(qi, 1)
    const siteId = nextSiteId++
    sites.push({ id: siteId, targetUnitId: gene, targetUnit: unit, isReclaimSite: false, buildTime: unit.buildTime, progress: 0 })
    builder.siteId = siteId
  }

  /** Create a new reclaim site from a gene and assign it to a builder. */
  function claimReclaimGene(builder: ActiveBuilder, qi: number, targetId: string): void {
    const alive = aliveCount.get(targetId) ?? 0
    if (alive === 0) { queue.splice(qi, 1); return }
    queue.splice(qi, 1)
    aliveCount.set(targetId, alive - 1)
    const unit = unitIndex.byId.get(targetId)!
    const siteId = nextSiteId++
    sites.push({ id: siteId, targetUnitId: targetId, targetUnit: unit, isReclaimSite: true, buildTime: unit.buildTime, progress: 0 })
    builder.siteId = siteId
  }

  /**
   * Release all builders from a site (set siteId = null).
   * For orphaned reclaim sites, restore the aliveCount reservation.
   * Does NOT modify the sites array — caller is responsible for that.
   */
  function releaseSite(site: ConstructionSite, restoreAlive: boolean): void {
    for (const b of builders) {
      if (b.siteId === site.id) b.siteId = null
    }
    if (restoreAlive && site.isReclaimSite) {
      aliveCount.set(site.targetUnitId, (aliveCount.get(site.targetUnitId) ?? 0) + 1)
    }
  }

  /**
   * Apply all side-effects of completing a construction site (build or reclaim),
   * release its builders, and remove it from the sites array.
   *
   * Must be called while iterating backwards over sites (safe splice).
   */
  function completeSite(si: number, timeNow: number): void {
    const site = sites[si]
    const unit = site.targetUnit
    const completedId = site.targetUnitId

    if (site.isReclaimSite) {
      // ── Reclaim completed ──────────────────────────────────────────────────
      const metalReturned = unit.metalCost * RECLAIM_EFFICIENCY
      metal = Math.min(metal + metalReturned, metalCap)

      if ((unit.metalStorage ?? 0) > 0) metalCap = Math.max(metalCap - unit.metalStorage!, 0)
      if ((unit.energyStorage ?? 0) > 0) energyCap = Math.max(energyCap - unit.energyStorage!, 0)

      // Reverse MEX income (pool model: reduce only if remaining alive < spots used)
      // aliveCount was decremented at claim time, so it already reflects post-reclaim count.
      if ((unit.metalProduction ?? 0) > 0) {
        const aliveAfter = aliveCount.get(completedId) ?? 0
        if (mexBuilt > aliveAfter) {
          metalIncome = Math.max(0, metalIncome - metalPerSpot)
          mexBuilt--
        }
      }

      // Reverse geo income (same pool model)
      if (isGeothermal(unit)) {
        const aliveAfter = aliveCount.get(completedId) ?? 0
        if (geoBuilt > aliveAfter) {
          energyIncome = Math.max(0, energyIncome - (unit.energyProduction ?? 0))
          geoBuilt--
        }
      } else if (isWindGenerator(unit)) {
        energyIncome = Math.max(0, energyIncome - config.windAvg)
        windGeneratorCount = Math.max(0, windGeneratorCount - 1)
      } else if (isTidalGenerator(unit)) {
        energyIncome = Math.max(0, energyIncome - config.tidalStrength)
      } else if ((unit.energyProduction ?? 0) > 0) {
        energyIncome = Math.max(0, energyIncome - (unit.energyProduction ?? 0))
      }
      // Restore energy upkeep drain when a unit is reclaimed
      energyIncome += unit.energyUpkeep ?? 0

      if (unit.energyConverterCapacity) removeConverter(unit)

      // Kill the builder instance if the reclaimed unit was itself a builder.
      // Its own active site (if any) becomes orphaned — cleaned up next tick's step 0.
      if ((unit.buildPower ?? 0) > 0) {
        for (const ab of builders) {
          if (ab.id === completedId && !ab.dead) {
            ab.dead = true
            ab.siteId = null  // abandon whatever it was building (orphaned — cleaned next tick)
            break
          }
        }
      }

      // Reverse army tracking for reclaimed army units
      if (unitIndex.armyUnitIds.has(completedId)) {
        currentArmyMetal = Math.max(0, currentArmyMetal - unit.metalCost)
        const dps = unitIndex.unitCombatDps.get(completedId) ?? 0
        currentArmyDps = Math.max(0, currentArmyDps - dps)
        currentArmyHealth = Math.max(0, currentArmyHealth - unit.health)
        if (unitIndex.groundAttackerIds.has(completedId)) {
          currentArmyGroundDps = Math.max(0, currentArmyGroundDps - dps)
        }
      }

      if (isDisplayMode) {
        buildTimeline.push({
          unitId: completedId,
          unitName: unit.name,
          completedAtSeconds: timeNow,
          metalCost: Math.round(metalReturned),
          isReclaim: true,
        })
      }
    } else {
      // ── Build completed ────────────────────────────────────────────────────
      completedUnitIds.push(completedId)
      aliveCount.set(completedId, (aliveCount.get(completedId) ?? 0) + 1)

      // Track current army composition
      if (unitIndex.armyUnitIds.has(completedId)) {
        currentArmyMetal += unit.metalCost
        const dps = unitIndex.unitCombatDps.get(completedId) ?? 0
        currentArmyDps += dps
        currentArmyHealth += unit.health
        if (unitIndex.groundAttackerIds.has(completedId)) {
          currentArmyGroundDps += dps
        }
      }

      metalCap += unit.metalStorage ?? 0
      energyCap += unit.energyStorage ?? 0

      // Track actual income deltas for the build timeline display
      // MEX income scales with tier: T2 MEX has 4× the metalProduction value of T1
      let mxDelta = 0
      if ((unit.metalProduction ?? 0) > 0) {
        const spotRate = metalPerSpot * ((unit.metalProduction ?? BASE_T1_MEX_RATE) / BASE_T1_MEX_RATE)
        if (mexBuilt < maxMetalSpots) { metalIncome += spotRate; mexBuilt++; mxDelta = spotRate }
      }

      let eProd = 0
      if (isGeothermal(unit)) {
        if (geoBuilt < maxGeoSpots) { const g = unit.energyProduction ?? 0; energyIncome += g; geoBuilt++; eProd = g }
      } else if (isWindGenerator(unit)) {
        // energyProduction is 0 in exported JSON; real output = windAvg at average wind speed
        energyIncome += config.windAvg; eProd = config.windAvg
        windGeneratorCount++
      } else if (isTidalGenerator(unit)) {
        // energyProduction is 0 in exported JSON; real output = tidalStrength
        energyIncome += config.tidalStrength; eProd = config.tidalStrength
      } else {
        eProd = unit.energyProduction ?? 0
        energyIncome += eProd
      }
      // Apply energy upkeep drain (per-second cost of running the building)
      energyIncome -= unit.energyUpkeep ?? 0
      const eDelta = eProd - (unit.energyUpkeep ?? 0)

      if (unit.energyConverterCapacity) addConverter(unit)

      if ((unit.buildPower ?? 0) > 0) {
        addBuilder(completedId, unit.buildPower!, isFactoryUnit(unit))
      }

      if (isDisplayMode) {
        buildTimeline.push({
          unitId: completedId,
          unitName: unit.name,
          completedAtSeconds: timeNow,
          metalCost: unit.metalCost,
          isReclaim: false,
          ...(mxDelta !== 0 && { metalDelta: mxDelta }),
          ...(eDelta !== 0 && { energyDelta: eDelta }),
          ...((unit.buildPower ?? 0) > 0 && { buildPowerDelta: unit.buildPower }),
          ...((unit.metalStorage ?? 0) > 0 && { metalStorageDelta: unit.metalStorage }),
          ...((unit.energyStorage ?? 0) > 0 && { energyStorageDelta: unit.energyStorage }),
          ...(unit.energyConverterCapacity && {
            converterCapacity: unit.energyConverterCapacity,
            converterMetalPerSec: +(unit.energyConverterCapacity * (unit.energyConverterEfficiency ?? 0)).toFixed(2),
          }),
        })
      }
    }

    releaseSite(site, false)
    sites.splice(si, 1)
  }

  // ── Main tick loop ────────────────────────────────────────────────────────

  for (let tick = 1; tick <= totalTicks; tick++) {
    const timeNow = tick / tps

    // 0. Clean up orphaned sites (all assigned builders are dead).
    //    For reclaim sites this restores the aliveCount reservation so future
    //    RECLAIM genes can still find the unit.
    for (let si = sites.length - 1; si >= 0; si--) {
      const site = sites[si]
      let hasLive = false
      for (const b of builders) {
        if (!b.dead && b.siteId === site.id) { hasLive = true; break }
      }
      if (!hasLive) {
        releaseSite(site, true)
        sites.splice(si, 1)
      }
    }

    // 1. Accrue income (capped at storage); track overflow waste
    const metalGain = metalIncome / tps
    const energyGain = energyIncome / tps
    totalMetalWasted += Math.max(0, metal + metalGain - metalCap)
    totalEnergyWasted += Math.max(0, energy + energyGain - energyCap)
    metal = Math.min(metal + metalGain, metalCap)
    energy = Math.min(energy + energyGain, energyCap)

    // 2. Assign idle (living) builders
    for (const builder of builders) {
      if (builder.dead || builder.siteId !== null) continue

      let claimed = false

      // 2a. Try to claim the next claimable gene from the shared queue
      for (let qi = 0; qi < queue.length && !claimed; qi++) {
        const gene = queue[qi]

        if (isReclaimGene(gene)) {
          const targetId = getReclaimTargetId(gene)
          const alive = aliveCount.get(targetId) ?? 0
          if (alive === 0) { queue.splice(qi, 1); qi--; continue }
          claimReclaimGene(builder, qi, targetId)
          claimed = true
        } else {
          const caps = builder.caps
          if (!caps || !caps.has(gene)) continue
          const unit = unitIndex.byId.get(gene)
          if (!unit) { queue.splice(qi, 1); qi--; continue }
          // Drop genes that can't be usefully built due to map resource limits.
          // Building beyond the spot limit completes but produces nothing — waste of metal.
          if (isGeothermal(unit) && geoBuilt >= maxGeoSpots) { queue.splice(qi, 1); qi--; continue }
          if ((unit.metalProduction ?? 0) > 0 && mexBuilt >= maxMetalSpots) { queue.splice(qi, 1); qi--; continue }
          claimBuildGene(builder, qi)
          claimed = true
        }
      }

      // 2b. If idle and not a factory, assist the oldest active site.
      //     Constructors (and the commander) can assist any site — factory queues
      //     included (nano-ing a lab speeds up its current unit, matching real BAR).
      //     Factory builders never assist; they only build their own internal queue.
      if (!claimed && !builder.isFactory && sites.length > 0) {
        let oldest: ConstructionSite | null = null
        for (const s of sites) {
          if (oldest === null || s.id < oldest.id) oldest = s
        }
        if (oldest !== null) builder.siteId = oldest.id
      }
    }

    // 3. Per-site BP totals and global resource demands
    //    Build a siteId → index map for O(1) lookup.
    const siteIdx = new Map<number, number>()
    for (let i = 0; i < sites.length; i++) siteIdx.set(sites[i].id, i)

    const siteBPs = new Float64Array(sites.length)
    for (const b of builders) {
      if (b.dead || b.siteId === null) continue
      const i = siteIdx.get(b.siteId)
      if (i === undefined) { b.siteId = null; continue }   // stale ref (site removed)
      siteBPs[i] += b.buildPowerPerTick
    }

    let totalMetalDemand = 0
    let totalEnergyDemand = 0
    for (let i = 0; i < sites.length; i++) {
      if (sites[i].isReclaimSite || siteBPs[i] === 0) continue
      const s = sites[i]
      totalMetalDemand += s.targetUnit.metalCost * siteBPs[i] / s.buildTime
      totalEnergyDemand += s.targetUnit.energyCost * siteBPs[i] / s.buildTime
    }

    // 4. Resource ratio — all build sites slow equally when resources are scarce.
    //    Reclaim sites always run at full speed (no resource cost).
    const metalRatio = totalMetalDemand > 0 ? Math.min(metal / totalMetalDemand, 1.0) : 1.0
    const energyRatio = totalEnergyDemand > 0 ? Math.min(energy / totalEnergyDemand, 1.0) : 1.0
    const resourceRatio = metalRatio < energyRatio ? metalRatio : energyRatio

    // 4b. Track build power waste: BP assigned to build sites but unused due to resource stall
    {
      let buildSiteBP = 0
      for (let i = 0; i < sites.length; i++) {
        if (!sites[i].isReclaimSite) buildSiteBP += siteBPs[i]
      }
      buildPowerPotential += buildSiteBP
      buildPowerWasted += buildSiteBP * (1 - resourceRatio)
    }

    // 5. Apply progress to all active sites (iterate backwards for safe removal)
    for (let si = sites.length - 1; si >= 0; si--) {
      const site = sites[si]
      const bp = siteBPs[si]
      if (bp === 0) continue   // orphaned site (will be removed next tick's step 0)

      if (site.isReclaimSite) {
        // Reclaim progresses at full rate — no resource cost
        site.progress += bp
      } else {
        // Build site: scale progress and resource spend by resourceRatio
        const metalUsed = site.targetUnit.metalCost * bp / site.buildTime * resourceRatio
        const energyUsed = site.targetUnit.energyCost * bp / site.buildTime * resourceRatio
        site.progress += bp * resourceRatio
        metal -= metalUsed
        if (metal < 0) metal = 0
        energy -= energyUsed
        if (energy < 0) energy = 0
        totalMetalSpent += metalUsed
        totalEnergySpent += energyUsed
        if (unitIndex.armyUnitIds.has(site.targetUnitId)) armyMetalSpent += metalUsed  // cumulative (for charts)
      }

      if (site.progress >= site.buildTime) {
        completeSite(si, timeNow)
      }
    }

    // 6. Energy-to-metal conversion (metal makers / converters).
    //    Run after build spending so converters only use genuine surplus.
    //    Mirrors BAR gadget: convertAmount = eCur - eStor * mmLevel (mmLevel = 0.75).
    //    Converters are applied highest-efficiency first (matching eSteps sort).
    if (activeConverters.length > 0) {
      let surplus = energy - energyCap * CONVERTER_MM_LEVEL
      if (surplus > 0) {
        for (const conv of activeConverters) {
          if (surplus <= 0) break
          const consumed = surplus < conv.capacityPerTick ? surplus : conv.capacityPerTick
          energy -= consumed
          const produced = consumed * conv.efficiency
          metal += produced
          if (metal > metalCap) metal = metalCap
          totalConverterMetalOutput += produced
          surplus -= consumed
        }
      }
    }

    // 7. Record snapshots when we pass a checkpoint time
    while (
      snapshotPointer < snapshotTimes.length &&
      timeNow >= snapshotTimes[snapshotPointer]
    ) {
      const t = snapshotTimes[snapshotPointer]
      const totalBP = builders.reduce((s, b) => s + (b.dead ? 0 : b.buildPower), 0)

      const aliveSnap: Record<string, number> = {}
      for (const [k, v] of aliveCount) { if (v > 0) aliveSnap[k] = v }

      snapshots.push({
        timeSeconds: t,
        metalIncome,
        energyIncome,
        totalMetalSpent,
        totalEnergySpent,
        armyMetalSpent,
        currentArmyMetal,
        currentArmyDps,
        currentArmyHealth,
        currentArmyGroundDps,
        completedCount: completedUnitIds.length,
        aliveUnitCounts: aliveSnap,
        currentMetal: metal,
        currentEnergy: energy,
        metalCap,
        energyCap,
        totalMetalWasted,
        totalEnergyWasted,
        buildPowerPotential,
        buildPowerWasted,
        totalBuildPower: totalBP,
        windGeneratorCount,
        totalConverterMetalOutput,
      })

      if (isDisplayMode) {
        builderTimeline.push({
          timeSeconds: t,
          builders: builders
            .filter((b) => !b.dead)
            .map((b): BuilderTimelineEntry => {
              const site = b.siteId !== null ? sites.find((s) => s.id === b.siteId) ?? null : null
              const pf = site && site.buildTime > 0 ? site.progress / site.buildTime : 0
              const myMetalRate = site && !site.isReclaimSite
                ? b.buildPower * site.targetUnit.metalCost / site.buildTime
                : 0
              const myEnergyRate = site && !site.isReclaimSite
                ? b.buildPower * site.targetUnit.energyCost / site.buildTime
                : 0
              // BP utilization: reclaim always 1.0, active build sites scale by resourceRatio, idle = 0
              const util = site === null ? 0 : site.isReclaimSite ? 1.0 : resourceRatio
              return {
                builderId: b.id,
                builderName: unitIndex.byId.get(b.id)?.name ?? b.id,
                taskUnitId: site
                  ? (site.isReclaimSite ? makeReclaimGene(site.targetUnitId) : site.targetUnitId)
                  : null,
                taskUnitName: site
                  ? (site.isReclaimSite ? `↩ ${site.targetUnit.name}` : site.targetUnit.name)
                  : null,
                progressFraction: Math.min(pf, 1),
                metalDemandRate: myMetalRate,
                energyDemandRate: myEnergyRate,
                bpUtilization: util,
              }
            }),
        })
      }

      snapshotPointer++
    }

    if (snapshotPointer >= snapshotTimes.length) break
  }

  // Fill any remaining snapshots that were never reached
  while (snapshotPointer < snapshotTimes.length) {
    const t = snapshotTimes[snapshotPointer]
    const totalBP = builders.reduce((s, b) => s + (b.dead ? 0 : b.buildPower), 0)
    const aliveSnapF: Record<string, number> = {}
    for (const [k, v] of aliveCount) { if (v > 0) aliveSnapF[k] = v }

    snapshots.push({
      timeSeconds: t,
      metalIncome,
      energyIncome,
      totalMetalSpent,
      totalEnergySpent,
      armyMetalSpent,
      currentArmyMetal,
      currentArmyDps,
      currentArmyHealth,
      currentArmyGroundDps,
      completedCount: completedUnitIds.length,
      aliveUnitCounts: aliveSnapF,
      currentMetal: metal,
      currentEnergy: energy,
      metalCap,
      energyCap,
      totalMetalWasted,
      totalEnergyWasted,
      buildPowerPotential,
      buildPowerWasted,
      totalBuildPower: totalBP,
      windGeneratorCount,
      totalConverterMetalOutput,
    })
    if (isDisplayMode) {
      builderTimeline.push({
        timeSeconds: t,
        builders: builders
          .filter((b) => !b.dead)
          .map((b): BuilderTimelineEntry => {
            const site = b.siteId !== null ? sites.find((s) => s.id === b.siteId) ?? null : null
            return {
              builderId: b.id,
              builderName: unitIndex.byId.get(b.id)?.name ?? b.id,
              taskUnitId: site
                ? (site.isReclaimSite ? makeReclaimGene(site.targetUnitId) : site.targetUnitId)
                : null,
              taskUnitName: site
                ? (site.isReclaimSite ? `↩ ${site.targetUnit.name}` : site.targetUnit.name)
                : null,
              progressFraction: site && site.buildTime > 0 ? Math.min(site.progress / site.buildTime, 1) : 0,
              metalDemandRate: 0,
              energyDemandRate: 0,
              bpUtilization: 0,
            }
          }),
      })
    }
    snapshotPointer++
  }

  return { snapshots, completedUnitIds: [...completedUnitIds], buildTimeline, builderTimeline, isValid: true }
}

export function getDefaultSimConfig(): SimConfig {
  return {
    startingMetal: 1000,
    startingEnergy: 1000,
    startingMetalStorage: 1000,
    startingEnergyStorage: 1000,
    commanderBuildpower: 300,
    commanderMetalIncome: 2,
    commanderEnergyIncome: 30,
    commanderUnitId: 'armcom',
    windAvg: 12.5,
    windMin: 5,
    windMax: 25,
    tidalStrength: 25,
    maxMetalSpots: 5,
    metalPerSpot: 1.8,
    maxGeoSpots: 1,
    durationSeconds: 720,
    ticksPerSecond: 10,
    snapshotTimes: [60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660, 720],
  }
}

/** High-fidelity config for final display render: 30 tps + snapshot every 1 s. */
export function getFullFidelitySimConfig(base: SimConfig): SimConfig {
  const dense: number[] = []
  for (let t = 1; t <= base.durationSeconds; t++) {
    dense.push(t)
  }
  return { ...base, ticksPerSecond: 30, snapshotTimes: dense }
}
