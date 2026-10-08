"""
Export a .blend's assets to engine-ready GLB, checking the pipeline rules first.

    blender -b <file.blend> -P scripts/blender/export_glb.py -- [--out assets/models] [--only NAME] [--check] [--force]

  --out     where the .glb and .report.json files go (default assets/models)
  --only    export just this asset
  --check   check and report, don't export
  --force   export even when an asset breaks a rule (the report still lists the problems)

An asset is a top-level collection with a valid name (or, if a file has none,
a top-level object with one). For each asset it checks the name, triangle
budget (scripts/blender/budgets.json), applied transforms, LODs, rig, shape
keys, colour zones and the name surface, writes <name>.report.json and exports
<name>.glb (Y up, modifiers applied, shape keys, skins and animations).
Exit code 1 if any asset broke a rule and wasn't forced.

TODO: untested so far: Blender isn't available in the build container (see TODO.md).
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

import bpy  # type: ignore

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
NAME = re.compile(r"^(character|outfit|hair|accessory|board|venue|prop|anim)_([a-z0-9]+)(?:_([a-z0-9]+(?:_[a-z0-9]+)*))?_(\d{2})(?:_lod([0-3]))?$")
ZONE = re.compile(r"(?:^|_)zone([123])$")


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"out": os.path.join(ROOT, "assets", "models"), "only": None, "check": False, "force": False}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("--out", "--only"):
            out[a[2:]] = argv[i + 1]
            i += 2
            continue
        if a in ("--check", "--force"):
            out[a[2:]] = True
        i += 1
    out["out"] = os.path.abspath(out["out"])
    return out


def budgets():
    with open(os.path.join(HERE, "budgets.json"), encoding="utf-8") as f:
        return json.load(f)["rules"]


def budget_for(name, rules):
    for r in rules:
        if re.search(r["match"], name):
            return r
    return {"max": 0, "label": "no budget rule"}


def assets_in_scene():
    """(name, [objects]) for each asset: top-level collections first, else top-level objects."""
    scene = bpy.context.scene
    found = []
    for col in scene.collection.children:
        if NAME.match(col.name):
            found.append((col.name, list(col.all_objects)))
    if found:
        return found
    for obj in scene.collection.all_objects:
        if obj.parent is None and NAME.match(obj.name):
            found.append((obj.name, [obj] + list(obj.children_recursive)))
    return found


def triangles(objs):
    deps = bpy.context.evaluated_depsgraph_get()
    total = 0
    for o in objs:
        if o.type != "MESH":
            continue
        ev = o.evaluated_get(deps)
        mesh = ev.to_mesh()
        mesh.calc_loop_triangles()
        total += len(mesh.loop_triangles)
        ev.to_mesh_clear()
    return total


def check(name, objs, rules, all_names):
    problems = []
    m = NAME.match(name)
    if not m:
        problems.append("name doesn't follow category_item_variant_##")
    tris = triangles(objs)
    rule = budget_for(name, rules)
    if rule["max"] and tris > rule["max"]:
        problems.append(f"{tris} triangles is over the {rule['label']} budget of {rule['max']}")
    for o in objs:
        if o.type not in ("MESH", "ARMATURE"):
            continue
        if any(abs(s - 1) > 1e-4 for s in o.scale) or any(abs(r) > 1e-4 for r in o.rotation_euler):
            problems.append(f"{o.name}: rotation/scale not applied")
    mats = sorted({s.material.name for o in objs if o.type == "MESH" for s in o.material_slots if s.material})
    zones = sorted({int(z.group(1)) for z in (ZONE.search(n) for n in mats) if z})
    shape_keys = sorted({k.name for o in objs if o.type == "MESH" and o.data.shape_keys for k in o.data.shape_keys.key_blocks if k.name != "Basis"})
    rigged = any(o.type == "ARMATURE" for o in objs) or any(mod.type == "ARMATURE" for o in objs if o.type == "MESH" for mod in o.modifiers)
    base = re.sub(r"_lod[0-3]$", "", name)
    lods = sorted(int(n[-1]) for n in all_names if n.startswith(base + "_lod"))
    actions = sorted(a.name for a in bpy.data.actions) if rigged else []
    return {
        "name": name,
        "category": m.group(1) if m else None,
        "triangles": tris,
        "budget": rule["max"],
        "budgetLabel": rule["label"],
        "overBudget": bool(rule["max"] and tris > rule["max"]),
        "lods": lods,
        "rigged": rigged,
        "animations": actions,
        "shapeKeys": shape_keys,
        "materials": mats,
        "zones": zones,
        "nameSurface": "name_surface" in mats,
        "problems": problems,
        "source": os.path.relpath(bpy.data.filepath, ROOT) if bpy.data.filepath else None,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
    }


def export(name, objs, out_dir):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    path = os.path.join(out_dir, name + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_morph=True,
        export_skins=True,
        export_animations=True,
        export_materials="EXPORT",
        export_extras=True,
    )
    return path


def main():
    a = args()
    os.makedirs(a["out"], exist_ok=True)
    rules = budgets()
    assets = assets_in_scene()
    if a["only"]:
        assets = [x for x in assets if x[0] == a["only"]]
    if not assets:
        print("No assets found: name a top-level collection (or object) category_item_variant_##")
        sys.exit(1)
    names = [n for n, _ in assets]
    failed = False
    for name, objs in assets:
        report = check(name, objs, rules, names)
        bad = bool(report["problems"])
        if not a["check"] and (not bad or a["force"]):
            report["file"] = os.path.relpath(export(name, objs, a["out"]), ROOT)
        with open(os.path.join(a["out"], name + ".report.json"), "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
        status = "PROBLEMS" if bad else "ok"
        print(f"[{status}] {name}: {report['triangles']} tris / {report['budget']} ({report['budgetLabel']})")
        for p in report["problems"]:
            print("    - " + p)
        failed = failed or (bad and not a["force"])
    sys.exit(1 if failed else 0)


main()
