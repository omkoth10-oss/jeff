"""Builds the village: house types (detailed + simple level of detail), landmarks and
props, places houses along the streets, and exports:

  models/houses.glb      House_<type>_LOD0 / _LOD1 prototypes, instanced in three.js
  models/landmarks.glb   bridge, pagoda, shrine, watchtower, walls, stairs, boat (in place)
  models/props.glb       Torii, StreetLantern, StoneLantern prototypes, instanced
  models/village_collision.glb
                         Blockers: boxes for every building, wall and prop the player
                                   can't walk through
                         Walkable: bridge deck and other surfaces to stand on
  data/village.json      placements of houses and props

Run inside Blender after build_terrain.py:
    exec(open(os.path.expanduser("~/moonlit-village/blender/scripts/build_village.py")).read())
Sizes are for a 1.7 m person: 1.95 m doorways, 2.9-3 m storeys, 0.45-0.6 m raised floors.
"""
import bpy, os, sys, importlib, json, math, time
import numpy as np

SCRIPTS = os.path.expanduser("~/moonlit-village/blender/scripts")
ROOT = os.path.expanduser("~/moonlit-village")
sys.path.insert(0, SCRIPTS)
import terrain_lib as T
import arch_lib as A
importlib.reload(T)
importlib.reload(A)
t0 = time.time()
RNG = np.random.default_rng(21)
OUT = os.path.join(ROOT, "public", "models")


def ground(x, z):
    h, _ = T.height(np.atleast_1d(np.asarray(x, float)), np.atleast_1d(np.asarray(z, float)))
    return h


# ============================================================ house types
# Each type comes in a few variants (sizes, storeys, roof heights, wall finishes) so
# the village doesn't repeat. HOUSES maps "<type>_<n>" to: the footprint used for
# spacing (w along the street, d deep, including roof overhang), local collider boxes
# (cx, cy, cz, sx, sy, sz), a placement weight and builder(lod).
HOUSES = {}


def register(kind, n, w, d, colliders, weight, build):
    HOUSES[f"{kind}_{n}"] = dict(build=build, w=w, d=d, colliders=colliders, weight=weight, kind=kind)


def simple_box(b, w, d, y0, h, front_emit=True, layer=A.WOOD, tint=A.DARK_WOOD, shoji_rows=((0.3, 0.85),)):
    """LOD1 walls: one box, with lit shoji bands drawn on the front."""
    b.box((0, y0 + h / 2, 0), (w, h, d), layer, tint, skip=("bottom", "top"))
    if front_emit:
        for a, c in shoji_rows:
            b.poly([(-w / 2 + 0.3, y0 + h * a, d / 2 + 0.02), (w / 2 - 0.3, y0 + h * a, d / 2 + 0.02),
                    (w / 2 - 0.3, y0 + h * c, d / 2 + 0.02), (-w / 2 + 0.3, y0 + h * c, d / 2 + 0.02)], A.SHOJI, A.WHITE, 1.0)


def make_minka(n, w, d, h, rise, front, sides, roof, weight, fl=0.6):
    """Single-storey house with a veranda, hip or hip-and-gable roof."""
    ex, ez = w / 2 + 1.3, d / 2 + 1.3

    def build(lod):
        b = A.Builder()
        A.plinth(b, w, d, fl)
        if lod == 0:
            A.framed_walls(b, w, d, fl, h, front=front, sides=sides, back="wood", doors=[("front", 0.0, 1.8)])
            A.veranda(b, w + 0.4, 1.1, fl, d / 2)
            if roof == "irimoya":
                A.irimoya_roof(b, ex, ez, fl + h + 0.15, rise)
            else:
                A.hip_roof(b, ex, ez, fl + h + 0.15, rise, (w - d) / 2 + 1.0, 0.45)
            for x in (-w * 0.3, w * 0.3):
                A.hanging_lantern(b, (x, fl + h - 0.15, d / 2 + 0.9))
        else:
            simple_box(b, w, d, fl, h)
            b.box((0, fl - 0.05, d / 2 + 0.55), (w + 0.4, 0.1, 1.1), A.WOOD, A.PALE_WOOD, skip=("bottom",))
            A.hip_roof(b, ex, ez, fl + h + 0.15, rise, (w - d) / 2 + 1.0, 0.45, nu=3, nv=2, underside=False)
        return b
    register("minka", n, w + 2.8, d + 3.0, [(0, (fl + h) / 2 + 0.4, 0, w + 0.2, fl + h + 0.8, d + 0.2), (0, 0.3, d / 2 + 0.55, w + 0.6, 0.6, 1.1)], weight, build)


def make_machiya(n, w, d, h1, h2, upper, rise, gable, weight, fl=0.45):
    """Townhouse: shoji shopfront under a lean-to roof, optional upper storey, gable
    roof with the ridge along the street."""
    top = fl + h1 + h2

    def build(lod):
        b = A.Builder()
        A.plinth(b, w, d, fl)
        if lod == 0:
            A.framed_walls(b, w, d, fl, h1, front="shoji", sides="wood", back="wood", doors=[("front", -w * 0.22, 1.6)])
            if h2:
                A.framed_walls(b, w, d, fl + h1, h2, front=upper, sides="wood", back="wood", post_every=1.6)
            lean_to(b, w + 0.4, d / 2, fl + h1 + 0.35, 1.5, 0.55)
            A.gable_roof(b, w / 2 + 0.6, d / 2 + 1.0, top + 0.1, rise, gable_half=w / 2,
                         gable_layer=A.PLASTER if gable == "plaster" else A.WOOD, gable_tint=A.PLASTER_T if gable == "plaster" else A.DARK_WOOD)
            A.hanging_lantern(b, (-w * 0.22, fl + h1 - 0.05, d / 2 + 1.1), (1.0, 0.35, 0.22))
            banner(b, (w * 0.29, fl + h1 - 0.1, d / 2 + 1.2), color=[(0.5, 0.12, 0.12), (0.12, 0.14, 0.35), (0.18, 0.1, 0.25)][n % 3])
        else:
            simple_box(b, w, d, fl, h1 + h2, shoji_rows=((0.08, 0.5), (0.66, 0.9)) if h2 else ((0.12, 0.85),))
            A.gable_roof(b, w / 2 + 0.6, d / 2 + 1.0, top + 0.1, rise, nu=3, nv=2, gable_half=w / 2, underside=False)
        return b
    register("machiya", n, w + 1.3, d + 2.2, [(0, top / 2 + 0.3, 0, w + 0.2, top + 0.6, d + 0.2)], weight, build)


