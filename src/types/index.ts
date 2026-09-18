// Faction types
export type Faction = 'Armada' | 'Cortex' | 'Legion'

// Tier progression: Commander → T1 Factory → T1 Worker → T2 Factory → T2 Worker → T3 Factory
export type Tier = 'T1' | 'T2' | 'T3'

// Unit categories
export type UnitType =
  | 'Bot'
  | 'Vehicle'
  | 'Aircraft'
  | 'Ship'
  | 'Hovercraft'
  | 'Building'
  | 'Commander'

// Movement modes
export type MovementMode =
  | 'Walking'
  | 'Driving'
  | 'Hovering'
  | 'Flying'
  | 'Sailing'
  | 'Submarine'
  | 'Static'

// Projectile types for weapons
export type ProjectileType =
  | 'Laser'        // Instant hit (LaserCannon) — red
  | 'BeamLaser'    // Continuous beam (BeamLaser) — cyan/blue
  | 'Plasma'       // Travel time, unguided (generic Cannon) — orange
  | 'Cannon'       // Ballistic arc with gravity (gravityaffected Cannon) — orange
  | 'Rocket'       // Unguided rocket (StarBurst, etc.) — yellow-green
  | 'Missile'      // Guided missile (MissileLauncher) — yellow-orange
  | 'Torpedo'      // Guided underwater (TorpedoLauncher) — teal-blue
  | 'Flak'         // Proximity AoE detonation (cylindertargeting) — magenta
  | 'Heatray'      // Continuous beam / flame (LightningCannon, Flame) — orange-red
  | 'EMP'          // Stun effect (paralyzer weapons) — blue
  | 'DGun'         // Commander death gun — white-yellow
  | 'AircraftBomb' // Gravity bomb dropped from altitude — dark/olive
  | 'Napalm'       // AoE + travel time
  | 'Other'

// Weapon definition
export interface Weapon {
  id: string
  name: string
  damage: number
  reload: number           // seconds between shots
  range: number
  projectileType: ProjectileType
  projectileSpeed?: number // units per second, undefined = instant
  areaOfEffect?: number    // splash radius
  empDamage?: number       // EMP damage (stun threshold = unit max HP)
  stunDuration?: number    // seconds of stun when EMP threshold reached
  burstRate?: number       // for burst-fire weapons
  burstCount?: number      // shots per burst
  accuracy?: number        // 0-1, 1 = perfect accuracy
  canTargetAir?: boolean   // can this weapon fire at Aircraft units (false = ground-only)
  onlyTargetsAir?: boolean // weapon exclusively targets aircraft (e.g. flak, SAM)
  // Projectile behavior flags (from BAR weapon defs)
  isTracking?: boolean     // missile steers toward moving target each tick (tracks = true)
  isFlak?: boolean         // cylindertargeting: proximity detonation near aircraft
  gravityAffected?: boolean // ballistic arc affected by gravity (gravityaffected = true)
  predictBoost?: number    // 0–1: how well the weapon predicts target lead (Spring predictboost)
  edgeEffectiveness?: number   // 0-1: damage fraction at AoE edge (BAR: default ~0.0 for most, 1.0 for some)
  sprayAngle?: number          // weapon spread angle (in Spring "sprayangle" units, 1 unit ≈ 0.015°)
  targetMoveError?: number     // inaccuracy scaling with target speed
  movingAccuracy?: number      // accuracy penalty when shooter is moving
  armorDamage?: Record<string, number>  // per-armor-class damage overrides (key = armor class name)
  // Calculated
  dps?: number             // damage per second
}

// Special damage modifiers
export interface DamageModifier {
  type: 'reduction' | 'threshold'
  value: number           // percentage reduction or damage threshold
  condition?: string      // e.g., "when powered off"
  cooldown?: number       // for threshold-based, time to restore
}

// Unit definition
export interface Unit {
  // Identity
  id: string              // internal game ID (e.g., "armpw")
  name: string            // display name (e.g., "Pawn")
  description?: string
  faction: Faction
  tier: Tier
  unitType: UnitType

  // Costs
  metalCost: number
  energyCost: number
  buildTime: number       // total build power required

  // Combat stats
  health: number
  weapons: Weapon[]
  damageModifiers?: DamageModifier[]

