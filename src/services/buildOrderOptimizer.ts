import type {
  Unit,
  OptimizerConfig,
  OptimizerCheckpoint,
  FitnessWeights,
  FitnessBreakdown,
  CumulativeFitnessPoint,
  PopulationStats,
  SimResult,
  SimSnapshot,
  Chromosome,
  WorkerResultMessage,
  WorkerProgressMessage,
} from '../types'
import { defaultFitnessWeights } from '../types'
import {
  buildUnitIndex,
  buildBuilderCapabilities,
  simulateBuildOrder,
  getFullFidelitySimConfig,
  isReclaimGene,
  getReclaimTargetId,
  makeReclaimGene,
  type UnitIndex,
  type BuilderCapabilities,
} from './economySimulator'
import { isTech15ByName, isStealthOrOverchargedMex, isTech2, isTech3, isUnitExcluded, matchesUnitCategory } from './unitCategories'

// ── Prerequisite Map ──────────────────────────────────────────────────────────

/**
 * Exact commander buildOptions sourced directly from BAR game Lua files:
 *   units/armcom.lua, units/corcom.lua, units/Legion/legcom.lua
 *
 * Any unit NOT in these sets requires a T1 constructor to be built first.
 * This is the ground truth that prevents the optimizer placing units like
 * armamex (Twilight), armalab, etc. before the commander has built a
 * T1 constructor.
 */
const COMMANDER_BUILD_OPTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  armcom: new Set([
    'armsolar', 'armwin', 'armmstor', 'armestor', 'armmex', 'armmakr',
    'armlab', 'armvp', 'armap', 'armeyes', 'armrad', 'armdrag', 'armllt',
    'armrl', 'armdl', 'armtide', 'armuwms', 'armuwes', 'armfmkr', 'armsy',
    'armfdrag', 'armtl', 'armfrt', 'armfrad', 'armhp', 'armfhp',
  ]),
  corcom: new Set([
    'corsolar', 'corwin', 'cormstor', 'corestor', 'cormex', 'cormakr',
    'corlab', 'corvp', 'corap', 'coreyes', 'corrad', 'cordrag', 'corllt',
    'corrl', 'cordl', 'cortide', 'coruwms', 'coruwes', 'corfmkr', 'corsy',
    'corfdrag', 'cortl', 'corfrt', 'corfrad', 'corhp', 'corfhp',
  ]),
  legcom: new Set([
    'legsolar', 'legwin', 'legmstor', 'legestor', 'legmex', 'legeconv',
    'leglab', 'legvp', 'legap', 'legeyes', 'legrad', 'legdrag', 'leglht',
    'legrl', 'legctl', 'legtide', 'leguwmstore', 'leguwestore', 'legfeconv',
    'legsy', 'legfdrag', 'legtl', 'legfrl', 'legfrad', 'leghp', 'legfhp',
  ]),
}
// Legion commander variants share the same build list as legcom
for (const lvl of ['legcomlvl2','legcomlvl3','legcomlvl4','legcomlvl5','legcomlvl6',
                   'legcomlvl7','legcomlvl8','legcomlvl9','legcomlvl10',
                   'legcomecon','legcomoff','legcomt2com','legdecom',
                   'legcomt2def','legcomt2off']) {
  ;(COMMANDER_BUILD_OPTIONS as Record<string, ReadonlySet<string>>)[lvl] =
    COMMANDER_BUILD_OPTIONS.legcom
}

/**
 * Classify a unit into one of three build levels:
 *
 *   0 – Commander can build directly (exact list when known; tier heuristic otherwise)
 *   1 – Requires a T1 constructor first (Advanced T1 bldgs, stealth MEX, T2 units)
 *   2 – Requires a T2 constructor first (Experimental bldgs, T3 units)
 */
function getUnitBuildLevel(unit: Unit, startingBuilderIds: string[]): 0 | 1 | 2 {
  if (isTech3(unit)) return 2
  // For known commander IDs use the exact game-source build list
  for (const id of startingBuilderIds) {
    const knownList = COMMANDER_BUILD_OPTIONS[id]
    if (knownList) {
      return knownList.has(unit.id) ? 0 : isTech3(unit) ? 2 : 1
    }
  }
  // Tier heuristic fallback (Legion commander variants + custom IDs)
  if (isTech2(unit) || isTech15ByName(unit) || isStealthOrOverchargedMex(unit)) return 1
  return 0
}

/**
 * Maps unitId → list of builder unitIds that can construct it.
 *
 * If no unit has a canBuild array (common when data is exported without it),
 * falls back to a 3-level hierarchy based on the actual BAR build-chain rules:
 *   Level 0 – buildable by startingBuilderIds (commander)
 *   Level 1 – buildable by any T1 unit with buildPower
 *   Level 2 – buildable by any T2 unit with buildPower
 */
export function buildPrerequisiteMap(
  units: Unit[],
  startingBuilderIds: string[],
): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const unit of units) map.set(unit.id, [])

  let hasAnyCanBuild = false
  for (const unit of units) {
    if (!unit.canBuild || unit.canBuild.length === 0) continue
    hasAnyCanBuild = true
    for (const buildableId of unit.canBuild) {
      if (!map.has(buildableId)) map.set(buildableId, [])
      map.get(buildableId)!.push(unit.id)
    }
  }

  if (!hasAnyCanBuild) {
    const t1Builders = units
      .filter((u) => u.tier === 'T1' && (u.buildPower ?? 0) > 0 && u.unitType !== 'Commander')
      .map((u) => u.id)
    const t2Builders = units
      .filter((u) => u.tier === 'T2' && (u.buildPower ?? 0) > 0)
      .map((u) => u.id)

    for (const unit of units) {
      const entry = map.get(unit.id)!
      const level = getUnitBuildLevel(unit, startingBuilderIds)
      if (level === 0) {
        for (const b of startingBuilderIds) {
          if (!entry.includes(b)) entry.push(b)
        }
      } else if (level === 1) {
        for (const b of t1Builders) {
          if (!entry.includes(b)) entry.push(b)
        }
      } else {
        for (const b of t2Builders) {
          if (!entry.includes(b)) entry.push(b)
        }
      }
    }
  }

  return map
}

// ── Prerequisite chain tracer ──────────────────────────────────────────────────

/**
 * Returns the shortest gene sequence needed to unlock `targetId` starting from
 * the commander (startingBuilderIds).  The chain includes every intermediate
 * prerequisite unit that must exist in the chromosome for repair to keep targetId.
 *
 * Uses BFS over the inverse builderMap so it finds the fewest-gene path.
 * Result is in build-order (earliest prerequisite first, target last).
 * If targetId is directly buildable by a starting builder, returns [targetId].
 */
export function getPrerequisiteChain(
  targetId: string,
  builderMap: Map<string, string[]>,
  startingBuilderIds: string[],
): string[] {
  const startSet = new Set(startingBuilderIds)

  // BFS: each node is a unitId; edges follow "needs builder X → X" direction.
  // We search backwards: target → builders of target → builders of those, etc.
  // Then reverse to get the forward build order.
  type Node = { id: string; path: string[] }
  const visited = new Set<string>()
  const queue: Node[] = [{ id: targetId, path: [targetId] }]

  while (queue.length > 0) {
    const { id, path } = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)

    const builders = builderMap.get(id) ?? []

    // If any starting builder can build this, we've found the shortest path
    if (builders.some((b) => startSet.has(b))) {
      return [...path].reverse() // path was built back-to-front
    }

    // Otherwise expand: for each builder of this unit, recurse
    for (const builderId of builders) {
      if (!visited.has(builderId)) {
        queue.push({ id: builderId, path: [...path, builderId] })
      }
    }
  }

  // Fallback: just include the target (repair will drop it if truly unreachable)
  return [targetId]
}

/**
 * Collect goal unit IDs from ALL checkpoint types.
 *
 * - 'building' / 'unit' / 'unitCount': use the checkpoint's explicit unit ID.
 * - 'unitCategory': pick the highest-tier, highest-cost representative unit
 *   from `factionUnits` that matches the category.  This lets the goal-directed
 *   seeding, niche protection, guided mutation, and stagnation injection all
 *   work for category checkpoints (e.g. "build any T3 factory") — previously
 *   these mechanisms were completely blind to category goals.
 */
