# BAR Unit Analyzer - Development Roadmap

## Overview

A browser-based web application for analyzing and comparing unit statistics in "Beyond All Reason" (BAR) RTS game.

**Deployment**: GitHub Pages deployment delayed indefinitely.

### Tech Stack
- **Framework**: Vue 3 + Vite
- **Charts**: Chart.js or Apache ECharts
- **Styling**: TailwindCSS
- **Data**: JSON with import/export, parsed from BAR Lua files

### Game Concepts Reference
- **Factions**: Armada, Cortex, Legion
- **Tier Progression**: Commander → T1 Factory → T1 Worker → T2 Factory → T2 Worker → T3 Factory
- **Resources**: Metal (gathered from spots), Energy (solar/wind/fusion)
- **Build Mechanic**: Buildpower vs build cost, proportional resource consumption

---

## Phase 0: Data Acquisition

### 0.1 Lua Parser Development
- [x] Clone/fetch BAR repo unit files from `https://github.com/beyond-all-reason/Beyond-All-Reason/tree/master/units`
- [x] Analyze Lua file structure for all unit types (bots, vehicles, aircraft, ships, buildings, etc.)
- [x] Create Node.js script to parse Lua tables into JSON
- [x] Handle nested structures: `weapondefs`, `customparams`, `featuredefs`
- [x] Extract key stats:
  - [x] Basic: `metalcost`, `energycost`, `buildtime`, `health`, `speed`, `sightdistance`
  - [x] Combat: `weapondefs` (damage, range, reload, projectile type, EMP)
  - [x] Construction: `buildpower`, `workertime`
  - [x] Special: `radardistance`, `sonardistance`, `jammerdistance`, `cloakcost`, `cloakcostmoving`
  - [x] Movement: `movementclass`, `maxwaterdepth`, `canfly`, `canhover`
- [x] Categorize units by faction (Armada, Cortex, Legion)
- [x] Categorize units by tier (T1, T2, T3) based on factory/builder relationships
- [x] Categorize units by type (bot, vehicle, aircraft, ship, hovercraft, building)
- [x] Output comprehensive `units.json` with all parsed data
- [x] Fetch proper unit names from BAR language file
- [ ] Document any manual fixes needed for edge cases

### 0.2 Data Validation
- [ ] Cross-reference parsed data against official website stats
- [ ] Verify weapon damage calculations match in-game
- [ ] Test with sample units from each faction/tier/type

**Status**: 685 units parsed (225 Armada, 229 Cortex, 231 Legion)

---

## Phase 1: Foundation (MVP)

### 1.1 Project Setup
- [x] Initialize Vue 3 + Vite project
- [x] Configure for static GitHub Pages deployment
- [x] Add TailwindCSS (v3)
- [x] Add Chart.js
- [x] Set up TypeScript
- [x] Add GitHub Actions workflow for auto-deploy

### 1.2 Data Layer
- [x] Define TypeScript interfaces:
  - [x] `Unit` (base stats, faction, tier, type)
  - [x] `Weapon` (damage, range, reload, projectile type, EMP stats)
  - [x] `Faction` enum (Armada, Cortex, Legion)
  - [x] `Tier` enum (T1, T2, T3)
  - [x] `UnitType` enum (Bot, Vehicle, Aircraft, Ship, Hovercraft, Building)
  - [x] `MovementMode` enum (Walking, Driving, Hovering, Flying, Sailing, Submarine)
- [x] Implement JSON import functionality
- [x] Implement JSON export functionality
- [x] Add LocalStorage persistence for user modifications
- [x] Bundle default `units.json` with app

### 1.3 Basic Unit Browser
- [x] Unit list view with sortable columns
- [x] Filter panel:
  - [x] By faction (multi-select)
  - [x] By tier (multi-select)
  - [x] By unit type (multi-select)
  - [x] By name search
- [x] Unit detail modal/panel showing all stats
- [x] Weapon list in unit detail with per-weapon stats