def make_inn(n, w, d, w2, d2, rise, weight, fl=0.5, h1=3.0, h2=2.7):
    """Large two-storey inn: skirt roof over the ground floor, balcony and irimoya roof
    above, shoji all round (the brightest buildings in the village reference)."""
    def build(lod):
        b = A.Builder()
        A.plinth(b, w, d, fl)
        if lod == 0:
            A.framed_walls(b, w, d, fl, h1, front="shoji", sides="shoji", back="wood", doors=[("front", 0.0, 2.0)])
            skirt_roof(b, w / 2 + 1.2, d / 2 + 1.2, fl + h1 + 0.1, w2 / 2, d2 / 2)
            A.framed_walls(b, w2, d2, fl + h1 + 0.9, h2, front="shoji", sides="shoji", back="shoji", post_every=1.5)
            balcony(b, w2 + 1.4, d2 / 2, fl + h1 + 0.9, 1.0)
            A.irimoya_roof(b, w2 / 2 + 1.4, d2 / 2 + 1.4, fl + h1 + 0.9 + h2 + 0.15, rise)
            for x in np.linspace(-w * 0.38, w * 0.38, 4):
                A.hanging_lantern(b, (x, fl + h1 - 0.1, d / 2 + 0.95))
        else:
            simple_box(b, w, d, fl, h1, shoji_rows=((0.12, 0.85),))
            A.hip_roof(b, w / 2 + 1.2, d / 2 + 1.2, fl + h1 + 0.1, 1.2, 2.0, 0.3, nu=3, nv=1, underside=False)
            simple_box(b, w2, d2, fl + h1 + 0.9, h2, shoji_rows=((0.1, 0.85),))
            A.hip_roof(b, w2 / 2 + 1.4, d2 / 2 + 1.4, fl + h1 + 0.9 + h2 + 0.15, rise, 2.0, 0.45, nu=3, nv=2, underside=False)
        return b
    register("inn", n, w + 2.6, d + 3.0, [(0, 3.4, 0, w + 0.2, 6.8, d + 0.2)], weight, build)


def make_small(n, w, d, h, rise, roof, sides, weight, fl=0.45):
    """Small one-room house."""
    def build(lod):
        b = A.Builder()
        A.plinth(b, w, d, fl)
        if lod == 0:
            A.framed_walls(b, w, d, fl, h, front="shoji", sides=sides, back="window", doors=[("front", w * 0.25, 1.6)])
            if roof == "gable":
                A.gable_roof(b, w / 2 + 0.8, d / 2 + 1.0, fl + h + 0.1, rise, gable_half=w / 2)
            else:
                A.hip_roof(b, w / 2 + 1.1, d / 2 + 1.1, fl + h + 0.1, rise, (w - d) / 2 + 0.6, 0.3)
            A.hanging_lantern(b, (w * 0.25, fl + h - 0.1, d / 2 + 0.8))
        else:
            simple_box(b, w, d, fl, h)
            if roof == "gable":
                A.gable_roof(b, w / 2 + 0.8, d / 2 + 1.0, fl + h + 0.1, rise, nu=3, nv=2, gable_half=w / 2, underside=False)
            else:
                A.hip_roof(b, w / 2 + 1.1, d / 2 + 1.1, fl + h + 0.1, rise, (w - d) / 2 + 0.6, 0.3, nu=3, nv=2, underside=False)
        return b
    register("small", n, w + 2.4, d + 2.4, [(0, (fl + h) / 2 + 0.3, 0, w + 0.2, fl + h + 0.6, d + 0.2)], weight, build)


def make_kura(n, weight):
    """Storehouse: plaster over a dark wood-panelled lower half, stone base, gable roof."""
    w, d, fl, h = 5.0, 6.0, 0.8, 3.6

    def build(lod):
        b = A.Builder()
        A.plinth(b, w, d, fl, overhang=0.15)
        b.box((0, fl + h / 2, 0), (w, h, d), A.PLASTER, A.PLASTER_T, skip=("bottom", "top") if lod else ("bottom",))
        b.box((0, fl + 0.9, 0), (w + 0.06, 1.8, d + 0.06), A.WOOD, A.DARK_WOOD, skip=("bottom", "top"))
        if lod == 0:
            b.poly([(-0.5, fl + 2.4, d / 2 + 0.04), (0.5, fl + 2.4, d / 2 + 0.04), (0.5, fl + 3.1, d / 2 + 0.04), (-0.5, fl + 3.1, d / 2 + 0.04)], A.SHOJI, A.WHITE, 0.8)
            A.gable_roof(b, w / 2 + 0.7, d / 2 + 0.8, fl + h + 0.05, 2.2, upturn=0.12, gable_half=w / 2)
        else:
            A.gable_roof(b, w / 2 + 0.7, d / 2 + 0.8, fl + h + 0.05, 2.2, upturn=0.12, nu=3, nv=1, gable_half=w / 2, underside=False)
        return b
    register("kura", n, w + 1.8, d + 1.8, [(0, 2.4, 0, w + 0.2, 4.8, d + 0.2)], weight, build)


def make_stilt(n, w=8.0, d=6.0, h=2.8, rise=2.9, fl=1.9):
    """Riverside house on posts over the water, veranda on three sides."""

    def build(lod):
        b = A.Builder()
        if lod == 0:
            for x in np.linspace(-w / 2 - 0.9, w / 2 + 0.9, 5):
                for z in np.linspace(-d / 2, d / 2 + 0.9, 4):
                    b.box((x, fl / 2 - 1.5, z), (0.24, fl + 3.0, 0.24), A.WOOD, A.POST_WOOD)
            b.box((0, fl - 0.1, 0.45), (w + 2.0, 0.2, d + 0.9), A.WOOD, A.PALE_WOOD)
            A.framed_walls(b, w, d, fl, h, front="shoji", sides="shoji", back="wood")
            railing(b, w + 2.0, d + 0.9, fl, (0, 0.45))
            A.hip_roof(b, w / 2 + 1.4, d / 2 + 1.4, fl + h + 0.1, rise, (w - d) / 2 + 0.6, 0.35)
            for x in (-w * 0.32, w * 0.32):
                A.hanging_lantern(b, (x, fl + h - 0.1, d / 2 + 1.0))
        else:
            b.box((0, fl / 2 - 1.5, 0), (w + 1.6, fl + 3.0, d), A.WOOD, A.POST_WOOD, skip=("top", "bottom"))
            simple_box(b, w, d, fl, h)
            A.hip_roof(b, w / 2 + 1.4, d / 2 + 1.4, fl + h + 0.1, rise, (w - d) / 2 + 0.6, 0.35, nu=3, nv=2, underside=False)
        return b
    register("stilt", n, w + 2.4, d + 2.6, [(0, 3.0, 0, w + 0.6, 4.0, d + 0.6)], 0, build)


make_minka(0, 9.0, 7.0, 2.9, 3.6, "shoji", "window", "irimoya", 1.2)
make_minka(1, 10.5, 7.8, 3.1, 4.4, "shoji", "wood", "irimoya", 1.0)
make_minka(2, 8.0, 6.6, 2.8, 3.0, "window", "window", "hip", 1.0)
make_machiya(0, 6.5, 10.0, 3.0, 2.5, "window", 2.7, "wood", 1.3)
make_machiya(1, 7.5, 11.0, 3.2, 2.8, "window", 3.4, "plaster", 1.0)
make_machiya(2, 5.6, 9.0, 3.0, 0.0, None, 2.4, "wood", 1.0)
make_machiya(3, 8.0, 10.0, 3.0, 2.6, "shoji", 3.0, "wood", 1.0)
make_inn(0, 12.0, 9.0, 9.0, 6.6, 3.3, 1.0)
make_inn(1, 14.0, 10.0, 10.5, 7.4, 4.0, 0.8)
make_small(0, 6.0, 5.0, 2.7, 2.6, "hip", "wood", 1.2)
make_small(1, 5.5, 5.0, 2.6, 2.2, "gable", "window", 1.0)
make_small(2, 7.0, 5.6, 2.9, 3.1, "hip", "window", 1.0)
make_kura(0, 0.6)
STILT_FLOOR = 1.9
make_stilt(0)
make_stilt(1, w=10.0, d=6.5, h=3.0, rise=3.4)
make_stilt(2, w=6.5, d=5.5, h=2.6, rise=2.6)


