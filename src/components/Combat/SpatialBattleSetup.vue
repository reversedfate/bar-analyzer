<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive } from 'vue'
import { Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js'
import { useUnitStore } from '../../stores/unitStore'
import BattlefieldCanvas from './BattlefieldCanvas.vue'
import UnitIcon from '../Common/UnitIcon.vue'
import {
  getDefaultSpatialConfig,
  type SpatialSimConfig,
  type SpatialSimResult,
  type TargetingStrategy,
  type Formation,
  type MovementBehavior,
  type ProductionEntry,
  type UnitOverride
} from '../../services/spatialCombatSimulator'
import type { Unit } from '../../types'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend)

const unitStore = useUnitStore()

// Web Worker
let worker: Worker | null = null

onMounted(() => {
  worker = new Worker(new URL('../../services/spatialSimWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    if (e.data.type === 'result') {
      result.value = e.data.result
      isSimulating.value = false
      playbackTime.value = 0
    }
  }
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  worker?.terminate()
  worker = null
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKeydown)
})

// Team compositions
const teamA = ref<{ unit: Unit; count: number }[]>([])
const teamB = ref<{ unit: Unit; count: number }[]>([])

// Per-unit type behavior overrides
const teamAUnitOverrides = ref<Record<string, UnitOverride>>({})
const teamBUnitOverrides = ref<Record<string, UnitOverride>>({})

// Production (sustained reinforcements)
const teamAProduction = ref<ProductionEntry[]>([])
const teamBProduction = ref<ProductionEntry[]>([])
const showProductionPicker = ref<'A' | 'B' | null>(null)
const productionSearchQuery = ref('')

// Configuration
const config = ref<SpatialSimConfig>(getDefaultSpatialConfig())

// Overlay toggles
const showVisionRanges = ref(true)
const showWeaponRanges = ref(true)

// Fullscreen
const isFullscreen = ref(false)
const windowSize = reactive({ width: window.innerWidth, height: window.innerHeight })

function onResize() {
  windowSize.width = window.innerWidth
  windowSize.height = window.innerHeight
}

const fullscreenCanvasSize = computed(() =>
  Math.min(windowSize.width - 16, windowSize.height - 48 - 80 - 32)
)

function openFullscreen() {
  isFullscreen.value = true
}

function closeFullscreen() {
  isFullscreen.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeFullscreen()
}

// Simulation state
const result = ref<SpatialSimResult | null>(null)
const isSimulating = ref(false)

// Playback state
const isPlaying = ref(false)
const playbackTime = ref(0)
const playbackSpeed = ref(4)
let playbackInterval: number | null = null

// Unit picker
const showPicker = ref<'A' | 'B' | null>(null)
const searchQuery = ref('')

// Structure (Building/Turret) picker
const teamAStructures = ref<{ unit: Unit; count: number }[]>([])
const teamBStructures = ref<{ unit: Unit; count: number }[]>([])
const showStructurePicker = ref<'A' | 'B' | null>(null)
const structureSearchQuery = ref('')

// Options
const targetingStrategies: { value: TargetingStrategy; label: string }[] = [
  { value: 'closest', label: 'Closest' },
  { value: 'focus', label: 'Focus Fire' },
  { value: 'spread', label: 'Spread' },
  { value: 'lowestHp', label: 'Lowest HP' },
  { value: 'highestDps', label: 'Highest DPS' },
  { value: 'random', label: 'Random' }
]

const formations: { value: Formation; label: string; desc: string }[] = [
  { value: 'line', label: 'Firing Line', desc: 'Spread perpendicular to enemy' },
  { value: 'grouped', label: 'Grouped', desc: 'Clustered together' },
  { value: 'column', label: 'Column', desc: 'Line towards enemy' },
  { value: 'scattered', label: 'Scattered', desc: 'Maximally spread (anti-AoE)' }
]

const behaviors: { value: MovementBehavior; label: string; desc: string }[] = [
  { value: 'advance', label: 'Advance', desc: 'Move towards enemy' },
  { value: 'hold', label: 'Hold', desc: 'Stand still' },
  { value: 'retreat', label: 'Retreat', desc: 'Move away' },
  { value: 'kite', label: 'Kite', desc: 'Maintain max range' },
  { value: 'surround', label: 'Surround', desc: 'Orbit target at firing range (exploits flanking)' }
]

// Helper: apply sidebar faction/tier/morph filters to a unit list, but NOT unitType or search
// Used when we need to bypass certain filters (building picker always shows buildings;
// local search bypasses all sidebar filters)
function applyBaseSidebarFilters(units: typeof unitStore.units) {
  const { factions, tiers, hideMorphs } = unitStore.filters
  if (hideMorphs) units = units.filter(u => !u.isMorph)
  if (factions.length > 0) units = units.filter(u => factions.includes(u.faction))
  if (tiers.length > 0) units = units.filter(u => tiers.includes(u.tier))
  return units
}

// Filtered units for main team picker
// - When local search active: bypass all sidebar filters (search all units by name/desc)
// - When no local search: use store-filtered units (respects sidebar faction/tier/type/search)
const filteredUnits = computed(() => {
  const q = searchQuery.value.toLowerCase()
  let units: typeof unitStore.units
  if (q) {
    // Local search active → search all units, ignoring sidebar filters
    units = unitStore.units.filter(u =>
      u.weapons.length > 0 && u.unitType !== 'Building' &&
      (u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q) ||
       (u.description && u.description.toLowerCase().includes(q)))
    )
  } else {
    units = unitStore.filteredUnits.filter(u => u.weapons.length > 0 && u.unitType !== 'Building')
  }
  return units.slice(0, 60)
})

// Filtered buildings for structure picker
// - Always shows buildings regardless of unitType filter
// - Respects faction/tier/morph sidebar filters
// - Local search bypasses all sidebar filters
const filteredBuildingUnits = computed(() => {
  const q = structureSearchQuery.value.toLowerCase()
  let units: typeof unitStore.units
  if (q) {
    units = unitStore.units.filter(u =>
      u.unitType === 'Building' && u.weapons.length > 0 &&
      (u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q) ||
       (u.description && u.description.toLowerCase().includes(q)))
    )
  } else {
    units = applyBaseSidebarFilters(
      unitStore.units.filter(u => u.unitType === 'Building' && u.weapons.length > 0)
    )
  }
  return units.slice(0, 60)
})