### 1.4 Initial Deployment (Delayed)
- [x] Configure Vite for base path
- [ ] ~~Set up GitHub Actions for auto-deploy~~ (delayed indefinitely)
- [ ] ~~Test on reversedfate.github.io~~ (delayed indefinitely)

---

## Phase 2: Single Unit Analysis

### 2.1 Derived Stats Engine
- [x] Create stat calculator service
- [x] Implement ratio calculations (any stat / any stat):
  - [x] HP per metal cost
  - [x] DPS per metal cost
  - [x] Range per cost
  - [x] Speed per cost
  - [x] Custom user-defined ratios
- [x] Implement composite stats:
  - [x] Total DPS (sum of all weapons)
  - [x] Burst damage (alpha strike)
  - [x] Effective HP (accounting for speed/size if applicable)
  - [x] Build efficiency (buildpower per cost)
  - [x] Economy efficiency (resource generation per cost)

### 2.2 Comparison Table
- [x] Side-by-side comparison (2-4 units)
- [x] Highlight best/worst values per stat
- [x] Show derived stats alongside base stats
- [ ] Export comparison as image or text

### 2.3 Scatter Plot Analysis
- [x] X/Y axis dropdowns (select any stat)
- [x] Plot all units as points
- [x] Color coding by faction
- [x] Size coding by cost (optional)
- [x] Hover tooltips with unit name and stats
- [x] Click to select unit for detail view
- [x] Filter integration (only show filtered units)
- [x] Log scale options
- [x] Quick presets for common analyses

---

## Phase 3: Combat Simulation

### 3.1 Simulation Engine Core
- [x] Event queue system (priority queue by timestamp)
- [x] Event types:
  - [x] `FireEvent` (weapon fires)
  - [x] `DamageEvent` (projectile hits, with travel time for plasma/rockets)
  - [x] `DeathEvent` (unit destroyed)
  - [x] `StunEvent` (EMP threshold reached)
  - [x] `StunEndEvent` (stun duration expires)
  - [ ] `RegenEvent` (out-of-combat health regen tick)
- [x] Unit state tracking (HP, stun status, last damage time)
- [x] Weapon cooldown tracking

### 3.2 Targeting Logic
- [x] Implement targeting strategies (configurable per team):
  - [x] Focus fire (all attack same target)
  - [x] Spread fire (each attacker picks different target)
  - [x] Random target
  - [x] Lowest HP target
  - [x] Highest threat target (by DPS)
- [x] Target acquisition on death (retarget when target dies)

### 3.3 Combat Mechanics
- [x] Projectile travel time (instant for lasers/hitscan, delayed for plasma/rockets)
- [x] EMP mechanics:
  - [x] EMP damage accumulation per unit
  - [x] Stun trigger when EMP >= max HP
  - [x] Stun duration from weapon stats
  - [ ] EMP decay over time (if applicable)
- [ ] Special damage modifiers:
  - [ ] Configurable damage reduction (e.g., solar panels at 50%)
  - [ ] Threshold-based resistance (e.g., first 500 damage reduced)
- [ ] Out-of-combat health regen (after X seconds no damage)

### 3.4 Battle Setup UI
- [x] Team A unit picker (add units, set quantities)
- [x] Team B unit picker
- [x] Targeting strategy selector per team
- [x] "Auto-calculate" button: how many of unit X to beat Y units of Z

### 3.5 Results & Visualization
- [x] Battle outcome summary (winner, survivors, time)
- [x] Event log (scrollable list of what happened)
- [x] HP over time chart (aggregated per team)
- [ ] DPS dealt over time chart
- [ ] Replayable step-by-step mode

---

## Phase 4: Economy Simulation

### 4.1 Economy Engine Core
- [x] Tick-based simulation (1 tick = 1 game second or configurable)
- [x] Resource state: metal, energy, storage caps
- [x] Income sources:
  - [x] Metal extractors (T1: ~1.8/s per spot, T2: higher)
  - [x] Commander passive income
  - [x] Wind turbines (variable: min/avg/max per map)
  - [x] Solar panels (constant, T1 and T2 variants)
  - [x] Fusion reactors (T2, high constant energy)
  - [x] Advanced fusion (T3)
  - [ ] Energy converters (metal from energy: 70E→1M, 600E→10M)
