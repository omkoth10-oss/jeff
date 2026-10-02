"""Shared terrain definition for the moonlit valley.

All coordinates here are three.js world space: x right, y up, z toward the camera
(the ledge camera looks down -z). Blender meshes are built with (x, -z, y).
Landmark positions were measured from the main reference with
tools/scripts/refToWorld.mjs; the far skyline was fitted with fit_skyline.py.

The valley is meant to be walked: the village basin sits just above the river, the
banks are gentle, and streets, a switchback trail down from the ledge and stairs up
to the pagoda are cut into the ground so a player can follow them.
"""
import numpy as np

WATER = 0.0          # river and pond water level
BED = -1.8           # river bed in the middle of the channel
BANK = 1.2           # ground at the top of the gentle river banks
FLOOR = 1.2          # village basin ground at the bank (rises slowly away from the river)
BANK_WIDTH = 9.0     # horizontal width of the bank slope above the water line

# ---------------------------------------------------------------- layout
# River control points, downstream order: (x, z, water width). Smoothed into a curve.
RIVER_CTRL = [(-24, -283, 26), (-23, -266, 18), (-17, -250, 16), (-12, -232, 16), (-16, -214, 17),
              (-9, -197, 17), (-3, -180, 18), (6, -163, 20), (14, -146, 22), (19, -131, 26),
              (22, -117, 30), (26, -103, 30), (28, -89, 27), (29, -76, 24), (27, -62, 22),
              (29, -46, 22), (35, -28, 22), (46, -9, 22), (60, 12, 22), (73, 40, 23), (83, 76, 24),
              (92, 120, 24), (99, 180, 25), (104, 260, 25), (106, 360, 25), (107, 480, 25), (108, 720, 25)]
# River above waterfall 1, on the plateau: (x, z, width) and water level rising upstream.
UPPER = [(-25, -286, 9), (-27, -305, 10), (-33, -340, 11), (-46, -390, 12), (-66, -450, 12),
         (-95, -520, 12), (-130, -600, 12), (-170, -700, 12)]
UPPER_LEVEL = [33, 33.4, 34.2, 35.5, 37, 39, 41, 44]

WATERFALL1 = dict(top=(-25.0, 33.0, -287.5), foot=(-24.0, 0.0, -279.0), width_top=13.0, width_foot=16.0)
# The second waterfall drops from a notch in the high escarpment left of the valley,
# placed so it shows just left of the ninja from the ledge camera (as in the reference).
# The plunge pool sits far enough out that its hollow doesn't cut into the lip.
# It falls out of the cliff turned partly toward the ledge, so the sheet is seen broad-on.
WATERFALL2 = dict(top=(-89.5, 42.0, -150.0), foot=(-77.8, 10.4, -143.2), width_top=7.0, width_foot=10.0)
# Stream from the waterfall 2 pool down to the river: (x, z, width), water level falling.
STREAM2 = [(-77.8, -143.5, 9), (-68, -152, 5), (-58, -163, 5), (-46, -175, 5), (-33, -187, 5), (-20, -198, 6), (-10, -205, 8)]
STREAM2_LEVEL = [10.4, 8.6, 6.4, 4.2, 2.4, 1.0, 0.0]

# Back-left cliff wall with both waterfalls: (x, z, crest height, face width). Plateau lies
# north-west. Left of the main waterfall it rises into a high escarpment whose wide faces
# are stepped (two rock bands with a wooded ledge between, see wall()); the second
# waterfall leaves it through a narrow, sheer section.
WEST_WALL = [(60, -330, 24, 70), (5, -300, 28, 38), (-18, -290, 33, 7), (-25, -287, 34, 6),
             (-38, -272, 37, 8), (-52, -245, 42, 13), (-68, -207, 47, 18), (-82, -168, 48, 17),
             (-89, -150, 46, 7), (-95, -130, 48, 17), (-112, -100, 48, 20), (-140, -82, 48, 22),
             (-190, -72, 50, 22), (-300, -60, 52, 24)]
