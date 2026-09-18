import type { Unit, Weapon } from '../types'

// 2D Vector utility
export interface Vec2 {
  x: number
  y: number
}

export function vec2(x: number, y: number): Vec2 {
  return { x, y }
}

export function vec2Add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function vec2Sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function vec2Scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s }
}

export function vec2Length(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y)
}

export function vec2Normalize(v: Vec2): Vec2 {
  const len = vec2Length(v)
  if (len === 0) return { x: 0, y: 0 }
  return { x: v.x / len, y: v.y / len }
}

export function vec2Distance(a: Vec2, b: Vec2): number {
  return vec2Length(vec2Sub(b, a))
}

// Targeting strategies
export type TargetingStrategy =
  | 'focus'      // All attack same target (closest)
  | 'spread'     // Each attacker picks different target
  | 'random'     // Random target selection
  | 'lowestHp'   // Target unit with lowest HP
  | 'highestDps' // Target unit with highest DPS (threat)
  | 'closest'    // Target closest enemy

// Formation types
export type Formation =
  | 'grouped'    // Units clustered together
  | 'line'       // Spread out perpendicular to enemy (firing line)
  | 'column'     // Line towards enemy (travel formation)
  | 'scattered'  // Maximally spread out (anti-AoE)

// Movement behavior
export type MovementBehavior =
  | 'hold'       // Stand still
  | 'advance'    // Move towards enemy
  | 'retreat'    // Move away from enemy
  | 'kite'       // Maintain max weapon range
  | 'surround'   // Orbit enemy at firing range to exploit flanking

// Combat unit instance with spatial data
export interface SpatialCombatUnit {
  id: string
  instanceId: string
  unit: Unit
  team: 'A' | 'B'

  // Position and movement
  position: Vec2
  velocity: Vec2
  targetPosition: Vec2 | null
  radius: number  // collision radius derived from unit footprint

  // State
  currentHp: number
  maxHp: number
  isAlive: boolean
  isStunned: boolean
  stunEndTime: number
  empDamage: number
  lastDamageTime: number

  // Flanking: direction the unit "faces" for damage multiplier (BAR: min=1.0×, max=2.0×)
  flankingDir: Vec2

  // Combat
  currentTarget: string | null
  weaponCooldowns: Map<string, number>
}

// Event types
export type SpatialSimEvent =
  | { type: 'fire'; time: number; attacker: string; weapon: Weapon; target: string; fromPos: Vec2; toPos: Vec2 }
  | { type: 'damage'; time: number; target: string; damage: number; source: string; isEmp: boolean }
  | { type: 'death'; time: number; unit: string; killer: string; position: Vec2 }
  | { type: 'stun'; time: number; unit: string; duration: number }
  | { type: 'stunEnd'; time: number; unit: string }
  | { type: 'move'; time: number; unit: string; position: Vec2 }

// Production entry — unit spawned repeatedly during battle
export interface ProductionEntry {
  unit: Unit
  interval: number  // seconds between spawns
}

// Draw analysis result
export interface DrawAnalysis {
  teamAAdvance: number   // units past midline (positive = penetrated enemy half)
  teamBAdvance: number
  baseTrade: boolean     // both teams simultaneously had units past midline
  label: string
}

// Per-unit type behavior/strategy overrides (keyed by unit.id)
export interface UnitOverride {
  behavior?: MovementBehavior
  strategy?: TargetingStrategy
}

// Simulation configuration
export interface SpatialSimConfig {
  teamAStrategy: TargetingStrategy
  teamBStrategy: TargetingStrategy
  teamAFormation: Formation
  teamBFormation: Formation
  teamABehavior: MovementBehavior
  teamBBehavior: MovementBehavior
  // Per-unit type overrides (unit.id → override)
  teamAUnitOverrides: Record<string, UnitOverride>
  teamBUnitOverrides: Record<string, UnitOverride>
  startingDistance: number  // Distance between team centers
  fieldSize: number         // Size of the battlefield (square)
  maxTime: number
  tickRate: number          // Ticks per second for movement simulation
  // Vision system
  useVisionSystem: boolean      // enable/disable vision mechanics (default: false)
  teamARadarCoverage: boolean   // full-area radar for team A (default: false)
  teamBRadarCoverage: boolean   // full-area radar for team B (default: false)
  // Retreat
  retreatThreshold: number      // min HP fraction remaining to count as retreat (default: 0.0)
  // Snapshot
  snapshotInterval: number      // seconds between snapshots (default: 0.25)
  // Production (sustained reinforcements)
  teamAProduction: ProductionEntry[]
  teamBProduction: ProductionEntry[]
  productionSpawnDistance: number  // Y distance from field center where spawns appear (default: 550)
  // Flanking damage (BAR: front=1.0×, side=1.5×, rear=2.0×)
  useFlanking: boolean
}

// Snapshot for visualization
export interface BattlefieldSnapshot {
  time: number
  units: {
    instanceId: string
    position: Vec2
    hp: number
    maxHp: number
    empDamage: number   // current EMP accumulation (for bar display)
    isAlive: boolean
    isStunned: boolean
    team: 'A' | 'B'
    unitId: string
    name: string
    sightRange?: number
    weapons: { id: string; name: string; range: number }[]
  }[]
  projectiles: {
    from: Vec2
    to: Vec2
    progress: number  // 0-1
    isAoe: boolean
    aoeRadius: number
    projectileType: string
    team: 'A' | 'B'
  }[]
  beamFlashes: {
    from: Vec2
    to: Vec2
    projectileType: string
    team: 'A' | 'B'
    createdAt: number // sim time when flash was recorded (fades over 0.08s)
  }[]
  aoeImpacts: {
    position: Vec2
    radius: number
    createdAt: number   // sim time when impact occurred (for fade-out)
    team: 'A' | 'B'    // which team caused it (for colour)
  }[]
}

// Timeline entry with individual unit data
export interface SpatialTimelineEntry {
  time: number
  teamAHp: number
  teamBHp: number
  teamACount: number
  teamBCount: number
  teamADps: number
  teamBDps: number
  snapshot: BattlefieldSnapshot
}

// Simulation result
export interface SpatialSimResult {
  winner: 'A' | 'B' | 'draw' | 'A_retreat' | 'B_retreat'
  duration: number
  events: SpatialSimEvent[]
  teamASurvivors: SpatialCombatUnit[]
  teamBSurvivors: SpatialCombatUnit[]
  totalDamageByA: number
  totalDamageByB: number
  timeline: SpatialTimelineEntry[]
  snapshots: BattlefieldSnapshot[]  // For playback
  drawAnalysis: DrawAnalysis | null
}

// In-flight projectile tracking
interface Projectile {
  source: string
  sourceTeam: 'A' | 'B'
  target: string
  weapon: Weapon
  fromPos: Vec2
  toPos: Vec2
  arrivalTime: number
  isEmp: boolean
  aoeRadius: number    // 0 = no splash
  stunDuration: number // only used when isEmp
  isTracking: boolean  // missile steers toward current target position each tick
}

