<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted, watch } from 'vue'
import { Line, Bar } from 'vue-chartjs'
import {
  Chart,
  CategoryScale,
  LinearScale,
  BarController,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { useUnitStore } from '../../stores/unitStore'
import type {
  Unit,
  OptimizerCheckpoint,
  OptimizerConfig,
  FitnessWeights,
  FitnessBreakdown,
  CumulativeFitnessPoint,
  PopulationStats,
  UnitPoolFilters,
  UnitCategoryId,
  WorkerOutboundMessage,
  WorkerProgressMessage,
  WorkerResultMessage,
  SimResult,
  SimSnapshot,
  BuilderTimelineSnapshot,
  Faction,
  SavedBuild,
} from '../../types'
import { defaultFitnessWeights } from '../../types'
import { getDefaultSimConfig, simulateBuildOrder, buildUnitIndex, buildBuilderCapabilities, getFullFidelitySimConfig, isReclaimGene, getReclaimTargetId, BASE_T1_MEX_RATE } from '../../services/economySimulator'
import { isUnitExcluded, matchesUnitCategory, UNIT_CATEGORY_LABELS, isWindGenerator, isTidalGenerator, isGeothermal } from '../../services/unitCategories'
import { computeFitnessBreakdown, computeCumulativeFitness, buildPrerequisiteMap } from '../../services/buildOrderOptimizer'
import UnitDetail from '../UnitBrowser/UnitDetail.vue'

Chart.register(CategoryScale, LinearScale, BarController, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler)

// ── Constants ─────────────────────────────────────────────────────────────────

const COMMANDER_IDS: Record<string, string> = {
  Armada: 'armcom',
  Cortex: 'corcom',
  Legion: 'legcom',
}

const darkChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af' } },
    tooltip: { mode: 'index' as const, intersect: false },
  },
  scales: {
    x: { ticks: { color: '#6b7280' }, grid: { color: '#374151' } },
    y: { ticks: { color: '#6b7280' }, grid: { color: '#374151' } },
  },
}

// ── State ─────────────────────────────────────────────────────────────────────

const unitStore = useUnitStore()

const faction = ref<Faction>('Armada')
const factionWarning = ref('')
const checkpoints = ref<OptimizerCheckpoint[]>([])

// Map settings
const metalSpots = ref(5)
const metalPerSpot = ref(1.8)
const geoSpots = ref(1)
const windAvg = ref(12.5)
const windMin = ref(5)
const windMax = ref(25)
const tidalStrength = ref(25)
const durationInput = ref(720)
const startingMetal = ref(1000)
const startingEnergy = ref(1000)
// Storage caps: how much metal/energy can be held at once.
// Starts equal to starting resources (commander + game defaults hold the starting stockpile).
// As metal/energy storage buildings (armmstor, armestor…) complete in-sim, caps grow.
const startingMetalStorage = ref(1000)
const startingEnergyStorage = ref(1000)

// Commander stats
const commanderBuildpower = ref(300)
const commanderBaseMetalIncome = ref(2)
const commanderEnergyIncome = ref(20)

// Additional starting builders (unit IDs from the data, beyond the virtual commander)
const additionalStartingUnitIds = ref<string[]>([])
const showAddBuilderModal = ref(false)
const builderSearch = ref('')

// Collapsible sections
const showMapSettings = ref(false)
const showStartingUnits = ref(false)

// Advanced GA settings
const showAdvanced = ref(false)
const populationSize = ref(100)
const maxGenerations = ref(600)
const mutationRate = ref(0.08)
const mutationCount = ref(1)
const explodingMutationChance = ref(0.05)
const eliteCount = ref(8)
const tournamentSize = ref(4)
const maxBuildOrderLength = ref(40)
const showUnitPoolFilters = ref(false)
const showFitnessWeights = ref(false)
const fitnessWeights = reactive<FitnessWeights>(defaultFitnessWeights())
const unitPoolFilters = reactive<UnitPoolFilters>({
  includeExtraUnits: false,
  includeScavengers: false,
  excludeTech15: false,
  excludeTech2: false,
  excludeTech3: false,
  excludeAir: false,
  excludeNaval: true,
  excludeDefenses: false,
  excludeMetalExtractors: false,
  excludeEnergyConverters: false,
  excludeFusion: false,
  excludeTacticalMissiles: false,
  excludeNuclearMissiles: false,
  excludeAntiNuke: false,
  excludeLongRangeArtillery: false,
  excludeEndgameArtillery: false,
})

// Status
type Status = 'idle' | 'running' | 'done'
const status = ref<Status>('idle')
const progressHistory = ref<WorkerProgressMessage[]>([])
const result = ref<WorkerResultMessage | null>(null)
const displayResult = ref<SimResult | null>(null)

// Time-since-last-improvement tracking
const lastImprovementFitness = ref(-Infinity)
const lastImprovementWallTime = ref(0)
const timeSinceLastImprovementMs = ref(0)
let improvementTimerRef: ReturnType<typeof setInterval> | null = null

// Seed for "Continue" — best genes from a previous run
const seedForContinue = ref<string[] | null>(null)

// Builder timeline playback
const timelineTime = ref(0)      // current scrub position in seconds
const timelinePlaying = ref(false)
let timelineTimer: ReturnType<typeof setInterval> | null = null

// Worker
const worker = ref<Worker | null>(null)

// Add/Edit Goal Modal
const showAddGoalModal = ref(false)
const editingGoalIndex = ref<number | null>(null)
const newGoalType = ref<OptimizerCheckpoint['type']>('metalIncome')
const newGoalTime = ref(90)
const newGoalValue = ref(8)
const newGoalUnitId = ref('')
const newGoalCount = ref(1)
const newGoalCategoryId = ref<UnitCategoryId>('anyT2Factory')
const newGoalWeight = ref(1.0)
const newGoalRole = ref<'ground' | 'air'>('ground')
const newGoalMinFraction = ref(0.8)
const unitSearch = ref('')

// Unit detail popup from build order
const selectedBuildOrderUnit = ref<Unit | null>(null)

// ── Field defaults (for reset buttons) ────────────────────────────────────────

const FIELD_DEFAULTS = {
  metalSpots: 5, metalPerSpot: 1.8, geoSpots: 1,
  windAvg: 12.5, windMin: 5, windMax: 25, tidalStrength: 25,
  durationInput: 720, startingMetal: 1000, startingEnergy: 1000,
  startingMetalStorage: 1000, startingEnergyStorage: 1000,
  commanderBuildpower: 300, commanderBaseMetalIncome: 2, commanderEnergyIncome: 20,
  populationSize: 100, maxGenerations: 600, mutationRate: 0.08, mutationCount: 1,
  explodingMutationChance: 0.05, eliteCount: 8, tournamentSize: 4, maxBuildOrderLength: 40,
} as const

const DEFAULT_FITNESS = defaultFitnessWeights()

// ── Saved builds ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'bar-analyzer:saved-builds'
const savedBuilds = ref<SavedBuild[]>([])
const showSavedBuildsModal = ref(false)
const saveNameInput = ref('')
function loadSavedBuildsFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    savedBuilds.value = raw ? JSON.parse(raw) : []
  } catch { savedBuilds.value = [] }
}

function persistSavedBuilds() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedBuilds.value))
}

function saveCurrentBuild() {
  const name = saveNameInput.value.trim()
    || `${faction.value} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  const build: SavedBuild = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    createdAt: new Date().toISOString(),
    faction: faction.value,
    checkpoints: JSON.parse(JSON.stringify(checkpoints.value)),
    metalSpots: metalSpots.value, metalPerSpot: metalPerSpot.value, geoSpots: geoSpots.value,
    windAvg: windAvg.value, windMin: windMin.value, windMax: windMax.value,
    tidalStrength: tidalStrength.value, durationInput: durationInput.value,
    startingMetal: startingMetal.value, startingEnergy: startingEnergy.value,
    startingMetalStorage: startingMetalStorage.value, startingEnergyStorage: startingEnergyStorage.value,
    commanderBuildpower: commanderBuildpower.value,
    commanderBaseMetalIncome: commanderBaseMetalIncome.value,
    commanderEnergyIncome: commanderEnergyIncome.value,
    additionalStartingUnitIds: [...additionalStartingUnitIds.value],
    populationSize: populationSize.value, maxGenerations: maxGenerations.value,
    mutationRate: mutationRate.value, mutationCount: mutationCount.value,
    explodingMutationChance: explodingMutationChance.value,
    eliteCount: eliteCount.value, tournamentSize: tournamentSize.value,
    maxBuildOrderLength: maxBuildOrderLength.value,
    unitPoolFilters: JSON.parse(JSON.stringify(unitPoolFilters)),
    fitnessWeights: JSON.parse(JSON.stringify(fitnessWeights)),
    ...(result.value
      ? { bestGenes: [...result.value.bestChromosome.genes], bestFitness: result.value.bestChromosome.fitness }
      : {}),
  }
  savedBuilds.value.unshift(build)
  persistSavedBuilds()
  saveNameInput.value = ''
  showSavedBuildsModal.value = false
}

function loadBuild(build: SavedBuild) {
  try {
    faction.value = build.faction
    checkpoints.value = JSON.parse(JSON.stringify(build.checkpoints ?? []))
    metalSpots.value = build.metalSpots ?? FIELD_DEFAULTS.metalSpots
    metalPerSpot.value = build.metalPerSpot ?? FIELD_DEFAULTS.metalPerSpot
    geoSpots.value = build.geoSpots ?? FIELD_DEFAULTS.geoSpots
    windAvg.value = build.windAvg ?? FIELD_DEFAULTS.windAvg
    windMin.value = build.windMin ?? FIELD_DEFAULTS.windMin
    windMax.value = build.windMax ?? FIELD_DEFAULTS.windMax
    tidalStrength.value = build.tidalStrength ?? FIELD_DEFAULTS.tidalStrength
    durationInput.value = build.durationInput ?? FIELD_DEFAULTS.durationInput
    startingMetal.value = build.startingMetal ?? FIELD_DEFAULTS.startingMetal
    startingEnergy.value = build.startingEnergy ?? FIELD_DEFAULTS.startingEnergy
    startingMetalStorage.value = build.startingMetalStorage ?? FIELD_DEFAULTS.startingMetalStorage
    startingEnergyStorage.value = build.startingEnergyStorage ?? FIELD_DEFAULTS.startingEnergyStorage
    commanderBuildpower.value = build.commanderBuildpower ?? FIELD_DEFAULTS.commanderBuildpower
    commanderBaseMetalIncome.value = build.commanderBaseMetalIncome ?? FIELD_DEFAULTS.commanderBaseMetalIncome
    commanderEnergyIncome.value = build.commanderEnergyIncome ?? FIELD_DEFAULTS.commanderEnergyIncome
    additionalStartingUnitIds.value = [...(build.additionalStartingUnitIds ?? [])]
    populationSize.value = build.populationSize ?? FIELD_DEFAULTS.populationSize
    maxGenerations.value = build.maxGenerations ?? FIELD_DEFAULTS.maxGenerations
    mutationRate.value = build.mutationRate ?? FIELD_DEFAULTS.mutationRate
    mutationCount.value = build.mutationCount ?? FIELD_DEFAULTS.mutationCount
    explodingMutationChance.value = build.explodingMutationChance ?? FIELD_DEFAULTS.explodingMutationChance
    eliteCount.value = build.eliteCount ?? FIELD_DEFAULTS.eliteCount
    tournamentSize.value = build.tournamentSize ?? FIELD_DEFAULTS.tournamentSize
    maxBuildOrderLength.value = build.maxBuildOrderLength ?? FIELD_DEFAULTS.maxBuildOrderLength
    if (build.unitPoolFilters) Object.assign(unitPoolFilters, build.unitPoolFilters)
    if (build.fitnessWeights) Object.assign(fitnessWeights, build.fitnessWeights)
    if (build.bestGenes) {
      seedForContinue.value = [...build.bestGenes]
      // Re-run display-fidelity sim so the results panel shows the saved build order
      const baseSimConfig = getDefaultSimConfig()
      const simConfig = {
        ...baseSimConfig,
        startingMetal: build.startingMetal,
        startingEnergy: build.startingEnergy,
        startingMetalStorage: build.startingMetalStorage,
        startingEnergyStorage: build.startingEnergyStorage,
        commanderUnitId: COMMANDER_IDS[build.faction] ?? 'armcom',
        commanderBuildpower: build.commanderBuildpower,
        commanderMetalIncome: build.commanderBaseMetalIncome,
        commanderEnergyIncome: build.commanderEnergyIncome,
        windAvg: build.windAvg,
        windMin: build.windMin,
        windMax: build.windMax,
        tidalStrength: build.tidalStrength,
        maxMetalSpots: build.metalSpots,
        metalPerSpot: build.metalPerSpot,
        maxGeoSpots: build.geoSpots,
        additionalStartingUnitIds: [...(build.additionalStartingUnitIds ?? [])],
        // snapshotTimes and durationSeconds derived from checkpoints
        snapshotTimes: [...new Set((build.checkpoints ?? []).map((c) => c.targetTime))].sort((a, b) => a - b),
        durationSeconds: Math.max(
          ...( (build.checkpoints ?? []).map((c) => c.targetTime).concat([build.durationInput ?? 720]) )
        ) + 10,
      }
      const unitIdx = buildUnitIndex(unitStore.units)
      const startingBuilderIds = [simConfig.commanderUnitId, ...(build.additionalStartingUnitIds ?? [])]
      const prereqMap = buildPrerequisiteMap(unitStore.units, startingBuilderIds)
      const builderCaps = buildBuilderCapabilities(prereqMap)
      const simResult = simulateBuildOrder(build.bestGenes, getFullFidelitySimConfig(simConfig), unitIdx, builderCaps)
      result.value = {
        type: 'result',
        bestChromosome: { genes: [...build.bestGenes], fitness: build.bestFitness ?? 0 },
        simResult,
        totalGenerations: 0,
        elapsedMs: 0,
      }
      displayResult.value = simResult
      status.value = 'done'
    }
    showSavedBuildsModal.value = false
  } catch (err) {
    alert('Failed to load build: ' + (err as Error).message)
  }
}

function deleteSavedBuild(id: string) {
  savedBuilds.value = savedBuilds.value.filter((b) => b.id !== id)
  persistSavedBuilds()
}

function exportBuildToFile(build: SavedBuild) {
  const blob = new Blob([JSON.stringify(build, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${build.name.replace(/[^a-z0-9]+/gi, '_')}_build.json`
  a.click()
  URL.revokeObjectURL(url)
}

function importBuildFromFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const build = JSON.parse(reader.result as string) as SavedBuild
      if (!build.faction || !Array.isArray(build.checkpoints)) throw new Error('Invalid save format')
      build.id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      savedBuilds.value.unshift(build)
      persistSavedBuilds()
    } catch (err) {
      alert('Import failed: ' + (err as Error).message)
    }
  }
  reader.readAsText(file)
  ;(e.target as HTMLInputElement).value = ''
}

// ── Computed ──────────────────────────────────────────────────────────────────

const factionUnits = computed(() => unitStore.units.filter((u) => u.faction === faction.value))

const buildableUnits = computed(() =>
  factionUnits.value.filter((u) => !u.isCommander && !u.isMorph),
)

const filteredUnits = computed(() => {
  const q = unitSearch.value.toLowerCase()
  if (!q) return buildableUnits.value
  return buildableUnits.value.filter(
    (u) => u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q),
  )
})

const snapshotTimes = computed(() => {
  const times = [...new Set(checkpoints.value.map((c) => c.targetTime))].sort((a, b) => a - b)
  return times.length > 0 ? times : [durationInput.value]
})

const effectiveDuration = computed(() => {
  const maxT = Math.max(...snapshotTimes.value)
  return Math.max(maxT + 10, durationInput.value)
})

const needsUnitPicker = computed(
  () =>
    newGoalType.value === 'building' ||
    newGoalType.value === 'unit' ||
    newGoalType.value === 'unitCount',
)

const needsCategoryPicker = computed(() => newGoalType.value === 'unitCategory')
const needsRolePicker = computed(() => newGoalType.value === 'armyComposition')

const unitCategoryOptions: Array<{ id: UnitCategoryId; label: string }> = Object.entries(
  UNIT_CATEGORY_LABELS,
).map(([id, label]) => ({ id: id as UnitCategoryId, label }))

const needsCount = computed(() => newGoalType.value === 'unitCount')
const needsMinFraction = computed(() => newGoalType.value === 'armyComposition')

// (spots are now a sim constraint, not pre-added to commander income)
const metalIncomeFromSpots = computed(() => metalSpots.value * metalPerSpot.value)

/** True when at least one goal's targetTime exceeds the manually-set duration.
 *  (The sim auto-extends effectiveDuration to cover all goals, but we warn the user
 *  that their Duration field is set lower than needed.) */
const goalsExceedDuration = computed(() =>
  checkpoints.value.some((cp) => cp.targetTime > durationInput.value),
)
function goalExceedsDuration(cp: OptimizerCheckpoint): boolean {
  return cp.targetTime > durationInput.value
}

// Faction units that have buildPower > 0 and aren't the virtual commander — for adding as starting builders
const buildersInFaction = computed(() =>
  factionUnits.value.filter(
    (u) => (u.buildPower ?? 0) > 0 && u.unitType !== 'Commander',
  ),
)

const filteredBuilders = computed(() => {
  const q = builderSearch.value.toLowerCase()
  if (!q) return buildersInFaction.value
  return buildersInFaction.value.filter(
    (u) => u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q),
  )
})

// ── Charts ────────────────────────────────────────────────────────────────────

const resourceChartData = computed(() => {
  if (!displayResult.value) return null
  const snaps = displayResult.value.snapshots
  const labels = snaps.map((s) => `${s.timeSeconds}s`)
  return {
    labels,
    datasets: [
      {
        label: 'Metal',
        data: snaps.map((s) => s.currentMetal),
        borderColor: '#60a5fa',
        backgroundColor: 'rgba(96,165,250,0.1)',
        tension: 0.3,
        fill: true,
        pointRadius: 0,
      },
      {
        label: 'Metal Cap',
        data: snaps.map((s) => s.metalCap),
        borderColor: '#3b82f6',
        borderDash: [4, 4],
        borderWidth: 1,
        tension: 0.1,
        fill: false,
        pointRadius: 0,
      },
      {
        label: 'Energy',
        data: snaps.map((s) => s.currentEnergy),
        borderColor: '#fbbf24',
        backgroundColor: 'rgba(251,191,36,0.1)',
        tension: 0.3,
        fill: true,
        pointRadius: 0,
      },
      {
        label: 'Energy Cap',
        data: snaps.map((s) => s.energyCap),
        borderColor: '#d97706',
        borderDash: [4, 4],
        borderWidth: 1,
        tension: 0.1,
        fill: false,
        pointRadius: 0,
      },
    ],
  }
})

/** Derive per-second rate from a cumulative snapshot array. */
function derivedRates(snaps: SimSnapshot[], getValue: (s: SimSnapshot) => number): number[] {
  return snaps.map((s, i) => {
    if (i === 0) return s.timeSeconds > 0 ? +(getValue(s) / s.timeSeconds).toFixed(3) : 0
    const dt = s.timeSeconds - snaps[i - 1].timeSeconds
    return dt > 0 ? +((getValue(s) - getValue(snaps[i - 1])) / dt).toFixed(3) : 0
  })
}