function resolveGoalUnitIds(
  checkpoints: readonly OptimizerCheckpoint[],
  factionUnits: Unit[],
): string[] {
  const TIER_RANK: Record<string, number> = { T3: 3, T2: 2, T1: 1 }
  const ids: string[] = []
  for (const cp of checkpoints) {
    if (cp.type === 'building' || cp.type === 'unit' || cp.type === 'unitCount') {
      ids.push((cp as { unitId: string }).unitId)
    } else if (cp.type === 'unitCategory') {
      const candidates = factionUnits.filter((u) => matchesUnitCategory(u, cp.categoryId))
      if (candidates.length > 0) {
        // Pick the most complex goal: highest tier, then highest metal cost
        candidates.sort(
          (a, b) =>
            (TIER_RANK[b.tier] ?? 0) - (TIER_RANK[a.tier] ?? 0) ||
            b.metalCost - a.metalCost,
        )
        ids.push(candidates[0].id)
      }
    }
  }
  return [...new Set(ids)]
}

/**
 * Generate a seed chromosome that routes through the prerequisite chain of
 * `goalUnitId`, then fills the remainder with eco units.
 *
 * This is used both for initial-population seeding and for guided re-injection
 * during stagnation.
 */
function generateGoalSeed(
  goalUnitId: string,
  factionUnits: Unit[],
  builderMap: Map<string, string[]>,
  startingBuilderIds: string[],
  unitIndex: UnitIndex,
  maxLength: number,
): string[] {
  const chain = getPrerequisiteChain(goalUnitId, builderMap, startingBuilderIds)

  // Start with the chain, then fill with eco units using the same seeded-available logic
  const genes: string[] = [...chain]
  const available = new Set(startingBuilderIds)
  for (const id of chain) {
    const u = unitIndex.byId.get(id)
    if (u && (u.buildPower ?? 0) > 0) available.add(id)
  }

  const t1MexNet = new Map<string, number>()

  while (genes.length < maxLength) {
    const buildable = factionUnits.filter((u) => {
      const builders = builderMap.get(u.id)
      return builders ? builders.some((b) => available.has(b)) : false
    })
    if (buildable.length === 0) break

    // Occasionally inject a T2 MEX upgrade if we have surplus T1 MEX
    if (genes.length + 1 < maxLength && Math.random() < 0.25) {
      const reclaimable: string[] = []
      for (const [id, cnt] of t1MexNet) for (let k = 0; k < cnt; k++) reclaimable.push(id)
      const t2mexes = buildable.filter((u) => (u.metalProduction ?? 0) > 0 && u.tier === 'T2')
      if (reclaimable.length > 0 && t2mexes.length > 0) {
        const targetId = reclaimable[Math.floor(Math.random() * reclaimable.length)]
        const t2mex = t2mexes[Math.floor(Math.random() * t2mexes.length)]
        genes.push(makeReclaimGene(targetId), t2mex.id)
        t1MexNet.set(targetId, (t1MexNet.get(targetId) ?? 1) - 1)
        continue
      }
    }

    const eco = buildable.filter(
      (u) => (u.metalProduction ?? 0) > 0 || (u.energyProduction ?? 0) > 0,
    )
    const pool = eco.length > 0 && Math.random() < 0.65 ? eco : buildable
    const chosen = pool[Math.floor(Math.random() * pool.length)]
    genes.push(chosen.id)
    if ((chosen.metalProduction ?? 0) > 0 && chosen.tier === 'T1') {
      t1MexNet.set(chosen.id, (t1MexNet.get(chosen.id) ?? 0) + 1)
    }
    if ((chosen.buildPower ?? 0) > 0) available.add(chosen.id)
  }

  return genes
}

// ── Repair ─────────────────────────────────────────────────────────────────────

/**
 * Reorder/drop genes so the build order satisfies prerequisites.
 * Handles both plain build genes and RECLAIM:X genes.
 *
 * Rules:
 *   Build gene X  – valid when at least one of X's builder prerequisites is in `available`.
 *   RECLAIM:X gene – valid when X has been built more times than it has been reclaimed
 *                    in the repaired prefix so far.
 *
 * After processing:
 *   - A build gene for a unit with buildPower adds that unit to `available`.
 *   - A RECLAIM gene does NOT remove the unit from `available` (repair is conservative;
 *     the sim handles the actual builder-death effect at runtime).
 */
export function repairChromosome(
  genes: string[],
  builderMap: Map<string, string[]>,
  startingBuilderIds: string[],
  unitIndex: UnitIndex,
): string[] {
  // Fast path: check if genes are already in valid order (common for elites and light mutations).
  // This makes the common case O(n) instead of O(n²) from the deferred-queue logic.
  let valid = true
  {
    const fastAvail = new Set(startingBuilderIds)
    const fastBuilt = new Map<string, number>()
    const fastReclaimed = new Map<string, number>()
    for (const gene of genes) {
      if (isReclaimGene(gene)) {
        const targetId = getReclaimTargetId(gene)
        if ((fastBuilt.get(targetId) ?? 0) <= (fastReclaimed.get(targetId) ?? 0)) {
          valid = false
          break
        }
        fastReclaimed.set(targetId, (fastReclaimed.get(targetId) ?? 0) + 1)
      } else {
        const builders = builderMap.get(gene)
        if (!builders || !builders.some(b => fastAvail.has(b))) {
          valid = false
          break
        }
        fastBuilt.set(gene, (fastBuilt.get(gene) ?? 0) + 1)
        const unit = unitIndex.byId.get(gene)
        if (unit && (unit.buildPower ?? 0) > 0) fastAvail.add(gene)
      }
    }
  }
  if (valid) return [...genes]  // already valid, skip expensive repair

  // Fall through to existing deferred-queue logic
  const available = new Set<string>(startingBuilderIds)
  // Track net alive count for RECLAIM validation
  const builtCount = new Map<string, number>()
  const reclaimedCount = new Map<string, number>()
  const deferred = [...genes]
  const repaired: string[] = []

  while (deferred.length > 0) {
    const idx = deferred.findIndex((gene) => {
      if (isReclaimGene(gene)) {
        const targetId = getReclaimTargetId(gene)
        return (builtCount.get(targetId) ?? 0) > (reclaimedCount.get(targetId) ?? 0)
      }
      const builders = builderMap.get(gene)
      return builders ? builders.some((b) => available.has(b)) : false
    })
    if (idx === -1) break   // remaining genes irrecoverable — drop them
    const [gene] = deferred.splice(idx, 1)
    repaired.push(gene)

    if (isReclaimGene(gene)) {
      const targetId = getReclaimTargetId(gene)
      reclaimedCount.set(targetId, (reclaimedCount.get(targetId) ?? 0) + 1)
    } else {
      builtCount.set(gene, (builtCount.get(gene) ?? 0) + 1)
      const unit = unitIndex.byId.get(gene)
      if (unit && (unit.buildPower ?? 0) > 0) {
        available.add(gene)
      }
    }
  }
  return repaired
}

// ── Fitness helpers ────────────────────────────────────────────────────────────

/**
 * Compute achievement ratio (0..fw.continuousOvercap) for a single checkpoint.
 * Used by evaluateFitness, computeFitnessBreakdown and computeCumulativeFitness.
 */
/**
 * @param completedSet  Set built from snapshot.completedUnitIds — O(1) lookup vs O(n) Array.includes
 * @param genesSet      Set built from the chromosome's genes array — O(1) partial-credit lookup
 */