  // Movement
  movementMode: MovementMode
  speed: number           // units per second
  turnRate?: number       // degrees per second
  acceleration?: number

  // Vision
  sightRange: number
  radarRange?: number
  sonarRange?: number
  jammerRange?: number

  // Cloaking
  canCloak?: boolean
  cloakCost?: number        // energy per second when stationary
  cloakCostMoving?: number  // energy per second when moving

  // Construction (for builders)
  buildPower?: number
  buildRange?: number
  canBuild?: string[]       // list of unit IDs this can build

  // Economy (for resource buildings)
  metalProduction?: number  // metal per second (positive = produces)
  energyProduction?: number // energy per second (positive = produces)
  energyUpkeep?: number     // energy per second consumed when active (positive = drains)
  metalStorage?: number
  energyStorage?: number
  // Energy-to-metal conversion (converters / metal makers)
  energyConverterCapacity?: number    // max energy per second this unit consumes for conversion
  energyConverterEfficiency?: number  // metal produced per unit of energy consumed

  // Flanking bonus (BAR per-unit customization via flankingbonusmode + params)
  flankingBonusMax?: number         // max flanking damage multiplier (BAR default: 2.0)
  flankingBonusMin?: number         // min flanking damage multiplier (BAR default: 1.0 for mode 1)
  flankingBonusMobilityAdd?: number // how fast flanking direction drifts (BAR default: 0.15)

  // Aircraft behavior
  hoverAttack?: boolean         // VTOL/gunship: can hover and attack simultaneously
                                // false/undefined = fixed-wing: must maintain speed, uses wide attack arcs

  // Special
  isCommander?: boolean
  isMorph?: boolean         // morph/upgrade target (e.g., Legion commander levels)
  transportCapacity?: number
  isKamikaze?: boolean      // rushes target and self-destructs on contact
  kamikazeDist?: number     // detonation range (units)
  isMine?: boolean          // static, cloaked, proximity detonation
  detonateRange?: number    // proximity trigger radius
  isSuicide?: boolean       // crawling bomb / instant self-destruct on contact
  stealth?: boolean         // passive cloak (no energy cost)

  // Metadata
  category?: string[]       // game categories
  footprint?: { x: number; z: number }
}

// Unit data file structure
export interface UnitData {
  version: string
  generatedAt: string
  source: string
  units: Unit[]
}

// Derived stats for analysis
export interface DerivedStats {
  // Combat efficiency
  totalDps: number
  maxRange: number
  minRange: number
  burstDamage: number      // alpha strike

  // Cost efficiency
  healthPerMetal: number
  dpsPerMetal: number
  healthPerTotalCost: number
  dpsPerTotalCost: number

  // Build efficiency (for constructors)
  buildPowerPerMetal?: number

  // Economy efficiency (for eco buildings)
  metalPerSecondPerCost?: number
  energyPerSecondPerCost?: number

  // Mobility
  speedPerCost: number
}

// Filter state for unit browser
export interface UnitFilters {
  factions: Faction[]
  tiers: Tier[]
  unitTypes: UnitType[]
  searchQuery: string       // live (uncommitted) search term — filtered as-you-type
  searchTags: string[]      // committed search terms (press Enter) — combine with OR logic
  hideMorphs: boolean       // hide morph/upgrade targets by default
}

// ── Optimizer Checkpoints ──────────────────────────────────────────────────────

export interface MetalIncomeCheckpoint  { type: 'metalIncome';  targetTime: number; targetValue: number; weight: number }
export interface EnergyIncomeCheckpoint { type: 'energyIncome'; targetTime: number; targetValue: number; weight: number }
export interface ArmyMetalCheckpoint    { type: 'armyMetal';    targetTime: number; targetValue: number; weight: number }
export interface BuildingCheckpoint     { type: 'building';     targetTime: number; unitId: string;      weight: number }
export interface UnitCheckpoint         { type: 'unit';         targetTime: number; unitId: string;      weight: number }
/** Require N completed units of a specific type by targetTime */
export interface UnitCountCheckpoint    { type: 'unitCount';    targetTime: number; unitId: string; targetCount: number; weight: number }
/** Require total active build power (commander + all built constructors/factories) ≥ targetValue */
export interface BuildPowerCheckpoint   { type: 'buildPower';   targetTime: number; targetValue: number; weight: number }

