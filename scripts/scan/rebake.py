"""
Re-lay a scanned person's texture so it holds up at a distance:
    python3 scripts/scan/rebake.py assets/models/character_scan_<name>_01.glb
(needs numpy, Pillow and xatlas; then run scripts/scan/lod.mjs on the file again)

The generator lays its texture out as thousands of tiny patches, one or two
triangles each, pressed edge to edge with no gap. Drawn small, a texture is
read from its shrunk copies, and there every patch blends with its neighbours:
hair, skin and trousers mix into speckle and dark smears. Read at full size
instead, a figure a few metres off sparkles with single texels.

So the body gets a new layout (xatlas): a few hundred large pieces cut along
the body's own creases, each with a margin round it. The colour, the surface
detail (normal map, turned into each new piece's own frame) and the roughness
are copied across point by point, and each piece's edge colour is carried out
into its margin, so its shrunk copies stay its own colour. Same points, same
skin and bones; the file's light copy of the body (scan_lod) is dropped, to be
made again from the new layout.
"""
import io
import json
import struct
import sys

import numpy as np
import xatlas
from PIL import Image

SIZE = 2048
PAD = 6


def load(path):
    d = open(path, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + jl])
    b = d[20 + jl + 8:]
    return j, b


def acc(j, b, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    dt = {5126: np.float32, 5123: np.uint16, 5121: np.uint8, 5125: np.uint32}[a['componentType']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', 0)
    isz = np.dtype(dt).itemsize * n
    if stride and stride != isz:
        raw = np.frombuffer(b[off:off + stride * a['count']], np.uint8).reshape(a['count'], stride)[:, :isz]
        return raw.copy().view(dt).reshape(a['count'], n), a
    return np.frombuffer(b[off:off + isz * a['count']], dt).reshape(a['count'], n).copy(), a


def image(j, b, tex):
    src = j['textures'][tex['index']]['source']
    bv = j['bufferViews'][j['images'][src]['bufferView']]
    off = bv.get('byteOffset', 0)
    return np.asarray(Image.open(io.BytesIO(b[off:off + bv['byteLength']])).convert('RGB'), np.float32)


def taps(own, uv, piece):
    """bilinear taps at uv (glTF space, v down the image) and their weights, counting only the
    texels of the old patch the point is on: the old patches sit edge to edge, so a plain read at
    a patch's edge takes in half of whatever lies next to it (a strap, hair, a shadow)"""
    h, w = own.shape
    x = np.clip(uv[:, 0] * w - 0.5, 0, w - 1.001)
    y = np.clip(uv[:, 1] * h - 0.5, 0, h - 1.001)
    x0 = x.astype(np.int32)
    y0 = y.astype(np.int32)
    fx = x - x0
    fy = y - y0
    ys = np.stack([y0, y0, y0 + 1, y0 + 1], 1)
    xs = np.stack([x0, x0 + 1, x0, x0 + 1], 1)
    wt = np.stack([(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy], 1)
    mine = wt * (own[ys, xs] == piece)
    tot = mine.sum(1, keepdims=True)
    # none of its own texels in reach (a patch thinner than a texel): read it plainly
    wt = np.where(tot > 1e-6, mine / np.maximum(tot, 1e-6), wt)
    return ys, xs, wt


def sample(img, t):
    ys, xs, wt = t
    return (img[ys, xs] * wt[..., None]).sum(1)


def tri_pixels(a, bb, c, size, slack=0.6):
    """the pixels of a triangle (in pixel space) and their barycentric weights (clipped to it)"""
    x0 = max(int(np.floor(min(a[0], bb[0], c[0]) - 1)), 0)
    x1 = min(int(np.ceil(max(a[0], bb[0], c[0]) + 1)), size - 1)
    y0 = max(int(np.floor(min(a[1], bb[1], c[1]) - 1)), 0)
    y1 = min(int(np.ceil(max(a[1], bb[1], c[1]) + 1)), size - 1)
    if x1 < x0 or y1 < y0:
        return None
    xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    P = np.stack([xs.ravel(), ys.ravel()], 1)
    v0 = bb - a
    v1 = c - a
    v2 = P - a
    den = v0[0] * v1[1] - v1[0] * v0[1]
    if abs(den) < 1e-12:
        return None
    l1 = (v2[:, 0] * v1[1] - v1[0] * v2[:, 1]) / den
    l2 = (v0[0] * v2[:, 1] - v2[:, 0] * v0[1]) / den
    l0 = 1 - l1 - l2
    # inside, with a hair of slack so neighbouring triangles leave no cracks
    e = slack / max(1.0, np.sqrt(abs(den)))
    ok = (l0 >= -e) & (l1 >= -e) & (l2 >= -e)
    if not ok.any():
        return None
    L = np.stack([l0[ok], l1[ok], l2[ok]], 1).clip(0, 1)
    L /= L.sum(1, keepdims=True)
    return P[ok].astype(np.int32), L


def pieces(idx):
    """which old patch each triangle is on: the triangles that share points (the old layout split its points at its seams)"""
    parent = np.arange(idx.max() + 1)

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b, c in idx:
        ra, rb, rc = root(a), root(b), root(c)
        parent[rb] = ra
        parent[root(rc)] = ra
    return np.array([root(a) for a in idx[:, 0]], np.int64)


def frame(p, uv):
    """each triangle's tangent (along u) and bitangent (along v, as three reads a glTF texture: up the image), per triangle"""
    e1 = p[:, 1] - p[:, 0]
    e2 = p[:, 2] - p[:, 0]
    d1 = uv[:, 1] - uv[:, 0]
    d2 = uv[:, 2] - uv[:, 0]
    # three flips v on load (flipY false for glTF, but its normal map's green is "up" in uv space with v down): use -v
    d1 = d1 * np.array([1, -1])
    d2 = d2 * np.array([1, -1])
    r = d1[:, 0] * d2[:, 1] - d2[:, 0] * d1[:, 1]
    r = np.where(np.abs(r) < 1e-12, 1e-12, r)
    t = (e1 * d2[:, 1:2] - e2 * d1[:, 1:2]) / r[:, None]
    bt = (e2 * d1[:, 0:1] - e1 * d2[:, 0:1]) / r[:, None]
    return t, bt


def main(path):
    j, b = load(path)
    # the body's mesh (the light copy goes)
    body = next(n for n in j['nodes'] if n.get('name') == 'scan_body')
    prim = j['meshes'][body['mesh']]['primitives'][0]
    at = prim['attributes']
    pos, _ = acc(j, b, at['POSITION'])
    nrm, _ = acc(j, b, at['NORMAL'])
    uv, _ = acc(j, b, at['TEXCOORD_0'])
    jo, joa = acc(j, b, at['JOINTS_0'])
    we, wea = acc(j, b, at['WEIGHTS_0'])
    idx, _ = acc(j, b, prim['indices'])
    idx = idx.reshape(-1, 3).astype(np.uint32)
    ibm, _ = acc(j, b, j['skins'][body['skin']]['inverseBindMatrices'])
    mat = j['materials'][prim['material']]
    pbr = mat['pbrMetallicRoughness']
    old = {'color': image(j, b, pbr['baseColorTexture']), 'normal': image(j, b, mat['normalTexture']), 'rough': image(j, b, pbr['metallicRoughnessTexture'])}
    # all three at the colour's size, so one read serves them all
    ch, cw = old['color'].shape[:2]
    for k in ('normal', 'rough'):
        if old[k].shape[:2] != (ch, cw):
            old[k] = np.asarray(Image.fromarray(old[k].astype(np.uint8)).resize((cw, ch), Image.BILINEAR), np.float32)

    # weld the points the old layout split, so the new pieces can run across its seams
    key = np.round(pos * 1e5).astype(np.int64)
    _, weld, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    wpos = pos[weld]
    widx = inv[idx].astype(np.uint32)
    atlas = xatlas.Atlas()
    atlas.add_mesh(wpos.astype(np.float32), widx, nrm[weld].astype(np.float32))
    co = xatlas.ChartOptions()
    co.max_iterations = 2
    po = xatlas.PackOptions()
    po.resolution = SIZE
    po.padding = PAD
    po.bilinear = True
    po.rotate_charts = True
    atlas.generate(co, po)
    vmap, nidx, nuv = atlas[0]
    print(path, 'pieces', atlas.chart_count, 'points', len(pos), '->', len(vmap), 'utilisation', round(float(atlas.utilization), 2))
    nidx = nidx.reshape(-1, 3)
    assert len(nidx) == len(idx)
    # every new point from one of the old ones at that place
    src = weld[vmap]
    # xatlas's uv is in [0,1] with v up from the bottom? it matches pixel rows top-down; keep as is (glTF v down)

    # which old patch owns each old texel
    piece = pieces(idx)
    oh, ow = old['color'].shape[:2]
    own = np.full((oh, ow), -1, np.int64)
    tri_px = uv[idx] * np.array([ow, oh])
    for t in range(len(idx)):
        r = tri_pixels(*tri_px[t], max(ow, oh), slack=0.0)
        if r is not None:
            own[r[0][:, 1], r[0][:, 0]] = piece[t]

    # copy the textures across: each new texel from the triangle it lies in, at the same place on the old layout
    new = {k: np.zeros((SIZE, SIZE, 3), np.float32) for k in old}
    filled = np.zeros((SIZE, SIZE), bool)
    tri_new = nuv[nidx] * SIZE  # (T,3,2) pixel space
    tri_old = uv[idx]  # (T,3,2) old uv per corner (the old seams kept)
    p3 = pos[idx]
    tn, bn = frame(p3, nuv[nidx].astype(np.float64))
    to, bo = frame(p3, tri_old.astype(np.float64))
    fn = np.cross(p3[:, 1] - p3[:, 0], p3[:, 2] - p3[:, 0])
    fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
    for t in range(len(nidx)):
        r = tri_pixels(*tri_new[t], SIZE)
        if r is None:
            continue
        px, L = r
        o = L @ tri_old[t]
        tap = taps(own, o, piece[t])
        new['color'][px[:, 1], px[:, 0]] = sample(old['color'], tap)
        new['rough'][px[:, 1], px[:, 0]] = sample(old['rough'], tap)
        # the surface detail, from the old piece's frame into the new one's
        n = sample(old['normal'], tap) / 127.5 - 1
        T0 = to[t] / (np.linalg.norm(to[t]) + 1e-12)
        B0 = bo[t] / (np.linalg.norm(bo[t]) + 1e-12)
        N = fn[t]
        w = n[:, 0:1] * T0 + n[:, 1:2] * B0 + n[:, 2:3] * N
        T1 = tn[t] - N * np.dot(tn[t], N)
        T1 /= np.linalg.norm(T1) + 1e-12
        B1 = bn[t] - N * np.dot(bn[t], N) - T1 * np.dot(bn[t], T1)
        B1 /= np.linalg.norm(B1) + 1e-12
        m = np.stack([w @ T1, w @ B1, w @ N], 1)
        m /= np.linalg.norm(m, axis=1, keepdims=True) + 1e-12
        # (a sliver of a triangle has no frame to speak of: flat there)
        m[m[:, 2] < 0.35] = (0, 0, 1)
        new['normal'][px[:, 1], px[:, 0]] = (m + 1) * 127.5
        filled[px[:, 1], px[:, 0]] = True

    # each piece's edge colour out into its margin (and the empty space), so its shrunk copies keep to it
    have = filled.copy()
    for _ in range(PAD * 3):
        if have.all():
            break
        grow = np.zeros_like(have)
        acc_ = {k: np.zeros_like(v) for k, v in new.items()}
        cnt = np.zeros(have.shape, np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sh = np.roll(np.roll(have, dy, 0), dx, 1)
            for k in new:
                acc_[k] += np.roll(np.roll(new[k], dy, 0), dx, 1) * sh[..., None]
            cnt += sh
        grow = (~have) & (cnt > 0)
        for k in new:
            new[k][grow] = acc_[k][grow] / cnt[grow][:, None]
        have |= grow
    # the rest: the average colour
    for k in new:
        new[k][~have] = new[k][have].mean(0)

    # write it back: the points re-cut along the new pieces, the textures re-laid
    out_pos = pos[src]
    # each new point's normal: the old corners it stands for, together (the old points carried their
    # own patch's normal, so one copy alone shades its neighbours' triangles wrongly: dark dents)
    acc_n = np.zeros((len(vmap), 3), np.float64)
    np.add.at(acc_n, nidx.reshape(-1), nrm[idx.reshape(-1)])
    ln = np.linalg.norm(acc_n, axis=1, keepdims=True)
    out_nrm = np.where(ln > 0.3, acc_n / np.maximum(ln, 1e-12), nrm[src]).astype(np.float32)
    out_uv = nuv.astype(np.float32)
    out_jo = jo[src]
    out_we = we[src]
    out_idx = nidx.reshape(-1).astype(np.uint32 if len(vmap) > 65535 else np.uint16)
    blobs = []
    views = []
    accessors = []

    def add(arr, comp, typ, target=None, minmax=False, normalized=False):
        raw = np.ascontiguousarray(arr).tobytes()
        off = sum(len(x) for x in blobs)
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(raw), **({'target': target} if target else {})})
        blobs.append(raw + b'\0' * ((4 - len(raw) % 4) % 4))
        a = {'bufferView': len(views) - 1, 'componentType': comp, 'count': int(arr.shape[0]), 'type': typ}
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = arr.min(0).tolist()
            a['max'] = arr.max(0).tolist()
        accessors.append(a)
        return len(accessors) - 1

    def addimg(arr, quality=90):
        bio = io.BytesIO()
        Image.fromarray(arr.clip(0, 255).astype(np.uint8)).save(bio, 'JPEG', quality=quality)
        raw = bio.getvalue()
        off = sum(len(x) for x in blobs)
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(raw)})
        blobs.append(raw + b'\0' * ((4 - len(raw) % 4) % 4))
        return len(views) - 1

    comp_of = {np.dtype(np.uint8): 5121, np.dtype(np.uint16): 5123, np.dtype(np.uint32): 5125, np.dtype(np.float32): 5126}
    new_at = {
        'POSITION': add(out_pos.astype(np.float32), 5126, 'VEC3', 34962, minmax=True),
        'NORMAL': add(out_nrm.astype(np.float32), 5126, 'VEC3', 34962),
        'TEXCOORD_0': add(out_uv, 5126, 'VEC2', 34962),
        'JOINTS_0': add(out_jo, comp_of[out_jo.dtype], 'VEC4', 34962),
        'WEIGHTS_0': add(out_we, comp_of[out_we.dtype], 'VEC4', 34962, normalized=bool(wea.get('normalized'))),
    }
    new_idx = add(out_idx, comp_of[out_idx.dtype], 'SCALAR', 34963)
    new_ibm = add(ibm.astype(np.float32), 5126, 'MAT4')
    imgs = {k: addimg(new[k]) for k in ('rough', 'color', 'normal')}

    # the file's images: one per texture role
    j['images'] = [{'mimeType': 'image/jpeg', 'bufferView': imgs['rough']}, {'mimeType': 'image/jpeg', 'bufferView': imgs['color']}, {'mimeType': 'image/jpeg', 'bufferView': imgs['normal']}]
    j['textures'] = [{'source': 0}, {'source': 1}, {'source': 2}]
    j.pop('samplers', None)
    pbr['metallicRoughnessTexture'] = {'index': 0, 'texCoord': 0}
    pbr['baseColorTexture'] = {'index': 1, 'texCoord': 0}
    mat['normalTexture'] = {'index': 2, 'texCoord': 0}
    prim['attributes'] = new_at
    prim['indices'] = new_idx
    prim.pop('targets', None)
    j['skins'][body['skin']]['inverseBindMatrices'] = new_ibm
    j['accessors'] = accessors
    j['bufferViews'] = views
    # only the body's mesh (the light copy's made again)
    keep = j['meshes'][body['mesh']]
    lod = [i for i, n in enumerate(j['nodes']) if n.get('name') == 'scan_lod']
    for li in sorted(lod, reverse=True):
        for n in j['nodes']:
            if 'children' in n:
                n['children'] = [c if c < li else c - 1 for c in n['children'] if c != li]
        for s in j['skins']:
            s['joints'] = [c if c < li else c - 1 for c in s['joints']]
        for sc in j['scenes']:
            sc['nodes'] = [c if c < li else c - 1 for c in sc['nodes'] if c != li]
        j['nodes'].pop(li)
    j['meshes'] = [keep]
    for n in j['nodes']:
        if 'mesh' in n:
            n['mesh'] = 0
    binb = b''.join(blobs)
    j['buffers'] = [{'byteLength': len(binb)}]
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binb)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(binb), 0x004E4942) + binb
    open(path, 'wb').write(out)
    print(path, 'written', len(out))


if __name__ == '__main__':
    for p in sys.argv[1:]:
        main(p)
