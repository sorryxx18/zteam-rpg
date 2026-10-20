#!/usr/bin/env python3
"""Build a lightweight area view using the published, unchanged street geometry."""
from pathlib import Path
import json

root = Path(__file__).resolve().parents[1] / 'data'
base = json.loads((root / 'base.json').read_text())
roads = {}
for key in base['cells']:
    for road in json.loads((root / 'c' / f'{key}.json').read_text()).get('roads', []):
        if len(road['p']) < 4:
            continue
        item = {'p': road['p'], 'w': road['w'], 'n': road.get('n', '')}
        signature = json.dumps(item, ensure_ascii=False, separators=(',', ':'))
        roads[signature] = item
out = {'roads': list(roads.values()), 'stations': base['stations']}
path = root / 'overview.json'
path.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
print(f'{len(roads)} unchanged road lines; {path.stat().st_size} bytes')
