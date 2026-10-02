"""Procedural Japanese architecture for the village, built in Blender from code.

Everything shares one material in three.js: a texture array indexed per face.
  LAYER: 0 wood, 1 plaster, 2 shoji, 3 roof tiles, 4 stone
Per face we store: planar UVs in metres (TEXCOORD_0, the textures repeat), the layer
and an emissive strength (TEXCOORD_1 = (layer, emit)), and a linear tint (COLOR_0).
Coordinates are three.js space (x right, y up, z toward the front of the building);
meshes are converted to Blender axes when they are created.
"""
import math
import numpy as np
import bpy

WOOD, PLASTER, SHOJI, ROOF, STONE = 0, 1, 2, 3, 4

# tints (linear), picked against the village reference
DARK_WOOD = (0.55, 0.45, 0.38)
POST_WOOD = (0.42, 0.33, 0.27)
PALE_WOOD = (0.95, 0.8, 0.62)
RED_LACQUER = (0.82, 0.15, 0.07)     # smooth (plaster-textured) vermilion lacquer
BLACK_LACQUER = (0.25, 0.22, 0.22)
TILE = (0.42, 0.45, 0.52)
RIDGE_TILE = (0.3, 0.32, 0.37)
PLASTER_T = (0.58, 0.56, 0.52)      # aged lime plaster; full white glares under moonlight
STONE_T = (0.85, 0.85, 0.85)
WHITE = (1.0, 1.0, 1.0)