/**
 * Identifiers for broad unit categories used in unitCategory checkpoints.
 * Matched against unit data using name/tier/type heuristics.
 */
export type UnitCategoryId =
  | 'anyT1Factory'        // T1 lab / plant (armlab, armvp, armap…)
  | 'anyT2Factory'        // T2 lab / plant (armalab, armavp…)
  | 'anyT3Factory'        // Experimental factory
  | 'anyT1Constructor'    // T1 mobile constructor (armck, armcv, armca…)
  | 'anyT2Constructor'    // T2 mobile constructor
  | 'anyFusion'           // Any fusion reactor
  | 'anyFighter'          // Fighter / interceptor aircraft
  | 'anyBomber'           // Bomber / gunship aircraft

/** Require at least one unit matching a broad category to be completed by targetTime */
export interface UnitCategoryCheckpoint { type: 'unitCategory'; targetTime: number; categoryId: UnitCategoryId; weight: number }

/** Total DPS of alive army units ≥ targetValue by targetTime */
export interface ArmyDpsCheckpoint { type: 'armyDps'; targetTime: number; targetValue: number; weight: number }
/** Total health of alive army units ≥ targetValue by targetTime */
export interface ArmyHealthCheckpoint { type: 'armyHealth'; targetTime: number; targetValue: number; weight: number }
/**
 * Army composition goal — at least minFraction of army DPS must come from a given role.
 * role: 'ground' = non-aircraft combatants (bots/vehicles/ships)
 *       'air'    = aircraft (fighters + bombers combined)
 * achievement = actual fraction / minFraction (continuous, capped at continuousOvercap)
 */
export interface ArmyCompositionCheckpoint {
  type: 'armyComposition'
  targetTime: number
  role: 'ground' | 'air'
  minFraction: number  // 0–1
  weight: number
}

export type OptimizerCheckpoint =
  | MetalIncomeCheckpoint
  | EnergyIncomeCheckpoint
  | ArmyMetalCheckpoint
  | BuildingCheckpoint
  | UnitCheckpoint
  | UnitCountCheckpoint
  | BuildPowerCheckpoint
  | UnitCategoryCheckpoint
  | ArmyDpsCheckpoint
  | ArmyHealthCheckpoint
  | ArmyCompositionCheckpoint

// ── Sim (replaces EcoConfig / EcoResult) ──────────────────────────────────────

export interface SimConfig {
  startingMetal: number
  startingEnergy: number
  startingMetalStorage: number
  startingEnergyStorage: number
  commanderBuildpower: number
  commanderMetalIncome: number
  commanderEnergyIncome: number
  commanderUnitId: string                    // virtual ID used as root of build tree
  additionalStartingUnitIds?: string[]       // extra builders/units present at game start
  windAvg: number
  windMin: number                            // minimum wind speed on this map (default 5)
  windMax: number                            // maximum wind speed on this map (default 25)
  tidalStrength: number                      // tidal output multiplier (default 25 for most BAR maps)
  maxMetalSpots: number                      // how many MEX buildings can produce income
  metalPerSpot: number                       // M/s income granted when a MEX spot is occupied
  maxGeoSpots: number                        // how many geothermal buildings can produce income
  durationSeconds: number                    // drives sim length
  ticksPerSecond: number                     // 10 for GA runs, 30 for display
  snapshotTimes: number[]                    // seconds — derived from checkpoint targetTimes
}

export interface SimSnapshot {
  timeSeconds: number
  metalIncome: number
  energyIncome: number
  totalMetalSpent: number
  totalEnergySpent: number        // cumulative energy spent on construction
  armyMetalSpent: number          // cumulative metal EVER spent on army units (for charts only)
  currentArmyMetal: number        // metal value of currently ALIVE army units (decremented on reclaim)
  currentArmyDps: number          // total DPS of currently alive army units
  currentArmyHealth: number       // total health of currently alive army units
  currentArmyGroundDps: number    // DPS of alive army units that are ground attackers (non-aircraft)
  /** Number of unit completions in SimResult.completedUnitIds that have occurred by this snapshot.
   *  Use result.completedUnitIds.slice(0, snapshot.completedCount) to get the list.
   *  Stored as a count (not a copy) to avoid O(n²) array allocations across many snapshots. */
  completedCount: number
  aliveUnitCounts: Record<string, number>  // counts of currently alive units by unit ID
  currentMetal: number
  currentEnergy: number
  metalCap: number                // current metal storage capacity (grows as storage buildings complete)
  energyCap: number               // current energy storage capacity
  totalMetalWasted: number        // cumulative metal income lost to storage overflow
  totalEnergyWasted: number       // cumulative energy income lost to storage overflow
  buildPowerPotential: number     // cumulative BP-ticks of total assigned build power
  buildPowerWasted: number        // cumulative BP-ticks lost to resource starvation (stall)
  totalBuildPower: number         // commander bp + all completed builder/factory bp
  windGeneratorCount: number      // number of wind generators completed so far (for wind storage penalty)
  totalConverterMetalOutput: number  // cumulative metal produced by energy converters up to this snapshot
}

