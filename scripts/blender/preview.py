"""
Render a preview of each asset under club lighting (Section 14.1, step 6).

    blender -b <file.blend> -P scripts/blender/preview.py -- [--out assets/previews] [--only NAME] [--uv]

A dark room, a warm key, magenta and cyan rim lights from behind and a little
haze-like world glow, so you can see whether the asset reads in a club.
--uv adds a blacklight pass (deep violet light) for UV-glow materials.
Writes <out>/<name>.png at 1024 x 1024 with Eevee.

TODO: untested so far: Blender isn't available in the build container (see TODO.md).
"""
import math
import os
import re
import sys

import bpy  # type: ignore
from mathutils import Vector  # type: ignore

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
NAME = re.compile(r"^(character|outfit|hair|accessory|board|venue|prop|anim)_[a-z0-9]+(?:_[a-z0-9]+)*_\d{2}(?:_lod[0-3])?$")


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"out": os.path.join(ROOT, "assets", "previews"), "only": None, "uv": False}
    i = 0
    while i < len(argv):
        if argv[i] in ("--out", "--only"):
            out[argv[i][2:]] = argv[i + 1]
            i += 2
            continue
        if argv[i] == "--uv":
            out["uv"] = True
        i += 1
    return out


def bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
    if not pts:
        return Vector((0, 0, 0)), 1.0
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return (lo + hi) / 2, max((hi - lo).length, 0.05)


def light(name, kind, energy, color, loc, size=1.0):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    data.color = color
    if kind == "AREA":
        data.size = size
    obj = bpy.data.objects.new(name, data)
    obj.location = loc
    bpy.context.scene.collection.objects.link(obj)
    return obj


def aim(obj, target):
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def main():
    a = args()
    os.makedirs(a["out"], exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items} else "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 1024
    scene.render.film_transparent = False
    world = scene.world or bpy.data.worlds.new("preview")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.012, 0.01, 0.02, 1)

    assets = [(c.name, list(c.all_objects)) for c in scene.collection.children if NAME.match(c.name)]
    if not assets:
        assets = [(o.name, [o] + list(o.children_recursive)) for o in scene.collection.all_objects if o.parent is None and NAME.match(o.name)]
    if a["only"]:
        assets = [x for x in assets if x[0] == a["only"]]

    for name, objs in assets:
        centre, size = bounds(objs)
        d = size * 1.6
        rig = [
            light("key", "AREA", 400 * size * size, (1.0, 0.71, 0.28), centre + Vector((d, -d, d * 0.8)), size),
            light("rim_pink", "AREA", 600 * size * size, (1.0, 0.18, 0.53), centre + Vector((-d, d, d * 0.6)), size),
            light("rim_cyan", "AREA", 500 * size * size, (0.15, 0.85, 1.0), centre + Vector((d, d, d * 0.3)), size),
        ]
        if a["uv"]:
            rig.append(light("uv", "AREA", 900 * size * size, (0.48, 0.24, 1.0), centre + Vector((0, -d, d)), size * 2))
        for l in rig:
            aim(l, centre)
        cam_data = bpy.data.cameras.new("preview_cam")
        cam_data.lens = 50
        cam = bpy.data.objects.new("preview_cam", cam_data)
        cam.location = centre + Vector((d * 0.9, -d * 1.3, d * 0.55))
        scene.collection.objects.link(cam)
        aim(cam, centre)
        scene.camera = cam
        # show only this asset
        for o in scene.objects:
            if o.type == "MESH":
                o.hide_render = o not in objs
        scene.render.filepath = os.path.join(a["out"], name + ("_uv" if a["uv"] else "") + ".png")
        bpy.ops.render.render(write_still=True)
        print(f"preview {scene.render.filepath}")
        for o in rig + [cam]:
            bpy.data.objects.remove(o, do_unlink=True)


main()
