import type { Unit, Weapon } from '../types'

// Targeting strategies
export type TargetingStrategy =
  | 'focus'      // All attack same target (lowest ID alive)
  | 'spread'     // Each attacker picks different target
  | 'random'     // Random target selection
  | 'lowestHp'   // Target unit with lowest HP
  | 'highestDps' // Target unit with highest DPS (threat)

// Combat unit instance (runtime state)
export interface CombatUnit {
  id: string
  instanceId: string  // Unique ID for this instance (unit.id + index)
  unit: Unit
  team: 'A' | 'B'

  // State
  currentHp: number
  maxHp: number
  isAlive: boolean
  isStunned: boolean
  stunEndTime: number
  empDamage: number  // Accumulated EMP damage
  lastDamageTime: number

  // Weapons state
  weaponCooldowns: Map<string, number>  // weapon.id -> next fire time
}

// Event types
export type SimEvent =
  | { type: 'fire'; time: number; attacker: string; weapon: Weapon; target: string }
  | { type: 'damage'; time: number; target: string; damage: number; source: string; isEmp: boolean }
  | { type: 'death'; time: number; unit: string; killer: string }
  | { type: 'stun'; time: number; unit: string; duration: number }
  | { type: 'stunEnd'; time: number; unit: string }
  | { type: 'regen'; time: number; unit: string; amount: number }

// Simulation configuration
export interface SimConfig {
  teamAStrategy: TargetingStrategy
  teamBStrategy: TargetingStrategy
  maxTime: number  // Max simulation time in seconds
  regenDelay: number  // Seconds before regen kicks in (0 = disabled)
  regenRate: number  // HP per second when regenerating
}

// Simulation result
export interface SimResult {
  winner: 'A' | 'B' | 'draw'
  duration: number
  events: SimEvent[]
  teamASurvivors: CombatUnit[]
  teamBSurvivors: CombatUnit[]
  totalDamageByA: number
  totalDamageByB: number
  timeline: TimelineEntry[]
}

export interface TimelineEntry {
  time: number
  teamAHp: number
  teamBHp: number
  teamACount: number
  teamBCount: number
}

// Priority queue for events
class EventQueue {
  private events: SimEvent[] = []

  push(event: SimEvent) {
    let lo = 0, hi = this.events.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.events[mid].time < event.time) lo = mid + 1
      else hi = mid
    }
    this.events.splice(lo, 0, event)
  }

  pop(): SimEvent | undefined {
    return this.events.shift()
  }

  isEmpty(): boolean {
    return this.events.length === 0
  }

  peek(): SimEvent | undefined {
    return this.events[0]
  }

  // Remove events for a dead unit
  removeEventsFor(unitId: string) {
    this.events = this.events.filter(e => {
      if ('attacker' in e && e.attacker === unitId) return false
      if ('target' in e && e.target === unitId) return false
      if ('unit' in e && e.unit === unitId) return false
      return true
    })
  }
}

export class CombatSimulator {
  private units: Map<string, CombatUnit> = new Map()
  private eventQueue: EventQueue = new EventQueue()
  private config: SimConfig
  private events: SimEvent[] = []
  private currentTime: number = 0
  private timeline: TimelineEntry[] = []
  private aliveCache: { A: CombatUnit[] | null; B: CombatUnit[] | null } = { A: null, B: null }