# Ledge plateau behind the ninja: (x, z, crest, face width). Its long north face is the
# forested slope the trail zigzags down; the east face drops steeply to the river.
FG_EDGE = [(-300, 40, 56, 60), (-150, 20, 54, 70), (-80, 5, 52, 76), (-40, -4, 51, 84),
           (-18, -8, 50, 80), (-8, -8, 49.5, 46), (-2, -4, 49.5, 14), (1.2, 0, 49.5, 10),
           (2.5, 6, 49.5, 14), (6, 30, 50, 24), (22, 80, 52, 28), (30, 150, 55, 30), (40, 260, 58, 34), (48, 400, 62, 36)]
# Eastern slopes rise to the east of this line: (x, z, foot height).
EAST_EDGE = [(140, -500, 6), (118, -380, 5), (104, -320, 4), (96, -262, 3), (88, -215, 2.5),
             (84, -175, 2.5), (86, -140, 2.5), (84, -112, 3), (74, -84, 3), (64, -58, 4), (60, -32, 5),
             (68, 0, 6), (90, 35, 6), (114, 75, 6), (132, 130, 6), (146, 220, 7), (152, 330, 8), (160, 500, 8)]

PAGODA_HILL = dict(center=(118.0, -290.0), top=29.0, flat_radius=20.0, radius=64.0)
TORII_TERRACE = dict(center=(74.0, -114.0), radius=(16.0, 12.0), height=8.5)

# Walkable routes: (x, z) points, width, and either "auto" heights (the smoothed ground)
# or explicit heights per point (trails and stairs are cut and filled to follow them).
PATHS = {
    # switchback trail from the ninja's ledge down the forested slope to the village
    "ledge_trail": dict(width=2.6, kind="trail", heights="graded", pts=[
        (-1, 2), (-10, 4), (-22, 1), (-32, -9), (-16, -16), (-6, -24), (-22, -31), (-38, -37),
        (-24, -46), (-10, -52), (-26, -60), (-40, -66), (-30, -76), (-22, -88), (-16, -104)]),
    "left_street": dict(width=4.5, kind="street", heights="auto", pts=[
        (-16, -104), (-10, -120), (-6, -132), (-1.5, -139.5), (-12, -156), (-22, -172), (-28, -190),
        (-32, -208), (-34, -226), (-36, -246), (-38, -266)]),
    "right_street": dict(width=4.5, kind="street", heights="auto", pts=[
        (48, -46), (51, -62), (52, -80), (50, -97), (46, -113), (39, -130), (31.5, -142.5),
        (36, -165), (43, -188), (49, -210), (54, -226), (66, -233), (78, -238)]),
    "pagoda_stairs": dict(width=4.0, kind="stairs", heights=[None, 14.5, 14.5, 28.8], pts=[
        (78, -238), (90, -254), (93, -257), (106, -275)]),
    "terrace_stairs": dict(width=3.5, kind="stairs", heights=[1.4, 8.5], pts=[(51, -99), (61, -106)]),
    "pagoda_court": dict(width=5.0, kind="street", heights=[28.8, 29.0, 29.0], pts=[(106, -275), (111, -281), (118, -290)]),
}
# The red bridge spans between these two street ends (from the reference).
BRIDGE = ((-1.5, -139.5), (31.5, -142.5))
# Flat building pads. The shop lot by the bridge is reserved for an enterable shop.
PADS = {
    "shop_lot": dict(center=(-18.0, -134.0), size=(13.0, 11.0), angle=20.0),
    # terraces cut into the pagoda hill for the buildings below the pagoda
    "hill_south": dict(center=(124.0, -258.0), size=(16.0, 12.0), angle=0.0),
    "hill_east": dict(center=(90.0, -292.0), size=(12.0, 14.0), angle=0.0),
}
# Valley detail mesh and ground-texture map cover this rectangle: (min x, max x, min z, max z).
VALLEY_RECT = (-120.0, 160.0, -385.0, 40.0)
# Where the player may walk (collision bounds).
PLAY_AREA = [(5, 9), (-8, 11), (-28, 7), (-46, -30), (-52, -70), (-58, -104), (-60, -150), (-60, -200),
             (-52, -248), (-42, -276), (-12, -294), (22, -298), (60, -290), (92, -300), (104, -312),
             (122, -312), (138, -296), (136, -272), (112, -250), (96, -228), (94, -206), (96, -166), (96, -128), (90, -96),
             (78, -66), (66, -40), (56, -22), (40, -24), (24, -36), (12, -26), (7, -8)]