# ------------------------------------------------------------ small parts
def lean_to(b, w, z_wall, y_top, depth, drop):
    """Single-slope tiled roof along the front wall (hisashi)."""
    x0, x1 = -w / 2, w / 2
    top = [(x0, y_top, z_wall), (x1, y_top, z_wall)]
    low = [(x0, y_top - drop, z_wall + depth), (x1, y_top - drop, z_wall + depth)]
    b.poly([low[0], low[1], top[1], top[0]], A.ROOF, A.TILE)
    t = 0.15
    b.poly([top[0], top[1], (x1, y_top - drop - t, z_wall + depth), (x0, y_top - drop - t, z_wall + depth)][::-1], A.WOOD, A.DARK_WOOD)
    b.poly([(x0, y_top - drop, z_wall + depth), (x0, y_top - drop - t, z_wall + depth), (x1, y_top - drop - t, z_wall + depth), (x1, y_top - drop, z_wall + depth)][::-1], A.WOOD, A.DARK_WOOD)
    for x in (x0 + 0.1, x1 - 0.1):
        b.poly([(x, y_top, z_wall), (x, y_top - drop, z_wall + depth), (x, y_top - drop - t, z_wall + depth), (x, y_top - t, z_wall)], A.WOOD, A.DARK_WOOD)


def skirt_roof(b, ex, ez, eave_y, ix, iz, rise=1.3):
    """Mokoshi: a ring of roof around the upper storey (hip roof cut at the upper walls)."""
    cut = min(1.0 - ix / ex, 1.0 - iz / ez) + 0.08
    A.hip_roof(b, ex, ez, eave_y, rise / max(cut, 0.1) ** 1.45, max(ex - ez, 0.5), 0.35, cut=min(cut, 0.95))


def balcony(b, w, z_front, y, depth):
    b.box((0, y - 0.08, z_front + depth / 2), (w, 0.16, depth), A.WOOD, A.PALE_WOOD)
    railing(b, w, depth * 2, y, (0, z_front - depth + depth), sides=("front",))


def railing(b, w, d, y, center=(0, 0), sides=("front", "left", "right"), h=0.85, tint=A.POST_WOOD):
    cx, cz = center
    edges = {"front": ((cx - w / 2, cz + d / 2), (cx + w / 2, cz + d / 2)),
             "back": ((cx + w / 2, cz - d / 2), (cx - w / 2, cz - d / 2)),
             "left": ((cx - w / 2, cz - d / 2), (cx - w / 2, cz + d / 2)),
             "right": ((cx + w / 2, cz + d / 2), (cx + w / 2, cz - d / 2))}
    for s in sides:
        (ax, az), (bx, bz) = edges[s]
        L = math.hypot(bx - ax, bz - az)
        n = max(1, int(L / 1.5))
        for k in range(n + 1):
            t = k / n
            b.box((ax + (bx - ax) * t, y + h / 2, az + (bz - az) * t), (0.1, h, 0.1), A.WOOD, tint)
        b.beam((ax, y + h, az), (bx, y + h, bz), 0.1, 0.08, A.WOOD, tint)
        b.beam((ax, y + h * 0.45, az), (bx, y + h * 0.45, bz), 0.06, 0.05, A.WOOD, tint)


def banner(b, pos, h=1.6, w=0.5, color=(0.5, 0.12, 0.12)):
    x, y, z = pos
    b.beam((x - 0.35, y, z), (x + 0.35, y, z), 0.05, 0.05, A.WOOD, A.BLACK_LACQUER)
    b.poly([(x - w / 2, y - h, z), (x + w / 2, y - h, z), (x + w / 2, y, z), (x - w / 2, y, z)], A.SHOJI, color, 0.25)
    b.poly([(x + w / 2, y - h, z), (x - w / 2, y - h, z), (x - w / 2, y, z), (x + w / 2, y, z)], A.SHOJI, color, 0.25)


# ============================================================ props (instanced)
def torii(scale=1.0):
    """Myojin torii: vermilion pillars, black-topped curved kasagi, nuki tie beam."""
    b = A.Builder()
    span, h = 4.6, 5.2
    for sx in (-1, 1):
        b.cylinder((sx * span / 2, -0.3, 0), 0.26, h + 0.3, A.PLASTER, A.RED_LACQUER, segs=10)
        b.cylinder((sx * span / 2, -0.3, 0), 0.34, 0.75, A.STONE, (0.5, 0.5, 0.52), segs=10)   # black base (kamaki)
    b.box((0, h - 0.95, 0), (span + 1.2, 0.34, 0.34), A.PLASTER, A.RED_LACQUER)                     # nuki
    b.box((0, h - 0.5, 0), (0.3, 0.55, 0.3), A.PLASTER, A.RED_LACQUER)                              # gakuzuka
    # kasagi: gently curved, ends swept up
    xs = np.linspace(-(span / 2 + 1.35), span / 2 + 1.35, 9)
    ys = h + 0.02 + 0.28 * (np.abs(xs) / xs.max()) ** 2.5
    for i in range(len(xs) - 1):
        a = (xs[i], ys[i], 0); c = (xs[i + 1], ys[i + 1], 0)
        b.beam(a, c, 0.5, 0.32, A.PLASTER, A.RED_LACQUER)
        b.beam(np.add(a, (0, 0.27, 0)), np.add(c, (0, 0.27, 0)), 0.58, 0.2, A.WOOD, A.BLACK_LACQUER)
    return b.transform(scale=scale)


def street_lantern_proto():
    b = A.Builder()
    A.street_lantern(b, (0, 0, 0))
    return b


def stone_lantern_proto():
    b = A.Builder()
    g = (0.72, 0.72, 0.74)
    b.cylinder((0, 0, 0), 0.38, 0.16, A.STONE, g, segs=6)
    b.cylinder((0, 0.16, 0), 0.13, 0.62, A.STONE, g, segs=6)
    b.cylinder((0, 0.78, 0), 0.33, 0.12, A.STONE, g, segs=6)
    b.box((0, 1.05, 0), (0.44, 0.42, 0.44), A.SHOJI, (1.0, 0.62, 0.35), emit=1.3)
    for sx, sz in ((1, 0), (-1, 0), (0, 1), (0, -1)):                       # stone frame around the light
        b.box((sx * 0.21, 1.05, sz * 0.21), (0.06 if sx else 0.44, 0.42, 0.06 if sz else 0.44), A.STONE, g)
    b.cylinder((0, 1.26, 0), 0.5, 0.08, A.STONE, g, segs=6)
    b.cylinder((0, 1.34, 0), 0.26, 0.14, A.STONE, g, segs=6)
    b.cylinder((0, 1.48, 0), 0.08, 0.14, A.STONE, g, segs=6)
    return b


