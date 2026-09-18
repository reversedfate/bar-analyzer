import type { Unit, DerivedStats } from '../types'

// All available stats that can be used for analysis
export interface StatDefinition {
  key: string
  label: string
  category: 'cost' | 'combat' | 'movement' | 'vision' | 'economy' | 'derived'
  getValue: (unit: Unit) => number
  format?: (value: number) => string
  description?: string
}

export const statDefinitions: StatDefinition[] = [
  // Cost stats
  {
    key: 'metalCost',
    label: 'Metal Cost',
    category: 'cost',
    getValue: (u) => u.metalCost,
    description: 'Metal required to build'
  },
  {
    key: 'energyCost',
    label: 'Energy Cost',
    category: 'cost',
    getValue: (u) => u.energyCost,
    description: 'Energy required to build'
  },
  {
    key: 'buildTime',
    label: 'Build Time',
    category: 'cost',
    getValue: (u) => u.buildTime,
    description: 'Total build power required'
  },
  {
    key: 'totalCost',
    label: 'Total Cost',
    category: 'cost',
    getValue: (u) => u.metalCost + u.energyCost / 70,
    format: (v) => v.toFixed(1),
    description: 'Metal + Energy/70 (approximate metal equivalent)'
  },

  // Combat stats
  {
    key: 'health',
    label: 'Health',
    category: 'combat',
    getValue: (u) => u.health,
    description: 'Maximum hit points'
  },
  {
    key: 'totalDps',
    label: 'Total DPS',
    category: 'combat',
    getValue: (u) => u.weapons.reduce((sum, w) => sum + (w.dps || 0), 0),
    format: (v) => v.toFixed(1),
    description: 'Combined damage per second from all weapons'
  },
  {
    key: 'maxRange',
    label: 'Max Range',
    category: 'combat',
    getValue: (u) => {
      const ranges = u.weapons.map(w => w.range).filter(r => r > 0)
      return ranges.length > 0 ? Math.max(...ranges) : 0
    },
    description: 'Maximum weapon range'
  },
  {
    key: 'minRange',
    label: 'Min Range',
    category: 'combat',
    getValue: (u) => {
      const ranges = u.weapons.map(w => w.range).filter(r => r > 0)
      return ranges.length > 0 ? Math.min(...ranges) : 0
    },
    description: 'Minimum weapon range'
  },
  {
    key: 'burstDamage',
    label: 'Burst Damage',
    category: 'combat',
    getValue: (u) => u.weapons.reduce((sum, w) => sum + w.damage * (w.burstCount || 1), 0),
    description: 'Alpha strike damage (all weapons firing once)'
  },
  {
    key: 'weaponCount',
    label: 'Weapon Count',
    category: 'combat',
    getValue: (u) => u.weapons.length,
    description: 'Number of weapons'
  },

  // Movement stats
  {
    key: 'speed',
    label: 'Speed',
    category: 'movement',
    getValue: (u) => u.speed || 0,
    description: 'Movement speed'
  },
  {
    key: 'turnRate',
    label: 'Turn Rate',
    category: 'movement',
    getValue: (u) => u.turnRate || 0,
    description: 'Turning speed in degrees/second'
  },

  // Vision stats
  {
    key: 'sightRange',
    label: 'Sight Range',
    category: 'vision',
    getValue: (u) => u.sightRange,
    description: 'Line of sight distance'
  },
  {
    key: 'radarRange',
    label: 'Radar Range',
    category: 'vision',
    getValue: (u) => u.radarRange || 0,
    description: 'Radar detection range'
  },
  {
    key: 'sonarRange',
    label: 'Sonar Range',
    category: 'vision',
    getValue: (u) => u.sonarRange || 0,
    description: 'Underwater detection range'
  },
  {
    key: 'jammerRange',
    label: 'Jammer Range',
    category: 'vision',
    getValue: (u) => u.jammerRange || 0,
    description: 'Radar jamming range'
  },

  // Economy stats
  {
    key: 'buildPower',
    label: 'Build Power',
    category: 'economy',
    getValue: (u) => u.buildPower || 0,
    description: 'Construction speed'
  },
  {
    key: 'metalProduction',
    label: 'Metal/s',
    category: 'economy',
    getValue: (u) => u.metalProduction || 0,
    format: (v) => v.toFixed(1),
    description: 'Metal production per second'
  },
  {
    key: 'energyProduction',
    label: 'Energy/s',
    category: 'economy',
    getValue: (u) => u.energyProduction || 0,
    description: 'Energy production per second'
  },

  // Derived/efficiency stats
  {
    key: 'healthPerMetal',
    label: 'HP/Metal',
    category: 'derived',
    getValue: (u) => u.metalCost > 0 ? u.health / u.metalCost : 0,
    format: (v) => v.toFixed(2),
    description: 'Health points per metal cost'
  },
  {
    key: 'dpsPerMetal',
    label: 'DPS/Metal',
    category: 'derived',
    getValue: (u) => {
      const dps = u.weapons.reduce((sum, w) => sum + (w.dps || 0), 0)
      return u.metalCost > 0 ? dps / u.metalCost : 0
    },
    format: (v) => v.toFixed(4),
    description: 'Damage per second per metal cost'
  },
  {
    key: 'speedPerMetal',
    label: 'Speed/Metal',
    category: 'derived',
    getValue: (u) => u.metalCost > 0 ? (u.speed || 0) / u.metalCost : 0,
    format: (v) => v.toFixed(4),
    description: 'Speed per metal cost'
  },
  {
    key: 'rangePerMetal',
    label: 'Range/Metal',
    category: 'derived',
    getValue: (u) => {
      const ranges = u.weapons.map(w => w.range).filter(r => r > 0)
      const maxRange = ranges.length > 0 ? Math.max(...ranges) : 0
      return u.metalCost > 0 ? maxRange / u.metalCost : 0
    },
    format: (v) => v.toFixed(4),
    description: 'Max range per metal cost'
  },
  {
    key: 'buildPowerPerMetal',
    label: 'BP/Metal',
    category: 'derived',
    getValue: (u) => u.metalCost > 0 && u.buildPower ? u.buildPower / u.metalCost : 0,
    format: (v) => v.toFixed(4),
    description: 'Build power per metal cost'
  },
  {
    key: 'effectiveHealth',
    label: 'Effective HP',
    category: 'derived',
    getValue: (u) => {
      // Simple model: faster units are harder to hit
      const speedBonus = 1 + (u.speed || 0) / 200
      return u.health * speedBonus
    },
    format: (v) => v.toFixed(0),
    description: 'Health adjusted for speed (harder to hit)'
  },
  {
    key: 'combatValue',
    label: 'Combat Value',
    category: 'derived',
    getValue: (u) => {
      const dps = u.weapons.reduce((sum, w) => sum + (w.dps || 0), 0)
      const ranges = u.weapons.map(w => w.range).filter(r => r > 0)
      const maxRange = ranges.length > 0 ? Math.max(...ranges) : 0
      // Composite score: DPS * range factor * health factor
      return dps * (1 + maxRange / 500) * (1 + u.health / 1000)
    },
    format: (v) => v.toFixed(1),
    description: 'Composite combat effectiveness score'
  }
]