# Where houses may stand: the play area plus the lower slopes to the east, up toward the
# castle hill (terraced hillside houses, seen from the ledge; beyond the walkable area).
BUILD_AREA = [(5, 9), (-8, 11), (-28, 7), (-46, -30), (-52, -70), (-58, -104), (-60, -150), (-60, -200),
              (-52, -248), (-42, -276), (-12, -294), (22, -298), (60, -290), (92, -300), (104, -312),
              (122, -312), (138, -296), (152, -268), (146, -236), (134, -200), (130, -160), (124, -124),
              (112, -92), (98, -62), (84, -36), (66, -20), (56, -22), (40, -24), (24, -36), (12, -26), (7, -8)]

# Offset of the mountain noise, chosen so the peaks line up with the reference skyline.
MOUNTAIN_SHIFT = (-4981.0, -3828.0)


# ---------------------------------------------------------------- noise
class Perlin:
    def __init__(self, seed):
        rng = np.random.default_rng(seed)
        self.perm = np.concatenate([rng.permutation(256)] * 2)
        ang = rng.random(256) * 2 * np.pi
        self.gx, self.gz = np.cos(ang), np.sin(ang)

    def __call__(self, x, z):
        xi0 = np.floor(x).astype(np.int64)
        zi0 = np.floor(z).astype(np.int64)
        xf, zf = x - xi0, z - zi0
        xi, zi = xi0 & 255, zi0 & 255
        p = self.perm

        def g(ix, iz, dx, dz):
            h = p[p[ix] + iz]
            return self.gx[h] * dx + self.gz[h] * dz

        n00 = g(xi, zi, xf, zf)
        n10 = g(xi + 1, zi, xf - 1, zf)
        n01 = g(xi, zi + 1, xf, zf - 1)
        n11 = g(xi + 1, zi + 1, xf - 1, zf - 1)
        u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
        v = zf * zf * zf * (zf * (zf * 6 - 15) + 10)
        a = n00 + u * (n10 - n00)
        b = n01 + u * (n11 - n01)
        return (a + v * (b - a)) * 1.41


N = [Perlin(s) for s in range(14)]


def fbm(n, x, z, octaves=5, lac=2.03, gain=0.5):
    total, amp, freq, norm = 0.0, 1.0, 1.0, 0.0
    for i in range(octaves):
        total = total + amp * n(x * freq + i * 17.3, z * freq - i * 9.1)
        norm += amp
        amp *= gain
        freq *= lac
    return total / norm


def ridged(n, x, z, octaves=6, lac=2.05, gain=0.5):
    """Ridged multifractal in [0, 1]: sharp crests, each octave weighted by the previous one."""
    total, amp, freq, weight, norm = 0.0, 0.5, 1.0, 1.0, 0.0
    for i in range(octaves):
        s = 1.0 - np.abs(n(x * freq + i * 31.7, z * freq + i * 11.3))
        s = s * s * weight
        weight = np.clip(s * 2.0, 0.0, 1.0)
        total = total + s * amp
        norm += amp
        amp *= gain
        freq *= lac
    return total / norm


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def smax(a, b, k):
    h = np.clip(0.5 + 0.5 * (a - b) / k, 0.0, 1.0)
    return b + (a - b) * h + k * h * (1 - h)


def smin(a, b, k):
    return -smax(-a, -b, k)


def ramp(x, x0, x1, height):
    """Smooth S-shaped rise from 0 at x0 to `height` at x1 (no kinks, so no seams)."""
    return height * smoothstep(x0, x1, x)


# ---------------------------------------------------------------- polylines and regions
def catmull_rom(points, step=2.0):
    """Resamples control points (x, z, extra...) along a Catmull-Rom curve every ~step metres."""
    P = np.asarray(points, float)
    P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        n = max(2, int(np.hypot(*(p2[:2] - p1[:2])) / step))
        t = np.linspace(0, 1, n, endpoint=False)[:, None]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t ** 2
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-2][None])
    return [tuple(p) for p in np.vstack(out)]


RIVER = catmull_rom(RIVER_CTRL, 2.0)