export class SpatialCombatSimulator {
  private units: Map<string, SpatialCombatUnit> = new Map()
  private projectiles: Projectile[] = []
  private config: SpatialSimConfig
  private events: SpatialSimEvent[] = []
  private currentTime: number = 0
  private timeline: SpatialTimelineEntry[] = []
  private snapshots: BattlefieldSnapshot[] = []
  private aliveCache: { A: SpatialCombatUnit[] | null; B: SpatialCombatUnit[] | null } = { A: null, B: null }
  private deathCounts: { A: number; B: number } = { A: 0, B: 0 }
  // AoE impact history for visualisation (kept for 1.0s)
  private aoeImpactHistory: { position: Vec2; radius: number; createdAt: number; team: 'A' | 'B' }[] = []
  // Beam/laser flash history for visualisation (kept for 0.1s)
  private beamFlashHistory: { from: Vec2; to: Vec2; projectileType: string; team: 'A' | 'B'; createdAt: number }[] = []
  // Production
  private spawnCounter: number = 0
  private productionLastSpawn: Map<string, number> = new Map()  // 'A-0', 'B-1', etc.
  // Draw analysis tracking
  private teamAFurthestY: number = 0
  private teamBFurthestY: number = Infinity
  private baseTrade: boolean = false

  constructor(config: SpatialSimConfig) {
    this.config = config
  }

  private invalidateAliveCache(team?: 'A' | 'B') {
    if (team) {
      this.aliveCache[team] = null
    } else {
      this.aliveCache.A = null
      this.aliveCache.B = null
    }
  }

  // Vision system: check if observer's team can see the target
  private canSee(observer: SpatialCombatUnit, target: SpatialCombatUnit): boolean {
    if (!this.config.useVisionSystem) return true

    // Check team-wide radar coverage
    const radarCoverage = observer.team === 'A' ? this.config.teamARadarCoverage : this.config.teamBRadarCoverage
    if (radarCoverage) return true

    // Check if any alive allied unit has the target in radar or sight range
    const allies = this.getAliveUnits(observer.team)
    for (const ally of allies) {
      const dist = vec2Distance(ally.position, target.position)
      if (ally.unit.radarRange && dist <= ally.unit.radarRange) return true
      if (dist <= ally.unit.sightRange) return true
    }

    return false
  }

  // Check if a team has retreated (all surviving units at field edge and has losses)
  private checkRetreat(team: 'A' | 'B'): boolean {
    const behavior = team === 'A' ? this.config.teamABehavior : this.config.teamBBehavior
    if (behavior !== 'retreat') return false

    if (this.deathCounts[team] === 0) return false

    const alive = this.getAliveUnits(team)
    if (alive.length === 0) return false

    const margin = 20
    const fieldSize = this.config.fieldSize

    return alive.every(u => {
      return u.position.x <= margin || u.position.x >= fieldSize - margin ||
             u.position.y <= margin || u.position.y >= fieldSize - margin
    })
  }

  // Spawn a production unit for a team
  private spawnUnit(entry: ProductionEntry, team: 'A' | 'B') {
    const instanceId = `${team}-${entry.unit.id}-prod${this.spawnCounter++}`
    const spawnY = team === 'A'
      ? this.config.fieldSize / 2 - this.config.productionSpawnDistance
      : this.config.fieldSize / 2 + this.config.productionSpawnDistance
    const spawnX = this.config.fieldSize * 0.1 + Math.random() * this.config.fieldSize * 0.8

    const combatUnit: SpatialCombatUnit = {
      id: entry.unit.id,
      instanceId,
      unit: entry.unit,
      team,
      position: vec2(
        Math.max(20, Math.min(this.config.fieldSize - 20, spawnX)),
        Math.max(20, Math.min(this.config.fieldSize - 20, spawnY))
      ),
      velocity: vec2(0, 0),
      targetPosition: null,
      radius: entry.unit.footprint ? Math.max(entry.unit.footprint.x, entry.unit.footprint.z) * 4 : 8,
      currentHp: entry.unit.health,
      maxHp: entry.unit.health,
      isAlive: true,
      isStunned: false,
      stunEndTime: 0,
      empDamage: 0,
      lastDamageTime: -Infinity,
      flankingDir: { x: Math.cos(Math.random() * Math.PI * 2), y: Math.sin(Math.random() * Math.PI * 2) },
      currentTarget: null,
      weaponCooldowns: new Map()
    }
    this.units.set(instanceId, combatUnit)
    this.invalidateAliveCache(team)
  }

  // Spawn production reinforcements for the current tick
  private processProduction() {
    const process = (entries: ProductionEntry[], team: 'A' | 'B') => {
      entries.forEach((entry, idx) => {
        const key = `${team}-${idx}`
        const lastSpawn = this.productionLastSpawn.get(key) ?? -entry.interval
        if (this.currentTime >= lastSpawn + entry.interval) {
          this.spawnUnit(entry, team)
          this.productionLastSpawn.set(key, this.currentTime)
        }
      })
    }
    process(this.config.teamAProduction, 'A')
    process(this.config.teamBProduction, 'B')
  }

  // Track each team's furthest advance toward enemy half for draw analysis
  private trackAdvance() {
    const midline = this.config.fieldSize / 2
    for (const u of this.getAliveUnits('A')) {
      if (u.position.y > this.teamAFurthestY) this.teamAFurthestY = u.position.y
    }
    for (const u of this.getAliveUnits('B')) {
      if (u.position.y < this.teamBFurthestY) this.teamBFurthestY = u.position.y
    }
    // Base trade: both teams simultaneously past midline
    const aAlive = this.getAliveUnits('A')
    const bAlive = this.getAliveUnits('B')
    if (aAlive.some(u => u.position.y > midline) && bAlive.some(u => u.position.y < midline)) {
      this.baseTrade = true
    }
  }