export interface BuildEvent {
  unitId: string
  unitName: string
  completedAtSeconds: number
  metalCost: number
  isReclaim?: boolean   // true = reclaim action; metalCost = metal RETURNED to storage
  // Simulation effects populated in display-mode runs:
  metalDelta?: number         // M/s added to income (positive = gain, 0 if spots full)
  energyDelta?: number        // E/s net change after completion (production minus upkeep)
  buildPowerDelta?: number    // Build power added (>0 = builder/factory)
  metalStorageDelta?: number  // Metal storage capacity added
  energyStorageDelta?: number // Energy storage capacity added
  converterCapacity?: number  // E/s capacity of an energy→metal converter
  converterMetalPerSec?: number // M/s the converter produces at full capacity
}

/** State of one builder at a specific snapshot time (display runs only) */
export interface BuilderTimelineEntry {
  builderId: string
  builderName: string
  taskUnitId: string | null       // unit being built (null = idle)
  taskUnitName: string | null
  progressFraction: number        // 0–1, how complete the current task is
  metalDemandRate: number         // M/s this builder is consuming at this moment
  energyDemandRate: number        // E/s this builder is consuming at this moment
  bpUtilization: number           // 0–1 fraction of build-power actually applied (1.0 = full speed, <1 = resource stall, 0 = idle)
}

export interface BuilderTimelineSnapshot {
  timeSeconds: number
  builders: BuilderTimelineEntry[]
}

export interface SimResult {
  snapshots: SimSnapshot[]                   // one per snapshotTime
  /** All unit completions in order.  Index [0..snapshot.completedCount) gives completions up to that snapshot. */
  completedUnitIds: string[]
  buildTimeline: BuildEvent[]                // ordered completions (populated only in display runs)
  builderTimeline: BuilderTimelineSnapshot[] // per-builder state at each snapshot (display runs only)
  isValid: boolean
}

// ── GA ────────────────────────────────────────────────────────────────────────

export interface Chromosome { genes: string[]; fitness: number }

/**
 * Controls which units are included in the optimizer's build-order pool.
 * "include*" flags are OFF by default (packs not included unless opted in).
 * "exclude*" flags are OFF by default (categories allowed unless opted out).
 */
export interface UnitPoolFilters {
  // ── Game-mode packs (OFF = not in pool) ──────────────────────────────────
  includeExtraUnits: boolean      // extra units pack (experimentalextraunits)
  includeScavengers: boolean      // scavenger units for players (scavunitsforplayers)
  // ── Tech levels (OFF = allowed) ───────────────────────────────────────────
  excludeTech15: boolean          // Advanced T1 buildings (require T1 constructor)
  excludeTech2: boolean           // T2 units
  excludeTech3: boolean           // T3 / Experimental units
  // ── Unit types (OFF = allowed) ────────────────────────────────────────────
  excludeAir: boolean
  excludeNaval: boolean           // Ships, submarines, hovercraft (default true for land maps)
  // ── Building categories (OFF = allowed) ──────────────────────────────────
  excludeDefenses: boolean
  excludeMetalExtractors: boolean
  excludeEnergyConverters: boolean
  excludeFusion: boolean
  excludeTacticalMissiles: boolean  // incl. EMP platforms
  excludeNuclearMissiles: boolean
  excludeAntiNuke: boolean
  excludeLongRangeArtillery: boolean
  excludeEndgameArtillery: boolean
}