def polyline(px, pz, pts, max_dist=None):
    """Distance to an open polyline, plus the side (+1/-1), the fractional
    vertex index of the closest point and the arc length there. With max_dist,
    points farther than that from the polyline's bounding box are skipped and
    reported at a large distance."""
    P = np.asarray([p[:2] for p in pts], float)
    if max_dist is not None:
        keep = ((px > P[:, 0].min() - max_dist) & (px < P[:, 0].max() + max_dist) &
                (pz > P[:, 1].min() - max_dist) & (pz < P[:, 1].max() + max_dist))
        d = np.full(px.shape, 1e5); side = np.ones(px.shape); t = np.zeros(px.shape); s = np.zeros(px.shape)
        if keep.any():
            d[keep], side[keep], t[keep], s[keep] = polyline(px[keep], pz[keep], pts)
        return d, side, t, s
    best = np.full(px.shape, np.inf)
    seg = np.zeros(px.shape, np.int64)
    uu = np.zeros(px.shape)
    cross = np.zeros(px.shape)
    lens = np.hypot(*(P[1:] - P[:-1]).T)
    cum = np.concatenate([[0.0], np.cumsum(lens)])
    for i in range(len(P) - 1):
        ax, az = P[i]
        dx, dz = P[i + 1] - P[i]
        u = np.clip(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1)
        qx, qz = ax + u * dx - px, az + u * dz - pz
        d2 = qx * qx + qz * qz
        m = d2 < best
        best[m] = d2[m]
        seg[m] = i
        uu[m] = u[m]
        cross[m] = (dx * (pz - az) - dz * (px - ax))[m]
    t = seg + uu
    return np.sqrt(best), np.where(cross >= 0, 1.0, -1.0), t, cum[seg] + uu * lens[seg]


def along(pts, t, k):
    return np.interp(t, np.arange(len(pts)), [p[k] for p in pts])


def inside_polygon(px, pz, poly):
    inside = np.zeros(px.shape, bool)
    n = len(poly)
    for i in range(n):
        ax, az = poly[i][:2]
        bx, bz = poly[(i + 1) % n][:2]
        if az == bz:
            continue
        crosses = (az > pz) != (bz > pz)
        xint = (bx - ax) * (pz - az) / (bz - az) + ax
        inside ^= crosses & (px < xint)
    return inside


def blend_attrs(px, pz, ring, keys, power=2.0, soft=15.0):
    """Attributes of a region's edge vertices blended by inverse distance. Unlike the
    nearest segment's value this is smooth everywhere, so plateaus show no seams."""
    P = np.asarray([p[:2] for p in ring[:-1]], float)
    wsum = np.zeros(px.shape)
    acc = [np.zeros(px.shape) for _ in keys]
    for i, (vx, vz) in enumerate(P):
        w = 1.0 / ((px - vx) ** 2 + (pz - vz) ** 2 + soft * soft) ** (power / 2)
        wsum += w
        for j, k in enumerate(keys):
            acc[j] += w * ring[i][k]
    return tuple(a / wsum for a in acc)


def signed(px, pz, edge, closing):
    """Signed distance to a region's boundary (positive inside). The region is the
    edge polyline closed by far-away points (which carry their own attributes),
    so the sign is always consistent. Returns the ring so attributes can be read
    along it."""
    ring = list(edge) + list(closing)
    ring = ring + [ring[0]]
    d, _, t, s = polyline(px, pz, ring)
    return np.where(inside_polygon(px, pz, ring[:-1]), d, -d), t, s, ring


# ---------------------------------------------------------------- landforms
def layered_ridges(px, pz, r, theta, seed, scale):
    """Forested ridges that run across the view and step up with distance, so from
    the ledge they read as layers fading into the mist."""
    arc = np.radians(theta) * r / 520.0                 # along the ridge
    across = r / 150.0 + 0.8 * fbm(N[seed], px / 400, pz / 400, 3)
    return ridged(N[seed + 1], arc, across, 4) * scale