function cpAchievement(
  cp: OptimizerCheckpoint,
  snapshot: SimSnapshot,
  completedSet: Set<string>,
  genesSet: Set<string>,
  fw: FitnessWeights,
  getUnit: (id: string) => Unit | undefined,
): number {
  switch (cp.type) {
    case 'metalIncome':
      return Math.min(snapshot.metalIncome / cp.targetValue, fw.continuousOvercap)
    case 'energyIncome':
      return Math.min(snapshot.energyIncome / cp.targetValue, fw.continuousOvercap)
    case 'armyMetal':
      // Use currentArmyMetal (living army value) — not cumulative armyMetalSpent,
      // which was exploitable via build→reclaim→rebuild inflation.
      return Math.min(snapshot.currentArmyMetal / cp.targetValue, fw.continuousOvercap)
    case 'armyDps':
      return cp.targetValue > 0
        ? Math.min(snapshot.currentArmyDps / cp.targetValue, fw.continuousOvercap)
        : 0
    case 'armyHealth':
      return cp.targetValue > 0
        ? Math.min(snapshot.currentArmyHealth / cp.targetValue, fw.continuousOvercap)
        : 0
    case 'armyComposition': {
      if (snapshot.currentArmyDps <= 0) return 0
      const roleDps = cp.role === 'ground'
        ? snapshot.currentArmyGroundDps
        : snapshot.currentArmyDps - snapshot.currentArmyGroundDps  // 'air'
      const fraction = roleDps / snapshot.currentArmyDps
      return cp.minFraction > 0
        ? Math.min(fraction / cp.minFraction, fw.continuousOvercap)
        : fw.continuousOvercap
    }
    case 'building':
    case 'unit':
      if (completedSet.has(cp.unitId)) return 1.0
      if (genesSet.has(cp.unitId))     return fw.binaryPartialCredit
      return 0.0
    case 'unitCount': {
      // Use aliveUnitCounts (current alive) — not completedUnitIds which overcounts reclaimed units.
      const alive = snapshot.aliveUnitCounts[cp.unitId] ?? 0
      return Math.min(alive / cp.targetCount, fw.continuousOvercap)
    }
    case 'buildPower':
      return Math.min(snapshot.totalBuildPower / cp.targetValue, fw.continuousOvercap)
    case 'unitCategory': {
      // Check if any matching unit is completed at this snapshot time.
      let catDone = false
      completedSet.forEach((id) => {
        if (catDone) return
        const u = getUnit(id)
        if (u && matchesUnitCategory(u, cp.categoryId)) catDone = true
      })
      if (catDone) return 1.0
      // Partial credit: reward chromosomes that at least include a matching unit
      // in the build order (even if not yet complete). Without this there is zero
      // fitness gradient pointing toward T3 factories and the GA can never find them.
      let catInGenes = false
      genesSet.forEach((id) => {
        if (catInGenes) return
        const u = getUnit(id)
        if (u && matchesUnitCategory(u, cp.categoryId)) catInGenes = true
      })
      return catInGenes ? fw.binaryPartialCredit : 0.0
    }
  }
}

/**
 * Compute the sanity-adjustment portion of the score from a single snapshot + cumulative data.
 *
 * @param avgMetalIncome  Average metalIncome across all snapshots up to this point.
 *   Using the average (not final) rewards builds that ramp income early: a build reaching
 *   10 M/s at minute 3 gets a higher average than one reaching 10 M/s at minute 12.
 */
function sanitySingle(
  snap: SimSnapshot,
  avgBankRatio: number,   // running average bank ratio up to and including this snapshot
  avgEnergyFill: number,  // running average currentEnergy/energyCap up to this snapshot
  avgMetalIncome: number, // running average metalIncome up to this snapshot
  fw: FitnessWeights,
  windAvg = 0,
  windMin = 0,
): number {
  let s = 0

  // 1. Eco bonus — uses average income so early ramp-up is rewarded over late ramp-up
  s += avgMetalIncome * fw.ecoBonus
  // 2. Throughput bonus
  s += snap.totalMetalSpent * fw.throughputBonus
  // 3. Banking penalty
  if (fw.bankingThreshold < 1 && avgBankRatio > fw.bankingThreshold) {
    const over = (avgBankRatio - fw.bankingThreshold) / (1 - fw.bankingThreshold)
    s -= Math.min(over * fw.bankingPenaltyMax, fw.bankingPenaltyMax)
  }
  // 4. Energy coverage bonus — gradient based on instantaneous coverage × avg fill.
  //    Multiplying by avgEnergyFill means a build that chronically runs near-empty
  //    receives less bonus than one that maintained comfortable energy reserves,
  //    even if both end the run with the same final income-to-BP ratio.
  if (snap.totalBuildPower > 0 && fw.energyCoverageThreshold > 0) {
    const ratio = snap.energyIncome / (snap.totalBuildPower * fw.energyCoverageThreshold)
    const fillFactor = Math.min(avgEnergyFill / 0.25, 1)   // full weight once avg fill ≥ 25 %
    s += Math.min(ratio, 1) * fw.energyCoverageBonus * (0.5 + 0.5 * fillFactor)
  }
  // 5. Metal waste penalty
  const mDenom = snap.totalMetalSpent + snap.totalMetalWasted
  if (mDenom > 0 && snap.totalMetalWasted > 0) {
    s -= Math.min((snap.totalMetalWasted / mDenom) * fw.metalWasteMultiplier, fw.metalWasteMax)
  }
  // 6. Energy waste penalty
  const eDenom = snap.totalEnergySpent + snap.totalEnergyWasted
  if (eDenom > 0 && snap.totalEnergyWasted > 0) {
    s -= Math.min((snap.totalEnergyWasted / eDenom) * fw.energyWasteMultiplier, fw.energyWasteMax)
  }
  // 7. BP stall penalty
  if (snap.buildPowerPotential > 0) {
    s -= Math.min((snap.buildPowerWasted / snap.buildPowerPotential) * fw.stallMultiplier, fw.stallMax)
  }
  // 8. Wind storage penalty — too many wind generators without enough energy buffer
  const windVariation = windAvg - windMin
  if (snap.windGeneratorCount > 0 && windVariation > 0 && fw.windBufferTime > 0) {
    const requiredStorage = snap.windGeneratorCount * windVariation * fw.windBufferTime
    if (snap.energyCap < requiredStorage) {
      const deficit = (requiredStorage - snap.energyCap) / requiredStorage
      s -= Math.min(deficit * fw.windStoragePenaltyMax, fw.windStoragePenaltyMax)
    }
  }
  // 9. Energy deficit penalty — chronic low energy fill means chronic energy starvation
  //    avgEnergyFill near 0 → energy perpetually empty → big penalty
  if (fw.energyDeficitThreshold > 0 && avgEnergyFill < fw.energyDeficitThreshold) {
    const severity = (fw.energyDeficitThreshold - avgEnergyFill) / fw.energyDeficitThreshold
    s -= Math.min(severity * fw.energyDeficitPenaltyMax, fw.energyDeficitPenaltyMax)
  }
  return s
}

/**
 * Full breakdown of a fitness score for visualization.
 * Uses the high-fidelity display sim result (1s snapshots).
 */
