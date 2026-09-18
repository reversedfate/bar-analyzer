<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useUnitStore } from './stores/unitStore'
import FilterPanel from './components/UnitBrowser/FilterPanel.vue'
import UnitTable from './components/UnitBrowser/UnitTable.vue'
import UnitDetail from './components/UnitBrowser/UnitDetail.vue'
import ScatterPlot from './components/Analysis/ScatterPlot.vue'
import ComparisonTable from './components/Analysis/ComparisonTable.vue'
import StatsTable from './components/Analysis/StatsTable.vue'
import SpatialBattleSetup from './components/Combat/SpatialBattleSetup.vue'
import EconomyOptimizer from './components/Economy/EconomyOptimizer.vue'
import type { Unit } from './types'

const unitStore = useUnitStore()
const isLoading = ref(true)
const selectedUnit = ref<Unit | null>(null)
const showImportModal = ref(false)
const importText = ref('')
const importError = ref('')

type TabId = 'browser' | 'scatter' | 'compare' | 'stats' | 'combat' | 'economy'
const activeTab = ref<TabId>('browser')

const tabs: { id: TabId; label: string }[] = [
  { id: 'browser', label: 'Browser' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'compare', label: 'Compare' },
  { id: 'stats', label: 'Stats' },
  { id: 'combat', label: 'Combat' },
  { id: 'economy', label: 'Economy' }
]

const sidebarOpen = ref(true)
const sidebarTabs: TabId[] = ['browser', 'scatter', 'compare', 'stats']
const tabUsesSidebar = computed(() => sidebarTabs.includes(activeTab.value))

watch(activeTab, (tab) => {
  sidebarOpen.value = sidebarTabs.includes(tab)
})

onMounted(async () => {
  await unitStore.loadUnits()
  isLoading.value = false
})

const selectUnit = (unit: Unit) => {
  selectedUnit.value = unit
}

const closeDetail = () => {
  selectedUnit.value = null
}

const handleExport = () => {
  const json = unitStore.exportUnits()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `bar-units-${new Date().toISOString().split('T')[0]}.json`
  a.click()
  URL.revokeObjectURL(url)
}

const handleImport = () => {
  importError.value = ''
  const result = unitStore.importUnits(importText.value)
  if (result.success) {
    showImportModal.value = false
    importText.value = ''
  } else {
    importError.value = result.error || 'Invalid JSON'
  }
}

const handleFileImport = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = (e) => {
    importText.value = e.target?.result as string
  }
  reader.readAsText(file)
}
</script>