def wall(px, pz, pts, closing, exponent, jag_amp, jag_scale, seed, r, theta, ridge_amp=26.0, rise=20.0, stepped=False):
    """Cliff or slope with rolling, layered hills behind it: a face of the given width
    outside the edge, with vertical buttresses from noise along the edge. With stepped,
    wide faces (12 m and more) become two rock bands with a ledge between them."""
    sd, t, s, ring = signed(px, pz, pts, closing)
    crest, width = blend_attrs(px, pz, ring, (2, 3))
    jag = jag_amp * (ridged(N[seed], s / jag_scale, 0.37, 3) - 0.5) + 0.35 * jag_amp * N[seed + 1](s / 3.1, 0.71)
    calm = np.ones_like(px)          # no buttresses where the waterfalls leave the rock
    for wf in (WATERFALL1, WATERFALL2):
        calm = calm * smoothstep(5, 14, np.hypot(px - wf["top"][0], pz - wf["top"][2]))
    calm = calm * smoothstep(22, 10, width)                            # gentle slopes get no buttresses
    x = sd + jag * smoothstep(30, 6, np.abs(sd)) * calm
    tt = np.clip((x + width) / width, 0, 1)
    profile = tt ** exponent
    if stepped:
        # the ledge wanders up and down along the wall so the bands don't read as a stripe
        ledge = 0.6 + 0.08 * N[seed + 4](s / 23.0, 0.29)
        steps = ledge * smoothstep(0.0, 0.36, tt) + (1 - ledge) * smoothstep(0.55, 0.9, tt)
        profile = profile + (steps - profile) * smoothstep(12, 16, width)
    face = crest * profile
    rolling = (4.0 * fbm(N[seed + 2], px / 70, pz / 70, 4)
               + layered_ridges(px, pz, r, theta, seed + 3, ridge_amp) * smoothstep(10, 90, x)
               + ramp(x, 20, 600, rise))
    return np.where(x >= 0, crest + rolling * smoothstep(0, 25, x), face), sd, width


def mountain_envelope(theta, r):
    """Height envelope of the far range, designed from the reference skyline."""
    ring = smoothstep(700, 1900, r) * (1 - smoothstep(4700, 5200, r))
    base = 230 + 80 * fbm(N[9], theta / 40.0, 0.5, 3)
    massifs = [(-24, 8, 2900, 700, 290), (-10, 5, 3600, 700, 150), (-37, 6, 2400, 500, 230), (-15, 5, 3000, 600, 120),
               (-8, 4, 3400, 500, 160), (17, 4.5, 3300, 600, 280), (29, 7, 3000, 700, 40),
               (47, 12, 2800, 900, 60), (5, 6, 3900, 500, 60), (36, 12, 2800, 1500, -90)]
    for th, sth, rr, sr, a in massifs:
        base = base + a * np.exp(-((theta - th) / sth) ** 2 - ((r - rr) / sr) ** 2)
    # quieter band straight ahead so the pagoda and forest ridge read against the sky
    base = base - 130 * np.exp(-((theta - 3) / 10) ** 2) * np.exp(-((r - 2100) / 800) ** 2)
    return ring * base


def mountains(px, pz, r, theta):
    mx, mz = px + MOUNTAIN_SHIFT[0], pz + MOUNTAIN_SHIFT[1]
    wx = mx + 220 * fbm(N[5], mx / 1100, mz / 1100, 3)
    wz = mz + 220 * fbm(N[6], mx / 1100 + 3.3, mz / 1100, 3)
    # broad pyramidal peaks (ridged multifractal, sharpened by the power), with
    # smaller jagged teeth along the ridgelines and eroded gullies on the faces
    crag = ridged(N[2], wx / 1350, wz / 1350, 8)
    teeth = ridged(N[4], wx / 380, wz / 380, 4)
    gully = np.abs(N[3](wx / 110, wz / 55))
    crag = np.clip(crag * (0.88 + 0.16 * teeth) * (1 - 0.07 * gully), 0, 1)
    return mountain_envelope(theta, r) * (0.1 + 1.05 * crag ** 2.2)