class Builder:
    """Accumulates faces with per-face layer, tint and emission. Faces don't share
    vertices, so shading is flat and per-face attributes are exact."""

    def __init__(self):
        self.faces = []   # (points Nx3, layer, tint, emit, uv_scale, uv_offset)

    # -- primitives --------------------------------------------------------------
    def poly(self, pts, layer, tint=WHITE, emit=0.0, uv_scale=1.0, uv_offset=(0.0, 0.0)):
        pts = np.asarray(pts, float)
        if len(pts) >= 3:
            self.faces.append((pts, layer, tint, emit, uv_scale, uv_offset))

    def box(self, center, size, layer, tint=WHITE, emit=0.0, rot_y=0.0, skip=(), uv_scale=1.0):
        """Axis box (optionally rotated about y). skip: faces to omit, from
        'top', 'bottom', 'front' (+z), 'back', 'left' (-x), 'right'."""
        cx, cy, cz = center
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        c = np.array([[-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
                      [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]])
        if rot_y:
            c = rotate_y(c, rot_y)
        c = c + np.array([cx, cy, cz])
        faces = {"back": [1, 0, 3, 2], "front": [4, 5, 6, 7], "left": [0, 4, 7, 3],
                 "right": [5, 1, 2, 6], "top": [3, 7, 6, 2], "bottom": [0, 1, 5, 4]}
        for k, idx in faces.items():
            if k not in skip:
                self.poly(c[idx], layer, tint, emit, uv_scale)

    def beam(self, a, b, w, h, layer=WOOD, tint=POST_WOOD):
        """Rectangular timber from a to b (w across horizontally, h vertically)."""
        a, b = np.asarray(a, float), np.asarray(b, float)
        d = b - a
        L = np.linalg.norm(d)
        f = d / L
        up = np.array([0.0, 1.0, 0.0]) if abs(f[1]) < 0.95 else np.array([1.0, 0.0, 0.0])
        s = np.cross(f, up); s /= np.linalg.norm(s)
        u = np.cross(s, f)
        corners = []
        for p in (a, b):
            corners += [p - s * w / 2 - u * h / 2, p + s * w / 2 - u * h / 2, p + s * w / 2 + u * h / 2, p - s * w / 2 + u * h / 2]
        c = np.array(corners)
        for idx in ([0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [3, 2, 1, 0], [4, 5, 6, 7]):
            self.poly(c[idx], layer, tint)

    def cylinder(self, center, radius, height, layer, tint=WHITE, emit=0.0, segs=8, cap=True):
        cx, cy, cz = center
        ang = np.linspace(0, 2 * np.pi, segs + 1)
        ring = np.stack([np.cos(ang) * radius, np.zeros_like(ang), np.sin(ang) * radius], -1)
        lo = ring + [cx, cy, cz]
        hi = ring + [cx, cy + height, cz]
        for i in range(segs):
            self.poly([lo[i + 1], lo[i], hi[i], hi[i + 1]], layer, tint, emit)
        if cap:
            self.poly(hi[:-1][::-1], layer, tint, emit)
            self.poly(lo[:-1], layer, tint, emit)

    def transform(self, rot_y=0.0, offset=(0, 0, 0), scale=1.0):
        out = Builder()
        for pts, layer, tint, emit, uvs, uvo in self.faces:
            p = rotate_y(pts * scale, rot_y) + np.asarray(offset, float)
            out.faces.append((p, layer, tint, emit, uvs, uvo))
        return out

    def add(self, other, rot_y=0.0, offset=(0, 0, 0), scale=1.0):
        self.faces += other.transform(rot_y, offset, scale).faces
        return self

    def tri_count(self):
        return sum(len(f[0]) - 2 for f in self.faces)

    # -- to Blender --------------------------------------------------------------
    def to_mesh(self, name):
        verts, polys, uv0, uv1, cols = [], [], [], [], []
        for pts, layer, tint, emit, uvs, uvo in self.faces:
            n = face_normal(pts)
            if n is None:
                continue
            # planar UVs in metres: u runs horizontally along the face, v up (or down the slope)
            if abs(n[1]) < 0.95:
                u_ax = np.cross([0.0, 1.0, 0.0], n); u_ax /= np.linalg.norm(u_ax)
            else:
                u_ax = np.array([1.0, 0.0, 0.0])
            v_ax = np.cross(n, u_ax)
            base = len(verts)
            for p in pts:
                verts.append((p[0], -p[2], p[1]))
                # the glTF exporter stores v as 1 - v; pre-flip so three.js gets the values as written
                uv0.append((float(np.dot(p, u_ax)) * uvs + uvo[0], 1.0 - (float(np.dot(p, v_ax)) * uvs + uvo[1])))
                uv1.append((float(layer), 1.0 - float(emit)))
                cols.append((*tint, 1.0))
            polys.append(list(range(base, base + len(pts))))
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts, [], polys)
        me.update()
        loop_v = np.empty(len(me.loops), np.int32)
        me.loops.foreach_get("vertex_index", loop_v)
        uv0 = np.asarray(uv0, np.float32); uv1 = np.asarray(uv1, np.float32)
        l0 = me.uv_layers.new(name="UVMap"); l0.data.foreach_set("uv", uv0[loop_v].ravel())
        l1 = me.uv_layers.new(name="Layer"); l1.data.foreach_set("uv", uv1[loop_v].ravel())
        attr = me.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
        attr.data.foreach_set("color", np.asarray(cols, np.float32).ravel())
        me.color_attributes.active_color = attr
        me.polygons.foreach_set("use_smooth", np.zeros(len(me.polygons), bool))
        return me


def rotate_y(p, a):
    c, s = math.cos(a), math.sin(a)
    p = np.asarray(p, float)
    x, z = p[..., 0] * c + p[..., 2] * s, -p[..., 0] * s + p[..., 2] * c
    return np.stack([x, p[..., 1], z], -1)


def face_normal(pts):
    n = np.zeros(3)
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n += np.cross(a, b)
    L = np.linalg.norm(n)
    return None if L < 1e-9 else n / L


# ------------------------------------------------------------------ roofs
def _eave_lift(s, upturn):
    """Upturned corners: s in [0, 1] along an eave, lift grows toward both ends."""
    return upturn * np.abs(2 * s - 1) ** 3.5


def _roof_surface(b, grid, layer, tint, thickness, under_tint=DARK_WOOD, underside=True):
    """grid: (nv+1, nu+1, 3) points, row 0 = eave, last row = ridge side. Adds the tiled
    top, the wooden underside and the eave fascia."""
    nv, nu = grid.shape[0] - 1, grid.shape[1] - 1
    for j in range(nv):
        for i in range(nu):
            q = [grid[j, i], grid[j, i + 1], grid[j + 1, i + 1], grid[j + 1, i]]
            if np.linalg.norm(q[2] - q[3]) < 1e-6:          # collapsed ridge corner -> triangle
                b.poly([q[0], q[1], q[2]], layer, tint)
            else:
                b.poly(q, layer, tint)
    if underside:
        down = np.array([0.0, -thickness, 0.0])
        g2 = grid + down
        for j in range(nv):
            for i in range(nu):
                q = [g2[j, i + 1], g2[j, i], g2[j + 1, i], g2[j + 1, i + 1]]
                b.poly(q, WOOD, under_tint)
        for i in range(nu):                                   # fascia board along the eave
            b.poly([grid[0, i + 1], grid[0, i], g2[0, i], g2[0, i + 1]], WOOD, under_tint)


def hip_roof(b, ex, ez, eave_y, rise, ridge_half, upturn=0.35, nu=8, nv=5, curve=1.45,
             layer=ROOF, tint=TILE, thickness=0.22, underside=True, cut=1.0):
    """Hip roof (yosemune) over an eave rectangle of half-size (ex, ez), ridge along x.
    Concave slopes and upturned corners. cut < 1 stops the slopes part way up (flat
    top) so a gable roof can sit on top, which makes an irimoya roof."""
    top_y = eave_y + rise
    t = np.linspace(0, cut, nv + 1)[:, None]
    f = t ** curve
    # front and back slopes
    for sgn in (1, -1):
        s = np.linspace(0, 1, nu + 1)[None, :]
        ex_pts = np.stack(np.broadcast_arrays(-ex + 2 * ex * s, eave_y + _eave_lift(s, upturn), sgn * ez + 0 * s), -1)[0]
        rg_pts = np.stack(np.broadcast_arrays(-ridge_half + 2 * ridge_half * s, top_y + 0 * s, 0 * s), -1)[0]
        grid = ex_pts[None] * (1 - t[..., None]) + rg_pts[None] * t[..., None]
        grid[..., 1] = ex_pts[None, :, 1] * (1 - f) + top_y * f
        if sgn < 0:
            grid = grid[:, ::-1]
        _roof_surface(b, grid, layer, tint, thickness, underside=underside)
    # hips (sides)
    for sgn in (1, -1):
        s = np.linspace(0, 1, nu // 2 + 1)[None, :]
        ex_pts = np.stack(np.broadcast_arrays(sgn * ex + 0 * s, eave_y + _eave_lift(s, upturn), -ez + 2 * ez * s), -1)[0]
        apex = np.array([sgn * ridge_half, top_y, 0.0])
        grid = ex_pts[None] * (1 - t[..., None]) + apex[None, None] * t[..., None]
        grid[..., 1] = ex_pts[None, :, 1] * (1 - f) + top_y * f
        if sgn > 0:
            grid = grid[:, ::-1]
        _roof_surface(b, grid, layer, tint, thickness, underside=underside)
    if cut >= 0.999:
        ridge_cap(b, (-ridge_half, top_y, 0), (ridge_half, top_y, 0))
    return eave_y + rise * cut ** curve


def gable_roof(b, ex, ez, eave_y, rise, upturn=0.2, nu=8, nv=5, curve=1.3, layer=ROOF, tint=TILE,
               thickness=0.22, gable_half=None, gable_layer=WOOD, gable_tint=DARK_WOOD, underside=True):
    """Gable roof (kirizuma), ridge along x across the full length. gable_half: half
    width of the vertical gable walls under the roof ends (defaults to ex - 0.6)."""
    top_y = eave_y + rise
    t = np.linspace(0, 1, nv + 1)[:, None]
    f = t ** curve
    for sgn in (1, -1):
        s = np.linspace(0, 1, nu + 1)[None, :]
        ex_pts = np.stack(np.broadcast_arrays(-ex + 2 * ex * s, eave_y + _eave_lift(s, upturn), sgn * ez + 0 * s), -1)[0]
        rg_pts = np.stack(np.broadcast_arrays(-ex + 2 * ex * s, top_y + _eave_lift(s, upturn * 0.6), 0 * s), -1)[0]
        grid = ex_pts[None] * (1 - t[..., None]) + rg_pts[None] * t[..., None]
        grid[..., 1] = ex_pts[None, :, 1] * (1 - f) + rg_pts[None, :, 1] * f
        if sgn < 0:
            grid = grid[:, ::-1]
        _roof_surface(b, grid, layer, tint, thickness, underside=underside)
        # bargeboards along the gable ends
        for end in (0, -1):
            col = grid[:, end]
            for j in range(nv):
                b.beam(col[j] + [0, -0.12, 0], col[j + 1] + [0, -0.12, 0], 0.12, 0.3, WOOD, DARK_WOOD)
    gh = ex - 0.6 if gable_half is None else gable_half
    for sgn in (1, -1):                                        # vertical gable walls
        x = sgn * gh
        zz = np.linspace(-ez, ez, 2 * nv + 1)
        ys = [eave_y + (top_y - eave_y) * (1 - abs(z) / ez) ** curve - thickness for z in zz]
        base_y = eave_y - thickness
        pts = [(x, base_y, -ez + 0.6)] + [(x, y, z) for z, y in zip(zz, ys) if abs(z) <= ez - 0.6] + [(x, base_y, ez - 0.6)]
        pts = np.array(pts)
        if sgn < 0:
            pts = pts[::-1]
        b.poly(pts, gable_layer, gable_tint)
    ridge_cap(b, (-ex - 0.1, top_y + upturn * 0.6, 0), (ex + 0.1, top_y + upturn * 0.6, 0))


def ridge_cap(b, a, c, w=0.42, h=0.34):
    a, c = np.asarray(a, float), np.asarray(c, float)
    b.beam(a + [0, h / 2 - 0.05, 0], c + [0, h / 2 - 0.05, 0], w, h, ROOF, RIDGE_TILE)
    for p in (a, c):                                        # onigawara end ornaments
        b.box(p + [0, h + 0.12, 0], (0.28, 0.7, 0.55), ROOF, RIDGE_TILE)


def irimoya_roof(b, ex, ez, eave_y, rise, upturn=0.4, nu=8, nv=5, layer=ROOF, tint=TILE, underside=True):
    """Hip-and-gable roof: a hip skirt cut at 55% height with a gable roof on top."""
    cut = 0.55
    ridge_half = max(ex - ez, ex * 0.35)
    shoulder = hip_roof(b, ex, ez, eave_y, rise, ridge_half, upturn, nu, nv, cut=cut, layer=layer, tint=tint, underside=underside)
    top = eave_y + rise
    # close the cut top of the hip skirt, then set the gable roof over it
    cx, cz = ex * (1 - cut) + ridge_half * cut, ez * (1 - cut)
    b.poly([(-cx, shoulder - 0.02, cz), (cx, shoulder - 0.02, cz), (cx, shoulder - 0.02, -cz), (-cx, shoulder - 0.02, -cz)], layer, RIDGE_TILE)
    gable_roof(b, cx + 0.35, cz + 0.4, shoulder - 0.05, top - shoulder + 0.25, upturn * 0.4, nu=6, nv=3,
               layer=layer, tint=tint, gable_half=cx - 0.25, gable_layer=PLASTER, gable_tint=PLASTER_T, underside=underside)


# ------------------------------------------------------------------ walls and parts
def framed_walls(b, w, d, y0, h, front="shoji", sides="wood", back="wood", post_every=1.8, sill=0.9,
                 emit=1.0, doors=()):
    """Timber-framed walls of a w x d box from y0 to y0+h. Infill per side:
    'shoji' (glowing paper), 'wood' planks, 'plaster' (upper part plaster over wood),
    'open' (none). Doors: list of (side, centre offset, width) cut as dark openings."""
    hx, hz = w / 2, d / 2
    sides_def = {"front": (np.array([-hx, 0, hz]), np.array([1.0, 0, 0]), w, front),
                 "back": (np.array([hx, 0, -hz]), np.array([-1.0, 0, 0]), w, back),
                 "left": (np.array([-hx, 0, -hz]), np.array([0, 0, 1.0]), d, sides),
                 "right": (np.array([hx, 0, hz]), np.array([0, 0, -1.0]), d, sides)}
    inset = 0.06
    for name, (start, along, length, kind) in sides_def.items():
        n_bays = max(1, int(round(length / post_every)))
        bay = length / n_bays
        normal = np.cross(along, [0, 1, 0])          # outward
        for k in range(n_bays):
            a = start + along * (k * bay)
            c = start + along * ((k + 1) * bay)
            door = next((dw for (s, off, dw) in doors if s == name and abs((k + 0.5) * bay - (length / 2 + off)) < bay / 2), None)
            p = lambda q, y: (q - normal * inset) + [0, y, 0]
            if door:
                # dark doorway with a noren curtain strip on top
                b.poly([p(a, y0), p(c, y0), p(c, y0 + 1.95), p(a, y0 + 1.95)], WOOD, (0.08, 0.06, 0.05))
                b.poly([p(a, y0 + 1.95), p(c, y0 + 1.95), p(c, y0 + h), p(a, y0 + h)], PLASTER if kind == "plaster" else WOOD,
                       PLASTER_T if kind == "plaster" else DARK_WOOD)
                b.poly([p(a, y0 + 1.35), p(c, y0 + 1.35), p(c, y0 + 1.95), p(a, y0 + 1.95)], SHOJI, (0.35, 0.12, 0.1), 0.6)
                continue
            if kind == "shoji":
                b.poly([p(a, y0), p(c, y0), p(c, y0 + sill * 0.35), p(a, y0 + sill * 0.35)], WOOD, DARK_WOOD)
                b.poly([p(a, y0 + sill * 0.35), p(c, y0 + sill * 0.35), p(c, y0 + h - 0.35), p(a, y0 + h - 0.35)], SHOJI, WHITE, emit)
                b.poly([p(a, y0 + h - 0.35), p(c, y0 + h - 0.35), p(c, y0 + h), p(a, y0 + h)], PLASTER, PLASTER_T)
            elif kind == "plaster":
                b.poly([p(a, y0), p(c, y0), p(c, y0 + sill), p(a, y0 + sill)], WOOD, DARK_WOOD)
                b.poly([p(a, y0 + sill), p(c, y0 + sill), p(c, y0 + h), p(a, y0 + h)], PLASTER, PLASTER_T)
            elif kind == "wood":
                b.poly([p(a, y0), p(c, y0), p(c, y0 + h), p(a, y0 + h)], WOOD, DARK_WOOD)
            elif kind == "window":                       # wood wall with a small lit window
                mid = (a + c) / 2
                half = along * min(0.55, bay * 0.3)
                wy0, wy1 = y0 + 1.0, y0 + min(h - 0.4, 2.0)
                b.poly([p(a, y0), p(c, y0), p(c, wy0), p(a, wy0)], WOOD, DARK_WOOD)
                b.poly([p(a, wy1), p(c, wy1), p(c, y0 + h), p(a, y0 + h)], WOOD, DARK_WOOD)
                b.poly([p(a, wy0), p(mid - half, wy0), p(mid - half, wy1), p(a, wy1)], WOOD, DARK_WOOD)
                b.poly([p(mid + half, wy0), p(c, wy0), p(c, wy1), p(mid + half, wy1)], WOOD, DARK_WOOD)
                b.poly([p(mid - half, wy0), p(mid + half, wy0), p(mid + half, wy1), p(mid - half, wy1)], SHOJI, WHITE, emit)
        # posts at bay boundaries
        for k in range(n_bays + 1):
            q = start + along * (k * bay)
            b.box(q + [0, y0 + h / 2, 0], (0.2, h, 0.2), WOOD, POST_WOOD)
        # tie beams (nuki) top and at sill height
        for y in (y0 + h - 0.12, y0 + sill * 0.35):
            b.beam(start + [0, y, 0] + normal * 0.04, start + along * length + [0, y, 0] + normal * 0.04, 0.12, 0.16)
    b.poly([(-hx, y0 + h, -hz), (-hx, y0 + h, hz), (hx, y0 + h, hz), (hx, y0 + h, -hz)], WOOD, DARK_WOOD)   # ceiling


def plinth(b, w, d, y_top, depth=5.0, overhang=0.25):
    """Stone foundation from below the ground up to the floor level."""
    b.box((0, y_top - depth / 2, 0), (w + overhang * 2, depth, d + overhang * 2), STONE, STONE_T, skip=("bottom",))


def veranda(b, w, depth, y, side_z, posts=True):
    """Engawa: wooden deck along the front at floor height, with small posts."""
    z0 = side_z
    b.box((0, y - 0.05, z0 + depth / 2), (w, 0.1, depth), WOOD, PALE_WOOD)
    if posts:
        for x in np.linspace(-w / 2 + 0.15, w / 2 - 0.15, max(2, int(w / 1.8) + 1)):
            b.box((x, y - 0.6, z0 + depth - 0.12), (0.14, 1.1, 0.14), WOOD, POST_WOOD)


def hanging_lantern(b, pos, color=(1.0, 0.55, 0.3), r=0.27, h=0.5):
    x, y, z = pos
    b.cylinder((x, y - h, z), r, h, SHOJI, color, emit=1.6, segs=8)
    b.box((x, y + 0.02, z), (0.18, 0.06, 0.18), WOOD, BLACK_LACQUER)
    b.box((x, y - h - 0.03, z), (0.2, 0.06, 0.2), WOOD, BLACK_LACQUER)


def street_lantern(b, pos, height=1.9):
    """Andon-style wooden lamp post with a glowing paper box."""
    x, y, z = pos
    b.box((x, y + height / 2 - 0.25, z), (0.14, height - 0.5, 0.14), WOOD, POST_WOOD)
    b.box((x, y + height - 0.25, z), (0.42, 0.5, 0.42), SHOJI, (1.0, 0.72, 0.45), emit=1.5)
    b.box((x, y + height + 0.03, z), (0.56, 0.06, 0.56), WOOD, BLACK_LACQUER)
    b.box((x, y + height + 0.1, z), (0.36, 0.08, 0.36), WOOD, BLACK_LACQUER)


def stone_steps(b, a, c, width, step_rise=0.17):
    """Straight flight of stone steps from a (x,y,z) to c, each step a stone slab."""
    a, c = np.asarray(a, float), np.asarray(c, float)
    rise = c[1] - a[1]
    n = max(1, int(round(abs(rise) / step_rise)))
    run = np.array([c[0] - a[0], 0, c[2] - a[2]])
    L = np.linalg.norm(run)
    f = run / L
    ang = math.atan2(f[0], f[2])
    for k in range(n):
        p = a + run * ((k + 0.5) / n)
        y = a[1] + rise * (k + 1) / n
        b.box((p[0], y - 0.6, p[2]), (width, 1.2, L / n + 0.05), STONE, (0.78, 0.78, 0.8), rot_y=ang)