const metalFlowChartData = computed(() => {
  if (!displayResult.value) return null
  const snaps = displayResult.value.snapshots
  const labels = snaps.map((s) => `${s.timeSeconds}s`)
  const incomeData = snaps.map((s) => +s.metalIncome.toFixed(3))
  const convData = converterRates(snaps)
  const expenseData = derivedRates(snaps, (s) => s.totalMetalSpent)
  const deltaData = incomeData.map((inc, i) => +(inc + convData[i] - expenseData[i]).toFixed(3))
  const hasConverters = convData.some((v) => v > 0)
  return {
    labels,
    datasets: [
      { label: 'Income (M/s)',    data: incomeData,  borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.05)',  tension: 0.2, fill: true, pointRadius: 0 },
      ...(hasConverters ? [{ label: 'Converter (M/s)', data: convData, borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.08)', tension: 0.2, fill: true, pointRadius: 0 }] : []),
      { label: 'Expense (M/s)',   data: expenseData, borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.05)', tension: 0.2, fill: true, pointRadius: 0 },
      { label: 'Δ (M/s)',         data: deltaData,   borderColor: '#67e8f9', borderDash: [3, 3], borderWidth: 1.5,       tension: 0.2, fill: false, pointRadius: 0 },
    ],
  }
})

const energyFlowChartData = computed(() => {
  if (!displayResult.value) return null
  const snaps = displayResult.value.snapshots
  const labels = snaps.map((s) => `${s.timeSeconds}s`)
  const incomeData = snaps.map((s) => +s.energyIncome.toFixed(3))
  const expenseData = derivedRates(snaps, (s) => s.totalEnergySpent)
  const deltaData = incomeData.map((inc, i) => +(inc - expenseData[i]).toFixed(3))
  return {
    labels,
    datasets: [
      { label: 'Income (E/s)',  data: incomeData,  borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.05)',  tension: 0.2, fill: true, pointRadius: 0 },
      { label: 'Expense (E/s)', data: expenseData, borderColor: '#fbbf24', backgroundColor: 'rgba(251,191,36,0.05)', tension: 0.2, fill: true, pointRadius: 0 },
      { label: 'Δ (E/s)',       data: deltaData,   borderColor: '#818cf8', borderDash: [3, 3], borderWidth: 1.5,       tension: 0.2, fill: false, pointRadius: 0 },
    ],
  }
})

const metalSpentChartData = computed(() => {
  if (!displayResult.value) return null
  const snaps = displayResult.value.snapshots
  const labels = snaps.map((s) => `${s.timeSeconds}s`)
  return {
    labels,
    datasets: [
      {
        label: 'Total Metal Spent',
        data: snaps.map((s) => +s.totalMetalSpent.toFixed(0)),
        borderColor: '#e2e8f0',
        tension: 0.3,
        pointRadius: 0,
      },
      {
        label: 'Current Army Metal',
        data: snaps.map((s) => +s.currentArmyMetal.toFixed(0)),
        borderColor: '#f87171',
        tension: 0.3,
        pointRadius: 0,
      },
    ],
  }
})

const fitnessChartData = computed(() => {
  if (progressHistory.value.length === 0) return null
  const labels = progressHistory.value.map((p) => String(p.generation))
  const improvementRate = progressHistory.value.map((p, i) =>
    i === 0
      ? 0
      : +(p.bestFitness - progressHistory.value[i - 1].bestFitness).toFixed(6),
  )
  return {
    labels,
    datasets: [
      {
        label: 'Best Fitness',
        data: progressHistory.value.map((p) => +p.bestFitness.toFixed(4)),
        borderColor: '#4ade80',
        tension: 0.3,
        pointRadius: 0,
        yAxisID: 'y',
      },
      {
        label: 'Avg Fitness',
        data: progressHistory.value.map((p) => +p.averageFitness.toFixed(4)),
        borderColor: '#94a3b8',
        tension: 0.3,
        pointRadius: 0,
        yAxisID: 'y',
      },
      {
        label: 'Improvement Rate',
        data: improvementRate,
        borderColor: '#facc15',
        backgroundColor: 'rgba(250,204,21,0.08)',
        tension: 0.3,
        pointRadius: 0,
        yAxisID: 'y1',
        fill: true,
      },
    ],
  }
})

const fitnessChartOptions = computed(() => ({
  ...darkChartOptions,
  scales: {
    ...darkChartOptions.scales,
    y1: {
      type: 'linear' as const,
      display: true,
      position: 'right' as const,
      grid: { drawOnChartArea: false },
      ticks: { color: '#facc15' },
      title: { display: true, text: 'Improvement', color: '#facc15', font: { size: 10 } },
    },
  },
}))

// ── Checkpoint Achievements ───────────────────────────────────────────────────

const checkpointAchievements = computed(() => {
  if (!result.value) return []
  const simResult = result.value.simResult
  return checkpoints.value.map((cp) => {
    const snapshot = simResult.snapshots.find((s) => s.timeSeconds >= cp.targetTime)
    if (!snapshot) return { cp, achieved: false, actual: 0, target: 0, label: '' }

    let actual = 0
    let target = 0
    let label = ''
    let achieved = false

    switch (cp.type) {
      case 'metalIncome':
        actual = snapshot.metalIncome
        target = cp.targetValue
        achieved = actual >= target
        label = `Metal income: ${actual.toFixed(2)} / ${target} M/s`
        break
      case 'energyIncome':
        actual = snapshot.energyIncome
        target = cp.targetValue
        achieved = actual >= target
        label = `Energy income: ${actual.toFixed(1)} / ${target} E/s`
        break
      case 'armyMetal':
        actual = snapshot.currentArmyMetal
        target = cp.targetValue
        achieved = actual >= target
        label = `Army metal (alive): ${actual.toFixed(0)} / ${target} M`
        break
      case 'armyDps':
        actual = snapshot.currentArmyDps
        target = cp.targetValue
        achieved = actual >= target
        label = `Army DPS: ${actual.toFixed(1)} / ${target}`
        break
      case 'armyHealth':
        actual = snapshot.currentArmyHealth
        target = cp.targetValue
        achieved = actual >= target
        label = `Army health: ${actual.toFixed(0)} / ${target}`
        break
      case 'armyComposition': {
        const roleDps = cp.role === 'ground'
          ? snapshot.currentArmyGroundDps
          : snapshot.currentArmyDps - snapshot.currentArmyGroundDps
        actual = snapshot.currentArmyDps > 0 ? roleDps / snapshot.currentArmyDps : 0
        target = cp.minFraction
        achieved = actual >= target
        const pct = (actual * 100).toFixed(0)
        const tpct = (target * 100).toFixed(0)
        label = `Army ${cp.role}: ${pct}% / ${tpct}% of DPS`
        break
      }
      case 'building':
      case 'unit': {
        const unitName = unitStore.units.find((u) => u.id === cp.unitId)?.name ?? cp.unitId
        // completedUnitIds lives on SimResult; check only completions up to this snapshot
        let foundBuilding = false
        for (let ci = 0; ci < snapshot.completedCount && !foundBuilding; ci++) {
          if (simResult.completedUnitIds[ci] === cp.unitId) foundBuilding = true
        }
        achieved = foundBuilding
        label = `${cp.type === 'building' ? 'Building' : 'Unit'} ${unitName}: ${achieved ? 'completed' : 'not completed'}`
        break
      }
      case 'unitCount': {
        const unitName = unitStore.units.find((u) => u.id === cp.unitId)?.name ?? cp.unitId
        actual = snapshot.aliveUnitCounts[cp.unitId] ?? 0
        target = cp.targetCount
        achieved = actual >= target
        label = `${unitName} ×${target}: ${actual} alive`
        break
      }
      case 'buildPower': {
        actual = snapshot.totalBuildPower
        target = cp.targetValue
        achieved = actual >= target
        label = `Build power ≥ ${target}: ${actual.toFixed(0)}`
        break
      }
      case 'unitCategory': {
        const catLabel = UNIT_CATEGORY_LABELS[cp.categoryId] ?? cp.categoryId
        // Iterate only completions up to this snapshot's count
        let matchedId: string | undefined
        for (let i = 0; i < snapshot.completedCount && !matchedId; i++) {
          const id = simResult.completedUnitIds[i]
          const u = unitStore.units.find((uu) => uu.id === id)
          if (u && matchesUnitCategory(u, cp.categoryId)) matchedId = id
        }
        achieved = !!matchedId
        const matchedName = matchedId
          ? (unitStore.units.find((u) => u.id === matchedId)?.name ?? matchedId)
          : 'none'
        label = `${catLabel}: ${achieved ? matchedName : 'not completed'}`
        break
      }
    }
    return { cp, achieved, actual, target, label }
  })
})

// ── Fitness Breakdown (for visualization) ─────────────────────────────────────

const fitnessBreakdown = computed((): FitnessBreakdown | null => {
  if (!displayResult.value || !result.value) return null
  return computeFitnessBreakdown(
    displayResult.value,
    result.value.bestChromosome.genes,
    checkpoints.value,
    { ...fitnessWeights },
    (id) => unitStore.getUnit(id),
    windAvg.value,
    windMin.value,
  )
})

const cumulativeFitnessPoints = computed((): CumulativeFitnessPoint[] => {
  if (!displayResult.value || !result.value) return []
  return computeCumulativeFitness(
    displayResult.value,
    result.value.bestChromosome.genes,
    checkpoints.value,
    { ...fitnessWeights },
    (id) => unitStore.getUnit(id),
    windAvg.value,
    windMin.value,
  )
})

/** Label for each checkpoint — same logic as checkpointAchievements but just the label string. */
function cpLabel(cp: OptimizerCheckpoint, _index: number): string {
  switch (cp.type) {
    case 'metalIncome':  return `M/s ≥${cp.targetValue} @${cp.targetTime}s`
    case 'energyIncome': return `E/s ≥${cp.targetValue} @${cp.targetTime}s`
    case 'armyMetal':    return `Army ≥${cp.targetValue}M @${cp.targetTime}s`
    case 'armyDps':      return `DPS ≥${cp.targetValue} @${cp.targetTime}s`
    case 'armyHealth':   return `HP ≥${cp.targetValue} @${cp.targetTime}s`
    case 'armyComposition': return `${cp.role} ≥${Math.round(cp.minFraction * 100)}% @${cp.targetTime}s`
    case 'buildPower':   return `BP ≥${cp.targetValue} @${cp.targetTime}s`
    case 'building':
    case 'unit': {
      const name = unitStore.getUnit(cp.unitId)?.name ?? cp.unitId
      return `${name} @${cp.targetTime}s`
    }
    case 'unitCount': {
      const name = unitStore.getUnit(cp.unitId)?.name ?? cp.unitId
      return `${name} ×${cp.targetCount} @${cp.targetTime}s`
    }
    case 'unitCategory':
      return `${UNIT_CATEGORY_LABELS[cp.categoryId] ?? cp.categoryId} @${cp.targetTime}s`
  }
}

const breakdownChartData = computed(() => {
  const bd = fitnessBreakdown.value
  if (!bd) return null

  const terms: { label: string; value: number; isGoal: boolean }[] = [
    ...checkpoints.value.map((cp, i) => ({
      label: cpLabel(cp, i),
      value: +bd.checkpointScores[i].toFixed(4),
      isGoal: true,
    })),
    { label: 'Eco bonus',        value: +bd.ecoBonus.toFixed(4),            isGoal: false },
    { label: 'Throughput bonus', value: +bd.throughputBonus.toFixed(4),     isGoal: false },
    { label: 'Energy coverage',  value: +bd.energyCoverageBonus.toFixed(4), isGoal: false },
    { label: 'Metal waste',      value: +bd.metalWastePenalty.toFixed(4),   isGoal: false },
    { label: 'Energy waste',     value: +bd.energyWastePenalty.toFixed(4),  isGoal: false },
    { label: 'Metal banking',    value: +bd.bankingPenalty.toFixed(4),      isGoal: false },
    { label: 'BP stall',         value: +bd.stallPenalty.toFixed(4),        isGoal: false },
    { label: 'Wind storage',     value: +bd.windStoragePenalty.toFixed(4),  isGoal: false },
    { label: 'Energy deficit',   value: +bd.energyDeficitPenalty.toFixed(4), isGoal: false },
  ]

  return {
    labels: terms.map((t) => t.label),
    datasets: [{
      label: 'Score contribution',
      data: terms.map((t) => t.value),
      backgroundColor: terms.map((t) => {
        if (t.value < 0)     return 'rgba(248,113,113,0.75)'   // red — penalty
        if (t.isGoal)        return 'rgba(96,165,250,0.75)'    // blue — goal
        return               'rgba(52,211,153,0.75)'           // green — bonus
      }),
      borderColor: terms.map((t) => {
        if (t.value < 0) return '#f87171'
        if (t.isGoal)    return '#60a5fa'
        return           '#34d399'
      }),
      borderWidth: 1,
    }],
  }
})

const cumulativeFitnessChartData = computed(() => {
  const pts = cumulativeFitnessPoints.value
  if (!pts.length) return null
  // Downsample to at most 360 points for performance
  const step = Math.max(1, Math.floor(pts.length / 360))
  const sampled = pts.filter((_, i) => i % step === 0)
  const labels = sampled.map((p) => `${p.time}s`)
  return {
    labels,
    datasets: [
      {
        label: 'Total fitness',
        data: sampled.map((p) => +p.total.toFixed(4)),
        borderColor: '#e2e8f0',
        backgroundColor: 'rgba(226,232,240,0.05)',
        tension: 0.2,
        fill: true,
        pointRadius: 0,
        borderWidth: 2,
      },
      {
        label: 'Goal scores',
        data: sampled.map((p) => +p.goalScore.toFixed(4)),
        borderColor: '#60a5fa',
        backgroundColor: 'rgba(96,165,250,0.07)',
        tension: 0.1,
        fill: true,
        pointRadius: 0,
        borderWidth: 1.5,
        stepped: 'before' as const,
      },
      {
        label: 'Sanity adjustments',
        data: sampled.map((p) => +p.sanityScore.toFixed(4)),
        borderColor: '#34d399',
        backgroundColor: 'rgba(52,211,153,0.07)',
        tension: 0.3,
        fill: true,
        pointRadius: 0,
        borderWidth: 1.5,
      },
    ],
  }
})

// ── Worker Lifecycle ──────────────────────────────────────────────────────────

onMounted(() => {
  loadSavedBuildsFromStorage()
  worker.value = new Worker(
    new URL('../../services/optimizerWorker.ts', import.meta.url),
    { type: 'module' },
  )
  worker.value.onmessage = (e: MessageEvent<WorkerOutboundMessage | { type: 'error'; message: string }>) => {
    const msg = e.data
    if (msg.type === 'progress') {
      const p = msg as WorkerProgressMessage
      progressHistory.value.push(p)
      if (p.bestFitness > lastImprovementFitness.value) {
        lastImprovementFitness.value = p.bestFitness
        lastImprovementWallTime.value = Date.now()
        timeSinceLastImprovementMs.value = 0
      }
    } else if (msg.type === 'result') {
      result.value = msg as WorkerResultMessage
      displayResult.value = (msg as WorkerResultMessage).simResult
      status.value = 'done'
      timelineTime.value = 0
      stopTimelinePlayback()
      if (improvementTimerRef) { clearInterval(improvementTimerRef); improvementTimerRef = null }
    } else if (msg.type === 'error') {
      console.error('[optimizer] worker error:', (msg as { type: 'error'; message: string }).message)
      status.value = 'done'
      if (improvementTimerRef) { clearInterval(improvementTimerRef); improvementTimerRef = null }
    }
  }
  worker.value.onerror = (err) => {
    console.error('[optimizer] worker onerror:', err.message, err)
    status.value = 'done'
  }
})

onUnmounted(() => {
  worker.value?.terminate()
  stopTimelinePlayback()
  if (improvementTimerRef) clearInterval(improvementTimerRef)
})

// ── Actions ───────────────────────────────────────────────────────────────────

function startOptimization() {
  if (!worker.value) return
  if (unitStore.units.length === 0) {
    console.error('[optimizer] units not loaded yet')
    return
  }
  console.log('[optimizer] starting: units=', unitStore.units.length, 'faction=', faction.value)
  status.value = 'running'
  progressHistory.value = []
  result.value = null
  displayResult.value = null

  // Reset improvement tracking and start the wall-clock timer
  lastImprovementFitness.value = -Infinity
  lastImprovementWallTime.value = Date.now()
  timeSinceLastImprovementMs.value = 0
  if (improvementTimerRef) clearInterval(improvementTimerRef)
  improvementTimerRef = setInterval(() => {
    timeSinceLastImprovementMs.value = Date.now() - lastImprovementWallTime.value
  }, 500)

  const baseSimConfig = getDefaultSimConfig()
  const simConfig = {
    ...baseSimConfig,
    startingMetal: startingMetal.value,
    startingEnergy: startingEnergy.value,
    startingMetalStorage: startingMetalStorage.value,
    startingEnergyStorage: startingEnergyStorage.value,
    commanderUnitId: COMMANDER_IDS[faction.value] ?? 'armcom',
    commanderBuildpower: commanderBuildpower.value,
    commanderMetalIncome: commanderBaseMetalIncome.value,   // no spot income pre-added
    commanderEnergyIncome: commanderEnergyIncome.value,
    windAvg: windAvg.value,
    windMin: windMin.value,
    windMax: windMax.value,
    tidalStrength: tidalStrength.value,
    maxMetalSpots: metalSpots.value,
    metalPerSpot: metalPerSpot.value,
    maxGeoSpots: geoSpots.value,
    durationSeconds: effectiveDuration.value,
    snapshotTimes: snapshotTimes.value,
    additionalStartingUnitIds: [...additionalStartingUnitIds.value],
  }

  const config: OptimizerConfig = {
    populationSize: populationSize.value,
    maxGenerations: maxGenerations.value,
    eliteCount: eliteCount.value,
    mutationRate: mutationRate.value,
    mutationCount: mutationCount.value,
    explodingMutationChance: Math.min(0.99, Math.max(0, explodingMutationChance.value)),
    crossoverRate: 0.7,
    tournamentSize: tournamentSize.value,
    maxBuildOrderLength: maxBuildOrderLength.value,
    simConfig,
    faction: faction.value,
    checkpoints: checkpoints.value,
    progressIntervalGenerations: 10,
    unitPoolFilters: { ...unitPoolFilters },
    fitnessWeights: { ...fitnessWeights },
    ...(seedForContinue.value ? { seedChromosomes: [seedForContinue.value] } : {}),
  }
  seedForContinue.value = null  // consumed — clear it so a fresh Optimize doesn't re-use it

  // JSON round-trip strips all Vue reactive Proxies from the entire payload.
  // config.checkpoints and any nested reactive arrays would otherwise cause DataCloneError.
  const payload = JSON.parse(
    JSON.stringify({ type: 'start', config, units: unitStore.units }),
  )
  worker.value.postMessage(payload)
}

function continueOptimization() {
  if (!result.value) return
  seedForContinue.value = [...result.value.bestChromosome.genes]
  startOptimization()
}

function stopOptimization() {
  if (!worker.value) return
  worker.value.postMessage({ type: 'stop' })
  // Result will arrive via onmessage when the worker finishes its current generation
}

function playTimeline() {
  if (timelinePlaying.value) return
  if (timelineTime.value >= timelineMaxTime.value) {
    timelineTime.value = 0
  }
  timelinePlaying.value = true
  timelineTimer = setInterval(() => {
    // Advance 1 game-second every 200 ms (5× real-time)
    timelineTime.value = Math.min(timelineTime.value + 1, timelineMaxTime.value)
    if (timelineTime.value >= timelineMaxTime.value) {
      stopTimelinePlayback()
    }
  }, 200)
}

function stopTimelinePlayback() {
  timelinePlaying.value = false
  if (timelineTimer !== null) {
    clearInterval(timelineTimer)
    timelineTimer = null
  }
}

function openAddGoalModal() {
  editingGoalIndex.value = null
  newGoalType.value = 'metalIncome'
  newGoalTime.value = 90
  newGoalValue.value = 8
  newGoalUnitId.value = ''
  newGoalCount.value = 1
  newGoalCategoryId.value = 'anyT2Factory'
  newGoalWeight.value = 1.0
  unitSearch.value = ''
  showAddGoalModal.value = true
}

function openEditGoalModal(idx: number) {
  const cp = checkpoints.value[idx]
  editingGoalIndex.value = idx
  newGoalType.value = cp.type
  newGoalTime.value = cp.targetTime
  newGoalWeight.value = cp.weight
  newGoalUnitId.value = ''
  newGoalCount.value = 1
  newGoalValue.value = 0
  unitSearch.value = ''
  if (cp.type === 'metalIncome' || cp.type === 'energyIncome' || cp.type === 'armyMetal' ||
      cp.type === 'buildPower' || cp.type === 'armyDps' || cp.type === 'armyHealth') {
    newGoalValue.value = cp.targetValue
  } else if (cp.type === 'building' || cp.type === 'unit') {
    newGoalUnitId.value = cp.unitId
  } else if (cp.type === 'unitCount') {
    newGoalUnitId.value = cp.unitId
    newGoalCount.value = cp.targetCount
  } else if (cp.type === 'unitCategory') {
    newGoalCategoryId.value = cp.categoryId
  } else if (cp.type === 'armyComposition') {
    newGoalRole.value = cp.role
    newGoalMinFraction.value = cp.minFraction
  }
  showAddGoalModal.value = true
}

function addGoal() {
  const base = {
    targetTime: newGoalTime.value,
    weight: newGoalWeight.value,
  }

  let cp: OptimizerCheckpoint
  if (newGoalType.value === 'metalIncome') {
    cp = { type: 'metalIncome', ...base, targetValue: newGoalValue.value }
  } else if (newGoalType.value === 'energyIncome') {
    cp = { type: 'energyIncome', ...base, targetValue: newGoalValue.value }
  } else if (newGoalType.value === 'armyMetal') {
    cp = { type: 'armyMetal', ...base, targetValue: newGoalValue.value }
  } else if (newGoalType.value === 'armyDps') {
    cp = { type: 'armyDps', ...base, targetValue: newGoalValue.value }
  } else if (newGoalType.value === 'armyHealth') {
    cp = { type: 'armyHealth', ...base, targetValue: newGoalValue.value }
  } else if (newGoalType.value === 'armyComposition') {
    cp = { type: 'armyComposition', ...base, role: newGoalRole.value, minFraction: newGoalMinFraction.value }
  } else if (newGoalType.value === 'buildPower') {
    cp = { type: 'buildPower', ...base, targetValue: newGoalValue.value }
  } else if (newGoalType.value === 'building') {
    if (!newGoalUnitId.value) return
    cp = { type: 'building', ...base, unitId: newGoalUnitId.value }
  } else if (newGoalType.value === 'unitCount') {
    if (!newGoalUnitId.value) return
    cp = { type: 'unitCount', ...base, unitId: newGoalUnitId.value, targetCount: newGoalCount.value }
  } else if (newGoalType.value === 'unitCategory') {
    cp = { type: 'unitCategory', ...base, categoryId: newGoalCategoryId.value }
  } else {
    if (!newGoalUnitId.value) return
    cp = { type: 'unit', ...base, unitId: newGoalUnitId.value }
  }

  if (editingGoalIndex.value !== null) {
    checkpoints.value[editingGoalIndex.value] = cp
  } else {
    checkpoints.value.push(cp)
  }
  showAddGoalModal.value = false
  newGoalUnitId.value = ''
  unitSearch.value = ''
  editingGoalIndex.value = null
}

const showPresets = ref(false)

/** Pre-built strategy presets — each replaces/appends checkpoints. */
const PRESETS: Array<{ label: string; desc: string; goals: OptimizerCheckpoint[] }> = [
  // ── Eco / expansion ──────────────────────────────────────────────────────
  {
    label: 'Eco Ramp',
    desc: 'Maximise metal income as quickly as possible. Good starting template for most strategies.',
    goals: [
      { type: 'metalIncome', targetTime: 120, targetValue: 5,   weight: 1.5 },
      { type: 'metalIncome', targetTime: 300, targetValue: 10,  weight: 2.0 },
      { type: 'metalIncome', targetTime: 480, targetValue: 16,  weight: 2.0 },
      { type: 'buildPower',  targetTime: 180, targetValue: 500, weight: 1.0 },
    ],
  },
  {
    label: 'Team Eco Specialist',
    desc: 'Team-game eco player: maximise metal income and build power while keeping a minimal defensive army.',
    goals: [
      { type: 'metalIncome', targetTime: 180, targetValue: 8,    weight: 2.0 },
      { type: 'metalIncome', targetTime: 360, targetValue: 18,   weight: 2.5 },
      { type: 'metalIncome', targetTime: 540, targetValue: 28,   weight: 2.5 },
      { type: 'buildPower',  targetTime: 240, targetValue: 800,  weight: 1.5 },
      { type: 'armyMetal',   targetTime: 360, targetValue: 500,  weight: 0.5 },
    ],
  },
  // ── Technology ────────────────────────────────────────────────────────────
  {
    label: 'T2 Rush',
    desc: 'Reach T2 factory as quickly as possible, then transition to T2 eco.',
    goals: [
      { type: 'unitCategory', targetTime: 120, categoryId: 'anyT1Constructor', weight: 2.0 },
      { type: 'unitCategory', targetTime: 360, categoryId: 'anyT2Factory',     weight: 3.0 },
      { type: 'metalIncome',  targetTime: 240, targetValue: 8,                 weight: 1.0 },
      { type: 'metalIncome',  targetTime: 480, targetValue: 14,                weight: 1.5 },
    ],
  },
  {
    label: 'Tech Rush (T3)',
    desc: 'Push straight to T3/Experimental, sacrificing early army for overwhelming late power.',
    goals: [
      { type: 'unitCategory', targetTime: 120, categoryId: 'anyT1Constructor', weight: 1.5 },
      { type: 'unitCategory', targetTime: 360, categoryId: 'anyT2Factory',     weight: 2.0 },
      { type: 'unitCategory', targetTime: 600, categoryId: 'anyT3Factory',     weight: 3.5 },
      { type: 'metalIncome',  targetTime: 360, targetValue: 12,                weight: 1.0 },
    ],
  },
  // ── Military: ground ──────────────────────────────────────────────────────
  {
    label: 'Ground Flood',
    desc: 'Maximise ground DPS fast. At least 85% of army DPS must come from ground units (bots/vehicles). Classic frontline spam.',
    goals: [
      { type: 'armyDps',         targetTime: 180, targetValue: 20,   weight: 1.5 },
      { type: 'armyDps',         targetTime: 300, targetValue: 50,   weight: 2.0 },
      { type: 'armyMetal',       targetTime: 300, targetValue: 1200, weight: 1.5 },
      { type: 'armyComposition', targetTime: 300, role: 'ground', minFraction: 0.85, weight: 2.0 },
      { type: 'metalIncome',     targetTime: 180, targetValue: 6,    weight: 1.0 },
    ],
  },
  {
    label: 'Frontline Brawl',
    desc: 'Team-game frontline role: maximise army health (tanky units) and ground DPS.',
    goals: [
      { type: 'armyHealth',      targetTime: 240, targetValue: 15000, weight: 2.0 },
      { type: 'armyDps',         targetTime: 240, targetValue: 40,    weight: 2.0 },
      { type: 'armyComposition', targetTime: 240, role: 'ground', minFraction: 0.9, weight: 1.5 },
      { type: 'metalIncome',     targetTime: 180, targetValue: 7,     weight: 1.0 },
      { type: 'armyMetal',       targetTime: 360, targetValue: 2000,  weight: 1.5 },
    ],
  },
  // ── Military: air ─────────────────────────────────────────────────────────
  {
    label: 'Air Superiority',
    desc: 'Air-focused: at least 65% of army DPS in aircraft. Build fighters early for map control.',
    goals: [
      { type: 'unitCategory',    targetTime: 120, categoryId: 'anyFighter',     weight: 2.0 },
      { type: 'armyDps',         targetTime: 300, targetValue: 30,  weight: 2.0 },
      { type: 'armyComposition', targetTime: 300, role: 'air', minFraction: 0.65, weight: 2.5 },
      { type: 'metalIncome',     targetTime: 180, targetValue: 5,   weight: 1.0 },
      { type: 'armyMetal',       targetTime: 360, targetValue: 1500, weight: 1.0 },
    ],
  },
  {
    label: 'Bombing Run',
    desc: 'Bomber-heavy air force: get bombers fast and maintain a large air DPS.',
    goals: [
      { type: 'unitCategory', targetTime: 120, categoryId: 'anyBomber', weight: 2.0 },
      { type: 'armyDps',      targetTime: 300, targetValue: 25,  weight: 2.0 },
      { type: 'armyMetal',    targetTime: 300, targetValue: 1000, weight: 1.5 },
      { type: 'metalIncome',  targetTime: 180, targetValue: 5,   weight: 1.0 },
    ],
  },
  // ── Balanced ──────────────────────────────────────────────────────────────
  {
    label: 'Balanced',
    desc: 'Solid eco + T2 transition + ground army. Good all-round starting point.',
    goals: [
      { type: 'metalIncome',     targetTime: 180, targetValue: 7,    weight: 1.5 },
      { type: 'unitCategory',    targetTime: 120, categoryId: 'anyT1Constructor', weight: 1.5 },
      { type: 'unitCategory',    targetTime: 480, categoryId: 'anyT2Factory',     weight: 2.0 },
      { type: 'armyMetal',       targetTime: 360, targetValue: 1500, weight: 1.5 },
      { type: 'armyComposition', targetTime: 360, role: 'ground', minFraction: 0.8, weight: 1.0 },
    ],
  },
]

function applyPreset(preset: typeof PRESETS[number]) {
  checkpoints.value.push(...preset.goals)
  showPresets.value = false
}

function removeGoal(idx: number) {
  checkpoints.value.splice(idx, 1)
}

function addStartingBuilder(unitId: string) {
  if (!additionalStartingUnitIds.value.includes(unitId)) {
    additionalStartingUnitIds.value.push(unitId)
  }
  showAddBuilderModal.value = false
  builderSearch.value = ''
}

function removeStartingBuilder(idx: number) {
  additionalStartingUnitIds.value.splice(idx, 1)
}

function checkpointLabel(cp: OptimizerCheckpoint): string {
  switch (cp.type) {
    case 'metalIncome':
      return `Metal ≥ ${cp.targetValue} M/s by ${cp.targetTime}s`
    case 'energyIncome':
      return `Energy ≥ ${cp.targetValue} E/s by ${cp.targetTime}s`
    case 'armyMetal':
      return `Army metal ≥ ${cp.targetValue} M by ${cp.targetTime}s`
    case 'armyDps':
      return `Army DPS ≥ ${cp.targetValue} by ${cp.targetTime}s`
    case 'armyHealth':
      return `Army health ≥ ${cp.targetValue} by ${cp.targetTime}s`
    case 'armyComposition':
      return `Army ${cp.role} ≥ ${Math.round(cp.minFraction * 100)}% by ${cp.targetTime}s`
    case 'buildPower':
      return `Build power ≥ ${cp.targetValue} by ${cp.targetTime}s`
    case 'building':
    case 'unit': {
      const name = unitStore.units.find((u) => u.id === cp.unitId)?.name ?? cp.unitId
      return `${cp.type === 'building' ? 'Building' : 'Unit'}: ${name} by ${cp.targetTime}s`
    }
    case 'unitCount': {
      const name = unitStore.units.find((u) => u.id === cp.unitId)?.name ?? cp.unitId
      return `${cp.targetCount}× ${name} by ${cp.targetTime}s`
    }
    case 'unitCategory':
      return `${UNIT_CATEGORY_LABELS[cp.categoryId] ?? cp.categoryId} by ${cp.targetTime}s`
  }
}

function unitForId(id: string) {
  return unitStore.units.find((u) => u.id === id)
}

function isBannedByCurrentFilters(unitIdOrGene: string): boolean {
  const unitId = isReclaimGene(unitIdOrGene) ? getReclaimTargetId(unitIdOrGene) : unitIdOrGene
  const u = unitStore.units.find((u) => u.id === unitId)
  if (!u) return false
  return isUnitExcluded(u, unitPoolFilters)
}

watch(faction, (newFaction) => {
  // Warn about checkpoints referencing wrong-faction units
  const incompatibleGoals = checkpoints.value.filter((cp) => {
    if (cp.type !== 'building' && cp.type !== 'unit') return false
    const unit = unitStore.units.find((u) => u.id === cp.unitId)
    return unit && unit.faction !== newFaction
  })
  // Clear additional builders that no longer belong to the new faction
  additionalStartingUnitIds.value = additionalStartingUnitIds.value.filter((uid) => {
    const unit = unitStore.units.find((u) => u.id === uid)
    return unit && unit.faction === newFaction
  })
  factionWarning.value =
    incompatibleGoals.length > 0
      ? `${incompatibleGoals.length} goal(s) reference units from another faction.`
      : ''
})

const latestProgress = computed(() =>
  progressHistory.value[progressHistory.value.length - 1] ?? null,
)

const latestStats = computed((): PopulationStats | null =>
  latestProgress.value?.stats ?? null,
)

const gaWarnings = computed(() => {
  const warnings: { level: 'info' | 'warning' | 'critical'; text: string }[] = []
  const s = latestStats.value
  if (!s) return warnings

  // Diversity collapse
  const uniqueRatio = s.uniqueChromosomeCount / populationSize.value
  if (uniqueRatio < 0.3) {
    warnings.push({ level: 'critical', text: `Diversity collapse: only ${s.uniqueChromosomeCount} unique individuals (${(uniqueRatio * 100).toFixed(0)}%). The population has converged prematurely.` })
  } else if (uniqueRatio < 0.5) {
    warnings.push({ level: 'warning', text: `Low diversity: ${(uniqueRatio * 100).toFixed(0)}% unique. Consider increasing mutation rate or population size.` })
  }

  // Stagnation
  if (s.stagnationCounter > 100) {
    warnings.push({ level: 'critical', text: `Stagnated for ${s.stagnationCounter} generations. The optimizer is unlikely to improve further.` })
  } else if (s.stagnationCounter > 50) {
    warnings.push({ level: 'warning', text: `No improvement for ${s.stagnationCounter} generations. Consider stopping and adjusting goals/weights.` })
  }

  // Fitness spread
  if (s.fitnessStdDev < 0.01 && s.stagnationCounter > 10) {
    warnings.push({ level: 'warning', text: 'Fitness variance near zero — all individuals score similarly. Mutation may be too low.' })
  }

  // Goal coverage
  s.goalAchievementRates.forEach((rate, i) => {
    if (rate === 0 && s.stagnationCounter > 30) {
      warnings.push({ level: 'warning', text: `Goal ${i + 1} absent from entire population. It may be unreachable with current settings.` })
    }
  })

  // Jaccard distance
  if (s.avgPairwiseDistance < 0.15) {
    warnings.push({ level: 'warning', text: 'Chromosomes are highly similar (low Jaccard distance). Population may be clones.' })
  }

  return warnings
})

/** Diversity over time chart data (for post-completion diagnostics) */
const diversityChartData = computed(() => {
  if (progressHistory.value.length === 0) return null
  const labels = progressHistory.value.map((p) => String(p.generation))
  return {
    labels,
    datasets: [
      {
        label: 'Unique Chromosomes',
        data: progressHistory.value.map((p) => p.stats?.uniqueChromosomeCount ?? 0),
        borderColor: '#a78bfa',
        tension: 0.3,
        pointRadius: 0,
        yAxisID: 'y',
      },
      {
        label: 'Avg Jaccard Distance',
        data: progressHistory.value.map((p) => +(p.stats?.avgPairwiseDistance ?? 0).toFixed(3)),
        borderColor: '#f472b6',
        tension: 0.3,
        pointRadius: 0,
        yAxisID: 'y1',
      },
    ],
  }
})

const diversityChartOptions = computed(() => ({
  ...darkChartOptions,
  scales: {
    ...darkChartOptions.scales,
    y: {
      ...darkChartOptions.scales.y,
      position: 'left' as const,
      title: { display: true, text: 'Unique Count', color: '#9ca3af' },
    },
    y1: {
      ...darkChartOptions.scales.y,
      position: 'right' as const,
      title: { display: true, text: 'Jaccard Distance', color: '#9ca3af' },
      min: 0, max: 1,
      grid: { drawOnChartArea: false },
    },
  },
}))

/** Goal presence over time chart data */
const goalPresenceChartData = computed(() => {
  if (progressHistory.value.length === 0 || checkpoints.value.length === 0) return null
  const labels = progressHistory.value.map((p) => String(p.generation))
  const colors = ['#60a5fa', '#34d399', '#f59e0b', '#ef4444', '#a78bfa', '#f472b6', '#06b6d4', '#84cc16']
  return {
    labels,
    datasets: checkpoints.value.map((cp, idx) => ({
      label: checkpointLabel(cp),
      data: progressHistory.value.map((p) => {
        const rates = p.stats?.goalAchievementRates
        return rates && rates[idx] != null ? +(rates[idx] * 100).toFixed(1) : 0
      }),
      borderColor: colors[idx % colors.length],
      tension: 0.3,
      pointRadius: 0,
      borderWidth: 1.5,
    })),
  }
})

const goalPresenceChartOptions = computed(() => ({
  ...darkChartOptions,
  scales: {
    ...darkChartOptions.scales,
    y: {
      ...darkChartOptions.scales.y,
      title: { display: true, text: '% of Population', color: '#9ca3af' },
      min: 0, max: 100,
    },
  },
}))

/** GA summary stats for completion panel */
const gaSummary = computed(() => {
  if (!result.value || progressHistory.value.length === 0) return null
  const history = progressHistory.value
  const lastStats = history[history.length - 1]?.stats
  // Find when best fitness was first achieved
  let bestGenIdx = 0
  let bestFit = -Infinity
  for (let i = 0; i < history.length; i++) {
    if (history[i].bestFitness > bestFit) {
      bestFit = history[i].bestFitness
      bestGenIdx = i
    }
  }
  return {
    totalGenerations: result.value.totalGenerations,
    totalImprovements: lastStats?.improvementCount ?? 0,
    finalDiversity: lastStats ? `${((lastStats.uniqueChromosomeCount / populationSize.value) * 100).toFixed(0)}%` : '—',
    finalStagnation: lastStats?.stagnationCounter ?? 0,
    timeToBest: `${(history[bestGenIdx]?.elapsedMs / 1000).toFixed(1)}s (gen ${history[bestGenIdx]?.generation})`,
    goalRates: lastStats?.goalAchievementRates ?? [],
  }
})

function formatTimeSince(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

const timelineMaxTime = computed(() => {
  const snaps = displayResult.value?.snapshots
  if (snaps && snaps.length > 0) return snaps[snaps.length - 1].timeSeconds
  const tl = displayResult.value?.builderTimeline
  return tl && tl.length > 0 ? tl[tl.length - 1].timeSeconds : 0
})

const currentTimelineSnapshot = computed((): BuilderTimelineSnapshot | null => {
  const tl = displayResult.value?.builderTimeline
  if (!tl || tl.length === 0) return null
  let best = tl[0]
  for (const snap of tl) {
    if (snap.timeSeconds <= timelineTime.value) best = snap
    else break
  }
  return best
})

const currentSimSnapshot = computed((): SimSnapshot | null => {
  const snaps = displayResult.value?.snapshots
  if (!snaps || snaps.length === 0) return null
  let best = snaps[0]
  for (const s of snaps) {
    if (s.timeSeconds <= timelineTime.value) best = s
    else break
  }
  return best
})

const currentRates = computed(() => {
  const snaps = displayResult.value?.snapshots
  const curr = currentSimSnapshot.value
  if (!snaps || !curr) return null
  const idx = snaps.indexOf(curr)
  if (idx <= 0) return null
  const prev = snaps[idx - 1]
  const dt = curr.timeSeconds - prev.timeSeconds
  if (dt <= 0) return null
  const metalExpense = (curr.totalMetalSpent - prev.totalMetalSpent) / dt
  const energyExpense = (curr.totalEnergySpent - prev.totalEnergySpent) / dt
  const converterRate = (curr.totalConverterMetalOutput - prev.totalConverterMetalOutput) / dt
  return {
    metalIncome: curr.metalIncome,
    energyIncome: curr.energyIncome,
    metalExpense: +metalExpense.toFixed(2),
    energyExpense: +energyExpense.toFixed(1),
    metalDelta: +(curr.metalIncome - metalExpense).toFixed(2),
    energyDelta: +(curr.energyIncome - energyExpense).toFixed(1),
    converterRate: +converterRate.toFixed(2),
  }
})

/** Converter metal output rate at each snapshot, derived from cumulative diff */
function converterRates(snaps: SimSnapshot[]): number[] {
  return snaps.map((s, i) => {
    if (i === 0) return s.timeSeconds > 0 ? +(s.totalConverterMetalOutput / s.timeSeconds).toFixed(3) : 0
    const prev = snaps[i - 1]
    const dt = s.timeSeconds - prev.timeSeconds
    return dt > 0 ? +((s.totalConverterMetalOutput - prev.totalConverterMetalOutput) / dt).toFixed(3) : 0
  })
}

const timelineWarnings = computed(() => {
  const s = currentSimSnapshot.value
  if (!s) return []
  const warnings: { msg: string; level: 'warn' | 'crit' }[] = []
  if (s.metalCap > 0 && s.currentMetal / s.metalCap > 0.95)
    warnings.push({ msg: 'Metal near cap — income wasted', level: 'warn' })
  if (s.energyCap > 0 && s.currentEnergy / s.energyCap > 0.95)
    warnings.push({ msg: 'Energy near cap — income wasted', level: 'warn' })
  if (s.metalIncome > 0 && s.currentMetal < s.metalIncome * 2)
    warnings.push({ msg: 'Metal critically low — builders stalling', level: 'crit' })
  if (s.energyIncome > 0 && s.currentEnergy < s.energyIncome * 2)
    warnings.push({ msg: 'Energy critically low — builders stalling', level: 'crit' })
  return warnings
})

/** Alive units at current timeline position, enriched with per-unit economy data. */
const aliveUnitsAtTime = computed(() => {
  const snap = currentSimSnapshot.value
  if (!snap || !snap.aliveUnitCounts) return { ecoRows: [], militaryRows: [], builderRows: [] }

  type EcoRow = {
    id: string; name: string; count: number
    metalPerUnit: number      // M/s per unit (tier-scaled)
    energyNetPerUnit: number  // E/s net per unit (production - upkeep)
    buildPowerPerUnit: number
    metalStoragePerUnit: number
    energyStoragePerUnit: number
    converterCapPerUnit: number
    converterMetalPerUnit: number // M/s at full capacity per unit
    isConverter: boolean
    isWind: boolean
    isTidal: boolean
    isGeo: boolean
  }
  type SummaryRow = { id: string; name: string; count: number }

  const ecoRows: EcoRow[] = []
  const militaryRows: SummaryRow[] = []
  const builderRows: SummaryRow[] = []

  for (const [id, count] of Object.entries(snap.aliveUnitCounts)) {
    if (count <= 0) continue
    const unit = unitStore.getUnit(id)
    if (!unit) continue

    const hasMetal   = (unit.metalProduction ?? 0) > 0
    const hasEnergy  = (unit.energyProduction ?? 0) > 0
    const hasUpkeep  = (unit.energyUpkeep ?? 0) > 0
    const hasStorage = (unit.metalStorage ?? 0) > 0 || (unit.energyStorage ?? 0) > 0
    const hasBP      = (unit.buildPower ?? 0) > 0
    const hasConv    = !!unit.energyConverterCapacity
    const wind  = isWindGenerator(unit)
    const tidal = isTidalGenerator(unit)
    const geo   = isGeothermal(unit)
    const hasEcoEffect = hasMetal || hasEnergy || hasUpkeep || hasStorage || hasConv || wind || tidal || geo

    // M/s per unit — tier-scaled (T1 MEX=1.8, T2 MEX=7.2, etc.) using map's metalPerSpot setting
    const metalPerUnit = hasMetal
      ? metalPerSpot.value * ((unit.metalProduction!) / BASE_T1_MEX_RATE)
      : 0

    // E/s per unit: wind/tidal use config values; others use unit data; minus upkeep
    const rawEProd = wind ? windAvg.value : tidal ? tidalStrength.value : (unit.energyProduction ?? 0)
    const energyNetPerUnit = rawEProd - (unit.energyUpkeep ?? 0)

    if (hasEcoEffect) {
      ecoRows.push({
        id, name: unit.name, count,
        metalPerUnit,
        energyNetPerUnit,
        buildPowerPerUnit: unit.buildPower ?? 0,
        metalStoragePerUnit: unit.metalStorage ?? 0,
        energyStoragePerUnit: unit.energyStorage ?? 0,
        converterCapPerUnit: unit.energyConverterCapacity ?? 0,
        converterMetalPerUnit: (unit.energyConverterCapacity ?? 0) * (unit.energyConverterEfficiency ?? 0),
        isConverter: hasConv,
        isWind: wind,
        isTidal: tidal,
        isGeo: geo,
      })
    } else if (hasBP) {
      builderRows.push({ id, name: unit.name, count })
    } else {
      militaryRows.push({ id, name: unit.name, count })
    }
  }

  // Sort eco: metal producers first, then energy generators, then converters/storage
  ecoRows.sort((a, b) => {
    const aScore = (a.metalPerUnit > 0 ? 4 : 0) + (a.energyNetPerUnit !== 0 ? 2 : 0) + (a.isConverter ? 1 : 0)
    const bScore = (b.metalPerUnit > 0 ? 4 : 0) + (b.energyNetPerUnit !== 0 ? 2 : 0) + (b.isConverter ? 1 : 0)
    return bScore - aScore || a.name.localeCompare(b.name)
  })
  militaryRows.sort((a, b) => a.name.localeCompare(b.name))
  builderRows.sort((a, b) => a.name.localeCompare(b.name))

  return { ecoRows, militaryRows, builderRows }
})
</script>

<template>
  <div class="flex gap-4 h-full">
    <!-- ── Left Panel (Setup) ─────────────────────────────────────────── -->
    <aside class="w-72 flex-shrink-0 space-y-3 overflow-y-auto">

      <!-- ── Control Buttons (always at top) ── -->
      <div class="flex gap-2">
        <button
          v-if="status !== 'running'"
          @click="startOptimization"
          :disabled="checkpoints.length === 0"
          class="flex-1 py-2.5 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-semibold text-sm transition-colors"
        >▶ Optimize</button>
        <button
          v-else
          @click="stopOptimization"
          class="flex-1 py-2.5 bg-red-600 hover:bg-red-500 rounded font-semibold text-sm transition-colors"
        >■ Stop</button>
        <button
          v-if="status === 'done' && result"
          @click="continueOptimization"
          class="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 rounded font-semibold text-sm transition-colors"
          title="Seed the next run with the current best build order"
        >↻ Continue</button>
      </div>

      <!-- Save / Load row -->
      <div class="flex gap-2">
        <button
          @click="showSavedBuildsModal = true"
          class="flex-1 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors flex items-center justify-center gap-1.5"
          title="Save current settings or load a previous build"
        >
          <span>💾</span>
          <span>Saves</span>
          <span v-if="savedBuilds.length" class="text-xs text-gray-400 bg-gray-600 px-1.5 py-0.5 rounded-full">{{ savedBuilds.length }}</span>
        </button>
        <button
          @click="saveCurrentBuild"
          class="py-1.5 px-3 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
          title="Quick-save current settings"
        >+ Save</button>
      </div>

      <!-- Faction Selector -->
      <div class="bg-gray-800 rounded-lg p-3">
        <h3 class="text-sm font-semibold text-gray-400 uppercase mb-2">Faction</h3>
        <div class="flex gap-2">
          <button
            v-for="f in (['Armada', 'Cortex', 'Legion'] as Faction[])"
            :key="f"
            @click="faction = f"
            :class="[
              'flex-1 py-1.5 rounded text-sm font-medium transition-colors',
              faction === f
                ? f === 'Armada' ? 'bg-blue-600 text-white'
                  : f === 'Cortex' ? 'bg-red-600 text-white'
                  : 'bg-green-700 text-white'
                : 'bg-gray-700 text-gray-400 hover:text-white'
            ]"
          >{{ f }}</button>
        </div>
        <p v-if="factionWarning" class="mt-2 text-xs text-yellow-400">{{ factionWarning }}</p>
      </div>

      <!-- Starting Units -->
      <div class="bg-gray-800 rounded-lg p-3">
        <button
          @click="showStartingUnits = !showStartingUnits"
          class="w-full flex items-center justify-between text-sm font-semibold text-gray-400 uppercase"
        >
          <span>Starting Units</span>
          <span class="flex items-center gap-2">
            <span v-if="!showStartingUnits" class="text-xs font-normal normal-case text-gray-500">{{ faction }} Cmdr {{ commanderBuildpower }}BP<span v-if="additionalStartingUnitIds.length"> +{{ additionalStartingUnitIds.length }}</span></span>
            <span>{{ showStartingUnits ? '▲' : '▼' }}</span>
          </span>
        </button>
        <div v-if="showStartingUnits" class="mt-3 space-y-3">

        <!-- Commander row -->
        <div class="bg-gray-700 rounded px-3 py-2 text-sm">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-yellow-400 font-bold text-xs">★</span>
            <span class="font-medium text-gray-200">Commander</span>
            <span class="text-xs text-gray-500 ml-auto">{{ faction }}</span>
          </div>
          <div class="grid grid-cols-3 gap-2 text-xs">
            <div>
              <label class="flex items-center gap-1 text-gray-500 mb-0.5">Build Power
                <span class="tip" data-tip="How fast the commander builds. Each unit of build power applied per second reduces a unit's build time. Default: 300. Higher = builds faster.">ⓘ</span>
                <button v-if="commanderBuildpower !== FIELD_DEFAULTS.commanderBuildpower" @click="commanderBuildpower = FIELD_DEFAULTS.commanderBuildpower" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" title="Reset">↩</button>
              </label>
              <input v-model.number="commanderBuildpower" type="number" min="1"
                :class="['w-full bg-gray-600 border rounded px-1.5 py-1 text-white focus:outline-none focus:border-blue-500', commanderBuildpower !== FIELD_DEFAULTS.commanderBuildpower ? 'border-yellow-600/60' : 'border-gray-500']" />
            </div>
            <div>
              <label class="flex items-center gap-1 text-gray-500 mb-0.5">M/s (base)
                <span class="tip" data-tip="Metal income from the commander alone, before any MEX buildings are placed. Default: 2 M/s. MEX spots add income in-sim.">ⓘ</span>
                <button v-if="commanderBaseMetalIncome !== FIELD_DEFAULTS.commanderBaseMetalIncome" @click="commanderBaseMetalIncome = FIELD_DEFAULTS.commanderBaseMetalIncome" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" title="Reset">↩</button>
              </label>
              <input v-model.number="commanderBaseMetalIncome" type="number" step="0.1" min="0"
                :class="['w-full bg-gray-600 border rounded px-1.5 py-1 text-white focus:outline-none focus:border-blue-500', commanderBaseMetalIncome !== FIELD_DEFAULTS.commanderBaseMetalIncome ? 'border-yellow-600/60' : 'border-gray-500']" />
            </div>
            <div>
              <label class="flex items-center gap-1 text-gray-500 mb-0.5">E/s
                <span class="tip" data-tip="Energy income from the commander. Default: 20 E/s. Solar, wind and geo add their own income once built.">ⓘ</span>
                <button v-if="commanderEnergyIncome !== FIELD_DEFAULTS.commanderEnergyIncome" @click="commanderEnergyIncome = FIELD_DEFAULTS.commanderEnergyIncome" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" title="Reset">↩</button>
              </label>
              <input v-model.number="commanderEnergyIncome" type="number" step="1" min="0"
                :class="['w-full bg-gray-600 border rounded px-1.5 py-1 text-white focus:outline-none focus:border-blue-500', commanderEnergyIncome !== FIELD_DEFAULTS.commanderEnergyIncome ? 'border-yellow-600/60' : 'border-gray-500']" />
            </div>
          </div>
        </div>

        <!-- Additional starting builders -->
        <div v-if="additionalStartingUnitIds.length > 0" class="space-y-1">
          <div
            v-for="(uid, idx) in additionalStartingUnitIds"
            :key="uid"
            class="flex items-center gap-2 text-xs bg-gray-700 rounded px-2 py-1.5"
          >
            <span class="flex-1 text-gray-300">{{ unitForId(uid)?.name ?? uid }}</span>
            <span class="text-gray-500">{{ unitForId(uid)?.buildPower ?? 0 }} BP</span>
            <button @click="removeStartingBuilder(idx)" class="text-red-400 hover:text-red-300">×</button>
          </div>
        </div>

        <button
          @click="showAddBuilderModal = true"
          class="w-full text-xs py-1.5 bg-gray-700 hover:bg-gray-600 rounded transition-colors text-gray-300"
        >+ Add extra builder</button>
        </div>
      </div>

      <!-- Map Settings -->
      <div class="bg-gray-800 rounded-lg p-3">
        <button
          @click="showMapSettings = !showMapSettings"
          class="w-full flex items-center justify-between text-sm font-semibold text-gray-400 uppercase"
        >
          <span>Map Settings</span>
          <span class="flex items-center gap-2">
            <span v-if="!showMapSettings" class="text-xs font-normal normal-case text-gray-500">{{ metalSpots }}mex {{ metalPerSpot }}M/s {{ geoSpots }}geo w{{ windAvg }}</span>
            <span>{{ showMapSettings ? '▲' : '▼' }}</span>
          </span>
        </button>
        <div v-if="showMapSettings" class="mt-3 space-y-3">
        <div class="grid grid-cols-2 gap-2 text-sm">
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">Metal Spots
              <span class="tip" data-tip="Number of metal extraction spots on the map. MEX buildings beyond this count are built but add no metal income (spot is occupied). Typical land maps: 4–12.">ⓘ</span>
              <button v-if="metalSpots !== FIELD_DEFAULTS.metalSpots" @click="metalSpots = FIELD_DEFAULTS.metalSpots" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to default (${FIELD_DEFAULTS.metalSpots})`">↩</button>
            </label>
            <input v-model.number="metalSpots" type="number" min="0" max="20"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', metalSpots !== FIELD_DEFAULTS.metalSpots ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">M/spot
              <span class="tip" data-tip="Metal per second granted by each occupied MEX spot. Map-dependent. Typical values: 1.2 (low richness) to 2.4 (high richness). Default 1.8.">ⓘ</span>
              <button v-if="metalPerSpot !== FIELD_DEFAULTS.metalPerSpot" @click="metalPerSpot = FIELD_DEFAULTS.metalPerSpot" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to default (${FIELD_DEFAULTS.metalPerSpot})`">↩</button>
            </label>
            <input v-model.number="metalPerSpot" type="number" step="0.1" min="0"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', metalPerSpot !== FIELD_DEFAULTS.metalPerSpot ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">Geo Spots
              <span class="tip" data-tip="Number of geothermal vent spots on the map. Geothermal power plants beyond this count are built but add no energy income. Most maps have 0–2. Default 1.">ⓘ</span>
              <button v-if="geoSpots !== FIELD_DEFAULTS.geoSpots" @click="geoSpots = FIELD_DEFAULTS.geoSpots" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to default (${FIELD_DEFAULTS.geoSpots})`">↩</button>
            </label>
            <input v-model.number="geoSpots" type="number" min="0" max="10"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', geoSpots !== FIELD_DEFAULTS.geoSpots ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">Wind Avg
              <span class="tip" data-tip="Average wind speed. Wind generators produce windAvg E/s on average (output = windgenerator × windSpeed / windMax, which at avg equals windAvg). Typical BAR default: 12.5.">ⓘ</span>
              <button v-if="windAvg !== FIELD_DEFAULTS.windAvg" @click="windAvg = FIELD_DEFAULTS.windAvg" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to default (${FIELD_DEFAULTS.windAvg})`">↩</button>
            </label>
            <input v-model.number="windAvg" type="number" step="0.5" min="0"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', windAvg !== FIELD_DEFAULTS.windAvg ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">Wind Min
              <span class="tip" data-tip="Minimum wind speed on this map. Used to compute the energy storage buffer required to smooth wind variation. Lower min = more storage needed. BAR default: 0–10 depending on map.">ⓘ</span>
              <button v-if="windMin !== FIELD_DEFAULTS.windMin" @click="windMin = FIELD_DEFAULTS.windMin" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to default (${FIELD_DEFAULTS.windMin})`">↩</button>
            </label>
            <input v-model.number="windMin" type="number" step="0.5" min="0"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', windMin !== FIELD_DEFAULTS.windMin ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">Wind Max
              <span class="tip" data-tip="Maximum wind speed on this map. Rarely changes — BAR standard is 25. Tidal generators also cap their output at tidalStrength regardless of this setting.">ⓘ</span>
              <button v-if="windMax !== FIELD_DEFAULTS.windMax" @click="windMax = FIELD_DEFAULTS.windMax" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to default (${FIELD_DEFAULTS.windMax})`">↩</button>
            </label>
            <input v-model.number="windMax" type="number" step="0.5" min="1"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', windMax !== FIELD_DEFAULTS.windMax ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">Tidal Strength
              <span class="tip" data-tip="Tidal generator output in E/s. In BAR the tidal generator multiplier is 1, so output = tidalStrength. Typical map values: 0 (no tidal), 10–50. Coastal maps often have 25.">ⓘ</span>
              <button v-if="tidalStrength !== FIELD_DEFAULTS.tidalStrength" @click="tidalStrength = FIELD_DEFAULTS.tidalStrength" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to default (${FIELD_DEFAULTS.tidalStrength})`">↩</button>
            </label>
            <input v-model.number="tidalStrength" type="number" step="1" min="0"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', tidalStrength !== FIELD_DEFAULTS.tidalStrength ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">Duration (s)
              <span class="tip" data-tip="Minimum simulation length. Automatically extended to cover the latest goal deadline + 10s. Goals beyond this time are never evaluated.">ⓘ</span>
              <span v-if="goalsExceedDuration" class="text-yellow-400 text-xs" title="One or more goals have a target time beyond the effective simulation duration">⚠</span>
              <button v-if="durationInput !== FIELD_DEFAULTS.durationInput" @click="durationInput = FIELD_DEFAULTS.durationInput" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to default (${FIELD_DEFAULTS.durationInput})`">↩</button>
            </label>
            <input v-model.number="durationInput" type="number" min="60" max="600"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', durationInput !== FIELD_DEFAULTS.durationInput ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">Start Metal
              <span class="tip" data-tip="Metal in storage at second 0. The commander starts with this amount available to spend. Default: 1000 M.">ⓘ</span>
              <button v-if="startingMetal !== FIELD_DEFAULTS.startingMetal" @click="startingMetal = FIELD_DEFAULTS.startingMetal" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to default (${FIELD_DEFAULTS.startingMetal})`">↩</button>
            </label>
            <input v-model.number="startingMetal" type="number" min="0"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', startingMetal !== FIELD_DEFAULTS.startingMetal ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">Start Energy
              <span class="tip" data-tip="Energy in storage at second 0. The commander starts with this amount available. Default: 1000 E.">ⓘ</span>
              <button v-if="startingEnergy !== FIELD_DEFAULTS.startingEnergy" @click="startingEnergy = FIELD_DEFAULTS.startingEnergy" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to default (${FIELD_DEFAULTS.startingEnergy})`">↩</button>
            </label>
            <input v-model.number="startingEnergy" type="number" min="0"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', startingEnergy !== FIELD_DEFAULTS.startingEnergy ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">M. Storage
              <span class="tip" data-tip="Starting metal storage capacity. Income overflows once metal hits this cap (wasted). Storage buildings (Metal Storage) increase this in-sim. Set to match your commander's actual storage. Default: 1000.">ⓘ</span>
              <button v-if="startingMetalStorage !== FIELD_DEFAULTS.startingMetalStorage" @click="startingMetalStorage = FIELD_DEFAULTS.startingMetalStorage" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to default (${FIELD_DEFAULTS.startingMetalStorage})`">↩</button>
            </label>
            <input v-model.number="startingMetalStorage" type="number" min="100"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', startingMetalStorage !== FIELD_DEFAULTS.startingMetalStorage ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">E. Storage
              <span class="tip" data-tip="Starting energy storage capacity. Income overflows once energy hits this cap. Energy Storage buildings increase this in-sim. Default: 1000.">ⓘ</span>
              <button v-if="startingEnergyStorage !== FIELD_DEFAULTS.startingEnergyStorage" @click="startingEnergyStorage = FIELD_DEFAULTS.startingEnergyStorage" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to default (${FIELD_DEFAULTS.startingEnergyStorage})`">↩</button>
            </label>
            <input v-model.number="startingEnergyStorage" type="number" min="100"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', startingEnergyStorage !== FIELD_DEFAULTS.startingEnergyStorage ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
        </div>
        <p class="text-xs text-gray-500">
          Commander M/s: {{ commanderBaseMetalIncome }} (base only — MEX buildings provide spot income in-sim,
          max {{ metalSpots }} × {{ metalPerSpot }} = {{ metalIncomeFromSpots.toFixed(2) }} M/s potential)
        </p>
        </div>
      </div>

      <!-- Preset dropdown click-outside -->
      <div v-if="showPresets" class="fixed inset-0 z-10" @click="showPresets = false" />

      <!-- Goals -->
      <div class="bg-gray-800 rounded-lg p-3">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-gray-400 uppercase">Goals</h3>
          <div class="flex gap-1.5 relative">
            <button
              @click="showPresets = !showPresets"
              class="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded transition-colors"
              title="Load a strategy preset"
            >Presets ▾</button>
            <button
              @click="openAddGoalModal"
              class="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
            >+ Add</button>
            <!-- Presets dropdown -->
            <div
              v-if="showPresets"
              class="absolute right-0 top-7 z-20 bg-gray-700 border border-gray-600 rounded-lg shadow-xl w-56 py-1"
            >
              <div
                v-for="preset in PRESETS"
                :key="preset.label"
                @click="applyPreset(preset)"
                class="px-3 py-2 hover:bg-gray-600 cursor-pointer"
              >
                <p class="text-xs font-semibold text-gray-200">{{ preset.label }}</p>
                <p class="text-xs text-gray-500 mt-0.5">{{ preset.desc }}</p>
              </div>
            </div>
          </div>
        </div>
        <p v-if="checkpoints.length === 0" class="text-xs text-gray-500 italic">
          No goals yet. Pick a preset or add individual goals.
        </p>
        <ul class="space-y-1.5">
          <li
            v-for="(cp, idx) in checkpoints"
            :key="idx"
            class="flex items-start gap-2 text-xs bg-gray-700 rounded px-2 py-1.5"
          >
            <span class="flex-1 text-gray-300">{{ checkpointLabel(cp) }}</span>
            <span v-if="goalExceedsDuration(cp)" class="text-yellow-400 flex-shrink-0" title="Target time exceeds effective simulation duration — this goal will never be evaluated">⚠</span>
            <span class="text-gray-500">w={{ cp.weight }}</span>
            <button @click="openEditGoalModal(idx)" class="text-blue-400 hover:text-blue-300 ml-1" title="Edit">✎</button>
            <button @click="removeGoal(idx)" class="text-red-400 hover:text-red-300">×</button>
          </li>
        </ul>
      </div>

      <!-- Advanced (collapsible) -->
      <div class="bg-gray-800 rounded-lg p-3">
        <button
          @click="showAdvanced = !showAdvanced"
          class="w-full flex items-center justify-between text-sm font-semibold text-gray-400 uppercase"
        >
          <span>Advanced</span>
          <span class="flex items-center gap-2">
            <span v-if="!showAdvanced" class="text-xs font-normal normal-case text-gray-500">pop{{ populationSize }} gen{{ maxGenerations }} mut{{ mutationRate }}</span>
            <span>{{ showAdvanced ? '▲' : '▼' }}</span>
          </span>
        </button>
        <div v-if="showAdvanced" class="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">Population
              <span class="tip" data-tip="Number of build orders evaluated simultaneously each generation. Larger population = more diversity but slower per generation. Typical: 50–200.">ⓘ</span>
              <button v-if="populationSize !== FIELD_DEFAULTS.populationSize" @click="populationSize = FIELD_DEFAULTS.populationSize" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to ${FIELD_DEFAULTS.populationSize}`">↩</button>
            </label>
            <input v-model.number="populationSize" type="number" min="10" max="500"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', populationSize !== FIELD_DEFAULTS.populationSize ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">Generations
              <span class="tip" data-tip="Total number of evolution cycles. More generations = more time to converge on a good solution. 200–500 is usually sufficient. Watch the fitness graph to judge.">ⓘ</span>
              <button v-if="maxGenerations !== FIELD_DEFAULTS.maxGenerations" @click="maxGenerations = FIELD_DEFAULTS.maxGenerations" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to ${FIELD_DEFAULTS.maxGenerations}`">↩</button>
            </label>
            <input v-model.number="maxGenerations" type="number" min="10" max="2000"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', maxGenerations !== FIELD_DEFAULTS.maxGenerations ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">Mutation Rate
              <span class="tip" data-tip="Per-gene probability of random mutation each pass. Each gene can be swapped (40%), replaced (28%), a new gene inserted (11%), reclaim inserted (11%), or deleted (10%). Default 0.15.">ⓘ</span>
              <button v-if="mutationRate !== FIELD_DEFAULTS.mutationRate" @click="mutationRate = FIELD_DEFAULTS.mutationRate" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to ${FIELD_DEFAULTS.mutationRate}`">↩</button>
            </label>
            <input v-model.number="mutationRate" type="number" step="0.01" min="0" max="1"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', mutationRate !== FIELD_DEFAULTS.mutationRate ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">Mutation Passes
              <span class="tip" data-tip="How many independent mutation passes to apply per chromosome per generation. Each pass rolls mutation chance per gene independently. More passes = more disruption per generation, helping escape local optima. Default 1.">ⓘ</span>
              <button v-if="mutationCount !== FIELD_DEFAULTS.mutationCount" @click="mutationCount = FIELD_DEFAULTS.mutationCount" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to ${FIELD_DEFAULTS.mutationCount}`">↩</button>
            </label>
            <input v-model.number="mutationCount" type="number" step="1" min="1" max="20"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', mutationCount !== FIELD_DEFAULTS.mutationCount ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">Explosion Chance
              <span class="tip" data-tip="After each individual mutation fires, this is the chance it triggers one more mutation immediately (cascades: the extra mutation also rolls this chance). 0 = no cascades. Max 0.99 to prevent infinite chains. Expected extra mutations per fired mutation ≈ p/(1−p). Default 0.05.">ⓘ</span>
              <button v-if="explodingMutationChance !== FIELD_DEFAULTS.explodingMutationChance" @click="explodingMutationChance = FIELD_DEFAULTS.explodingMutationChance" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to ${FIELD_DEFAULTS.explodingMutationChance}`">↩</button>
            </label>
            <input v-model.number="explodingMutationChance" type="number" step="0.01" min="0" max="0.99"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', explodingMutationChance !== FIELD_DEFAULTS.explodingMutationChance ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">Elite Count
              <span class="tip" data-tip="Number of top-scoring build orders copied unchanged into the next generation. Prevents the best solution from being lost by mutation. Default 5. Set higher if fitness regresses between generations.">ⓘ</span>
              <button v-if="eliteCount !== FIELD_DEFAULTS.eliteCount" @click="eliteCount = FIELD_DEFAULTS.eliteCount" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to ${FIELD_DEFAULTS.eliteCount}`">↩</button>
            </label>
            <input v-model.number="eliteCount" type="number" min="1" max="20"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', eliteCount !== FIELD_DEFAULTS.eliteCount ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">Tournament
              <span class="tip" data-tip="Number of random candidates compared when selecting parents for crossover. Size 2 = weak selection (diverse). Size 7 = strong selection (fast but less diverse). Default 4.">ⓘ</span>
              <button v-if="tournamentSize !== FIELD_DEFAULTS.tournamentSize" @click="tournamentSize = FIELD_DEFAULTS.tournamentSize" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to ${FIELD_DEFAULTS.tournamentSize}`">↩</button>
            </label>
            <input v-model.number="tournamentSize" type="number" min="2" max="10"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', tournamentSize !== FIELD_DEFAULTS.tournamentSize ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
          <div>
            <label class="flex items-center gap-1 text-gray-400 mb-0.5">Max Order Len
              <span class="tip" data-tip="Maximum number of build steps in a chromosome. 30 = covers roughly 5 minutes of dense construction. Too long = more search space; too short = optimizer can't find complex strategies.">ⓘ</span>
              <button v-if="maxBuildOrderLength !== FIELD_DEFAULTS.maxBuildOrderLength" @click="maxBuildOrderLength = FIELD_DEFAULTS.maxBuildOrderLength" class="ml-auto text-yellow-500 hover:text-yellow-300 text-xs leading-none" :title="`Reset to ${FIELD_DEFAULTS.maxBuildOrderLength}`">↩</button>
            </label>
            <input v-model.number="maxBuildOrderLength" type="number" min="5" max="60"
              :class="['w-full bg-gray-700 border rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500', maxBuildOrderLength !== FIELD_DEFAULTS.maxBuildOrderLength ? 'border-yellow-600/60' : 'border-gray-600']" />
          </div>
        </div>
      </div>

      <!-- Unit Pool Filters -->
      <div class="bg-gray-800 rounded-lg p-3">
        <button
          @click="showUnitPoolFilters = !showUnitPoolFilters"
          class="w-full flex items-center justify-between text-sm font-semibold text-gray-400 uppercase"
        >
          <span>Unit Pool Filters</span>
          <span>{{ showUnitPoolFilters ? '▲' : '▼' }}</span>
        </button>
        <div v-if="showUnitPoolFilters" class="mt-3 space-y-3 text-sm">
          <p class="text-xs text-gray-500">
            Morph/upgrade targets and Commanders are always excluded.
            Units in the build result that violate active filters are
            highlighted in red.
          </p>

          <!-- Extra packs -->
          <div class="space-y-1.5">
            <p class="text-xs font-semibold text-gray-500 uppercase">Extra Packs (off = excluded)</p>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" v-model="unitPoolFilters.includeExtraUnits" class="w-3.5 h-3.5" />
              <span class="text-gray-300">Extra Units Pack</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" v-model="unitPoolFilters.includeScavengers" class="w-3.5 h-3.5" />
              <span class="text-gray-300">Scavengers Unit Pack</span>
            </label>
          </div>

          <!-- Tech levels -->
          <div class="space-y-1.5 border-t border-gray-700 pt-2">
            <p class="text-xs font-semibold text-gray-500 uppercase">Disable Tech Levels</p>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" v-model="unitPoolFilters.excludeTech15" class="w-3.5 h-3.5" />
              <span class="text-gray-300">Disable Tech 1.5 <span class="text-gray-500">(Advanced T1)</span></span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" v-model="unitPoolFilters.excludeTech2" class="w-3.5 h-3.5" />
              <span class="text-gray-300">Disable Tech 2</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" v-model="unitPoolFilters.excludeTech3" class="w-3.5 h-3.5" />
              <span class="text-gray-300">Disable Tech 3 / Experimental</span>
            </label>
          </div>

          <!-- Unit types -->
          <div class="space-y-1.5 border-t border-gray-700 pt-2">
            <p class="text-xs font-semibold text-gray-500 uppercase">Disable Unit Types</p>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" v-model="unitPoolFilters.excludeAir" class="w-3.5 h-3.5" />
              <span class="text-gray-300">Disable Air Units</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" v-model="unitPoolFilters.excludeNaval" class="w-3.5 h-3.5" />
              <span class="text-gray-300">Disable Naval Units <span class="text-gray-500">(ships, subs, shipyards)</span></span>
            </label>
          </div>

          <!-- Building categories -->
          <div class="space-y-1.5 border-t border-gray-700 pt-2">
            <p class="text-xs font-semibold text-gray-500 uppercase">Disable Building Categories</p>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" v-model="unitPoolFilters.excludeDefenses" class="w-3.5 h-3.5" />
              <span class="text-gray-300">Disable Defenses</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" v-model="unitPoolFilters.excludeMetalExtractors" class="w-3.5 h-3.5" />
              <span class="text-gray-300">Disable Metal Extractors</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" v-model="unitPoolFilters.excludeEnergyConverters" class="w-3.5 h-3.5" />
              <span class="text-gray-300">Disable Energy Converters</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" v-model="unitPoolFilters.excludeFusion" class="w-3.5 h-3.5" />
              <span class="text-gray-300">Disable Fusion Generators</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" v-model="unitPoolFilters.excludeTacticalMissiles" class="w-3.5 h-3.5" />
              <span class="text-gray-300">Disable Tactical Missiles / EMP</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" v-model="unitPoolFilters.excludeNuclearMissiles" class="w-3.5 h-3.5" />
              <span class="text-gray-300">Disable Nuclear Missiles</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" v-model="unitPoolFilters.excludeAntiNuke" class="w-3.5 h-3.5" />
              <span class="text-gray-300">Disable Anti-Nuke Devices</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" v-model="unitPoolFilters.excludeLongRangeArtillery" class="w-3.5 h-3.5" />
              <span class="text-gray-300">Disable Long-Range Artillery</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" v-model="unitPoolFilters.excludeEndgameArtillery" class="w-3.5 h-3.5" />
              <span class="text-gray-300">Disable Endgame Artillery</span>
            </label>
          </div>
        </div>
      </div>

      <!-- Fitness Weights -->
      <div class="bg-gray-800 rounded-lg p-3">
        <button
          @click="showFitnessWeights = !showFitnessWeights"
          class="w-full flex items-center justify-between text-sm font-semibold text-gray-400 uppercase"
        >
          <span>Fitness Tuning</span>
          <span>{{ showFitnessWeights ? '▲' : '▼' }}</span>
        </button>
        <div v-if="showFitnessWeights" class="mt-3 space-y-4 text-sm">
          <p class="text-xs text-gray-500">
            These constants control the sanity-adjustment bonuses and penalties
            applied on top of checkpoint scores. Set a value to 0 to disable
            that term entirely.
            <button
              @click="Object.assign(fitnessWeights, defaultFitnessWeights())"
              class="ml-2 text-blue-400 underline hover:text-blue-300"
            >Reset to defaults</button>
          </p>

          <!-- Goal Scoring -->
          <div class="space-y-2">
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Goal Scoring</p>
            <p class="text-xs text-gray-500 leading-relaxed">
              Each goal contributes <code class="bg-gray-700 px-1 rounded">achievement × weight</code> to the total score.
              <br>
              <span class="text-yellow-300">Continuous goals</span> (M/s, E/s, army metal, unit count, build power):
              <code class="bg-gray-700 px-1 rounded">achievement = min(actual / target, overcap)</code>.
              Overcap &gt; 1.0 rewards exceeding the target; set to 1.0 to make it a hard ceiling.
              <br>
              <span class="text-blue-300">Binary goals</span> (specific building / unit / unit category):
              <code class="bg-gray-700 px-1 rounded">1.0</code> if completed on time,
              <code class="bg-gray-700 px-1 rounded">partial</code> if the unit is anywhere in the build order but finishes late,
              <code class="bg-gray-700 px-1 rounded">0.0</code> if absent entirely.
              Set partial credit to 0 to use strict pass/fail scoring.
            </p>
            <div class="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-2 text-xs">
              <label class="text-gray-300" title="Maximum achievement ratio for proportional goals — 1.5 means exceeding target by 50% gives 50% bonus">
                Continuous goal overcap <span class="text-gray-500">(≥ 1.0)</span>
              </label>
              <input v-model.number="fitnessWeights.continuousOvercap" type="number" step="0.05" min="1" max="3"
                :class="['w-20 bg-gray-700 border rounded px-2 py-0.5 text-right font-mono text-xs text-white', fitnessWeights.continuousOvercap !== DEFAULT_FITNESS.continuousOvercap ? 'border-yellow-600/60' : 'border-gray-600']" />
              <button v-if="fitnessWeights.continuousOvercap !== DEFAULT_FITNESS.continuousOvercap" @click="fitnessWeights.continuousOvercap = DEFAULT_FITNESS.continuousOvercap" class="text-yellow-500 hover:text-yellow-300 text-xs" :title="`↩ ${DEFAULT_FITNESS.continuousOvercap}`">↩</button>
              <span v-else />

              <label class="text-gray-300" title="Score fraction awarded when a required unit/building appears in the build list but isn't complete by the target time">
                Binary goal partial credit <span class="text-gray-500">(in genes, not done)</span>
              </label>
              <input v-model.number="fitnessWeights.binaryPartialCredit" type="number" step="0.01" min="0" max="1"
                :class="['w-20 bg-gray-700 border rounded px-2 py-0.5 text-right font-mono text-xs text-white', fitnessWeights.binaryPartialCredit !== DEFAULT_FITNESS.binaryPartialCredit ? 'border-yellow-600/60' : 'border-gray-600']" />
              <button v-if="fitnessWeights.binaryPartialCredit !== DEFAULT_FITNESS.binaryPartialCredit" @click="fitnessWeights.binaryPartialCredit = DEFAULT_FITNESS.binaryPartialCredit" class="text-yellow-500 hover:text-yellow-300 text-xs" :title="`↩ ${DEFAULT_FITNESS.binaryPartialCredit}`">↩</button>
              <span v-else />
            </div>
          </div>

          <!-- Eco bonus -->
          <div class="space-y-2 border-t border-gray-700 pt-3">
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Bonuses</p>
            <div class="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-2 text-xs">
              <label class="text-gray-300" title="Added to score as: avgMetalIncome × multiplier">
                Eco bonus <span class="text-gray-500">(M/s × mult)</span>
              </label>
              <input v-model.number="fitnessWeights.ecoBonus" type="number" step="0.001" min="0" max="1"
                :class="['w-20 bg-gray-700 border rounded px-2 py-0.5 text-right font-mono text-xs text-white', fitnessWeights.ecoBonus !== DEFAULT_FITNESS.ecoBonus ? 'border-yellow-600/60' : 'border-gray-600']" />
              <button v-if="fitnessWeights.ecoBonus !== DEFAULT_FITNESS.ecoBonus" @click="fitnessWeights.ecoBonus = DEFAULT_FITNESS.ecoBonus" class="text-yellow-500 hover:text-yellow-300 text-xs" title="Reset">↩</button>
              <span v-else />

              <label class="text-gray-300" title="Added to score as: totalMetalSpent × multiplier">
                Throughput bonus <span class="text-gray-500">(metal-spent × mult)</span>
              </label>
              <input v-model.number="fitnessWeights.throughputBonus" type="number" step="0.000001" min="0" max="0.01"
                :class="['w-20 bg-gray-700 border rounded px-2 py-0.5 text-right font-mono text-xs text-white', fitnessWeights.throughputBonus !== DEFAULT_FITNESS.throughputBonus ? 'border-yellow-600/60' : 'border-gray-600']" />
              <button v-if="fitnessWeights.throughputBonus !== DEFAULT_FITNESS.throughputBonus" @click="fitnessWeights.throughputBonus = DEFAULT_FITNESS.throughputBonus" class="text-yellow-500 hover:text-yellow-300 text-xs" title="Reset">↩</button>
              <span v-else />

              <label class="text-gray-300" title="Max bonus for full energy coverage (scales linearly from 0 at 0 to max at threshold)">
                Energy coverage bonus <span class="text-gray-500">(gradient)</span>
              </label>
              <input v-model.number="fitnessWeights.energyCoverageBonus" type="number" step="0.01" min="0" max="1"
                :class="['w-20 bg-gray-700 border rounded px-2 py-0.5 text-right font-mono text-xs text-white', fitnessWeights.energyCoverageBonus !== DEFAULT_FITNESS.energyCoverageBonus ? 'border-yellow-600/60' : 'border-gray-600']" />
              <button v-if="fitnessWeights.energyCoverageBonus !== DEFAULT_FITNESS.energyCoverageBonus" @click="fitnessWeights.energyCoverageBonus = DEFAULT_FITNESS.energyCoverageBonus" class="text-yellow-500 hover:text-yellow-300 text-xs" title="Reset">↩</button>
              <span v-else />

              <label class="text-gray-300" title="E/s per total build-power — full bonus earned at this ratio">
                Energy coverage threshold <span class="text-gray-500">(E/s per BP)</span>
              </label>
              <input v-model.number="fitnessWeights.energyCoverageThreshold" type="number" step="0.01" min="0" max="2"
                :class="['w-20 bg-gray-700 border rounded px-2 py-0.5 text-right font-mono text-xs text-white', fitnessWeights.energyCoverageThreshold !== DEFAULT_FITNESS.energyCoverageThreshold ? 'border-yellow-600/60' : 'border-gray-600']" />
              <button v-if="fitnessWeights.energyCoverageThreshold !== DEFAULT_FITNESS.energyCoverageThreshold" @click="fitnessWeights.energyCoverageThreshold = DEFAULT_FITNESS.energyCoverageThreshold" class="text-yellow-500 hover:text-yellow-300 text-xs" title="Reset">↩</button>
              <span v-else />
            </div>
          </div>

          <!-- Banking penalty -->
          <div class="space-y-2 border-t border-gray-700 pt-3">
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Metal Banking Penalty</p>
            <div class="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-2 text-xs">
              <label class="text-gray-300" title="Average metal/cap ratio above this threshold triggers the penalty">
                Banking threshold <span class="text-gray-500">(0–1 ratio)</span>
              </label>
              <input v-model.number="fitnessWeights.bankingThreshold" type="number" step="0.01" min="0" max="1"
                :class="['w-20 bg-gray-700 border rounded px-2 py-0.5 text-right font-mono text-xs text-white', fitnessWeights.bankingThreshold !== DEFAULT_FITNESS.bankingThreshold ? 'border-yellow-600/60' : 'border-gray-600']" />
              <button v-if="fitnessWeights.bankingThreshold !== DEFAULT_FITNESS.bankingThreshold" @click="fitnessWeights.bankingThreshold = DEFAULT_FITNESS.bankingThreshold" class="text-yellow-500 hover:text-yellow-300 text-xs" title="Reset">↩</button>
              <span v-else />

              <label class="text-gray-300" title="Maximum score penalty for banking too much metal">
                Banking penalty max
              </label>
              <input v-model.number="fitnessWeights.bankingPenaltyMax" type="number" step="0.01" min="0" max="2"
                :class="['w-20 bg-gray-700 border rounded px-2 py-0.5 text-right font-mono text-xs text-white', fitnessWeights.bankingPenaltyMax !== DEFAULT_FITNESS.bankingPenaltyMax ? 'border-yellow-600/60' : 'border-gray-600']" />
              <button v-if="fitnessWeights.bankingPenaltyMax !== DEFAULT_FITNESS.bankingPenaltyMax" @click="fitnessWeights.bankingPenaltyMax = DEFAULT_FITNESS.bankingPenaltyMax" class="text-yellow-500 hover:text-yellow-300 text-xs" title="Reset">↩</button>
              <span v-else />
            </div>
          </div>

          <!-- Waste penalties -->
          <div class="space-y-2 border-t border-gray-700 pt-3">
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Overflow Waste Penalties</p>
            <div class="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-2 text-xs">
              <label class="text-gray-300" title="penalty = wasteFraction × multiplier, capped at max">Metal waste multiplier</label>
              <input v-model.number="fitnessWeights.metalWasteMultiplier" type="number" step="0.05" min="0" max="5"
                :class="['w-20 bg-gray-700 border rounded px-2 py-0.5 text-right font-mono text-xs text-white', fitnessWeights.metalWasteMultiplier !== DEFAULT_FITNESS.metalWasteMultiplier ? 'border-yellow-600/60' : 'border-gray-600']" />
              <button v-if="fitnessWeights.metalWasteMultiplier !== DEFAULT_FITNESS.metalWasteMultiplier" @click="fitnessWeights.metalWasteMultiplier = DEFAULT_FITNESS.metalWasteMultiplier" class="text-yellow-500 hover:text-yellow-300 text-xs" title="Reset">↩</button>
              <span v-else />

              <label class="text-gray-300">Metal waste max penalty</label>
              <input v-model.number="fitnessWeights.metalWasteMax" type="number" step="0.05" min="0" max="5"
                :class="['w-20 bg-gray-700 border rounded px-2 py-0.5 text-right font-mono text-xs text-white', fitnessWeights.metalWasteMax !== DEFAULT_FITNESS.metalWasteMax ? 'border-yellow-600/60' : 'border-gray-600']" />
              <button v-if="fitnessWeights.metalWasteMax !== DEFAULT_FITNESS.metalWasteMax" @click="fitnessWeights.metalWasteMax = DEFAULT_FITNESS.metalWasteMax" class="text-yellow-500 hover:text-yellow-300 text-xs" title="Reset">↩</button>
              <span v-else />

              <label class="text-gray-300">Energy waste multiplier</label>
              <input v-model.number="fitnessWeights.energyWasteMultiplier" type="number" step="0.05" min="0" max="5"
                :class="['w-20 bg-gray-700 border rounded px-2 py-0.5 text-right font-mono text-xs text-white', fitnessWeights.energyWasteMultiplier !== DEFAULT_FITNESS.energyWasteMultiplier ? 'border-yellow-600/60' : 'border-gray-600']" />
              <button v-if="fitnessWeights.energyWasteMultiplier !== DEFAULT_FITNESS.energyWasteMultiplier" @click="fitnessWeights.energyWasteMultiplier = DEFAULT_FITNESS.energyWasteMultiplier" class="text-yellow-500 hover:text-yellow-300 text-xs" title="Reset">↩</button>
              <span v-else />

              <label class="text-gray-300">Energy waste max penalty</label>
              <input v-model.number="fitnessWeights.energyWasteMax" type="number" step="0.05" min="0" max="5"
                :class="['w-20 bg-gray-700 border rounded px-2 py-0.5 text-right font-mono text-xs text-white', fitnessWeights.energyWasteMax !== DEFAULT_FITNESS.energyWasteMax ? 'border-yellow-600/60' : 'border-gray-600']" />
              <button v-if="fitnessWeights.energyWasteMax !== DEFAULT_FITNESS.energyWasteMax" @click="fitnessWeights.energyWasteMax = DEFAULT_FITNESS.energyWasteMax" class="text-yellow-500 hover:text-yellow-300 text-xs" title="Reset">↩</button>
              <span v-else />
            </div>
          </div>

          <!-- BP stall penalty -->
          <div class="space-y-2 border-t border-gray-700 pt-3">
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Build-Power Stall Penalty</p>
            <div class="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-2 text-xs">
              <label class="text-gray-300" title="penalty = stallFraction × multiplier, capped at max">Stall multiplier</label>
              <input v-model.number="fitnessWeights.stallMultiplier" type="number" step="0.05" min="0" max="5"
                :class="['w-20 bg-gray-700 border rounded px-2 py-0.5 text-right font-mono text-xs text-white', fitnessWeights.stallMultiplier !== DEFAULT_FITNESS.stallMultiplier ? 'border-yellow-600/60' : 'border-gray-600']" />
              <button v-if="fitnessWeights.stallMultiplier !== DEFAULT_FITNESS.stallMultiplier" @click="fitnessWeights.stallMultiplier = DEFAULT_FITNESS.stallMultiplier" class="text-yellow-500 hover:text-yellow-300 text-xs" title="Reset">↩</button>
              <span v-else />

              <label class="text-gray-300">Stall max penalty</label>
              <input v-model.number="fitnessWeights.stallMax" type="number" step="0.05" min="0" max="5"
                :class="['w-20 bg-gray-700 border rounded px-2 py-0.5 text-right font-mono text-xs text-white', fitnessWeights.stallMax !== DEFAULT_FITNESS.stallMax ? 'border-yellow-600/60' : 'border-gray-600']" />
              <button v-if="fitnessWeights.stallMax !== DEFAULT_FITNESS.stallMax" @click="fitnessWeights.stallMax = DEFAULT_FITNESS.stallMax" class="text-yellow-500 hover:text-yellow-300 text-xs" title="Reset">↩</button>
              <span v-else />

              <label class="col-span-3 text-gray-400 text-xs mt-1 font-semibold uppercase">Wind Storage Penalty</label>
              <label class="text-gray-300 flex items-center gap-1 col-span-3 text-xs text-gray-500">
                Penalises builds with many wind generators but insufficient energy storage to smooth wind variation.
                Required buffer = windCount × (windAvg − windMin) × bufferTime.
                Scales 0 → max as deficit fraction 0 → 1.
              </label>

              <label class="text-gray-300">Wind storage max penalty</label>
              <input v-model.number="fitnessWeights.windStoragePenaltyMax" type="number" step="0.01" min="0" max="1"
                :class="['w-20 bg-gray-700 border rounded px-2 py-0.5 text-right font-mono text-xs text-white', fitnessWeights.windStoragePenaltyMax !== DEFAULT_FITNESS.windStoragePenaltyMax ? 'border-yellow-600/60' : 'border-gray-600']" />
              <button v-if="fitnessWeights.windStoragePenaltyMax !== DEFAULT_FITNESS.windStoragePenaltyMax" @click="fitnessWeights.windStoragePenaltyMax = DEFAULT_FITNESS.windStoragePenaltyMax" class="text-yellow-500 hover:text-yellow-300 text-xs" title="Reset">↩</button>
              <span v-else />

              <label class="text-gray-300">Wind buffer time (s)</label>
              <input v-model.number="fitnessWeights.windBufferTime" type="number" step="1" min="0" max="120"
                :class="['w-20 bg-gray-700 border rounded px-2 py-0.5 text-right font-mono text-xs text-white', fitnessWeights.windBufferTime !== DEFAULT_FITNESS.windBufferTime ? 'border-yellow-600/60' : 'border-gray-600']" />
              <button v-if="fitnessWeights.windBufferTime !== DEFAULT_FITNESS.windBufferTime" @click="fitnessWeights.windBufferTime = DEFAULT_FITNESS.windBufferTime" class="text-yellow-500 hover:text-yellow-300 text-xs" title="Reset">↩</button>
              <span v-else />
            </div>
          </div>

          <!-- Energy deficit penalty -->
          <div class="space-y-2 border-t border-gray-700 pt-3">
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Energy Deficit Penalty</p>
            <p class="text-xs text-gray-500">
              Penalises builds that chronically run out of energy.
              Measured by average energy storage fill (0 = always empty, 1 = always full).
              Penalty scales from 0 → max as fill drops from threshold → 0.
            </p>
            <div class="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-2 text-xs">
              <label class="text-gray-300" title="Average energy fill fraction — below this the penalty activates">
                Deficit threshold <span class="text-gray-500">(fill ratio 0–1)</span>
              </label>
              <input v-model.number="fitnessWeights.energyDeficitThreshold" type="number" step="0.01" min="0" max="1"
                :class="['w-20 bg-gray-700 border rounded px-2 py-0.5 text-right font-mono text-xs text-white', fitnessWeights.energyDeficitThreshold !== DEFAULT_FITNESS.energyDeficitThreshold ? 'border-yellow-600/60' : 'border-gray-600']" />
              <button v-if="fitnessWeights.energyDeficitThreshold !== DEFAULT_FITNESS.energyDeficitThreshold" @click="fitnessWeights.energyDeficitThreshold = DEFAULT_FITNESS.energyDeficitThreshold" class="text-yellow-500 hover:text-yellow-300 text-xs" title="Reset">↩</button>
              <span v-else />

              <label class="text-gray-300" title="Maximum score penalty when avg energy fill is near 0">
                Deficit max penalty
              </label>
              <input v-model.number="fitnessWeights.energyDeficitPenaltyMax" type="number" step="0.05" min="0" max="5"
                :class="['w-20 bg-gray-700 border rounded px-2 py-0.5 text-right font-mono text-xs text-white', fitnessWeights.energyDeficitPenaltyMax !== DEFAULT_FITNESS.energyDeficitPenaltyMax ? 'border-yellow-600/60' : 'border-gray-600']" />
              <button v-if="fitnessWeights.energyDeficitPenaltyMax !== DEFAULT_FITNESS.energyDeficitPenaltyMax" @click="fitnessWeights.energyDeficitPenaltyMax = DEFAULT_FITNESS.energyDeficitPenaltyMax" class="text-yellow-500 hover:text-yellow-300 text-xs" title="Reset">↩</button>
              <span v-else />
            </div>
          </div>
        </div>
      </div>

      <!-- Sim Notes -->
      <div class="bg-gray-800 rounded-lg p-4 text-xs text-gray-500 space-y-1.5">
        <p class="font-semibold text-gray-400 uppercase text-xs">Reclaim Support</p>
        <p>
          <span class="text-green-400 font-semibold">Reclaim is fully modelled.</span>
          The optimizer can discover reclaim strategies via mutation. When a
          <span class="text-amber-400">↩ reclaim</span> action appears in the result:
        </p>
        <ul class="list-disc list-inside space-y-0.5 pl-1">
          <li>The building's metal cost is returned to storage (100 % efficiency).</li>
          <li>If it was a MEX or geo plant, the spot is freed for a new building.</li>
          <li>If it had energy/metal income, that income is removed.</li>
          <li>If it was a constructor or factory, that builder is removed from the field.</li>
        </ul>
        <p class="text-gray-600">Reclaim takes the same time as construction. Reclaim genes emerge via mutation — they won't appear unless the optimizer finds them beneficial for the goals.</p>
      </div>

    </aside>

    <!-- ── Right Panel (Results) ──────────────────────────────────────── -->
    <div class="flex-1 min-w-0 overflow-y-auto">

      <!-- Idle -->
      <div v-if="status === 'idle'" class="flex items-center justify-center h-64 text-gray-500">
        <div class="text-center">
          <p class="text-lg mb-2">Add goals and click Optimize</p>
          <p class="text-sm">The GA will find a build order that meets your checkpoints.</p>
        </div>
      </div>

      <!-- Running -->
      <div v-else-if="status === 'running'" class="space-y-4">
        <div class="bg-gray-800 rounded-lg p-4">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-semibold">Optimizing…</h3>
            <div class="text-right text-xs text-gray-400 space-y-0.5">
              <div v-if="latestProgress">
                Gen {{ latestProgress.generation }} / {{ maxGenerations }} —
                {{ (latestProgress.elapsedMs / 1000).toFixed(1) }}s elapsed
              </div>
              <div :class="timeSinceLastImprovementMs > 30000 ? 'text-yellow-400' : 'text-gray-500'">
                {{ formatTimeSince(timeSinceLastImprovementMs) }} since last improvement
              </div>
            </div>
          </div>
          <div v-if="latestProgress && latestStats" class="text-sm space-y-2">
            <!-- Fitness distribution -->
            <div class="grid grid-cols-4 gap-2 text-xs">
              <div class="bg-gray-900 rounded px-2 py-1.5">
                <span class="text-gray-500">Best</span>
                <span class="text-green-400 font-mono ml-1">{{ latestProgress.bestFitness.toFixed(4) }}</span>
              </div>
              <div class="bg-gray-900 rounded px-2 py-1.5">
                <span class="text-gray-500">Avg</span>
                <span class="text-gray-300 font-mono ml-1">{{ latestProgress.averageFitness.toFixed(4) }}</span>
              </div>
              <div class="bg-gray-900 rounded px-2 py-1.5">
                <span class="text-gray-500">Med</span>
                <span class="text-gray-300 font-mono ml-1">{{ latestStats.medianFitness.toFixed(4) }}</span>
              </div>
              <div class="bg-gray-900 rounded px-2 py-1.5">
                <span class="text-gray-500">&sigma;</span>
                <span class="text-gray-300 font-mono ml-1">{{ latestStats.fitnessStdDev.toFixed(3) }}</span>
              </div>
            </div>
            <!-- Diversity & stagnation -->
            <div class="flex flex-wrap gap-3 text-xs text-gray-400">
              <span>
                Diversity:
                <span :class="latestStats.uniqueChromosomeCount / populationSize < 0.5 ? 'text-yellow-400' : 'text-gray-300'" class="font-mono">
                  {{ latestStats.uniqueChromosomeCount }}/{{ populationSize }}
                </span> unique
              </span>
              <span>
                Jaccard <span class="font-mono text-gray-300">{{ latestStats.avgPairwiseDistance.toFixed(2) }}</span>
              </span>
              <span>
                Avg len <span class="font-mono text-gray-300">{{ latestStats.avgChromosomeLength.toFixed(0) }}</span>
              </span>
              <span>
                Stagnation:
                <span :class="latestStats.stagnationCounter > 50 ? 'text-yellow-400' : 'text-gray-300'" class="font-mono">
                  {{ latestStats.stagnationCounter }}
                </span> gens
              </span>
              <span>
                Archive: <span class="font-mono text-gray-300">{{ latestStats.goalArchiveSize }}/{{ checkpoints.length }}</span> goals
              </span>
            </div>
            <!-- Per-goal presence -->
            <div v-if="checkpoints.length > 0" class="space-y-1">
              <p class="text-xs text-gray-500 font-medium">Per-goal presence in population:</p>
              <div
                v-for="(cp, idx) in checkpoints"
                :key="idx"
                class="flex items-center gap-2 text-xs"
              >
                <div class="flex-1 flex items-center gap-1.5 min-w-0">
                  <span class="w-2 h-2 rounded-full flex-shrink-0"
                    :class="(latestStats.goalAchievementRates[idx] ?? 0) > 0.5 ? 'bg-green-500' : (latestStats.goalAchievementRates[idx] ?? 0) > 0 ? 'bg-yellow-500' : 'bg-red-500'"
                  />
                  <span class="text-gray-400 truncate">{{ checkpointLabel(cp) }}</span>
                </div>
                <span class="font-mono text-gray-300 flex-shrink-0 w-10 text-right">
                  {{ ((latestStats.goalAchievementRates[idx] ?? 0) * 100).toFixed(0) }}%
                </span>
              </div>
            </div>
            <!-- GA warnings -->
            <div v-if="gaWarnings.length > 0" class="space-y-1 mt-1">
              <div
                v-for="(w, idx) in gaWarnings"
                :key="idx"
                :class="[
                  'text-xs px-2 py-1 rounded',
                  w.level === 'critical' ? 'bg-red-900/40 text-red-300 border border-red-700/40' :
                  w.level === 'warning'  ? 'bg-yellow-900/40 text-yellow-300 border border-yellow-700/40' :
                                           'bg-blue-900/40 text-blue-300 border border-blue-700/40',
                ]"
              >{{ w.text }}</div>
            </div>
            <!-- Best order preview -->
            <p class="text-xs text-gray-500">
              Best order ({{ latestProgress.bestChromosome.genes.length }} items):
              {{ latestProgress.bestChromosome.genes.slice(0, 10).map(id => unitForId(id)?.name ?? id).join(' → ') }}{{ latestProgress.bestChromosome.genes.length > 10 ? '…' : '' }}
            </p>
          </div>
          <div v-else-if="latestProgress" class="text-sm space-y-1">
            <p class="text-gray-300">
              Best fitness: <span class="text-green-400 font-mono">{{ latestProgress.bestFitness.toFixed(4) }}</span>
              &nbsp; Avg: <span class="text-gray-400 font-mono">{{ latestProgress.averageFitness.toFixed(4) }}</span>
            </p>
          </div>
          <div v-else class="text-sm text-gray-400 animate-pulse">Initializing population…</div>
        </div>

        <!-- Live fitness sparkline -->
        <div v-if="fitnessChartData" class="bg-gray-800 rounded-lg p-4" style="height: 220px">
          <Line :data="fitnessChartData" :options="fitnessChartOptions" />
        </div>
      </div>

      <!-- Done -->
      <div v-else-if="status === 'done' && result" class="space-y-4">

        <!-- Summary -->
        <div class="bg-gray-800 rounded-lg p-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold">Optimization Complete</h3>
            <span class="text-xs text-gray-400">
              {{ result.totalGenerations }} gen — {{ (result.elapsedMs / 1000).toFixed(1) }}s
              — fitness {{ result.bestChromosome.fitness.toFixed(4) }}
            </span>
          </div>

          <!-- Checkpoint achievements -->
          <div class="space-y-1.5 mb-4">
            <h4 class="text-xs font-semibold text-gray-400 uppercase">Checkpoint Results</h4>
            <div
              v-for="(ach, idx) in checkpointAchievements"
              :key="idx"
              :class="[
                'flex items-center gap-2 text-sm px-2 py-1.5 rounded',
                ach.achieved ? 'bg-green-900/30 border border-green-700/50' : 'bg-red-900/20 border border-red-700/30'
              ]"
            >
              <span :class="ach.achieved ? 'text-green-400' : 'text-red-400'">
                {{ ach.achieved ? '✓' : '✗' }}
              </span>
              <span class="text-gray-300 flex-1">{{ ach.label }}</span>
              <span v-if="gaSummary && gaSummary.goalRates[idx] != null" class="text-xs text-gray-500 font-mono">
                {{ (gaSummary.goalRates[idx] * 100).toFixed(0) }}% of pop
              </span>
            </div>
          </div>

          <!-- GA Summary -->
          <div v-if="gaSummary" class="mb-4">
            <h4 class="text-xs font-semibold text-gray-400 uppercase mb-2">GA Summary</h4>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <div class="bg-gray-900 rounded px-2 py-1.5">
                <span class="text-gray-500">Generations</span>
                <span class="text-gray-200 font-mono ml-1">{{ gaSummary.totalGenerations }}</span>
              </div>
              <div class="bg-gray-900 rounded px-2 py-1.5">
                <span class="text-gray-500">Improvements</span>
                <span class="text-gray-200 font-mono ml-1">{{ gaSummary.totalImprovements }}</span>
              </div>
              <div class="bg-gray-900 rounded px-2 py-1.5">
                <span class="text-gray-500">Final diversity</span>
                <span class="text-gray-200 font-mono ml-1">{{ gaSummary.finalDiversity }} unique</span>
              </div>
              <div class="bg-gray-900 rounded px-2 py-1.5">
                <span class="text-gray-500">Final stagnation</span>
                <span :class="gaSummary.finalStagnation > 50 ? 'text-yellow-400' : 'text-gray-200'" class="font-mono ml-1">{{ gaSummary.finalStagnation }} gens</span>
              </div>
              <div class="bg-gray-900 rounded px-2 py-1.5 sm:col-span-2">
                <span class="text-gray-500">Time to best</span>
                <span class="text-gray-200 font-mono ml-1">{{ gaSummary.timeToBest }}</span>
              </div>
            </div>
          </div>

          <!-- Build Order -->
          <h4 class="text-xs font-semibold text-gray-400 uppercase mb-2">Build Order
            <span class="text-gray-600 font-normal normal-case ml-1">(click row for details)</span>
          </h4>
          <div class="max-h-[500px] overflow-y-auto rounded border border-gray-700">
            <table class="w-full text-xs border-collapse">
              <thead class="sticky top-0 bg-gray-900 z-10">
                <tr class="text-gray-500 border-b border-gray-700">
                  <th class="text-right pr-1 py-1 w-6 font-normal">#</th>
                  <th class="text-right pr-2 py-1 w-12 font-normal">Time</th>
                  <th class="text-left pr-2 py-1 font-normal">Unit</th>
                  <th class="text-right pr-2 py-1 w-14 font-normal">Cost</th>
                  <th class="text-right pr-2 py-1 w-16 font-normal" title="Metal income change per second">Δ M/s</th>
                  <th class="text-right pr-2 py-1 w-16 font-normal" title="Energy income change per second (production minus upkeep)">Δ E/s</th>
                  <th class="text-right pr-2 py-1 w-12 font-normal" title="Build power added">Δ BP</th>
                  <th class="text-right pr-2 py-1 w-20 font-normal" title="Storage capacity added">Storage</th>
                  <th class="text-left py-1 font-normal" title="Energy converter output when surplus energy available">Converter</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(event, idx) in result.simResult.buildTimeline"
                  :key="idx"
                  @click="selectedBuildOrderUnit = unitForId(event.unitId) ?? null"
                  :class="[
                    'cursor-pointer hover:bg-gray-700/60 transition-colors border-b border-gray-800',
                    event.isReclaim ? 'bg-amber-900/10' : ''
                  ]"
                  :title="event.isReclaim
                    ? `Reclaim: returns ${event.metalCost}M to storage`
                    : isBannedByCurrentFilters(event.unitId) ? 'This unit is excluded by current Unit Pool Filters' : undefined"
                >
                  <!-- # -->
                  <td class="text-right pr-1 py-1 text-gray-600 select-none">{{ idx + 1 }}</td>
                  <!-- Time -->
                  <td class="text-right pr-2 py-1 text-gray-500">@{{ event.completedAtSeconds.toFixed(0) }}s</td>
                  <!-- Unit name -->
                  <td class="pr-2 py-1 font-medium"
                    :class="event.isReclaim ? 'text-amber-400 italic' : isBannedByCurrentFilters(event.unitId) ? 'text-red-400' : 'text-gray-200'"
                  >
                    <span v-if="event.isReclaim" class="mr-1">↩</span>{{ event.unitName }}
                  </td>
                  <!-- Cost -->
                  <td class="text-right pr-2 py-1"
                    :class="event.isReclaim ? 'text-amber-400 font-medium' : 'text-gray-400'"
                  >
                    {{ event.isReclaim ? `+${event.metalCost}M` : `${event.metalCost}M` }}
                  </td>
                  <!-- Δ M/s -->
                  <td class="text-right pr-2 py-1"
                    :class="event.metalDelta && event.metalDelta > 0 ? 'text-blue-400' : 'text-gray-600'"
                  >
                    {{ event.metalDelta ? `+${event.metalDelta.toFixed(1)}` : '' }}
                  </td>
                  <!-- Δ E/s -->
                  <td class="text-right pr-2 py-1"
                    :class="(event.energyDelta ?? 0) > 0 ? 'text-yellow-400' : (event.energyDelta ?? 0) < 0 ? 'text-orange-500' : 'text-gray-600'"
                  >
                    {{ event.energyDelta ? (event.energyDelta > 0 ? '+' : '') + event.energyDelta.toFixed(1) : '' }}
                  </td>
                  <!-- Δ BP -->
                  <td class="text-right pr-2 py-1 text-purple-400">
                    {{ event.buildPowerDelta ? `+${event.buildPowerDelta}` : '' }}
                  </td>
                  <!-- Storage -->
                  <td class="text-right pr-2 py-1 text-gray-400">
                    <span v-if="event.metalStorageDelta || event.energyStorageDelta">
                      <span v-if="event.metalStorageDelta" class="text-blue-300">+{{ event.metalStorageDelta }}M</span>
                      <span v-if="event.metalStorageDelta && event.energyStorageDelta" class="text-gray-600"> / </span>
                      <span v-if="event.energyStorageDelta" class="text-yellow-300">+{{ event.energyStorageDelta }}E</span>
                    </span>
                  </td>
                  <!-- Converter -->
                  <td class="py-1 text-green-400">
                    <span v-if="event.converterCapacity" :title="`Consumes up to ${event.converterCapacity}E/s of surplus energy to produce ${event.converterMetalPerSec}M/s`">
                      {{ event.converterCapacity }}E→{{ event.converterMetalPerSec }}M/s
                    </span>
                  </td>
                </tr>
                <tr v-if="result.simResult.buildTimeline.length === 0">
                  <td colspan="9" class="text-gray-500 italic text-center py-3">
                    No units completed — try longer duration or simpler goals.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Charts -->
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">

          <!-- Chart 1: Metal & Energy amounts -->
          <div v-if="resourceChartData" class="bg-gray-800 rounded-lg p-4" style="height: 260px">
            <h4 class="text-xs font-semibold text-gray-400 uppercase mb-2">Metal & Energy</h4>
            <div style="height: 210px">
              <Line :data="resourceChartData" :options="darkChartOptions" />
            </div>
          </div>

          <!-- Chart 2a: Metal flow -->
          <div v-if="metalFlowChartData" class="bg-gray-800 rounded-lg p-4" style="height: 260px">
            <h4 class="text-xs font-semibold text-gray-400 uppercase mb-2">Metal Flow</h4>
            <div style="height: 210px">
              <Line :data="metalFlowChartData" :options="darkChartOptions" />
            </div>
          </div>
          <!-- Chart 2b: Energy flow -->
          <div v-if="energyFlowChartData" class="bg-gray-800 rounded-lg p-4" style="height: 260px">
            <h4 class="text-xs font-semibold text-gray-400 uppercase mb-2">Energy Flow</h4>
            <div style="height: 210px">
              <Line :data="energyFlowChartData" :options="darkChartOptions" />
            </div>
          </div>

          <!-- Chart 3: Metal spent -->
          <div v-if="metalSpentChartData" class="bg-gray-800 rounded-lg p-4" style="height: 260px">
            <h4 class="text-xs font-semibold text-gray-400 uppercase mb-2">Metal Spent</h4>
            <div style="height: 210px">
              <Line :data="metalSpentChartData" :options="darkChartOptions" />
            </div>
          </div>

          <!-- Chart 4: Fitness convergence -->
          <div v-if="fitnessChartData" class="bg-gray-800 rounded-lg p-4" style="min-height: 260px">
            <div class="flex items-start justify-between mb-2 gap-2">
              <h4 class="text-xs font-semibold text-gray-400 uppercase shrink-0">Fitness Convergence</h4>
              <span class="tip tip-left text-gray-500 text-xs shrink-0 cursor-help" data-tip="How fitness is calculated:&#10;• For each goal: achievement × weight is added to the score.&#10;• Income/army/buildpower goals: achievement = min(actual ÷ target, 1.5). Capped at 1.5× so overshooting is slightly rewarded but not dominant.&#10;• Building/unit/category goals: 1.0 if completed by deadline, 0.1 if queued but not yet done, 0.0 if absent.&#10;• Tiebreaker: +0.0001 × final metal income to prefer richer economies when scores are equal.&#10;&#10;Best = top individual ever seen. Avg = mean of current generation.">ⓘ How fitness works</span>
            </div>
            <div style="height: 210px">
              <Line :data="fitnessChartData" :options="fitnessChartOptions" />
            </div>
          </div>

          <!-- Chart 5: Diversity over time -->
          <div v-if="diversityChartData" class="bg-gray-800 rounded-lg p-4" style="min-height: 260px">
            <h4 class="text-xs font-semibold text-gray-400 uppercase mb-2">Population Diversity</h4>
            <div style="height: 210px">
              <Line :data="diversityChartData" :options="diversityChartOptions" />
            </div>
          </div>

          <!-- Chart 6: Goal presence over time -->
          <div v-if="goalPresenceChartData" class="bg-gray-800 rounded-lg p-4" style="min-height: 260px">
            <h4 class="text-xs font-semibold text-gray-400 uppercase mb-2">Goal Presence in Population</h4>
            <div style="height: 210px">
              <Line :data="goalPresenceChartData" :options="goalPresenceChartOptions" />
            </div>
          </div>

        </div>

        <!-- ── Fitness Analysis ──────────────────────────────────────────── -->
        <div v-if="fitnessBreakdown" class="space-y-4">

          <!-- Score breakdown horizontal bar -->
          <div class="bg-gray-800 rounded-lg p-4">
            <div class="flex items-start justify-between mb-2">
              <h4 class="text-xs font-semibold text-gray-400 uppercase">Fitness Score Breakdown</h4>
              <span class="text-xs text-gray-500 font-mono">
                Total: <span class="text-white font-bold">{{ fitnessBreakdown.totalScore.toFixed(4) }}</span>
                &nbsp;(goals: {{ fitnessBreakdown.totalGoalScore.toFixed(4) }},
                adj: {{ fitnessBreakdown.totalSanityScore.toFixed(4) }})
              </span>
            </div>
            <p class="text-xs text-gray-600 mb-2">
              Blue = goal contributions · Green = bonuses · Red = penalties.
              Computed from full-fidelity sim — may differ slightly from training fitness.
            </p>
            <div :style="{ height: Math.max(180, (checkpoints.length + 8) * 26) + 'px' }">
              <Bar
                v-if="breakdownChartData"
                :data="breakdownChartData"
                :options="{
                  ...darkChartOptions,
                  indexAxis: 'y',
                  plugins: { ...darkChartOptions.plugins, legend: { display: false } },
                  scales: {
                    x: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { color: '#374151' } },
                    y: { ticks: { color: '#d1d5db', font: { size: 10 } }, grid: { color: '#374151' } },
                  },
                }"
              />
            </div>
          </div>

          <!-- Cumulative fitness over time -->
          <div class="bg-gray-800 rounded-lg p-4" style="height: 280px">
            <div class="flex items-start justify-between mb-2">
              <h4 class="text-xs font-semibold text-gray-400 uppercase">Fitness Accumulation Over Time</h4>
              <span class="text-xs text-gray-500">
                White = total · Blue = goals (steps at each deadline) · Green = sanity adjustments
              </span>
            </div>
            <div style="height: 220px">
              <Line
                v-if="cumulativeFitnessChartData"
                :data="cumulativeFitnessChartData"
                :options="darkChartOptions"
              />
            </div>
          </div>

        </div>

        <!-- Timeline -->
        <div
          v-if="displayResult && displayResult.builderTimeline.length > 0"
          class="bg-gray-800 rounded-lg p-4"
        >
          <h4 class="text-xs font-semibold text-gray-400 uppercase mb-3">Timeline</h4>

          <!-- Playback controls -->
          <div class="flex items-center gap-3 mb-3">
            <button
              @click="timelinePlaying ? stopTimelinePlayback() : playTimeline()"
              class="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded transition-colors text-sm"
              :title="timelinePlaying ? 'Pause' : 'Play'"
            >{{ timelinePlaying ? '⏸' : '▶' }}</button>
            <input
              type="range"
              v-model.number="timelineTime"
              :min="0"
              :max="timelineMaxTime"
              step="1"
              class="flex-1 accent-blue-500"
              @input="stopTimelinePlayback()"
            />
            <span class="flex-shrink-0 text-xs text-gray-400 w-14 text-right font-mono">
              {{ timelineTime }}s / {{ timelineMaxTime }}s
            </span>
          </div>

          <!-- Resource status at current time -->
          <div v-if="currentSimSnapshot" class="mb-3 space-y-2">
            <!-- Resource bars -->
            <div class="grid grid-cols-2 gap-2 text-xs">
              <!-- Metal -->
              <div class="bg-gray-900 rounded p-2 space-y-1">
                <div class="flex justify-between items-baseline">
                  <span class="text-yellow-400 font-semibold">Metal</span>
                  <span class="font-mono text-gray-200">
                    {{ currentSimSnapshot.currentMetal.toFixed(0) }}
                    <span class="text-gray-500">/ {{ currentSimSnapshot.metalCap }}</span>
                  </span>
                </div>
                <div class="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all"
                    :class="currentSimSnapshot.currentMetal / currentSimSnapshot.metalCap > 0.95 ? 'bg-orange-400' : 'bg-yellow-500'"
                    :style="{ width: `${Math.min(currentSimSnapshot.currentMetal / currentSimSnapshot.metalCap * 100, 100).toFixed(1)}%` }"
                  />
                </div>
                <div v-if="currentRates" class="flex flex-wrap gap-2 text-gray-400 font-mono text-xs">
                  <span class="text-green-400">+{{ currentRates.metalIncome.toFixed(2) }}</span>
                  <span v-if="currentRates.converterRate > 0" class="text-purple-400" title="Energy converter output">+{{ currentRates.converterRate.toFixed(2) }} conv</span>
                  <span class="text-red-400">-{{ currentRates.metalExpense.toFixed(2) }}</span>
                  <span :class="currentRates.metalDelta >= 0 ? 'text-cyan-400' : 'text-orange-400'">
                    Δ {{ currentRates.metalDelta >= 0 ? '+' : '' }}{{ (currentRates.metalDelta + currentRates.converterRate).toFixed(2) }}
                  </span>
                </div>
              </div>
              <!-- Energy -->
              <div class="bg-gray-900 rounded p-2 space-y-1">
                <div class="flex justify-between items-baseline">
                  <span class="text-cyan-400 font-semibold">Energy</span>
                  <span class="font-mono text-gray-200">
                    {{ currentSimSnapshot.currentEnergy.toFixed(0) }}
                    <span class="text-gray-500">/ {{ currentSimSnapshot.energyCap }}</span>
                  </span>
                </div>
                <div class="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all"
                    :class="currentSimSnapshot.currentEnergy / currentSimSnapshot.energyCap > 0.95 ? 'bg-orange-400' : 'bg-cyan-500'"
                    :style="{ width: `${Math.min(currentSimSnapshot.currentEnergy / currentSimSnapshot.energyCap * 100, 100).toFixed(1)}%` }"
                  />
                </div>
                <div v-if="currentRates" class="flex gap-2 text-gray-400 font-mono text-xs">
                  <span class="text-green-400">+{{ currentRates.energyIncome.toFixed(1) }}</span>
                  <span class="text-red-400">-{{ currentRates.energyExpense.toFixed(1) }}</span>
                  <span :class="currentRates.energyDelta >= 0 ? 'text-cyan-400' : 'text-orange-400'">
                    Δ {{ currentRates.energyDelta >= 0 ? '+' : '' }}{{ currentRates.energyDelta.toFixed(1) }}
                  </span>
                </div>
              </div>
            </div>
            <!-- Warnings -->
            <div v-if="timelineWarnings.length > 0" class="flex flex-wrap gap-1.5">
              <span
                v-for="w in timelineWarnings" :key="w.msg"
                :class="[
                  'text-xs px-2 py-0.5 rounded font-medium',
                  w.level === 'crit' ? 'bg-red-900/60 text-red-300 border border-red-700/50'
                                     : 'bg-orange-900/60 text-orange-300 border border-orange-700/50',
                ]"
              >{{ w.msg }}</span>
            </div>
          </div>

          <!-- Builder table at selected time -->
          <div v-if="currentTimelineSnapshot" class="overflow-x-auto mb-3">
            <table class="w-full text-xs">
              <thead>
                <tr class="text-gray-500 border-b border-gray-700">
                  <th class="text-left py-1 pr-3 font-medium">Builder</th>
                  <th class="text-left py-1 pr-3 font-medium">Current Task</th>
                  <th class="text-left py-1 pr-3 font-medium w-28">Progress</th>
                  <th class="text-right py-1 pr-2 font-medium">M/s</th>
                  <th class="text-right py-1 pr-2 font-medium">E/s</th>
                  <th class="text-right py-1 font-medium">BP%</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(entry, bi) in currentTimelineSnapshot.builders"
                  :key="bi"
                  class="border-b border-gray-700/50"
                >
                  <td class="py-1 pr-3 text-gray-300 whitespace-nowrap">{{ entry.builderName }}</td>
                  <td class="py-1 pr-3 whitespace-nowrap">
                    <span v-if="entry.taskUnitName" class="text-gray-200">{{ entry.taskUnitName }}</span>
                    <span v-else class="text-gray-600 italic">Idle</span>
                  </td>
                  <td class="py-1 pr-3">
                    <div v-if="entry.taskUnitName" class="flex items-center gap-1.5">
                      <div class="flex-1 bg-gray-700 rounded-full h-1.5 min-w-0">
                        <div
                          class="bg-blue-500 h-1.5 rounded-full"
                          :style="{ width: `${(entry.progressFraction * 100).toFixed(0)}%` }"
                        />
                      </div>
                      <span class="text-gray-500 w-8 text-right flex-shrink-0">
                        {{ (entry.progressFraction * 100).toFixed(0) }}%
                      </span>
                    </div>
                  </td>
                  <td class="py-1 pr-2 text-right text-blue-300 font-mono">
                    <span v-if="entry.metalDemandRate > 0">{{ entry.metalDemandRate.toFixed(1) }}</span>
                    <span v-else class="text-gray-600">—</span>
                  </td>
                  <td class="py-1 pr-2 text-right text-yellow-400 font-mono">
                    <span v-if="entry.energyDemandRate > 0">{{ entry.energyDemandRate.toFixed(0) }}</span>
                    <span v-else class="text-gray-600">—</span>
                  </td>
                  <td class="py-1 text-right font-mono">
                    <span
                      v-if="entry.taskUnitName"
                      :class="[
                        entry.bpUtilization >= 0.99 ? 'text-green-400' :
                        entry.bpUtilization >= 0.5  ? 'text-yellow-400' :
                        entry.bpUtilization > 0     ? 'text-red-400' : 'text-gray-600'
                      ]"
                    >{{ (entry.bpUtilization * 100).toFixed(0) }}%</span>
                    <span v-else class="text-gray-600">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Economy units at current time -->
          <div v-if="aliveUnitsAtTime.ecoRows.length > 0" class="mt-3">
            <p class="text-xs font-semibold text-gray-400 mb-1.5">Economy at {{ timelineTime }}s</p>
            <div class="overflow-x-auto rounded border border-gray-700">
              <table class="w-full text-xs border-collapse">
                <thead class="bg-gray-900">
                  <tr class="text-gray-500 border-b border-gray-700">
                    <th class="text-right pr-1 py-1 w-6 font-normal">#</th>
                    <th class="text-left pr-2 py-1 font-normal">Unit</th>
                    <th class="text-right pr-2 py-1 w-16 font-normal" title="Total metal income from this unit type">M/s</th>
                    <th class="text-right pr-2 py-1 w-16 font-normal" title="Total net energy (production minus upkeep)">E/s net</th>
                    <th class="text-right pr-2 py-1 w-12 font-normal" title="Build power">BP</th>
                    <th class="text-right pr-2 py-1 w-20 font-normal" title="Storage capacity">Storage</th>
                    <th class="text-left py-1 font-normal" title="Energy converter: consumes surplus energy to produce metal">Converter</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in aliveUnitsAtTime.ecoRows"
                    :key="row.id"
                    class="border-b border-gray-800"
                  >
                    <!-- Count -->
                    <td class="text-right pr-1 py-1 text-gray-500">{{ row.count > 1 ? `${row.count}×` : '' }}</td>
                    <!-- Name -->
                    <td class="pr-2 py-1 text-gray-200 font-medium">{{ row.name }}</td>
                    <!-- M/s total -->
                    <td class="text-right pr-2 py-1 font-mono"
                      :class="row.metalPerUnit > 0 ? 'text-blue-400' : 'text-gray-600'">
                      {{ row.metalPerUnit > 0 ? (row.metalPerUnit * row.count).toFixed(1) : '—' }}
                    </td>
                    <!-- E/s net total -->
                    <td class="text-right pr-2 py-1 font-mono">
                      <template v-if="row.isConverter">
                        <!-- Converters: show live consumption when active, else idle -->
                        <template v-if="currentSimSnapshot && currentSimSnapshot.currentEnergy > currentSimSnapshot.energyCap * 0.75">
                          <span class="text-orange-400">-{{ (row.converterCapPerUnit * row.count).toFixed(0) }}</span>
                        </template>
                        <span v-else class="text-gray-600 italic text-[10px]">idle</span>
                      </template>
                      <template v-else-if="row.energyNetPerUnit !== 0">
                        <span :class="row.energyNetPerUnit > 0 ? 'text-yellow-400' : 'text-orange-500'">
                          {{ row.energyNetPerUnit > 0 ? '+' : '' }}{{ (row.energyNetPerUnit * row.count).toFixed(1) }}
                        </span>
                      </template>
                      <span v-else class="text-gray-600">—</span>
                    </td>
                    <!-- BP total -->
                    <td class="text-right pr-2 py-1 font-mono text-purple-400">
                      {{ row.buildPowerPerUnit > 0 ? (row.buildPowerPerUnit * row.count) : '' }}
                    </td>
                    <!-- Storage total -->
                    <td class="text-right pr-2 py-1 font-mono">
                      <span v-if="row.metalStoragePerUnit > 0 || row.energyStoragePerUnit > 0">
                        <span v-if="row.metalStoragePerUnit > 0" class="text-blue-300">{{ (row.metalStoragePerUnit * row.count) }}M</span>
                        <span v-if="row.metalStoragePerUnit > 0 && row.energyStoragePerUnit > 0" class="text-gray-600"> / </span>
                        <span v-if="row.energyStoragePerUnit > 0" class="text-yellow-300">{{ (row.energyStoragePerUnit * row.count) }}E</span>
                      </span>
                      <span v-else class="text-gray-600">—</span>
                    </td>
                    <!-- Converter -->
                    <td class="py-1 font-mono">
                      <span v-if="row.isConverter">
                        <!-- Capacity info -->
                        <span class="text-gray-500">{{ row.converterCapPerUnit }}E→{{ row.converterMetalPerUnit.toFixed(2) }}M/s</span>
                        <!-- Live rate when active -->
                        <template v-if="currentSimSnapshot && currentSimSnapshot.currentEnergy > currentSimSnapshot.energyCap * 0.75">
                          <span class="text-green-400 ml-1 font-semibold">
                            ▶ +{{ ((currentRates?.converterRate ?? 0) * (row.converterCapPerUnit * row.count) / (aliveUnitsAtTime.ecoRows.filter(r => r.isConverter).reduce((s,r) => s + r.converterCapPerUnit * r.count, 0) || 1)).toFixed(2) }}M/s
                          </span>
                        </template>
                        <span v-else class="text-gray-600 ml-1 text-[10px]">⏸ idle</span>
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Builders & military summary -->
          <div
            v-if="aliveUnitsAtTime.builderRows.length > 0 || aliveUnitsAtTime.militaryRows.length > 0"
            class="mt-2 space-y-1"
          >
            <div v-if="aliveUnitsAtTime.builderRows.length > 0" class="flex flex-wrap gap-1">
              <span class="text-xs text-gray-500 mr-1">Builders:</span>
              <span
                v-for="row in aliveUnitsAtTime.builderRows"
                :key="row.id"
                class="text-xs px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-700/30"
              >
                {{ row.count > 1 ? `${row.count}× ` : '' }}{{ row.name }}
              </span>
            </div>
            <div v-if="aliveUnitsAtTime.militaryRows.length > 0" class="flex flex-wrap gap-1">
              <span class="text-xs text-gray-500 mr-1">Military:</span>
              <span
                v-for="row in aliveUnitsAtTime.militaryRows"
                :key="row.id"
                class="text-xs px-1.5 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-700/30"
              >
                {{ row.count > 1 ? `${row.count}× ` : '' }}{{ row.name }}
              </span>
            </div>
          </div>
        </div>

      </div>

    </div>
  </div>

  <!-- ── Add Goal Modal ─────────────────────────────────────────────── -->
  <div
    v-if="showAddGoalModal"
    class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
    @click.self="showAddGoalModal = false"
  >
    <div class="bg-gray-800 rounded-lg w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
      <h2 class="text-lg font-bold">{{ editingGoalIndex !== null ? 'Edit Goal' : 'Add Goal' }}</h2>

      <!-- Goal Type — grouped -->
      <div>
        <label class="block text-sm text-gray-400 mb-0.5">Goal Type</label>
        <select
          v-model="newGoalType"
          class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
        >
          <optgroup label="── Economy ──────────────">
            <option value="metalIncome">Metal Income ≥ X M/s</option>
            <option value="energyIncome">Energy Income ≥ X E/s</option>
            <option value="buildPower">Total Build Power ≥ X</option>
          </optgroup>
          <optgroup label="── Military ─────────────">
            <option value="armyMetal">Army Metal (alive units) ≥ X M</option>
            <option value="armyDps">Army DPS (alive units) ≥ X</option>
            <option value="armyHealth">Army Health (alive units) ≥ X</option>
            <option value="armyComposition">Army Composition — % ground or air</option>
          </optgroup>
          <optgroup label="── Build Order ──────────">
            <option value="unitCategory">Any unit of category (T2 factory etc.)</option>
            <option value="building">Specific building completed</option>
            <option value="unit">Specific unit completed</option>
            <option value="unitCount">N× specific unit alive</option>
          </optgroup>
        </select>
        <!-- Type description -->
        <p class="mt-1.5 text-xs text-gray-500">
          <template v-if="newGoalType === 'metalIncome'">Reward build orders that achieve a metal income rate ≥ target by the deadline.</template>
          <template v-else-if="newGoalType === 'energyIncome'">Reward build orders that achieve an energy income rate ≥ target by the deadline.</template>
          <template v-else-if="newGoalType === 'buildPower'">Reward build orders that have total active build power (commander + constructors + factories) ≥ target.</template>
          <template v-else-if="newGoalType === 'armyMetal'">Metal value of currently ALIVE mobile combat units. Reclaiming a unit reduces this — exploit-free.</template>
          <template v-else-if="newGoalType === 'armyDps'">Total DPS of currently alive mobile combat units (sum of all weapon DPS).</template>
          <template v-else-if="newGoalType === 'armyHealth'">Total HP of currently alive mobile combat units. Rewards tanky compositions.</template>
          <template v-else-if="newGoalType === 'armyComposition'">Fraction of army DPS that comes from ground (bots/vehicles/ships) or air (aircraft). Prevents irrelevant unit types from dominating the army.</template>
          <template v-else-if="newGoalType === 'unitCategory'">Reward build orders that have completed at least one unit matching a broad category by the deadline.</template>
          <template v-else-if="newGoalType === 'building'">Require a specific building (by exact unit) to be completed by the deadline.</template>
          <template v-else-if="newGoalType === 'unit'">Require a specific unit to be completed by the deadline.</template>
          <template v-else-if="newGoalType === 'unitCount'">Require at least N alive (not reclaimed) instances of a specific unit at the deadline.</template>
        </p>
      </div>

      <!-- Category picker (for unitCategory type) -->
      <div v-if="needsCategoryPicker">
        <label class="block text-sm text-gray-400 mb-0.5">Category</label>
        <div class="grid grid-cols-1 gap-1">
          <button
            v-for="cat in unitCategoryOptions"
            :key="cat.id"
            @click="newGoalCategoryId = cat.id"
            :class="[
              'text-left px-3 py-2 rounded text-sm transition-colors border',
              newGoalCategoryId === cat.id
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
            ]"
          >{{ cat.label }}</button>
        </div>
      </div>

      <!-- Role picker (for armyComposition) -->
      <div v-if="needsRolePicker" class="space-y-2">
        <label class="block text-sm text-gray-400">Army Role</label>
        <div class="flex gap-2">
          <button
            v-for="r in ['ground', 'air'] as const"
            :key="r"
            @click="newGoalRole = r"
            :class="[
              'flex-1 py-1.5 rounded text-sm border transition-colors',
              newGoalRole === r
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
            ]"
          >{{ r === 'ground' ? 'Ground (bots/vehicles/ships)' : 'Air (aircraft)' }}</button>
        </div>
      </div>

      <!-- Min fraction (for armyComposition) -->
      <div v-if="needsMinFraction">
        <label class="block text-sm text-gray-400 mb-0.5">
          Minimum Fraction <span class="text-gray-500">(0–1, e.g. 0.8 = 80%)</span>
        </label>
        <div class="flex gap-1.5 mb-1.5 flex-wrap">
          <button
            v-for="f in [0.5, 0.6, 0.7, 0.8, 0.9]"
            :key="f"
            @click="newGoalMinFraction = f"
            :class="[
              'text-xs px-2 py-0.5 rounded transition-colors',
              newGoalMinFraction === f ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-white'
            ]"
          >{{ Math.round(f * 100) }}%</button>
        </div>
        <input
          v-model.number="newGoalMinFraction"
          type="number" min="0.1" max="1" step="0.05"
          class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
        />
      </div>

      <!-- Target Time with quick-pick buttons -->
      <div>
        <label class="block text-sm text-gray-400 mb-0.5">By Time</label>
        <div class="flex gap-1.5 mb-1.5 flex-wrap">
          <button
            v-for="t in [60, 120, 180, 240, 300, 420, 540, 720]"
            :key="t"
            @click="newGoalTime = t"
            :class="[
              'text-xs px-2 py-0.5 rounded transition-colors',
              newGoalTime === t ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-white'
            ]"
          >{{ t >= 60 ? `${t/60}m` : `${t}s` }}</button>
        </div>
        <input
          v-model.number="newGoalTime"
          type="number" min="10" step="10"
          class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
        />
      </div>

      <!-- Target Value (for income/army/buildpower types) -->
      <div v-if="!needsUnitPicker && !needsCategoryPicker && !needsRolePicker">
        <label class="block text-sm text-gray-400 mb-0.5">
          Target Value
          <span class="text-gray-500">
            ({{
              newGoalType === 'metalIncome' ? 'M/s' :
              newGoalType === 'energyIncome' ? 'E/s' :
              newGoalType === 'buildPower' ? 'build power' :
              newGoalType === 'armyDps' ? 'DPS' :
              newGoalType === 'armyHealth' ? 'HP' : 'metal'
            }})
          </span>
        </label>
        <input
          v-model.number="newGoalValue"
          type="number" min="0" step="1"
          class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
        />
      </div>

      <!-- Unit Picker (for building/unit/unitCount types) -->
      <div v-if="needsUnitPicker">
        <label class="block text-sm text-gray-400 mb-0.5">Unit</label>
        <input
          v-model="unitSearch"
          type="text" placeholder="Search units…"
          class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm mb-2 focus:outline-none focus:border-blue-500"
        />
        <div class="max-h-40 overflow-y-auto rounded border border-gray-700 bg-gray-900">
          <button
            v-for="u in filteredUnits.slice(0, 60)"
            :key="u.id"
            @click="newGoalUnitId = u.id"
            :class="[
              'w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors',
              newGoalUnitId === u.id ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
            ]"
          >
            <span class="flex-1">{{ u.name }}</span>
            <span :class="['text-xs px-1 rounded font-mono', u.tier === 'T1' ? 'bg-gray-700 text-gray-400' : u.tier === 'T2' ? 'bg-blue-900 text-blue-300' : 'bg-purple-900 text-purple-300']">{{ u.tier }}</span>
            <span class="text-xs text-gray-500">{{ u.metalCost }}M</span>
          </button>
          <p v-if="filteredUnits.length === 0" class="p-3 text-sm text-gray-500 italic">
            No units found.
          </p>
        </div>
        <p v-if="newGoalUnitId" class="mt-1 text-xs text-blue-400">
          Selected: {{ unitForId(newGoalUnitId)?.name ?? newGoalUnitId }}
        </p>
      </div>

      <!-- Count (for unitCount type) -->
      <div v-if="needsCount">
        <label class="block text-sm text-gray-400 mb-0.5">Count (how many)</label>
        <input
          v-model.number="newGoalCount"
          type="number" min="1" step="1"
          class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
        />
      </div>

      <!-- Weight -->
      <div>
        <label class="block text-sm text-gray-400 mb-0.5">
          Weight
          <span class="text-gray-500 font-normal text-xs">(higher = optimizer prioritises this goal more)</span>
        </label>
        <div class="flex gap-1.5 mb-1.5">
          <button
            v-for="w in [0.5, 1.0, 1.5, 2.0, 3.0]"
            :key="w"
            @click="newGoalWeight = w"
            :class="[
              'text-xs px-2 py-0.5 rounded transition-colors',
              newGoalWeight === w ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-white'
            ]"
          >×{{ w }}</button>
        </div>
        <input
          v-model.number="newGoalWeight"
          type="number" min="0.1" step="0.1"
          class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
        />
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <button
          @click="showAddGoalModal = false; unitSearch = ''; editingGoalIndex = null"
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
        >Cancel</button>
        <button
          @click="addGoal"
          :disabled="needsUnitPicker && !newGoalUnitId"
          class="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm transition-colors"
        >{{ editingGoalIndex !== null ? 'Save Goal' : 'Add Goal' }}</button>
      </div>
    </div>
  </div>

  <!-- ── Unit Detail Popup (from build order click) ───────────────── -->
  <UnitDetail
    v-if="selectedBuildOrderUnit"
    :unit="selectedBuildOrderUnit"
    @close="selectedBuildOrderUnit = null"
    @navigate="selectedBuildOrderUnit = $event"
  />

  <!-- ── Saved Builds Modal ────────────────────────────────────────── -->
  <div
    v-if="showSavedBuildsModal"
    class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
    @click.self="showSavedBuildsModal = false"
  >
    <div class="bg-gray-800 rounded-lg w-full max-w-xl p-5 space-y-4 max-h-[85vh] flex flex-col">
      <div class="flex items-center justify-between shrink-0">
        <h2 class="text-base font-bold">Saved Builds</h2>
        <button @click="showSavedBuildsModal = false" class="text-gray-400 hover:text-white text-xl leading-none">×</button>
      </div>

      <!-- Save current -->
      <div class="flex gap-2 shrink-0">
        <input
          v-model="saveNameInput"
          type="text"
          placeholder="Build name (optional)…"
          class="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
          @keyup.enter="saveCurrentBuild"
        />
        <button
          @click="saveCurrentBuild"
          class="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors"
        >Save current</button>
      </div>

      <!-- Import from file -->
      <div class="flex items-center gap-2 shrink-0">
        <label class="flex-1 flex items-center gap-2 py-1.5 px-3 bg-gray-700 hover:bg-gray-600 rounded text-sm cursor-pointer transition-colors">
          <span>📂 Import from file</span>
          <input ref="importFileInput" type="file" accept=".json" class="hidden" @change="importBuildFromFile" />
        </label>
      </div>

      <!-- Build list -->
      <div class="flex-1 overflow-y-auto space-y-2 min-h-0">
        <p v-if="savedBuilds.length === 0" class="text-sm text-gray-500 italic text-center py-6">
          No saved builds yet. Save your current setup to get started.
        </p>
        <div
          v-for="build in savedBuilds"
          :key="build.id"
          class="bg-gray-700 rounded-lg p-3 space-y-1.5"
        >
          <div class="flex items-start gap-2">
            <div class="flex-1 min-w-0">
              <p class="font-medium text-sm text-gray-100 truncate">{{ build.name }}</p>
              <p class="text-xs text-gray-500">
                {{ build.faction }} ·
                {{ build.checkpoints.length }} goal{{ build.checkpoints.length !== 1 ? 's' : '' }} ·
                {{ new Date(build.createdAt).toLocaleDateString() }} {{ new Date(build.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
                <span v-if="build.bestFitness" class="text-green-400"> · fitness {{ build.bestFitness.toFixed(3) }}</span>
              </p>
            </div>
            <div class="flex gap-1 shrink-0">
              <button
                @click="loadBuild(build)"
                class="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium transition-colors"
                :title="build.bestGenes ? 'Load settings + seed Continue with best chromosome' : 'Load settings'"
              >Load{{ build.bestGenes ? ' +↻' : '' }}</button>
              <button
                @click="exportBuildToFile(build)"
                class="px-2.5 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs transition-colors"
                title="Export to JSON file"
              >⬇</button>
              <button
                @click="deleteSavedBuild(build.id)"
                class="px-2.5 py-1 bg-red-900/60 hover:bg-red-700/60 rounded text-xs text-red-300 transition-colors"
                title="Delete"
              >×</button>
            </div>
          </div>
          <!-- Goals summary -->
          <div v-if="build.checkpoints.length > 0" class="flex flex-wrap gap-1">
            <span
              v-for="(cp, ci) in build.checkpoints.slice(0, 5)"
              :key="ci"
              class="text-xs px-1.5 py-0.5 bg-gray-600 rounded text-gray-300"
            >{{ checkpointLabel(cp) }}</span>
            <span v-if="build.checkpoints.length > 5" class="text-xs text-gray-500">+{{ build.checkpoints.length - 5 }} more</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ── Add Starting Builder Modal ────────────────────────────────── -->
  <div
    v-if="showAddBuilderModal"
    class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
    @click.self="showAddBuilderModal = false; builderSearch = ''"
  >
    <div class="bg-gray-800 rounded-lg w-full max-w-sm p-5 space-y-3">
      <h2 class="text-base font-bold">Add Starting Builder</h2>
      <p class="text-xs text-gray-400">
        Pick a unit that starts on the field alongside the commander.
        Its build power is added to the initial total.
      </p>
      <input
        v-model="builderSearch"
        type="text" placeholder="Search builders…"
        class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
      />
      <div class="max-h-48 overflow-y-auto rounded border border-gray-700 bg-gray-900">
        <button
          v-for="u in filteredBuilders.slice(0, 60)"
          :key="u.id"
          @click="addStartingBuilder(u.id)"
          class="w-full text-left px-3 py-1.5 text-sm flex items-center justify-between text-gray-300 hover:bg-gray-700 transition-colors"
        >
          <span>{{ u.name }}</span>
          <span class="text-xs text-gray-500">{{ u.buildPower }} BP · {{ u.tier }}</span>
        </button>
        <p v-if="filteredBuilders.length === 0" class="p-3 text-sm text-gray-500 italic">
          No builders found for {{ faction }}.
        </p>
      </div>
      <div class="flex justify-end">
        <button
          @click="showAddBuilderModal = false; builderSearch = ''"
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
        >Cancel</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Tooltip icon ────────────────────────────────────────────────────────── */
.tip {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: help;
  color: #6b7280;
  font-size: 0.65rem;
  line-height: 1;
  font-style: normal;
  flex-shrink: 0;
}

.tip::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: #111827;
  border: 1px solid #374151;
  color: #e5e7eb;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 0.72rem;
  white-space: pre-wrap;
  width: 230px;
  z-index: 200;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s;
  text-align: left;
  line-height: 1.5;
  font-weight: normal;
  text-transform: none;
  letter-spacing: normal;
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
}

/* Tooltip anchored to the right edge for icons near the right side */
.tip.tip-left::after {
  left: auto;
  right: 0;
  transform: none;
}

.tip:hover::after {
  opacity: 1;
}
</style>
