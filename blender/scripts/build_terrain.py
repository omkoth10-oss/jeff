"""Builds the terrain, water and collision meshes and the valley ground-texture map.

Run inside Blender (through the Blender MCP):
    exec(open(os.path.expanduser("~/moonlit-village/blender/scripts/build_terrain.py")).read())

Outputs (public/):
  models/terrain.glb    render terrain, in chunks three.js can frustum-cull:
                        Valley_*  1 m grid over the walkable valley (0.5 m around the ledge)
                        Terrain_* polar grids for everything else, out to the far range
  models/water.glb      waterfall sheets, the upper river and the waterfall-2 stream
  models/collision.glb  Ground: simplified walkable ground (2 m grid over the play area)
                        Bounds: invisible walls around the play area
  textures/valley_splat.ktx2  ground-texture weights over the valley rectangle:
                        R stone path, G dirt trail/worn earth, B wet mud, A grass

Collision plan (used by the controller in step 6): the player capsule collides with
Ground and Bounds from collision.glb plus the COL_* boxes exported with each building
(step 3). Stairs are ramps in Ground. The river is shallow; the controller treats
ground below water level - 0.4 m as not walkable, so the bridge is the crossing.
"""
import bpy, os, sys, importlib, time, subprocess
import numpy as np

SCRIPTS = os.path.expanduser("~/moonlit-village/blender/scripts")
ROOT = os.path.expanduser("~/moonlit-village")
sys.path.insert(0, SCRIPTS)
import terrain_lib as T
importlib.reload(T)

OUT = os.path.join(ROOT, "public", "models")
ANGULAR = 900            # near polar grid: 0.4 degree segments
ANGULAR_FAR = 1200       # far polar grid: 0.3 degree segments
R_SPLIT = 1000.0         # near polar grid out to here, far grid beyond (with a skirt)
R_MAX = 5200.0
DECIMATE_NEAR = 0.4
DECIMATE_FAR = 0.45
DECIMATE_VALLEY = 0.3
SPLAT_RES = 0.4          # metres per ground-texture texel
t0 = time.time()


def log(msg):
    print(f"{msg}  ({time.time() - t0:.1f}s)")


def to_blender(x, y, z):
    return np.stack([x, -z, y], -1)


def clear_collection(name):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
    for o in list(col.objects):
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if me and me.users == 0:
            bpy.data.meshes.remove(me)
    return col


def material(name, color):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = 1.0
    return m


def mesh_from_arrays(name, co, tris, normals=None, colors=None, uvs=None):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(co))
    me.vertices.foreach_set("co", co.astype(np.float32).ravel())
    me.loops.add(len(tris) * 3)
    me.loops.foreach_set("vertex_index", tris.astype(np.int32).ravel())
    me.polygons.add(len(tris))
    me.polygons.foreach_set("loop_start", np.arange(0, len(tris) * 3, 3, dtype=np.int32))
    me.update(calc_edges=True)
    me.polygons.foreach_set("use_smooth", np.ones(len(tris), bool))
    if normals is not None:
        me.normals_split_custom_set_from_vertices(normals.astype(np.float32))
    if colors is not None:
        attr = me.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
        attr.data.foreach_set("color", colors.astype(np.float32).ravel())
        me.color_attributes.active_color = attr
    if uvs is not None:
        uv = me.uv_layers.new(name="UVMap")
        uv.data.foreach_set("uv", uvs[tris.ravel()].astype(np.float32).ravel())
    return me