/**
 * All tunable constants that drive the sanity-adjustment portion of fitness scoring.
 * Each value maps 1:1 to a hardcoded magic number in evaluateFitness().
 */
export interface FitnessWeights {
  // 1. Implicit eco bonus — M/s × multiplier added to score
  ecoBonus: number              // default 0.01
  // 2. Economic throughput — total-metal-spent × multiplier
  throughputBonus: number       // default 0.00005
  // 3. Metal banking penalty — triggers when avg(currentMetal/metalCap) > threshold
  bankingThreshold: number      // default 0.85  (fraction, 0–1)
  bankingPenaltyMax: number     // default 0.25  (max score penalty)
  // 4. Energy coverage bonus — gradient based on energyIncome/totalBuildPower ratio
  energyCoverageThreshold: number  // default 0.2  (E/s per BP — below this no bonus)
  energyCoverageBonus: number      // default 0.15 (max bonus at threshold, scales linearly)
  // 9. Energy deficit penalty — penalises chronic negative energy balance
  //    avgEnergyFill = avg(currentEnergy/energyCap) across all snapshots; near 0 means perpetual deficit
  energyDeficitThreshold: number   // default 0.05 (fill fraction below which penalty kicks in)
  energyDeficitPenaltyMax: number  // default 0.8  (max score penalty)
  // 5. Metal waste penalty — based on wasted/(spent+wasted) fraction
  metalWasteMultiplier: number  // default 0.7   (penalty = fraction × multiplier, capped)
  metalWasteMax: number         // default 0.35
  // 6. Energy waste penalty
  energyWasteMultiplier: number // default 0.3
  energyWasteMax: number        // default 0.15
  // 7. Build-power stall penalty — fraction of BP ticks lost to resource starvation
  stallMultiplier: number       // default 1.0
  stallMax: number              // default 1.5
  // 8. Wind storage penalty — applied when wind generators outnumber available energy buffer.
  //    Formula: requiredStorage = windCount × (windAvg - windMin) × windBufferTime
  //    Penalty scales from 0 → windStoragePenaltyMax as deficit grows from 0 → requiredStorage.
  windStoragePenaltyMax: number // default 0.15
  windBufferTime: number        // default 15  (seconds of wind variation to smooth)

  // ── Goal scoring ──────────────────────────────────────────────────────────
  // 8. Overcap for continuous goals (metalIncome, energyIncome, armyMetal,
  //    unitCount, buildPower): achievement = min(actual/target, overcap).
  //    1.0 = no bonus for exceeding target. 1.5 = 50% bonus for going over.
  continuousOvercap: number     // default 1.5
  // 9. Partial credit for binary goals (building/unit/unitCategory) that are
  //    present anywhere in the gene list but NOT completed by targetTime.
  //    0 = no guidance unless completed. 0.1 = mild signal to include the unit.
  binaryPartialCredit: number   // default 0.1
}

/**
 * Full breakdown of a fitness evaluation, one value per term.
 * Returned by computeFitnessBreakdown() for visualization.
 */
export interface FitnessBreakdown {
  // Per-checkpoint: indices match the checkpoints array passed in
  checkpointAchievements: number[]   // actual ratio, 0..continuousOvercap
  checkpointScores: number[]         // achievement × weight
  totalGoalScore: number

  // Sanity-adjustment terms (positive = bonus, negative = penalty)
  ecoBonus: number
  throughputBonus: number
  bankingPenalty: number             // ≤ 0
  energyCoverageBonus: number
  metalWastePenalty: number          // ≤ 0
  energyWastePenalty: number         // ≤ 0
  stallPenalty: number               // ≤ 0
  windStoragePenalty: number         // ≤ 0
  energyDeficitPenalty: number       // ≤ 0
  totalSanityScore: number

  totalScore: number
}

/** One point in the cumulative-fitness-over-time series (used for the time chart). */
export interface CumulativeFitnessPoint {
  time: number
  goalScore: number       // locked-in checkpoint contributions so far
  sanityScore: number     // sanity adjustments based on cumulative sim data at this moment
  total: number
}

