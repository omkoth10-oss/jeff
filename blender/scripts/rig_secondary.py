"""Adds secondary-motion bones to the ninja for the game's spring dynamics
(src/game/proc/springs.js) and exports the character in its rest pose (no clips: all
animation is procedural, src/game/proc/).

Run inside Blender (props.blend):
    exec(open(os.path.expanduser("~/moonlit-village/blender/scripts/rig_secondary.py")).read())

Bones (all new, parented to the existing Character Creator bones):
  Sword          the sword and scabbard across the back (rigid), on Spine02, pivoting at
                 the middle of the back where the strap holds it
  HoodTip        the peak of the hood behind the head, on Head
  HoodCape       the hood's short cape over the upper back, on Spine02
  Skirt_FL/FR/BL/BR   the coat panels below the belt, on Pelvis, hanging from the belt
The mesh is one object of many separate pieces (islands); parts are found by geometry.
Skirt panels keep part of their thigh weights so they still follow the legs; the springs
add the swing on top.
Output: blender/exports/ninja_rig_raw.glb (compressed into public/models/ninja.glb by
the caller with gltf-transform).
"""
import bpy, bmesh, os
import numpy as np
from mathutils import Vector

ROOT = os.path.expanduser("~/moonlit-village")
rig = bpy.data.objects["NinjaRig"]
mesh = bpy.data.objects["Ninja"]
me = mesh.data
co = np.array([v.co[:] for v in me.vertices])
BONE = {b.name.rsplit("_", 1)[0]: b.name for b in rig.data.bones if "scaleComp" not in b.name}


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- islands
bm = bmesh.new()
bm.from_mesh(me)
bm.verts.ensure_lookup_table()
seen = np.zeros(len(co), bool)
islands = []
for v in bm.verts:
    if seen[v.index]:
        continue
    st, comp = [v], []
    seen[v.index] = True
    while st:
        w = st.pop()
        comp.append(w.index)
        for e in w.link_edges:
            o = e.other_vert(w)
            if not seen[o.index]:
                seen[o.index] = True
                st.append(o)
    islands.append(np.array(comp))
bm.free()

# sword: a straight line of pieces across the back
back = co[co[:, 1] > 0.17]
c0 = back.mean(0)
axis = np.linalg.svd(back - c0)[2][0]
if axis[2] < 0:
    axis = -axis  # points toward the hilt (up)


def line_dist(p):
    d = p - c0
    return np.linalg.norm(d - np.outer(d @ axis, axis), axis=1)


sword = np.zeros(len(co), bool)
for c in islands:
    p = co[c]
    if line_dist(p.mean(0)[None])[0] < 0.07 and p[:, 1].mean() > 0.15 and line_dist(p).max() < 0.16:
        sword[c] = True
t = (co[sword] - c0) @ axis
print("sword: %d verts, along axis %.2f..%.2f" % (sword.sum(), t.min(), t.max()))

# hood: the pieces that reach the top of the head
hood = np.zeros(len(co), bool)
for c in islands:
    p = co[c]
    top = p[:, 2].max() > 1.52 and np.abs(p[:, 0]).max() < 0.3
    cape = p[:, 2].max() > 1.40 and p[:, 2].min() < 1.25 and p[:, 1].mean() > 0.05 and np.abs(p[:, 0]).max() < 0.25
    if (top or cape) and not sword[c].any():
        hood[c] = True
print("hood: %d verts, z %.2f..%.2f" % (hood.sum(), co[hood, 2].min(), co[hood, 2].max()))

# coat skirt panels: pieces that end at ~0.67 m and reach up past the belt
skirt = np.zeros(len(co), bool)
for c in islands:
    p = co[c]
    if 0.62 < p[:, 2].min() < 0.73 and p[:, 2].max() > 0.93 and not sword[c].any():
        skirt[c] = True
print("skirt: %d verts" % skirt.sum())

# ---------------------------------------------------------------- bones
bpy.context.view_layer.objects.active = rig
for o in bpy.context.view_layer.objects:
    o.select_set(False)
rig.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
eb = rig.data.edit_bones
for name in ("Sword", "HoodTip", "HoodCape", "Skirt_FL", "Skirt_FR", "Skirt_BL", "Skirt_BR"):
    if name in eb:
        eb.remove(eb[name])


