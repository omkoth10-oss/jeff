"""Scatters the forest, the cherry trees and the rocks, and marks the river rapids.

Run inside Blender after build_terrain.py and build_village.py (it reads the terrain
definition and public/data/village.json):
    exec(open(os.path.expanduser("~/moonlit-village/blender/scripts/build_vegetation.py")).read())

Writes:
  public/data/forest.bin   every tree: uint32 count, then int16 x[n] (dm), int16 z[n] (dm),
                           int16 y[n] (1/20 m), uint8 type[n], uint8 scale[n], uint8 rot[n]
                           types: 0 Fir_A, 1 Fir_B, 2 Sakura, 3 Pine_1, 4 Pine_2, 5 Pine_3,
                           6 Broadleaf (made from the Sakura model in the web app)
  public/data/rocks.json   rocks [type, x, y, z, rotY, scale, tiltX, tiltZ], foam spots on the
                           river [x, z, radius, flowAngle], big-rock colliders [x, y, z, r] and
                           trunk colliders [x, y, z, r] for trees inside the walkable area
The forest is dense on every hill, ridge and cliff top; steep faces, water, paths and
buildings are kept clear, and the village gets sparse cherry and pine trees.
"""
import os, sys, json, math, importlib, time
import numpy as np

sys.path.insert(0, os.path.expanduser("~/moonlit-village/blender/scripts"))
import terrain_lib as T
importlib.reload(T)
ROOT = os.path.expanduser("~/moonlit-village")
RNG = np.random.default_rng(7)
t0 = time.time()
FIR_A, FIR_B, SAKURA, PINE1, PINE2, PINE3, BROADLEAF = range(7)

village = json.load(open(os.path.join(ROOT, "public", "data", "village.json")))
T._PROFILES = None
T.height(np.array([0.0]), np.array([0.0]))


def jittered(r0, r1, spacing, theta_max=180.0):
    n = int(r1 / spacing) + 1
    g = (np.arange(-n, n + 1) * spacing)
    X, Z = np.meshgrid(g, g)
    X = X + RNG.uniform(-0.45, 0.45, X.shape) * spacing
    Z = Z + RNG.uniform(-0.45, 0.45, Z.shape) * spacing
    x, z = X.ravel(), Z.ravel()
    r = np.hypot(x, z)
    th = np.degrees(np.arctan2(x, -z))
    keep = (r >= r0) & (r < r1) & (np.abs(th) <= theta_max)
    return x[keep], z[keep]


def slope(x, z, h, e=1.5):
    hx, _ = T.height(x + e, z)
    hz, _ = T.height(x, z + e)
    return np.hypot(hx - h, hz - h) / e


def quad_mask(x, z, cx, cz, w, d, rot, pad):
    """True where (x, z) lies inside a rotated w x d rectangle grown by pad."""
    dx, dz = x - cx, z - cz
    c, s = math.cos(rot), math.sin(rot)
    u = dx * c - dz * s
    v = dx * s + dz * c
    return (np.abs(u) < w / 2 + pad) & (np.abs(v) < d / 2 + pad)


def keepout(x, z):
    """Where nothing may grow: paths, buildings, landmarks, the ledge."""
    out = np.zeros(x.shape, bool)
    for name, (pts, y, p) in T._PROFILES.items():
        d, _, _, _ = T.polyline(x, z, pts, max_dist=8)
        out |= d < p["width"] / 2 + 1.8
    for hs in village["houses"]:
        out |= quad_mask(x, z, hs["x"], hs["z"], hs["w"], hs["d"], hs["rot"], 1.0)
    for pr in village["props"]:
        out |= np.hypot(x - pr["x"], z - pr["z"]) < (9.0 if pr["type"] == "Torii" else 1.6)
    for pad in T.PADS.values():
        out |= quad_mask(x, z, pad["center"][0], pad["center"][1], pad["size"][0], pad["size"][1], math.radians(pad["angle"]), 1.5)
    (bx0, bz0), (bx1, bz1) = T.BRIDGE
    d, _, _, _ = T.polyline(x, z, [(bx0, bz0), (bx1, bz1)])
    out |= d < 6
    cx, cz = T.PAGODA_HILL["center"]
    out |= np.hypot(x - cx, z - cz) < 24
    out |= (np.hypot(x - cx, z - cz) < 50) & (RNG.random(x.shape) < 0.8)   # keep the castle hill open
    tc = T.TORII_TERRACE
    out |= np.hypot((x - tc["center"][0]) / (tc["radius"][0] + 2), (z - tc["center"][1]) / (tc["radius"][1] + 2)) < 1
    out |= np.hypot(x - 55.1, z + 76.8) < 6                          # watchtower
    out |= np.hypot(x, z) < 7                                        # the ninja's ledge
    return out


