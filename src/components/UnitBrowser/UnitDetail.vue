<script setup lang="ts">
import { computed } from 'vue'
import { useUnitStore } from '../../stores/unitStore'
import UnitIcon from '../Common/UnitIcon.vue'
import type { Unit } from '../../types'

const props = defineProps<{ unit: Unit }>()
const emit = defineEmits<{ close: []; navigate: [unit: Unit] }>()

const unitStore = useUnitStore()
const ds = computed(() => unitStore.getDerivedStats(props.unit))

const buildableUnits = computed(() => {
  if (!props.unit.canBuild?.length) return []
  return props.unit.canBuild
    .map((id) => unitStore.getUnit(id))
    .filter((u): u is Unit => u != null)
    .sort((a, b) => {
      // Sort by tier then by metal cost
      if (a.tier !== b.tier) return a.tier.localeCompare(b.tier)
      return a.metalCost - b.metalCost
    })
})

const factionColor: Record<string, string> = {
  Armada: 'text-blue-400',
  Cortex: 'text-red-400',
  Legion: 'text-green-400',
}
const factionBg: Record<string, string> = {
  Armada: 'bg-blue-900/40 border-blue-700/50',
  Cortex: 'bg-red-900/40 border-red-700/50',
  Legion: 'bg-green-900/40 border-green-700/50',
}
const tierColor: Record<string, string> = { T1: 'text-gray-300', T2: 'text-yellow-400', T3: 'text-orange-400' }

const projectileColor: Record<string, string> = {
  Laser: 'bg-red-900/60 text-red-300 border-red-700/40',
  BeamLaser: 'bg-cyan-900/60 text-cyan-300 border-cyan-700/40',
  Plasma: 'bg-orange-900/60 text-orange-300 border-orange-700/40',
  Cannon: 'bg-orange-900/60 text-orange-300 border-orange-700/40',
  Rocket: 'bg-yellow-900/60 text-yellow-300 border-yellow-700/40',
  Missile: 'bg-amber-900/60 text-amber-300 border-amber-700/40',
  Torpedo: 'bg-teal-900/60 text-teal-300 border-teal-700/40',
  Flak: 'bg-pink-900/60 text-pink-300 border-pink-700/40',
  Heatray: 'bg-orange-900/60 text-orange-300 border-orange-700/40',
  EMP: 'bg-blue-900/60 text-blue-300 border-blue-700/40',
  DGun: 'bg-white/10 text-white border-white/20',
  AircraftBomb: 'bg-gray-800 text-gray-300 border-gray-600',
  Napalm: 'bg-red-900/60 text-red-300 border-red-700/40',
  Other: 'bg-gray-800 text-gray-400 border-gray-600',
}

const specialAbilities = computed(() => {
  const u = props.unit
  const chips: { label: string; cls: string }[] = []
  if (u.isCommander)       chips.push({ label: 'Commander',   cls: 'bg-yellow-900/60 text-yellow-300 border-yellow-700/40' })
  if (u.canCloak)          chips.push({ label: 'Cloaking',    cls: 'bg-purple-900/60 text-purple-300 border-purple-700/40' })
  if (u.stealth)           chips.push({ label: 'Stealth',     cls: 'bg-purple-900/60 text-purple-300 border-purple-700/40' })
  if (u.isKamikaze)        chips.push({ label: 'Kamikaze',    cls: 'bg-red-900/60 text-red-300 border-red-700/40' })
  if (u.isMine)            chips.push({ label: 'Mine',        cls: 'bg-red-900/60 text-red-300 border-red-700/40' })
  if (u.isSuicide)         chips.push({ label: 'Suicide',     cls: 'bg-red-900/60 text-red-300 border-red-700/40' })
  if (u.transportCapacity) chips.push({ label: `Transport ×${u.transportCapacity}`, cls: 'bg-gray-700 text-gray-300 border-gray-600' })
  if (u.isMorph)           chips.push({ label: 'Morph',       cls: 'bg-indigo-900/60 text-indigo-300 border-indigo-700/40' })
  if (u.hoverAttack)       chips.push({ label: 'VTOL/Gunship',cls: 'bg-sky-900/60 text-sky-300 border-sky-700/40' })
  return chips
})