export function computeFitnessBreakdown(
  result: SimResult,
  genes: string[],
  checkpoints: OptimizerCheckpoint[],
  fw: FitnessWeights,
  getUnit: (id: string) => Unit | undefined,
  windAvg = 0,
  windMin = 0,
): FitnessBreakdown {
  // --- Goal scores ---
  const checkpointAchievements: number[] = []
  const checkpointScores: number[] = []
  let totalGoalScore = 0

  // Shared completedSet cache keyed on completedCount — no per-snapshot array copies
  const genesSetBD = new Set(genes)
  const completedSetCacheBD = new Map<number, Set<string>>()
  const getCompletedSetBD = (count: number): Set<string> => {
    let s = completedSetCacheBD.get(count)
    if (!s) {
      s = new Set<string>()
      for (let i = 0; i < count; i++) s.add(result.completedUnitIds[i])
      completedSetCacheBD.set(count, s)
    }
    return s
  }

  for (const cp of checkpoints) {
    const snap = result.snapshots.find((s) => s.timeSeconds >= cp.targetTime)
    if (!snap) {
      checkpointAchievements.push(0)
      checkpointScores.push(0)
      continue
    }
    const ach = cpAchievement(cp, snap, getCompletedSetBD(snap.completedCount), genesSetBD, fw, getUnit)
    const sc = ach * cp.weight
    checkpointAchievements.push(ach)
    checkpointScores.push(sc)
    totalGoalScore += sc
  }

  // --- Sanity terms (full-run averages + final snapshot) ---
  const last = result.snapshots[result.snapshots.length - 1]

  // ecoBonus uses average metalIncome (same as evaluateFitness) so the breakdown
  // value matches the actual GA score and rewards builds that ramp income early.
  let avgMetalIncomeBD = 0
  if (result.snapshots.length > 0) {
    avgMetalIncomeBD = result.snapshots.reduce((s, sn) => s + sn.metalIncome, 0) / result.snapshots.length
  }
  const ecoBonus = avgMetalIncomeBD * fw.ecoBonus
  const throughputBonus = last ? last.totalMetalSpent * fw.throughputBonus : 0

  let bankingPenalty = 0
  if (result.snapshots.length > 0) {
    let sumBank = 0, count = 0
    for (const s of result.snapshots) {
      if (s.metalCap > 0) { sumBank += s.currentMetal / s.metalCap; count++ }
    }
    const avg = count > 0 ? sumBank / count : 0
    if (fw.bankingThreshold < 1 && avg > fw.bankingThreshold) {
      const over = (avg - fw.bankingThreshold) / (1 - fw.bankingThreshold)
      bankingPenalty = -Math.min(over * fw.bankingPenaltyMax, fw.bankingPenaltyMax)
    }
  }

  let energyCoverageBonus = 0
  if (last && last.totalBuildPower > 0 && fw.energyCoverageThreshold > 0) {
    let sumFillE = 0, countFillE = 0
    for (const s of result.snapshots) {
      if (s.energyCap > 0) { sumFillE += s.currentEnergy / s.energyCap; countFillE++ }
    }
    const avgFillForCoverage = countFillE > 0 ? sumFillE / countFillE : 0
    const ratio = last.energyIncome / (last.totalBuildPower * fw.energyCoverageThreshold)
    const fillFactor = Math.min(avgFillForCoverage / 0.25, 1)
    energyCoverageBonus = Math.min(ratio, 1) * fw.energyCoverageBonus * (0.5 + 0.5 * fillFactor)
  }

  let energyDeficitPenalty = 0
  if (result.snapshots.length > 0) {
    let sumFill = 0, countFill = 0
    for (const s of result.snapshots) {
      if (s.energyCap > 0) { sumFill += s.currentEnergy / s.energyCap; countFill++ }
    }
    const avgEnergyFill = countFill > 0 ? sumFill / countFill : 0
    if (fw.energyDeficitThreshold > 0 && avgEnergyFill < fw.energyDeficitThreshold) {
      const severity = (fw.energyDeficitThreshold - avgEnergyFill) / fw.energyDeficitThreshold
      energyDeficitPenalty = -Math.min(severity * fw.energyDeficitPenaltyMax, fw.energyDeficitPenaltyMax)
    }
  }

  let metalWastePenalty = 0
  if (last) {
    const d = last.totalMetalSpent + last.totalMetalWasted
    if (d > 0 && last.totalMetalWasted > 0) {
      metalWastePenalty = -Math.min((last.totalMetalWasted / d) * fw.metalWasteMultiplier, fw.metalWasteMax)
    }
  }

  let energyWastePenalty = 0
  if (last) {
    const d = last.totalEnergySpent + last.totalEnergyWasted
    if (d > 0 && last.totalEnergyWasted > 0) {
      energyWastePenalty = -Math.min((last.totalEnergyWasted / d) * fw.energyWasteMultiplier, fw.energyWasteMax)
    }
  }

  let stallPenalty = 0
  if (last && last.buildPowerPotential > 0) {
    stallPenalty = -Math.min((last.buildPowerWasted / last.buildPowerPotential) * fw.stallMultiplier, fw.stallMax)
  }

  let windStoragePenalty = 0
  if (last) {
    const windVariation = windAvg - windMin
    if (last.windGeneratorCount > 0 && windVariation > 0 && fw.windBufferTime > 0) {
      const requiredStorage = last.windGeneratorCount * windVariation * fw.windBufferTime
      if (last.energyCap < requiredStorage) {
        const deficit = (requiredStorage - last.energyCap) / requiredStorage
        windStoragePenalty = -Math.min(deficit * fw.windStoragePenaltyMax, fw.windStoragePenaltyMax)
      }
    }
  }

  const totalSanityScore = ecoBonus + throughputBonus + bankingPenalty + energyCoverageBonus
    + metalWastePenalty + energyWastePenalty + stallPenalty + windStoragePenalty + energyDeficitPenalty

  return {
    checkpointAchievements,
    checkpointScores,
    totalGoalScore,
    ecoBonus,
    throughputBonus,
    bankingPenalty,
    energyCoverageBonus,
    metalWastePenalty,
    energyWastePenalty,
    stallPenalty,
    windStoragePenalty,
    energyDeficitPenalty,
    totalSanityScore,
    totalScore: totalGoalScore + totalSanityScore,
  }
}

/**
 * Compute cumulative fitness at every snapshot in the display sim.
 * goalScore steps up when each checkpoint's targetTime is crossed.
 * sanityScore tracks running eco/waste/stall adjustments.
 */
export function computeCumulativeFitness(
  result: SimResult,
  genes: string[],
  checkpoints: OptimizerCheckpoint[],
  fw: FitnessWeights,
  getUnit: (id: string) => Unit | undefined,
  windAvg = 0,
  windMin = 0,
): CumulativeFitnessPoint[] {
  // Pre-compute each checkpoint's locked achievement × weight.
  // The achievement is always evaluated at the checkpoint's own targetTime snapshot.
  const genesSetCC = new Set(genes)
  // Pre-build completedSets for each distinct completedCount value to avoid rebuilding per iteration
  const completedSetCacheCC = new Map<number, Set<string>>()
  const getCompletedSetCC = (count: number): Set<string> => {
    let s = completedSetCacheCC.get(count)
    if (!s) {
      s = new Set<string>()
      for (let i = 0; i < count; i++) s.add(result.completedUnitIds[i])
      completedSetCacheCC.set(count, s)
    }
    return s
  }

  const cpLocked: { targetTime: number; score: number }[] = checkpoints.map((cp) => {
    const snap = result.snapshots.find((s) => s.timeSeconds >= cp.targetTime)
    if (!snap) return { targetTime: cp.targetTime, score: 0 }
    return { targetTime: cp.targetTime, score: cpAchievement(cp, snap, getCompletedSetCC(snap.completedCount), genesSetCC, fw, getUnit) * cp.weight }
  })

  const out: CumulativeFitnessPoint[] = []
  let sumBankRatio = 0, bankCount = 0
  let sumEnergyFill = 0, energyFillCount = 0
  let sumMetalIncome = 0, metalIncomeCount = 0

  for (const snap of result.snapshots) {
    const T = snap.timeSeconds

    // Accumulate running averages
    if (snap.metalCap > 0) { sumBankRatio += snap.currentMetal / snap.metalCap; bankCount++ }
    const avgBankRatio = bankCount > 0 ? sumBankRatio / bankCount : 0
    if (snap.energyCap > 0) { sumEnergyFill += snap.currentEnergy / snap.energyCap; energyFillCount++ }
    const avgEnergyFill = energyFillCount > 0 ? sumEnergyFill / energyFillCount : 0
    sumMetalIncome += snap.metalIncome; metalIncomeCount++
    const avgMetalIncome = sumMetalIncome / metalIncomeCount

    // Sum only checkpoints whose deadline has passed
    let goalScore = 0
    for (const { targetTime, score } of cpLocked) {
      if (T >= targetTime) goalScore += score
    }

    const sanityScore = sanitySingle(snap, avgBankRatio, avgEnergyFill, avgMetalIncome, fw, windAvg, windMin)

    out.push({ time: T, goalScore, sanityScore, total: goalScore + sanityScore })
  }
  return out
}

// ── Fitness ────────────────────────────────────────────────────────────────────