# ------------------------------------------------------------------ trees
xs, zs, sp = [], [], []
for r0, r1, spacing, th in ((0, 450, 5.2, 180), (450, 1200, 9.0, 180), (1200, 2900, 15.0, 80)):
    x, z = jittered(r0, r1, spacing, th)
    xs.append(x); zs.append(z); sp.append(np.full(x.shape, spacing))
x, z, spacing = np.concatenate(xs), np.concatenate(zs), np.concatenate(sp)
h, m = T.height(x, z)
g = slope(x, z, h)
r = np.hypot(x, z)
print(f"{len(x)} candidates  ({time.time() - t0:.1f}s)")

in_valley = T.inside_polygon(x, z, T.PLAY_AREA) & (h < 9.0)
dist_play = T.polyline(x, z, T.PLAY_AREA + [T.PLAY_AREA[0]], max_dist=120)[0]
# distance to the built-up village (houses and streets): forest fills the gaps further out
d_built = np.full(x.shape, 1e3)
for hs in village["houses"]:
    d_built = np.minimum(d_built, np.hypot(x - hs["x"], z - hs["z"]) - max(hs["w"], hs["d"]) / 2)
for k in ("left_street", "right_street"):
    d_built = np.minimum(d_built, T.polyline(x, z, T._PROFILES[k][0], max_dist=60)[0])
garden = in_valley & (d_built < 8)
p = np.ones_like(x)
p *= (m["d_water"] > 3.0) & (h > T.WATER + 0.6)
p *= T.smoothstep(np.where(r < 85, 3.6, 1.35), 0.8, g)               # none on sheer faces; the slopes below the ledge stay wooded
p *= T.smoothstep(190, 125, h)                                       # treeline below the snow
p *= 0.5 + 0.5 * T.smoothstep(0.35, 0.65, T.fbm(T.N[12], x / 90, z / 90, 3) + 0.5)   # clumps and clearings
p *= np.where(garden, 0.3, np.where(in_valley, 0.9, 1.0))             # sparse garden trees among the houses
p *= ~keepout(x, z)
keep = RNG.random(len(x)) < p
x, z, h, r, in_valley, dist_play, garden = x[keep], z[keep], h[keep], r[keep], in_valley[keep], dist_play[keep], garden[keep]
print(f"{len(x)} trees kept  ({time.time() - t0:.1f}s)")

u = RNG.random(len(x))
near_village = (~in_valley) & (dist_play < 60) & (r < 450)
# mixed forest: round-crowned broadleaf trees make up about a third of the lower slopes
# and thin out with height, where the conifers take over
broad_share = 0.36 * T.smoothstep(95, 45, h) + 0.08
types = np.where(u < broad_share, BROADLEAF, np.where(u < broad_share + (1 - broad_share) / 2, FIR_A, FIR_B))
types = np.where((u > 0.93) & (dist_play > 80), PINE1 + (RNG.integers(0, 3, len(x))), types)   # sparse pines only deep in the forest
types = np.where(near_village & (u > 0.84) & (dist_play < 40), SAKURA, types)
types = np.where(garden, np.where(u < 0.55, SAKURA, FIR_B), types)
types = np.where(in_valley & ~garden & (u > 0.9), SAKURA, types)
scale = np.where(types == SAKURA, RNG.uniform(0.8, 1.2, len(x)), RNG.uniform(0.75, 1.25, len(x)))
scale = np.where(garden & (types == FIR_B), RNG.uniform(0.5, 0.75, len(x)), scale)          # garden firs stay small
scale = np.where(r > 1200, scale * 1.2, scale)                       # far ridges: slightly bigger trees read better

# cherry trees near the camera and around the landmarks (the references are full of them)
extra = [(-12, -9), (-15, -2), (14, -12), (6, -16), (-22, -18), (70, -100), (84, -122), (62, -128), (-6, -128),
         (36, -152), (20, -170), (-30, -150), (48, -200), (95, -250), (74, -150), (-40, -120)]