export function defaultFitnessWeights(): FitnessWeights {
  return {
    ecoBonus: 0.01,
    throughputBonus: 0.00005,
    bankingThreshold: 0.85,
    bankingPenaltyMax: 0.25,
    energyCoverageThreshold: 0.2,
    energyCoverageBonus: 0.15,
    energyDeficitThreshold: 0.05,
    energyDeficitPenaltyMax: 0.8,
    metalWasteMultiplier: 0.7,
    metalWasteMax: 0.35,
    energyWasteMultiplier: 0.3,
    energyWasteMax: 0.15,
    stallMultiplier: 1.0,
    stallMax: 1.5,
    windStoragePenaltyMax: 0.15,
    windBufferTime: 15,
    continuousOvercap: 1.5,
    binaryPartialCredit: 0.1,
  }
}

export interface OptimizerConfig {
  populationSize: number
  maxGenerations: number
  eliteCount: number
  mutationRate: number            // per-gene probability each pass
  mutationCount: number           // number of independent mutation passes per chromosome (default 1)
  explodingMutationChance: number // after each fired mutation, chance to immediately fire one more (0–0.99, default 0.05)
  crossoverRate: number
  tournamentSize: number
  maxBuildOrderLength: number
  simConfig: SimConfig
  faction: 'Armada' | 'Cortex' | 'Legion'
  checkpoints: OptimizerCheckpoint[]
  progressIntervalGenerations: number
  unitPoolFilters: UnitPoolFilters
  fitnessWeights: FitnessWeights
  seedChromosomes?: string[][]   // optional seed genes injected at the front of the initial population (e.g. "continue" from a previous run)
}

// ── Population Diagnostics ────────────────────────────────────────────────────

/** Per-generation population diagnostics reported from the worker. */
export interface PopulationStats {
  // Fitness distribution
  medianFitness: number
  worstFitness: number
  fitnessStdDev: number

  // Population diversity
  uniqueChromosomeCount: number      // chromosomes with distinct gene sequences
  avgChromosomeLength: number        // mean genes.length across population
  avgPairwiseDistance: number         // sampled Jaccard distance between random pairs

  // Goal tracking
  goalAchievementRates: number[]     // per-checkpoint: fraction of population achieving it (0-1)

  // GA health
  stagnationCounter: number          // generations since bestEver improved
  goalArchiveSize: number            // how many goal units have archived chromosomes
  improvementCount: number           // total times bestEver was updated across the run
}

// ── Worker Protocol ───────────────────────────────────────────────────────────

export interface WorkerStartMessage { type: 'start'; config: OptimizerConfig; units: Unit[] }
export interface WorkerStopMessage  { type: 'stop' }
export type WorkerInboundMessage = WorkerStartMessage | WorkerStopMessage

export interface WorkerProgressMessage {
  type: 'progress'
  generation: number
  bestFitness: number
  averageFitness: number
  bestChromosome: Chromosome
  elapsedMs: number
  stats: PopulationStats
}
export interface WorkerResultMessage {
  type: 'result'
  bestChromosome: Chromosome
  simResult: SimResult
  totalGenerations: number
  elapsedMs: number
}
export type WorkerOutboundMessage = WorkerProgressMessage | WorkerResultMessage

// ── Saved Build ───────────────────────────────────────────────────────────────

/** A complete snapshot of all optimizer settings + optional best result, persisted to localStorage or file. */
export interface SavedBuild {
  id: string          // unique ID (timestamp + random)
  name: string        // user-chosen display name
  createdAt: string   // ISO timestamp
  faction: Faction
  checkpoints: OptimizerCheckpoint[]
  // Map / sim settings
  metalSpots: number
  metalPerSpot: number
  geoSpots: number
  windAvg: number
  windMin: number
  windMax: number
  tidalStrength: number
  durationInput: number
  startingMetal: number
  startingEnergy: number
  startingMetalStorage: number
  startingEnergyStorage: number
  commanderBuildpower: number
  commanderBaseMetalIncome: number
  commanderEnergyIncome: number
  additionalStartingUnitIds: string[]
  // GA config
  populationSize: number
  maxGenerations: number
  mutationRate: number
  mutationCount: number
  explodingMutationChance: number
  eliteCount: number
  tournamentSize: number
  maxBuildOrderLength: number
  // Unit pool & fitness
  unitPoolFilters: UnitPoolFilters
  fitnessWeights: FitnessWeights
  // Optional: best chromosome (allows "Continue" after loading)
  bestGenes?: string[]
  bestFitness?: number
}
