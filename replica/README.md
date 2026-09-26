# Replica — video to 3D print

Upload a video of an item spinning on a turntable and get a print-ready STL at its true size.

- **Opening question:** the first page asks *“Are you looking to sell, or just for fun?”* Sellers get a selling calculator (filament, printer time, labour, packaging, markup, marketplace fee, batch totals). Hobbyists get print tips. You can switch at any time from the top bar.
- **Accounts:** create an account or log in. Your scans are saved to your account, so you can come back and download them later.
- **Video → STL:** the reconstruction runs in your browser, so the video never leaves your device. Only the finished STL is uploaded, and only when you click **Save model**.
- **Exact size:** the proportions come from the video. You enter one real measurement (height, width or depth, in mm or inches) and the model is scaled to match.

## Run it

Needs Node.js 22.13 or newer (it uses the built-in `node:sqlite`).

```bash
npm install
npm run dev          # http://localhost:3000 (API + hot-reloading front end)
```

Production:

```bash
npm run build
npm start            # serves dist/ and the API on PORT (default 3000)
```

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | SQLite database and saved STL files |
| `SECURE_COOKIES` | off | Set to `1` when the site is served over HTTPS |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy (for correct client IPs in rate limiting) |

```bash
npm test             # reconstruction + server tests
npm run typecheck
```

## How to film an item

1. Put it on a turntable, cake stand or lazy Susan. A motorised one works best because the spin has to be steady.
2. Use a plain background in a different colour from the item. Keep the item away from the edges of the frame.
3. Keep the phone still and level with the turntable, at least a metre away, and zoom in.
4. Light it evenly, without harsh shadows on the background.
5. Film at least one full turn. 10–20 seconds per turn is plenty.

After you upload, you check the setup:

- **Floor line:** drag it to where the item sits on the turntable. Everything below it is ignored.
- **Background sensitivity:** adjust until the orange highlight covers the whole item and nothing else.
- **End of first turn:** found automatically. The *Start* and *One turn later* previews should show the same side of the item.
- **Spin direction:** found automatically from the texture on the item.
- **Advanced:** turntable centre, camera tilt, and noise tolerance.

If you don't have a video handy, **Try the demo** renders a turntable clip of a painted jug for you to test with.

## How it works

The method is **shape from silhouette** (space carving):

1. **Frames:** 160 evenly spaced frames are pulled from the video with a `<video>` element and a canvas (`src/recon/frames.ts`).
2. **Segmentation:** each frame's backdrop colour is estimated from the frame edges. Pixels that differ enough are marked as the item. Shadows count for less than colour changes. The mask is then cleaned up: specks are removed, pinholes are filled, real openings like handles are kept, and only the largest blob survives (`segment.ts`).
3. **Turntable analysis:** the full turn is found as the first frame that matches the opening frame again. Spin direction comes from tracking the texture on the side facing the camera. The axis is placed halfway between the extreme left and right edges over the turn (`turntable.ts`).
4. **Carving:** a voxel grid (100–220 voxels along its longest side) is projected into every frame, using an orthographic camera with optional tilt. A voxel survives only if it falls inside the item's outline in every frame, minus a small tolerance for bad frames. Silhouettes are anti-aliased and sampled bilinearly, which places the surface to within a fraction of a voxel (`carve.ts`).
5. **Surface:** naive surface nets extract a closed, consistently oriented mesh. Taubin smoothing removes stair-steps without shrinking the model. The base is snapped flat so the model sits on the print bed (`mesh.ts`).
6. **STL:** the mesh is scaled to your measurement and written as a binary STL, Z-up for slicers (`stl.ts`).

The heavy steps run in a Web Worker (`worker.ts`).

### Limits

- **Concave areas.** Silhouettes can't see hollows that no outline reveals: the inside of a cup, a dent facing up, the gap between a handle and the body when viewed from the side. These come out filled or bridged. Holes you can see through, like a mug handle, are kept.
- **Camera model.** The camera is assumed to be far away (orthographic). Filming from close up with a wide lens exaggerates the parts nearest the camera, so step back and zoom in.
- **Steady spin.** The turntable must turn at a steady speed. A hand-spun lazy Susan that speeds up and slows down will distort the shape.
- **Background.** The backdrop needs to be plain and different in colour from the item. Very shiny, transparent or background-coloured items segment poorly.
- **Estimates.** Filament, time and price are rough guides for 0.2 mm layers, 15 % infill and 3 walls. Your slicer gives the exact numbers.

## Security

- Passwords are hashed with scrypt, each with its own random salt. They are verified in constant time, and failed logins for unknown emails take as long as real ones.
- Sessions use random 256-bit tokens. Only their SHA-256 hash is stored. The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` when `SECURE_COOKIES=1`.
- Login attempts are rate limited per IP and email (10 per 15 minutes).
- State-changing API calls must come from the same origin and use a JSON or binary content type, which blocks cross-site form posts.
- Saved models are scoped to their owner. Uploaded STLs are validated before they are stored.
- Production responses send a strict Content Security Policy and related headers.

## Project layout

```
server/index.js      Express server: API, dev (Vite middleware) or production static files
server/app.js        JSON API: sign-up, login, logout, profile goal, saved models
server/auth.js       Password hashing, sessions, cookies, rate limiting
server/db.js         SQLite schema
src/recon/           Frames, segmentation, turntable analysis, carving, meshing, STL, worker, demo clip
src/views/           Welcome question, account, models, scan wizard, saved model, estimates panel
src/viewer.ts        Three.js 3D preview
src/estimate.ts      Filament, time and pricing maths
tests/               Reconstruction tests on synthetic turntable shots, API tests
```