function evaluateFitness(
  genes: string[],
  config: OptimizerConfig,
  unitIndex: UnitIndex,
  builderCapabilities: BuilderCapabilities,
): number {
  const result = simulateBuildOrder(genes, config.simConfig, unitIndex, builderCapabilities)
  const fw: FitnessWeights = config.fitnessWeights ?? defaultFitnessWeights()
  const getUnit = (id: string) => unitIndex.byId.get(id)
  // Pre-build O(1) lookup set for gene membership — avoids O(n) includes() per checkpoint
  const genesSet = new Set(genes)
  let score = 0

  // Cache snapshot → completedSet so we don't rebuild the Set when multiple checkpoints
  // share the same targetTime.  Built from result.completedUnitIds[0..snapshot.completedCount)
  // — one array reference shared across all snapshots, no per-snapshot copies.
  const completedSetCache = new Map<number, Set<string>>()
  const getCompletedSet = (snapshot: { completedCount: number; timeSeconds: number }): Set<string> => {
    let s = completedSetCache.get(snapshot.completedCount)
    if (!s) {
      s = new Set<string>()
      for (let i = 0; i < snapshot.completedCount; i++) s.add(result.completedUnitIds[i])
      completedSetCache.set(snapshot.completedCount, s)
    }
    return s
  }

  for (const cp of config.checkpoints) {
    const snapshot = result.snapshots.find((s) => s.timeSeconds >= cp.targetTime)
    if (!snapshot) continue
    score += cpAchievement(cp, snapshot, getCompletedSet(snapshot), genesSet, fw, getUnit) * cp.weight
  }

  // Sanity adjustments — compute running averages across all snapshots
  let sumBankRatio = 0, bankCount = 0
  let sumEnergyFill = 0, energyFillCount = 0
  let sumMetalIncome = 0, metalIncomeCount = 0
  for (const s of result.snapshots) {
    if (s.metalCap > 0) { sumBankRatio += s.currentMetal / s.metalCap; bankCount++ }
    if (s.energyCap > 0) { sumEnergyFill += s.currentEnergy / s.energyCap; energyFillCount++ }
    sumMetalIncome += s.metalIncome; metalIncomeCount++
  }
  const avgBankRatio    = bankCount > 0         ? sumBankRatio / bankCount          : 0
  const avgEnergyFill   = energyFillCount > 0   ? sumEnergyFill / energyFillCount   : 0
  const avgMetalIncome  = metalIncomeCount > 0  ? sumMetalIncome / metalIncomeCount : 0
  const last = result.snapshots[result.snapshots.length - 1]
  if (last) {
    const rawSanity = sanitySingle(last, avgBankRatio, avgEnergyFill, avgMetalIncome, fw, config.simConfig.windAvg, config.simConfig.windMin)
    // Clamp sanity so it can contribute at most ~30% of total goal weight.
    // This prevents sanity terms from dominating — goals always have primary control.
    const totalGoalWeight = config.checkpoints.reduce((s, cp) => s + cp.weight, 0)
    const maxSanityInfluence = Math.max(0.5, totalGoalWeight * 0.3)
    score += Math.max(-maxSanityInfluence, Math.min(maxSanityInfluence, rawSanity))
  }

  return score
}

// ── GA Operators ───────────────────────────────────────────────────────────────

function tournamentSelect(population: Chromosome[], size: number): Chromosome {
  let best = population[Math.floor(Math.random() * population.length)]
  for (let i = 1; i < size; i++) {
    const challenger = population[Math.floor(Math.random() * population.length)]
    if (challenger.fitness > best.fitness) best = challenger
  }
  return best
}

/**
 * Single-point crossover for variable-length build-order chromosomes.
 *
 * Picks independent cut points c1 ∈ [0, |p1|] and c2 ∈ [0, |p2|]:
 *   child1 = p1[0..c1) + p2[c2..)   — p1's early strategy, p2's late strategy
 *   child2 = p2[0..c2) + p1[c1..)   — symmetric
 *
 * Children are trimmed to maxLength before repair.
 *
 * Why not OX1:
 *   OX1 (Order Crossover) was designed for permutations (TSP) and de-duplicates
 *   genes from the secondary parent using a "consumed" counter.  Build orders
 *   legitimately repeat the same unit many times (5 armmex, 20 armpw, etc.).
 *   De-duplication silently removes those repeats, causing the population to
 *   converge toward shorter chromosomes over generations.  OX1 also has a
 *   placement bug when remaining.length < lo — the segment shifts to the end.
 *   Single-point crossover has neither problem and is more intuitive for
 *   ordered strategy sequences.
 */
export function singlePointCrossover(
  p1: string[],
  p2: string[],
  maxLength: number,
): [string[], string[]] {
  if (p1.length === 0) return [[], [...p2].slice(0, maxLength)]
  if (p2.length === 0) return [[...p1].slice(0, maxLength), []]
  const c1 = Math.floor(Math.random() * (p1.length + 1))
  const c2 = Math.floor(Math.random() * (p2.length + 1))
  const child1 = [...p1.slice(0, c1), ...p2.slice(c2)].slice(0, maxLength)
  const child2 = [...p2.slice(0, c2), ...p1.slice(c1)].slice(0, maxLength)
  return [child1, child2]
}

/** Apply one mutation operation at position `i` in-place and return the (possibly resized) array. */
export function applyOneMutation(result: string[], i: number, maxLength: number, factionUnits: Unit[]): string[] {
  const roll = Math.random()
  if (roll < 0.35) {
    // Swap with another random position
    const j = Math.floor(Math.random() * result.length)
    ;[result[i], result[j]] = [result[j], result[i]]
  } else if (roll < 0.60) {
    // Replace with a random faction unit (build gene)
    result[i] = factionUnits[Math.floor(Math.random() * factionUnits.length)].id
  } else if (roll < 0.71) {
    // Insert a new build gene
    const unit = factionUnits[Math.floor(Math.random() * factionUnits.length)]
    result.splice(i, 0, unit.id)
    if (result.length > maxLength) result.pop()
  } else if (roll < 0.82) {
    // Insert a RECLAIM gene for a unit already placed earlier in the order.
    const buildsBefore = result.slice(0, i).filter((g) => !isReclaimGene(g))
    if (buildsBefore.length > 0) {
      const target = buildsBefore[Math.floor(Math.random() * buildsBefore.length)]
      result.splice(i, 0, makeReclaimGene(target))
      if (result.length > maxLength) result.pop()
    } else {
      result.splice(i, 1)
    }
  } else if (roll < 0.91) {
    // Insert an atomic RECLAIM:t1mex + t2mex upgrade pair.
    // Keeping them adjacent prevents crossover from splitting the pair.
    const t1MexIds = new Set(
      factionUnits.filter((u) => (u.metalProduction ?? 0) > 0 && u.tier === 'T1').map((u) => u.id),
    )
    const t2MexUnits = factionUnits.filter((u) => (u.metalProduction ?? 0) > 0 && u.tier === 'T2')
    const t1MexesBefore = result.slice(0, i).filter((g) => !isReclaimGene(g) && t1MexIds.has(g))
    if (t1MexesBefore.length > 0 && t2MexUnits.length > 0) {
      const targetId = t1MexesBefore[Math.floor(Math.random() * t1MexesBefore.length)]
      const t2mex = t2MexUnits[Math.floor(Math.random() * t2MexUnits.length)]
      result.splice(i, 0, makeReclaimGene(targetId), t2mex.id)
      while (result.length > maxLength) result.pop()
    } else {
      // No T1 MEX available to upgrade — fall back to inserting a random build gene
      const unit = factionUnits[Math.floor(Math.random() * factionUnits.length)]
      result.splice(i, 0, unit.id)
      if (result.length > maxLength) result.pop()
    }
  } else {
    // Delete this gene
    result.splice(i, 1)
  }
  return result
}

function mutate(
  genes: string[],
  mutationRate: number,
  maxLength: number,
  factionUnits: Unit[],
  mutationCount = 1,
  explodingMutationChance = 0,
): string[] {
  const result = [...genes]
  // Safety cap: even at 0.99 exploding chance, limit cascades per fired mutation
  const MAX_EXPLOSIONS = 50
  for (let pass = 0; pass < mutationCount; pass++) {
    for (let i = result.length - 1; i >= 0; i--) {
      // Explosion may have deleted elements at indices ≤ i, shrinking the array.
      // Skip if i is now out-of-bounds to avoid creating undefined slots.
      if (i >= result.length) continue
      if (Math.random() >= mutationRate) continue
      applyOneMutation(result, i, maxLength, factionUnits)
      // Cascading explosion: each fired mutation can trigger another
      let explosions = 0
      while (explosions < MAX_EXPLOSIONS && Math.random() < explodingMutationChance) {
        if (result.length === 0) break
        const j = Math.floor(Math.random() * result.length)
        applyOneMutation(result, j, maxLength, factionUnits)
        explosions++
      }
    }
  }
  return result
}

// ── Initial Population ─────────────────────────────────────────────────────────