// Filtered units for production picker
// - When local search active: bypass sidebar filters
// - When no local search: use store-filtered units
const filteredProductionUnits = computed(() => {
  const q = productionSearchQuery.value.toLowerCase()
  let units: typeof unitStore.units
  if (q) {
    units = unitStore.units.filter(u =>
      u.weapons.length > 0 &&
      (u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q) ||
       (u.description && u.description.toLowerCase().includes(q)))
    )
  } else {
    units = unitStore.filteredUnits.filter(u => u.weapons.length > 0)
  }
  return units.slice(0, 60)
})

// Add unit to team
function addUnit(team: 'A' | 'B', unit: Unit) {
  const teamRef = team === 'A' ? teamA : teamB
  const existing = teamRef.value.find(u => u.unit.id === unit.id)
  if (existing) {
    existing.count++
  } else {
    teamRef.value.push({ unit, count: 1 })
  }
  showPicker.value = null
  searchQuery.value = ''
}

// Remove unit from team
function removeUnit(team: 'A' | 'B', unitId: string) {
  const teamRef = team === 'A' ? teamA : teamB
  teamRef.value = teamRef.value.filter(u => u.unit.id !== unitId)
  // Clean up any per-unit override
  const overrides = team === 'A' ? teamAUnitOverrides : teamBUnitOverrides
  delete overrides.value[unitId]
}

// Add / remove structures
function addStructure(team: 'A' | 'B', unit: Unit) {
  const teamRef = team === 'A' ? teamAStructures : teamBStructures
  const existing = teamRef.value.find(u => u.unit.id === unit.id)
  if (existing) {
    existing.count++
  } else {
    teamRef.value.push({ unit, count: 1 })
  }
  showStructurePicker.value = null
  structureSearchQuery.value = ''
}

function removeStructure(team: 'A' | 'B', unitId: string) {
  const teamRef = team === 'A' ? teamAStructures : teamBStructures
  teamRef.value = teamRef.value.filter(u => u.unit.id !== unitId)
}

function updateStructureCount(team: 'A' | 'B', unitId: string, delta: number) {
  const teamRef = team === 'A' ? teamAStructures : teamBStructures
  const item = teamRef.value.find(u => u.unit.id === unitId)
  if (item) item.count = Math.max(1, item.count + delta)
}

// Per-unit behavior override helper
function setUnitBehaviorOverride(team: 'A' | 'B', unitId: string, behavior: MovementBehavior | '') {
  const overrides = team === 'A' ? teamAUnitOverrides : teamBUnitOverrides
  if (!behavior) {
    delete overrides.value[unitId]
  } else {
    overrides.value[unitId] = { ...overrides.value[unitId], behavior }
  }
}

// Production helpers
function addProductionUnit(team: 'A' | 'B', unit: Unit) {
  const list = team === 'A' ? teamAProduction : teamBProduction
  const existing = list.value.find(e => e.unit.id === unit.id)
  if (existing) return  // already added
  list.value.push({ unit, interval: 30 })
  showProductionPicker.value = null
  productionSearchQuery.value = ''
}

function removeProductionUnit(team: 'A' | 'B', unitId: string) {
  const list = team === 'A' ? teamAProduction : teamBProduction
  list.value = list.value.filter(e => e.unit.id !== unitId)
}

const productionCost = computed(() => {
  const calc = (entries: ProductionEntry[]) => {
    let metal = 0, energy = 0, bp = 0
    for (const e of entries) {
      metal  += e.unit.metalCost  / e.interval
      energy += e.unit.energyCost / e.interval
      bp     += (e.unit.buildTime ?? 0) / e.interval
    }
    return { metal, energy, bp }
  }
  return { A: calc(teamAProduction.value), B: calc(teamBProduction.value) }
})

// Update unit count by delta (+1 / -1)
function updateCount(team: 'A' | 'B', unitId: string, delta: number) {
  const teamRef = team === 'A' ? teamA : teamB
  const item = teamRef.value.find(u => u.unit.id === unitId)
  if (item) {
    item.count = Math.max(1, item.count + delta)
  }
}

// Set unit count directly from input
function setCount(team: 'A' | 'B', unitId: string, value: string) {
  const teamRef = team === 'A' ? teamA : teamB
  const item = teamRef.value.find(u => u.unit.id === unitId)
  if (item) {
    const n = parseInt(value, 10)
    item.count = isNaN(n) || n < 1 ? 1 : n
  }
}

// Set structure count directly from input
function setStructureCount(team: 'A' | 'B', unitId: string, value: string) {
  const teamRef = team === 'A' ? teamAStructures : teamBStructures
  const item = teamRef.value.find(u => u.unit.id === unitId)
  if (item) {
    const n = parseInt(value, 10)
    item.count = isNaN(n) || n < 1 ? 1 : n
  }
}

// Run simulation via web worker
function runSimulation() {
  const hasA = teamA.value.length > 0 || teamAStructures.value.length > 0
  const hasB = teamB.value.length > 0 || teamBStructures.value.length > 0
  if (!hasA || !hasB) return

  isSimulating.value = true
  stopPlayback()

  if (worker) {
    // Merge mobile units + structures for each team
    const mergedA = [...teamA.value, ...teamAStructures.value]
    const mergedB = [...teamB.value, ...teamBStructures.value]

    const msg = JSON.parse(JSON.stringify({
      type: 'run',
      teamA: mergedA,
      teamB: mergedB,
      config: {
        ...config.value,
        teamAProduction: teamAProduction.value,
        teamBProduction: teamBProduction.value,
        teamAUnitOverrides: teamAUnitOverrides.value,
        teamBUnitOverrides: teamBUnitOverrides.value
      }
    }))
    worker.postMessage(msg)
  }
}