def decimate(co, tris, ratio, name, col, keep=None):
    """Collapse-decimates to `ratio` of the faces. `keep` (0..1 per vertex) protects
    regions: vertices outside the decimate vertex group get an extra collapse cost."""
    full = bpy.data.objects.new(name, mesh_from_arrays(name, co, tris))
    col.objects.link(full)
    mod = full.modifiers.new("Decimate", 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    if keep is not None:
        vg = full.vertex_groups.new(name="decimate")
        allow = 1.0 - np.clip(keep, 0.0, 1.0)
        for w in np.unique(np.round(allow, 2)):
            idx = np.nonzero(np.round(allow, 2) == w)[0].tolist()
            if w > 0 and idx:
                vg.add(idx, float(w), 'REPLACE')
        mod.vertex_group = "decimate"
        mod.vertex_group_factor = 60.0
    dg = bpy.context.evaluated_depsgraph_get()
    dec = bpy.data.meshes.new_from_object(full.evaluated_get(dg))
    nv = len(dec.vertices)
    dco = np.empty(nv * 3, np.float32); dec.vertices.foreach_get("co", dco)
    nrm = np.empty(nv * 3, np.float32); dec.vertex_normals.foreach_get("vector", nrm)
    ltot = np.empty(len(dec.polygons), np.int32); dec.polygons.foreach_get("loop_total", ltot)
    assert (ltot == 3).all()
    dtri = np.empty(len(dec.loops), np.int32); dec.loops.foreach_get("vertex_index", dtri)
    bpy.data.meshes.remove(dec)
    me = full.data
    bpy.data.objects.remove(full, do_unlink=True)
    bpy.data.meshes.remove(me)
    return dco.reshape(-1, 3), nrm.reshape(-1, 3), dtri.reshape(-1, 3)


def check_up(co, tris):
    e1 = co[tris[:, 1]] - co[tris[:, 0]]
    e2 = co[tris[:, 2]] - co[tris[:, 0]]
    assert (np.cross(e1, e2)[:, 2] > 0).all(), "some terrain faces point down"


# ------------------------------------------------------------------ grids
def ring_radii(r0, r1, grow, min_step):
    out, r = [r0], r0
    while r < r1:
        r += max(min_step, grow * r)
        out.append(min(r, r1))
    return np.array(out)


def in_valley(px, pz, inset):
    x0, x1, z0, z1 = T.VALLEY_RECT
    return (px > x0 + inset) & (px < x1 - inset) & (pz > z0 + inset) & (pz < z1 - inset)


def polar_grid(radii, angular, skirt=0.0):
    """Rings of vertices around the ledge. With skirt > 0 the innermost ring is
    lowered so it tucks under the mesh inside it (hides the seam between grids).
    Vertices inside the valley rectangle are lowered too: the valley mesh covers them."""
    theta = np.arange(angular) * (2 * np.pi / angular)
    R, TH = np.meshgrid(radii, theta, indexing="ij")
    px, pz = (R * np.sin(TH)).ravel(), (-R * np.cos(TH)).ravel()
    center = radii[0] == 0.0
    if center:
        px, pz = px[angular - 1:], pz[angular - 1:]   # ring 0 collapses to one vertex
    py, _ = T.height(px, pz)
    if skirt:
        py[:angular] -= skirt
    py -= 0.6 * in_valley(px, pz, -1.0)
    co = to_blender(px, py, pz)
    j = np.arange(angular)
    jn = (j + 1) % angular
    off = 1 if center else 0
    k = np.arange(len(radii) - 1 - off)[:, None]
    a = off + k * angular + j
    b = off + k * angular + jn
    c = off + (k + 1) * angular + jn
    d = off + (k + 1) * angular + j
    tris = [np.stack([a, b, c], -1).reshape(-1, 3), np.stack([a, c, d], -1).reshape(-1, 3)]
    if center:
        tris.insert(0, np.stack([np.zeros(angular, int), 1 + jn, 1 + j], -1))
    tris = np.concatenate(tris)
    # drop triangles fully inside the valley rectangle (inset so the meshes overlap a little)
    inside = in_valley(px, pz, 3.0)
    tris = tris[~inside[tris].all(1)]
    check_up(co, tris)
    return co, tris


def axis(lo, hi, step, fine=None, fine_step=None):
    """Grid coordinates with an optional finer band."""
    if fine is None:
        return np.arange(lo, hi + 1e-6, step)
    a = np.arange(lo, fine[0], step)
    b = np.arange(fine[0], fine[1], fine_step)
    c = np.arange(fine[1], hi + 1e-6, step)
    return np.concatenate([a, b, c])


def rect_grid(xs, zs):
    X, Z = np.meshgrid(xs, zs)
    px, pz = X.ravel(), Z.ravel()
    py, masks = T.height(px, pz)
    co = to_blender(px, py, pz)
    nx = len(xs)
    i = (np.arange(len(zs) - 1)[:, None] * nx + np.arange(nx - 1)[None, :]).ravel()
    tris = np.concatenate([np.stack([i, i + 1, i + nx + 1], -1), np.stack([i, i + nx + 1, i + nx], -1)])
    e1 = co[tris[:, 1]] - co[tris[:, 0]]
    e2 = co[tris[:, 2]] - co[tris[:, 0]]
    if np.cross(e1, e2)[0, 2] < 0:          # make the winding counter-clockwise from above
        tris = tris[:, [0, 2, 1]]
    check_up(co, tris)
    return co, tris, (px, pz, py, masks)


col = clear_collection("Terrain")
x0, x1, z0, z1 = T.VALLEY_RECT
co, tris, (_, _, _, vmask) = rect_grid(axis(x0, x1, 1.0, (-16, 14), 0.5), axis(z0, z1, 1.0, (-14, 12), 0.5))
log(f"valley grid: {len(co)} verts, {len(tris)} tris")
# streets, stairs and building pads keep their full resolution: decimating them rounded
# off the edges of the stair cuts (ground poking above the steps, a 55-degree lip the
# player could not climb)
grids = {"v": decimate(co, tris, DECIMATE_VALLEY, "TerrainValley", col, keep=vmask["grade"])}
near_r = np.concatenate([[0.0], ring_radii(0.6, R_SPLIT, 0.016, 0.6)])
co, tris = polar_grid(near_r, ANGULAR)
log(f"near grid: {len(co)} verts, {len(tris)} tris")
grids["n"] = decimate(co, tris, DECIMATE_NEAR, "TerrainNear", col)
co, tris = polar_grid(ring_radii(R_SPLIT - 12, R_MAX, 0.011, 1.0), ANGULAR_FAR, skirt=4.0)
log(f"far grid: {len(co)} verts, {len(tris)} tris")
grids["f"] = decimate(co, tris, DECIMATE_FAR, "TerrainFar", col)
log("decimated: " + ", ".join(f"{k} {len(v[2])}" for k, v in grids.items()))


# ------------------------------------------------------------------ material masks + chunks
def masks(dco):
    vx, vz, vy = dco[:, 0], -dco[:, 1], dco[:, 2]
    _, m = T.height(vx.astype(np.float64), vz.astype(np.float64))
    # the whole face of the west wall, ledges included (wooded rock ledges on the escarpment)
    rock = T.smoothstep(-m["width_w"] - 3, -m["width_w"] + 2, m["sd_w"]) * T.smoothstep(1.5, -0.5, m["sd_w"])
    rock = np.maximum(rock, T.smoothstep(9.0, 6.0, np.hypot(vx, vz)))                  # the ninja's ledge
    snow = T.smoothstep(900, 1700, m["r"])
    return np.stack([rock, np.zeros_like(rock), snow, np.zeros_like(rock)], -1)


# Draco quantizes positions on a grid spanning each mesh's bounding box. Every chunk
# gets one zero-area triangle through the same two far corners, so all chunks share
# one grid and their shared edge vertices land on identical values (no cracks).
# three.js skips these sentinel vertices when it computes the chunk bounds.
SENTINEL = to_blender(np.array([-5300.0, 5300.0]), np.array([-60.0, 900.0]), np.array([-5300.0, 5300.0]))
terrain_mat = material("Terrain", (0.2, 0.22, 0.2))


def add_chunk(name, dco, nrm, colors, ftri, col):
    vids, remap = np.unique(ftri, return_inverse=True)
    n = len(vids)
    cco = np.concatenate([dco[vids], SENTINEL[[0, 1, 1]]])
    ctri = np.concatenate([remap.reshape(-1, 3), [[n, n + 1, n + 2]]])
    cnrm = np.concatenate([nrm[vids], [[0, 0, 1]] * 3])
    ccol = np.concatenate([colors[vids], np.zeros((3, 4))])
    me = mesh_from_arrays(name, cco, ctri, cnrm, ccol)
    me.materials.append(terrain_mat)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


chunks = []
for ring, count in (("n", 8), ("f", 12)):
    dco, nrm, dtri = grids[ring]
    colors = masks(dco)
    cx = dco[dtri, 0].mean(1); cz = -dco[dtri, 1].mean(1)
    ct = (np.degrees(np.arctan2(cx, -cz)) + 360) % 360
    for s_ in range(count):
        sel = (ct >= s_ * 360 / count) & (ct < (s_ + 1) * 360 / count)
        if sel.any():
            chunks.append(add_chunk(f"Terrain_{ring}{s_}", dco, nrm, colors, dtri[sel], col))
# valley: tiles of about 70 x 85 m
dco, nrm, dtri = grids["v"]
colors = masks(dco)
cx = dco[dtri, 0].mean(1); cz = -dco[dtri, 1].mean(1)
tx = np.clip(((cx - x0) / (x1 - x0) * 4).astype(int), 0, 3)
tz = np.clip(((cz - z0) / (z1 - z0) * 5).astype(int), 0, 4)
for i in range(4):
    for j in range(5):
        sel = (tx == i) & (tz == j)
        if sel.any():
            chunks.append(add_chunk(f"Valley_{i}{j}", dco, nrm, colors, dtri[sel], col))
log(f"{len(chunks)} chunks")


# ------------------------------------------------------------------ valley ground-texture map
def build_splat():
    nx = int(round((x1 - x0) / SPLAT_RES / 4)) * 4
    nz = int(round((z1 - z0) / SPLAT_RES / 4)) * 4
    xs = x0 + (np.arange(nx) + 0.5) * (x1 - x0) / nx
    zs = z0 + (np.arange(nz) + 0.5) * (z1 - z0) / nz
    X, Z = np.meshgrid(xs, zs)
    px, pz = X.ravel(), Z.ravel()
    py, m = T.height(px, pz)
    # stone for streets and stairs, dirt for the trail
    stone = np.zeros_like(px)
    dirt = np.zeros_like(px)
    for name, (pts, y, p) in T._PROFILES.items():
        d, _, _, _ = T.polyline(px, pz, pts, max_dist=6)
        half = p["width"] * 0.5
        edge = half + 0.25 * T.N[9](px / 1.3, pz / 1.3)                  # ragged path edges
        w = T.smoothstep(edge + 0.3, edge - 0.3, d)
        if p["kind"] == "trail":
            dirt = np.maximum(dirt, w)
        else:
            stone = np.maximum(stone, w)
            dirt = np.maximum(dirt, 0.3 * T.smoothstep(edge + 0.9, edge, d))   # worn verge
    for pad in T.PADS.values():
        u, v = T.pad_local(px, pz, pad)
        inside = np.maximum(np.abs(u) - pad["size"][0] / 2, np.abs(v) - pad["size"][1] / 2)
        dirt = np.maximum(dirt, T.smoothstep(1.0, -0.5, inside))
    wet = T.smoothstep(2.5, -0.5, m["d_water"]) * (1 - stone)
    # grass in the village basin and on gentle ground; forest floor on slopes and hills
    basin = T.smoothstep(9.0, 5.0, py) * T.inside_polygon(px, pz, T.PLAY_AREA)
    grass = np.clip(basin * (0.55 + 0.9 * T.fbm(T.N[11], px / 18, pz / 18, 3)), 0, 1) * (1 - stone) * (1 - wet)
    return np.stack([stone, dirt * (1 - stone), wet, grass], -1).reshape(nz, nx, 4)


def save_ktx2(img, name):
    """Writes an RGBA image as PNG via Blender, then encodes linear UASTC KTX2.
    Row 0 of the image is the north edge (min z)."""
    h, w, _ = img.shape
    im = bpy.data.images.new(name, w, h, alpha=True)
    im.colorspace_settings.name = "Non-Color"
    im.pixels.foreach_set(img[::-1].astype(np.float32).ravel())      # Blender rows run bottom-up
    png = os.path.join(ROOT, "blender", "textures_src", f"{name}.png")
    im.filepath_raw = png
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)
    out = os.path.join(ROOT, "public", "textures", f"{name}.ktx2")
    subprocess.run([os.path.join(ROOT, "tools", "ktx", "bin", "toktx"), "--t2", "--encode", "uastc",
                    "--uastc_quality", "2", "--zcmp", "19", "--assign_oetf", "linear", "--genmipmap",
                    out, png], check=True)
    return out


