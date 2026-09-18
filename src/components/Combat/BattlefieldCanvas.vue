<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import type { BattlefieldSnapshot, Vec2 } from '../../services/spatialCombatSimulator'

// Icon image cache: unitId → loaded HTMLImageElement (or null if no icon available)
import iconManifest from '../../assets/data/icon-manifest.json'
const knownIcons = new Set<string>(iconManifest as string[])
const iconCache = new Map<string, HTMLImageElement | null>()

function loadIcon(unitId: string) {
  if (iconCache.has(unitId)) return
  // Skip if no icon exists — avoids 404 requests
  if (!knownIcons.has(unitId)) {
    iconCache.set(unitId, null)
    return
  }
  // Mark as pending so we don't try again
  iconCache.set(unitId, null)
  const img = new Image()
  img.onload = () => {
    iconCache.set(unitId, img)
    // Trigger a redraw once loaded
    draw()
  }
  img.src = `${import.meta.env.BASE_URL}unitpics/${unitId}.png`
}

const props = withDefaults(defineProps<{
  snapshots: BattlefieldSnapshot[]
  currentTime: number
  fieldSize: number
  isPlaying: boolean
  showVisionRanges?: boolean
  showWeaponRanges?: boolean
  maxSize?: number   // max canvas dimension in px (default 500)
}>(), {
  showVisionRanges: false,
  showWeaponRanges: false,
  maxSize: 500
})