def channel(px, pz, pts, level, bed_depth, bank_height, bank_width, outer_slope, near=None):
    """River cross-section: a shallow bed, a gentle bank rising bank_height above the
    water over bank_width metres, then an outer slope that only matters where the
    surrounding ground is higher than the bank. `near` is a precomputed (d, t)."""
    d, t = near if near is not None else polyline(px, pz, pts, max_dist=300)[::2]
    w = along(pts, t, 2) * 0.5
    lvl = np.interp(t, np.arange(len(level)), level) if isinstance(level, (list, tuple)) else level
    bed = lvl - bed_depth
    under = bed + (lvl - bed) * smoothstep(w - 7, w, d)                 # bed rising to the water line
    bank = lvl + bank_height * smoothstep(w, w + bank_width, d)         # gentle bank above it
    outer = lvl + bank_height + np.maximum(0, d - w - bank_width) * outer_slope
    prof = np.where(d < w, under, np.where(d < w + bank_width, bank, outer))
    return prof, d, w


# ---------------------------------------------------------------- height field
def base_height(px, pz):
    """Everything except the walkable cuts (paths, stairs, pads)."""
    r = np.hypot(px, pz)
    theta = np.degrees(np.arctan2(px, -pz))

    # village basin: rises gently away from the river and toward the western slope
    d_river, _, t_river, _ = polyline(px, pz, RIVER, max_dist=300)
    h = FLOOR + ramp(d_river, 22, 180, 1.9) + 0.35 * fbm(N[0], px / 30, pz / 30, 3) * smoothstep(20, 30, d_river)
    h = h + ramp(-px, 46, 84, 11.0) + ramp(-px, 84, 130, 8.0)            # western slope up to the cliff foot
    # the plateau behind stays low enough that the forest on it sits below the mountains
    west, sd_w, width_w = wall(px, pz, WEST_WALL, WEST_CLOSING, 3.0, 5.0, 11.0, 1, r, theta, ridge_amp=18.0, rise=8.0, stepped=True)
    fg, sd_fg, _ = wall(px, pz, FG_EDGE, FG_CLOSING, 1.35, 1.0, 14.0, 4, r, theta)
    h = smax(h, west, 2.0)
    h = smax(h, fg, 2.0)

    sd_e, t_e, _, ring_e = signed(px, pz, EAST_EDGE, EAST_CLOSING)
    foot, = blend_attrs(px, pz, ring_e, (2,))
    # east slopes: high and wooded by the watchtower; beyond the castle hill they sink into
    # a low, misty lowland, so from the ledge the right side opens onto distance
    lowland = smoothstep(-70, -170, pz)
    east = (foot - 8.0 + ramp(sd_e, -18, 110, 58.0 - 45.0 * lowland)
            + (5 * fbm(N[7], px / 60, pz / 60, 4) + layered_ridges(px, pz, r, theta, 12, 20.0) * (1 - 0.7 * lowland)) * smoothstep(0, 40, sd_e)
            - lowland * ramp(sd_e, 140, 420, 7.0))
    h = smax(h, east, 3.0)

    cx, cz = PAGODA_HILL["center"]
    dh = np.hypot(px - cx, pz - cz)
    p = np.clip(1 - (dh - PAGODA_HILL["flat_radius"]) / (PAGODA_HILL["radius"] - PAGODA_HILL["flat_radius"]), 0, 1)
    hill = PAGODA_HILL["top"] * p ** 1.2 + 1.5 * fbm(N[8], px / 25, pz / 25, 3) * (1 - p)
    h = smax(h, hill, 3.0)
    tc = TORII_TERRACE
    ell = np.hypot((px - tc["center"][0]) / tc["radius"][0], (pz - tc["center"][1]) / tc["radius"][1])
    h = smax(h, tc["height"] * smoothstep(1.35, 1.0, ell), 1.0)

    # valley features fade out with distance; beyond that it is hills and the range
    h = h * smoothstep(1100, 450, r)
    hills = smoothstep(260, 700, r) * (8 + 6 * fbm(N[10], px / 260, pz / 260, 4)) + layered_ridges(px, pz, r, theta, 10, 34.0) * smoothstep(300, 800, r)
    hills = hills + smoothstep(700, 1500, r) * 60 * ridged(N[3], px / 600, pz / 600, 5)
    hills = hills * (1 - 0.5 * np.exp(-((theta - 5) / 12) ** 2) * smoothstep(450, 1000, r))
    # the blend width shrinks to nothing where hills/range are absent; a fixed width would
    # lift the valley floor by a quarter of it wherever both sides are near zero
    h = smax(h, hills, np.maximum(8.0 * smoothstep(0, 16, hills), 1e-3))
    mtn = mountains(px, pz, r, theta)
    h = smax(h, mtn, np.maximum(20.0 * smoothstep(0, 40, mtn), 1e-3))

    # rivers
    low, d_low, w_low = channel(px, pz, RIVER, WATER, WATER - BED, BANK, BANK_WIDTH, 2.3, near=(d_river, t_river))
    h = smin(h, low, 3.0)
    # steep outer banks: the stream runs along the foot of the escarpment and must not cut
    # into it; at the waterfall it leaves a small plunge-pool amphitheatre
    s2, d_s2, w_s2 = channel(px, pz, STREAM2, STREAM2_LEVEL, 1.0, 0.8, 4.0, 6.0)
    h = smin(h, s2, 1.0)
    up, _, _ = channel(px, pz, UPPER, UPPER_LEVEL, 2.0, 1.2, 4.0, 1.3)
    h = smin(h, up, 1.0)

    for wf in (WATERFALL1, WATERFALL2):
        h = np.minimum(h, waterfall_clearance(px, pz, wf))

    masks = dict(sd_w=sd_w, width_w=width_w, sd_fg=sd_fg, r=r, d_water=np.minimum(d_low - w_low, d_s2 - w_s2))
    return h, masks


