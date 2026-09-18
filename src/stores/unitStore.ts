import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Unit, UnitData, Faction, Tier, UnitType, UnitFilters, DerivedStats } from '../types'

export const useUnitStore = defineStore('units', () => {
  // State
  const units = ref<Unit[]>([])
  const dataVersion = ref<string>('')
  const isLoaded = ref(false)

  const filters = ref<UnitFilters>({
    factions: [],
    tiers: [],
    unitTypes: [],
    searchQuery: '',
    searchTags: [],
    hideMorphs: true
  })

  // Getters
  const filteredUnits = computed(() => {
    return units.value.filter(unit => {
      // Hide morph units by default
      if (filters.value.hideMorphs && unit.isMorph) {
        return false
      }

      // Faction filter
      if (filters.value.factions.length > 0 &&
          !filters.value.factions.includes(unit.faction)) {
        return false
      }

      // Tier filter
      if (filters.value.tiers.length > 0 &&
          !filters.value.tiers.includes(unit.tier)) {
        return false
      }

      // Unit type filter
      if (filters.value.unitTypes.length > 0 &&
          !filters.value.unitTypes.includes(unit.unitType)) {
        return false
      }

      // Search filter — live query and committed tags combine with OR logic
      const allTerms = [
        ...filters.value.searchTags,
        ...(filters.value.searchQuery ? [filters.value.searchQuery] : []),
      ]
      if (allTerms.length > 0) {
        const nameLower = unit.name.toLowerCase()
        const idLower = unit.id.toLowerCase()
        return allTerms.some(term => {
          const q = term.toLowerCase()
          return nameLower.includes(q) || idLower.includes(q)
        })
      }

      return true
    })
  })

  const unitsByFaction = (faction: Faction) => {
    return units.value.filter(u => u.faction === faction)
  }

  const unitsByTier = (tier: Tier) => {
    return units.value.filter(u => u.tier === tier)
  }

  const unitsByType = (type: UnitType) => {
    return units.value.filter(u => u.unitType === type)
  }

  const getUnit = (id: string) => {
    return units.value.find(u => u.id === id)
  }

  // Calculate derived stats for a unit
  const getDerivedStats = (unit: Unit): DerivedStats => {
    const totalDps = unit.weapons.reduce((sum, w) => sum + (w.dps || w.damage / w.reload), 0)
    const ranges = unit.weapons.map(w => w.range).filter(r => r > 0)
    const burstDamage = unit.weapons.reduce((sum, w) => {
      const burst = w.burstCount || 1
      return sum + w.damage * burst
    }, 0)

    const totalCost = unit.metalCost + unit.energyCost / 70 // Rough energy-to-metal conversion

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

      speedPerCost: unit.metalCost > 0 ? unit.speed / unit.metalCost : 0
    }
  }

  // Actions
  const loadUnits = async () => {
    try {
      // Try to load from bundled data first
      const response = await fetch(new URL('../assets/data/units.json', import.meta.url).href)
      if (response.ok) {
        const data: UnitData = await response.json()
        units.value = data.units
        dataVersion.value = data.version
        isLoaded.value = true

        // Also save to localStorage for persistence
        localStorage.setItem('bar-units-data', JSON.stringify(data))
      }
    } catch {
      // Try localStorage fallback
      const stored = localStorage.getItem('bar-units-data')
      if (stored) {
        const data: UnitData = JSON.parse(stored)
        units.value = data.units
        dataVersion.value = data.version
        isLoaded.value = true
      }
    }
  }

  const importUnits = (jsonString: string) => {
    try {
      const data: UnitData = JSON.parse(jsonString)
      units.value = data.units
      dataVersion.value = data.version
      isLoaded.value = true
      localStorage.setItem('bar-units-data', jsonString)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  const exportUnits = (): string => {
    const data: UnitData = {
      version: dataVersion.value,
      generatedAt: new Date().toISOString(),
      source: 'bar-analyzer-export',
      units: units.value
    }
    return JSON.stringify(data, null, 2)
  }

  const setFilters = (newFilters: Partial<UnitFilters>) => {
    filters.value = { ...filters.value, ...newFilters }
  }

  const clearFilters = () => {
    filters.value = {
      factions: [],
      tiers: [],
      unitTypes: [],
      searchQuery: '',
      searchTags: [],
      hideMorphs: true
    }
  }

  const addSearchTag = (tag: string) => {
    const trimmed = tag.trim()
    if (!trimmed || filters.value.searchTags.includes(trimmed)) return
    filters.value.searchTags = [...filters.value.searchTags, trimmed]
  }

  const removeSearchTag = (index: number) => {
    const tags = [...filters.value.searchTags]
    tags.splice(index, 1)
    filters.value.searchTags = tags
  }

  return {
    // State
    units,
    dataVersion,
    isLoaded,
    filters,

    // Getters
    filteredUnits,
    unitsByFaction,
    unitsByTier,
    unitsByType,
    getUnit,
    getDerivedStats,

    // Actions
    loadUnits,
    importUnits,
    exportUnits,
    setFilters,
    clearFilters,
    addSearchTag,
    removeSearchTag,
  }
})