  // Push overlapping alive units apart based on their collision radii
  private resolveCollisions() {
    const alive = [...this.getAliveUnits('A'), ...this.getAliveUnits('B')]
    const margin = 20
    const fieldSize = this.config.fieldSize

    // 3 iterations to settle overlaps
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
          const a = alive[i]
          const b = alive[j]

          const dx = b.position.x - a.position.x
          const dy = b.position.y - a.position.y
          const distSq = dx * dx + dy * dy
          const minDist = a.radius + b.radius

          if (distSq < minDist * minDist && distSq > 0.0001) {
            const dist = Math.sqrt(distSq)
            const overlap = (minDist - dist) * 0.5
            const nx = dx / dist
            const ny = dy / dist

            a.position.x -= nx * overlap
            a.position.y -= ny * overlap
            b.position.x += nx * overlap
            b.position.y += ny * overlap
          }
        }
      }
    }

    // Re-clamp all to field bounds
    for (const unit of alive) {
      unit.position.x = Math.max(margin, Math.min(fieldSize - margin, unit.position.x))
      unit.position.y = Math.max(margin, Math.min(fieldSize - margin, unit.position.y))
    }
  }

  // Add units to the simulation with formation
  addUnits(units: Unit[], team: 'A' | 'B', quantities: Map<string, number>) {
    const formation = team === 'A' ? this.config.teamAFormation : this.config.teamBFormation
    const unitList: { unit: Unit; instanceId: string }[] = []

    // Create all unit instances
    for (const unit of units) {
      const count = quantities.get(unit.id) || 1
      for (let i = 0; i < count; i++) {
        const instanceId = `${team}-${unit.id}-${i}`
        unitList.push({ unit, instanceId })
      }
    }

    // Calculate formation positions
    const positions = this.calculateFormationPositions(
      unitList.length,
      team,
      formation
    )

    // Create combat units
    unitList.forEach((u, i) => {
      const combatUnit: SpatialCombatUnit = {
        id: u.unit.id,
        instanceId: u.instanceId,
        unit: u.unit,
        team,
        position: positions[i],
        velocity: vec2(0, 0),
        targetPosition: null,
        currentHp: u.unit.health,
        maxHp: u.unit.health,
        isAlive: true,
        isStunned: false,
        stunEndTime: 0,
        empDamage: 0,
        lastDamageTime: -Infinity,
        flankingDir: { x: Math.cos(Math.random() * Math.PI * 2), y: Math.sin(Math.random() * Math.PI * 2) },
        currentTarget: null,
        weaponCooldowns: new Map(),
        radius: u.unit.footprint
          ? Math.max(u.unit.footprint.x, u.unit.footprint.z) * 4
          : 8
      }
      this.units.set(u.instanceId, combatUnit)
    })
  }

  // Calculate formation positions
  private calculateFormationPositions(
    count: number,
    team: 'A' | 'B',
    formation: Formation
  ): Vec2[] {
    const positions: Vec2[] = []
    const centerX = this.config.fieldSize / 2
    const centerY = this.config.fieldSize / 2
    const teamOffset = team === 'A' ? -this.config.startingDistance / 2 : this.config.startingDistance / 2

    const spacing = 30  // Units of space between units

    switch (formation) {
      case 'grouped': {
        // Cluster units in a tight group
        const gridSize = Math.ceil(Math.sqrt(count))
        for (let i = 0; i < count; i++) {
          const row = Math.floor(i / gridSize)
          const col = i % gridSize
          positions.push(vec2(
            centerX + (col - gridSize / 2) * spacing * 0.5,
            centerY + teamOffset + (row - gridSize / 2) * spacing * 0.5
          ))
        }
        break
      }

      case 'line': {
        // Spread out perpendicular to enemy (horizontal line)
        const startX = centerX - (count - 1) * spacing / 2
        for (let i = 0; i < count; i++) {
          positions.push(vec2(
            startX + i * spacing,
            centerY + teamOffset
          ))
        }
        break
      }

      case 'column': {
        // Line towards enemy (vertical line)
        const startY = centerY + teamOffset
        const direction = team === 'A' ? 1 : -1
        for (let i = 0; i < count; i++) {
          positions.push(vec2(
            centerX,
            startY + i * spacing * direction * 0.5
          ))
        }
        break
      }

      case 'scattered': {
        // Maximally spread out in a circular pattern
        const radius = Math.min(this.config.fieldSize / 4, count * spacing / (2 * Math.PI))
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2
          positions.push(vec2(
            centerX + Math.cos(angle) * radius,
            centerY + teamOffset + Math.sin(angle) * radius * 0.5
          ))
        }
        break
      }
    }

    return positions
  }

  // Get alive units for a team (cached)
  private getAliveUnits(team: 'A' | 'B'): SpatialCombatUnit[] {
    if (this.aliveCache[team]) return this.aliveCache[team]!
    const alive = Array.from(this.units.values())
      .filter(u => u.team === team && u.isAlive)
    this.aliveCache[team] = alive
    return alive
  }

  // Get enemy team
  private getEnemyTeam(team: 'A' | 'B'): 'A' | 'B' {
    return team === 'A' ? 'B' : 'A'
  }

  // Select target based on strategy
  private selectTarget(attacker: SpatialCombatUnit, strategy: TargetingStrategy): SpatialCombatUnit | null {
    let enemies = this.getAliveUnits(this.getEnemyTeam(attacker.team))
    if (enemies.length === 0) return null

    // Filter by weapon attack capability (e.g. aircraft require missile weapons)
    enemies = enemies.filter(e => this.canAttackTarget(attacker, e))
    if (enemies.length === 0) return null

    // Filter by vision system
    if (this.config.useVisionSystem) {
      enemies = enemies.filter(e => this.canSee(attacker, e))
      if (enemies.length === 0) return null
    }

    switch (strategy) {
      case 'focus':
        return enemies.sort((a, b) => a.instanceId.localeCompare(b.instanceId))[0]

      case 'spread': {
        const attackerIndex = parseInt(attacker.instanceId.split('-')[2]) || 0
        return enemies[attackerIndex % enemies.length]
      }

      case 'random':
        return enemies[Math.floor(Math.random() * enemies.length)]

      case 'lowestHp':
        return enemies.reduce((lowest, u) => u.currentHp < lowest.currentHp ? u : lowest)

      case 'highestDps':
        return enemies.reduce((highest, u) => {
          const dps = u.unit.weapons.reduce((sum, w) => sum + (w.dps || 0), 0)
          const highestDps = highest.unit.weapons.reduce((sum, w) => sum + (w.dps || 0), 0)
          return dps > highestDps ? u : highest
        })

      case 'closest':
        return enemies.reduce((closest, u) => {
          const dist = vec2Distance(attacker.position, u.position)
          const closestDist = vec2Distance(attacker.position, closest.position)
          return dist < closestDist ? u : closest
        })

      default:
        return enemies[0]
    }
  }

  // Get max weapon range for a unit
  private getMaxRange(unit: SpatialCombatUnit): number {
    if (unit.unit.weapons.length === 0) return 0
    return Math.max(...unit.unit.weapons.map(w => w.range))
  }

  // Returns true when the unit has at least one weapon that can fire at the given distance
  private canFireAt(unit: SpatialCombatUnit, distance: number): boolean {
    return unit.unit.weapons.some(w => w.range > 0 && distance <= w.range)
  }

  // Air targeting rules (matches BAR's onlytargetcategory system):
  //   - AA-only weapons (onlyTargetsAir=true) do NOT fire at ground/surface units
  //   - Ground-only weapons (canTargetAir=false) do NOT fire at aircraft
  //   - Unrestricted weapons fire at any unit type
  // For legacy units.json (before parser fix), falls back to projectileType heuristic.
  private canWeaponTargetUnit(weapon: Weapon, target: SpatialCombatUnit): boolean {
    const isAircraft = target.unit.unitType === 'Aircraft'

    // AA-only weapon (flak, SAM) — skip ground units
    if (weapon.onlyTargetsAir && !isAircraft) return false

    if (!isAircraft) return true  // ground target — any non-AA-exclusive weapon can fire

    // Aircraft target — need canTargetAir
    if (weapon.canTargetAir !== undefined) return weapon.canTargetAir
    // Legacy fallback: Missile (after parser fix) or Rocket (old parser mapped MissileLauncher to Rocket)
    return weapon.projectileType === 'Missile' || weapon.projectileType === 'Rocket'
  }

  // True when attacker has at least one weapon capable of targeting the unit type.
  // Also enforces movement-mode domain rules:
  //   - Submarines can only attack Sailing or Submarine targets
  //   - Submarines can only be attacked by Sailing or Submarine units
  //   - AA-only units (all weapons onlyTargetsAir) can't attack non-aircraft
  private canAttackTarget(attacker: SpatialCombatUnit, target: SpatialCombatUnit): boolean {
    const attackerMode = attacker.unit.movementMode
    const targetMode = target.unit.movementMode

    // Submarines only attack ships and other submarines (not land/air)
    if (attackerMode === 'Submarine') {
      if (targetMode !== 'Sailing' && targetMode !== 'Submarine') return false
    }

    // Submarines can only be targeted by naval units (ships and subs have depth charges/torpedoes)
    if (targetMode === 'Submarine') {
      if (attackerMode !== 'Sailing' && attackerMode !== 'Submarine') return false
    }

    return attacker.unit.weapons.some(w => this.canWeaponTargetUnit(w, target))
  }

  // Apply AoE damage from an impact point — direct target gets full damage, splash is linear falloff
  private applyAoeDamage(impactPos: Vec2, weapon: Weapon, source: string, directTargetId: string, stunDuration: number, attackerPos: Vec2 | null = null) {
    const radius = weapon.areaOfEffect!
    const baseDamage = weapon.damage * (weapon.burstCount || 1)
    const isEmp = weapon.projectileType === 'EMP' || !!weapon.empDamage

    // Record impact for canvas visualisation
    const sourceUnit = this.units.get(source)
    this.aoeImpactHistory.push({
      position: { ...impactPos },
      radius,
      createdAt: this.currentTime,
      team: sourceUnit?.team ?? 'A'
    })

    for (const unit of this.units.values()) {
      if (!unit.isAlive) continue
      const dist = vec2Distance(unit.position, impactPos)
      if (dist > radius) continue

      const edgeEff = weapon.edgeEffectiveness ?? 0
      const denom = radius - dist * edgeEff
      const falloff = unit.instanceId === directTargetId
        ? 1
        : denom > 0.001 ? (radius - dist) / denom : 1.0
      const damage = baseDamage * falloff
      if (damage <= 0) continue

      const empAmount = isEmp ? (weapon.empDamage ?? weapon.damage) * (weapon.burstCount || 1) * falloff : 0
      // Use impact center as attacker position for AoE flanking calculation
      this.applyDamage(unit, isEmp ? empAmount : damage, source, isEmp, stunDuration, attackerPos ?? impactPos)
    }
  }

  // Get effective behavior for a unit (checks per-unit override first)
  private getBehavior(unit: SpatialCombatUnit): MovementBehavior {
    const overrides = unit.team === 'A' ? this.config.teamAUnitOverrides : this.config.teamBUnitOverrides
    return overrides[unit.id]?.behavior ?? (unit.team === 'A' ? this.config.teamABehavior : this.config.teamBBehavior)
  }

  // Get effective targeting strategy for a unit (checks per-unit override first)
  private getStrategy(unit: SpatialCombatUnit): TargetingStrategy {
    const overrides = unit.team === 'A' ? this.config.teamAUnitOverrides : this.config.teamBUnitOverrides
    return overrides[unit.id]?.strategy ?? (unit.team === 'A' ? this.config.teamAStrategy : this.config.teamBStrategy)
  }

  // Self-destruct: fire all AoE weapons as an explosion, then kill the unit
  private selfDestruct(unit: SpatialCombatUnit) {
    if (!unit.isAlive) return

    const aoeWeapons = unit.unit.weapons.filter(w => (w.areaOfEffect ?? 0) > 0)
    if (aoeWeapons.length > 0) {
      for (const weapon of aoeWeapons) {
        const stunDuration = weapon.stunDuration ?? 4
        this.applyAoeDamage({ ...unit.position }, weapon, unit.instanceId, '', stunDuration, null)
        this.events.push({
          type: 'fire',
          time: this.currentTime,
          attacker: unit.instanceId,
          weapon,
          target: '',
          fromPos: { ...unit.position },
          toPos: { ...unit.position }
        })
      }
    } else {
      // No AoE weapon: scale explosion by unit cost
      // Mines (cheap): ~150 dmg, 64 radius
      // Crawling bombs / suicide (medium): ~600 dmg, 128 radius
      // Heavy kamikaze (expensive): ~1500 dmg, 200 radius
      const metal = unit.unit.metalCost || 50
      const damage = Math.max(150, metal * 12)
      const radius = Math.max(64, metal * 1.5)
      const defaultExplosion = {
        id: 'selfd', name: 'Self-Destruct', damage, reload: 999,
        range: 0, projectileType: 'Plasma' as const, areaOfEffect: radius, dps: 0
      }
      this.applyAoeDamage({ ...unit.position }, defaultExplosion, unit.instanceId, '', 0, null)
    }

    // Kill the unit itself
    unit.currentHp = 0
    unit.isAlive = false
    this.invalidateAliveCache(unit.team)
    this.deathCounts[unit.team]++
    this.events.push({
      type: 'death',
      time: this.currentTime,
      unit: unit.instanceId,
      killer: unit.instanceId,
      position: { ...unit.position }
    })
  }

  // Check mine proximity detonation and kamikaze/suicide contact
  private processSpecialUnits() {
    for (const unit of this.units.values()) {
      if (!unit.isAlive) continue

      const u = unit.unit
      const enemies = this.getAliveUnits(this.getEnemyTeam(unit.team))
      if (enemies.length === 0) continue

      if (u.isMine) {
        // Mines detonate when any enemy enters detonateRange
        const triggerRange = u.detonateRange ?? 64
        for (const enemy of enemies) {
          if (vec2Distance(unit.position, enemy.position) <= triggerRange) {
            this.selfDestruct(unit)
            break
          }
        }
        continue
      }

      if (u.isKamikaze || u.isSuicide) {
        // Kamikaze/suicide: detonate when close enough to any enemy
        const detonateRange = u.isKamikaze
          ? (u.kamikazeDist ?? 20)
          : 20  // suicide crawling bomb: contact range
        for (const enemy of enemies) {
          if (vec2Distance(unit.position, enemy.position) <= detonateRange) {
            this.selfDestruct(unit)
            break
          }
        }
      }
    }
  }

  // Update unit movement based on behavior
  private updateMovement(unit: SpatialCombatUnit, deltaTime: number) {
    if (!unit.isAlive || unit.isStunned) return

    // Static units (buildings, turrets, mines) never move — skip movement logic entirely
    if ((unit.unit.speed ?? 0) === 0) return

    // Kamikaze and suicide units always rush toward closest enemy, ignoring team behavior
    const isRusher = unit.unit.isKamikaze || unit.unit.isSuicide
    const behavior = isRusher ? 'advance' : this.getBehavior(unit)
    const enemies = this.getAliveUnits(this.getEnemyTeam(unit.team))

    if (enemies.length === 0) return

    // Filter to only enemies this unit can actually attack — prevents AA-only units
    // from chasing ground targets, submarines from chasing land units, etc.
    const attackableEnemies = enemies.filter(e => this.canAttackTarget(unit, e))

    // If this unit can't attack anything (e.g. pure AA when no aircraft present), hold still
    if (attackableEnemies.length === 0) return

    // Closest attackable enemy drives movement direction
    const closestEnemy = attackableEnemies.reduce((closest, e) => {
      return vec2Distance(unit.position, e.position) < vec2Distance(unit.position, closest.position)
        ? e : closest
    })

    const toClosest = vec2Sub(closestEnemy.position, unit.position)
    const distToClosest = vec2Length(toClosest)
    const dirToClosest = vec2Normalize(toClosest)
    const maxRange = this.getMaxRange(unit)
    const speed = unit.unit.speed != null ? unit.unit.speed : 50

    let targetVelocity = vec2(0, 0)

    switch (behavior) {
      case 'hold':
        break

      case 'advance': {
        // Move toward the unit's actual firing target so we stop at the right distance.
        // Fall back to closest enemy when vision blocks all targets.
        const firingTarget = this.selectTarget(unit, this.getStrategy(unit))

        if (firingTarget) {
          const distToTarget = vec2Distance(unit.position, firingTarget.position)
          if (!this.canFireAt(unit, distToTarget)) {
            const dir = vec2Normalize(vec2Sub(firingTarget.position, unit.position))
            targetVelocity = vec2Scale(dir, speed)
          }
        } else {
          // No visible target yet — keep closing on closest known enemy until one enters sight
          targetVelocity = vec2Scale(dirToClosest, speed)
        }
        break
      }

      case 'retreat':
        targetVelocity = vec2Scale(dirToClosest, -speed)
        break

      case 'kite': {
        const firingTarget = this.selectTarget(unit, this.getStrategy(unit))

        if (firingTarget) {
          // Has a visible target — maintain weapon range
          const optimalRange = maxRange * 0.9
          const distToTarget = vec2Distance(unit.position, firingTarget.position)
          const dirToTarget = vec2Normalize(vec2Sub(firingTarget.position, unit.position))
          if (distToTarget > optimalRange + 20) {
            targetVelocity = vec2Scale(dirToTarget, speed)
          } else if (distToTarget < optimalRange - 20) {
            targetVelocity = vec2Scale(dirToTarget, -speed)
          }
        } else {
          // No visible target — close in until enemy enters sight range, then hold there
          const sightRange = unit.unit.sightRange
          const optimalSightRange = sightRange * 0.9
          if (distToClosest > optimalSightRange + 20) {
            targetVelocity = vec2Scale(dirToClosest, speed)
          } else if (distToClosest < optimalSightRange - 20) {
            targetVelocity = vec2Scale(dirToClosest, -speed)
          }
        }
        break
      }

      case 'surround': {
        // Coordinated encirclement: units targeting the same enemy spread evenly around it.
        // Slots are assigned by sorting units by their CURRENT angle around the target so
        // each unit takes the nearest available slot — they spread out without crossing.
        const surroundTarget = this.selectTarget(unit, this.getStrategy(unit)) || closestEnemy
        const optimalRange = maxRange > 0 ? maxRange * 0.85 : 100

        // Collect all alive allies with surround behavior targeting the same enemy
        const allies = this.getAliveUnits(unit.team)
        const coSurrounders = allies.filter(a => {
          if (this.getBehavior(a) !== 'surround') return false
          const t = this.selectTarget(a, this.getStrategy(a)) || closestEnemy
          return t.instanceId === surroundTarget.instanceId
        })
        const total = coSurrounders.length

        // Sort by current angle around target — each unit takes the nearest slot
        const sorted = coSurrounders.slice().sort((a, b) => {
          const angleA = Math.atan2(
            a.position.y - surroundTarget.position.y,
            a.position.x - surroundTarget.position.x
          )
          const angleB = Math.atan2(
            b.position.y - surroundTarget.position.y,
            b.position.x - surroundTarget.position.x
          )
          return angleA - angleB
        })

        const myIndex = sorted.findIndex(a => a.instanceId === unit.instanceId)
        // Anchor slot 0 to the first unit's angle so the ring stays stable as it forms
        const anchorAngle = Math.atan2(
          sorted[0].position.y - surroundTarget.position.y,
          sorted[0].position.x - surroundTarget.position.x
        )
        const assignedAngle = anchorAngle + (myIndex / total) * Math.PI * 2

        // Desired position: on the ring at assignedAngle
        const desiredPos: Vec2 = {
          x: surroundTarget.position.x + Math.cos(assignedAngle) * optimalRange,
          y: surroundTarget.position.y + Math.sin(assignedAngle) * optimalRange
        }

        const toDesired = vec2Sub(desiredPos, unit.position)
        const distToDesired = vec2Length(toDesired)
        if (distToDesired > 8) {
          targetVelocity = vec2Scale(vec2Normalize(toDesired), speed)
        }
        break
      }
    }

    // -----------------------------------------------------------------------
    // Fixed-wing aircraft movement (Flying + no hoverAttack):
    //   - Always move at cruise speed — never stop or hover
    //   - Turn rate limited by turn radius (attack: 500, navigation: 64 Spring units)
    //     angular_velocity = speed / turnRadius  (rad/s, same unit scale as BAR)
    //   - This is separate from the targetVelocity logic above which handles VTOL/ground
    // -----------------------------------------------------------------------
    const isFixedWing = unit.unit.movementMode === 'Flying' && !unit.unit.hoverAttack

    if (isFixedWing) {
      const speed = unit.unit.speed ?? 100

      // Current heading — if velocity is near zero (first tick), point toward enemy
      const currentSpeed = vec2Length(unit.velocity)
      let currentAngle: number
      if (currentSpeed > 0.1) {
        currentAngle = Math.atan2(unit.velocity.y, unit.velocity.x)
      } else {
        currentAngle = Math.atan2(dirToClosest.y, dirToClosest.x)
      }

      // Desired heading — navigate toward the firing target (or closest enemy)
      const firingTarget2 = this.selectTarget(unit, this.getStrategy(unit))
      const navTarget = firingTarget2 ?? closestEnemy
      const toNav = vec2Sub(navTarget.position, unit.position)
      let desiredAngle = behavior === 'retreat'
        ? Math.atan2(-dirToClosest.y, -dirToClosest.x)
        : Math.atan2(toNav.y, toNav.x)

      // Turn radius:
      //   - Within weapon range of any target → attack run (wide arc, radius 500)
      //   - Otherwise → navigation (tight turns, radius 64)
      // These are BAR Spring units — same scale as unit.speed — no conversion needed.
      const inWeaponRange = attackableEnemies.some(
        e => vec2Distance(unit.position, e.position) <= this.getMaxRange(unit)
      )
      // BAR: turnRate is in Spring units (65536 = full circle). Convert to rad/s.
      // angular_velocity = turnRate / 65536 * 2π * 30 (at 30 fps)
      // turn_radius = speed / angular_velocity
      const unitTurnRate = unit.unit.turnRate
      const turnRadius = unitTurnRate && unitTurnRate > 0
        ? speed / (unitTurnRate / 65536 * 2 * Math.PI * 30)
        : (inWeaponRange ? 500 : 64)  // fallback for units without turnRate
      const maxTurnAngle = (speed / turnRadius) * deltaTime   // radians this tick

      // Normalize angle difference to [-π, π] and clamp to maxTurnAngle
      let angleDiff = ((desiredAngle - currentAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI
      const turnAngle = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), maxTurnAngle)
      const newAngle = currentAngle + turnAngle

      // Fixed-wing always moves at cruise speed in heading direction
      unit.velocity = { x: Math.cos(newAngle) * speed, y: Math.sin(newAngle) * speed }
      unit.position = vec2Add(unit.position, vec2Scale(unit.velocity, deltaTime))

      // Clamp to field bounds (aircraft bounce off edges — heading adjustment on next tick)
      const margin = 20
      unit.position.x = Math.max(margin, Math.min(this.config.fieldSize - margin, unit.position.x))
      unit.position.y = Math.max(margin, Math.min(this.config.fieldSize - margin, unit.position.y))
      return
    }

    unit.velocity = targetVelocity

    unit.position = vec2Add(
      unit.position,
      vec2Scale(unit.velocity, deltaTime)
    )

    // Clamp to field bounds
    const margin = 20
    unit.position.x = Math.max(margin, Math.min(this.config.fieldSize - margin, unit.position.x))
    unit.position.y = Math.max(margin, Math.min(this.config.fieldSize - margin, unit.position.y))
  }

  // Process weapon firing
  private processWeaponFiring(unit: SpatialCombatUnit) {
    if (!unit.isAlive || unit.isStunned) return
    if (unit.unit.weapons.length === 0) return

    const target = this.selectTarget(unit, this.getStrategy(unit))
    if (!target) return

    // Skip firing if target not visible
    if (this.config.useVisionSystem && !this.canSee(unit, target)) return

    const distance = vec2Distance(unit.position, target.position)

    for (const weapon of unit.unit.weapons) {
      if (weapon.range <= 0) continue

      // Skip if this weapon can't target this unit type (e.g. non-missile vs aircraft)
      if (!this.canWeaponTargetUnit(weapon, target)) continue

      // Check if weapon is off cooldown
      const cooldownEnd = unit.weaponCooldowns.get(weapon.id) || 0
      if (this.currentTime < cooldownEnd) continue

      // Check if target is in range
      if (distance > weapon.range) continue

      // AircraftBomb: fixed-wing aircraft must be flying toward the target to drop bombs.
      // The bomb inherits forward momentum so the aircraft needs to be on an attack approach.
      // Gate: dot(normalized_velocity, dir_to_target) > cos(70°) ≈ 0.34
      if (weapon.projectileType === 'AircraftBomb') {
        const isFixedWingAttacker = unit.unit.movementMode === 'Flying' && !unit.unit.hoverAttack
        if (isFixedWingAttacker) {
          const vel = unit.velocity
          const velLen = vec2Length(vel)
          if (velLen > 0.1) {
            const flyDir = vec2Scale(vel, 1 / velLen)
            const toTarget = vec2Normalize(vec2Sub(target.position, unit.position))
            const dot = flyDir.x * toTarget.x + flyDir.y * toTarget.y
            if (dot < 0.34) continue  // Not on approach — skip this weapon this tick
          }
        }
      }

      const isEmp = weapon.projectileType === 'EMP' || !!weapon.empDamage
      const stunDuration = weapon.stunDuration ?? 4
      // EMP weapons use empDamage field if present, otherwise weapon.damage
      const rawDamage = isEmp
        ? (weapon.empDamage ?? weapon.damage) * (weapon.burstCount || 1)
        : weapon.damage * (weapon.burstCount || 1)
      const aoeRadius = weapon.areaOfEffect ?? 0

      // Calculate travel time
      let travelTime = 0
      if (weapon.projectileSpeed && weapon.projectileSpeed > 0) {
        travelTime = distance / weapon.projectileSpeed
      }

      // Weapon is tracking if the parser found tracks=true in the BAR weapon def.
      // isTracking is explicit in units.json — no broad heuristic needed.
      const isTrackingWeapon = weapon.isTracking === true

      // Calculate lead aim point using Spring engine predictboost formula.
      // Tracking missiles aim at current position — they steer each tick.
      const aimPos = (travelTime > 0 && !isTrackingWeapon)
        ? this.calculateAimPoint(unit, target, weapon, distance)
        : { ...target.position }

      // Apply spray angle scatter (weapon inaccuracy)
      const spray = weapon.sprayAngle ?? 0
      if (spray > 0) {
        const angleOffset = (Math.random() - 0.5) * 2 * Math.sin(spray * Math.PI / 45055)  // Spring formula
        const cos = Math.cos(angleOffset)
        const sin = Math.sin(angleOffset)
        const dx = aimPos.x - unit.position.x
        const dy = aimPos.y - unit.position.y
        aimPos.x = unit.position.x + dx * cos - dy * sin
        aimPos.y = unit.position.y + dx * sin + dy * cos
      }

      // Record fire event
      this.events.push({
        type: 'fire',
        time: this.currentTime,
        attacker: unit.instanceId,
        weapon,
        target: target.instanceId,
        fromPos: { ...unit.position },
        toPos: aimPos
      })

      if (travelTime > 0) {
        this.projectiles.push({
          source: unit.instanceId,
          sourceTeam: unit.team,
          target: target.instanceId,
          weapon,
          fromPos: { ...unit.position },
          toPos: aimPos,
          arrivalTime: this.currentTime + travelTime,
          isEmp,
          aoeRadius,
          stunDuration,
          isTracking: isTrackingWeapon ?? false
        })
      } else {
        // Instant hit — record beam flash for visualization
        const pt = weapon.projectileType
        const isBeamType = pt === 'Laser' || pt === 'BeamLaser' || pt === 'DGun' || pt === 'Heatray'
        if (isBeamType) {
          this.beamFlashHistory.push({
            from: { ...unit.position },
            to: { ...target.position },
            projectileType: pt,
            team: unit.team,
            createdAt: this.currentTime
          })
        }
        if (aoeRadius > 0) {
          this.applyAoeDamage({ ...target.position }, weapon, unit.instanceId, target.instanceId, stunDuration, { ...unit.position })
        } else {
          this.applyDamage(target, rawDamage, unit.instanceId, isEmp, stunDuration, { ...unit.position })
        }
      }

      unit.weaponCooldowns.set(weapon.id, this.currentTime + weapon.reload)
    }
  }

  // BAR EMP decay: SlowUpdate every 16 frames at 30fps, decay = maxHp × (16/30) × (1/40) per slow-update
  // = maxHp × 0.01333 per 0.533s = maxHp × 0.025 per second
  // Full decay from maxHp to 0 takes paralyzeDeclineRate (40) seconds
  // maxEmpDamage cap = (1 + paralyzetime/paralyzeDeclineRate) × maxHp prevents infinite stacking
  static readonly EMP_DECAY_RATE = 0.025   // fraction of maxHp per second

  // Apply damage to a unit (attackerPos enables flanking multiplier)
  private applyDamage(target: SpatialCombatUnit, damage: number, source: string, isEmp: boolean, stunDuration = 10, attackerPos: Vec2 | null = null) {
    if (!target.isAlive) return

    // Flanking damage multiplier (BAR: front=min×, side=mid×, rear=max×, mode 1 drift)
    if (!isEmp && attackerPos && this.config.useFlanking) {
      const attackDir = vec2Normalize(vec2Sub(target.position, attackerPos))  // attacker → target
      const dot = attackDir.x * target.flankingDir.x + attackDir.y * target.flankingDir.y
      const flankMax = target.unit.flankingBonusMax ?? 2.0
      const flankMin = target.unit.flankingBonusMin ?? 1.0
      damage *= flankMin + (flankMax - flankMin) * (1.0 - dot) / 2

      // Mode 1: flanking direction drifts to face incoming attacks (reduces bonus over time)
      const driftLerp = target.unit.flankingBonusMobilityAdd ?? 0.15
      const newX = target.flankingDir.x * (1 - driftLerp) + attackDir.x * driftLerp
      const newY = target.flankingDir.y * (1 - driftLerp) + attackDir.y * driftLerp
      const len = Math.sqrt(newX * newX + newY * newY)
      if (len > 0.001) {
        target.flankingDir = { x: newX / len, y: newY / len }
      }
    }

    this.events.push({
      type: 'damage',
      time: this.currentTime,
      target: target.instanceId,
      damage,
      source,
      isEmp
    })

    if (isEmp) {
      // Cap EMP accumulation so stun can't extend beyond stunDuration seconds
      const paralyzeDeclineRate = 40  // game frames (at 30fps)
      const empCap = (1 + stunDuration / paralyzeDeclineRate) * target.maxHp
      target.empDamage = Math.min(target.empDamage + damage, empCap)

      // Stun triggers when EMP >= maxHp (paralyzeOnMaxHealth = true in BAR modrules)
      if (target.empDamage >= target.maxHp && !target.isStunned) {
        target.isStunned = true
        this.events.push({
          type: 'stun',
          time: this.currentTime,
          unit: target.instanceId,
          duration: stunDuration
        })
      }
    } else {
      target.currentHp -= damage
      target.lastDamageTime = this.currentTime

      if (target.currentHp <= 0) {
        target.currentHp = 0
        target.isAlive = false
        this.invalidateAliveCache(target.team)
        this.deathCounts[target.team]++

        this.events.push({
          type: 'death',
          time: this.currentTime,
          unit: target.instanceId,
          killer: source,
          position: { ...target.position }
        })
      }
    }
  }

  // BAR Spring engine lead calculation:
  //   predictMult = mix(predictSpeedMod, 1.0, predictBoost)
  //               = predictSpeedMod * (1 - predictBoost) + predictBoost
  //   aimPoint = targetPos + targetVelocity * leadTime * predictMult
  //
  // predictSpeedMod models targeting accuracy noise (random 0.5–1.5 for poor weapons,
  // narrows toward 1.0 as predictBoost increases).
  // For tracking missiles (isTracking), aim at current position — missile steers each tick.
  private calculateAimPoint(
    _attacker: SpatialCombatUnit,
    target: SpatialCombatUnit,
    weapon: Weapon,
    distance: number
  ): Vec2 {
    // Tracking missiles aim at current position; they steer each tick via updateTrackingProjectiles
    if (weapon.isTracking) {
      return { ...target.position }
    }

    // No travel time (instant weapons) — aim at current position
    const speed = weapon.projectileSpeed
    if (!speed || speed <= 0) return { ...target.position }

    // First-order lead estimate (Spring engine linear approximation):
    //   leadTime = dist_to_current_pos / projectileSpeed
    const leadTime = distance / speed

    // predictBoost: Spring default is 0.0 (maximum scatter in lead prediction)
    const predictBoost = weapon.predictBoost ?? 0.0

    // predictSpeedMod: Spring range [0.5, 1.5] — random error centered at 1.0
    // At predictBoost=1.0: predictMult=1.0 (perfect). At predictBoost=0: pure noise.
    const predictSpeedMod = 0.5 + Math.random() * 1.0
    const predictMult = predictSpeedMod * (1 - predictBoost) + 1.0 * predictBoost

    return {
      x: target.position.x + target.velocity.x * leadTime * predictMult,
      y: target.position.y + target.velocity.y * leadTime * predictMult
    }
  }

  // Steer tracking missiles toward current target position each tick
  private updateTrackingProjectiles(deltaTime: number) {
    for (const proj of this.projectiles) {
      if (!proj.isTracking) continue
      const target = this.units.get(proj.target)
      if (!target || !target.isAlive) continue

      // Move fromPos toward target to simulate missile motion
      const speed = proj.weapon.projectileSpeed ?? 600
      const dist = vec2Distance(proj.fromPos, proj.toPos)
      if (dist < 1) continue

      // Advance fromPos by speed × deltaTime along the current trajectory
      const stepDist = speed * deltaTime
      if (stepDist >= dist) {
        proj.fromPos = { ...proj.toPos }
      } else {
        const dir = vec2Normalize(vec2Sub(proj.toPos, proj.fromPos))
        proj.fromPos = vec2Add(proj.fromPos, vec2Scale(dir, stepDist))
      }

      // Steer toPos to current target position (tracking)
      proj.toPos = { ...target.position }

      // Recalculate arrival time based on new distance
      const newDist = vec2Distance(proj.fromPos, proj.toPos)
      proj.arrivalTime = this.currentTime + newDist / speed
    }
  }

  // Process projectiles that have arrived
  private processProjectiles() {
    const arriving = this.projectiles.filter(p => p.arrivalTime <= this.currentTime)
    this.projectiles = this.projectiles.filter(p => p.arrivalTime > this.currentTime)

    for (const proj of arriving) {
      const target = this.units.get(proj.target)

      if (proj.aoeRadius > 0) {
        // AoE: use last known impact position (target's arrival pos stored in toPos)
        this.applyAoeDamage(proj.toPos, proj.weapon, proj.source, proj.target, proj.stunDuration, proj.fromPos)
      } else {
        if (!target || !target.isAlive) continue
        const damage = proj.isEmp
          ? (proj.weapon.empDamage ?? proj.weapon.damage) * (proj.weapon.burstCount || 1)
          : proj.weapon.damage * (proj.weapon.burstCount || 1)
        this.applyDamage(target, damage, proj.source, proj.isEmp, proj.stunDuration, proj.fromPos)
      }
    }
  }

  // Process stun endings — stun ends naturally when EMP decays below maxHp threshold
  private processStunEndings() {
    for (const unit of this.units.values()) {
      if (unit.isStunned && unit.empDamage < unit.maxHp) {
        unit.isStunned = false
        this.events.push({
          type: 'stunEnd',
          time: this.currentTime,
          unit: unit.instanceId
        })
      }
    }
  }

  // Create a snapshot of the current battlefield (only alive units to save memory)
  private createSnapshot(): BattlefieldSnapshot {
    // Prune impacts older than 1.0 second
    this.aoeImpactHistory = this.aoeImpactHistory.filter(
      i => this.currentTime - i.createdAt <= 1.0
    )
    // Prune beam flashes older than 0.1 second
    this.beamFlashHistory = this.beamFlashHistory.filter(
      f => this.currentTime - f.createdAt <= 0.1
    )

    return {
      time: this.currentTime,
      units: Array.from(this.units.values())
        .filter(u => u.isAlive)
        .map(u => ({
          instanceId: u.instanceId,
          position: { ...u.position },
          hp: u.currentHp,
          maxHp: u.maxHp,
          empDamage: u.empDamage,
          isAlive: true,
          isStunned: u.isStunned,
          team: u.team,
          unitId: u.id,
          name: u.unit.name,
          sightRange: u.unit.sightRange,
          weapons: u.unit.weapons.map(w => ({ id: w.id, name: w.name, range: w.range }))
        })),
      projectiles: this.projectiles.map(p => {
        // For tracking projectiles, use fromPos as the current missile position (updated each tick)
        const from = p.isTracking ? { ...p.fromPos } : p.fromPos
        const travelDuration = p.weapon.projectileSpeed && p.weapon.projectileSpeed > 0
          ? vec2Distance(p.fromPos, p.toPos) / p.weapon.projectileSpeed
          : 0
        const progress = travelDuration > 0
          ? Math.min(1, Math.max(0, 1 - (p.arrivalTime - this.currentTime) / travelDuration))
          : 1
        return {
          from,
          to: p.toPos,
          progress,
          isAoe: p.aoeRadius > 0,
          aoeRadius: p.aoeRadius,
          projectileType: p.weapon.projectileType,
          team: p.sourceTeam
        }
      }),
      beamFlashes: this.beamFlashHistory.map(f => ({ ...f })),
      aoeImpacts: this.aoeImpactHistory.map(i => ({ ...i }))
    }
  }

  // Record timeline entry
  private recordTimeline() {
    const teamA = this.getAliveUnits('A')
    const teamB = this.getAliveUnits('B')

    const teamADps = teamA.reduce((sum, u) =>
      sum + u.unit.weapons.reduce((ws, w) => ws + (w.dps || w.damage / w.reload), 0), 0)
    const teamBDps = teamB.reduce((sum, u) =>
      sum + u.unit.weapons.reduce((ws, w) => ws + (w.dps || w.damage / w.reload), 0), 0)

    const snapshot = this.createSnapshot()

    this.timeline.push({
      time: this.currentTime,
      teamAHp: teamA.reduce((sum, u) => sum + u.currentHp, 0),
      teamBHp: teamB.reduce((sum, u) => sum + u.currentHp, 0),
      teamACount: teamA.length,
      teamBCount: teamB.length,
      teamADps,
      teamBDps,
      snapshot
    })

    this.snapshots.push(snapshot)
  }

  // Run the simulation
  run(): SpatialSimResult {
    const deltaTime = 1 / this.config.tickRate
    const snapshotInterval = this.config.snapshotInterval
    let lastTimelineRecord = 0
    let retreatResult: 'A_retreat' | 'B_retreat' | null = null

    // Initialise advance tracking baselines
    this.teamAFurthestY = this.config.fieldSize / 2 - this.config.startingDistance / 2
    this.teamBFurthestY = this.config.fieldSize / 2 + this.config.startingDistance / 2

    // Initial snapshot
    this.recordTimeline()

    while (this.currentTime < this.config.maxTime) {
      // Check for battle end: wait until all in-flight projectiles have resolved so every
      // shot that was fired actually lands before the result is declared.
      const teamAAlive = this.getAliveUnits('A').length
      const teamBAlive = this.getAliveUnits('B').length
      if ((teamAAlive === 0 || teamBAlive === 0) && this.projectiles.length === 0) {
        break
      }

      // Spawn production reinforcements (only while both teams are still fighting)
      if (teamAAlive > 0 && teamBAlive > 0) {
        this.processProduction()
      }

      // Pass 1: all units move (separated from firing to eliminate order-dependent asymmetry)
      for (const unit of this.units.values()) {
        this.updateMovement(unit, deltaTime)
      }

      // Separate overlapping units after movement
      this.resolveCollisions()

      // Pass 2: all units fire (positions now reflect post-movement state for both teams)
      for (const unit of this.units.values()) {
        this.processWeaponFiring(unit)
      }

      // Steer tracking missiles toward current target position
      this.updateTrackingProjectiles(deltaTime)

      // Process arriving projectiles
      this.processProjectiles()

      // Prune non-AoE projectiles whose target has already died — they can never deal
      // damage and would otherwise stall the loop until their original arrival time.
      // AoE projectiles are kept: they still detonate at the last known impact position.
      this.projectiles = this.projectiles.filter(p =>
        p.aoeRadius > 0 || (this.units.get(p.target)?.isAlive ?? false)
      )

      // Proximity detonation for mines, kamikaze, and suicide units
      this.processSpecialUnits()

      // EMP decay (always decays, even while stunned — matches BAR behaviour)
      for (const unit of this.units.values()) {
        if (unit.isAlive && unit.empDamage > 0) {
          unit.empDamage = Math.max(0, unit.empDamage - unit.maxHp * SpatialCombatSimulator.EMP_DECAY_RATE * deltaTime)
        }
      }

      // Process stun endings after decay
      this.processStunEndings()

      // Advance time
      this.currentTime += deltaTime

      // Track team advances for draw analysis
      this.trackAdvance()

      // Check for retreat after movement
      if (this.checkRetreat('A')) {
        retreatResult = 'A_retreat'
        break
      }
      if (this.checkRetreat('B')) {
        retreatResult = 'B_retreat'
        break
      }

      // Record timeline at configured interval
      if (this.currentTime - lastTimelineRecord >= snapshotInterval) {
        this.recordTimeline()
        lastTimelineRecord = this.currentTime
      }
    }

    // Final snapshot
    this.recordTimeline()

    // Determine winner
    const teamASurvivors = this.getAliveUnits('A')
    const teamBSurvivors = this.getAliveUnits('B')

    let winner: 'A' | 'B' | 'draw' | 'A_retreat' | 'B_retreat'
    if (retreatResult) {
      winner = retreatResult
    } else if (teamASurvivors.length > 0 && teamBSurvivors.length === 0) {
      winner = 'A'
    } else if (teamBSurvivors.length > 0 && teamASurvivors.length === 0) {
      winner = 'B'
    } else {
      winner = 'draw'
    }

    // Draw analysis
    const midline = this.config.fieldSize / 2
    const teamAAdv = Math.round(this.teamAFurthestY - midline)
    const teamBAdv = Math.round(midline - this.teamBFurthestY)
    let drawLabel = 'No advance'
    if (this.baseTrade) {
      drawLabel = 'Base Trade?'
    } else if (teamAAdv > 0 && teamBAdv > 0) {
      drawLabel = `Both teams advanced (A: ${teamAAdv}u, B: ${teamBAdv}u)`
    } else if (teamAAdv > 0) {
      drawLabel = `Team A advanced ${teamAAdv}u past midline`
    } else if (teamBAdv > 0) {
      drawLabel = `Team B advanced ${teamBAdv}u past midline`
    }
    const drawAnalysis: DrawAnalysis = {
      teamAAdvance: teamAAdv,
      teamBAdvance: teamBAdv,
      baseTrade: this.baseTrade,
      label: drawLabel
    }

    // Calculate total damage dealt
    const totalDamageByA = this.events
      .filter(e => e.type === 'damage' && !e.isEmp)
      .filter(e => {
        const source = this.units.get((e as any).source)
        return source?.team === 'A'
      })
      .reduce((sum, e) => sum + (e as any).damage, 0)

    const totalDamageByB = this.events
      .filter(e => e.type === 'damage' && !e.isEmp)
      .filter(e => {
        const source = this.units.get((e as any).source)
        return source?.team === 'B'
      })
      .reduce((sum, e) => sum + (e as any).damage, 0)

    return {
      winner,
      duration: this.currentTime,
      events: this.events,
      teamASurvivors,
      teamBSurvivors,
      totalDamageByA,
      totalDamageByB,
      timeline: this.timeline,
      snapshots: this.snapshots,
      drawAnalysis: winner === 'draw' ? drawAnalysis : null
    }
  }
}