function generateSeed(
  factionUnits: Unit[],
  builderMap: Map<string, string[]>,
  startingBuilderIds: string[],
  maxLength: number,
  seed: 'eco' | 'factory' | 'random' | 't3',
): string[] {
  const available = new Set<string>(startingBuilderIds)
  const genes: string[] = []
  // Track net T1 MEX count placed so far — used to seed T2 MEX upgrade sequences.
  // Decremented when a RECLAIM gene is inserted for that ID.
  const t1MexNet = new Map<string, number>()

  for (let i = 0; i < maxLength; i++) {
    const buildable = factionUnits.filter((u) => {
      const builders = builderMap.get(u.id)
      return builders ? builders.some((b) => available.has(b)) : false
    })
    if (buildable.length === 0) break

    // ── T2 MEX upgrade opportunity ────────────────────────────────────────
    // Once a T2 MEX is buildable (T2 constructor online) and we have T1 mexes
    // on the field, seed a RECLAIM:t1mex + t2mex pair atomically.
    // This teaches the GA the T1→T2 MEX upgrade pattern.
    if ((seed === 'eco' || seed === 't3') && i + 1 < maxLength && Math.random() < 0.30) {
      // Collect reclaimable T1 MEX IDs (net count > 0)
      const reclaimable: string[] = []
      for (const [id, cnt] of t1MexNet) {
        for (let k = 0; k < cnt; k++) reclaimable.push(id)
      }
      const t2mexes = buildable.filter(
        (u) => (u.metalProduction ?? 0) > 0 && u.tier === 'T2',
      )
      if (reclaimable.length > 0 && t2mexes.length > 0) {
        const targetId = reclaimable[Math.floor(Math.random() * reclaimable.length)]
        const t2mex   = t2mexes[Math.floor(Math.random() * t2mexes.length)]
        genes.push(makeReclaimGene(targetId))
        genes.push(t2mex.id)
        t1MexNet.set(targetId, (t1MexNet.get(targetId) ?? 1) - 1)
        i++  // consumed 2 slots; for-loop will increment i once more
        continue
      }
    }

    // ── Normal gene selection ─────────────────────────────────────────────
    let pool: Unit[]
    if (seed === 'eco' && i < Math.floor(maxLength * 0.6)) {
      const eco = buildable.filter(
        (u) => (u.metalProduction ?? 0) > 0 || (u.energyProduction ?? 0) > 0,
      )
      pool = eco.length > 0 && Math.random() < 0.7 ? eco : buildable
    } else if (seed === 'factory' && i < Math.floor(maxLength * 0.4)) {
      // Prefer production facilities: labs, plants, hangars, shipyards, gantries.
      const factories = buildable.filter(
        (u) =>
          (u.buildPower ?? 0) > 0 &&
          u.unitType === 'Building' &&
          !u.isCommander &&
          (u.name.toLowerCase().includes('lab') ||
            u.name.toLowerCase().includes('plant') ||
            u.name.toLowerCase().includes('hangar') ||
            u.name.toLowerCase().includes('shipyard') ||
            u.name.toLowerCase().includes('gantry')),
      )
      pool = factories.length > 0 && Math.random() < 0.7 ? factories : buildable
    } else if (seed === 't3') {
      // Phased strategy to unlock T3/experimental units:
      //   Phase 1 (0–25%):  T1 factories → get T2 constructors available
      //   Phase 2 (25–50%): T2 constructors → get T3 gantries/factories available
      //   Phase 3 (50–75%): T3 factories/gantries (builds level 2 prerequisite met)
      //   Phase 4 (75–100%): experimental units, or eco as fallback
      const t2Cons = buildable.filter((u) => u.tier === 'T2' && (u.buildPower ?? 0) > 0)
      const t3Builders = buildable.filter((u) => isTech3(u) && (u.buildPower ?? 0) > 0)
      const experimentals = buildable.filter((u) => isTech3(u) && (u.buildPower ?? 0) === 0)
      if (i < Math.floor(maxLength * 0.25)) {
        // Include T1 factories AND T1 mobile constructors. The constructor (armck)
        // is the critical link: T1 factory → armck → T2 factory → T2 constructor → T3 gantry.
        // Without armck in Phase 1 the T2 constructor pool in Phase 2 is always empty.
        const t1Factories = buildable.filter(
          (u) =>
            (u.buildPower ?? 0) > 0 && u.unitType === 'Building' && !u.isCommander &&
            (u.name.toLowerCase().includes('lab') || u.name.toLowerCase().includes('plant') ||
             u.name.toLowerCase().includes('hangar') || u.name.toLowerCase().includes('shipyard')),
        )
        const t1Constructors = buildable.filter(
          (u) =>
            (u.buildPower ?? 0) > 0 &&
            u.unitType !== 'Building' &&
            u.unitType !== 'Commander' &&
            u.tier === 'T1' &&
            !u.isCommander,
        )
        const phase1Pool = [...t1Factories, ...t1Constructors]
        pool = phase1Pool.length > 0 && Math.random() < 0.7 ? phase1Pool : buildable
      } else if (i < Math.floor(maxLength * 0.5) && t2Cons.length > 0) {
        pool = Math.random() < 0.7 ? t2Cons : buildable
      } else if (i < Math.floor(maxLength * 0.75) && t3Builders.length > 0) {
        pool = Math.random() < 0.7 ? t3Builders : buildable
      } else if (experimentals.length > 0 && Math.random() < 0.6) {
        pool = experimentals
      } else {
        const eco = buildable.filter(
          (u) => (u.metalProduction ?? 0) > 0 || (u.energyProduction ?? 0) > 0,
        )
        pool = eco.length > 0 && Math.random() < 0.5 ? eco : buildable
      }
    } else {
      pool = buildable
    }

    const chosen = pool[Math.floor(Math.random() * pool.length)]
    genes.push(chosen.id)
    // Track T1 MEX placements so we can generate upgrade sequences later
    if ((chosen.metalProduction ?? 0) > 0 && chosen.tier === 'T1') {
      t1MexNet.set(chosen.id, (t1MexNet.get(chosen.id) ?? 0) + 1)
    }
    if ((chosen.buildPower ?? 0) > 0) {
      available.add(chosen.id)
    }
  }
  return genes
}

function generateInitialPopulation(
  config: OptimizerConfig,
  factionUnits: Unit[],
  builderMap: Map<string, string[]>,
  startingBuilderIds: string[],
  unitIndex: UnitIndex,
): Chromosome[] {
  const { populationSize, maxBuildOrderLength } = config
  const pop: Chromosome[] = []

  // Goal-directed seeds: for each unit-type checkpoint, generate dedicated
  // chromosomes that route through the prerequisite chain to that unit.
  // Capped at 20% of the population total so they don't crowd out diversity.
  const goalIds = resolveGoalUnitIds(config.checkpoints, factionUnits)
  const maxGoalSeeds = Math.floor(populationSize * 0.20)
  const goalSeedsPerUnit = goalIds.length > 0
    ? Math.max(1, Math.floor(maxGoalSeeds / goalIds.length))
    : 0
  for (const goalId of goalIds) {
    for (let i = 0; i < goalSeedsPerUnit && pop.length < maxGoalSeeds; i++) {
      pop.push({
        genes: generateGoalSeed(goalId, factionUnits, builderMap, startingBuilderIds, unitIndex, maxBuildOrderLength),
        fitness: 0,
      })
    }
  }

  const remaining = populationSize - pop.length
  const ecoCount     = Math.floor(remaining * 0.30)
  const factoryCount = Math.floor(remaining * 0.25)
  const t3Count      = Math.floor(remaining * 0.15)
  const randomCount  = remaining - ecoCount - factoryCount - t3Count

  const makeSeed = (type: 'eco' | 'factory' | 'random' | 't3'): Chromosome => ({
    genes: generateSeed(factionUnits, builderMap, startingBuilderIds, maxBuildOrderLength, type),
    fitness: 0,
  })

  for (let i = 0; i < ecoCount; i++) pop.push(makeSeed('eco'))
  for (let i = 0; i < factoryCount; i++) pop.push(makeSeed('factory'))
  for (let i = 0; i < t3Count; i++) pop.push(makeSeed('t3'))
  for (let i = 0; i < randomCount; i++) pop.push(makeSeed('random'))

  return pop
}

// ── Population Statistics ────────────────────────────────────────────────────