  constructor(config: SimConfig) {
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

  // Add units to the simulation
  addUnits(units: Unit[], team: 'A' | 'B', quantities: Map<string, number>) {
    for (const unit of units) {
      const count = quantities.get(unit.id) || 1
      for (let i = 0; i < count; i++) {
        const instanceId = `${team}-${unit.id}-${i}`
        const combatUnit: CombatUnit = {
          id: unit.id,
          instanceId,
          unit,
          team,
          currentHp: unit.health,
          maxHp: unit.health,
          isAlive: true,
          isStunned: false,
          stunEndTime: 0,
          empDamage: 0,
          lastDamageTime: -Infinity,
          weaponCooldowns: new Map()
        }
        this.units.set(instanceId, combatUnit)
      }
    }
  }

  // Get alive units for a team (cached)
  private getAliveUnits(team: 'A' | 'B'): CombatUnit[] {
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
  private selectTarget(attacker: CombatUnit, strategy: TargetingStrategy): CombatUnit | null {
    const enemies = this.getAliveUnits(this.getEnemyTeam(attacker.team))
    if (enemies.length === 0) return null

    switch (strategy) {
      case 'focus':
        // Always target first enemy (by instance ID sort)
        return enemies.sort((a, b) => a.instanceId.localeCompare(b.instanceId))[0]

      case 'spread':
        // Try to pick a target not already targeted, fallback to first
        // For simplicity, just round-robin based on attacker index
        const attackerIndex = parseInt(attacker.instanceId.split('-')[2]) || 0
        return enemies[attackerIndex % enemies.length]

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

      default:
        return enemies[0]
    }
  }

  // Schedule initial weapon fires for all units
  private scheduleInitialFires() {
    for (const unit of this.units.values()) {
      if (!unit.isAlive || unit.unit.weapons.length === 0) continue

      const strategy = unit.team === 'A' ? this.config.teamAStrategy : this.config.teamBStrategy
      const target = this.selectTarget(unit, strategy)
      if (!target) continue

      for (const weapon of unit.unit.weapons) {
        // Check if target is in range
        if (weapon.range <= 0) continue

        // Schedule first fire at time 0 (or small random offset for realism)
        const fireTime = Math.random() * 0.1
        this.eventQueue.push({
          type: 'fire',
          time: fireTime,
          attacker: unit.instanceId,
          weapon,
          target: target.instanceId
        })
        unit.weaponCooldowns.set(weapon.id, fireTime + weapon.reload)
      }
    }
  }

  // Process a fire event
  private processFire(event: Extract<SimEvent, { type: 'fire' }>) {
    const attacker = this.units.get(event.attacker)
    let target = this.units.get(event.target)

    if (!attacker || !attacker.isAlive || attacker.isStunned) return
    if (!target || !target.isAlive) {
      // Retarget
      const strategy = attacker.team === 'A' ? this.config.teamAStrategy : this.config.teamBStrategy
      target = this.selectTarget(attacker, strategy) || undefined
      if (!target) return
    }

    const weapon = event.weapon

    // Calculate travel time based on projectile type
    let travelTime = 0
    if (weapon.projectileSpeed && weapon.projectileSpeed > 0) {
      // Assume average engagement distance is weapon range / 2
      const distance = weapon.range / 2
      travelTime = distance / weapon.projectileSpeed
    }

    // Schedule damage event
    const damage = weapon.damage * (weapon.burstCount || 1)
    const isEmp = weapon.projectileType === 'EMP' || !!weapon.empDamage

    this.eventQueue.push({
      type: 'damage',
      time: event.time + travelTime,
      target: target.instanceId,
      damage,
      source: attacker.instanceId,
      isEmp
    })

    // Schedule next fire
    const nextFireTime = event.time + weapon.reload
    attacker.weaponCooldowns.set(weapon.id, nextFireTime)

    if (nextFireTime < this.config.maxTime) {
      const strategy = attacker.team === 'A' ? this.config.teamAStrategy : this.config.teamBStrategy
      const nextTarget = this.selectTarget(attacker, strategy)
      if (nextTarget) {
        this.eventQueue.push({
          type: 'fire',
          time: nextFireTime,
          attacker: attacker.instanceId,
          weapon,
          target: nextTarget.instanceId
        })
      }
    }

    this.events.push(event)
  }

  // Process a damage event
  private processDamage(event: Extract<SimEvent, { type: 'damage' }>) {
    const target = this.units.get(event.target)
    if (!target || !target.isAlive) return

    if (event.isEmp) {
      // EMP damage accumulates, stun when >= max HP
      target.empDamage += event.damage
      if (target.empDamage >= target.maxHp && !target.isStunned) {
        // Find the weapon's stun duration (use default of 3s)
        const stunDuration = 3
        target.isStunned = true
        target.stunEndTime = event.time + stunDuration

        this.eventQueue.push({
          type: 'stun',
          time: event.time,
          unit: target.instanceId,
          duration: stunDuration
        })

        this.eventQueue.push({
          type: 'stunEnd',
          time: event.time + stunDuration,
          unit: target.instanceId
        })

        // Reset EMP damage after stun
        target.empDamage = 0
      }
    } else {
      // Regular damage
      target.currentHp -= event.damage
      target.lastDamageTime = event.time

      if (target.currentHp <= 0) {
        target.currentHp = 0
        target.isAlive = false
        this.invalidateAliveCache(target.team)

        this.eventQueue.push({
          type: 'death',
          time: event.time,
          unit: target.instanceId,
          killer: event.source
        })

        // Remove pending events for dead unit
        this.eventQueue.removeEventsFor(target.instanceId)
      }
    }

    this.events.push(event)
  }

  // Process stun end
  private processStunEnd(event: Extract<SimEvent, { type: 'stunEnd' }>) {
    const unit = this.units.get(event.unit)
    if (!unit || !unit.isAlive) return

    unit.isStunned = false
    this.events.push(event)

    // Re-schedule weapon fires
    const strategy = unit.team === 'A' ? this.config.teamAStrategy : this.config.teamBStrategy
    const target = this.selectTarget(unit, strategy)
    if (target) {
      for (const weapon of unit.unit.weapons) {
        if (weapon.range <= 0) continue
        this.eventQueue.push({
          type: 'fire',
          time: event.time + 0.1,
          attacker: unit.instanceId,
          weapon,
          target: target.instanceId
        })
      }
    }
  }

  // Record timeline entry
  private recordTimeline() {
    const teamA = this.getAliveUnits('A')
    const teamB = this.getAliveUnits('B')

    this.timeline.push({
      time: this.currentTime,
      teamAHp: teamA.reduce((sum, u) => sum + u.currentHp, 0),
      teamBHp: teamB.reduce((sum, u) => sum + u.currentHp, 0),
      teamACount: teamA.length,
      teamBCount: teamB.length
    })
  }

  // Run the simulation
  run(): SimResult {
    this.scheduleInitialFires()
    this.recordTimeline()

    let lastTimelineRecord = 0

    while (!this.eventQueue.isEmpty()) {
      const event = this.eventQueue.pop()!

      if (event.time > this.config.maxTime) break

      this.currentTime = event.time

      // Record timeline every 0.5 seconds
      if (this.currentTime - lastTimelineRecord >= 0.5) {
        this.recordTimeline()
        lastTimelineRecord = this.currentTime
      }

      // Check for battle end
      const teamAAlive = this.getAliveUnits('A').length
      const teamBAlive = this.getAliveUnits('B').length

      if (teamAAlive === 0 || teamBAlive === 0) {
        break
      }

      // Process event
      switch (event.type) {
        case 'fire':
          this.processFire(event)
          break
        case 'damage':
          this.processDamage(event)
          break
        case 'stunEnd':
          this.processStunEnd(event)
          break
        case 'death':
        case 'stun':
        case 'regen':
          this.events.push(event)
          break
      }
    }

    // Final timeline record
    this.recordTimeline()

    // Determine winner
    const teamASurvivors = this.getAliveUnits('A')
    const teamBSurvivors = this.getAliveUnits('B')

    let winner: 'A' | 'B' | 'draw'
    if (teamASurvivors.length > 0 && teamBSurvivors.length === 0) {
      winner = 'A'
    } else if (teamBSurvivors.length > 0 && teamASurvivors.length === 0) {
      winner = 'B'
    } else {
      winner = 'draw'
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
      timeline: this.timeline
    }
  }
}

// Helper to run a quick simulation
export function runSimulation(
  teamA: { unit: Unit; count: number }[],
  teamB: { unit: Unit; count: number }[],
  config: Partial<SimConfig> = {}
): SimResult {
  const fullConfig: SimConfig = {
    teamAStrategy: config.teamAStrategy || 'focus',
    teamBStrategy: config.teamBStrategy || 'focus',
    maxTime: config.maxTime || 120,
    regenDelay: config.regenDelay || 0,
    regenRate: config.regenRate || 0
  }

  const sim = new CombatSimulator(fullConfig)

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

// Calculate how many of unitA needed to beat count of unitB
export function calculateRequiredUnits(
  unitA: Unit,
  unitB: Unit,
  countB: number,
  strategy: TargetingStrategy = 'focus',
  maxIterations: number = 20
): { count: number; result: SimResult } | null {
  // Binary search for the minimum count
  let low = 1
  let high = countB * 10  // Start with generous upper bound
  let bestResult: SimResult | null = null
  let bestCount = high

  for (let i = 0; i < maxIterations; i++) {
    const mid = Math.floor((low + high) / 2)

    const result = runSimulation(
      [{ unit: unitA, count: mid }],
      [{ unit: unitB, count: countB }],
      { teamAStrategy: strategy, teamBStrategy: strategy }
    )

    if (result.winner === 'A') {
      bestResult = result
      bestCount = mid
      high = mid - 1
    } else {
      low = mid + 1
    }

    if (low > high) break
  }

  if (bestResult) {
    return { count: bestCount, result: bestResult }
  }

  return null
}