// Playback controls
function startPlayback() {
  if (!result.value) return
  isPlaying.value = true

  const interval = 50  // ms
  playbackInterval = window.setInterval(() => {
    playbackTime.value += (interval / 1000) * playbackSpeed.value

    if (playbackTime.value >= result.value!.duration) {
      playbackTime.value = result.value!.duration
      stopPlayback()
    }
  }, interval)
}

function stopPlayback() {
  isPlaying.value = false
  if (playbackInterval) {
    clearInterval(playbackInterval)
    playbackInterval = null
  }
}

function togglePlayback() {
  if (isPlaying.value) {
    stopPlayback()
  } else {
    if (playbackTime.value >= (result.value?.duration || 0)) {
      playbackTime.value = 0
    }
    startPlayback()
  }
}

function seekTo(time: number) {
  playbackTime.value = time
}

// Charts
const hpChartData = computed(() => {
  if (!result.value) return { labels: [], datasets: [] }

  return {
    labels: result.value.timeline.map(t => t.time.toFixed(1)),
    datasets: [
      {
        label: 'Team A HP',
        data: result.value.timeline.map(t => t.teamAHp),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.1,
        fill: true
      },
      {
        label: 'Team B HP',
        data: result.value.timeline.map(t => t.teamBHp),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        tension: 0.1,
        fill: true
      }
    ]
  }
})

const dpsChartData = computed(() => {
  if (!result.value) return { labels: [], datasets: [] }

  return {
    labels: result.value.timeline.map(t => t.time.toFixed(1)),
    datasets: [
      {
        label: 'Team A DPS',
        data: result.value.timeline.map(t => t.teamADps),
        borderColor: '#3b82f6',
        tension: 0.1
      },
      {
        label: 'Team B DPS',
        data: result.value.timeline.map(t => t.teamBDps),
        borderColor: '#ef4444',
        tension: 0.1
      }
    ]
  }
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'top' as const, labels: { color: '#9ca3af' } }
  },
  scales: {
    x: {
      title: { display: true, text: 'Time (s)', color: '#9ca3af' },
      grid: { color: 'rgba(75, 85, 99, 0.3)' },
      ticks: { color: '#9ca3af' }
    },
    y: {
      grid: { color: 'rgba(75, 85, 99, 0.3)' },
      ticks: { color: '#9ca3af' },
      beginAtZero: true
    }
  }
}

// Team stats summary
const teamStats = computed(() => {
  const calcStats = (team: { unit: Unit; count: number }[]) => {
    let totalHp = 0
    let totalDps = 0
    let totalCost = 0
    let count = 0

    for (const { unit, count: c } of team) {
      totalHp += unit.health * c
      totalDps += unit.weapons.reduce((sum, w) => sum + (w.dps || w.damage / w.reload), 0) * c
      totalCost += unit.metalCost * c
      count += c
    }

    return { totalHp, totalDps, totalCost, count }
  }

  return {
    A: calcStats(teamA.value),
    B: calcStats(teamB.value)
  }
})

const hasRetreatBehavior = computed(() =>
  config.value.teamABehavior === 'retreat' || config.value.teamBBehavior === 'retreat'
)