- [x] Expenses:
  - [x] Build costs (proportional to buildpower applied)
  - [ ] Cloaking costs
  - [ ] Radar/jammer costs

### 4.2 Build Queue System
- [x] Build queue per constructor
- [ ] Multiple constructors assisting one target
- [x] Buildpower aggregation
- [x] Resource-limited build rate (can't spend more than income + storage)
- [x] Build completion events

### 4.3 Simulation Configuration
- [x] Starting conditions:
  - [x] Metal: 1000 (default)
  - [x] Energy: 1000 (default)
  - [x] Commander buildpower: configurable
  - [x] Commander passive income: 2 metal/s, 10 energy/s (default)
- [x] Map parameters:
  - [x] Available metal spots (slider: 1-20+)
  - [x] Metal per spot (default 1.8)
  - [x] Wind range (min, max, average)
- [x] Army allocation slider (% of resources to army vs economy)

### 4.4 Build Order Input
- [x] Queue builder: select building, add to queue
- [x] Reorderable queue
- [ ] Conditional triggers (e.g., "build solar when energy < 100")
- [x] Save/load build orders (presets)

### 4.5 Economy Visualization
- [x] Resources over time (metal, energy line charts)
- [x] Income vs expenses over time
- [x] Total metal spent over time (for "what if I got X metal" analysis)
- [ ] Buildpower utilization chart
- [ ] "Injection analysis": show how +X metal at time Y would shift the curve
- [x] Milestone markers (when T2 unlocked, etc.)

---

## Phase 5: Polish & Advanced Features

### 5.1 UX Improvements
- [ ] Dark mode toggle
- [ ] Mobile responsive design
- [ ] Keyboard shortcuts
- [ ] Tooltips for all stats explaining what they mean

### 5.2 Sharing & Persistence
- [ ] Shareable URLs (state encoded in URL params)
- [ ] Preset scenarios (e.g., "T1 bot rush", "T2 timing attack")
- [ ] User accounts (optional, could use GitHub gists for storage)

### 5.3 PWA Support
- [ ] Service worker for offline use
- [ ] Installable app manifest
- [ ] Cache unit data locally

### 5.4 Advanced Analysis
- [ ] Unit tier lists (auto-generated based on derived stats)
- [ ] Meta analysis (most cost-efficient units per role)
- [ ] Counter suggestions (given unit X, what beats it efficiently)

### 5.5 Data Management
- [ ] Diff viewer when importing new data (show what changed)
- [ ] Patch notes integration (link stat changes to game patches)
- [ ] Community data sharing (export presets, build orders)

---

## File Structure (Planned)

```
bar-analyzer/
├── scripts/
│   └── lua-parser/          # Node.js Lua → JSON converter
│       ├── parse.js
│       └── README.md
├── src/
│   ├── assets/
│   │   └── data/
│   │       └── units.json   # Default unit data
│   ├── components/
│   │   ├── UnitBrowser/
│   │   ├── UnitDetail/
│   │   ├── Comparison/
│   │   ├── ScatterPlot/
│   │   ├── CombatSim/
│   │   └── EconomySim/
│   ├── composables/         # Vue composables
│   ├── services/
│   │   ├── statCalculator.ts
│   │   ├── combatSimulator.ts
│   │   └── economySimulator.ts
│   ├── types/
│   │   └── index.ts         # TypeScript interfaces
│   ├── stores/              # Pinia stores
│   ├── App.vue
│   └── main.ts
├── public/
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── roadmap.md               # This file
```

---

## Phase 6: Advanced Combat Simulation (2D Battlefield)

### 6.1 Individual Unit Tracking
- [x] Track and display individual unit HP over time (not just team totals)
- [ ] Per-unit health graphs with unit identification
- [x] Expanded stats display: expected DPS, damage dealt, overkill tracking

### 6.2 Spatial Simulation Engine
- [x] 2D coordinate system for unit positions
- [x] Unit movement simulation on flat terrain
- [x] Movement speed from unit stats
- [x] Range-based weapon activation (only fire when in range)
- [ ] Collision avoidance between units

### 6.3 Formation System
- [x] Starting distance configuration (how far apart teams start)
- [x] Formation presets per team:
  - [x] Grouped (units clustered together)
  - [x] Firing line (perpendicular to enemy, spread out)
  - [x] Travel column (line towards enemy, as if marching)
  - [x] Scattered/surround (maximize spacing, minimize AoE vulnerability)
- [x] Visual preview of formation in setup UI

### 6.4 Movement Strategies
- [x] Per-team movement behavior:
  - [x] Standing still (hold position)
  - [x] Advancing (move towards enemy)
  - [x] Retreating (move away from enemy)
  - [x] Kiting (maintain optimal range)
- [ ] Movement priority (attack-move vs move-only)

### 6.5 Battle Visualization
- [x] 2D battlefield preview canvas
- [x] Unit position rendering with faction colors
- [x] Hover over timeline to see unit positions at that moment
- [x] Projectile visualization (optional)
- [ ] Death markers and animations
- [x] Playback controls (play, pause, speed, scrub)

---

## Phase 7: Build Order Optimizer (Genetic/Monte Carlo)

### 7.1 Checkpoint System
- [ ] User-defined economy checkpoints/goals:
  - [ ] Target metal income at specific time (e.g., "10 M/s at 60s")
  - [ ] Target energy income at specific time
  - [ ] Target total metal spent by time
  - [ ] Target buildpower available
- [ ] Multiple checkpoints with priorities/weights
- [ ] Checkpoint editor UI with time slider

### 7.2 Constraint Configuration
- [ ] Starting units (commander selected by default)
- [ ] Available buildable units per constructor (respect build trees)
- [ ] Map constraints:
  - [ ] Number of metal spots available (and when - some may require expansion)
  - [ ] Metal per spot value
  - [ ] Water availability (for tidal generators, naval)
  - [ ] Tidal generator energy output
  - [ ] Wind min/max/average
  - [ ] Geothermal spots available
- [ ] Unit availability constraints (e.g., "no T2 before 3 minutes")

### 7.3 Optimization Engine
- [ ] Genetic algorithm implementation:
  - [ ] Chromosome: build order sequence
  - [ ] Fitness function: checkpoint achievement score
  - [ ] Selection, crossover, mutation operators
  - [ ] Population management
- [ ] Monte Carlo tree search alternative
- [ ] Hybrid approach option
- [ ] Web Worker for background computation (non-blocking UI)
- [ ] Progressive improvement (shows best-so-far immediately)

### 7.4 Optimizer UI
- [ ] Start/stop optimization button
- [ ] Real-time best solution display
- [ ] Fitness score over generations chart
- [ ] Current generation/iteration counter
- [ ] "Apply to Economy Sim" button to test best solution
- [ ] Export optimized build order

### 7.5 Build Tree Awareness
- [ ] Parse which units can build which other units
- [ ] Enforce build tree constraints (can't build T2 without T2 factory)
- [ ] Factory requirement tracking
- [ ] Constructor availability tracking

---

## Known Issues / Bugs

### Data Issues
- [x] **Legion Commander Levels 1-10**: ~~Appearing with absurd stat values~~ Fixed - now properly categorized as Commander type with `isMorph: true` flag, hidden by default in filters

---

## Notes

- **Data freshness**: Re-run Lua parser after each BAR patch to update `units.json`
- **EMP threshold**: Stun triggers when accumulated EMP damage >= unit max HP
- **Regen**: Units heal out of combat after a delay (Gunslinger is exception with constant regen)
- **Special cases**: Some units have conditional damage reduction (solar panels off = 50% damage taken, some units have threshold-based armor)