// Get stat definition by key
export function getStatDef(key: string): StatDefinition | undefined {
  return statDefinitions.find(s => s.key === key)
}

// Get stats grouped by category
export function getStatsByCategory(): Record<string, StatDefinition[]> {
  const grouped: Record<string, StatDefinition[]> = {}
  for (const stat of statDefinitions) {
    if (!grouped[stat.category]) {
      grouped[stat.category] = []
    }
    grouped[stat.category].push(stat)
  }
  return grouped
}

// Calculate all derived stats for a unit
export function calculateDerivedStats(unit: Unit): DerivedStats {
  const totalDps = unit.weapons.reduce((sum, w) => sum + (w.dps || 0), 0)
  const ranges = unit.weapons.map(w => w.range).filter(r => r > 0)
  const burstDamage = unit.weapons.reduce((sum, w) => sum + w.damage * (w.burstCount || 1), 0)
  const totalCost = unit.metalCost + unit.energyCost / 70

  return {
    totalDps,
    maxRange: ranges.length > 0 ? Math.max(...ranges) : 0,
    minRange: ranges.length > 0 ? Math.min(...ranges) : 0,
    burstDamage,
    healthPerMetal: unit.metalCost > 0 ? unit.health / unit.metalCost : 0,
    dpsPerMetal: unit.metalCost > 0 ? totalDps / unit.metalCost : 0,
    healthPerTotalCost: totalCost > 0 ? unit.health / totalCost : 0,
    dpsPerTotalCost: totalCost > 0 ? totalDps / totalCost : 0,
    buildPowerPerMetal: unit.buildPower && unit.metalCost > 0
      ? unit.buildPower / unit.metalCost
      : undefined,
    metalPerSecondPerCost: unit.metalProduction && unit.metalCost > 0
      ? unit.metalProduction / unit.metalCost
      : undefined,
    energyPerSecondPerCost: unit.energyProduction && unit.metalCost > 0
      ? unit.energyProduction / unit.metalCost
      : undefined,
    speedPerCost: unit.metalCost > 0 ? (unit.speed || 0) / unit.metalCost : 0
  }
}

// Format a stat value for display
export function formatStatValue(key: string, value: number): string {
  const def = getStatDef(key)
  if (def?.format) {
    return def.format(value)
  }
  if (Number.isInteger(value)) {
    return value.toString()
  }
  return value.toFixed(2)
}