ex = np.array([e[0] for e in extra], float); ez = np.array([e[1] for e in extra], float)
ok = ~keepout(ex, ez)
eh, _ = T.height(ex[ok], ez[ok])
x = np.concatenate([x, ex[ok]]); z = np.concatenate([z, ez[ok]]); h = np.concatenate([h, eh])
types = np.concatenate([types, np.full(ok.sum(), SAKURA)]); scale = np.concatenate([scale, RNG.uniform(0.9, 1.25, ok.sum())])
# keep the ledge view open: close to the camera, in front of it, only trees whose tops stay
# well below eye level (the reference frames the view with forest canopy, not trunks)
az = np.degrees(np.arctan2(x, -z))
tree_h = np.where(types == SAKURA, 7.5, np.where(types == BROADLEAF, 12.0, np.where(types >= PINE1, 12.0, 17.0))) * scale
blocks = (np.hypot(x, z) < 110) & (z < -1) & (np.abs(az) < 42) & (h + tree_h > 38)
# and the sight line to the second waterfall (it shows just left of the ninja)
wf2 = np.array(T.WATERFALL2["top"]) * 0.5 + np.array(T.WATERFALL2["foot"]) * 0.5
d_line, _, t_line, _ = T.polyline(x, z, [(1.5, 3.3), (wf2[0], wf2[2])])
seg_len = np.hypot(wf2[0] - 1.5, wf2[2] - 3.3)
sight_y = 52.3 + (wf2[1] - 52.3) * np.clip(t_line, 0, 1)      # eye to the middle of the fall
blocks |= (d_line < 14 + 0.06 * t_line * seg_len) & (t_line < 0.93) & (h + tree_h > sight_y - 4)
x, z, h, types, scale = x[~blocks], z[~blocks], h[~blocks], types[~blocks], scale[~blocks]
rot = RNG.uniform(0, 2 * math.pi, len(x))
y = h - 0.25
walk = T.inside_polygon(x, z, T.PLAY_AREA)
trunk_colliders = [[round(float(a), 2), round(float(c), 2), round(float(b_), 2), 0.35 * float(s_)] for a, b_, c, s_ in zip(x[walk], y[walk], z[walk], scale[walk])]

n = len(x)
with open(os.path.join(ROOT, "public", "data", "forest.bin"), "wb") as f:
    f.write(np.array([n], np.uint32).tobytes())
    f.write(np.round(x * 10).astype(np.int16).tobytes())
    f.write(np.round(z * 10).astype(np.int16).tobytes())
    f.write(np.round(y * 20).astype(np.int16).tobytes())
    f.write(types.astype(np.uint8).tobytes())
    f.write(np.round((scale - 0.5) / 1.2 * 255).clip(0, 255).astype(np.uint8).tobytes())
    f.write(np.round(rot / (2 * math.pi) * 255).astype(np.uint8).tobytes())
print(f"forest.bin: {n} trees ({', '.join(f'{k} {(types == i).sum()}' for i, k in enumerate(['firA', 'firB', 'sakura', 'pine1', 'pine2', 'pine3', 'broad']))})  ({time.time() - t0:.1f}s)")


# ------------------------------------------------------------------ rocks and rapids
rocks, foam, colliders = [], [], []


def add_rock(x, y, z, s, sink=0.3):
    rocks.append([int(RNG.integers(0, 7)), round(float(x), 2), round(float(y - sink * s), 2), round(float(z), 2),
                  round(float(RNG.uniform(0, 2 * math.pi)), 3), round(float(s), 2),
                  round(float(RNG.normal(0, 0.15)), 3), round(float(RNG.normal(0, 0.15)), 3)])
    if s > 1.1:
        colliders.append([round(float(x), 2), round(float(y), 2), round(float(z), 2), round(float(s * 0.9), 2)])


river = np.asarray(T.RIVER)
cum = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(river[:, :2], axis=0).T))])
(bx0, bz0), (bx1, bz1) = T.BRIDGE
bridge_mid = np.array([(bx0 + bx1) / 2, (bz0 + bz1) / 2])
for s in np.arange(0, cum[-1], 2.2):
    cx, cz, w = (np.interp(s, cum, river[:, k]) for k in range(3))
    if cz > 120:                                                     # far downstream, out of the valley
        break
    i = min(np.searchsorted(cum, s), len(river) - 1)
    t = river[i, :2] - river[max(i - 1, 0), :2]
    t = t / (np.linalg.norm(t) + 1e-9)
    nrm = np.array([-t[1], t[0]])
    if np.hypot(cx - bridge_mid[0], cz - bridge_mid[1]) < 20:
        continue
    for side in (-1, 1):                                             # rocky banks: clusters at the water line
        if RNG.random() < 0.2:
            # one big boulder with smaller ones around it, some standing in the shallows
            d0 = w / 2 + RNG.uniform(-2.2, 1.6)
            for k in range(int(RNG.integers(2, 6))):
                d = d0 + RNG.uniform(-1.4, 1.4) * (k > 0)
                along = RNG.uniform(-1.8, 1.8) * (k > 0)
                px = cx + nrm[0] * d * side + t[0] * along
                pz = cz + nrm[1] * d * side + t[1] * along
                if keepout(np.array([px]), np.array([pz]))[0]:
                    continue
                gy, _ = T.height(np.array([px]), np.array([pz]))
                sc = RNG.uniform(1.1, 2.1) if k == 0 else RNG.uniform(0.35, 1.0) ** 1.2
                add_rock(px, max(gy[0], T.WATER - 0.7), pz, sc, sink=0.35 + 0.15 * (gy[0] < T.WATER))
