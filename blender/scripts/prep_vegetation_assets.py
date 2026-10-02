"""One-time preparation of the downloaded tree and rock assets into clean prototypes
in the "VegProtos" collection (run once in Blender after importing them via the MCP):

  Fir_A, Fir_B       "Pine tree 01" by POLYSCAN3D (Sketchfab, CC-BY), split into its two trees
  Sakura             "Sakura Tree 01 - Low Poly Model" by thejogoss9 (Sketchfab, CC-BY)
  Pine_1..Pine_3     from "Scots Pine Trees Set" by c3posw01 (Sketchfab, CC-BY)
  Rock_1..Rock_7     Poly Haven rock_moss_set_01 and boulder_01 (CC0), decimated; *_LOD1 simpler

Each prototype has its base at the origin (trees: trunk base; rocks: bottom centre).
"""
import bpy, bmesh, math
import numpy as np

col = bpy.data.collections.get("VegProtos") or bpy.data.collections.new("VegProtos")
if col.name not in bpy.context.scene.collection.children:
    bpy.context.scene.collection.children.link(col)


def world_mesh_copy(objs, name):
    """Joins evaluated copies of objs (world transforms applied) into one new object."""
    dg = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    mats = []
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.transform(o.matrix_world)
        slot_map = []
        for m in me.materials:
            m = m.original if m is not None else m      # evaluated copies are not saved with the file
            if m not in mats:
                mats.append(m)
            slot_map.append(mats.index(m))
        n0 = len(bm.faces)
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        for f in bm.faces[n0:]:
            f.material_index = slot_map[f.material_index] if slot_map else 0
        ev.to_mesh_clear()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def base_to_origin(ob, trunk=True):
    """Moves geometry so the trunk base (lowest 2% of vertices) or bottom centre is at the origin."""
    co = np.empty(len(ob.data.vertices) * 3, np.float32)
    ob.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    zmin = co[:, 2].min()
    if trunk:
        low = co[co[:, 2] < zmin + 0.02 * (co[:, 2].max() - zmin) + 0.05]
        cx, cy = low[:, 0].mean(), low[:, 1].mean()
    else:
        cx, cy = (co[:, 0].min() + co[:, 0].max()) / 2, (co[:, 1].min() + co[:, 1].max()) / 2
    co -= np.array([cx, cy, zmin], np.float32)
    ob.data.vertices.foreach_set("co", co.ravel())
    ob.data.update()
    ob.location = (0, 0, 0)


def scale_to_height(ob, h):
    s = h / ob.dimensions.z
    ob.data.transform(__import__("mathutils").Matrix.Scale(s, 4))
    ob.data.update()


def remove_tree(root_name):
    root = bpy.data.objects.get(root_name)
    if root is None:
        return
    for o in list(root.children_recursive) + [root]:
        bpy.data.objects.remove(o, do_unlink=True)


for o in list(col.objects):
    bpy.data.objects.remove(o, do_unlink=True)
# the imported sakura source is also called "Sakura": free the name for the prototype
src_sak = bpy.data.objects.get("Sakura")
if src_sak is not None and src_sak.users_collection and src_sak.users_collection[0] != col:
    src_sak.name = "Sakura_src"

# ---- firs: one mesh containing two trees -> split by loose part clusters
src = bpy.data.objects["Sketchfab_model"]
fir_mesh = [o for o in src.children_recursive if o.type == 'MESH']
both = world_mesh_copy(fir_mesh, "FirBoth")
bm = bmesh.new(); bm.from_mesh(both.data)
islands = []
seen = set()
bm.verts.ensure_lookup_table()
for v in bm.verts:
    if v.index in seen:
        continue
    stack, isl = [v], []
    seen.add(v.index)
    while stack:
        u = stack.pop(); isl.append(u.index)
        for e in u.link_edges:
            w = e.other_vert(u)
            if w.index not in seen:
                seen.add(w.index); stack.append(w)
    islands.append(isl)
co = np.array([v.co[:] for v in bm.verts])
cent = np.array([co[i, :2].mean(0) for i in islands])
# two clusters along the axis of largest spread
axis = int(np.argmax(cent.max(0) - cent.min(0)))
split = (cent[:, axis].min() + cent[:, axis].max()) / 2
# use the two trunks (largest vertical extent islands) as seeds
ext = np.array([co[i, 2].max() - co[i, 2].min() for i in islands])
seeds = cent[np.argsort(ext)[-2:]]
label = np.argmin(((cent[:, None, :] - seeds[None]) ** 2).sum(-1), 1)
for k, name in enumerate(("Fir_A", "Fir_B")):
    keep = set(v for i, isl in enumerate(islands) if label[i] == k for v in isl)
    b2 = bm.copy()
    b2.verts.ensure_lookup_table()
    bmesh.ops.delete(b2, geom=[b2.verts[i] for i in range(len(b2.verts)) if i not in keep], context='VERTS')
    me = bpy.data.meshes.new(name); b2.to_mesh(me); b2.free()
    for m in both.data.materials:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me); col.objects.link(ob)
    base_to_origin(ob)
    scale_to_height(ob, 18.0 if name == "Fir_A" else 15.0)
bm.free()
bpy.data.objects.remove(both, do_unlink=True)

# ---- sakura
sak = [o for o in bpy.data.objects["Sketchfab_model.001"].children_recursive if o.type == 'MESH']
ob = world_mesh_copy(sak, "Sakura"); base_to_origin(ob); scale_to_height(ob, 7.5)

# ---- scots pines: pick three fuller trees, parts are named "<n>_Trunk", "<n>_Brunch", "<n>_Foliage_*"
pines = [o for o in bpy.data.objects["Sketchfab_model.002"].children_recursive if o.type == 'MESH']
groups = {}
for o in pines:
    key = o.name.split("_")[0] if o.name[0].isdigit() else o.parent.name.split("_")[0] if o.parent else None
    if key and key[0].isdigit():
        groups.setdefault(key, []).append(o)
sizes = {k: sum(len(o.data.polygons) for o in v) for k, v in groups.items()}
chosen = sorted(sizes, key=lambda k: -sizes[k])[:3]
for i, k in enumerate(chosen):
    ob = world_mesh_copy(groups[k], f"Pine_{i + 1}")
    base_to_origin(ob); scale_to_height(ob, [13.0, 11.0, 12.0][i])

# ---- rocks: decimate the photoscans; LOD1 is much simpler
rock_src = sorted([o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith("rock_moss_set_01_rock")], key=lambda o: o.name)
rock_src.append(bpy.data.objects["boulder_01_LOD0"])
for i, o in enumerate(rock_src):
    for lod, ratio_tris in ((0, 700), (1, 110)):
        name = f"Rock_{i + 1}" + ("_LOD1" if lod else "")
        ob = world_mesh_copy([o], name)
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        mod = ob.modifiers.new("Dec", 'DECIMATE'); mod.ratio = min(1.0, ratio_tris / tris)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        old = ob.data; ob.modifiers.clear(); ob.data = me; bpy.data.meshes.remove(old)
        me.materials.clear()
        base_to_origin(ob, trunk=False)
        me.polygons.foreach_set("use_smooth", np.ones(len(me.polygons), bool))
        # stored at unit-ish size: largest horizontal extent 2 m; placement scales them
        s = 2.0 / max(ob.dimensions.x, ob.dimensions.y)
        me.transform(__import__("mathutils").Matrix.Scale(s, 4)); me.update()

for o in col.objects:
    print(o.name, "tris", sum(len(p.vertices) - 2 for p in o.data.polygons), "dims", tuple(round(d, 1) for d in o.dimensions), "mats", [m.name for m in o.data.materials])
