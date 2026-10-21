#!/usr/bin/env python3
"""Local JSON conversion; never fetches or writes publicdata.
Examples:
  python3 tools/convert_game_data.py --input local.json --kind sites --output /tmp/sites.json
  python3 tools/convert_game_data.py --demo --data-dir data --sites-output data/sites.json --water-output data/water.json
Coordinates match zteam-3d2/build.py lines 6-8 (the source of data/base.json):
LAT0=25.0355, LON0=121.5630; x east, y north, metres; rounded to 0.1m.
Only public landmarks and clearly fictional exercise labels are generated in demo mode.
"""
import argparse
import json
import math
from pathlib import Path

LAT0, LON0 = 25.0355, 121.5630
KX, KY = math.cos(math.radians(LAT0)) * 111320, 110540
KINDS = ('hydrant_above', 'hydrant_under')


def number(value):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
        raise ValueError('座標必須為有限數字')
    return value


def convert(rows, kind):
    if not isinstance(rows, list) or not rows:
        raise ValueError('場所／水源清單不可空白')
    out = []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get('n'), str) or not row['n'].strip():
            raise ValueError('缺少有效名稱 n')
        if 'x' in row or 'y' in row:
            x, y = number(row.get('x')), number(row.get('y'))
        else:
            lon, lat = number(row.get('lon')), number(row.get('lat'))
            if not -180 <= lon <= 180 or not -90 <= lat <= 90:
                raise ValueError('經緯度超出範圍')
            x, y = round((lon-LON0)*KX, 1), round((lat-LAT0)*KY, 1)
        if kind == 'sites':
            if not isinstance(row.get('addr'), str) or not row['addr'].strip():
                raise ValueError('場所缺少 addr')
            out.append(dict(n=row['n'], addr=row['addr'], x=x, y=y))
        else:
            if row.get('k') not in KINDS:
                raise ValueError('未知水源類型 k')
            out.append(dict(k=row['k'], n=row['n'], x=x, y=y))
    return out


def write(path, rows):
    path = Path(path).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, ensure_ascii=False, allow_nan=False, indent=2)+'\n')
    print(f'{len(rows)} 筆 → {path}')


def inside(x, y, poly):
    yes = False
    j = len(poly)-2
    for i in range(0, len(poly), 2):
        ax, ay, bx, by = poly[i], poly[i+1], poly[j], poly[j+1]
        if (ay > y) != (by > y) and x < (bx-ax)*(y-ay)/(by-ay)+ax:
            yes = not yes
        j = i
    return yes


def demo(data):
    base = json.loads((data/'base.json').read_text())
    cells = [json.loads((data/'c'/f'{key}.json').read_text()) for key in base['cells']]
    roads = [r for c in cells for r in c['roads']]
    polygons = [b['p'] for c in cells for b in c['builds']]
    boxes = [(min(p[::2]), min(p[1::2]), max(p[::2]), max(p[1::2]), p) for p in polygons]
    vertices, adjacency = set(), {}
    key = lambda p: (round(p[0]*2), round(p[1]*2))
    for r in roads:
        pts = list(zip(r['p'][::2], r['p'][1::2]))
        vertices.update(pts)
        for a, b in zip(pts, pts[1:]):
            adjacency.setdefault(key(a), set()).add(key(b))
            adjacency.setdefault(key(b), set()).add(key(a))
    sites, water = [], []
    # Widely separated public station landmarks; no actual incident or water assets.
    for station in [base['stations'][i] for i in (0, 3, 6)]:
        x, y = station['bx'], station['by']
        name = station['name']
        sites.append(dict(n=f'演練／虛構：{name}周邊集合點', addr=f'演練／虛構地址（公開地標：{name}；非真實案件）', x=x, y=y))
        anchor = min(vertices, key=lambda p: math.hypot(p[0]-station['x'], p[1]-station['y']))
        connected, stack = {key(anchor)}, [key(anchor)]
        while stack:
            for nxt in adjacency.get(stack.pop(), ()):
                if nxt not in connected:
                    connected.add(nxt)
                    stack.append(nxt)
        candidates = sorted((p for p in vertices if 40 <= math.hypot(p[0]-x, p[1]-y) <= 470 and key(p) in connected), key=lambda p: (math.atan2(p[1]-y, p[0]-x), math.hypot(p[0]-x, p[1]-y)))
        valid = [p for p in candidates if not any(ax <= p[0] <= bx and ay <= p[1] <= by and inside(*p, poly) for ax, ay, bx, by, poly in boxes)]
        if len(valid) < 15:
            raise ValueError(f'{name}可用道路頂點不足')
        selected = [valid[i*len(valid)//15] for i in range(15)]
        for i, (wx, wy) in enumerate(selected):
            water.append(dict(k=KINDS[i%len(KINDS)], n=f'演練／虛構水源：{name}-{i+1:02}', x=wx, y=wy))
    return sites, water


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path)
    parser.add_argument('--kind', choices=('sites', 'water'))
    parser.add_argument('--output', type=Path)
    parser.add_argument('--demo', action='store_true')
    parser.add_argument('--data-dir', type=Path)
    parser.add_argument('--sites-output', type=Path)
    parser.add_argument('--water-output', type=Path)
    args = parser.parse_args()
    try:
        if args.demo:
            if not all((args.data_dir, args.sites_output, args.water_output)):
                parser.error('--demo 必須明確指定 --data-dir、--sites-output、--water-output')
            sites, water = demo(args.data_dir)
            write(args.sites_output, sites)
            write(args.water_output, water)
        else:
            if not all((args.input, args.kind, args.output)):
                parser.error('必須明確指定 --input、--kind、--output')
            write(args.output, convert(json.loads(args.input.read_text()), args.kind))
    except (ValueError, OSError, KeyError, TypeError) as exc:
        parser.error(str(exc))


if __name__ == '__main__':
    main()
