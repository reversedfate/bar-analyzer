/**
 * BAR Unit Data Parser
 *
 * Fetches unit Lua files from the Beyond All Reason GitHub repository
 * and converts them to a JSON format for the web app.
 *
 * Usage:
 *   node scripts/lua-parser/parse.js              # Fetch from GitHub
 *   node scripts/lua-parser/parse.js --local PATH # Parse from local clone
 *
 * Environment:
 *   GITHUB_TOKEN - Optional GitHub token for higher rate limits
 */

import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '../../src/assets/data/units.json');

const GITHUB_API = 'https://api.github.com/repos/beyond-all-reason/Beyond-All-Reason/contents';
const GITHUB_RAW = 'https://raw.githubusercontent.com/beyond-all-reason/Beyond-All-Reason/master';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const LANGUAGE_FILE = `${GITHUB_RAW}/language/en/units.json`;

// Faction folders mapping
const FACTION_FOLDERS = {
  Armada: [
    'units/ArmAircraft',
    'units/ArmBots',
    'units/ArmBuildings',
    'units/ArmGantry',
    'units/ArmHovercraft',
    'units/ArmSeaplanes',
    'units/ArmShips',
    'units/ArmVehicles',
  ],
  Cortex: [
    'units/CorAircraft',
    'units/CorBots',
    'units/CorBuildings',
    'units/CorGantry',
    'units/CorHovercraft',
    'units/CorSeaplanes',
    'units/CorShips',
    'units/CorVehicles',
  ],
  Legion: [
    'units/Legion',
  ],
};

// Individual root-level unit files (commanders, assist drones, etc.)
// These live directly in units/ rather than in faction subdirectories.
const FACTION_ROOT_FILES = {
  Armada: [
    'units/armcom.lua',
    'units/armcomcon.lua',
    'units/armcomnew.lua',
    'units/armassistdrone.lua',
    'units/armassistdrone_land.lua',
  ],
  Cortex: [
    'units/corcom.lua',
    'units/corcomcon.lua',
    'units/corassistdrone.lua',
    'units/corassistdrone_land.lua',
  ],
  Legion: [
    'units/legassistdrone.lua',
    'units/legassistdrone_land.lua',
  ],
};

// Unit type detection patterns
const UNIT_TYPE_PATTERNS = {
  Commander: /com\.lua$|commander|legcomlvl/i,
  Aircraft: /aircraft|air\//i,
  Bot: /bots?\//i,
  Vehicle: /vehicles?\//i,
  Ship: /ships?\//i,
  Hovercraft: /hovercraft|hover/i,
  Building: /buildings?|defenc|econom|factor|labs?|utilit/i,
};

// Morph/upgrade units that should be filtered or marked specially
const MORPH_UNIT_PATTERNS = /lvl\d+|morph/i;

// Tier detection based on folder paths and unit IDs
const T2_PATTERNS = /t2|adv|moho|fus\.|afus|gantry|t2|level2/i;
const T3_PATTERNS = /t3|gantry|level3/i;

let rateLimited = false;

/**
 * Fetch JSON from GitHub API with rate limiting handling
 */