# ============================================================ landmarks (world space)
def bridge(a, c, width=3.6, arch=3.2):
    """Arched vermilion bridge from street end a to c: plank deck, railings with posts,
    and pairs of piles standing in the river."""
    b = A.Builder()
    walk = A.Builder()                 # walkable deck for collision
    (ax, az), (cx, cz) = a, c
    ya, yc = ground(ax, az)[0] + 0.05, ground(cx, cz)[0] + 0.05
    L = math.hypot(cx - ax, cz - az)
    f = np.array([(cx - ax) / L, 0, (cz - az) / L])
    s = np.array([-f[2], 0, f[0]])
    n = 24
    ts = np.linspace(0, 1, n + 1)
    pts = [np.array([ax, ya, az]) + f * L * t + [0, (yc - ya) * t + arch * math.sin(math.pi * t), 0] for t in ts]
    half = width / 2
    for i in range(n):
        p, q = pts[i], pts[i + 1]
        deck = [p - s * half, q - s * half, q + s * half, p + s * half]
        b.poly(deck[::-1] if np.cross(deck[1] - deck[0], deck[2] - deck[0])[1] < 0 else deck, A.WOOD, (0.7, 0.55, 0.45))
        walk.poly(deck[::-1] if np.cross(deck[1] - deck[0], deck[2] - deck[0])[1] < 0 else deck, A.WOOD)
        for side in (-1, 1):                                          # deck edge beams, red
            e0, e1 = p + s * side * half, q + s * side * half
            b.beam(e0 - [0, 0.18, 0], e1 - [0, 0.18, 0], 0.22, 0.36, A.PLASTER, A.RED_LACQUER)
            b.beam(e0 + [0, 1.0, 0] - s * side * 0.05, e1 + [0, 1.0, 0] - s * side * 0.05, 0.12, 0.12, A.PLASTER, A.RED_LACQUER)
            b.beam(e0 + [0, 0.55, 0] - s * side * 0.05, e1 + [0, 0.55, 0] - s * side * 0.05, 0.08, 0.08, A.PLASTER, A.RED_LACQUER)
        if i % 6 == 3:                                               # paper lanterns on the railing
            for side in (-1, 1):
                e = p + s * side * (half + 0.12)
                A.hanging_lantern(b, (e[0], e[1] + 1.55, e[2]), (1.0, 0.45, 0.25), r=0.2, h=0.36)
                b.box((e[0], e[1] + 0.85, e[2]), (0.1, 0.8, 0.1), A.WOOD, A.BLACK_LACQUER)
        if i % 3 == 0 or i == n - 1:
            for side in (-1, 1):
                for pp in ((p,) if i < n - 1 else (p, q)):
                    e = pp + s * side * (half - 0.05)
                    b.box((e[0], e[1] + 0.55, e[2]), (0.16, 1.2, 0.16), A.PLASTER, A.RED_LACQUER)
                    b.cylinder((e[0], e[1] + 1.15, e[2]), 0.1, 0.2, A.WOOD, A.BLACK_LACQUER, segs=6)   # giboshi cap
    # piles: pairs of posts with a cross beam every few metres, standing in the water
    for t in (0.2, 0.36, 0.5, 0.64, 0.8):
        p = pts[int(round(t * n))]
        for side in (-1, 1):
            e = p + s * side * (half - 0.3)
            b.box((e[0], (e[1] - 0.3 - 2.6) / 2, e[2]), (0.3, e[1] - 0.3 + 2.6, 0.3), A.PLASTER, A.RED_LACQUER)
        b.beam(p - s * half - [0, 0.5, 0], p + s * half - [0, 0.5, 0], 0.22, 0.3, A.PLASTER, A.RED_LACQUER)
    # railing colliders along both edges
    blockers = []
    for side in (-1, 1):
        for i in range(0, n, 2):
            p, q = pts[i] + s * side * half, pts[min(i + 2, n)] + s * side * half
            blockers.append(box_between(p, q, 0.2, 1.3))
    return b, walk, blockers, pts


def box_between(p, q, thickness, height):
    """Collision box (centre, size, rotation) spanning p->q on the ground."""
    c = (np.asarray(p) + np.asarray(q)) / 2
    L = float(np.hypot(q[0] - p[0], q[2] - p[2]))
    ang = math.atan2(q[0] - p[0], q[2] - p[2])
    return dict(c=[float(c[0]), float(c[1] + height / 2), float(c[2])], s=[thickness, height, L], r=ang)


def battered_base(b, cx, cz, y0, w, d, h, batter, rot, depth=3.0):
    """Ishigaki: stone walls leaning in as they rise, from below the ground up to y0 + h."""
    lo = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
    inset = h * batter
    hi = [(x - np.sign(x) * inset, z - np.sign(z) * inset) for x, z in lo]
    P = lambda xz, y: tuple(A.rotate_y(np.array([[xz[0], 0, xz[1]]]), rot)[0] + [cx, y, cz])
    for i in range(4):
        a0, a1, b0, b1 = lo[i], lo[(i + 1) % 4], hi[i], hi[(i + 1) % 4]
        b.poly([P(a1, y0 - depth), P(a0, y0 - depth), P(b0, y0 + h), P(b1, y0 + h)], A.STONE, A.STONE_T)
    b.poly([P(hi[3], y0 + h), P(hi[2], y0 + h), P(hi[1], y0 + h), P(hi[0], y0 + h)], A.STONE, (0.55, 0.55, 0.58))


def castle(cx, cz, base_y, rot):
    """Castle keep (tenshu) as broad as it is tall, like the references: a wide battered
    stone base, four storeys that step in only a little, each under deep sweeping eaves,
    rows of lit windows on every storey, gabled dormers, gilded shachihoko on the top
    ridge, a red-railed top balcony, lit side wings and corner turrets on the base, and a
    long hall at the back. Built facing +z, then turned by rot."""
    b = A.Builder()
    bw, bd, bh = 30.0, 23.0, 5.0
    battered_base(b, cx, cz, base_y, bw, bd, bh, 0.28, rot)
    t = A.Builder()                                  # local: origin on top of the base
    floors = [(21.0, 15.0, 5.0), (18.0, 12.8, 4.5), (14.6, 10.4, 4.2), (11.0, 8.4, 4.1)]
    y = 0.0
    for k, (w, d, h) in enumerate(floors):
        wall_h = h * 0.66
        A.framed_walls(t, w, d, y, wall_h, front="window", sides="window", back="window", post_every=1.6, sill=0.5, emit=1.4)
        t.box((0, y + wall_h + (h - wall_h) / 2, 0), (w * 0.97, h - wall_h, d * 0.97), A.WOOD, A.DARK_WOOD, skip=("bottom",))
        last = k == len(floors) - 1
        if not last:
            ov = 3.4 - k * 0.3                         # deep eaves: each roof reaches past the storey below
            A.hip_roof(t, w / 2 + ov, d / 2 + ov, y + h - 0.25, 2.5, max((w - d) / 2, 0.6), 1.2 - k * 0.08, nu=12, nv=4, curve=1.9)
            for sz in (1, -1):                         # dormer gables on the front and back slopes
                g = A.Builder()
                A.gable_roof(g, 2.6 - k * 0.3, 2.0, 0.0, 2.0, upturn=0.25, nu=4, nv=3, gable_half=2.0, gable_layer=A.PLASTER, gable_tint=A.PLASTER_T)
                t.add(g, rot_y=math.pi / 2, offset=(0, y + h + 0.3, sz * (d / 2 + ov * 0.42)))
            if k == 0:                                 # and on the ends of the lowest roof
                for sx in (1, -1):
                    g = A.Builder()
                    A.gable_roof(g, 2.2, 1.9, 0.0, 1.8, upturn=0.25, nu=4, nv=3, gable_half=1.9, gable_layer=A.PLASTER, gable_tint=A.PLASTER_T)
                    t.add(g, offset=(sx * (w / 2 + ov * 0.42), y + h + 0.3, 0))
        else:
            railing(t, w + 1.6, d + 1.6, y + 0.02, sides=("front", "back", "left", "right"), h=0.95, tint=A.RED_LACQUER)
            t.box((0, y - 0.05, 0), (w + 1.7, 0.12, d + 1.7), A.WOOD, A.PALE_WOOD)
            A.irimoya_roof(t, w / 2 + 2.8, d / 2 + 2.8, y + h - 0.1, 4.6, upturn=1.25, nu=12, nv=5)
            ridge_y = y + h - 0.1 + 4.6 + 0.1
            for sx in (-1, 1):                         # shachihoko: gilded fish ornaments
                x0 = sx * ((w / 2 + 2.8) * 0.45 + 0.2)
                t.box((x0, ridge_y + 0.7, 0), (0.4, 1.3, 0.55), A.PLASTER, (0.95, 0.68, 0.22))
                t.box((x0 + sx * 0.28, ridge_y + 1.4, 0), (0.5, 0.38, 0.32), A.PLASTER, (0.95, 0.68, 0.22), rot_y=0.4 * sx)
        y += h
    # lit wings either side of the keep: they make the silhouette broad, as in the reference
    for sx in (-1, 1):
        wg = A.Builder()
        A.framed_walls(wg, 7.0, 9.0, 0, 3.0, front="window", sides="window", back="wood", post_every=1.5, emit=1.3)
        A.hip_roof(wg, 5.0, 6.0, 3.1, 2.4, 0.8, 0.8, nu=8, nv=3)
        t.add(wg, offset=(sx * (bw / 2 - bh * 0.28 - 4.2), 0, -1.0))
    # corner turrets (yagura) at the front of the base, and a long hall at the back
    for sx in (-1, 1):
        tw = A.Builder()
        A.framed_walls(tw, 5.4, 5.0, 0, 2.8, front="window", sides="window", back="wood", post_every=1.8)
        A.hip_roof(tw, 3.9, 3.7, 2.9, 1.9, 0.4, 0.75, nu=6, nv=3)
        A.framed_walls(tw, 3.8, 3.6, 3.4, 2.3, front="window", sides="window", back="window", post_every=1.9)
        A.hip_roof(tw, 3.1, 3.0, 5.8, 2.0, 0.3, 0.8, nu=6, nv=3)
        t.add(tw, offset=(sx * (bw / 2 - bh * 0.28 - 3.2), 0, bd / 2 - bh * 0.28 - 3.0))
    hall = A.Builder()
    A.framed_walls(hall, 18.0, 4.6, 0, 3.0, front="window", sides="wood", back="wood", post_every=1.7)
    A.gable_roof(hall, 10.0, 3.4, 3.1, 2.2, upturn=0.35, gable_half=9.0)
    t.add(hall, offset=(0, 0, -(bd / 2 - bh * 0.28 - 2.8)))
    b.add(t, rot_y=rot, offset=(cx, base_y + bh, cz))
    for sx in (-1, 1):
        p = A.rotate_y(np.array([[sx * 8.5, 0, 9.0]]), rot)[0]
        A.hanging_lantern(b, (cx + p[0], base_y + bh + 4.2, cz + p[2]))
    blockers = [dict(c=[cx, base_y + 10, cz], s=[bw - 2, 20.0, bd - 2], r=rot)]
    return b, blockers, base_y + bh


