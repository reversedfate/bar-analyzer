<script setup lang="ts">
import { ref, computed } from 'vue'
import { Scatter } from 'vue-chartjs'
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  Tooltip,
  Legend
} from 'chart.js'
import { useUnitStore } from '../../stores/unitStore'
import { getStatDef, getStatsByCategory } from '../../services/statCalculator'
import type { Unit } from '../../types'

ChartJS.register(LinearScale, PointElement, Tooltip, Legend)

const emit = defineEmits<{
  selectUnit: [unit: Unit]
}>()

const unitStore = useUnitStore()
const statsByCategory = getStatsByCategory()

const xAxis = ref('metalCost')
const yAxis = ref('health')
const sizeAxis = ref('none')
const logScaleX = ref(false)
const logScaleY = ref(false)

const factionColors: Record<string, string> = {
  Armada: 'rgba(59, 130, 246, 0.7)',  // blue
  Cortex: 'rgba(239, 68, 68, 0.7)',   // red
  Legion: 'rgba(34, 197, 94, 0.7)'    // green
}

const factionBorderColors: Record<string, string> = {
  Armada: 'rgb(59, 130, 246)',
  Cortex: 'rgb(239, 68, 68)',
  Legion: 'rgb(34, 197, 94)'
}

const chartData = computed(() => {
  const xDef = getStatDef(xAxis.value)
  const yDef = getStatDef(yAxis.value)
  const sizeDef = sizeAxis.value !== 'none' ? getStatDef(sizeAxis.value) : null

  if (!xDef || !yDef) return { datasets: [] }

  const datasets = ['Armada', 'Cortex', 'Legion'].map(faction => {
    const units = unitStore.filteredUnits.filter(u => u.faction === faction)

    return {
      label: faction,
      data: units.map(unit => {
        const xVal = xDef.getValue(unit)
        const yVal = yDef.getValue(unit)
        const size = sizeDef ? Math.max(4, Math.min(20, sizeDef.getValue(unit) / 50)) : 6

        return {
          x: xVal,
          y: yVal,
          unit,
          radius: size
        }
      }),
      backgroundColor: factionColors[faction],
      borderColor: factionBorderColors[faction],
      borderWidth: 1,
      pointRadius: (ctx: any) => ctx.raw?.radius || 6,
      pointHoverRadius: (ctx: any) => (ctx.raw?.radius || 6) + 3
    }
  })

  return { datasets }
})

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'top' as const,
      labels: {
        color: '#9ca3af'
      }
    },
    tooltip: {
      callbacks: {
        label: (ctx: any) => {
          const unit = ctx.raw.unit as Unit
          const xDef = getStatDef(xAxis.value)
          const yDef = getStatDef(yAxis.value)
          return [
            unit.name,
            `${xDef?.label}: ${ctx.raw.x}`,
            `${yDef?.label}: ${ctx.raw.y}`
          ]
        }
      }
    }
  },
  scales: {
    x: {
      type: logScaleX.value ? 'logarithmic' : 'linear' as any,
      title: {
        display: true,
        text: getStatDef(xAxis.value)?.label || xAxis.value,
        color: '#9ca3af'
      },
      grid: {
        color: 'rgba(75, 85, 99, 0.3)'
      },
      ticks: {
        color: '#9ca3af'
      }
    },
    y: {
      type: logScaleY.value ? 'logarithmic' : 'linear' as any,
      title: {
        display: true,
        text: getStatDef(yAxis.value)?.label || yAxis.value,
        color: '#9ca3af'
      },
      grid: {
        color: 'rgba(75, 85, 99, 0.3)'
      },
      ticks: {
        color: '#9ca3af'
      }
    }
  },
  onClick: (_event: any, elements: any[]) => {
    if (elements.length > 0) {
      const element = elements[0]
      const datasetIndex = element.datasetIndex
      const index = element.index
      const unit = chartData.value.datasets[datasetIndex].data[index].unit
      emit('selectUnit', unit)
    }
  }
}))

// Quick presets
const presets = [
  { label: 'HP vs Metal', x: 'metalCost', y: 'health' },
  { label: 'DPS vs Metal', x: 'metalCost', y: 'totalDps' },
  { label: 'Speed vs Metal', x: 'metalCost', y: 'speed' },
  { label: 'Range vs DPS', x: 'totalDps', y: 'maxRange' },
  { label: 'HP/Metal vs DPS/Metal', x: 'healthPerMetal', y: 'dpsPerMetal' },
  { label: 'Combat Value vs Cost', x: 'totalCost', y: 'combatValue' }
]

const applyPreset = (preset: typeof presets[0]) => {
  xAxis.value = preset.x
  yAxis.value = preset.y
}
</script>

<template>
  <div class="bg-gray-800 rounded-lg p-4">
    <h2 class="text-lg font-semibold mb-4">Scatter Plot Analysis</h2>

    <!-- Controls -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
      <!-- X Axis -->
      <div>
        <label class="block text-sm text-gray-400 mb-1">X Axis</label>
        <select
          v-model="xAxis"
          class="w-full bg-gray-700 border border-gray-600 rounded px-2.5 py-1.5 text-white text-sm"
        >
          <optgroup v-for="(stats, category) in statsByCategory" :key="category" :label="category">
            <option v-for="stat in stats" :key="stat.key" :value="stat.key">
              {{ stat.label }}
            </option>
          </optgroup>
        </select>
      </div>

      <!-- Y Axis -->
      <div>
        <label class="block text-sm text-gray-400 mb-1">Y Axis</label>
        <select
          v-model="yAxis"
          class="w-full bg-gray-700 border border-gray-600 rounded px-2.5 py-1.5 text-white text-sm"
        >
          <optgroup v-for="(stats, category) in statsByCategory" :key="category" :label="category">
            <option v-for="stat in stats" :key="stat.key" :value="stat.key">
              {{ stat.label }}
            </option>
          </optgroup>
        </select>
      </div>

      <!-- Size (optional) -->
      <div>
        <label class="block text-sm text-gray-400 mb-1">Point Size By</label>
        <select
          v-model="sizeAxis"
          class="w-full bg-gray-700 border border-gray-600 rounded px-2.5 py-1.5 text-white text-sm"
        >
          <option value="none">Fixed size</option>
          <optgroup v-for="(stats, category) in statsByCategory" :key="category" :label="category">
            <option v-for="stat in stats" :key="stat.key" :value="stat.key">
              {{ stat.label }}
            </option>
          </optgroup>
        </select>
      </div>

      <!-- Scale Options -->
      <div class="flex items-end gap-4">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" v-model="logScaleX" class="rounded bg-gray-700 border-gray-600" />
          <span class="text-gray-400">Log X</span>
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" v-model="logScaleY" class="rounded bg-gray-700 border-gray-600" />
          <span class="text-gray-400">Log Y</span>
        </label>
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

    <!-- Chart -->
    <div class="h-[calc(100vh-14rem)] min-h-[20rem]">
      <Scatter :data="chartData" :options="chartOptions" />
    </div>

    <!-- Info -->
    <p class="text-xs text-gray-500 mt-2">
      {{ unitStore.filteredUnits.length }} units. Click a point for details.
    </p>
  </div>
</template>
