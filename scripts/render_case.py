#!/usr/bin/env python3
"""
Render the case STLs to a flat-shaded SVG (exploded view: lid lifted above the body). No dependencies.
Used for docs/images/case.png; convert with a headless Chromium browser, e.g.

  python scripts/render_case.py build/case.svg
  msedge --headless=new --default-background-color=00000000 --window-size=640,<svg height + 90> \
         --screenshot=docs/images/case.png file:///<abs path>/build/case.svg
"""

import math
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIGHT = (-0.3, 0.35, 0.9)


def load_stl(path):
    data = path.read_bytes()
    n = struct.unpack_from('<I', data, 80)[0]
    return [[struct.unpack_from('<3f', data, 84 + i * 50 + 12 + k * 12) for k in range(3)] for i in range(n)]


def rotation(yaw, pitch):
    cy, sy, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)

    def apply(p):
        x, y, z = p
        x, y = x * cy - y * sy, x * sy + y * cy
        y, z = y * cp - z * sp, y * sp + z * cp
        return (x, y, z)
    return apply


def render_svg(parts, yaw, pitch, width=640, margin=16):
    ll = math.sqrt(sum(c * c for c in LIGHT))
    light = tuple(c / ll for c in LIGHT)
    rot = rotation(yaw, pitch)
    polys = []
    for tris, rgb in parts:
        for tri in tris:
            (ax, ay, az), (bx, by, bz), (cx, cy, cz) = (rot(p) for p in tri)
            nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
            ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
            nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
            nl = math.sqrt(nx * nx + ny * ny + nz * nz)
            if nl == 0 or nz <= 0:   # degenerate or facing away
                continue
            shade = 0.35 + 0.65 * max(0.0, (nx * light[0] + ny * light[1] + nz * light[2]) / nl)
            colour = '#%02x%02x%02x' % tuple(min(255, int(c * shade)) for c in rgb)
            polys.append(((az + bz + cz) / 3, [(ax, -ay), (bx, -by), (cx, -cy)], colour))
    polys.sort(key=lambda p: p[0])
    xs = [x for _, pts, _ in polys for x, _ in pts]
    ys = [y for _, pts, _ in polys for _, y in pts]
    scale = (width - 2 * margin) / (max(xs) - min(xs))
    height = int((max(ys) - min(ys)) * scale + 2 * margin)
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">']
    for _, pts, colour in polys:
        d = ' '.join(f'{(x - min(xs)) * scale + margin:.1f},{(y - min(ys)) * scale + margin:.1f}' for x, y in pts)
        out.append(f'<polygon points="{d}" fill="{colour}" stroke="{colour}" stroke-width="0.6" stroke-linejoin="round"/>')
    out.append('</svg>')
    return '\n'.join(out), height


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    out = Path(argv[0]) if argv else ROOT / 'build' / 'case.svg'
    body = load_stl(ROOT / 'case' / 'tracker_case_body.stl')
    lid = load_stl(ROOT / 'case' / 'tracker_case_lid.stl')
    # the lid is stored upside down (print orientation): rotate it 180 deg about x and lift it over the body opening
    lid = [[(x + 1.85, -y + 1.6, 11.8 + 9.0 + (5.2 - z)) for x, y, z in tri] for tri in lid]
    svg, height = render_svg([(body, (95, 150, 230)), (lid, (250, 170, 70))], math.radians(-35), math.radians(-55))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(svg)
    print(f'wrote {out} (640 x {height})')


if __name__ == '__main__':
    main()