def shrine(cx, y, cz, rot):
    """Small shrine hall on the terrace: raised floor, vermilion posts, gable roof."""
    b = A.Builder()
    w, d, fl = 5.0, 4.2, 0.9
    A.plinth(b, w, d, fl, depth=1.6)
    A.framed_walls(b, w, d, fl, 2.6, front="shoji", sides="wood", back="wood", post_every=1.25, emit=0.8)
    for x in (-w / 2, w / 2):
        b.box((x, fl + 1.3, d / 2 + 1.1), (0.22, 2.6, 0.22), A.PLASTER, A.RED_LACQUER)
    A.veranda(b, w + 0.6, 1.3, fl, d / 2, posts=False)
    A.gable_roof(b, w / 2 + 1.0, d / 2 + 1.6, fl + 2.75, 2.4, upturn=0.35, gable_half=w / 2, gable_layer=A.PLASTER, gable_tint=A.RED_LACQUER)
    A.hanging_lantern(b, (0, fl + 2.55, d / 2 + 1.2), (1.0, 0.5, 0.3))
    out = A.Builder().add(b, rot_y=rot, offset=(cx, y, cz))
    blk = [dict(c=[cx, y + 1.8, cz], s=[w + 0.4, 3.6, d + 0.4], r=rot)]
    return out, blk


def watchtower(cx, y, cz, rot=0.3):
    """Yagura: four splayed timber legs with X bracing, a railed platform with a small
    hip roof, and a ladder. Torches go on top in step 5."""
    b = A.Builder()
    H, top, foot = 9.5, 1.8, 2.6
    legs = [(sx, sz) for sx in (-1, 1) for sz in (-1, 1)]
    for sx, sz in legs:
        b.beam((sx * foot, -0.5, sz * foot), (sx * top, H, sz * top), 0.32, 0.32, A.WOOD, A.POST_WOOD)
    for k, (y0, y1) in enumerate(((0.4, 3.4), (3.4, 6.4), (6.4, H - 0.2))):
        f0, f1 = foot + (top - foot) * y0 / H, foot + (top - foot) * y1 / H
        for (ax, az), (bx, bz) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
            b.beam((ax * f0, y0, az * f0), (bx * f1, y1, bz * f1), 0.14, 0.14)
            b.beam((bx * f0, y0, bz * f0), (ax * f1, y1, az * f1), 0.14, 0.14)
            b.beam((ax * f1, y1, az * f1), (bx * f1, y1, bz * f1), 0.18, 0.18)
    b.box((0, H, 0), (top * 2 + 1.2, 0.2, top * 2 + 1.2), A.WOOD, A.PALE_WOOD)
    railing(b, top * 2 + 1.2, top * 2 + 1.2, H + 0.1, sides=("front", "back", "left", "right"), h=1.0)
    for sx, sz in legs:
        b.box((sx * (top + 0.5), H + 1.3, sz * (top + 0.5)), (0.16, 2.6, 0.16), A.WOOD, A.POST_WOOD)
    A.hip_roof(b, top + 1.4, top + 1.4, H + 2.6, 1.6, 0.25, 0.3, nu=4, nv=3)
    for k in range(int(H / 0.35)):                              # ladder rungs up one face
        yy = k * 0.35 + 0.3
        f = foot + (top - foot) * yy / H
        b.beam((-0.35, yy, f + 0.25), (0.35, yy, f + 0.25), 0.05, 0.05)
    b.beam((-0.4, 0, foot + 0.25), (-0.4, H, top + 0.25), 0.08, 0.08)
    b.beam((0.4, 0, foot + 0.25), (0.4, H, top + 0.25), 0.08, 0.08)
    out = A.Builder().add(b, rot_y=rot, offset=(cx, y, cz))
    blk = [dict(c=[cx, y + 2, cz], s=[foot * 2 + 0.4, 4, foot * 2 + 0.4], r=rot)]
    return out, blk, (cx, y + H + 2.4, cz)