splat_path = save_ktx2(build_splat(), "valley_splat")
log(f"valley_splat.ktx2 {os.path.getsize(splat_path) / 1024:.0f} KB")


# ------------------------------------------------------------------ collision
def build_collision(col):
    # simplified walkable ground over the play area (plus a margin)
    cx0, cx1 = min(p[0] for p in T.PLAY_AREA) - 8, max(p[0] for p in T.PLAY_AREA) + 8
    cz0, cz1 = min(p[1] for p in T.PLAY_AREA) - 8, max(p[1] for p in T.PLAY_AREA) + 8
    co, tris, (px, pz, _, _) = rect_grid(axis(cx0, cx1, 2.0), axis(cz0, cz1, 2.0))
    outline = T.PLAY_AREA + [T.PLAY_AREA[0]]
    near = T.inside_polygon(px, pz, T.PLAY_AREA) | (T.polyline(px, pz, outline)[0] < 8)
    tris = tris[near[tris].any(1)]
    gco, _, gtri = decimate(co, tris, 0.5, "CollisionGround", col)
    ground = bpy.data.objects.new("Ground", mesh_from_arrays("Ground", gco, gtri))
    col.objects.link(ground)
    # bounds: walls along the play-area outline, from 2 m below to 8 m above the ground
    P = np.array(outline, float)
    pts = []
    for a, b in zip(P[:-1], P[1:]):
        n = max(1, int(np.hypot(*(b - a)) / 3))
        pts += [a + (b - a) * t for t in np.arange(n) / n]
    pts = np.array(pts + [P[0]])
    gy, _ = T.height(pts[:, 0], pts[:, 1])
    wco = np.concatenate([to_blender(pts[:, 0], gy - 2, pts[:, 1]), to_blender(pts[:, 0], gy + 8, pts[:, 1])])
    m = len(pts)
    i = np.arange(m - 1)
    wtri = np.concatenate([np.stack([i, i + 1, m + i + 1], -1), np.stack([i, m + i + 1, m + i], -1)])
    bounds = bpy.data.objects.new("Bounds", mesh_from_arrays("Bounds", wco, wtri))
    col.objects.link(bounds)
    return [ground, bounds]


