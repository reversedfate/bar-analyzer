<script setup lang="ts">
import { ref, computed } from 'vue'
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
import { runSimulation, calculateRequiredUnits, type TargetingStrategy, type SimResult } from '../../services/combatSimulator'
import UnitIcon from '../Common/UnitIcon.vue'
import type { Unit } from '../../types'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend)

const unitStore = useUnitStore()

// Team setup
interface TeamUnit {
  unit: Unit
  count: number
}

const teamA = ref<TeamUnit[]>([])
const teamB = ref<TeamUnit[]>([])
const teamAStrategy = ref<TargetingStrategy>('focus')
const teamBStrategy = ref<TargetingStrategy>('focus')
const maxTime = ref(120)

// Unit selector
const showSelector = ref<'A' | 'B' | null>(null)
const searchQuery = ref('')

// Results
const result = ref<SimResult | null>(null)
const isSimulating = ref(false)

// Auto-calculate mode
const autoCalcResult = ref<{ count: number; result: SimResult } | null>(null)

const strategies: { value: TargetingStrategy; label: string }[] = [
  { value: 'focus', label: 'Focus Fire' },
  { value: 'spread', label: 'Spread Fire' },
  { value: 'lowestHp', label: 'Lowest HP' },
  { value: 'highestDps', label: 'Highest DPS' },
  { value: 'random', label: 'Random' }
]

const filteredUnits = computed(() => {
  // Use store-filtered units (applies sidebar faction/tier/type/search filters)
  let units = unitStore.filteredUnits.filter(u => u.weapons.length > 0)

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    units = units.filter(u =>
      u.name.toLowerCase().includes(query) ||
      u.id.toLowerCase().includes(query) ||
      (u.description && u.description.toLowerCase().includes(query))
    )
  }

  return units.slice(0, 60)
})

const addUnit = (unit: Unit, team: 'A' | 'B') => {
  const targetTeam = team === 'A' ? teamA : teamB
  const existing = targetTeam.value.find(u => u.unit.id === unit.id)

  if (existing) {
    existing.count++
  } else {
    targetTeam.value.push({ unit, count: 1 })
  }

  showSelector.value = null
  searchQuery.value = ''
}

const removeUnit = (index: number, team: 'A' | 'B') => {
  const targetTeam = team === 'A' ? teamA : teamB
  targetTeam.value.splice(index, 1)
}

const updateCount = (index: number, team: 'A' | 'B', delta: number) => {
  const targetTeam = team === 'A' ? teamA : teamB
  const newCount = targetTeam.value[index].count + delta
  if (newCount >= 1 && newCount <= 100) {
    targetTeam.value[index].count = newCount
  }
}

const clearTeam = (team: 'A' | 'B') => {
  if (team === 'A') {
    teamA.value = []
  } else {
    teamB.value = []
  }
}

const runBattle = () => {
  if (teamA.value.length === 0 || teamB.value.length === 0) return

  isSimulating.value = true
  result.value = null

  // Run simulation in next tick to allow UI to update
  setTimeout(() => {
    result.value = runSimulation(
      teamA.value.map(t => ({ unit: t.unit, count: t.count })),
      teamB.value.map(t => ({ unit: t.unit, count: t.count })),
      {
        teamAStrategy: teamAStrategy.value,
        teamBStrategy: teamBStrategy.value,
        maxTime: maxTime.value
      }
    )
    isSimulating.value = false
  }, 10)
}

const runAutoCalc = () => {
  if (teamA.value.length !== 1 || teamB.value.length !== 1) return

  isSimulating.value = true
  autoCalcResult.value = null

  setTimeout(() => {
    const unitA = teamA.value[0].unit
    const unitB = teamB.value[0].unit
    const countB = teamB.value[0].count

    autoCalcResult.value = calculateRequiredUnits(
      unitA,
      unitB,
      countB,
      teamAStrategy.value
    )
    isSimulating.value = false
  }, 10)
}

const teamATotalCost = computed(() =>
  teamA.value.reduce((sum, t) => sum + t.unit.metalCost * t.count, 0)
)

const teamBTotalCost = computed(() =>
  teamB.value.reduce((sum, t) => sum + t.unit.metalCost * t.count, 0)
)

const teamATotalHp = computed(() =>
  teamA.value.reduce((sum, t) => sum + t.unit.health * t.count, 0)
)