function computePopulationStats(
  population: Chromosome[],
  config: OptimizerConfig,
  stagnationCounter: number,
  goalArchive: Map<string, Chromosome>,
  improvementCount: number,
  unitIndex: UnitIndex,
): PopulationStats {
  const n = population.length
  const fitnesses = population.map(c => c.fitness).sort((a, b) => a - b)

  // Fitness distribution
  const medianFitness = fitnesses[Math.floor(n / 2)]
  const worstFitness = fitnesses[0]
  const mean = fitnesses.reduce((s, f) => s + f, 0) / n
  const variance = fitnesses.reduce((s, f) => s + (f - mean) ** 2, 0) / n
  const fitnessStdDev = Math.sqrt(variance)

  // Diversity: count unique chromosomes by joining gene arrays
  const seen = new Set<string>()
  for (const c of population) seen.add(c.genes.join(','))
  const uniqueChromosomeCount = seen.size

  // Average chromosome length
  const avgChromosomeLength = population.reduce((s, c) => s + c.genes.length, 0) / n

  // Sampled pairwise Jaccard distance (sample 20 random pairs to keep O(1)-ish)
  let distSum = 0
  const SAMPLE_PAIRS = 20
  for (let p = 0; p < SAMPLE_PAIRS; p++) {
    const a = population[Math.floor(Math.random() * n)]
    const b = population[Math.floor(Math.random() * n)]
    const setA = new Set(a.genes)
    const setB = new Set(b.genes)
    const union = new Set([...setA, ...setB])
    let intersection = 0
    for (const g of setA) if (setB.has(g)) intersection++
    distSum += union.size > 0 ? 1 - intersection / union.size : 0
  }
  const avgPairwiseDistance = distSum / SAMPLE_PAIRS

  // Per-checkpoint achievement rate across population
  const goalAchievementRates = config.checkpoints.map((cp) => {
    let count = 0
    for (const chrom of population) {
      if (cp.type === 'building' || cp.type === 'unit' || cp.type === 'unitCategory' || cp.type === 'unitCount') {
        const targetId = (cp as { unitId?: string }).unitId
        if (targetId && chrom.genes.includes(targetId)) {
          count++
        } else if (cp.type === 'unitCategory') {
          // For category goals check if any matching unit is in genes
          let found = false
          for (const geneId of chrom.genes) {
            const u = unitIndex.byId.get(geneId)
            if (u && matchesUnitCategory(u, (cp as { categoryId: string }).categoryId as import('../types').UnitCategoryId)) {
              found = true
              break
            }
          }
          if (found) count++
        }
      } else {
        // For continuous goals: approximate by checking if this chrom's fitness
        // is above median (rough proxy — precise would require re-simming)
        if (chrom.fitness >= medianFitness) count++
      }
    }
    return count / n
  })

  return {
    medianFitness,
    worstFitness,
    fitnessStdDev,
    uniqueChromosomeCount,
    avgChromosomeLength,
    avgPairwiseDistance,
    goalAchievementRates,
    stagnationCounter,
    goalArchiveSize: goalArchive.size,
    improvementCount,
  }
}

// ── Main GA Loop ───────────────────────────────────────────────────────────────

/**
 * Run the GA in chunks using setTimeout between chunks so the worker's event
 * loop can process the 'stop' message between chunks.
 *
 * `onDone` is called once with the final result (either max generations reached
 * or shouldStop() returned true).  Results are always delivered, even on stop.
 */