async function fetchGitHub(url) {
  if (rateLimited) {
    throw new Error('Rate limited');
  }

  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'BAR-Unit-Analyzer'
  };

  if (GITHUB_TOKEN) {
    headers['Authorization'] = `token ${GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });

  if (response.status === 403 || response.status === 429) {
    rateLimited = true;
    const resetTime = response.headers.get('X-RateLimit-Reset');
    const resetDate = resetTime ? new Date(parseInt(resetTime) * 1000) : null;
    console.error(`\nGitHub API rate limit exceeded.`);
    if (resetDate) {
      console.error(`Rate limit resets at: ${resetDate.toLocaleTimeString()}`);
    }
    if (!GITHUB_TOKEN) {
      console.error('Tip: Set GITHUB_TOKEN environment variable for higher limits (5000/hr vs 60/hr)');
    }
    throw new Error('Rate limited');
  }

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch raw file content
 */
async function fetchRaw(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

/**
 * Recursively find all .lua files in a GitHub directory
 */
async function findLuaFilesRemote(path, files = []) {
  if (rateLimited) return files;

  try {
    const contents = await fetchGitHub(`${GITHUB_API}/${path}`);

    for (const item of contents) {
      if (rateLimited) break;

      if (item.type === 'dir') {
        await findLuaFilesRemote(item.path, files);
        await new Promise(r => setTimeout(r, 100));
      } else if (item.type === 'file' && item.name.endsWith('.lua')) {
        files.push({
          name: item.name,
          path: item.path,
          downloadUrl: `${GITHUB_RAW}/${item.path}`
        });
      }
    }
  } catch (error) {
    if (!rateLimited) {
      console.warn(`Warning: Could not fetch ${path}: ${error.message}`);
    }
  }

  return files;
}

/**
 * Recursively find all .lua files in a local directory
 */
function findLuaFilesLocal(basePath, relativePath = '', files = []) {
  const fullPath = join(basePath, relativePath);

  if (!existsSync(fullPath)) {
    console.warn(`Warning: Path does not exist: ${fullPath}`);
    return files;
  }

  const items = readdirSync(fullPath);

  for (const item of items) {
    const itemPath = join(fullPath, item);
    const relPath = join(relativePath, item);
    const stat = statSync(itemPath);

    if (stat.isDirectory()) {
      findLuaFilesLocal(basePath, relPath, files);
    } else if (item.endsWith('.lua')) {
      files.push({
        name: item,
        path: relPath.replace(/\\/g, '/'),
        localPath: itemPath
      });
    }
  }

  return files;
}

/**
 * Parse a Lua value (handles strings, numbers, booleans, simple arithmetic)
 */
function parseLuaValue(str) {
  str = str.trim();

  // String
  if ((str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }

  // Boolean
  if (str === 'true') return true;
  if (str === 'false') return false;
  if (str === 'nil') return null;

  // Simple arithmetic expression (e.g. "1/70", "100 * 0.5")
  // Handles: integer or decimal operands with +, -, *, /
  const arithMatch = str.match(/^(-?\d+\.?\d*)\s*([\+\-\*\/])\s*(-?\d+\.?\d*)$/);
  if (arithMatch) {
    const a = parseFloat(arithMatch[1]);
    const op = arithMatch[2];
    const b = parseFloat(arithMatch[3]);
    if (op === '+') return a + b;
    if (op === '-') return a - b;
    if (op === '*') return a * b;
    if (op === '/' && b !== 0) return a / b;
  }

  // Plain number
  const num = parseFloat(str);
  if (!isNaN(num)) return num;

  return str;
}

/**
 * Parse a simple Lua table (non-recursive, for simple key-value pairs).
 * Strips single-line Lua comments (-- ...) before matching so commented-out
 * keys are not accidentally parsed.
 */
function parseSimpleTable(content) {
  // Remove Lua single-line comments: anything from -- to end of line
  const stripped = content.replace(/--[^\n]*/g, '');
  const result = {};
  const pattern = /(\w+)\s*=\s*([^,}\n]+)/g;
  let match;

  while ((match = pattern.exec(stripped)) !== null) {
    const key = match[1];
    const value = parseLuaValue(match[2]);
    result[key] = value;
  }

  return result;
}

/**
 * Extract a nested table from Lua content
 */
function extractTable(content, tableName) {
  const tablePattern = new RegExp(`${tableName}\\s*=\\s*\\{`, 'i');
  const match = tablePattern.exec(content);

  if (!match) return null;

  let depth = 1;
  let start = match.index + match[0].length;
  let end = start;

  while (depth > 0 && end < content.length) {
    if (content[end] === '{') depth++;
    if (content[end] === '}') depth--;
    end++;
  }

  return content.slice(start, end - 1);
}

/**
 * Parse buildoptions from a unit file.
 *
 * BAR uses two formats depending on faction:
 *   Armada/Cortex: buildoptions = { [1] = "unitid1", [2] = "unitid2", ... }
 *   Legion:        buildoptions = { "unitid1", "unitid2", ... }  (bare strings)
 *
 * Both are semantically identical Lua tables; the parser handles both.
 * Returns an array of lowercase unit ID strings, or undefined if none found.
 */
function parseBuildOptions(content) {
  const tableContent = extractTable(content, 'buildoptions');
  if (!tableContent) return undefined;

  const options = [];

  // Try format 1 first: [N] = "unitid" or [N] = 'unitid'  (Armada/Cortex)
  const keyedPattern = /\[\d+\]\s*=\s*["']([^"']+)["']/g;
  let match;
  while ((match = keyedPattern.exec(tableContent)) !== null) {
    const id = match[1].trim().toLowerCase();
    if (id) options.push(id);
  }

  if (options.length === 0) {
    // Format 2: bare quoted strings  (Legion)
    // Match all quoted strings in the table content
    const barePattern = /["']([a-zA-Z][a-zA-Z0-9_]+)["']/g;
    while ((match = barePattern.exec(tableContent)) !== null) {
      const id = match[1].trim().toLowerCase();
      if (id) options.push(id);
    }
  }

  return options.length > 0 ? options : undefined;
}

/**
 * Parse unit-level weapon assignments (weapons = { [N] = { def, onlytargetcategory, ... } })
 * Returns a Map from weapon def name (lowercase) to targeting restrictions
 */
function parseWeaponAssignments(content) {
  const assignments = new Map();
  const weaponsContent = extractTable(content, 'weapons');
  if (!weaponsContent) return assignments;

  // Match each [N] = { ... } entry
  const entryPattern = /\[\d+\]\s*=\s*\{/g;
  let match;

  while ((match = entryPattern.exec(weaponsContent)) !== null) {
    let depth = 1;
    let start = match.index + match[0].length;
    let end = start;

    while (depth > 0 && end < weaponsContent.length) {
      if (weaponsContent[end] === '{') depth++;
      if (weaponsContent[end] === '}') depth--;
      end++;
    }

    const entryContent = weaponsContent.slice(start, end - 1);
    const data = parseSimpleTable(entryContent);

    if (data.def) {
      const defName = data.def.toString().toLowerCase().trim().replace(/['"]/g, '');
      assignments.set(defName, {
        onlytargetcategory: data.onlytargetcategory ? data.onlytargetcategory.toString().toUpperCase() : null,
        badtargetcategory:  data.badtargetcategory  ? data.badtargetcategory.toString().toUpperCase()  : null,
      });
    }
  }

  return assignments;
}

/**
 * Parse weapon definitions from Lua content
 */
function parseWeapons(content) {
  const weapons = [];
  const weaponDefsContent = extractTable(content, 'weapondefs');

  if (!weaponDefsContent) return weapons;

  // Parse unit-level weapon assignments to get targeting category restrictions
  const assignments = parseWeaponAssignments(content);

  // Keys that can appear inside weapon defs as nested tables — skip them at top level too
  const SKIP_WEAPON_KEYS = new Set([
    'damage', 'customparams', 'sounds', 'explosiongenerator',
    'features', 'colvolume', 'metalextraction', 'sprayangle'
  ]);

  const weaponPattern = /(\w+)\s*=\s*\{/g;
  let match;

  while ((match = weaponPattern.exec(weaponDefsContent)) !== null) {
    const weaponId = match[1];

    let depth = 1;
    let start = match.index + match[0].length;
    let end = start;

    while (depth > 0 && end < weaponDefsContent.length) {
      if (weaponDefsContent[end] === '{') depth++;
      if (weaponDefsContent[end] === '}') depth--;
      end++;
    }

    // Always advance past this block so nested tables aren't re-scanned as weapon IDs
    weaponPattern.lastIndex = end;

    if (SKIP_WEAPON_KEYS.has(weaponId.toLowerCase())) continue;

    const weaponContent = weaponDefsContent.slice(start, end - 1);
    const weaponData = parseSimpleTable(weaponContent);

    // Skip BAR internal dummy/backup weapons:
    //   bogus = 1  → pure internal dummy (no real weapon)
    //   smart_backup → alternate trajectory for the primary weapon, not an independent gun
    const customParamsContent = extractTable(weaponContent, 'customparams');
    const customParams = customParamsContent ? parseSimpleTable(customParamsContent) : {};
    if (customParams.bogus || customParams.smart_backup) continue;

    const damageContent = extractTable(weaponContent, 'damage');
    const damageData = damageContent ? parseSimpleTable(damageContent) : {};

    // Use the best available damage value: prefer 'default', fall back to max of
    // any armor-class entry. This prevents AA weapons like armflak (which store
    // damage under non-default armor classes) from being incorrectly filtered out.
    let damage = damageData.default || damageData.Default || 0;
    if (damage <= 0) {
      for (const [key, val] of Object.entries(damageData)) {
        if (key.toLowerCase() !== 'default' && typeof val === 'number' && val > damage) {
          damage = val;
        }
      }
    }
    // Skip zero-damage weapons (trajectory dummies, misc internal mechanics)
    if (damage <= 0 && !weaponData.paralyzer) continue;

    const weaponType = (weaponData.weapontype || '').toLowerCase();
    const isTracking = weaponData.tracks === true || weaponData.tracks === 1;
    const cylinderTargeting = weaponData.cylindertargeting || weaponData.cylindertargetting || 0;
    const gravityAffected = weaponData.gravityaffected === true || weaponData.gravityaffected === 'true' || weaponData.gravityaffected === 1;

    const reload = weaponData.reloadtime || 1;

    // Determine air targeting from unit-level weapon assignment categories FIRST,
    // because Flak classification requires knowing onlyTargetsAir.
    // onlytargetcategory = "VTOL"    → exclusively targets aircraft (AA weapon)
    // onlytargetcategory = "SURFACE" → ground-only weapon, cannot target aircraft
    // No restriction                 → can target everything (default)
    // BAR uses VTOL category for all units with canfly=true.
    const assignment = assignments.get(weaponId.toLowerCase()) || null;
    const onlyTarget = assignment?.onlytargetcategory || null;
    let canTargetAir = undefined;
    let onlyTargetsAir = undefined;
    if (onlyTarget) {
      const hasVtol    = onlyTarget.includes('VTOL');
      const hasSurface = onlyTarget.includes('SURFACE') || onlyTarget.includes('NOTAIR');
      if (hasVtol && !hasSurface) {
        canTargetAir  = true;
        onlyTargetsAir = true;   // AA-only weapon (flak, SAM, etc.)
      } else if (hasSurface && !hasVtol) {
        canTargetAir = false;    // ground-only weapon
      } else if (hasVtol && hasSurface) {
        canTargetAir = true;     // can target both (rare)
      }
    } else {
      // No restriction — also check cylinderTargeting as a fallback for weapons
      // that target aircraft via height rather than category restriction
      if (cylinderTargeting > 0) canTargetAir = true;
    }

    // Flak = cannon with cylinderTargeting AND only targets air.
    // Without the onlyTargetsAir check, ground EMGs like armpw (which use
    // cylinderTargeting for precision) would be misclassified as Flak.
    const isFlak = cylinderTargeting > 0 && onlyTargetsAir === true;

    let projectileType = 'Other';

    if (weaponType === 'aircraftbomb') {
      projectileType = 'AircraftBomb';
    } else if (weaponType === 'beamlaser') {
      // largebeamlaser = true means it's a Heatray (Legion heatray mech etc.) — orange-red
      projectileType = weaponData.largebeamlaser ? 'Heatray' : 'BeamLaser';
    } else if (weaponType === 'lasercannon' || weaponType.includes('laser')) {
      projectileType = 'Laser';
    } else if (weaponType === 'dgun') {
      projectileType = 'DGun';
    } else if (weaponType === 'missilelauncher' || weaponType.includes('missile')) {
      // Guided (tracks = true) → Missile; unguided → Rocket (e.g. parabolic g2g rocket launchers)
      projectileType = isTracking ? 'Missile' : 'Rocket';
    } else if (weaponType === 'torpedolauncher') {
      projectileType = 'Torpedo';
    } else if (weaponType === 'starburst') {
      projectileType = weaponData.paralyzer ? 'EMP' : 'Rocket';
    } else if (weaponType.includes('rocket')) {
      projectileType = 'Rocket';
    } else if (weaponType.includes('cannon')) {
      if (isFlak) {
        projectileType = 'Flak';
      } else if (gravityAffected) {
        projectileType = 'Cannon';
      } else {
        projectileType = 'Plasma';
      }
    } else if (weaponType.includes('lightning') || weaponType.includes('flame') || weaponType.includes('heat')) {
      projectileType = 'Heatray';
    } else if (weaponType.includes('emp') || weaponData.paralyzer) {
      projectileType = 'EMP';
    }

    // Per-armor-class damage (non-default keys in the damage table)
    const armorDamage = {};
    for (const [key, val] of Object.entries(damageData)) {
      if (key.toLowerCase() !== 'default') {
        armorDamage[key.toLowerCase()] = val;
      }
    }

    weapons.push({
      id: weaponId,
      name: weaponData.name || weaponId,
      damage: damage,
      reload: reload,
      range: weaponData.range || 0,
      projectileType: projectileType,
      projectileSpeed: weaponData.weaponvelocity,
      areaOfEffect: weaponData.areaofeffect,
      empDamage: weaponData.paralyzetime ? damage : undefined,
      stunDuration: weaponData.paralyzetime,
      burstRate: weaponData.burstrate,
      burstCount: weaponData.burst,
      canTargetAir: canTargetAir,
      onlyTargetsAir: onlyTargetsAir,
      ...(isTracking && { isTracking: true }),
      ...(isFlak && { isFlak: true }),
      ...(gravityAffected && { gravityAffected: true }),
      ...(weaponData.predictboost !== undefined && { predictBoost: weaponData.predictboost }),
      ...(weaponData.edgeeffectiveness !== undefined && { edgeEffectiveness: weaponData.edgeeffectiveness }),
      ...(weaponData.sprayangle !== undefined && { sprayAngle: weaponData.sprayangle }),
      ...(weaponData.targetmoveerror !== undefined && { targetMoveError: weaponData.targetmoveerror }),
      ...(weaponData.movingaccuracy !== undefined && { movingAccuracy: weaponData.movingaccuracy }),
      ...(weaponData.accuracy !== undefined && { accuracy: weaponData.accuracy }),
      ...(Object.keys(armorDamage).length > 0 && { armorDamage }),
      dps: damage / reload * (weaponData.burst || 1)
    });
  }

  return weapons;
}

/**
 * Determine unit type from file path
 */
function detectUnitType(filePath, unitData) {
  if (unitData.commander || UNIT_TYPE_PATTERNS.Commander.test(filePath)) {
    return 'Commander';
  }

  for (const [type, pattern] of Object.entries(UNIT_TYPE_PATTERNS)) {
    if (pattern.test(filePath)) {
      return type;
    }
  }

  return 'Building';
}

/**
 * Determine tier from:
 *   1. customparams.techlevel  — authoritative in-game value (1/2/3)
 *   2. File path / unit name   — fallback heuristic
 *
 * Experimental units can be named T1 in data but have "Experimental" in their
 * name; those are promoted to T3 by the name check even if techlevel = 1.
 */
function detectTier(filePath, unitData, techLevel) {
  const pathLower = filePath.toLowerCase();
  const idLower   = (unitData.unitname || '').toLowerCase();

  // customparams.techlevel is the authoritative source when present
  if (techLevel >= 3) return 'T3';
  if (techLevel >= 2) return 'T2';

  // Path / name heuristics (catches Experimental factories labelled techlevel=1)
  if (T3_PATTERNS.test(pathLower) || T3_PATTERNS.test(idLower)) return 'T3';
  if (T2_PATTERNS.test(pathLower) || T2_PATTERNS.test(idLower)) return 'T2';

  return 'T1';
}

/**
 * Determine movement mode from unit data
 */
function detectMovementMode(unitData) {
  if (!unitData.speed || unitData.speed === 0) return 'Static';
  if (unitData.canfly) return 'Flying';
  if (unitData.canhover) return 'Hovering';
  if (unitData.floater || unitData.waterline) return 'Sailing';

  const moveClass = (unitData.movementclass || '').toLowerCase();
  if (moveClass.includes('boat') || moveClass.includes('ship')) return 'Sailing';
  if (moveClass.includes('hover')) return 'Hovering';
  if (moveClass.includes('bot') || moveClass.includes('kbot')) return 'Walking';
  if (moveClass.includes('tank') || moveClass.includes('veh')) return 'Driving';

  return 'Walking';
}

/**
 * Parse a single Lua unit file
 */
function parseUnitFile(content, filePath, faction) {
  const unitIdMatch = content.match(/return\s*\{\s*(\w+)\s*=/);
  const unitId = unitIdMatch ? unitIdMatch[1] : basename(filePath).replace('.lua', '');

  const data = parseSimpleTable(content);
  const weapons = parseWeapons(content);
  const name = data.name || unitId.replace(/^(arm|cor|leg)/, '').replace(/_/g, ' ');

  // Parse customparams early — needed for tier detection
  const unitCustomParamsContent = extractTable(content, 'customparams');
  const unitCustomParams = unitCustomParamsContent ? parseSimpleTable(unitCustomParamsContent) : {};

  // customparams.techlevel is the authoritative in-game tier value
  const techLevel = parseInt(unitCustomParams.techlevel) || 1;

  const unitType = detectUnitType(filePath, data);
  const tier = detectTier(filePath, data, techLevel);
  const movementMode = detectMovementMode(data);

  const isMine = unitCustomParams.mine === true ||
    unitCustomParams.mine === 1 ||
    String(unitCustomParams.mine).toLowerCase() === 'true';
  const detonateRange = parseFloat(unitCustomParams.detonaterange) || undefined;
  const isSuicide = unitCustomParams.instantselfd === true || unitCustomParams.instantselfd === 1 || String(unitCustomParams.instantselfd).toLowerCase() === 'true';
  const isKamikaze = data.kamikaze === true || data.kamikaze === 1;
  const kamikazeDist = parseFloat(data.kamikazedistance) || undefined;
  const stealth = data.stealth === true || data.stealth === 1;

  return {
    id: unitId.toLowerCase(),
    name: name,
    description: data.description,
    faction: faction,
    tier: tier,
    unitType: unitType,

    metalCost: data.metalcost || data.buildcostmetal || 0,
    energyCost: data.energycost || data.buildcostenergy || 0,
    buildTime: data.buildtime || data.buildcostmetal || 0,

    health: data.maxdamage || data.health || 0,
    weapons: weapons,

    movementMode: movementMode,
    speed: data.speed || data.maxvelocity || 0,
    turnRate: data.turnrate,
    acceleration: data.acceleration,

    sightRange: data.sightdistance || data.losemitheight || 0,
    radarRange: data.radardistance || 0,
    sonarRange: data.sonardistance || 0,
    jammerRange: data.radardistancejam || 0,

    canCloak: !!data.cancloack || !!data.cloakcost,
    cloakCost: data.cloakcost,
    cloakCostMoving: data.cloakcostmoving,

    buildPower: data.workertime || 0,
    buildRange: data.builddistance,
    canBuild: parseBuildOptions(content),

    // extractsmetal * 1800 gives M/s on a full metal spot (0.001 → 1.8, 0.004 → 7.2, etc.)
    metalProduction: data.metalmake || (data.extractsmetal ? data.extractsmetal * 1800 : 0),
    // energymake is direct production; energyuse < 0 means production; energyupkeep < 0 also means production (e.g. solar)
    energyProduction: data.energymake
      || (data.energyuse < 0 ? -data.energyuse : 0)
      || (data.energyupkeep < 0 ? -data.energyupkeep : 0),
    energyUpkeep: Math.max(0, data.energyupkeep || 0),
    metalStorage: data.metalstorage || 0,
    energyStorage: data.energystorage || 0,

    // Energy-to-metal conversion (customparams.energyconv_*)
    ...(unitCustomParams.energyconv_capacity && {
      energyConverterCapacity: parseFloat(unitCustomParams.energyconv_capacity),
      energyConverterEfficiency: parseFloat(unitCustomParams.energyconv_efficiency),
    }),

    // customparams.iscommander is the authoritative flag in BAR; data.commander is a legacy fallback
    isCommander: !!unitCustomParams.iscommander || !!data.commander,
    isMorph: MORPH_UNIT_PATTERNS.test(unitId),
    transportCapacity: data.transportcapacity,

    ...(isKamikaze && { isKamikaze: true }),
    ...(kamikazeDist && { kamikazeDist }),
    ...(isMine && { isMine: true }),
    ...(detonateRange && { detonateRange }),
    ...(isSuicide && { isSuicide: true }),
    ...(stealth && { stealth: true }),
    // Flanking bonus (BAR per-unit customization via flankingbonusmode + params)
    ...(data.flankingbonusmax !== undefined && { flankingBonusMax: data.flankingbonusmax }),
    ...(data.flankingbonusmin !== undefined && { flankingBonusMin: data.flankingbonusmin }),
    ...(data.flankingbonusmobilityadd !== undefined && { flankingBonusMobilityAdd: data.flankingbonusmobilityadd }),

    // Aircraft behavior: hoverattack = true means VTOL/gunship (can hover while attacking).
    // Fixed-wing bombers/fighters don't have hoverattack and must maintain forward speed.
    ...(data.hoverattack && { hoverAttack: true }),

    footprint: data.footprintx ? { x: data.footprintx, z: data.footprintz } : undefined,
  };
}

/**
 * Fetch unit names from BAR language file
 */
async function loadLanguageData(isLocal, localPath) {
  try {
    console.log('\nLoading unit names and descriptions from language file...');
    let data;
    if (isLocal) {
      const filePath = join(localPath, 'language/en/units.json');
      data = JSON.parse(readFileSync(filePath, 'utf-8'));
    } else {
      const response = await fetch(LANGUAGE_FILE);
      if (!response.ok) {
        console.warn('Could not fetch language file, using fallback names');
        return null;
      }
      data = await response.json();
    }
    const names = data.units.names || {};
    const descriptions = data.units.descriptions || {};
    console.log(`  Loaded ${Object.keys(names).length} unit names, ${Object.keys(descriptions).length} descriptions`);
    return { names, descriptions };
  } catch (error) {
    console.warn(`Could not load language file: ${error.message}`);
    return null;
  }
}

/**
 * Apply proper names and descriptions from language file to units
 */
function applyUnitNames(units, langData) {
  if (!langData) return units;
  const { names, descriptions } = langData;

  let updated = 0;
  for (const unit of units) {
    if (names[unit.id]) {
      unit.name = names[unit.id];
      updated++;
    } else {
      // Fallback: clean up the ID as a name
      unit.name = unit.id
        .replace(/^(arm|cor|leg)/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
    }
    if (descriptions[unit.id]) {
      unit.description = descriptions[unit.id];
    }
  }
  console.log(`  Applied names to ${updated} units`);
  return units;
}

/**
 * Save output (with partial data handling)
 */
function saveOutput(units, partial = false) {
  units.sort((a, b) => {
    if (a.faction !== b.faction) return a.faction.localeCompare(b.faction);
    if (a.tier !== b.tier) return a.tier.localeCompare(b.tier);
    return a.name.localeCompare(b.name);
  });

  const output = {
    version: new Date().toISOString().split('T')[0],
    generatedAt: new Date().toISOString(),
    source: 'https://github.com/beyond-all-reason/Beyond-All-Reason',
    partial: partial,
    units: units
  };

  const outputDir = dirname(OUTPUT_PATH);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  return OUTPUT_PATH;
}

/**
 * Process files from remote GitHub
 */
async function processRemote() {
  const allUnits = [];

  for (const [faction, folders] of Object.entries(FACTION_FOLDERS)) {
    if (rateLimited) break;

    console.log(`\nProcessing ${faction}...`);

    for (const folder of folders) {
      if (rateLimited) break;

      console.log(`  Scanning ${folder}...`);

      const luaFiles = await findLuaFilesRemote(folder);
      if (rateLimited && luaFiles.length === 0) break;

      console.log(`    Found ${luaFiles.length} Lua files`);

      for (const file of luaFiles) {
        try {
          const content = await fetchRaw(file.downloadUrl);
          const unit = parseUnitFile(content, file.path, faction);

          if (unit && unit.health > 0) {
            allUnits.push(unit);
            process.stdout.write('.');
          }
        } catch (error) {
          console.warn(`\n    Warning: Failed to parse ${file.name}: ${error.message}`);
        }

        await new Promise(r => setTimeout(r, 50));
      }

      console.log('');
    }

    // Process root-level individual files (commanders, assist drones, etc.)
    if (!rateLimited) {
      const rootFiles = FACTION_ROOT_FILES[faction] || [];
      if (rootFiles.length > 0) {
        console.log(`  Processing ${rootFiles.length} root-level files...`);
        for (const relPath of rootFiles) {
          if (rateLimited) break;
          try {
            const downloadUrl = `${GITHUB_RAW}/${relPath}`;
            const content = await fetchRaw(downloadUrl);
            const unit = parseUnitFile(content, relPath, faction);
            if (unit && unit.health > 0) {
              allUnits.push(unit);
              process.stdout.write('.');
            }
          } catch (error) {
            console.warn(`\n    Warning: Failed to parse ${relPath}: ${error.message}`);
          }
          await new Promise(r => setTimeout(r, 50));
        }
        console.log('');
      }
    }
  }

  return allUnits;
}

/**
 * Process files from local clone
 */
function processLocal(basePath) {
  const allUnits = [];

  for (const [faction, folders] of Object.entries(FACTION_FOLDERS)) {
    console.log(`\nProcessing ${faction}...`);

    for (const folder of folders) {
      console.log(`  Scanning ${folder}...`);

      const luaFiles = findLuaFilesLocal(basePath, folder);
      console.log(`    Found ${luaFiles.length} Lua files`);

      for (const file of luaFiles) {
        try {
          const content = readFileSync(file.localPath, 'utf-8');
          const unit = parseUnitFile(content, file.path, faction);

          if (unit && unit.health > 0) {
            allUnits.push(unit);
            process.stdout.write('.');
          }
        } catch (error) {
          console.warn(`\n    Warning: Failed to parse ${file.name}: ${error.message}`);
        }
      }

      console.log('');
    }

    // Process root-level individual files (commanders, assist drones, etc.)
    const rootFiles = FACTION_ROOT_FILES[faction] || [];
    if (rootFiles.length > 0) {
      console.log(`  Processing ${rootFiles.length} root-level files...`);
      for (const relPath of rootFiles) {
        const fullPath = join(basePath, relPath);
        if (!existsSync(fullPath)) {
          console.warn(`    Warning: Root file not found: ${relPath}`);
          continue;
        }
        try {
          const content = readFileSync(fullPath, 'utf-8');
          const unit = parseUnitFile(content, relPath, faction);
          if (unit && unit.health > 0) {
            allUnits.push(unit);
            process.stdout.write('.');
          }
        } catch (error) {
          console.warn(`\n    Warning: Failed to parse ${basename(relPath)}: ${error.message}`);
        }
      }
      console.log('');
    }
  }

  return allUnits;
}

/**
 * Main function
 */
async function main() {
  console.log('BAR Unit Data Parser');
  console.log('====================\n');

  const args = process.argv.slice(2);
  const localIndex = args.indexOf('--local');
  const isLocal = localIndex !== -1;
  const localPath = isLocal ? args[localIndex + 1] : null;

  if (isLocal && !localPath) {
    console.error('Error: --local requires a path to BAR repository');
    console.error('Usage: node parse.js --local /path/to/Beyond-All-Reason');
    process.exit(1);
  }

  if (isLocal) {
    console.log(`Mode: Local (${localPath})`);
  } else {
    console.log('Mode: Remote (GitHub)');
    if (GITHUB_TOKEN) {
      console.log('Using GitHub token for authentication');
    } else {
      console.log('No GITHUB_TOKEN set - rate limit is 60 requests/hour');
      console.log('Tip: Set GITHUB_TOKEN for 5000 requests/hour\n');
    }
  }

  let allUnits;

  if (isLocal) {
    allUnits = processLocal(localPath);
  } else {
    allUnits = await processRemote();
  }

  // Load and apply proper unit names and descriptions
  const langData = await loadLanguageData(isLocal, localPath);
  applyUnitNames(allUnits, langData);

  const outputPath = saveOutput(allUnits, rateLimited);

  console.log('\n====================');
  console.log(`Parsed ${allUnits.length} units total`);
  console.log(`  Armada: ${allUnits.filter(u => u.faction === 'Armada').length}`);
  console.log(`  Cortex: ${allUnits.filter(u => u.faction === 'Cortex').length}`);
  console.log(`  Legion: ${allUnits.filter(u => u.faction === 'Legion').length}`);

  if (rateLimited) {
    console.log('\nWARNING: Data is incomplete due to rate limiting.');
    console.log('Options:');
    console.log('  1. Wait and run again later');
    console.log('  2. Set GITHUB_TOKEN environment variable');
    console.log('  3. Clone repo and use --local flag:');
    console.log('     git clone https://github.com/beyond-all-reason/Beyond-All-Reason.git');
    console.log('     node parse.js --local ./Beyond-All-Reason');
  }

  console.log(`\nOutput written to: ${outputPath}`);
}

main().catch(console.error);