const teamBTotalHp = computed(() =>
  teamB.value.reduce((sum, t) => sum + t.unit.health * t.count, 0)
)

const teamATotalDps = computed(() =>
  teamA.value.reduce((sum, t) => {
    const dps = t.unit.weapons.reduce((s, w) => s + (w.dps || 0), 0)
    return sum + dps * t.count
  }, 0)
)

const teamBTotalDps = computed(() =>
  teamB.value.reduce((sum, t) => {
    const dps = t.unit.weapons.reduce((s, w) => s + (w.dps || 0), 0)
    return sum + dps * t.count
  }, 0)
)

// Chart data
const chartData = computed(() => {
  if (!result.value) return { labels: [], datasets: [] }

  const labels = result.value.timeline.map(t => t.time.toFixed(1))

  return {
    labels,
    datasets: [
      {
        label: 'Team A HP',
        data: result.value.timeline.map(t => t.teamAHp),
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.1
      },
      {
        label: 'Team B HP',
        data: result.value.timeline.map(t => t.teamBHp),
        borderColor: 'rgb(239, 68, 68)',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        fill: true,
        tension: 0.1
      }
    ]
  }
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'top' as const,
      labels: { color: '#9ca3af' }
    }
  },
  scales: {
    x: {
      title: { display: true, text: 'Time (s)', color: '#9ca3af' },
      grid: { color: 'rgba(75, 85, 99, 0.3)' },
      ticks: { color: '#9ca3af' }
    },
    y: {
      title: { display: true, text: 'Total HP', color: '#9ca3af' },
      grid: { color: 'rgba(75, 85, 99, 0.3)' },
      ticks: { color: '#9ca3af' },
      beginAtZero: true
    }
  }
}

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
    <!-- Battle Setup -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Team A -->
      <div class="bg-gray-800 rounded-lg p-4">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-blue-400">Team A</h3>
          <div class="flex gap-2">
            <select
              v-model="teamAStrategy"
              class="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
            >
              <option v-for="s in strategies" :key="s.value" :value="s.value">
                {{ s.label }}
              </option>
            </select>
            <button
              @click="showSelector = 'A'"
              class="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-500 rounded"
            >
              + Add
            </button>
            <button
              v-if="teamA.length > 0"
              @click="clearTeam('A')"
              class="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded"
            >
              Clear
            </button>
          </div>
        </div>

        <div v-if="teamA.length === 0" class="text-center py-8 text-gray-500">
          No units added
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="(item, index) in teamA"
            :key="item.unit.id"
            class="flex items-center justify-between bg-gray-900 rounded p-2"
          >
            <div>
              <span class="font-medium">{{ item.unit.name }}</span>
              <span class="text-xs ml-2" :class="getFactionClass(item.unit.faction)">
                {{ item.unit.faction }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <button
                @click="updateCount(index, 'A', -1)"
                class="w-6 h-6 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                -
              </button>
              <span class="w-8 text-center">{{ item.count }}</span>
              <button
                @click="updateCount(index, 'A', 1)"
                class="w-6 h-6 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                +
              </button>
              <button
                @click="removeUnit(index, 'A')"
                class="ml-2 text-red-400 hover:text-red-300"
              >
                ×
              </button>
            </div>
          </div>
        </div>

        <!-- Team A Stats -->
        <div v-if="teamA.length > 0" class="mt-4 pt-4 border-t border-gray-700 grid grid-cols-3 gap-2 text-sm">
          <div>
            <span class="text-gray-500">Cost:</span>
            <span class="text-yellow-400 ml-1">{{ teamATotalCost }}</span>
          </div>
          <div>
            <span class="text-gray-500">HP:</span>
            <span class="text-green-400 ml-1">{{ teamATotalHp }}</span>
          </div>
          <div>
            <span class="text-gray-500">DPS:</span>
            <span class="text-red-400 ml-1">{{ teamATotalDps.toFixed(1) }}</span>
          </div>
        </div>
      </div>

      <!-- Team B -->
      <div class="bg-gray-800 rounded-lg p-4">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-red-400">Team B</h3>
          <div class="flex gap-2">
            <select
              v-model="teamBStrategy"
              class="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
            >
              <option v-for="s in strategies" :key="s.value" :value="s.value">
                {{ s.label }}
              </option>
            </select>
            <button
              @click="showSelector = 'B'"
              class="px-3 py-1 text-sm bg-red-600 hover:bg-red-500 rounded"
            >
              + Add
            </button>
            <button
              v-if="teamB.length > 0"
              @click="clearTeam('B')"
              class="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded"
            >
              Clear
            </button>
          </div>
        </div>

        <div v-if="teamB.length === 0" class="text-center py-8 text-gray-500">
          No units added
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="(item, index) in teamB"
            :key="item.unit.id"
            class="flex items-center justify-between bg-gray-900 rounded p-2"
          >
            <div>
              <span class="font-medium">{{ item.unit.name }}</span>
              <span class="text-xs ml-2" :class="getFactionClass(item.unit.faction)">
                {{ item.unit.faction }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <button
                @click="updateCount(index, 'B', -1)"
                class="w-6 h-6 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                -
              </button>
              <span class="w-8 text-center">{{ item.count }}</span>
              <button
                @click="updateCount(index, 'B', 1)"
                class="w-6 h-6 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                +
              </button>
              <button
                @click="removeUnit(index, 'B')"
                class="ml-2 text-red-400 hover:text-red-300"
              >
                ×
              </button>
            </div>
          </div>
        </div>

        <!-- Team B Stats -->
        <div v-if="teamB.length > 0" class="mt-4 pt-4 border-t border-gray-700 grid grid-cols-3 gap-2 text-sm">
          <div>
            <span class="text-gray-500">Cost:</span>
            <span class="text-yellow-400 ml-1">{{ teamBTotalCost }}</span>
          </div>
          <div>
            <span class="text-gray-500">HP:</span>
            <span class="text-green-400 ml-1">{{ teamBTotalHp }}</span>
          </div>
          <div>
            <span class="text-gray-500">DPS:</span>
            <span class="text-red-400 ml-1">{{ teamBTotalDps.toFixed(1) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Settings -->
    <div class="flex justify-center">
      <div class="bg-gray-800 rounded-lg px-4 py-2 flex items-center gap-3">
        <label class="text-xs text-gray-400">Draw Timeout (s)</label>
        <input
          v-model.number="maxTime"
          type="number"
          min="1"
          class="w-20 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
        />
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="flex justify-center gap-4">
      <button
        @click="runBattle"
        :disabled="teamA.length === 0 || teamB.length === 0 || isSimulating"
        class="px-6 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-medium transition-colors"
      >
        {{ isSimulating ? 'Simulating...' : 'Run Battle' }}
      </button>
      <button
        v-if="teamA.length === 1 && teamB.length === 1"
        @click="runAutoCalc"
        :disabled="isSimulating"
        class="px-6 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-medium transition-colors"
      >
        Auto-Calculate Count
      </button>
    </div>

    <!-- Auto-calc Result -->
    <div v-if="autoCalcResult" class="bg-gray-800 rounded-lg p-4 text-center">
      <p class="text-lg">
        <span class="text-blue-400 font-bold">{{ autoCalcResult.count }}x {{ teamA[0].unit.name }}</span>
        needed to beat
        <span class="text-red-400 font-bold">{{ teamB[0].count }}x {{ teamB[0].unit.name }}</span>
      </p>
      <p class="text-sm text-gray-400 mt-1">
        Battle duration: {{ autoCalcResult.result.duration.toFixed(1) }}s |
        Survivors: {{ autoCalcResult.result.teamASurvivors.length }}
      </p>
    </div>

    <!-- Results -->
    <div v-if="result" class="bg-gray-800 rounded-lg p-4">
      <h3 class="text-lg font-semibold mb-4">Battle Results</h3>

      <!-- Winner Banner -->
      <div
        :class="[
          'text-center py-4 rounded mb-4 text-xl font-bold',
          result.winner === 'A' ? 'bg-blue-900/50 text-blue-400' :
          result.winner === 'B' ? 'bg-red-900/50 text-red-400' :
          'bg-gray-700 text-gray-400'
        ]"
      >
        {{ result.winner === 'draw' ? 'Draw!' : `Team ${result.winner} Wins!` }}
      </div>

      <!-- Stats Grid -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="bg-gray-900 rounded p-3 text-center">
          <div class="text-2xl font-bold text-gray-300">{{ result.duration.toFixed(1) }}s</div>
          <div class="text-xs text-gray-500">Duration</div>
        </div>
        <div class="bg-gray-900 rounded p-3 text-center">
          <div class="text-2xl font-bold text-blue-400">{{ result.teamASurvivors.length }}</div>
          <div class="text-xs text-gray-500">Team A Survivors</div>
        </div>
        <div class="bg-gray-900 rounded p-3 text-center">
          <div class="text-2xl font-bold text-red-400">{{ result.teamBSurvivors.length }}</div>
          <div class="text-xs text-gray-500">Team B Survivors</div>
        </div>
        <div class="bg-gray-900 rounded p-3 text-center">
          <div class="text-2xl font-bold text-gray-300">{{ result.events.length }}</div>
          <div class="text-xs text-gray-500">Total Events</div>
        </div>
      </div>

      <!-- Damage Stats -->
      <div class="grid grid-cols-2 gap-4 mb-6">
        <div class="bg-gray-900 rounded p-3">
          <div class="text-sm text-gray-500 mb-1">Team A Damage Dealt</div>
          <div class="text-xl font-bold text-blue-400">{{ result.totalDamageByA.toFixed(0) }}</div>
        </div>
        <div class="bg-gray-900 rounded p-3">
          <div class="text-sm text-gray-500 mb-1">Team B Damage Dealt</div>
          <div class="text-xl font-bold text-red-400">{{ result.totalDamageByB.toFixed(0) }}</div>
        </div>
      </div>

      <!-- HP Timeline Chart -->
      <div class="h-64">
        <Line :data="chartData" :options="chartOptions" />
      </div>

      <!-- Event Log (collapsed by default) -->
      <details class="mt-4">
        <summary class="cursor-pointer text-sm text-gray-400 hover:text-white">
          Show Event Log ({{ result.events.length }} events)
        </summary>
        <div class="mt-2 max-h-48 overflow-y-auto text-xs font-mono bg-gray-900 rounded p-2">
          <div v-for="(event, i) in result.events.slice(0, 100)" :key="i" class="text-gray-400">
            <span class="text-gray-600">[{{ event.time.toFixed(2) }}s]</span>
            <span v-if="event.type === 'fire'" class="text-yellow-400">
              {{ event.attacker }} fires at {{ event.target }}
            </span>
            <span v-else-if="event.type === 'damage'" class="text-red-400">
              {{ event.target }} takes {{ event.damage }} damage
            </span>
            <span v-else-if="event.type === 'death'" class="text-red-600">
              {{ event.unit }} destroyed by {{ event.killer }}
            </span>
            <span v-else-if="event.type === 'stun'" class="text-purple-400">
              {{ event.unit }} stunned for {{ event.duration }}s
            </span>
          </div>
          <div v-if="result.events.length > 100" class="text-gray-600">
            ... and {{ result.events.length - 100 }} more events
          </div>
        </div>
      </details>
    </div>

    <!-- Unit Selector Modal -->
    <div
      v-if="showSelector"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      @click.self="showSelector = null"
    >
      <div class="bg-gray-800 rounded-lg max-w-lg w-full p-4">
        <h3 class="text-lg font-semibold mb-4">
          Add Unit to Team {{ showSelector }}
        </h3>

        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search combat units..."
          class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 mb-4"
          autofocus
        />

        <div class="max-h-64 overflow-y-auto space-y-1">
          <button
            v-for="unit in filteredUnits"
            :key="unit.id"
            @click="addUnit(unit, showSelector!)"
            class="w-full text-left px-3 py-2 hover:bg-gray-700 rounded"
          >
            <div class="flex gap-2 items-start">
              <UnitIcon :unitId="unit.id" :size="28" class="mt-0.5 rounded" />
              <div class="flex-1 min-w-0">
                <div class="flex items-baseline gap-2 flex-wrap">
                  <span class="font-medium">{{ unit.name }}</span>
                  <span class="text-xs" :class="getFactionClass(unit.faction)">{{ unit.faction }}</span>
                  <span class="text-xs text-gray-500">{{ unit.unitType }}</span>
                </div>
                <div v-if="unit.description" class="text-xs text-gray-400 mt-0.5 truncate">
                  {{ unit.description }}
                </div>
              </div>
              <div class="text-xs text-gray-500 shrink-0">
                {{ unit.weapons.reduce((s, w) => s + (w.dps || 0), 0).toFixed(1) }} DPS
              </div>
            </div>
          </button>
        </div>

        <button
          @click="showSelector = null"
          class="mt-4 w-full py-2 bg-gray-700 hover:bg-gray-600 rounded"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>