export function runOptimizer(
  config: OptimizerConfig,
  units: Unit[],
  onProgress: (msg: WorkerProgressMessage) => void,
  shouldStop: () => boolean,
  onDone: (result: WorkerResultMessage) => void,
): void {
  const startMs = Date.now()
  const CHUNK_SIZE = config.progressIntervalGenerations  // yield after each progress interval

  const startingBuilderIds = [
    config.simConfig.commanderUnitId,
    ...(config.simConfig.additionalStartingUnitIds ?? []),
  ]

  const unitIndex = buildUnitIndex(units)
  const builderMap = buildPrerequisiteMap(units, startingBuilderIds)
  const builderCapabilities = buildBuilderCapabilities(builderMap)

  // Build the pool of units the GA is allowed to place in the build order.
  // Always exclude morph/upgrade targets (Legion commander levels, etc.) and
  // Commander-type units (handled via SimConfig, not as a gene).
  const factionUnits = units.filter((u) => {
    if (u.faction !== config.faction) return false
    if (u.isMorph) return false
    if (u.unitType === 'Commander') return false
    if (isUnitExcluded(u, config.unitPoolFilters)) return false
    return true
  })

  const cmdCaps = builderCapabilities.byBuilderId.get(startingBuilderIds[0])
  console.log(`[optimizer] units=${units.length} faction=${config.faction} factionUnits=${factionUnits.length} cmdCaps=${cmdCaps?.size ?? 0}`)

  const evaluate = (chrom: Chromosome): Chromosome => ({
    genes: chrom.genes,
    fitness: evaluateFitness(chrom.genes, config, unitIndex, builderCapabilities),
  })

  // Seed chromosomes (e.g. best from a previous run) are repaired and placed at
  // the front; the rest of the population is generated normally and trimmed to size.
  const seedPop: Chromosome[] = (config.seedChromosomes ?? []).map((genes) => {
    const repaired = repairChromosome(genes, builderMap, startingBuilderIds, unitIndex)
    return evaluate({ genes: repaired, fitness: 0 })
  })
  const generatedPop = generateInitialPopulation(config, factionUnits, builderMap, startingBuilderIds, unitIndex)
    .map(evaluate)

  let population: Chromosome[] = [...seedPop, ...generatedPop].slice(0, config.populationSize)

  let bestEver: Chromosome = { genes: [], fitness: -Infinity }
  let gen = 0

  // ── Goal metadata ────────────────────────────────────────────────────────
  // Unit IDs that appear as explicit unit/building goals in the checkpoints.
  // resolveGoalUnitIds also handles unitCategory checkpoints (e.g. 'anyT3Factory')
  // so niche protection, guided mutation, and stagnation injection all fire for them.
  const goalIds = resolveGoalUnitIds(config.checkpoints, factionUnits)

  // Per-goal archive: best chromosome that contains each goal unit in its genes.
  // Injected into the population during stagnation so the GA never "forgets"
  // a strategy that was achieving a specific goal.
  const goalArchive: Map<string, Chromosome> = new Map()
  function updateGoalArchive(chrom: Chromosome): void {
    for (const gid of goalIds) {
      if (chrom.genes.includes(gid)) {
        const current = goalArchive.get(gid)
        if (!current || chrom.fitness > current.fitness) {
          goalArchive.set(gid, { genes: [...chrom.genes], fitness: chrom.fitness })
        }
      }
    }
  }

  // ── Stagnation tracking ───────────────────────────────────────────────────
  // When stagnating: first try injecting goal-archive members; if the archive
  // is empty for a goal, generate a fresh goal-directed seed for it.
  // Adaptive: escalating response — first event mild, repeated events more aggressive.
  const STAGNATION_THRESHOLD = 30     // reduced: act sooner to avoid deep convergence
  let stagnationCounter = 0
  let prevBestFitness   = -Infinity
  let improvementCount  = 0           // total times bestEver was updated

  function finalize(): void {
    population.sort((a, b) => b.fitness - a.fitness)
    if (population[0]?.fitness > bestEver.fitness) bestEver = population[0]

    const displayConfig = getFullFidelitySimConfig(config.simConfig)
    const simResult = simulateBuildOrder(bestEver.genes, displayConfig, unitIndex, builderCapabilities)

    onDone({
      type: 'result',
      bestChromosome: bestEver,
      simResult,
      totalGenerations: gen,
      elapsedMs: Date.now() - startMs,
    })
  }

  function processChunk(): void {
    const chunkEnd = Math.min(gen + CHUNK_SIZE, config.maxGenerations)

    while (gen < chunkEnd) {
      population.sort((a, b) => b.fitness - a.fitness)

      if (population[0].fitness > bestEver.fitness) {
        bestEver = { ...population[0] }
        improvementCount++
      }

      // Update per-goal archive with every individual this generation
      for (const chrom of population) updateGoalArchive(chrom)

      // ── Stagnation / goal-directed diversity injection ────────────────────
      if (bestEver.fitness > prevBestFitness + 1e-9) {
        prevBestFitness   = bestEver.fitness
        stagnationCounter = 0
      } else {
        stagnationCounter++
      }
      if (stagnationCounter > 0 && stagnationCounter % STAGNATION_THRESHOLD === 0) {
        // Adaptive stagnation: escalating response
        const stagnationLevel = Math.floor(stagnationCounter / STAGNATION_THRESHOLD) // 1, 2, 3...
        const refreshFraction = Math.min(0.50, 0.15 + (stagnationLevel - 1) * 0.10) // 15% → 25% → 35% → 45% → 50%

        // Replace the weakest performers (below eliteCount) with:
        //   1. Per-goal archive members (best known chromosome for each goal)
        //   2. Fresh goal-directed seeds for any goals missing from the archive
        //   3. Fresh randomly-seeded individuals to fill the rest
        const refreshCount = Math.max(1, Math.floor(config.populationSize * refreshFraction))
        const injected: Chromosome[] = []

        // First pass: inject archived goal chromosomes — mutated so they bring
        // diversity while retaining the goal-achieving structure
        for (const [gid, archived] of goalArchive) {
          if (injected.length >= refreshCount) break
          let genes = mutate(
            [...archived.genes],
            config.mutationRate * 2,  // double mutation rate for re-injected archive members
            config.maxBuildOrderLength,
            factionUnits, config.mutationCount, config.explodingMutationChance,
          )
          genes = repairChromosome(genes, builderMap, startingBuilderIds, unitIndex)
          injected.push(evaluate({ genes, fitness: 0 }))
          // Also inject a fresh goal seed for this unit alongside the mutated archive
          if (injected.length < refreshCount) {
            let fresh = generateGoalSeed(gid, factionUnits, builderMap, startingBuilderIds, unitIndex, config.maxBuildOrderLength)
            fresh = repairChromosome(fresh, builderMap, startingBuilderIds, unitIndex)
            injected.push(evaluate({ genes: fresh, fitness: 0 }))
          }
        }

        // Second pass: for goals not yet in the archive, generate targeted seeds
        for (const gid of goalIds) {
          if (injected.length >= refreshCount) break
          if (!goalArchive.has(gid)) {
            let genes = generateGoalSeed(gid, factionUnits, builderMap, startingBuilderIds, unitIndex, config.maxBuildOrderLength)
            genes = repairChromosome(genes, builderMap, startingBuilderIds, unitIndex)
            injected.push(evaluate({ genes, fitness: 0 }))
          }
        }

        // Fill remaining refresh slots with fresh generated individuals
        const stillNeeded = refreshCount - injected.length
        if (stillNeeded > 0) {
          const freshPop = generateInitialPopulation(
            { ...config, populationSize: stillNeeded },
            factionUnits, builderMap, startingBuilderIds, unitIndex,
          ).map(evaluate)
          injected.push(...freshPop)
        }

        population.splice(config.populationSize - refreshCount, refreshCount, ...injected)
      }

      if (gen % config.progressIntervalGenerations === 0) {
        const avgFitness = population.reduce((s, c) => s + c.fitness, 0) / population.length
        const stats = computePopulationStats(population, config, stagnationCounter, goalArchive, improvementCount, unitIndex)
        onProgress({
          type: 'progress',
          generation: gen,
          bestFitness: bestEver.fitness,
          averageFitness: avgFitness,
          bestChromosome: bestEver,
          elapsedMs: Date.now() - startMs,
          stats,
        })
      }

      // ── Niche protection ────────────────────────────────────────────────────
      // Reserve NICHE_SLOTS slots in the elite set for the best chromosome
      // containing each goal unit.  This prevents goal-achieving strategies
      // from being selected out even when their overall fitness is lower.
      // 1 protected slot per goal unit (within elite budget)
      const nicheElites: Chromosome[] = []
      const nicheUsedIndices = new Set<number>()
      for (const gid of goalIds) {
        if (nicheElites.length >= Math.floor(config.eliteCount / 2)) break
        // Find best chromosome with this goal in the sorted population
        let found = false
        for (let i = 0; i < population.length; i++) {
          if (nicheUsedIndices.has(i)) continue
          if (population[i].genes.includes(gid)) {
            nicheElites.push(population[i])
            nicheUsedIndices.add(i)
            found = true
            break
          }
        }
        // If no population member has this goal, inject from archive
        if (!found && goalArchive.has(gid)) {
          nicheElites.push(goalArchive.get(gid)!)
        }
      }
      // Standard elites (top by fitness), excluding any already in nicheElites
      const standardEliteCount = config.eliteCount - nicheElites.length
      const standardElites: Chromosome[] = []
      for (let i = 0; i < population.length && standardElites.length < standardEliteCount; i++) {
        if (!nicheUsedIndices.has(i)) standardElites.push(population[i])
      }
      const allElites = [...standardElites, ...nicheElites]

      const newPop: Chromosome[] = [...allElites]

      // Adaptive tournament pressure: grows during stagnation
      const stagnationLevel = Math.floor(stagnationCounter / STAGNATION_THRESHOLD)
      const effectiveTournamentSize = config.tournamentSize + stagnationLevel

      while (newPop.length < config.populationSize) {
        if (Math.random() < config.crossoverRate && newPop.length + 1 < config.populationSize) {
          const p1 = tournamentSelect(population, effectiveTournamentSize)
          const p2 = tournamentSelect(population, effectiveTournamentSize)
          let [c1genes, c2genes] = singlePointCrossover(p1.genes, p2.genes, config.maxBuildOrderLength)
          // Apply mutation before repair so reclaim/build genes can enter via crossover path too
          c1genes = mutate(c1genes, config.mutationRate, config.maxBuildOrderLength, factionUnits, config.mutationCount, config.explodingMutationChance)
          c2genes = mutate(c2genes, config.mutationRate, config.maxBuildOrderLength, factionUnits, config.mutationCount, config.explodingMutationChance)
          // Goal-guided mutation: with some probability, inject the prerequisite
          // chain for a randomly selected unsatisfied goal unit.  This fires
          // alongside regular mutation to steer search toward unexplored goals
          // without replacing the genetic operators.
          // Insert at a random position in the first half (so eco genes before it are preserved)
          if (goalIds.length > 0 && Math.random() < 0.12) {
            const gid = goalIds[Math.floor(Math.random() * goalIds.length)]
            if (!c1genes.includes(gid)) {
              const chain = getPrerequisiteChain(gid, builderMap, startingBuilderIds)
              const insertAt = Math.floor(Math.random() * Math.ceil(c1genes.length / 2))
              c1genes = repairChromosome(
                [...c1genes.slice(0, insertAt), ...chain, ...c1genes.slice(insertAt)].slice(0, config.maxBuildOrderLength),
                builderMap, startingBuilderIds, unitIndex,
              )
            }
          }
          c1genes = repairChromosome(c1genes, builderMap, startingBuilderIds, unitIndex)
          c2genes = repairChromosome(c2genes, builderMap, startingBuilderIds, unitIndex)
          newPop.push(evaluate({ genes: c1genes, fitness: 0 }))
          if (newPop.length < config.populationSize) {
            newPop.push(evaluate({ genes: c2genes, fitness: 0 }))
          }
        } else {
          const parent = tournamentSelect(population, effectiveTournamentSize)
          let mutated = mutate(parent.genes, config.mutationRate, config.maxBuildOrderLength, factionUnits, config.mutationCount, config.explodingMutationChance)
          // Goal-guided mutation: same injection for mutation-only path
          if (goalIds.length > 0 && Math.random() < 0.12) {
            const gid = goalIds[Math.floor(Math.random() * goalIds.length)]
            if (!mutated.includes(gid)) {
              const chain = getPrerequisiteChain(gid, builderMap, startingBuilderIds)
              const insertAt = Math.floor(Math.random() * Math.max(1, Math.ceil(mutated.length / 2)))
              mutated = repairChromosome(
                [...mutated.slice(0, insertAt), ...chain, ...mutated.slice(insertAt)].slice(0, config.maxBuildOrderLength),
                builderMap, startingBuilderIds, unitIndex,
              )
            }
          }
          mutated = repairChromosome(mutated, builderMap, startingBuilderIds, unitIndex)
          newPop.push(evaluate({ genes: mutated, fitness: 0 }))
        }
      }

      population = newPop
      gen++
    }

    if (gen >= config.maxGenerations || shouldStop()) {
      finalize()
    } else {
      // Yield to the event loop so the worker can process the 'stop' message
      setTimeout(processChunk, 0)
    }
  }

  // Start the first chunk on the next event loop tick
  setTimeout(processChunk, 0)
}