def add_bone(name, head, tail, parent):
    b = eb.new(name)
    b.head, b.tail = Vector(head), Vector(tail)
    b.parent = eb[BONE[parent]]
    b.use_deform = True
    return b


pivot = c0 + axis * 0.05  # where the strap crosses the scabbard
add_bone("Sword", pivot, pivot + Vector(axis) * 0.35, "CC_Base_Spine02")
hood_top_back = co[hood][np.argmax(co[hood, 1] + 0.5 * co[hood, 2])]
add_bone("HoodTip", (0, 0.07, 1.44), hood_top_back, "CC_Base_Head")
add_bone("HoodCape", (0, 0.13, 1.34), (0, 0.17, 1.16), "CC_Base_Spine02")
belt_z, hem_z = 1.0, 0.68
# panels hang from the belt ring around the hips (-y is the front)
for name, ang in (("Skirt_FL", 35), ("Skirt_FR", -35), ("Skirt_BL", 145), ("Skirt_BR", -145)):
    a = np.radians(ang)
    dx, dy = np.sin(a), -np.cos(a)
    add_bone(name, (0.15 * dx, 0.15 * dy + 0.01, belt_z), (0.19 * dx, 0.19 * dy + 0.01, hem_z), "CC_Base_Pelvis")
bpy.ops.object.mode_set(mode="OBJECT")

# ---------------------------------------------------------------- weights
groups = {g.index: g.name for g in mesh.vertex_groups}


def group(name):
    return mesh.vertex_groups.get(name) or mesh.vertex_groups.new(name=name)


def transfer(idx, new_weights):
    """new_weights: {group: w per vertex}; existing weights scale by (1 - sum)."""
    total = sum(new_weights.values())
    for k, vi in enumerate(idx):
        s = float(total[k])
        if s <= 1e-4:
            continue
        v = me.vertices[vi]
        for g in list(v.groups):
            mesh.vertex_groups[g.group].add([int(vi)], g.weight * (1 - s), "REPLACE")
        for name, w in new_weights.items():
            if w[k] > 1e-4:
                group(name).add([int(vi)], float(w[k]), "REPLACE")


# sword: rigid on its own bone
si = np.where(sword)[0]
for g in list(mesh.vertex_groups):
    if g.name != "Sword":
        g.remove(si.tolist())
group("Sword").add(si.tolist(), 1.0, "REPLACE")

# hood peak: graded toward the back-top; the cape: graded down the back
hi = np.where(hood)[0]
p = co[hi]
tip = smooth(0.06, 0.18, p[:, 1]) * smooth(1.36, 1.46, p[:, 2])
cape = smooth(0.08, 0.16, p[:, 1]) * smooth(1.34, 1.18, p[:, 2]) * (1 - tip)
transfer(hi, {"HoodTip": tip * 0.9, "HoodCape": cape * 0.8})

# skirt: the part below the belt, shared between the four panels by direction
ki = np.where(skirt)[0]
p = co[ki]
h = smooth(belt_z, hem_z + 0.04, p[:, 2]) * 0.65
ang = np.degrees(np.arctan2(p[:, 0], -(p[:, 1] - 0.01)))
w = {}
for name, a in (("Skirt_FL", 35), ("Skirt_FR", -35), ("Skirt_BL", 145), ("Skirt_BR", -145)):
    d = np.abs((ang - a + 180) % 360 - 180)
    w[name] = np.clip(1 - d / 110.0, 0, 1) ** 2
norm = sum(w.values()) + 1e-6
transfer(ki, {n: h * v / norm for n, v in w.items()})

# normalise every vertex to 1
for v in me.vertices:
    s = sum(g.weight for g in v.groups)
    if s > 0 and abs(s - 1) > 1e-3:
        for g in v.groups:
            g.weight /= s
print("weights done")

# ---------------------------------------------------------------- export (rest pose, no clips)
rig.data.pose_position = "POSE"
if rig.animation_data:
    rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.matrix_basis.identity()
out = os.path.join(ROOT, "blender", "exports", "ninja_rig_raw.glb")
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
for o in (rig, mesh):
    o.hide_set(False)
    o.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=out, use_selection=True, export_animations=False, export_def_bones=False,
                          export_cameras=False, export_lights=False, export_apply=False)
print("exported", out, os.path.getsize(out) // 1024, "KB")
