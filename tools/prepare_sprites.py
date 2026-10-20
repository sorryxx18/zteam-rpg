#!/usr/bin/env python3
"""Prepare confirmed artwork without redrawing. Requires Pillow; run from any cwd."""
from pathlib import Path
from collections import deque
import argparse
import hashlib
import json
import shutil
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    'male': 'img_4e0b0d610cce.jpg',
    'female': 'img_df3425b545fc.jpg',
    'rhino': 'img_0f2107881272.jpg',
}
CELL = (64, 80)
FOOT = 76  # Last occupied pixel, inclusive.
HEIGHT = 70
DIRECTIONS = ['down', 'left', 'right', 'up']


def extract(im):
    """Flood only exterior near-neutral white; keep enclosed silver highlights.

    Foreground connected components, rather than equal grid rectangles, find
    characters even when their row bounds cross the nominal grid boundaries.
    Small disconnected JPEG specks are discarded, not artwork recolored.
    """
    w, h = im.size
    rgb = list(im.getdata())
    white = bytearray(min(p) >= 200 and max(p)-min(p) <= 38 for p in rgb)
    exterior = bytearray(w*h)
    queue = deque()
    for x in range(w):
        for i in (x, (h-1)*w+x):
            if white[i] and not exterior[i]:
                exterior[i] = 1
                queue.append(i)
    for y in range(h):
        for i in (y*w, y*w+w-1):
            if white[i] and not exterior[i]:
                exterior[i] = 1
                queue.append(i)
    def neighbors(i):
        x = i % w
        if x: yield i-1
        if x < w-1: yield i+1
        if i >= w: yield i-w
        if i < w*(h-1): yield i+w
    while queue:
        i = queue.popleft()
        for j in neighbors(i):
            if white[j] and not exterior[j]:
                exterior[j] = 1
                queue.append(j)
    # JPEG ringing can bridge almost-touching rows (male center, rows 3/4).
    # Projection valleys with NO dark artwork are safe one-pixel separators.
    seams = []
    for row in range(1, 4):
        nominal = round(h * row / 4)
        candidates = range(max(1, nominal-50), min(h-1, nominal+51))
        seam = min(candidates, key=lambda y: (sum(min(rgb[y*w+x]) < 150 for x in range(w)), abs(y-nominal)))
        if not any(min(rgb[seam*w+x]) < 150 for x in range(w)):
            exterior[seam*w:(seam+1)*w] = bytes([1])*w
            seams.append(seam)
    visited = bytearray(exterior)
    components = []
    for start in range(w*h):
        if visited[start]: continue
        visited[start] = 1
        queue.append(start)
        component = []
        while queue:
            i = queue.popleft()
            component.append(i)
            for j in neighbors(i):
                if not visited[j]:
                    visited[j] = 1
                    queue.append(j)
        if len(component) > 2000:
            xs = [i % w for i in component]
            ys = [i // w for i in component]
            box = (min(xs), min(ys), max(xs)+1, max(ys)+1)
            mask = Image.new('L', (w, h))
            mask.putdata([0] * (w*h))
            mp = mask.load()
            for i in component: mp[i % w, i // w] = 255
            rgba = im.convert('RGBA')
            rgba.putalpha(mask)
            components.append((box, rgba.crop(box), len(component)))
    if len(components) != 12:
        raise ValueError(f'Expected 12 separated characters, got {len(components)}: {[c[0] for c in components]}')
    # Sort into four rows by vertical center, then three columns by x.
    components.sort(key=lambda c: (c[0][1]+c[0][3])/2)
    return [c for row in range(4) for c in sorted(components[row*3:row*3+3], key=lambda c: c[0][0])], seams


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=Path.home()/'.hermes/cache/images')
    args = parser.parse_args()
    assets = ROOT/'assets'
    originals = assets/'originals'
    originals.mkdir(parents=True, exist_ok=True)
    report = {'layout': {'columns': 3, 'rows': 4, 'cell': list(CELL), 'row_order': DIRECTIONS,
                         'foot_y_inclusive': FOOT, 'height': HEIGHT, 'resampling': 'NEAREST'},
              'background': {'method': 'border flood fill, then foreground connected components',
                             'near_white_min_channel': 200, 'max_channel_spread': 38,
                             'alpha_values': [0, 255], 'enclosed_highlights_preserved': True},
              'characters': {}}
    sheets = []
    for name, filename in SOURCES.items():
        src = args.source_dir/filename
        original = originals/f'{name}.jpg'
        if original.exists():
            if original.read_bytes() != src.read_bytes():
                raise ValueError(f'Refusing to overwrite differing original: {original}')
        else:
            shutil.copy2(src, original)
        digest = hashlib.sha256(original.read_bytes()).hexdigest()
        with Image.open(original) as opened:
            im = opened.convert('RGB')
        parts, seams = extract(im)
        sheet = Image.new('RGBA', (192, 320))
        frames = []
        for row in range(4):
            for col in range(3):
                source_index, mirror = row*3+col, False
                note = 'original pose'
                if name in ('male', 'rhino') and row in (1, 2) and col == 2:
                    source_index = (2 if row == 1 else 1)*3
                    mirror = True
                    note = 'Mirror opposite-facing row first step; conservative repeat, not a newly drawn alternate gait.'
                box, sprite, area = parts[source_index]
                if mirror: sprite = sprite.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                new_w = round(sprite.width * HEIGHT / sprite.height)
                assert new_w <= 60, (name, row, col, new_w)
                sprite = sprite.resize((new_w, HEIGHT), Image.Resampling.NEAREST)
                x, y = (CELL[0]-new_w)//2, FOOT+1-HEIGHT
                tile = Image.new('RGBA', CELL)
                tile.paste(sprite, (x, y))
                bbox = tile.getchannel('A').getbbox()
                assert bbox and bbox[3]-1 == FOOT and bbox[3]-bbox[1] == HEIGHT
                assert set(tile.getchannel('A').getdata()) <= {0, 255}
                sheet.paste(tile, (col*64, row*80))
                frames.append({'row': row, 'column': col, 'direction': DIRECTIONS[row],
                               'source_row': source_index//3, 'source_column': source_index%3,
                               'mirror_x': mirror, 'source_bbox': list(box),
                               'source_component_pixels': area, 'alpha_bbox': list(bbox),
                               'foot_y': bbox[3]-1, 'note': note})
        output = assets/f'{name}.png'
        sheet.save(output)
        with Image.open(output) as checked:
            assert checked.size == (192, 320) and checked.mode == 'RGBA'
            for row in range(4):
                for col in range(3):
                    assert checked.crop((col*64, row*80, col*64+64, row*80+80)).getchannel('A').getbbox()
        report['characters'][name] = {'original': str(original), 'original_sha256': digest,
                                      'original_size': list(im.size), 'output': str(output),
                                      'output_size': list(sheet.size), 'frames': frames,
                                      'projection_separator_rows': seams,
                                      'detected_original_bboxes': [list(c[0]) for c in parts]}
        sheets.append((name, sheet))
    # 3x enlargement with checkerboard exposes white halos/holes; red baseline
    # is immediately BELOW occupied foot pixel, not painted over the artwork.
    preview = Image.new('RGB', (3*192*3, 320*3+48), '#222b36')
    draw = ImageDraw.Draw(preview)
    for k, (name, sheet) in enumerate(sheets):
        ox = k*576
        draw.text((ox+12, 12), f'{name} / down-left-right-up / 3 frames', fill='white')
        for y in range(48, preview.height, 12):
            for x in range(ox, ox+576, 12):
                draw.rectangle((x,y,x+11,y+11), fill='#9babb5' if ((x-ox)//12+(y-48)//12)%2 else '#657783')
        preview.paste(sheet.resize((576, 960), Image.Resampling.NEAREST), (ox,48), sheet.getchannel('A').resize((576,960), Image.Resampling.NEAREST))
        for r in range(4):
            yy = 48+(r*80+77)*3
            draw.line((ox, yy, ox+575, yy), fill='#d96262', width=1)
        for c in range(4): draw.line((ox+c*192,48,ox+c*192,1007), fill='#303a46')
    preview.save(assets/'contact-sheet.png')
    report_path = ROOT/'tools/sprite-report.json'
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'sheets': {k: {'size': v['output_size'], 'nonempty_frames': len(v['frames']),
                                    'foot_y': sorted(set(f['foot_y'] for f in v['frames'])),
                                    'width_range': [min(f['alpha_bbox'][2]-f['alpha_bbox'][0] for f in v['frames']), max(f['alpha_bbox'][2]-f['alpha_bbox'][0] for f in v['frames'])]}
                                for k,v in report['characters'].items()},
                      'contact_sheet': str(assets/'contact-sheet.png'), 'report': str(report_path)}, indent=2))

if __name__ == '__main__':
    main()