<template>
  <div class="min-h-screen bg-gray-900 text-white">
    <!-- Header -->
    <header class="bg-gray-800 border-b border-gray-700 h-12 flex items-center px-4 gap-3">
      <span class="text-sm font-bold uppercase tracking-wide text-gray-200 flex-shrink-0">BAR Analyzer</span>

      <!-- Sidebar toggle -->
      <button
        v-if="tabUsesSidebar && unitStore.units.length > 0"
        @click="sidebarOpen = !sidebarOpen"
        class="text-gray-400 hover:text-white p-1 rounded transition-colors flex-shrink-0"
        :title="sidebarOpen ? 'Hide sidebar' : 'Show sidebar'"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <!-- Tabs -->
      <nav v-if="unitStore.units.length > 0" class="flex gap-1 flex-1 min-w-0">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          @click="activeTab = tab.id"
          :class="[
            'px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap',
            activeTab === tab.id
              ? 'bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/30'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
          ]"
        >
          {{ tab.label }}
        </button>
      </nav>

      <!-- Import/Export -->
      <div class="flex gap-1.5 flex-shrink-0">
        <button
          @click="showImportModal = true"
          class="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
        >
          Import
        </button>
        <button
          @click="handleExport"
          class="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs transition-colors"
        >
          Export
        </button>
      </div>
    </header>

    <main class="p-3">
      <!-- Loading State -->
      <div v-if="isLoading" class="flex items-center justify-center h-64">
        <div class="text-gray-400">Loading unit data...</div>
      </div>

      <!-- No Data State -->
      <div v-else-if="unitStore.units.length === 0" class="text-center py-12">
        <p class="text-gray-400 mb-4">No unit data loaded.</p>
        <p class="text-gray-500 text-sm mb-4">
          Run <code class="bg-gray-800 px-2 py-1 rounded">npm run parse-units</code> to generate unit data.
        </p>
        <button
          @click="showImportModal = true"
          class="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm transition-colors"
        >
          Or import JSON data
        </button>
      </div>

      <!-- Main Content -->
      <div v-else class="flex gap-3">
        <!-- Sidebar (collapsible, only for filter tabs) -->
        <aside
          v-if="tabUsesSidebar"
          :class="[
            'flex-shrink-0 transition-all duration-200 overflow-hidden',
            sidebarOpen ? 'w-56' : 'w-0'
          ]"
        >
          <div class="w-56">
            <FilterPanel />

            <!-- Stats Summary -->
            <div class="mt-3 bg-gray-800 rounded-lg p-3">
              <h3 class="text-xs font-semibold text-gray-400 uppercase mb-2">Summary</h3>
              <div class="space-y-1.5 text-xs">
                <div class="flex justify-between">
                  <span class="text-gray-500">Total Units:</span>
                  <span>{{ unitStore.units.length }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-500">Filtered:</span>
                  <span>{{ unitStore.filteredUnits.length }}</span>
                </div>
                <hr class="border-gray-700" />
                <div class="flex justify-between">
                  <span class="text-blue-400">Armada:</span>
                  <span>{{ unitStore.unitsByFaction('Armada').length }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-red-400">Cortex:</span>
                  <span>{{ unitStore.unitsByFaction('Cortex').length }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-green-400">Legion:</span>
                  <span>{{ unitStore.unitsByFaction('Legion').length }}</span>
                </div>
              </div>
            </div>

            <!-- Data Version -->
            <div class="mt-3 text-xs text-gray-600 text-center">
              v{{ unitStore.dataVersion }}
            </div>
          </div>
        </aside>

        <!-- Main Content Area -->
        <div class="flex-1 min-w-0">
          <!-- Unit Browser Tab -->
          <UnitTable v-if="activeTab === 'browser'" @select-unit="selectUnit" />

          <!-- Scatter Plot Tab -->
          <ScatterPlot v-else-if="activeTab === 'scatter'" @select-unit="selectUnit" />

          <!-- Comparison Tab -->
          <ComparisonTable v-else-if="activeTab === 'compare'" />

          <!-- Stats Table Tab -->
          <StatsTable v-else-if="activeTab === 'stats'" @select-unit="selectUnit" />

          <!-- Combat Simulation Tab -->
          <SpatialBattleSetup v-else-if="activeTab === 'combat'" />

          <!-- Economy Optimizer Tab -->
          <EconomyOptimizer v-else-if="activeTab === 'economy'" />
        </div>
      </div>
    </main>

    <!-- Unit Detail Modal -->
    <UnitDetail
      v-if="selectedUnit"
      :unit="selectedUnit"
      @close="closeDetail"
      @navigate="selectUnit"
    />

    <!-- Import Modal -->
    <div
      v-if="showImportModal"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      @click.self="showImportModal = false"
    >
      <div class="bg-gray-800 rounded-lg max-w-xl w-full p-6">
        <h2 class="text-xl font-bold mb-4">Import Unit Data</h2>

        <div class="mb-4">
          <label class="block text-sm text-gray-400 mb-2">Upload JSON file</label>
          <input
            type="file"
            accept=".json"
            @change="handleFileImport"
            class="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-gray-700 file:text-white hover:file:bg-gray-600"
          />
        </div>

        <div class="mb-4">
          <label class="block text-sm text-gray-400 mb-2">Or paste JSON</label>
          <textarea
            v-model="importText"
            rows="8"
            class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
            placeholder='{"version": "...", "units": [...]}'
          ></textarea>
        </div>

        <div v-if="importError" class="mb-4 text-red-400 text-sm">
          {{ importError }}
        </div>

        <div class="flex justify-end gap-2">
          <button
            @click="showImportModal = false"
            class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            @click="handleImport"
            :disabled="!importText"
            class="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm transition-colors"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