ccol = clear_collection("Collision")
collision_objs = build_collision(ccol)
log(f"collision: ground {len(collision_objs[0].data.polygons)} tris")


# ------------------------------------------------------------------ water: waterfalls, upper river, stream
def waterfall_sheet(name, wf, across_segs=10, fall_segs=18):
    tx, ty, tz = wf["top"]
    fx, fy, fz = wf["foot"]
    ax, az = fx - tx, fz - tz
    L = np.hypot(ax, az)
    ox, oz = az / L, -ax / L                      # across direction
    u = np.linspace(0, 1, fall_segs + 1)[:, None]
    v = np.linspace(-0.5, 0.5, across_segs + 1)[None, :]
    width = wf["width_top"] + (wf["width_foot"] - wf["width_top"]) * u
    bulge = 0.35 * np.cos(v * np.pi) * np.sin(u * np.pi)   # slight convex curtain
    x = tx + ax * u + ox * v * width + (ax / L) * bulge
    z = tz + az * u + oz * v * width + (az / L) * bulge
    y = T.waterfall_y(wf, u) + 0 * v
    co = to_blender(x.ravel(), y.ravel(), z.ravel())
    # uv.x across (0..1), uv.y = metres fallen / 10, so the shader scrolls at a physical speed
    seg_len = np.hypot(np.hypot(np.diff(x[:, 0]), np.diff(z[:, 0])), np.diff(y[:, 0]))
    dist = np.concatenate([[0], np.cumsum(seg_len)])
    uvs = np.stack([np.broadcast_to(v + 0.5, x.shape).ravel(), 1 - np.broadcast_to(dist[:, None] / 10, x.shape).ravel()], -1)
    n = across_segs + 1
    i = np.arange(fall_segs)[:, None] * n + np.arange(across_segs)[None, :]
    tris = np.concatenate([np.stack([i, i + n, i + n + 1], -1).reshape(-1, 3), np.stack([i, i + n + 1, i + 1], -1).reshape(-1, 3)])
    return mesh_from_arrays(name, co, tris, uvs=uvs)