# rapids: clusters of boulders in the stream, with foam around them
for s in np.arange(24, cum[-1], 24) + RNG.uniform(-6, 6, len(np.arange(24, cum[-1], 24))):   # rapids every ~24 m
    cx, cz, w = (np.interp(s, cum, river[:, k]) for k in range(3))
    if cz > 60 or np.hypot(cx - bridge_mid[0], cz - bridge_mid[1]) < 25 or np.hypot(cx - 33.5, cz + 86) < 14 or np.hypot(cx - 35.5, cz + 115.5) < 16:
        continue
    i = min(np.searchsorted(cum, s), len(river) - 1)
    t = river[i, :2] - river[max(i - 1, 0), :2]
    flow = math.atan2(t[0], t[1])
    for _ in range(int(RNG.integers(4, 9))):
        off = RNG.uniform(-0.42, 0.42) * w
        along = RNG.uniform(-6, 6)
        px = cx + math.cos(flow) * off + math.sin(flow) * along
        pz = cz - math.sin(flow) * off + math.cos(flow) * along
        sc = RNG.uniform(0.7, 1.9)
        add_rock(px, T.WATER - 0.2, pz, sc, sink=0.45)
        foam.append([round(px, 2), round(pz, 2), round(sc * 1.6, 2), round(flow, 3)])
# around the waterfall pools
for wf, n_r, rad in ((T.WATERFALL1, 14, 11), (T.WATERFALL2, 7, 5)):
    fx, fy, fz = wf["foot"]
    for k in range(n_r):
        a = RNG.uniform(-math.pi * 0.9, math.pi * 0.9)
        px, pz = fx + math.sin(a) * rad * RNG.uniform(0.7, 1.1), fz + math.cos(a) * rad * RNG.uniform(0.7, 1.1)
        gy, _ = T.height(np.array([px]), np.array([pz]))
        add_rock(px, max(gy[0], fy - 0.3), pz, RNG.uniform(0.8, 2.0))
    foam.append([fx, fz, rad * 0.9, 0.0])
# rocks along the waterfall-2 stream
for sx, sz, _w in T.STREAM2:
    for _ in range(2):
        px, pz = sx + RNG.uniform(-4, 4), sz + RNG.uniform(-4, 4)
        gy, _ = T.height(np.array([px]), np.array([pz]))
        add_rock(px, gy[0], pz, RNG.uniform(0.5, 1.2))
# scattered rocks on the forest slopes and cliff feet near the valley
x, z = jittered(12, 420, 13.0)
h, m = T.height(x, z)
g = slope(x, z, h)
p = 0.22 * T.smoothstep(0.35, 1.0, g) + 0.04
p *= (m["d_water"] > 2) & ~keepout(x, z)
sel = RNG.random(len(x)) < p
for px, pz, py in zip(x[sel], z[sel], h[sel]):
    add_rock(px, py, pz, RNG.uniform(0.6, 2.4) ** 1.2)
# the ninja's ledge: big boulders forming the outcrop in the reference's lower left
for px, pz, sc, rt in ((-3.2, -3.6, 3.4, 0.4), (-6.5, 0.5, 3.0, 1.9), (3.2, -2.2, 2.2, 3.0), (-1.0, 4.8, 2.6, 5.0), (-9.0, -6.0, 3.6, 2.4)):
    gy, _ = T.height(np.array([px]), np.array([pz]))
    rocks.append([6 if sc > 3 else 3, px, round(float(gy[0]) - 0.55 * sc, 2), pz, rt, sc, 0.08, -0.05])

json.dump(dict(rocks=rocks, foam=foam, colliders=colliders, trunks=trunk_colliders), open(os.path.join(ROOT, "public", "data", "rocks.json"), "w"), separators=(",", ":"))
print(f"rocks {len(rocks)}, foam {len(foam)}, rock colliders {len(colliders)}  ({time.time() - t0:.1f}s)")