def boat(cx, cz, rot):
    """Small river boat with a woven canopy and a lantern at the bow."""
    b = A.Builder()
    L, W = 6.4, 1.6
    xs = np.linspace(-L / 2, L / 2, 9)
    prof = lambda x: W / 2 * (1 - (x / (L / 2)) ** 4) ** 0.5
    for i in range(len(xs) - 1):
        x0, x1 = xs[i], xs[i + 1]
        w0, w1 = prof(x0), prof(x1)
        for sgn in (-1, 1):
            b.poly([(x0, 0.35, sgn * w0), (x1, 0.35, sgn * w1), (x1 * 0.97, -0.3, sgn * w1 * 0.6), (x0 * 0.97, -0.3, sgn * w0 * 0.6)][:: -sgn], A.WOOD, A.DARK_WOOD)
        b.poly([(x0, 0.15, -w0 * 0.9), (x1, 0.15, -w1 * 0.9), (x1, 0.15, w1 * 0.9), (x0, 0.15, w0 * 0.9)][::-1], A.WOOD, A.PALE_WOOD)
    arch = [(0, 0.35 + 1.1 * math.sin(a), 0.75 * math.cos(a)) for a in np.linspace(0, math.pi, 7)]
    for i in range(len(arch) - 1):
        p, q = np.array(arch[i]), np.array(arch[i + 1])
        b.poly([p + [-1.2, 0, 0], p + [1.2, 0, 0], q + [1.2, 0, 0], q + [-1.2, 0, 0]], A.WOOD, (0.45, 0.38, 0.28))
        b.poly([q + [-1.2, 0, 0], q + [1.2, 0, 0], p + [1.2, 0, 0], p + [-1.2, 0, 0]], A.WOOD, (0.3, 0.25, 0.2))
    b.box((L / 2 - 0.4, 0.9, 0), (0.06, 1.1, 0.06), A.WOOD, A.POST_WOOD)
    A.hanging_lantern(b, (L / 2 - 0.4, 1.45, 0), (1.0, 0.5, 0.28))
    return A.Builder().add(b, rot_y=rot, offset=(cx, 0.0, cz))


def ring_wall(cx, cz, rx, rz, top_y, segs=40, batter=0.25, depth=6.0, skip_arc=None):
    """Stone retaining wall around an ellipse from below the ground up to top_y.
    skip_arc: (angle, half_width) to leave an opening for stairs."""
    b = A.Builder()
    angs = np.linspace(0, 2 * np.pi, segs + 1)
    for i in range(segs):
        a0, a1 = angs[i], angs[i + 1]
        if skip_arc is not None:
            mid = (a0 + a1) / 2
            dd = abs((mid - skip_arc[0] + np.pi) % (2 * np.pi) - np.pi)
            if dd < skip_arc[1]:
                continue
        p0t = (cx + rx * math.sin(a0), top_y, cz + rz * math.cos(a0))
        p1t = (cx + rx * math.sin(a1), top_y, cz + rz * math.cos(a1))
        grow = lambda a: (1 + batter * depth / max(rx, rz))
        p0b = (cx + rx * grow(a0) * math.sin(a0), top_y - depth, cz + rz * grow(a0) * math.cos(a0))
        p1b = (cx + rx * grow(a1) * math.sin(a1), top_y - depth, cz + rz * grow(a1) * math.cos(a1))
        b.poly([p0b, p1b, p1t, p0t], A.STONE, A.STONE_T)
        b.poly([p0t, p1t, (cx + (rx - 0.6) * math.sin(a1), top_y, cz + (rz - 0.6) * math.cos(a1)),
                (cx + (rx - 0.6) * math.sin(a0), top_y, cz + (rz - 0.6) * math.cos(a0))], A.STONE, (0.62, 0.62, 0.64))
    return b


def stairs_for(path_name, width):
    pts, y, p = T._PROFILES[path_name]
    b = A.Builder()
    # one flight per straight segment of the control polyline
    ctrl = np.asarray(p["pts"], float)
    cum = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(ctrl, axis=0).T))])
    res = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(np.asarray(pts), axis=0).T))])
    ys = np.interp(cum, res, y)
    for i in range(len(ctrl) - 1):
        if abs(ys[i + 1] - ys[i]) < 0.3:
            b.box(((ctrl[i, 0] + ctrl[i + 1, 0]) / 2, ys[i] - 0.3, (ctrl[i, 1] + ctrl[i + 1, 1]) / 2),
                  (width, 0.62, np.hypot(*(ctrl[i + 1] - ctrl[i])) + 0.3), A.STONE, (0.78, 0.78, 0.8),
                  rot_y=math.atan2(ctrl[i + 1, 0] - ctrl[i, 0], ctrl[i + 1, 1] - ctrl[i, 1]))
        else:
            A.stone_steps(b, (ctrl[i, 0], ys[i], ctrl[i, 1]), (ctrl[i + 1, 0], ys[i + 1], ctrl[i + 1, 1]), width)
    return b


# ============================================================ placement
def rect_corners(x, z, w, d, rot):
    c = np.array([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]])
    cr, sr = math.cos(rot), math.sin(rot)
    return np.stack([x + c[:, 0] * cr + c[:, 1] * sr, z - c[:, 0] * sr + c[:, 1] * cr], -1)


def overlaps(poly_a, poly_b):
    """Separating-axis test for two convex quads."""
    for poly in (poly_a, poly_b):
        for i in range(4):
            e = poly[(i + 1) % 4] - poly[i]
            ax = np.array([-e[1], e[0]])
            pa, pb = poly_a @ ax, poly_b @ ax
            if pa.max() < pb.min() or pb.max() < pa.min():
                return False
    return True