// Build time in mm:ss
const buildTimeDisplay = computed(() => {
  const secs = Math.round(props.unit.buildTime / 300 * 10) / 10   // approx at 300 BP
  if (secs < 60) return `~${secs.toFixed(0)}s`
  return `~${(secs / 60).toFixed(1)}m`
})

// Cost-efficiency stat bars (0-100 scaled within reasonable ranges)
function barWidth(value: number, max: number): string {
  return Math.min((value / max) * 100, 100).toFixed(1) + '%'
}
</script>

<template>
  <div
    class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-3"
    @click.self="emit('close')"
  >
    <div class="bg-gray-800 rounded-xl max-w-3xl w-full max-h-[92vh] overflow-y-auto shadow-2xl">

      <!-- ── Header ─────────────────────────────────────────────────────── -->
      <div
        :class="['flex gap-4 p-4 rounded-t-xl border-b border-gray-700', factionBg[unit.faction] ?? 'bg-gray-800']"
      >
        <!-- Unit icon -->
        <div class="flex-shrink-0 w-20 h-20 bg-gray-900/60 rounded-lg flex items-center justify-center border border-gray-700">
          <UnitIcon :unitId="unit.id" :size="72" />
        </div>

        <!-- Identity -->
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <div>
              <h2 class="text-xl font-bold leading-tight">{{ unit.name }}</h2>
              <div class="flex flex-wrap gap-1.5 mt-1">
                <span :class="['text-xs font-semibold px-2 py-0.5 rounded-full border', factionColor[unit.faction], factionBg[unit.faction] ?? '']">
                  {{ unit.faction }}
                </span>
                <span :class="['text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-700 border border-gray-600', tierColor[unit.tier] ?? 'text-gray-400']">
                  {{ unit.tier }}
                </span>
                <span class="text-xs px-2 py-0.5 rounded-full bg-gray-700 border border-gray-600 text-gray-300">
                  {{ unit.unitType }}
                </span>
                <span class="text-xs px-2 py-0.5 rounded-full bg-gray-700 border border-gray-600 text-gray-400">
                  {{ unit.movementMode }}
                </span>
              </div>
            </div>
            <button @click="emit('close')" class="text-gray-400 hover:text-white text-2xl leading-none flex-shrink-0">×</button>
          </div>
          <p v-if="unit.description" class="mt-1.5 text-sm text-gray-400 leading-snug line-clamp-2">
            {{ unit.description }}
          </p>
          <!-- Special abilities -->
          <div v-if="specialAbilities.length > 0" class="flex flex-wrap gap-1 mt-1.5">
            <span
              v-for="chip in specialAbilities" :key="chip.label"
              :class="['text-xs px-1.5 py-0.5 rounded border font-medium', chip.cls]"
            >{{ chip.label }}</span>
          </div>
        </div>
      </div>

      <div class="p-4 space-y-4">

        <!-- ── Cost & Build ──────────────────────────────────────────────── -->
        <section class="grid grid-cols-4 gap-2">
          <div class="bg-gray-900 rounded-lg p-2.5 text-center">
            <div class="text-yellow-400 text-xl font-bold">{{ unit.metalCost }}</div>
            <div class="text-xs text-gray-500 mt-0.5">Metal</div>
          </div>
          <div class="bg-gray-900 rounded-lg p-2.5 text-center">
            <div class="text-cyan-400 text-xl font-bold">{{ unit.energyCost }}</div>
            <div class="text-xs text-gray-500 mt-0.5">Energy</div>
          </div>
          <div class="bg-gray-900 rounded-lg p-2.5 text-center">
            <div class="text-gray-300 text-xl font-bold">{{ unit.buildTime }}</div>
            <div class="text-xs text-gray-500 mt-0.5">Build pts</div>
          </div>
          <div class="bg-gray-900 rounded-lg p-2.5 text-center">
            <div class="text-gray-300 text-base font-bold">{{ buildTimeDisplay }}</div>
            <div class="text-xs text-gray-500 mt-0.5">@ 300 BP</div>
          </div>
        </section>

        <!-- ── Combat ───────────────────────────────────────────────────── -->
        <section>
          <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Combat</h3>
          <div class="grid grid-cols-3 gap-2 mb-3">
            <div class="bg-gray-900 rounded-lg p-2.5">
              <div class="text-green-400 text-lg font-bold">{{ unit.health.toLocaleString() }}</div>
              <div class="text-xs text-gray-500">Health</div>
              <div class="mt-1.5 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div class="h-full bg-green-500 rounded-full" :style="{ width: barWidth(unit.health, 10000) }" />
              </div>
            </div>
            <div class="bg-gray-900 rounded-lg p-2.5">
              <div class="text-red-400 text-lg font-bold">{{ ds.totalDps.toFixed(1) }}</div>
              <div class="text-xs text-gray-500">Total DPS</div>
              <div class="mt-1.5 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div class="h-full bg-red-500 rounded-full" :style="{ width: barWidth(ds.totalDps, 500) }" />
              </div>
            </div>
            <div class="bg-gray-900 rounded-lg p-2.5">
              <div class="text-orange-400 text-lg font-bold">{{ ds.maxRange || '-' }}</div>
              <div class="text-xs text-gray-500">Max Range</div>
              <div class="mt-1.5 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div class="h-full bg-orange-500 rounded-full" :style="{ width: barWidth(ds.maxRange, 1200) }" />
              </div>
            </div>
          </div>

          <!-- Efficiency row -->
          <div class="grid grid-cols-4 gap-2 text-xs">
            <div class="bg-gray-900 rounded p-2 flex flex-col gap-0.5">
              <span class="text-gray-500">HP/Metal</span>
              <span class="text-green-400 font-mono font-bold">{{ ds.healthPerMetal.toFixed(2) }}</span>
            </div>
            <div class="bg-gray-900 rounded p-2 flex flex-col gap-0.5">
              <span class="text-gray-500">DPS/Metal</span>
              <span class="text-red-400 font-mono font-bold">{{ ds.dpsPerMetal.toFixed(3) }}</span>
            </div>
            <div class="bg-gray-900 rounded p-2 flex flex-col gap-0.5">
              <span class="text-gray-500">Burst Dmg</span>
              <span class="text-orange-400 font-mono font-bold">{{ ds.burstDamage }}</span>
            </div>
            <div class="bg-gray-900 rounded p-2 flex flex-col gap-0.5">
              <span class="text-gray-500">Speed/Cost</span>
              <span class="text-cyan-400 font-mono font-bold">{{ ds.speedPerCost.toFixed(4) }}</span>
            </div>
          </div>
        </section>

        <!-- ── Weapons ───────────────────────────────────────────────────── -->
        <section v-if="unit.weapons.length > 0">
          <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Weapons ({{ unit.weapons.length }})
          </h3>
          <div class="space-y-2">
            <div
              v-for="w in unit.weapons" :key="w.id"
              :class="['rounded-lg p-2.5 border', projectileColor[w.projectileType] ?? projectileColor.Other]"
            >
              <div class="flex items-center justify-between mb-2">
                <span class="font-semibold text-sm">{{ w.name }}</span>
                <span class="text-xs font-mono px-2 py-0.5 rounded bg-black/30 border border-current/20">
                  {{ w.projectileType }}
                </span>
              </div>
              <div class="grid grid-cols-4 gap-x-3 gap-y-1 text-xs">
                <div><span class="opacity-60">Dmg </span><span class="font-bold">{{ w.damage }}</span></div>
                <div><span class="opacity-60">DPS </span><span class="font-bold">{{ w.dps?.toFixed(1) }}</span></div>
                <div><span class="opacity-60">Reload </span><span class="font-bold">{{ w.reload }}s</span></div>
                <div><span class="opacity-60">Range </span><span class="font-bold">{{ w.range }}</span></div>
                <div v-if="w.areaOfEffect"><span class="opacity-60">AoE </span><span class="font-bold">{{ w.areaOfEffect }}</span></div>
                <div v-if="w.empDamage"><span class="opacity-60">EMP </span><span class="font-bold">{{ w.empDamage }}</span></div>
                <div v-if="w.burstCount"><span class="opacity-60">Burst </span><span class="font-bold">{{ w.burstCount }}×{{ w.burstRate }}s</span></div>
                <div v-if="w.accuracy != null && w.accuracy < 1"><span class="opacity-60">Acc </span><span class="font-bold">{{ (w.accuracy * 100).toFixed(0) }}%</span></div>
              </div>
              <div class="flex flex-wrap gap-1 mt-1.5">
                <span v-if="w.isTracking"       class="text-xs px-1.5 py-0.5 rounded bg-black/30 border border-current/20">Guided</span>
                <span v-if="w.isFlak"           class="text-xs px-1.5 py-0.5 rounded bg-black/30 border border-current/20">Flak</span>
                <span v-if="w.gravityAffected"  class="text-xs px-1.5 py-0.5 rounded bg-black/30 border border-current/20">Ballistic</span>
                <span v-if="w.canTargetAir"     class="text-xs px-1.5 py-0.5 rounded bg-black/30 border border-current/20">AA</span>
                <span v-if="w.onlyTargetsAir"   class="text-xs px-1.5 py-0.5 rounded bg-black/30 border border-current/20">AA-only</span>
              </div>
            </div>
          </div>
        </section>

        <!-- ── Movement ──────────────────────────────────────────────────── -->
        <section>
          <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Movement & Vision</h3>
          <div class="grid grid-cols-6 gap-2 text-center text-xs">
            <div class="bg-gray-900 rounded p-1.5">
              <div class="text-cyan-400 font-bold text-sm">{{ unit.speed || '—' }}</div>
              <div class="text-gray-500">Speed</div>
            </div>
            <div class="bg-gray-900 rounded p-1.5">
              <div class="text-gray-300 font-bold text-sm">{{ unit.turnRate || '—' }}</div>
              <div class="text-gray-500">Turn</div>
            </div>
            <div class="bg-gray-900 rounded p-1.5">
              <div class="text-blue-400 font-bold text-sm">{{ unit.sightRange }}</div>
              <div class="text-gray-500">Sight</div>
            </div>
            <div class="bg-gray-900 rounded p-1.5">
              <div class="text-green-400 font-bold text-sm">{{ unit.radarRange || '—' }}</div>
              <div class="text-gray-500">Radar</div>
            </div>
            <div class="bg-gray-900 rounded p-1.5">
              <div class="text-purple-400 font-bold text-sm">{{ unit.sonarRange || '—' }}</div>
              <div class="text-gray-500">Sonar</div>
            </div>
            <div class="bg-gray-900 rounded p-1.5">
              <div class="text-red-400 font-bold text-sm">{{ unit.jammerRange || '—' }}</div>
              <div class="text-gray-500">Jammer</div>
            </div>
          </div>
        </section>

        <!-- ── Construction ──────────────────────────────────────────────── -->
        <section v-if="unit.buildPower">
          <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Construction</h3>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="bg-gray-900 rounded p-2 flex justify-between">
              <span class="text-gray-500">Build Power</span>
              <span class="text-yellow-400 font-bold">{{ unit.buildPower }}</span>
            </div>
            <div class="bg-gray-900 rounded p-2 flex justify-between">
              <span class="text-gray-500">Build Range</span>
              <span class="text-gray-300 font-bold">{{ unit.buildRange || '—' }}</span>
            </div>
          </div>
        </section>

        <!-- ── Economy ───────────────────────────────────────────────────── -->
        <section v-if="unit.metalProduction || unit.energyProduction || unit.metalStorage || unit.energyStorage">
          <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Economy</h3>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div v-if="unit.metalProduction" class="bg-gray-900 rounded p-2 flex justify-between">
              <span class="text-gray-500">Metal Production</span>
              <span class="text-yellow-400 font-bold">+{{ unit.metalProduction }}/s</span>
            </div>
            <div v-if="unit.energyProduction" class="bg-gray-900 rounded p-2 flex justify-between">
              <span class="text-gray-500">Energy Production</span>
              <span class="text-cyan-400 font-bold">+{{ unit.energyProduction }}/s</span>
            </div>
            <div v-if="unit.metalStorage" class="bg-gray-900 rounded p-2 flex justify-between">
              <span class="text-gray-500">Metal Storage</span>
              <span class="text-yellow-300 font-bold">{{ unit.metalStorage }}</span>
            </div>
            <div v-if="unit.energyStorage" class="bg-gray-900 rounded p-2 flex justify-between">
              <span class="text-gray-500">Energy Storage</span>
              <span class="text-cyan-300 font-bold">{{ unit.energyStorage }}</span>
            </div>
            <div v-if="unit.metalProduction && ds.metalPerSecondPerCost != null" class="bg-gray-900 rounded p-2 flex justify-between">
              <span class="text-gray-500">M/s per Metal</span>
              <span class="text-yellow-300 font-bold font-mono">{{ ds.metalPerSecondPerCost?.toFixed(4) }}</span>
            </div>
            <div v-if="unit.energyProduction && ds.energyPerSecondPerCost != null" class="bg-gray-900 rounded p-2 flex justify-between">
              <span class="text-gray-500">E/s per Metal</span>
              <span class="text-cyan-300 font-bold font-mono">{{ ds.energyPerSecondPerCost?.toFixed(4) }}</span>
            </div>
          </div>
        </section>

        <!-- ── Cloaking ──────────────────────────────────────────────────── -->
        <section v-if="unit.canCloak || unit.stealth">
          <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Stealth / Cloaking</h3>
          <div class="grid grid-cols-3 gap-2 text-xs">
            <div v-if="unit.cloakCost" class="bg-gray-900 rounded p-2 flex justify-between">
              <span class="text-gray-500">Cloak E (still)</span>
              <span class="text-purple-400 font-bold">{{ unit.cloakCost }}/s</span>
            </div>
            <div v-if="unit.cloakCostMoving" class="bg-gray-900 rounded p-2 flex justify-between">
              <span class="text-gray-500">Cloak E (move)</span>
              <span class="text-purple-400 font-bold">{{ unit.cloakCostMoving }}/s</span>
            </div>
            <div v-if="unit.stealth" class="bg-gray-900 rounded p-2 flex justify-between">
              <span class="text-gray-500">Passive stealth</span>
              <span class="text-purple-400 font-bold">✓ Free</span>
            </div>
          </div>
        </section>

        <!-- ── Can Build ─────────────────────────────────────────────── -->
        <section v-if="buildableUnits.length > 0">
          <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Can Build ({{ buildableUnits.length }})
          </h3>
          <div class="space-y-1">
            <div
              v-for="bu in buildableUnits" :key="bu.id"
              class="flex items-center gap-2 bg-gray-900 hover:bg-gray-700 rounded px-2 py-1.5 text-xs cursor-pointer transition-colors"
              @click="emit('navigate', bu)"
            >
              <UnitIcon :unitId="bu.id" :size="24" class="flex-shrink-0" />
              <span class="flex-1 font-medium text-gray-200 truncate">{{ bu.name }}</span>
              <span :class="['px-1.5 py-0.5 rounded font-semibold', tierColor[bu.tier] ?? 'text-gray-400', 'bg-gray-800']">{{ bu.tier }}</span>
              <span class="text-yellow-400 font-mono w-14 text-right">{{ bu.metalCost }}m</span>
              <span class="text-cyan-400 font-mono w-16 text-right">{{ bu.energyCost }}e</span>
            </div>
          </div>
        </section>

        <!-- ID footer -->
        <div class="text-xs text-gray-600 text-center pt-1">{{ unit.id }}</div>
      </div>
    </div>
  </div>
</template>