def path_profiles(step=1.0):
    """Densely resampled path centrelines with the height each should be graded to."""
    out = {}
    for name, p in PATHS.items():
        pts = np.asarray(p["pts"], float)
        seg = np.hypot(*np.diff(pts, axis=0).T)
        cum = np.concatenate([[0], np.cumsum(seg)])
        s = np.arange(0, cum[-1] + 1e-6, step)
        x, z = np.interp(s, cum, pts[:, 0]), np.interp(s, cum, pts[:, 1])
        if p["heights"] == "auto":
            y, _ = base_height(x, z)
            k = max(1, int(8 / step))                                  # 16 m moving average
            y = np.convolve(np.pad(y, k, mode="edge"), np.ones(2 * k + 1) / (2 * k + 1), mode="valid")
            y = np.maximum(y, BANK + 0.05)
        elif p["heights"] == "graded":                                  # one steady grade end to end
            yk, _ = base_height(pts[[0, -1], 0], pts[[0, -1], 1])
            y = yk[0] + (yk[1] - yk[0]) * s / s[-1]
        else:                                                          # explicit; None = natural ground
            yk = np.array([np.nan if v is None else v for v in p["heights"]], float)
            miss = np.isnan(yk)
            if miss.any():
                yk[miss], _ = base_height(pts[miss, 0], pts[miss, 1])
            y = np.interp(s, cum, yk)
        out[name] = (list(zip(x, z)), y, p)
    return out


_PROFILES = None