def place_houses():
    placed = []
    keepout = []                                         # quads nothing may overlap
    for pad in (T.PADS["shop_lot"],):
        keepout.append(rect_corners(pad["center"][0], pad["center"][1], pad["size"][0] + 3, pad["size"][1] + 3, math.radians(pad["angle"])))
    (bx0, bz0), (bx1, bz1) = T.BRIDGE
    keepout.append(rect_corners((bx0 + bx1) / 2, (bz0 + bz1) / 2, 10, math.hypot(bx1 - bx0, bz1 - bz0) + 14, math.atan2(bx1 - bx0, bz1 - bz0)))
    keepout.append(rect_corners(55.1, -76.8, 9, 9, 0))                                      # watchtower
    keepout.append(rect_corners(T.TORII_TERRACE["center"][0], T.TORII_TERRACE["center"][1], 38, 30, 0))
    keepout.append(rect_corners(T.PAGODA_HILL["center"][0], T.PAGODA_HILL["center"][1], 48, 48, 0))
    path_pts = {k: np.asarray(v[0]) for k, v in T._PROFILES.items()}

    def ok(q, name):
        if any(overlaps(q, k) for k in keepout) or any(overlaps(q, p["quad"]) for p in placed):
            return False
        xs, zs = q[:, 0], q[:, 1]
        sx = np.concatenate([xs, [xs.mean()], (xs + np.roll(xs, 1)) / 2])
        sz = np.concatenate([zs, [zs.mean()], (zs + np.roll(zs, 1)) / 2])
        h, m = T.height(sx, sz)
        if name.startswith("stilt"):
            # on posts over the water: only the back of the house has to reach the bank
            if not T.inside_polygon(sx, sz, T.PLAY_AREA).all() or h.max() > 3.5 or h.max() < T.WATER + 0.8:
                return False
        # up to 4.2 m across the footprint: on slopes the stone plinth becomes a terrace wall
        elif h.min() < T.WATER + 0.4 or m["d_water"].min() < 1.0 or h.max() - h.min() > 4.2 or not T.inside_polygon(sx, sz, T.BUILD_AREA).all():
            return False
        for k, pts in path_pts.items():
            d, _, _, _ = T.polyline(sx, sz, pts, max_dist=10)
            if d.min() < T.PATHS[k]["width"] / 2 + 0.6:
                return False
        return True

    def put(name, x, z, rot):
        H = HOUSES[name]
        q = rect_corners(x, z, H["w"], H["d"], rot)
        if not ok(q, name):
            return False
        xs, zs = q[:, 0], q[:, 1]
        y = float(T.height(np.append(xs, x), np.append(zs, z))[0].max())
        if name.startswith("stilt"):                  # floor just above the bank at the back
            y = max(T.WATER, y - STILT_FLOOR + 0.35)
        placed.append(dict(type=name, x=float(x), y=y, z=float(z), rot=float(rot), quad=q))
        return True

    # buildings on the pagoda hill terraces (forced: they sit outside the walkable area)
    for pad, name, rot in (("hill_south", "inn_1", math.radians(-15)), ("hill_east", "minka_1", math.radians(-40))):
        c = T.PADS[pad]["center"]
        y = float(T.height(np.array([c[0]]), np.array([c[1]]))[0][0])
        placed.append(dict(type=name, x=c[0], y=y, z=c[1], rot=rot, quad=rect_corners(c[0], c[1], HOUSES[name]["w"], HOUSES[name]["d"], rot)))
    # the stilt house over the pond's right bank, as in the reference, facing the water
    sx, sz, srot = 35.5, -115.5, math.atan2(-1.0, 0.3)
    placed.append(dict(type="stilt_0", x=sx, y=T.WATER, z=sz, rot=srot, quad=rect_corners(sx, sz, HOUSES["stilt_0"]["w"], HOUSES["stilt_0"]["d"], srot)))
    names = [n for n in HOUSES if HOUSES[n]["weight"] > 0]
    weights = np.array([HOUSES[n]["weight"] for n in names], float)
    weights /= weights.sum()

    # riverside rows: houses on posts along both banks, facing the water (the references
    # line the river with buildings), then ordinary houses where a bank is wide enough
    stilts = [n for n in HOUSES if n.startswith("stilt")]
    small = [n for n in names if HOUSES[n]["kind"] in ("small", "minka", "machiya")]
    river = np.asarray(T.RIVER)
    rcum = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(river[:, :2], axis=0).T))])
    (bx0, bz0), (bx1, bz1) = T.BRIDGE
    bmid = np.array([(bx0 + bx1) / 2, (bz0 + bz1) / 2])
    for side in (-1, 1):
        s = RNG.uniform(0, 5)
        while s < rcum[-1]:
            cx, cz, rw = (np.interp(s, rcum, river[:, k]) for k in range(3))
            if cz > -40:
                break
            k = min(np.searchsorted(rcum, s), len(river) - 1)
            tx, tz = river[k, :2] - river[max(k - 1, 0), :2]
            tl = math.hypot(tx, tz) or 1.0
            nx, nz = -tz / tl * side, tx / tl * side             # away from the water
            if cz < -262 or np.hypot(cx - bmid[0], cz - bmid[1]) < 18 or np.hypot(cx - 33.5, cz + 86) < 10:
                s += 3.0
                continue
            name = RNG.choice(stilts)
            H = HOUSES[name]
            back = rw / 2 + H["d"] / 2 - 2.6                       # the front third stands in the water
            if put(name, cx + nx * back, cz + nz * back, math.atan2(-nx, -nz) + RNG.normal(0, 0.05)):
                s += H["w"] + RNG.uniform(0.5, 2.5)
                continue
            name = RNG.choice(small)
            H = HOUSES[name]
            back = rw / 2 + T.BANK_WIDTH * 0.35 + H["d"] / 2
            if put(name, cx + nx * back, cz + nz * back, math.atan2(-nx, -nz) + RNG.normal(0, 0.05)):
                s += H["w"] + RNG.uniform(0.5, 2.0)
            else:
                s += 2.0

    for street in ("left_street", "right_street"):
        pts = np.asarray(T._PROFILES[street][0])
        half = T.PATHS[street]["width"] / 2
        seg = np.hypot(*np.diff(pts, axis=0).T)
        cum = np.concatenate([[0], np.cumsum(seg)])
        for row in (0, 1, 2):                            # front row on the street, then rows behind
            for side in (-1, 1):
                s = RNG.uniform(0, 4)
                while s < cum[-1]:
                    name = RNG.choice(names, p=weights)
                    H = HOUSES[name]
                    x = np.interp(s, cum, pts[:, 0]); z = np.interp(s, cum, pts[:, 1])
                    k = min(np.searchsorted(cum, s), len(pts) - 1)
                    k0 = max(k - 1, 0)
                    tx, tz = pts[k, 0] - pts[k0, 0], pts[k, 1] - pts[k0, 1]
                    tl = math.hypot(tx, tz) or 1.0
                    tx, tz = tx / tl, tz / tl
                    nx, nz = -tz * side, tx * side          # away from the street
                    back = half + 1.2 + H["d"] / 2 + row * (H["d"] + 0.8 + RNG.uniform(0, 1.2))
                    hx, hz = x + nx * back, z + nz * back
                    rot = math.atan2(-nx, -nz)               # front (+z local) faces the street
                    if put(name, hx, hz, rot):
                        s += H["w"] + RNG.uniform(0.3, 1.4)
                    else:
                        s += 1.5
    # infill: fill remaining gaps in the basin, turned to face the nearest street
    streets = np.vstack([np.asarray(T._PROFILES[k][0]) for k in ("left_street", "right_street")])
    x0, x1, z0, z1 = -75, 155, -320, -20
    for _ in range(5000):
        x, z = RNG.uniform(x0, x1), RNG.uniform(z0, z1)
        k = np.argmin(np.hypot(streets[:, 0] - x, streets[:, 1] - z))
        dx, dz = streets[k, 0] - x, streets[k, 1] - z
        rot = math.atan2(dx, dz) + RNG.normal(0, 0.12)
        put(RNG.choice(names, p=weights), x, z, rot)
    return placed


# ============================================================ run
TORII_CLIFF = (-87.0, -171.0)


