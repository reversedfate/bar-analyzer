# BAR Unit Analyzer

A web application for analyzing and comparing unit statistics in **Beyond All Reason** (BAR), an open-source RTS game.

**Live demo:** https://skalnroze.github.io/bar-analyzer/ (unit icons are generated locally and not included in the demo)

## Features

- **Unit Browser**: Filter and sort units by faction, tier, and type
- **Stat Analysis**: Compare any stat against any other stat (HP/cost, DPS/metal, etc.)
- **Combat Simulation**: Pit units against each other with event-based simulation
- **Economy Simulation**: Optimize build orders and resource management

## Tech Stack

- Vue 3 + TypeScript
- Vite
- TailwindCSS
- Chart.js

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Updating Unit Data

Unit data is parsed from the official [Beyond All Reason repository](https://github.com/beyond-all-reason/Beyond-All-Reason).

```bash
# Fetch and parse latest unit data
npm run parse-units
```

This generates `src/assets/data/units.json` from the Lua unit definitions.

## Data Import/Export

The app supports importing and exporting unit data as JSON, allowing you to:
- Make manual adjustments to unit stats
- Share modified datasets
- Update stats after game patches

## Deployment

The app is designed to run as a static site on GitHub Pages.

Automatic deployment via GitHub Actions on push to `main` branch.

## License

MIT
