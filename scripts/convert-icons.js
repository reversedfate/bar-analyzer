#!/usr/bin/env node
/**
 * Convert BAR unit DDS icons to PNG for browser display.
 * Usage: node scripts/convert-icons.js [path/to/Beyond-All-Reason]
 *
 * Reads:  <BAR>/unitpics/*.dds
 * Writes: public/unitpics/*.png  (72×72px, resized from the original DDS)
 */

import { createRequire } from 'module'
import { existsSync, mkdirSync, readdirSync } from 'fs'
import { join, basename } from 'path'

const require = createRequire(import.meta.url)
const sharp = require('sharp')

const OUTPUT_SIZE = 72
const OUTPUT_DIR = 'public/unitpics'

const barPath = process.argv[2] || '/c/Users/rever/git/Beyond-All-Reason'
const inputDir = join(barPath, 'unitpics')

if (!existsSync(inputDir)) {
  console.error(`Could not find unitpics at: ${inputDir}`)
  console.error('Usage: node scripts/convert-icons.js /path/to/Beyond-All-Reason')
  process.exit(1)
}

mkdirSync(OUTPUT_DIR, { recursive: true })

const files = readdirSync(inputDir).filter(f => f.toLowerCase().endsWith('.dds'))
console.log(`Converting ${files.length} DDS icons to ${OUTPUT_DIR}/...`)

let ok = 0
let fail = 0

for (const file of files) {
  const srcPath = join(inputDir, file)
  const destName = basename(file, '.dds') + '.png'
  const destPath = join(OUTPUT_DIR, destName)

  try {
    await sharp(srcPath)
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(destPath)
    ok++
  } catch (err) {
    // DDS format variants — skip ones sharp can't decode
    fail++
    if (fail <= 5) console.warn(`  Skip ${file}: ${err.message}`)
  }
}

console.log(`Done: ${ok} converted, ${fail} skipped`)