const emit = defineEmits<{
  (e: 'seek', time: number): void
  (e: 'hover', time: number | null): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const canvasSize = ref(400)

// Find the snapshot closest to the current time
const currentSnapshot = computed(() => {
  if (!props.snapshots.length) return null

  let closest = props.snapshots[0]
  let minDiff = Math.abs(props.currentTime - closest.time)

  for (const snap of props.snapshots) {
    const diff = Math.abs(props.currentTime - snap.time)
    if (diff < minDiff) {
      minDiff = diff
      closest = snap
    }
  }

  return closest
})

// Team colors
const teamColors = {
  A: {
    fill: '#3b82f6',     // Blue
    stroke: '#1d4ed8',
    dead: '#1e3a5f'
  },
  B: {
    fill: '#ef4444',     // Red
    stroke: '#b91c1c',
    dead: '#5f1e1e'
  }
}

// Convert simulation coordinates to canvas coordinates
function toCanvas(pos: Vec2): Vec2 {
  const scale = canvasSize.value / props.fieldSize
  return {
    x: pos.x * scale,
    y: pos.y * scale
  }
}

// Draw the battlefield
function draw() {
  const canvas = canvasRef.value
  if (!canvas) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const snapshot = currentSnapshot.value

  // Clear canvas
  ctx.fillStyle = '#1f2937'
  ctx.fillRect(0, 0, canvasSize.value, canvasSize.value)

  // Draw grid
  ctx.strokeStyle = '#374151'
  ctx.lineWidth = 1
  const gridSize = canvasSize.value / 10
  for (let i = 1; i < 10; i++) {
    ctx.beginPath()
    ctx.moveTo(i * gridSize, 0)
    ctx.lineTo(i * gridSize, canvasSize.value)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, i * gridSize)
    ctx.lineTo(canvasSize.value, i * gridSize)
    ctx.stroke()
  }

  // Draw center line
  ctx.strokeStyle = '#4b5563'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, canvasSize.value / 2)
  ctx.lineTo(canvasSize.value, canvasSize.value / 2)
  ctx.stroke()

  if (!snapshot) return

  // Draw AoE impact zones (fading circles, 1.0s lifetime)
  for (const impact of snapshot.aoeImpacts) {
    const age = snapshot.time - impact.createdAt  // 0 → 1.0s
    const alpha = Math.max(0, 0.45 - age * 0.45)   // fade from 0.45 to 0 over 1s
    const radius = (impact.radius * (canvasSize.value / props.fieldSize)) * (0.5 + age * 0.5) // expand slightly
    const pos = toCanvas(impact.position)
    const color = impact.team === 'A' ? `rgba(96,165,250,${alpha})` : `rgba(248,113,113,${alpha})`
    const strokeColor = impact.team === 'A' ? `rgba(147,197,253,${alpha * 2})` : `rgba(252,165,165,${alpha * 2})`

    ctx.beginPath()
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  // Projectile type → visual style map
  // Colors approximate BAR in-game appearance
  const projStyles: Record<string, { trail: string; head: string; headR: number; trailW: number; glow?: string }> = {
    Laser:     { trail: '#ff4444', head: '#ff8888', headR: 2,  trailW: 1.5 },
    BeamLaser: { trail: '#44ccff', head: '#aaeeff', headR: 2,  trailW: 1.5 },
    Plasma:    { trail: '#e8a030', head: '#ffd080', headR: 4,  trailW: 2 },
    Cannon:    { trail: '#e8a030', head: '#ffd080', headR: 4,  trailW: 2 },
    Missile:   { trail: '#fbb040', head: '#ffe090', headR: 3,  trailW: 2, glow: 'rgba(251,176,64,0.3)' },
    Rocket:    { trail: '#c8e040', head: '#e8ff80', headR: 3,  trailW: 2 },
    Flak:      { trail: '#e854b0', head: '#ff88d0', headR: 5,  trailW: 2, glow: 'rgba(232,84,176,0.4)' },
    EMP:       { trail: '#5060ff', head: '#88aaff', headR: 4,  trailW: 2, glow: 'rgba(80,96,255,0.3)' },
    Torpedo:   { trail: '#20a0e0', head: '#60d0ff', headR: 4,  trailW: 2 },
    Heatray:   { trail: '#ff5010', head: '#ff8050', headR: 2,  trailW: 1.5 },
    DGun:      { trail: '#ffffff', head: '#ffffaa', headR: 6,  trailW: 3, glow: 'rgba(255,255,200,0.5)' },
    AircraftBomb: { trail: '#666633', head: '#aaaa44', headR: 5,  trailW: 1, glow: 'rgba(200,180,50,0.3)' },
    Napalm:    { trail: '#ff6600', head: '#ffaa44', headR: 5,  trailW: 2 },
    Other:     { trail: '#fbbf24', head: '#fde68a', headR: 3,  trailW: 2 },
  }

  // Draw beam flashes (instant-hit weapons — drawn as fading lines)
  for (const flash of (snapshot.beamFlashes ?? [])) {
    const age = snapshot.time - flash.createdAt
    const alpha = Math.max(0, 1 - age / 0.1)
    const style = projStyles[flash.projectileType] ?? projStyles.Other
    const from = toCanvas(flash.from)
    const to = toCanvas(flash.to)

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.strokeStyle = style.trail
    ctx.lineWidth = style.trailW
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    // Bright tip at target
    ctx.fillStyle = style.head
    ctx.beginPath()
    ctx.arc(to.x, to.y, style.headR, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // Draw in-flight projectiles
  for (const proj of snapshot.projectiles) {
    const style = projStyles[proj.projectileType] ?? projStyles.Other
    const from = toCanvas(proj.from)
    const to = toCanvas(proj.to)
    const current = {
      x: from.x + (to.x - from.x) * proj.progress,
      y: from.y + (to.y - from.y) * proj.progress
    }

    // For Cannon/Plasma: simulate ballistic arc — projectile size/brightness peaks at midpoint
    const isBallistic = proj.projectileType === 'Cannon' || proj.projectileType === 'Plasma'
    const arcScale = isBallistic ? (1 + Math.sin(proj.progress * Math.PI) * 0.8) : 1

    // Glow halo for special projectile types
    if (style.glow && proj.isAoe) {
      ctx.beginPath()
      ctx.arc(current.x, current.y, style.headR * arcScale * 2.5, 0, Math.PI * 2)
      ctx.fillStyle = style.glow
      ctx.fill()
    }

    // Trail line from launch point to current position
    ctx.strokeStyle = style.trail
    ctx.lineWidth = style.trailW * arcScale
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(current.x, current.y)
    ctx.stroke()

    // Projectile head dot
    ctx.fillStyle = style.head
    ctx.beginPath()
    const headRadius = (proj.isAoe ? style.headR + 1 : style.headR) * arcScale
    ctx.arc(current.x, current.y, headRadius, 0, Math.PI * 2)
    ctx.fill()

    // For missiles: draw a small direction indicator (short line forward)
    if (proj.projectileType === 'Missile' || proj.projectileType === 'Rocket') {
      const dx = to.x - from.x
      const dy = to.y - from.y
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len > 0.1) {
        const nx = dx / len
        const ny = dy / len
        ctx.strokeStyle = style.head
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(current.x, current.y)
        ctx.lineTo(current.x + nx * 6, current.y + ny * 6)
        ctx.stroke()
      }
    }
  }

  // Weapon range colors: index 0..4 palette (A team = cooler, B team = warmer)
  const weaponRangeColors = {
    A: ['rgba(147,197,253,0.7)', 'rgba(196,181,253,0.7)', 'rgba(167,243,208,0.7)', 'rgba(253,224,71,0.7)', 'rgba(165,243,252,0.7)'],
    B: ['rgba(252,165,165,0.7)', 'rgba(253,186,116,0.7)', 'rgba(249,168,212,0.7)', 'rgba(254,240,138,0.7)', 'rgba(216,180,254,0.7)']
  }

  // Draw weapon firing ranges
  if (props.showWeaponRanges) {
    const scale = canvasSize.value / props.fieldSize
    for (const unit of snapshot.units) {
      if (!unit.isAlive || !unit.weapons.length) continue
      const pos = toCanvas(unit.position)

      unit.weapons.forEach((weapon, wi) => {
        if (weapon.range <= 0) return
        const radius = weapon.range * scale
        const color = weaponRangeColors[unit.team][wi % weaponRangeColors[unit.team].length]

        ctx.save()
        ctx.setLineDash(wi === 0 ? [] : [4 + wi * 2, 4])
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2)
        ctx.strokeStyle = color
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.restore()
      })
    }
  }

  // Draw vision ranges
  if (props.showVisionRanges) {
    const scale = canvasSize.value / props.fieldSize
    for (const unit of snapshot.units) {
      if (!unit.isAlive || !unit.sightRange) continue
      const pos = toCanvas(unit.position)
      const radius = unit.sightRange * scale

      ctx.beginPath()
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = unit.team === 'A' ? 'rgba(59, 130, 246, 0.06)' : 'rgba(239, 68, 68, 0.06)'
      ctx.fill()
      ctx.strokeStyle = unit.team === 'A' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(239, 68, 68, 0.15)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }

  // Draw units
  for (const unit of snapshot.units) {
    const pos = toCanvas(unit.position)
    const colors = teamColors[unit.team]
    const radius = 8

    // Ensure icon is being loaded
    loadIcon(unit.unitId)
    const icon = iconCache.get(unit.unitId)

    const fillColor = !unit.isAlive ? colors.dead : unit.isStunned ? '#8b5cf6' : colors.fill
    const strokeColor = !unit.isAlive ? '#4b5563' : unit.isStunned ? '#7c3aed' : colors.stroke

    if (unit.isAlive && icon) {
      // Draw icon clipped to a circle with team-colored border
      ctx.save()
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(icon, pos.x - radius, pos.y - radius, radius * 2, radius * 2)
      ctx.restore()
    } else {
      // Fallback: solid circle
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = fillColor
      ctx.fill()
    }

    // Always draw border ring (team color or grey)
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2)
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = 2
    ctx.stroke()

    // Draw HP bar + EMP bar for alive units
    if (unit.isAlive) {
      const hpPercent = unit.hp / unit.maxHp
      const barWidth = 16
      const barHeight = 3
      const barX = pos.x - barWidth / 2
      const barY = pos.y - radius - 6

      // HP bar background
      ctx.fillStyle = '#1f2937'
      ctx.fillRect(barX, barY, barWidth, barHeight)
      // HP fill
      ctx.fillStyle = hpPercent > 0.5 ? '#22c55e' : hpPercent > 0.25 ? '#eab308' : '#ef4444'
      ctx.fillRect(barX, barY, barWidth * hpPercent, barHeight)
      ctx.strokeStyle = '#4b5563'
      ctx.lineWidth = 1
      ctx.strokeRect(barX, barY, barWidth, barHeight)

      // EMP bar (purple) — only when there is EMP accumulation
      if (unit.empDamage > 0) {
        const empY = barY - barHeight - 1
        const empFill = Math.min(1, unit.empDamage / unit.maxHp)
        // Background
        ctx.fillStyle = '#1f2937'
        ctx.fillRect(barX, empY, barWidth, barHeight)
        // EMP fill — bright purple when stunned, muted otherwise
        ctx.fillStyle = unit.isStunned ? '#c084fc' : '#7c3aed'
        ctx.fillRect(barX, empY, barWidth * empFill, barHeight)
        ctx.strokeStyle = '#6d28d9'
        ctx.lineWidth = 1
        ctx.strokeRect(barX, empY, barWidth, barHeight)
      }
    }
  }

  // Draw timestamp
  ctx.fillStyle = '#9ca3af'
  ctx.font = '12px monospace'
  ctx.fillText(`Time: ${snapshot.time.toFixed(1)}s`, 8, canvasSize.value - 8)

  // Draw unit counts
  const teamACount = snapshot.units.filter(u => u.team === 'A' && u.isAlive).length
  const teamBCount = snapshot.units.filter(u => u.team === 'B' && u.isAlive).length
  ctx.fillStyle = teamColors.A.fill
  ctx.fillText(`Team A: ${teamACount}`, 8, 16)
  ctx.fillStyle = teamColors.B.fill
  ctx.fillText(`Team B: ${teamBCount}`, canvasSize.value - 80, 16)
}

