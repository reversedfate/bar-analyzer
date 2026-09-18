<script setup lang="ts">
import { ref, computed } from 'vue'
import { useUnitStore } from '../../stores/unitStore'
import UnitIcon from '../Common/UnitIcon.vue'
import type { Unit } from '../../types'

const emit = defineEmits<{
  selectUnit: [unit: Unit]
}>()

const unitStore = useUnitStore()

type SortKey = 'name' | 'faction' | 'tier' | 'unitType' | 'metalCost' | 'energyCost' | 'health' | 'speed' | 'dps'
type SortDir = 'asc' | 'desc'

const sortKey = ref<SortKey>('name')
const sortDir = ref<SortDir>('asc')

const sortedUnits = computed(() => {
  const units = [...unitStore.filteredUnits]

  units.sort((a, b) => {
    let aVal: string | number
    let bVal: string | number

    if (sortKey.value === 'dps') {
      aVal = a.weapons.reduce((sum, w) => sum + (w.dps || 0), 0)
      bVal = b.weapons.reduce((sum, w) => sum + (w.dps || 0), 0)
    } else {
      aVal = a[sortKey.value] as string | number
      bVal = b[sortKey.value] as string | number
    }

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDir.value === 'asc'
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal)
    }

    const numA = Number(aVal) || 0
    const numB = Number(bVal) || 0
    return sortDir.value === 'asc' ? numA - numB : numB - numA
  })

  return units
})

const toggleSort = (key: SortKey) => {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'asc'
  }
}

const getSortIcon = (key: SortKey) => {
  if (sortKey.value !== key) return ''
  return sortDir.value === 'asc' ? '↑' : '↓'
}

const getFactionClass = (faction: string) => {
  switch (faction) {
    case 'Armada': return 'text-blue-400'
    case 'Cortex': return 'text-red-400'
    case 'Legion': return 'text-green-400'
    default: return 'text-gray-400'
  }
}

const getTotalDps = (unit: Unit) => {
  return unit.weapons.reduce((sum, w) => sum + (w.dps || 0), 0).toFixed(1)
}
</script>

<template>
  <div class="bg-gray-800 rounded-lg overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-gray-900">
          <tr>
            <th
              @click="toggleSort('name')"
              class="px-3 py-2 text-left cursor-pointer hover:bg-gray-700 transition-colors"
            >
              Name {{ getSortIcon('name') }}
            </th>
            <th
              @click="toggleSort('faction')"
              class="px-3 py-2 text-left cursor-pointer hover:bg-gray-700 transition-colors"
            >
              Faction {{ getSortIcon('faction') }}
            </th>
            <th
              @click="toggleSort('tier')"
              class="px-3 py-2 text-left cursor-pointer hover:bg-gray-700 transition-colors"
            >
              Tier {{ getSortIcon('tier') }}
            </th>
            <th
              @click="toggleSort('unitType')"
              class="px-3 py-2 text-left cursor-pointer hover:bg-gray-700 transition-colors"
            >
              Type {{ getSortIcon('unitType') }}
            </th>
            <th
              @click="toggleSort('metalCost')"
              class="px-3 py-2 text-right cursor-pointer hover:bg-gray-700 transition-colors"
            >
              Metal {{ getSortIcon('metalCost') }}
            </th>
            <th
              @click="toggleSort('energyCost')"
              class="px-3 py-2 text-right cursor-pointer hover:bg-gray-700 transition-colors"
            >
              Energy {{ getSortIcon('energyCost') }}
            </th>
            <th
              @click="toggleSort('health')"
              class="px-3 py-2 text-right cursor-pointer hover:bg-gray-700 transition-colors"
            >
              HP {{ getSortIcon('health') }}
            </th>
            <th
              @click="toggleSort('speed')"
              class="px-3 py-2 text-right cursor-pointer hover:bg-gray-700 transition-colors"
            >
              Speed {{ getSortIcon('speed') }}
            </th>
            <th
              @click="toggleSort('dps')"
              class="px-3 py-2 text-right cursor-pointer hover:bg-gray-700 transition-colors"
            >
              DPS {{ getSortIcon('dps') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="unit in sortedUnits"
            :key="unit.id"
            @click="emit('selectUnit', unit)"
            class="border-t border-gray-700 hover:bg-gray-700 cursor-pointer transition-colors"
          >
            <td class="px-3 py-1.5 font-medium">
              <span class="flex items-center gap-2">
                <UnitIcon :unitId="unit.id" :size="20" />
                <span :title="unit.description || undefined">{{ unit.name }}</span>
              </span>
            </td>
            <td class="px-3 py-1.5" :class="getFactionClass(unit.faction)">{{ unit.faction }}</td>
            <td class="px-3 py-1.5 text-purple-400">{{ unit.tier }}</td>
            <td class="px-3 py-1.5 text-gray-400">{{ unit.unitType }}</td>
            <td class="px-3 py-1.5 text-right text-yellow-400">{{ unit.metalCost }}</td>
            <td class="px-3 py-1.5 text-right text-cyan-400">{{ unit.energyCost }}</td>
            <td class="px-3 py-1.5 text-right text-green-400">{{ unit.health }}</td>
            <td class="px-3 py-1.5 text-right text-cyan-400">{{ unit.speed || '-' }}</td>
            <td class="px-3 py-1.5 text-right text-red-400">{{ getTotalDps(unit) || '-' }}</td>
          </tr>
          <tr v-if="sortedUnits.length === 0">
            <td colspan="9" class="px-3 py-8 text-center text-gray-500">
              No units match your filters
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="bg-gray-900 px-3 py-1.5 text-sm text-gray-400">
      Showing {{ sortedUnits.length }} of {{ unitStore.units.length }} units
    </div>
  </div>
</template>