def build_all():
    col = bpy.data.collections.get("Village") or bpy.data.collections.new("Village")
    if col.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(col)
    for o in list(col.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    mat = bpy.data.materials.get("Arch") or bpy.data.materials.new("Arch")

    def obj(name, builder):
        clash = bpy.data.objects.get(name)
        if clash is not None:                     # names are how three.js finds the prototypes
            bpy.data.objects.remove(clash, do_unlink=True)
        me = builder.to_mesh(name)
        me.materials.append(mat)
        o = bpy.data.objects.new(name, me)
        col.objects.link(o)
        assert o.name == name, o.name
        return o

    T._PROFILES = None
    T.height(np.array([0.0]), np.array([0.0]))           # builds the path profiles
    house_objs, stats = [], {}
    for name, H in HOUSES.items():
        for lod in (0, 1):
            bld = H["build"](lod)
            stats[f"{name}{lod}"] = bld.tri_count()
            house_objs.append(obj(f"House_{name}_LOD{lod}", bld))
    print("house tris:", stats)

    prop_objs = [obj("Torii", torii()), obj("StreetLantern", street_lantern_proto()), obj("StoneLantern", stone_lantern_proto())]

    blockers, walk_builders = [], []
    lm = []
    br, walk, br_blk, deck = bridge(*T.BRIDGE)
    lm.append(obj("Bridge", br)); walk_builders.append(walk); blockers += br_blk
    pcx, pcz = T.PAGODA_HILL["center"]
    pg, pg_blk, court_y = castle(pcx, pcz, T.PAGODA_HILL["top"], math.radians(-30))
    lm.append(obj("Castle", pg)); blockers += pg_blk
    tc = T.TORII_TERRACE
    sh, sh_blk = shrine(tc["center"][0] + 4.0, tc["height"], tc["center"][1] - 3.0, math.radians(-125))
    lm.append(obj("Shrine", sh)); blockers += sh_blk
    wt, wt_blk, torch_pos = watchtower(55.1, float(ground(55.1, -76.8)[0]), -76.8)
    lm.append(obj("Watchtower", wt)); blockers += wt_blk
    lm.append(obj("Boat", boat(33.5, -86.0, math.radians(80))))
    # stair entrance angle into the terrace wall (from the terrace centre toward the stairs top)
    st = T.PATHS["terrace_stairs"]["pts"][-1]
    ang = math.atan2(st[0] - tc["center"][0], st[1] - tc["center"][1])
    lm.append(obj("TerraceWall", ring_wall(tc["center"][0], tc["center"][1], tc["radius"][0], tc["radius"][1], tc["height"], skip_arc=(ang, 0.22))))
    top = T.PATHS["pagoda_stairs"]["pts"][-1]
    ang = math.atan2(top[0] - pcx, top[1] - pcz)
    lm.append(obj("PagodaWall", ring_wall(pcx, pcz, 20.3, 20.3, T.PAGODA_HILL["top"] - 0.05, segs=48, skip_arc=(ang, 0.14), depth=5.0)))
    lm.append(obj("PagodaStairs", stairs_for("pagoda_stairs", 3.6)))
    lm.append(obj("TerraceStairs", stairs_for("terrace_stairs", 3.0)))

    houses = place_houses()
    print(f"placed {len(houses)} houses: " + ", ".join(f"{n} {sum(h['type'] == n for h in houses)}" for n in HOUSES))
    for h in houses:
        for (cx, cy, cz, sx, sy, sz) in HOUSES[h["type"]]["colliders"]:
            p = A.rotate_y(np.array([[cx, cy, cz]]), h["rot"])[0]
            blockers.append(dict(c=[h["x"] + p[0], h["y"] + p[1], h["z"] + p[2]], s=[sx, sy, sz], r=h["rot"]))

    # props: torii, lanterns
    props = []
    # on top of the escarpment beside the second waterfall, turned to face the ledge
    tx_, tz_ = TORII_CLIFF
    props.append(dict(type="Torii", x=tx_, y=float(ground(tx_, tz_)[0]), z=tz_, rot=math.radians(30), scale=1.5))
    for off in (-1, 1):
        lx, lz = tx_ + off * 3.6 * math.cos(math.radians(30)) - 1.2 * math.sin(math.radians(30)), tz_ - off * 3.6 * math.sin(math.radians(30)) - 1.2 * math.cos(math.radians(30))
        props.append(dict(type="StoneLantern", x=float(lx), y=float(ground(lx, lz)[0]), z=float(lz), rot=0.0, scale=1.0))
    tp = np.array([69.0, -113.3])
    props.append(dict(type="Torii", x=float(tp[0]), y=tc["height"], z=float(tp[1]), rot=math.radians(-55), scale=1.2))
    sp = T.PATHS["pagoda_stairs"]["pts"]
    d = np.subtract(sp[1], sp[0]); a = math.atan2(d[0], d[1])
    props.append(dict(type="Torii", x=sp[0][0] - d[0] * 0.05, y=float(ground(*sp[0])[0]), z=sp[0][1] - d[1] * 0.05, rot=a, scale=1.0))
    for street in ("left_street", "right_street"):
        pts = np.asarray(T._PROFILES[street][0]); ys = T._PROFILES[street][1]
        for i in range(6, len(pts) - 3, 13):
            tx, tz = pts[i + 1] - pts[i - 1]
            tl = math.hypot(tx, tz)
            side = 1 if (i // 13) % 2 else -1
            off = T.PATHS[street]["width"] / 2 + 0.7
            x, z = pts[i, 0] - tz / tl * off * side, pts[i, 1] + tx / tl * off * side
            q = rect_corners(x, z, 0.6, 0.6, 0)
            if any(overlaps(q, h["quad"]) for h in houses):
                continue
            props.append(dict(type="StreetLantern", x=float(x), y=float(ground(x, z)[0]), z=float(z), rot=0.0, scale=1.0))
    for (x, z) in [T.BRIDGE[0], T.BRIDGE[1]]:
        for off in (-2.8, 2.8):
            px_, pz_ = x + off * 0.2, z + off
            props.append(dict(type="StoneLantern", x=px_, y=float(ground(px_, pz_)[0]), z=pz_, rot=0.0, scale=1.0))
    for sx in (-1, 1):
        x, z = tc["center"][0] + 4.0 + sx * 3.5, tc["center"][1] + 1.0
        props.append(dict(type="StoneLantern", x=x, y=tc["height"], z=z, rot=0.0, scale=1.0))
    for p in props:
        if p["type"] != "Torii":                       # a torii is a gateway: only its pillars block
            blockers.append(dict(c=[p["x"], p["y"] + 1.0, p["z"]], s=[0.5 * p["scale"], 2.0, 0.5 * p["scale"]], r=p["rot"]))
        if p["type"] == "Torii":
            for sx in (-1, 1):
                q = A.rotate_y(np.array([[sx * 2.3 * p["scale"], 0, 0]]), p["rot"])[0]
                blockers.append(dict(c=[p["x"] + q[0], p["y"] + 2.5, p["z"] + q[2]], s=[0.7 * p["scale"], 5.0, 0.7 * p["scale"]], r=p["rot"]))

    # collision meshes: blockers as boxes, walkable surfaces
    blk = A.Builder()
    for bx in blockers:
        blk.box((0, 0, 0), bx["s"], A.WOOD)
        blk.faces[-6:] = [(A.rotate_y(f[0], bx["r"]) + bx["c"],) + f[1:] for f in blk.faces[-6:]]
    wk = A.Builder()
    for w in walk_builders:
        wk.add(w)
    ccol = bpy.data.collections.get("VillageCollision") or bpy.data.collections.new("VillageCollision")
    if ccol.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(ccol)
    for o in list(ccol.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    col_objs = []
    for name, bl in (("Blockers", blk), ("Walkable", wk)):
        me = bl.to_mesh(name)
        o = bpy.data.objects.new(name, me)
        ccol.objects.link(o)
        col_objs.append(o)

    export(house_objs, "houses.glb")
    export(prop_objs, "props.glb")
    export(lm, "landmarks.glb")
    export(col_objs, "village_collision.glb", uv=False)
    for h in houses:
        h["w"], h["d"] = HOUSES[h["type"]]["w"], HOUSES[h["type"]]["d"]
    data = dict(houses=[{k: v for k, v in h.items() if k != "quad"} for h in houses], props=props,
                torches=[list(torch_pos)], bridgeDeck=[list(map(float, p)) for p in deck],
                # solid collision boxes for the game: centre xyz, size xyz, yaw (same as Blockers mesh)
                blockers=[[round(float(v), 3) for v in (*bx["c"], *bx["s"], bx["r"])] for bx in blockers])
    with open(os.path.join(ROOT, "public", "data", "village.json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))
    lm_tris = sum(len(o.data.polygons) for o in lm)
    print(f"landmark polys {lm_tris}, blockers {len(blockers)}, props {len(props)}  ({time.time() - t0:.1f}s)")


def export(objs, fname, uv=True):
    import logging
    logging.disable(logging.INFO)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(OUT, fname)
    bpy.ops.export_scene.gltf(
        filepath=path, use_selection=True, export_apply=True, export_normals=True,
        export_vertex_color='ACTIVE' if uv else 'NONE', export_texcoords=uv,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
        export_draco_position_quantization=16, export_draco_normal_quantization=10,
        export_draco_color_quantization=8, export_draco_texcoord_quantization=14,
        export_cameras=False, export_lights=False)
    logging.disable(logging.NOTSET)
    print(fname, f"{os.path.getsize(path) / 1024:.0f} KB")


build_all()