// Helper to run a quick spatial simulation
export function runSpatialSimulation(
  teamA: { unit: Unit; count: number }[],
  teamB: { unit: Unit; count: number }[],
  config: Partial<SpatialSimConfig> = {}
): SpatialSimResult {
  const fullConfig: SpatialSimConfig = {
    teamAStrategy: config.teamAStrategy || 'closest',
    teamBStrategy: config.teamBStrategy || 'closest',
    teamAFormation: config.teamAFormation || 'line',
    teamBFormation: config.teamBFormation || 'line',
    teamABehavior: config.teamABehavior || 'kite',
    teamBBehavior: config.teamBBehavior || 'kite',
    teamAUnitOverrides: config.teamAUnitOverrides ?? {},
    teamBUnitOverrides: config.teamBUnitOverrides ?? {},
    startingDistance: config.startingDistance || 800,
    fieldSize: config.fieldSize || 1200,
    maxTime: config.maxTime || 120,
    tickRate: config.tickRate || 20,
    useVisionSystem: config.useVisionSystem ?? false,
    teamARadarCoverage: config.teamARadarCoverage ?? false,
    teamBRadarCoverage: config.teamBRadarCoverage ?? false,
    retreatThreshold: config.retreatThreshold ?? 0.0,
    snapshotInterval: config.snapshotInterval ?? 0.25,
    teamAProduction: config.teamAProduction ?? [],
    teamBProduction: config.teamBProduction ?? [],
    productionSpawnDistance: config.productionSpawnDistance ?? 550,
    useFlanking: config.useFlanking ?? false
  }

  const sim = new SpatialCombatSimulator(fullConfig)

  const teamAQuantities = new Map<string, number>()
  const teamAUnits: Unit[] = []
  for (const { unit, count } of teamA) {
    teamAQuantities.set(unit.id, count)
    teamAUnits.push(unit)
  }

  const teamBQuantities = new Map<string, number>()
  const teamBUnits: Unit[] = []
  for (const { unit, count } of teamB) {
    teamBQuantities.set(unit.id, count)
    teamBUnits.push(unit)
  }

  sim.addUnits(teamAUnits, 'A', teamAQuantities)
  sim.addUnits(teamBUnits, 'B', teamBQuantities)

  return sim.run()
}

// Default config
export function getDefaultSpatialConfig(): SpatialSimConfig {
  return {
    teamAStrategy: 'closest',
    teamBStrategy: 'closest',
    teamAFormation: 'line',
    teamBFormation: 'line',
    teamABehavior: 'kite',
    teamBBehavior: 'kite',
    teamAUnitOverrides: {},
    teamBUnitOverrides: {},
    startingDistance: 800,
    fieldSize: 1200,
    maxTime: 120,
    tickRate: 20,
    useVisionSystem: true,
    teamARadarCoverage: false,
    teamBRadarCoverage: false,
    retreatThreshold: 0.0,
    snapshotInterval: 0.25,
    teamAProduction: [],
    teamBProduction: [],
    productionSpawnDistance: 550,
    useFlanking: true
  }
}