// Handle mouse move for hover preview
function handleMouseMove(e: MouseEvent) {
  const canvas = canvasRef.value
  if (!canvas || !props.snapshots.length) return

  const rect = canvas.getBoundingClientRect()
  const x = e.clientX - rect.left
  const timeRatio = x / rect.width
  const maxTime = props.snapshots[props.snapshots.length - 1].time
  const hoverTime = timeRatio * maxTime

  emit('hover', hoverTime)
}

function handleMouseLeave() {
  emit('hover', null)
}

function handleClick(e: MouseEvent) {
  const canvas = canvasRef.value
  if (!canvas || !props.snapshots.length) return

  const rect = canvas.getBoundingClientRect()
  const x = e.clientX - rect.left
  const timeRatio = x / rect.width
  const maxTime = props.snapshots[props.snapshots.length - 1].time
  const seekTime = timeRatio * maxTime

  emit('seek', seekTime)
}

// Animation frame for smooth updates
let animationFrame: number | null = null

function animate() {
  draw()
  if (props.isPlaying) {
    animationFrame = requestAnimationFrame(animate)
  }
}

// Resize handling
function updateSize() {
  if (containerRef.value) {
    const width = containerRef.value.clientWidth
    canvasSize.value = Math.min(width, props.maxSize)
  }
}

onMounted(() => {
  updateSize()
  window.addEventListener('resize', updateSize)
  draw()
})

watch(() => props.maxSize, () => {
  updateSize()
  draw()
})

onUnmounted(() => {
  window.removeEventListener('resize', updateSize)
  if (animationFrame) {
    cancelAnimationFrame(animationFrame)
  }
})

watch(() => props.currentTime, draw)
watch(() => props.snapshots, draw)
watch(() => props.isPlaying, (playing) => {
  if (playing) {
    animate()
  } else if (animationFrame) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
})
</script>

<template>
  <div ref="containerRef" class="w-full">
    <canvas
      ref="canvasRef"
      :width="canvasSize"
      :height="canvasSize"
      class="rounded border border-gray-700 cursor-crosshair"
      @mousemove="handleMouseMove"
      @mouseleave="handleMouseLeave"
      @click="handleClick"
    />
  </div>
</template>
