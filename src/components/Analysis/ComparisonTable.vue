<script setup lang="ts">
import { ref, computed } from 'vue'
import { useUnitStore } from '../../stores/unitStore'
import { getStatDef } from '../../services/statCalculator'
import type { Unit } from '../../types'

const unitStore = useUnitStore()

const selectedUnits = ref<Unit[]>([])
const searchQuery = ref('')
const showSelector = ref(false)

const maxUnits = 4

const filteredUnitsForSelection = computed(() => {
  if (!searchQuery.value) return unitStore.units.slice(0, 50)
  const query = searchQuery.value.toLowerCase()
  return unitStore.units
    .filter(u => u.name.toLowerCase().includes(query) || u.id.toLowerCase().includes(query))
    .slice(0, 50)
})

const addUnit = (unit: Unit) => {
  if (selectedUnits.value.length < maxUnits && !selectedUnits.value.find(u => u.id === unit.id)) {
    selectedUnits.value.push(unit)
  }
  searchQuery.value = ''
  showSelector.value = false
}

const removeUnit = (index: number) => {
  selectedUnits.value.splice(index, 1)
}

const clearAll = () => {
  selectedUnits.value = []
}

// Stats to display in comparison
const comparisonStats: { key: string; label: string; highlight: 'high' | 'low' }[] = [
  { key: 'metalCost', label: 'Metal Cost', highlight: 'low' },
  { key: 'energyCost', label: 'Energy Cost', highlight: 'low' },
  { key: 'buildTime', label: 'Build Time', highlight: 'low' },
  { key: 'health', label: 'Health', highlight: 'high' },
  { key: 'totalDps', label: 'Total DPS', highlight: 'high' },
  { key: 'maxRange', label: 'Max Range', highlight: 'high' },
  { key: 'speed', label: 'Speed', highlight: 'high' },
  { key: 'sightRange', label: 'Sight Range', highlight: 'high' },
  { key: 'healthPerMetal', label: 'HP/Metal', highlight: 'high' },
  { key: 'dpsPerMetal', label: 'DPS/Metal', highlight: 'high' },
  { key: 'buildPower', label: 'Build Power', highlight: 'high' },
  { key: 'radarRange', label: 'Radar', highlight: 'high' },
]

const getStatValue = (unit: Unit, key: string): number => {
  const def = getStatDef(key)
  return def ? def.getValue(unit) : 0
}

const formatValue = (unit: Unit, key: string): string => {
  const def = getStatDef(key)
  if (!def) return '-'
  const value = def.getValue(unit)
  if (value === 0 && ['buildPower', 'radarRange', 'speed'].includes(key)) return '-'
  return def.format ? def.format(value) : value.toString()
}

const getBestValue = (statKey: string, highlight: 'high' | 'low'): number => {
  if (selectedUnits.value.length === 0) return 0
  const values = selectedUnits.value.map(u => getStatValue(u, statKey))
  return highlight === 'high' ? Math.max(...values) : Math.min(...values)
}

const isBest = (unit: Unit, statKey: string, highlight: 'high' | 'low'): boolean => {
  if (selectedUnits.value.length <= 1) return false
  const value = getStatValue(unit, statKey)
  const best = getBestValue(statKey, highlight)
  return value === best && value !== 0
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
  <div class="bg-gray-800 rounded-lg p-4">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-lg font-semibold">Unit Comparison</h2>
      <div class="flex gap-2">
        <button
          v-if="selectedUnits.length > 0"
          @click="clearAll"
          class="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors"
        >
          Clear All
        </button>
        <button
          v-if="selectedUnits.length < maxUnits"
          @click="showSelector = !showSelector"
          class="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-500 rounded transition-colors"
        >
          + Add Unit
        </button>
      </div>
    </div>

    <!-- Unit Selector -->
    <div v-if="showSelector" class="mb-3 p-3 bg-gray-900 rounded-lg">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search units..."
        class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white mb-2"
        autofocus
      />
      <div class="max-h-48 overflow-y-auto">
        <button
          v-for="unit in filteredUnitsForSelection"
          :key="unit.id"
          @click="addUnit(unit)"
          :disabled="selectedUnits.some(u => u.id === unit.id)"
          class="w-full text-left px-3 py-2 hover:bg-gray-700 rounded flex justify-between items-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span>{{ unit.name }}</span>
          <span class="text-xs" :class="getFactionClass(unit.faction)">{{ unit.faction }}</span>
        </button>
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="selectedUnits.length === 0" class="text-center py-8 text-gray-500">
      <p>No units selected for comparison.</p>
      <p class="text-sm">Click "Add Unit" to select up to {{ maxUnits }} units.</p>
    </div>

    <!-- Comparison Table -->
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-gray-700">
            <th class="px-3 py-2 text-left text-gray-400 font-medium">Stat</th>
            <th
              v-for="(unit, index) in selectedUnits"
              :key="unit.id"
              class="px-3 py-2 text-center min-w-32"
            >
              <div class="flex flex-col items-center">
                <span class="font-semibold">{{ unit.name }}</span>
                <span class="text-xs" :class="getFactionClass(unit.faction)">
                  {{ unit.faction }} {{ unit.tier }}
                </span>
                <button
                  @click="removeUnit(index)"
                  class="mt-1 text-xs text-gray-500 hover:text-red-400"
                >
                  Remove
                </button>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="stat in comparisonStats"
            :key="stat.key"
            class="border-b border-gray-700/50 hover:bg-gray-700/30"
          >
            <td class="px-3 py-1.5 text-gray-400">{{ stat.label }}</td>
            <td
              v-for="unit in selectedUnits"
              :key="unit.id"
              class="px-3 py-1.5 text-center"
              :class="isBest(unit, stat.key, stat.highlight) ? 'text-green-400 font-bold' : ''"
            >
              {{ formatValue(unit, stat.key) }}
            </td>
          </tr>

          <!-- Weapons Row -->
          <tr class="border-b border-gray-700/50">
            <td class="px-3 py-1.5 text-gray-400">Weapons</td>
            <td
              v-for="unit in selectedUnits"
              :key="unit.id"
              class="px-3 py-1.5 text-center text-xs"
            >
              <div v-if="unit.weapons.length === 0" class="text-gray-500">-</div>
              <div v-else class="space-y-1">
                <div v-for="weapon in unit.weapons" :key="weapon.id" class="text-gray-300">
                  {{ weapon.damage }} dmg @ {{ weapon.range }}
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="text-xs text-gray-500 mt-4">
      Green highlighted values indicate the best in that category.
    </p>
  </div>
</template>
