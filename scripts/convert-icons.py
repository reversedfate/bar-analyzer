#!/usr/bin/env python
"""
Convert BAR unit DDS icons to PNG for browser display.
Usage: python scripts/convert-icons.py [path\\to\\Beyond-All-Reason]

Reads:  <BAR>\\unitpics\\*.dds
Writes: public\\unitpics\\*.png  (72x72px, scaled from original DDS)
"""

import sys
import os
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Pillow not found. Install with: python -m pip install Pillow")
    sys.exit(1)

OUTPUT_SIZE = 72
SCRIPT_DIR = Path(__file__).parent
OUTPUT_DIR = SCRIPT_DIR.parent / "public" / "unitpics"

BAR_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(r"C:\Users\rever\git\Beyond-All-Reason")
INPUT_DIR = BAR_PATH / "unitpics"

if not INPUT_DIR.exists():
    print(f"Could not find unitpics at: {INPUT_DIR}")
    print("Usage: python scripts/convert-icons.py C:\\path\\to\\Beyond-All-Reason")
    sys.exit(1)

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

dds_files = list(INPUT_DIR.glob("*.dds"))
print(f"Converting {len(dds_files)} DDS icons to {OUTPUT_DIR}...")

ok = 0
fail = 0
converted_ids = []

for src in dds_files:
    dest = OUTPUT_DIR / (src.stem + ".png")
    try:
        img = Image.open(src).convert("RGBA")
        img = img.resize((OUTPUT_SIZE, OUTPUT_SIZE), Image.LANCZOS)
        img.save(dest, "PNG", optimize=True)
        converted_ids.append(src.stem)
        ok += 1
    except Exception as e:
        fail += 1
        if fail <= 5:
            print(f"  Skip {src.name}: {e}")

# Write manifest so the app can skip 404s entirely
import json
manifest_data = json.dumps(sorted(converted_ids))
# Write to public/ (for reference) and to src/ (for compile-time import)
(OUTPUT_DIR / "manifest.json").write_text(manifest_data)
src_manifest = SCRIPT_DIR.parent / "src" / "assets" / "data" / "icon-manifest.json"
src_manifest.write_text(manifest_data)
print(f"Done: {ok} converted, {fail} skipped — manifest written")