def river_ribbon(name, pts, levels, extra=3.0, step=2.0):
    P = np.array([p[:2] for p in pts], float)
    W = np.array([p[2] for p in pts], float)
    seg = np.hypot(*np.diff(P, axis=0).T)
    cum = np.concatenate([[0], np.cumsum(seg)])
    s = np.arange(0, cum[-1], step)
    x = np.interp(s, cum, P[:, 0]); z = np.interp(s, cum, P[:, 1])
    w = np.interp(s, cum, W) * 0.5 + extra
    y = np.interp(s, np.linspace(0, cum[-1], len(levels)) if len(levels) != len(P) else cum, levels)
    tx, tz = np.gradient(x), np.gradient(z)
    tl = np.hypot(tx, tz)
    nx, nz = tz / tl, -tx / tl
    xs = np.stack([x - nx * w, x + nx * w], -1)
    zs = np.stack([z - nz * w, z + nz * w], -1)
    ys = np.stack([y, y], -1)
    co = to_blender(xs.ravel(), ys.ravel(), zs.ravel())
    uvs = np.stack([np.tile([0.0, 1.0], len(s)), np.repeat(s / 10, 2)], -1)
    i = np.arange(len(s) - 1) * 2
    tris = np.concatenate([np.stack([i, i + 1, i + 3], -1), np.stack([i, i + 3, i + 2], -1)])
    return mesh_from_arrays(name, co, tris, uvs=uvs)


