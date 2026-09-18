<script setup lang="ts">
import { ref, computed } from 'vue'
import { useUnitStore } from '../../stores/unitStore'
import type { Faction, Tier, UnitType } from '../../types'

const unitStore = useUnitStore()

// Local ref so we can clear the input on Enter without going through the store
const searchInput = ref(unitStore.filters.searchQuery)

const factions: Faction[] = ['Armada', 'Cortex', 'Legion']
const tiers: Tier[] = ['T1', 'T2', 'T3']
const unitTypes: UnitType[] = ['Bot', 'Vehicle', 'Aircraft', 'Ship', 'Hovercraft', 'Building', 'Commander']

const factionColors: Record<Faction, string> = {
  Armada: 'bg-blue-600 border-blue-500',
  Cortex: 'bg-red-600 border-red-500',
  Legion: 'bg-green-600 border-green-500'
}

const toggleFaction = (faction: Faction) => {
  const current = [...unitStore.filters.factions]
  const index = current.indexOf(faction)
  if (index === -1) {
    current.push(faction)
  } else {
    current.splice(index, 1)
  }
  unitStore.setFilters({ factions: current })
}

const toggleTier = (tier: Tier) => {
  const current = [...unitStore.filters.tiers]
  const index = current.indexOf(tier)
  if (index === -1) {
    current.push(tier)
  } else {
    current.splice(index, 1)
  }
  unitStore.setFilters({ tiers: current })
}

const toggleUnitType = (type: UnitType) => {
  const current = [...unitStore.filters.unitTypes]
  const index = current.indexOf(type)
  if (index === -1) {
    current.push(type)
  } else {
    current.splice(index, 1)
  }
  unitStore.setFilters({ unitTypes: current })
}

const updateSearch = () => {
  unitStore.setFilters({ searchQuery: searchInput.value })
}

const commitTag = () => {
  const term = searchInput.value.trim()
  if (!term) return
  unitStore.addSearchTag(term)
  searchInput.value = ''
  unitStore.setFilters({ searchQuery: '' })
}

const toggleHideMorphs = () => {
  unitStore.setFilters({ hideMorphs: !unitStore.filters.hideMorphs })
}

const hasActiveFilters = computed(() => {
  return unitStore.filters.factions.length > 0 ||
    unitStore.filters.tiers.length > 0 ||
    unitStore.filters.unitTypes.length > 0 ||
    unitStore.filters.searchQuery !== '' ||
    unitStore.filters.searchTags.length > 0 ||
    !unitStore.filters.hideMorphs
})
</script>

<template>
  <div class="bg-gray-800 rounded-lg p-3 space-y-2.5">
    <!-- Search -->
    <div>
      <label class="block text-xs text-gray-500 mb-1">Search</label>
      <input
        v-model="searchInput"
        type="text"
        @input="updateSearch"
        @keydown.enter="commitTag"
        placeholder="Search... Enter to pin"
        class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
      />
      <!-- Committed search tag chips -->
      <div v-if="unitStore.filters.searchTags.length > 0" class="flex flex-wrap gap-1 mt-1.5">
        <span
          v-for="(tag, i) in unitStore.filters.searchTags"
          :key="i"
          class="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-700 text-white text-xs rounded-full"
        >
          {{ tag }}
          <button
            @click="unitStore.removeSearchTag(i)"
            class="leading-none text-blue-200 hover:text-white transition-colors"
            aria-label="Remove filter"
          >×</button>
        </span>
      </div>
    </div>

    <!-- Factions -->
    <div>
      <label class="block text-xs text-gray-500 mb-1">Faction</label>
      <div class="flex gap-1.5">
        <button
          v-for="faction in factions"
          :key="faction"
          @click="toggleFaction(faction)"
          :class="[
            'flex-1 py-1 rounded text-xs font-medium transition-all border',
            unitStore.filters.factions.includes(faction)
              ? factionColors[faction] + ' text-white'
              : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
          ]"
        >
          {{ faction }}
        </button>
      </div>
    </div>

    <!-- Tiers -->
    <div>
      <label class="block text-xs text-gray-500 mb-1">Tier</label>
      <div class="flex gap-1.5">
        <button
          v-for="tier in tiers"
          :key="tier"
          @click="toggleTier(tier)"
          :class="[
            'flex-1 py-1 rounded text-xs font-medium transition-all border',
            unitStore.filters.tiers.includes(tier)
              ? 'bg-purple-600 border-purple-500 text-white'
              : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
          ]"
        >
          {{ tier }}
        </button>
      </div>
    </div>

    <!-- Unit Types -->
    <div>
      <label class="block text-xs text-gray-500 mb-1">Type</label>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="type in unitTypes"
          :key="type"
          @click="toggleUnitType(type)"
          :class="[
            'px-2 py-0.5 rounded text-xs font-medium transition-all border',
            unitStore.filters.unitTypes.includes(type)
              ? 'bg-yellow-600 border-yellow-500 text-white'
              : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
          ]"
        >
          {{ type }}
        </button>
      </div>
    </div>

    <!-- Options & Clear -->
    <div class="flex items-center justify-between">
      <label class="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer hover:text-gray-300">
        <input
          type="checkbox"
          :checked="!unitStore.filters.hideMorphs"
          @change="toggleHideMorphs"
          class="rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800"
        />
        Morphs
      </label>
      <button
        v-if="hasActiveFilters"
        @click="unitStore.clearFilters()"
        class="text-xs text-gray-500 hover:text-white transition-colors"
      >
        Clear
      </button>
    </div>
  </div>
</template>