const getFactionClass = (faction: string) => {
  switch (faction) {
    case 'Armada': return 'text-blue-400'
    case 'Cortex': return 'text-red-400'
    case 'Legion': return 'text-green-400'
    default: return 'text-gray-400'
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Configuration Panel -->
    <div class="bg-gray-800 rounded-lg p-3">
      <h3 class="text-lg font-semibold mb-4">Battle Configuration</h3>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Team A Config -->
        <div class="space-y-3">
          <h4 class="font-medium text-blue-400">Team A</h4>

          <div>
            <label class="block text-xs text-gray-400 mb-1">Targeting</label>
            <select
              v-model="config.teamAStrategy"
              class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
            >
              <option v-for="s in targetingStrategies" :key="s.value" :value="s.value">
                {{ s.label }}
              </option>
            </select>
          </div>

          <div>
            <label class="block text-xs text-gray-400 mb-1">Formation</label>
            <select
              v-model="config.teamAFormation"
              class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
            >
              <option v-for="f in formations" :key="f.value" :value="f.value">
                {{ f.label }} - {{ f.desc }}
              </option>
            </select>
          </div>

          <div>
            <label class="block text-xs text-gray-400 mb-1">Movement</label>
            <select
              v-model="config.teamABehavior"
              class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
            >
              <option v-for="b in behaviors" :key="b.value" :value="b.value">
                {{ b.label }} - {{ b.desc }}
              </option>
            </select>
          </div>

          <label v-if="config.useVisionSystem" class="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" v-model="config.teamARadarCoverage" class="rounded" />
            Full Radar Coverage
          </label>
        </div>

        <!-- Team B Config -->
        <div class="space-y-3">
          <h4 class="font-medium text-red-400">Team B</h4>

          <div>
            <label class="block text-xs text-gray-400 mb-1">Targeting</label>
            <select
              v-model="config.teamBStrategy"
              class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
            >
              <option v-for="s in targetingStrategies" :key="s.value" :value="s.value">
                {{ s.label }}
              </option>
            </select>
          </div>

          <div>
            <label class="block text-xs text-gray-400 mb-1">Formation</label>
            <select
              v-model="config.teamBFormation"
              class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
            >
              <option v-for="f in formations" :key="f.value" :value="f.value">
                {{ f.label }} - {{ f.desc }}
              </option>
            </select>
          </div>

          <div>
            <label class="block text-xs text-gray-400 mb-1">Movement</label>
            <select
              v-model="config.teamBBehavior"
              class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
            >
              <option v-for="b in behaviors" :key="b.value" :value="b.value">
                {{ b.label }} - {{ b.desc }}
              </option>
            </select>
          </div>

          <label v-if="config.useVisionSystem" class="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" v-model="config.teamBRadarCoverage" class="rounded" />
            Full Radar Coverage
          </label>
        </div>
      </div>

      <!-- Global Settings -->
      <div class="mt-4 pt-4 border-t border-gray-700 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label class="block text-xs text-gray-400 mb-1">Starting Distance</label>
          <input
            v-model.number="config.startingDistance"
            type="number"
            step="100"
            class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label class="block text-xs text-gray-400 mb-1">Field Size</label>
          <input
            v-model.number="config.fieldSize"
            type="number"
            step="100"
            class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label class="block text-xs text-gray-400 mb-1">Draw Timeout (s)</label>
          <input
            v-model.number="config.maxTime"
            type="number"
            class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label class="block text-xs text-gray-400 mb-1">Tick Rate</label>
          <input
            v-model.number="config.tickRate"
            type="number"
            class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
          />
        </div>
      </div>

      <!-- Vision & Retreat Settings -->
      <div class="mt-4 pt-4 border-t border-gray-700 flex flex-wrap gap-4">
        <label class="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" v-model="config.useVisionSystem" class="rounded" />
          Enable Vision System
        </label>
        <label class="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" v-model="config.useFlanking" class="rounded" />
          Flanking Damage
          <span class="text-xs text-gray-500">(front 1×, side 1.5×, rear 2×)</span>
        </label>
        <label v-if="config.useVisionSystem" class="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" v-model="showVisionRanges" class="rounded" />
          Show Vision Ranges
        </label>
        <label class="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" v-model="showWeaponRanges" class="rounded" />
          Show Firing Ranges
        </label>
        <div v-if="hasRetreatBehavior" class="flex items-center gap-2">
          <label class="text-xs text-gray-400">Retreat Threshold</label>
          <input
            v-model.number="config.retreatThreshold"
            type="range"
            min="0"
            max="1"
            step="0.05"
            class="w-24"
          />
          <span class="text-xs text-gray-400">{{ (config.retreatThreshold * 100).toFixed(0) }}%</span>
        </div>
      </div>
    </div>

    <!-- Team Builders -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- Team A -->
      <div class="bg-gray-800 rounded-lg p-3">
        <div class="flex items-center justify-between mb-3">
          <h4 class="font-semibold text-blue-400">Team A</h4>
          <button
            @click="showPicker = 'A'"
            class="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-500 rounded"
          >
            + Add Unit
          </button>
        </div>

        <div v-if="teamA.length === 0" class="text-center py-4 text-gray-500 text-sm">
          No units added
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="item in teamA"
            :key="item.unit.id"
            class="flex items-center justify-between bg-gray-900 rounded px-3 py-2"
          >
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <UnitIcon :unitId="item.unit.id" :size="24" class="rounded shrink-0" />
              <div class="min-w-0">
                <div class="font-medium truncate">{{ item.unit.name }}</div>
                <div class="text-xs text-gray-500">
                  {{ item.unit.health }} HP | {{ item.unit.weapons.length }} weapons
                </div>
              </div>
            </div>
            <div class="flex items-center gap-1 ml-2">
              <!-- Per-unit behavior override -->
              <select
                :value="teamAUnitOverrides[item.unit.id]?.behavior ?? ''"
                @change="setUnitBehaviorOverride('A', item.unit.id, ($event.target as HTMLSelectElement).value as MovementBehavior | '')"
                class="bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-xs"
                title="Behavior override (empty = team default)"
              >
                <option value="">default</option>
                <option v-for="b in behaviors" :key="b.value" :value="b.value">{{ b.label }}</option>
              </select>
              <button
                @click="updateCount('A', item.unit.id, -1)"
                class="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >-</button>
              <input
                type="number" min="1"
                :value="item.count"
                @change="setCount('A', item.unit.id, ($event.target as HTMLInputElement).value)"
                class="w-14 text-center bg-gray-700 border border-gray-600 rounded text-sm py-0.5"
              />
              <button
                @click="updateCount('A', item.unit.id, 1)"
                class="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >+</button>
              <button
                @click="removeUnit('A', item.unit.id)"
                class="px-2 py-1 text-red-400 hover:text-red-300"
              >x</button>
            </div>
          </div>
        </div>

        <!-- Team A Stats -->
        <div v-if="teamA.length > 0" class="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-400 flex gap-4">
          <span>Units: {{ teamStats.A.count }}</span>
          <span>HP: {{ teamStats.A.totalHp.toLocaleString() }}</span>
          <span>DPS: {{ teamStats.A.totalDps.toFixed(0) }}</span>
          <span>Cost: {{ teamStats.A.totalCost.toLocaleString() }}m</span>
        </div>
      </div>

      <!-- Team B -->
      <div class="bg-gray-800 rounded-lg p-3">
        <div class="flex items-center justify-between mb-3">
          <h4 class="font-semibold text-red-400">Team B</h4>
          <button
            @click="showPicker = 'B'"
            class="px-3 py-1 text-sm bg-red-600 hover:bg-red-500 rounded"
          >
            + Add Unit
          </button>
        </div>

        <div v-if="teamB.length === 0" class="text-center py-4 text-gray-500 text-sm">
          No units added
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="item in teamB"
            :key="item.unit.id"
            class="flex items-center justify-between bg-gray-900 rounded px-3 py-2"
          >
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <UnitIcon :unitId="item.unit.id" :size="24" class="rounded shrink-0" />
              <div class="min-w-0">
                <div class="font-medium truncate">{{ item.unit.name }}</div>
                <div class="text-xs text-gray-500">
                  {{ item.unit.health }} HP | {{ item.unit.weapons.length }} weapons
                </div>
              </div>
            </div>
            <div class="flex items-center gap-1 ml-2">
              <!-- Per-unit behavior override -->
              <select
                :value="teamBUnitOverrides[item.unit.id]?.behavior ?? ''"
                @change="setUnitBehaviorOverride('B', item.unit.id, ($event.target as HTMLSelectElement).value as MovementBehavior | '')"
                class="bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-xs"
                title="Behavior override (empty = team default)"
              >
                <option value="">default</option>
                <option v-for="b in behaviors" :key="b.value" :value="b.value">{{ b.label }}</option>
              </select>
              <button
                @click="updateCount('B', item.unit.id, -1)"
                class="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >-</button>
              <input
                type="number" min="1"
                :value="item.count"
                @change="setCount('B', item.unit.id, ($event.target as HTMLInputElement).value)"
                class="w-14 text-center bg-gray-700 border border-gray-600 rounded text-sm py-0.5"
              />
              <button
                @click="updateCount('B', item.unit.id, 1)"
                class="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >+</button>
              <button
                @click="removeUnit('B', item.unit.id)"
                class="px-2 py-1 text-red-400 hover:text-red-300"
              >x</button>
            </div>
          </div>
        </div>

        <!-- Team B Stats -->
        <div v-if="teamB.length > 0" class="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-400 flex gap-4">
          <span>Units: {{ teamStats.B.count }}</span>
          <span>HP: {{ teamStats.B.totalHp.toLocaleString() }}</span>
          <span>DPS: {{ teamStats.B.totalDps.toFixed(0) }}</span>
          <span>Cost: {{ teamStats.B.totalCost.toLocaleString() }}m</span>
        </div>
      </div>
    </div>

    <!-- Production (Sustained Reinforcements) -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- Team A Production -->
      <div class="bg-gray-800 rounded-lg p-3">
        <div class="flex items-center justify-between mb-3">
          <h4 class="font-semibold text-blue-400">Team A Production</h4>
          <button @click="showProductionPicker = 'A'"
            class="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-500 rounded">
            + Add
          </button>
        </div>
        <div v-if="teamAProduction.length === 0" class="text-xs text-gray-500 py-2">
          No production configured
        </div>
        <div v-else class="space-y-2">
          <div v-for="entry in teamAProduction" :key="entry.unit.id"
            class="flex items-center gap-2 bg-gray-900 rounded px-3 py-2">
            <div class="flex-1 text-sm truncate">{{ entry.unit.name }}</div>
            <label class="text-xs text-gray-400">every</label>
            <input v-model.number="entry.interval" type="number" min="1" step="5"
              class="w-16 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-xs text-center"/>
            <span class="text-xs text-gray-400">s</span>
            <button @click="removeProductionUnit('A', entry.unit.id)"
              class="text-red-400 hover:text-red-300 text-xs ml-1">×</button>
          </div>
        </div>
        <div v-if="teamAProduction.length > 0" class="mt-2 pt-2 border-t border-gray-700 text-xs text-gray-400 flex gap-3">
          <span>⚙ {{ productionCost.A.metal.toFixed(1) }}m/s</span>
          <span>⚡ {{ productionCost.A.energy.toFixed(1) }}e/s</span>
          <span>🔨 {{ productionCost.A.bp.toFixed(0) }} BP/s</span>
        </div>
      </div>

      <!-- Team B Production -->
      <div class="bg-gray-800 rounded-lg p-3">
        <div class="flex items-center justify-between mb-3">
          <h4 class="font-semibold text-red-400">Team B Production</h4>
          <button @click="showProductionPicker = 'B'"
            class="px-3 py-1 text-sm bg-red-600 hover:bg-red-500 rounded">
            + Add
          </button>
        </div>
        <div v-if="teamBProduction.length === 0" class="text-xs text-gray-500 py-2">
          No production configured
        </div>
        <div v-else class="space-y-2">
          <div v-for="entry in teamBProduction" :key="entry.unit.id"
            class="flex items-center gap-2 bg-gray-900 rounded px-3 py-2">
            <div class="flex-1 text-sm truncate">{{ entry.unit.name }}</div>
            <label class="text-xs text-gray-400">every</label>
            <input v-model.number="entry.interval" type="number" min="1" step="5"
              class="w-16 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-xs text-center"/>
            <span class="text-xs text-gray-400">s</span>
            <button @click="removeProductionUnit('B', entry.unit.id)"
              class="text-red-400 hover:text-red-300 text-xs ml-1">×</button>
          </div>
        </div>
        <div v-if="teamBProduction.length > 0" class="mt-2 pt-2 border-t border-gray-700 text-xs text-gray-400 flex gap-3">
          <span>⚙ {{ productionCost.B.metal.toFixed(1) }}m/s</span>
          <span>⚡ {{ productionCost.B.energy.toFixed(1) }}e/s</span>
          <span>🔨 {{ productionCost.B.bp.toFixed(0) }} BP/s</span>
        </div>
      </div>
    </div>

    <!-- Spawn distance for production -->
    <div v-if="teamAProduction.length > 0 || teamBProduction.length > 0"
      class="bg-gray-800 rounded-lg px-4 py-2 flex items-center gap-3">
      <label class="text-xs text-gray-400">Production Spawn Distance from Center</label>
      <input v-model.number="config.productionSpawnDistance" type="number" step="50"
        class="w-24 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"/>
      <span class="text-xs text-gray-500">units</span>
    </div>

    <!-- Turrets & Structures -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- Team A Structures -->
      <div class="bg-gray-800 rounded-lg p-3">
        <div class="flex items-center justify-between mb-3">
          <h4 class="font-semibold text-blue-400">Team A Structures</h4>
          <button @click="showStructurePicker = 'A'"
            class="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-500 rounded">
            + Add Turret
          </button>
        </div>
        <div v-if="teamAStructures.length === 0" class="text-xs text-gray-500 py-2">
          No structures — hold position &amp; fire automatically
        </div>
        <div v-else class="space-y-2">
          <div v-for="item in teamAStructures" :key="item.unit.id"
            class="flex items-center justify-between bg-gray-900 rounded px-3 py-2">
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <UnitIcon :unitId="item.unit.id" :size="24" class="rounded shrink-0" />
              <div class="min-w-0">
                <div class="font-medium truncate text-sm">{{ item.unit.name }}</div>
                <div class="text-xs text-gray-500">
                  {{ item.unit.health }} HP | range {{ item.unit.weapons[0]?.range ?? 0 }}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-1 ml-2">
              <button @click="updateStructureCount('A', item.unit.id, -1)"
                class="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">-</button>
              <input
                type="number" min="1"
                :value="item.count"
                @change="setStructureCount('A', item.unit.id, ($event.target as HTMLInputElement).value)"
                class="w-14 text-center bg-gray-700 border border-gray-600 rounded text-sm py-0.5"
              />
              <button @click="updateStructureCount('A', item.unit.id, 1)"
                class="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">+</button>
              <button @click="removeStructure('A', item.unit.id)"
                class="px-2 py-1 text-red-400 hover:text-red-300">x</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Team B Structures -->
      <div class="bg-gray-800 rounded-lg p-3">
        <div class="flex items-center justify-between mb-3">
          <h4 class="font-semibold text-red-400">Team B Structures</h4>
          <button @click="showStructurePicker = 'B'"
            class="px-3 py-1 text-sm bg-red-600 hover:bg-red-500 rounded">
            + Add Turret
          </button>
        </div>
        <div v-if="teamBStructures.length === 0" class="text-xs text-gray-500 py-2">
          No structures — hold position &amp; fire automatically
        </div>
        <div v-else class="space-y-2">
          <div v-for="item in teamBStructures" :key="item.unit.id"
            class="flex items-center justify-between bg-gray-900 rounded px-3 py-2">
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <UnitIcon :unitId="item.unit.id" :size="24" class="rounded shrink-0" />
              <div class="min-w-0">
                <div class="font-medium truncate text-sm">{{ item.unit.name }}</div>
                <div class="text-xs text-gray-500">
                  {{ item.unit.health }} HP | range {{ item.unit.weapons[0]?.range ?? 0 }}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-1 ml-2">
              <button @click="updateStructureCount('B', item.unit.id, -1)"
                class="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">-</button>
              <input
                type="number" min="1"
                :value="item.count"
                @change="setStructureCount('B', item.unit.id, ($event.target as HTMLInputElement).value)"
                class="w-14 text-center bg-gray-700 border border-gray-600 rounded text-sm py-0.5"
              />
              <button @click="updateStructureCount('B', item.unit.id, 1)"
                class="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm">+</button>
              <button @click="removeStructure('B', item.unit.id)"
                class="px-2 py-1 text-red-400 hover:text-red-300">x</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Run Button -->
    <div class="flex justify-center">
      <button
        @click="runSimulation"
        :disabled="(teamA.length === 0 && teamAStructures.length === 0) || (teamB.length === 0 && teamBStructures.length === 0) || isSimulating"
        class="px-8 py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-medium text-lg transition-colors"
      >
        {{ isSimulating ? 'Simulating...' : 'Run Battle' }}
      </button>
    </div>

    <!-- Results -->
    <div v-if="result" class="space-y-6">
      <!-- Winner Banner -->
      <div
        :class="[
          'rounded-lg p-4 text-center text-lg font-semibold',
          result.winner === 'A' ? 'bg-blue-900/50 text-blue-400' :
          result.winner === 'B' ? 'bg-red-900/50 text-red-400' :
          result.winner === 'A_retreat' ? 'bg-amber-900/50 text-amber-400' :
          result.winner === 'B_retreat' ? 'bg-amber-900/50 text-amber-400' :
          'bg-gray-700 text-gray-300'
        ]"
      >
        <span v-if="result.winner === 'A'">Team A Wins!</span>
        <span v-else-if="result.winner === 'B'">Team B Wins!</span>
        <span v-else-if="result.winner === 'A_retreat'">Team A Retreated</span>
        <span v-else-if="result.winner === 'B_retreat'">Team B Retreated</span>
        <span v-else>Draw</span>
        <span class="ml-4 text-sm font-normal opacity-75">
          Duration: {{ result.duration.toFixed(1) }}s
        </span>
      </div>
      <!-- Draw analysis sub-banner -->
      <div v-if="result.winner === 'draw' && result.drawAnalysis"
        class="rounded px-4 py-2 text-sm text-center bg-gray-700/50 text-gray-300"
      >
        {{ result.drawAnalysis.label }}
        <span class="ml-3 opacity-60 text-xs">
          (A furthest: +{{ result.drawAnalysis.teamAAdvance }}u &nbsp;|&nbsp;
           B furthest: +{{ result.drawAnalysis.teamBAdvance }}u)
        </span>
      </div>

      <!-- Battlefield Visualization -->
      <div class="bg-gray-800 rounded-lg p-4">
        <div class="flex items-center justify-between mb-3">
          <h4 class="text-sm font-semibold text-gray-400">Battlefield</h4>
          <button
            @click="openFullscreen"
            class="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded flex items-center gap-1"
            title="Expand to full screen"
          >
            <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M3 3h5v2H5v3H3V3zm9 0h5v5h-2V5h-3V3zm0 12h3v-3h2v5h-5v-2zM3 15h2v-3h2v-2H3v5z"/>
            </svg>
            Expand
          </button>
        </div>

        <div class="flex flex-col lg:flex-row gap-4">
          <!-- Canvas -->
          <div class="flex-shrink-0">
            <BattlefieldCanvas
              :snapshots="result.snapshots"
              :current-time="playbackTime"
              :field-size="config.fieldSize"
              :is-playing="isPlaying"
              :show-vision-ranges="showVisionRanges"
              :show-weapon-ranges="showWeaponRanges"
              @seek="seekTo"
            />
          </div>

          <!-- Playback Controls -->
          <div class="flex-1 space-y-4">
            <div class="flex items-center gap-4">
              <button
                @click="togglePlayback"
                class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
              >
                {{ isPlaying ? 'Pause' : 'Play' }}
              </button>
              <button
                @click="playbackTime = 0"
                class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
              >
                Reset
              </button>
              <select v-model.number="playbackSpeed" class="bg-gray-700 border border-gray-600 rounded px-2 py-1">
                <option :value="0.25">0.25x</option>
                <option :value="0.5">0.5x</option>
                <option :value="1">1x</option>
                <option :value="2">2x</option>
                <option :value="4">4x</option>
              </select>
            </div>

            <!-- Timeline Slider -->
            <div>
              <input
                type="range"
                v-model.number="playbackTime"
                :min="0"
                :max="result.duration"
                :step="0.1"
                class="w-full"
              />
              <div class="flex justify-between text-xs text-gray-500 mt-1">
                <span>0s</span>
                <span>{{ playbackTime.toFixed(1) }}s</span>
                <span>{{ result.duration.toFixed(1) }}s</span>
              </div>
            </div>

            <!-- Stats at current time -->
            <div class="grid grid-cols-2 gap-4 text-sm">
              <div class="bg-gray-900 rounded p-3">
                <div class="text-blue-400 font-medium">Team A</div>
                <div class="text-xs text-gray-400 mt-1">
                  Survivors: {{ result.timeline.find(t => Math.abs(t.time - playbackTime) < 0.3)?.teamACount || 0 }}
                </div>
              </div>
              <div class="bg-gray-900 rounded p-3">
                <div class="text-red-400 font-medium">Team B</div>
                <div class="text-xs text-gray-400 mt-1">
                  Survivors: {{ result.timeline.find(t => Math.abs(t.time - playbackTime) < 0.3)?.teamBCount || 0 }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Fullscreen Overlay -->
      <Teleport to="body">
        <div
          v-if="isFullscreen && result"
          class="fixed inset-0 z-50 bg-gray-950 flex flex-col"
        >
          <!-- Top bar -->
          <div class="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
            <!-- Result -->
            <div
              :class="[
                'text-sm font-semibold px-3 py-1 rounded',
                result.winner === 'A' ? 'bg-blue-900/60 text-blue-300' :
                result.winner === 'B' ? 'bg-red-900/60 text-red-300' :
                result.winner === 'A_retreat' || result.winner === 'B_retreat' ? 'bg-amber-900/60 text-amber-300' :
                'bg-gray-700 text-gray-300'
              ]"
            >
              <span v-if="result.winner === 'A'">Team A Wins</span>
              <span v-else-if="result.winner === 'B'">Team B Wins</span>
              <span v-else-if="result.winner === 'A_retreat'">Team A Retreated</span>
              <span v-else-if="result.winner === 'B_retreat'">Team B Retreated</span>
              <span v-else>Draw</span>
              <span class="ml-2 font-normal opacity-75">{{ result.duration.toFixed(1) }}s</span>
            </div>
            <!-- Team survivor counts -->
            <div class="flex items-center gap-6 text-sm">
              <span class="text-blue-400">
                A: {{ result.timeline.find(t => Math.abs(t.time - playbackTime) < 0.3)?.teamACount ?? result.teamASurvivors.length }} alive
              </span>
              <span class="text-red-400">
                B: {{ result.timeline.find(t => Math.abs(t.time - playbackTime) < 0.3)?.teamBCount ?? result.teamBSurvivors.length }} alive
              </span>
              <span class="text-gray-500 text-xs">{{ playbackTime.toFixed(1) }}s / {{ result.duration.toFixed(1) }}s</span>
            </div>
            <!-- Close button -->
            <button
              @click="closeFullscreen"
              class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm flex items-center gap-1"
              title="Exit fullscreen (Esc)"
            >
              <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M3 8H1V1h7v2H3v5zm9-7h7v7h-2V3h-5V1zM1 12h2v5h5v2H1v-7zm14 5h-5v2h7v-7h-2v5z"/>
              </svg>
              Exit
            </button>
          </div>

          <!-- Canvas area -->
          <div class="flex-1 flex items-center justify-center overflow-hidden p-2 min-h-0">
            <BattlefieldCanvas
              :snapshots="result.snapshots"
              :current-time="playbackTime"
              :field-size="config.fieldSize"
              :is-playing="isPlaying"
              :show-vision-ranges="showVisionRanges"
              :show-weapon-ranges="showWeaponRanges"
              :max-size="fullscreenCanvasSize"
              @seek="seekTo"
            />
          </div>

          <!-- Bottom control bar -->
          <div class="flex-shrink-0 bg-gray-900 border-t border-gray-700 px-4 py-2 space-y-2">
            <!-- Timeline -->
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-500 w-8 text-right">0s</span>
              <input
                type="range"
                v-model.number="playbackTime"
                :min="0"
                :max="result.duration"
                :step="0.05"
                class="flex-1"
              />
              <span class="text-xs text-gray-500 w-12">{{ result.duration.toFixed(1) }}s</span>
            </div>
            <!-- Controls row -->
            <div class="flex items-center gap-3 flex-wrap">
              <button
                @click="runSimulation"
                :disabled="(teamA.length === 0 && teamAStructures.length === 0) || (teamB.length === 0 && teamBStructures.length === 0) || isSimulating"
                class="px-4 py-1.5 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm font-medium"
              >
                {{ isSimulating ? 'Simulating...' : 'Re-run' }}
              </button>
              <button
                @click="togglePlayback"
                class="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm min-w-[60px]"
              >
                {{ isPlaying ? 'Pause' : 'Play' }}
              </button>
              <button
                @click="playbackTime = 0"
                class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                Reset
              </button>
              <select v-model.number="playbackSpeed" class="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm">
                <option :value="0.25">0.25x</option>
                <option :value="0.5">0.5x</option>
                <option :value="1">1x</option>
                <option :value="2">2x</option>
                <option :value="4">4x</option>
                <option :value="8">8x</option>
              </select>
              <div class="flex items-center gap-3 ml-auto text-xs text-gray-400">
                <label class="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" v-model="showWeaponRanges" class="rounded" />
                  Ranges
                </label>
                <label v-if="config.useVisionSystem" class="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" v-model="showVisionRanges" class="rounded" />
                  Vision
                </label>
              </div>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- Charts -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="bg-gray-800 rounded-lg p-4">
          <h4 class="text-sm font-semibold text-gray-400 mb-3">HP Over Time</h4>
          <div class="h-48">
            <Line :data="hpChartData" :options="chartOptions" />
          </div>
        </div>

        <div class="bg-gray-800 rounded-lg p-4">
          <h4 class="text-sm font-semibold text-gray-400 mb-3">DPS Over Time</h4>
          <div class="h-48">
            <Line :data="dpsChartData" :options="chartOptions" />
          </div>
        </div>
      </div>

      <!-- Summary Stats -->
      <div class="bg-gray-800 rounded-lg p-4">
        <h4 class="text-sm font-semibold text-gray-400 mb-3">Battle Summary</h4>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div class="bg-gray-900 rounded p-3">
            <div class="text-2xl font-bold text-blue-400">
              {{ result.teamASurvivors.length }}
            </div>
            <div class="text-xs text-gray-500">Team A Survivors</div>
          </div>
          <div class="bg-gray-900 rounded p-3">
            <div class="text-2xl font-bold text-red-400">
              {{ result.teamBSurvivors.length }}
            </div>
            <div class="text-xs text-gray-500">Team B Survivors</div>
          </div>
          <div class="bg-gray-900 rounded p-3">
            <div class="text-2xl font-bold text-yellow-400">
              {{ result.totalDamageByA.toLocaleString() }}
            </div>
            <div class="text-xs text-gray-500">Damage by Team A</div>
          </div>
          <div class="bg-gray-900 rounded p-3">
            <div class="text-2xl font-bold text-yellow-400">
              {{ result.totalDamageByB.toLocaleString() }}
            </div>
            <div class="text-xs text-gray-500">Damage by Team B</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Production Picker Modal -->
    <div
      v-if="showProductionPicker"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      @click.self="showProductionPicker = null"
    >
      <div class="bg-gray-800 rounded-lg max-w-lg w-full p-4 max-h-[80vh] flex flex-col">
        <h3 class="text-lg font-semibold mb-4">
          Add Production Unit — Team {{ showProductionPicker }}
        </h3>

        <input
          v-model="productionSearchQuery"
          type="text"
          placeholder="Search units..."
          class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 mb-4"
          autofocus
        />

        <div class="flex-1 overflow-y-auto space-y-1">
          <button
            v-for="unit in filteredProductionUnits"
            :key="unit.id"
            @click="addProductionUnit(showProductionPicker!, unit)"
            class="w-full text-left px-3 py-2 hover:bg-gray-700 rounded flex gap-2 items-center"
          >
            <UnitIcon :unitId="unit.id" :size="24" class="rounded shrink-0" />
            <div class="flex-1 min-w-0">
              <span class="font-medium">{{ unit.name }}</span>
              <span class="text-xs ml-2" :class="getFactionClass(unit.faction)">
                {{ unit.faction }}
              </span>
            </div>
            <div class="text-xs text-gray-500 flex gap-3 shrink-0">
              <span>{{ unit.health }} HP</span>
              <span>{{ unit.metalCost }}m</span>
            </div>
          </button>
        </div>

        <button
          @click="showProductionPicker = null"
          class="mt-4 w-full py-2 bg-gray-700 hover:bg-gray-600 rounded"
        >
          Cancel
        </button>
      </div>
    </div>

    <!-- Structure Picker Modal -->
    <div
      v-if="showStructurePicker"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      @click.self="showStructurePicker = null"
    >
      <div class="bg-gray-800 rounded-lg max-w-lg w-full p-4 max-h-[80vh] flex flex-col">
        <h3 class="text-lg font-semibold mb-4">
          Add Structure to Team {{ showStructurePicker }}
        </h3>

        <input
          v-model="structureSearchQuery"
          type="text"
          placeholder="Search turrets &amp; buildings..."
          class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded mb-3"
          autofocus
        />

        <div class="flex-1 overflow-y-auto space-y-1">
          <button
            v-for="unit in filteredBuildingUnits"
            :key="unit.id"
            @click="addStructure(showStructurePicker!, unit)"
            class="w-full text-left px-3 py-2 hover:bg-gray-700 rounded"
          >
            <div class="flex gap-2 items-start">
              <UnitIcon :unitId="unit.id" :size="28" class="mt-0.5 rounded shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="flex items-baseline gap-2 flex-wrap">
                  <span class="font-medium text-sm">{{ unit.name }}</span>
                  <span class="text-xs" :class="getFactionClass(unit.faction)">{{ unit.faction }}</span>
                  <span class="text-xs text-purple-400">{{ unit.tier }}</span>
                </div>
                <div v-if="unit.description" class="text-xs text-gray-400 mt-0.5 truncate">
                  {{ unit.description }}
                </div>
              </div>
              <div class="text-xs text-gray-500 ml-2 shrink-0">
                {{ unit.health }} HP · range {{ unit.weapons[0]?.range ?? 0 }}
              </div>
            </div>
          </button>
          <div v-if="filteredBuildingUnits.length === 0" class="text-center py-8 text-gray-500">
            No buildings found
          </div>
        </div>

        <button
          @click="showStructurePicker = null"
          class="mt-4 w-full py-2 bg-gray-700 hover:bg-gray-600 rounded"
        >
          Cancel
        </button>
      </div>
    </div>

    <!-- Unit Picker Modal -->
    <div
      v-if="showPicker"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      @click.self="showPicker = null"
    >
      <div class="bg-gray-800 rounded-lg max-w-lg w-full p-4 max-h-[80vh] flex flex-col">
        <h3 class="text-lg font-semibold mb-4">
          Add Unit to Team {{ showPicker }}
        </h3>

        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search units..."
          class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 mb-4"
          autofocus
        />

        <div class="flex-1 overflow-y-auto space-y-1">
          <button
            v-for="unit in filteredUnits"
            :key="unit.id"
            @click="addUnit(showPicker!, unit)"
            class="w-full text-left px-3 py-2 hover:bg-gray-700 rounded"
          >
            <div class="flex gap-2 items-start">
              <UnitIcon :unitId="unit.id" :size="28" class="mt-0.5 rounded shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="flex items-baseline gap-2 flex-wrap">
                  <span class="font-medium">{{ unit.name }}</span>
                  <span class="text-xs" :class="getFactionClass(unit.faction)">{{ unit.faction }}</span>
                  <span class="text-xs text-purple-400">{{ unit.tier }}</span>
                  <span class="text-xs text-gray-500">{{ unit.unitType }}</span>
                </div>
                <div v-if="unit.description" class="text-xs text-gray-400 mt-0.5 truncate">
                  {{ unit.description }}
                </div>
              </div>
              <div class="text-xs text-gray-500 flex gap-2 ml-2 shrink-0">
                <span>{{ unit.health }} HP</span>
                <span>{{ unit.weapons.reduce((s, w) => s + (w.dps || 0), 0).toFixed(0) }} DPS</span>
              </div>
            </div>
          </button>
        </div>

        <button
          @click="showPicker = null"
          class="mt-4 w-full py-2 bg-gray-700 hover:bg-gray-600 rounded"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>