wcol = clear_collection("Water")
fall_mat = material("Waterfall", (0.8, 0.9, 1.0))
water_mat = material("Water", (0.05, 0.1, 0.2))
water_objs = []
for name, wf in (("Waterfall1", T.WATERFALL1), ("Waterfall2", T.WATERFALL2)):
    me = waterfall_sheet(name, wf)
    me.materials.append(fall_mat)
    ob = bpy.data.objects.new(name, me); wcol.objects.link(ob); water_objs.append(ob)
    for tag, key in (("Foot", "foot"), ("Top", "top")):
        e = bpy.data.objects.new(f"{name}{tag}", None)
        e.location = to_blender(*[np.array(c) for c in wf[key]])
        wcol.objects.link(e); water_objs.append(e)
for name, pts, levels, extra in (("UpperRiver", T.UPPER, T.UPPER_LEVEL, 3.0), ("Stream2", T.STREAM2, T.STREAM2_LEVEL, 1.2)):
    me = river_ribbon(name, pts, levels, extra=extra)
    me.materials.append(water_mat)
    ob = bpy.data.objects.new(name, me); wcol.objects.link(ob); water_objs.append(ob)
# marker for the reserved shop lot (the enterable shop goes here later)
lot = T.PADS["shop_lot"]
e = bpy.data.objects.new("ShopLot", None)
ly, _ = T.height(np.array([lot["center"][0]]), np.array([lot["center"][1]]))
e.location = to_blender(np.array(lot["center"][0]), ly[0], np.array(lot["center"][1]))
e.rotation_euler = (0, 0, np.radians(lot["angle"]))
wcol.objects.link(e); water_objs.append(e)


# ------------------------------------------------------------------ export
def export(objs, path, pos_bits):
    assert all(o.visible_get() for o in objs), "hidden objects would be skipped by the exporter"
    import logging
    logging.disable(logging.INFO)   # the glTF exporter logs every primitive
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path, use_selection=True, export_apply=True, export_normals=True,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
        export_draco_position_quantization=pos_bits, export_draco_normal_quantization=10,
        export_draco_color_quantization=8, export_draco_texcoord_quantization=12,
        export_cameras=False, export_lights=False)
    logging.disable(logging.NOTSET)
    print(os.path.basename(path), f"{os.path.getsize(path) / 1024:.0f} KB")


# ------------------------------------------------------------------ layout data for the web app
import json


def write_layout():
    paths = {}
    for name, (pts, y, p) in T._PROFILES.items():
        paths[name] = dict(kind=p["kind"], width=p["width"],
                           points=[[round(float(x), 2), round(float(h), 2), round(float(z), 2)] for (x, z), h in zip(pts[::2], y[::2])])
    layout = dict(
        waterLevel=T.WATER,
        valleyRect=list(T.VALLEY_RECT),
        playArea=[list(p) for p in T.PLAY_AREA],
        paths=paths,
        pads={k: dict(center=list(v["center"]), size=list(v["size"]), angle=v["angle"],
                      y=round(float(T.height(np.array([v["center"][0]]), np.array([v["center"][1]]))[0][0]), 2))
              for k, v in T.PADS.items()},
        waterfalls=[dict(top=list(w["top"]), foot=list(w["foot"]), widthTop=w["width_top"], widthFoot=w["width_foot"])
                    for w in (T.WATERFALL1, T.WATERFALL2)],
        # water centrelines for the water shader's flow and shoreline: [x, z, width, level]
        rivers=dict(
            main=[[round(float(x), 2), round(float(z), 2), round(float(w), 2), T.WATER] for x, z, w in T.RIVER],
            upper=[[x, z, w, lv] for (x, z, w), lv in zip(T.UPPER, T.UPPER_LEVEL)],
            stream2=[[x, z, w, lv] for (x, z, w), lv in zip(T.STREAM2, T.STREAM2_LEVEL)],
        ),
    )
    os.makedirs(os.path.join(ROOT, "public", "data"), exist_ok=True)
    with open(os.path.join(ROOT, "public", "data", "layout.json"), "w") as f:
        json.dump(layout, f, separators=(",", ":"))


write_layout()
export(chunks, os.path.join(OUT, "terrain.glb"), 18)
export(water_objs, os.path.join(OUT, "water.glb"), 14)
export(collision_objs, os.path.join(OUT, "collision.glb"), 16)
tri_total = sum(len(o.data.polygons) for o in chunks)
log(f"terrain tris {tri_total}, done")