def height(px, pz, with_paths=True):
    global _PROFILES
    h, masks = base_height(px, pz)
    path_w = np.zeros_like(px)
    stairs_w = np.zeros_like(px)
    grade_w = np.zeros_like(px)          # where the ground was reshaped for paths and pads
    if with_paths:
        if _PROFILES is None:
            _PROFILES = path_profiles()
        # Where the shoulders of two paths overlap (a stair top meeting a court, a trail
        # meeting a street), the path the point is most firmly on sets the height: targets
        # are averaged with steep weights (w^8), which stays continuous (no crease) while
        # a path's centre is never pulled toward its neighbour's level.
        acc_t = np.zeros_like(px)
        acc_w = np.zeros_like(px)
        max_w = np.zeros_like(px)
        for name, (pts, y, p) in _PROFILES.items():
            d, _, t, _ = polyline(px, pz, pts, max_dist=12)
            target = np.interp(t, np.arange(len(y)), y)
            half = p["width"] * 0.5
            shoulder = 4.5 if p["kind"] == "street" else 3.5
            w = smoothstep(half + shoulder, half, d)
            # square end caps: behind either end the grading fades within 2 m, so a path
            # doesn't reach back over the one it joins (a court over the stairs below it)
            # (only where the path's nearest point is that end: a zig-zag trail passes
            # behind its own start further down)
            P = np.asarray(pts, float)
            for (ex, ez), (qx, qz), at_end in ((P[0], P[1], t < 0.01), (P[-1], P[-2], t > len(P) - 1.01)):
                dx, dz = ex - qx, ez - qz
                dl = np.hypot(dx, dz) or 1.0
                beyond = ((px - ex) * dx + (pz - ez) * dz) / dl
                w = np.where(at_end, w * smoothstep(2.0, 0.0, beyond), w)
            k = w ** 8
            acc_t += k * target
            acc_w += k
            max_w = np.maximum(max_w, w)
            grade_w = np.maximum(grade_w, smoothstep(half + shoulder + 1.0, half + shoulder, d))
            path_w = np.maximum(path_w, smoothstep(half + 0.35, half - 0.35, d))
            if p["kind"] == "stairs":
                stairs_w = np.maximum(stairs_w, smoothstep(half + 0.35, half - 0.35, d))
        graded = acc_w > 1e-12
        h = np.where(graded, h + (acc_t / np.maximum(acc_w, 1e-12) - h) * max_w, h)
        for pad in PADS.values():
            u, v = pad_local(px, pz, pad)
            hx, hz = pad["size"][0] / 2, pad["size"][1] / 2
            inside = np.maximum(np.abs(u) - hx, np.abs(v) - hz)       # < 0 inside the pad
            level, _ = base_height(np.array([pad["center"][0]]), np.array([pad["center"][1]]))
            h = h + (max(level[0], BANK + 0.6) - h) * smoothstep(3.0, 0.0, inside)
            grade_w = np.maximum(grade_w, smoothstep(4.0, 3.0, inside))

    # the ninja's ledge: a rock top at y ~ 49.9 that falls away in front and to the right
    ledge = 49.9 + 0.35 * fbm(N[1], px / 3, pz / 3, 3) - 1.2 * np.maximum(0, -pz - 1.5) ** 1.4 - 1.2 * np.maximum(0, px - 1.0) ** 1.4
    wl = smoothstep(9, 5, np.hypot(px, pz))
    h = h * (1 - wl) + np.minimum(ledge, h + 2) * wl

    masks["path"] = path_w
    masks["stairs"] = stairs_w
    masks["grade"] = grade_w
    return h, masks


def pad_local(px, pz, pad):
    a = np.radians(pad["angle"])
    dx, dz = px - pad["center"][0], pz - pad["center"][1]
    return dx * np.cos(a) - dz * np.sin(a), dx * np.sin(a) + dz * np.cos(a)


def waterfall_clearance(px, pz, wf):
    tx, ty, tz = wf["top"]
    fx, fy, fz = wf["foot"]
    ax, az = fx - tx, fz - tz
    L2 = ax * ax + az * az
    u = ((px - tx) * ax + (pz - tz) * az) / L2
    across = np.abs((px - tx) * az - (pz - tz) * ax) / np.sqrt(L2)
    half = 0.5 * (wf["width_top"] + (wf["width_foot"] - wf["width_top"]) * np.clip(u, 0, 1)) + 2.0
    limit = waterfall_y(wf, np.clip(u, 0, 1)) - 1.5
    inside = (across < half) & (u > 0.02) & (u < 1.1)
    return np.where(inside, limit, np.inf)


def waterfall_y(wf, u):
    """Water leaves the lip horizontally and falls on a parabola: u is the
    horizontal fraction from lip to foot."""
    ty, fy = wf["top"][1], wf["foot"][1]
    return ty - (ty - fy) * u * u


# Far-away points that close each region, with (crest, face width) like the edges.
WEST_CLOSING = [(-700, -55, 48, 20), (-3000, -55, 48, 20), (-3000, -3000, 40, 40), (700, -3000, 30, 40),
                (420, -700, 28, 40), (200, -420, 26, 40)]
FG_CLOSING = [(60, 1200, 64, 36), (-3000, 1200, 64, 36), (-3000, 40, 56, 60)]
EAST_CLOSING = [(170, 1200, 8), (3000, 1200, 8), (3000, -3000, 6), (400, -3000, 6), (200, -900, 6)]
