<script setup lang="ts">
import { ref, computed } from 'vue'
import { useUnitStore } from '../../stores/unitStore'
import { getStatDef, getStatsByCategory } from '../../services/statCalculator'
import type { Unit } from '../../types'

const emit = defineEmits<{
  selectUnit: [unit: Unit]
}>()

const unitStore = useUnitStore()
const statsByCategory = getStatsByCategory()

// Selected stats for display (user can customize)
const selectedXStat = ref('metalCost')
const selectedYStat = ref('health')
const sortBy = ref('ratio')
const sortDir = ref<'asc' | 'desc'>('desc')

const xDef = computed(() => getStatDef(selectedXStat.value))
const yDef = computed(() => getStatDef(selectedYStat.value))

const tableData = computed(() => {
  if (!xDef.value || !yDef.value) return []

  return unitStore.filteredUnits.map(unit => {
    const xVal = xDef.value!.getValue(unit)
    const yVal = yDef.value!.getValue(unit)
    const ratio = xVal > 0 ? yVal / xVal : 0

    return {
      unit,
      xVal,
      yVal,
      ratio
    }
  }).sort((a, b) => {
    let aVal: number, bVal: number

    switch (sortBy.value) {
      case 'x': aVal = a.xVal; bVal = b.xVal; break
      case 'y': aVal = a.yVal; bVal = b.yVal; break
      case 'ratio': aVal = a.ratio; bVal = b.ratio; break
      default: aVal = 0; bVal = 0
    }

    return sortDir.value === 'desc' ? bVal - aVal : aVal - bVal
  })
})

const toggleSort = (key: string) => {
  if (sortBy.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = key
    sortDir.value = 'desc'
  }
}

const getSortIcon = (key: string) => {
  if (sortBy.value !== key) return ''
  return sortDir.value === 'asc' ? '↑' : '↓'
}

const formatValue = (value: number, decimals = 2): string => {
  if (value === 0) return '-'
  if (Number.isInteger(value)) return value.toString()
  return value.toFixed(decimals)
}

const getFactionClass = (faction: string) => {
  switch (faction) {
    case 'Armada': return 'text-blue-400'
    case 'Cortex': return 'text-red-400'
    case 'Legion': return 'text-green-400'
    default: return 'text-gray-400'
  }
}

// Common presets
const presets = [
  { label: 'HP per Metal', x: 'metalCost', y: 'health' },
  { label: 'DPS per Metal', x: 'metalCost', y: 'totalDps' },
  { label: 'Speed per Metal', x: 'metalCost', y: 'speed' },
  { label: 'Range per Metal', x: 'metalCost', y: 'maxRange' },
  { label: 'DPS per HP', x: 'health', y: 'totalDps' },
  { label: 'BP per Metal', x: 'metalCost', y: 'buildPower' },
]

const applyPreset = (preset: typeof presets[0]) => {
  selectedXStat.value = preset.x
  selectedYStat.value = preset.y
}
</script>

<template>
  <div class="bg-gray-800 rounded-lg p-4">
    <h2 class="text-lg font-semibold mb-4">Derived Stats Table</h2>

    <!-- Controls -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
      <div>
        <label class="block text-sm text-gray-400 mb-1">Divide by (X)</label>
        <select
          v-model="selectedXStat"
          class="w-full bg-gray-700 border border-gray-600 rounded px-2.5 py-1.5 text-white text-sm"
        >
          <optgroup v-for="(stats, category) in statsByCategory" :key="category" :label="category">
            <option v-for="stat in stats" :key="stat.key" :value="stat.key">
              {{ stat.label }}
            </option>
          </optgroup>
        </select>
      </div>

      <div>
        <label class="block text-sm text-gray-400 mb-1">Stat (Y)</label>
        <select
          v-model="selectedYStat"
          class="w-full bg-gray-700 border border-gray-600 rounded px-2.5 py-1.5 text-white text-sm"
        >
          <optgroup v-for="(stats, category) in statsByCategory" :key="category" :label="category">
            <option v-for="stat in stats" :key="stat.key" :value="stat.key">
              {{ stat.label }}
            </option>
          </optgroup>
        </select>
      </div>

      <div class="flex items-end">
        <div class="text-sm text-gray-400">
          Showing: <span class="text-white">{{ yDef?.label }} / {{ xDef?.label }}</span>
        </div>
      </div>
    </div>

    <!-- Presets -->
    <div class="flex flex-wrap gap-1.5 mb-3">
      <span class="text-sm text-gray-500">Presets:</span>
      <button
        v-for="preset in presets"
        :key="preset.label"
        @click="applyPreset(preset)"
        class="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors"
      >
        {{ preset.label }}
      </button>
    </div>

    <!-- Table -->
    <div class="overflow-x-auto max-h-[calc(100vh-16rem)]">
      <table class="w-full text-sm">
        <thead class="bg-gray-900 sticky top-0">
          <tr>
            <th class="px-3 py-1.5 text-left">Unit</th>
            <th class="px-3 py-1.5 text-left">Faction</th>
            <th class="px-3 py-1.5 text-left">Tier</th>
            <th
              @click="toggleSort('x')"
              class="px-3 py-1.5 text-right cursor-pointer hover:bg-gray-700"
            >
              {{ xDef?.label }} {{ getSortIcon('x') }}
            </th>
            <th
              @click="toggleSort('y')"
              class="px-3 py-1.5 text-right cursor-pointer hover:bg-gray-700"
            >
              {{ yDef?.label }} {{ getSortIcon('y') }}
            </th>
            <th
              @click="toggleSort('ratio')"
              class="px-3 py-1.5 text-right cursor-pointer hover:bg-gray-700"
            >
              Ratio {{ getSortIcon('ratio') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in tableData"
            :key="row.unit.id"
            @click="emit('selectUnit', row.unit)"
            class="border-t border-gray-700/50 hover:bg-gray-700 cursor-pointer transition-colors"
            :class="index < 3 ? 'bg-gray-700/30' : ''"
          >
            <td class="px-3 py-1.5 font-medium">
              <span v-if="index < 3" class="text-yellow-400 mr-1">#{{ index + 1 }}</span>
              {{ row.unit.name }}
            </td>
            <td class="px-3 py-1.5" :class="getFactionClass(row.unit.faction)">
              {{ row.unit.faction }}
            </td>
            <td class="px-3 py-1.5 text-purple-400">{{ row.unit.tier }}</td>
            <td class="px-3 py-1.5 text-right text-gray-300">{{ formatValue(row.xVal, 0) }}</td>
            <td class="px-3 py-1.5 text-right text-gray-300">{{ formatValue(row.yVal, 1) }}</td>
            <td class="px-3 py-1.5 text-right font-mono" :class="row.ratio > 0 ? 'text-green-400' : 'text-gray-500'">
              {{ formatValue(row.ratio, 4) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="text-xs text-gray-500 mt-2">
      Top 3 units are highlighted. Click any row to view unit details.
    </p>
  </div>
</template>
