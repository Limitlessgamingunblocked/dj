import { api } from '../api';
import { formatMm, h, icon } from '../dom';
import { makeDemoFrames } from '../recon/demo';
import { extractFrames, type FrameSet } from '../recon/frames';
import { bounds, overhangArea, scaleMesh, signedVolume, surfaceArea } from '../recon/mesh';
import type { ReconstructSettings } from '../recon/reconstruct';
import { estimateBackground, maskBounds, segmentFrame } from '../recon/segment';
import { toBinaryStl } from '../recon/stl';
import type { Frame, Mesh } from '../recon/types';
import { guessFloorLine } from '../recon/turntable';
import { createEngine } from '../recon/engine';
import type { Analysis, WorkerRequest, WorkerResponse } from '../recon/workerCore';
import { inArtifact, saveStl } from '../platform';
import { Viewer } from '../viewer';
import { insightsPanel } from './insights';
import { topbar } from './shell';

const FRAME_COUNT = 160;
const FRAME_SIZE = 480;
const DETAIL = {
  draft: { label: 'Draft', resolution: 100, hint: 'Fastest' },
  standard: { label: 'Standard', resolution: 160, hint: 'Recommended' },
  fine: { label: 'Fine', resolution: 220, hint: 'Slower, more detail' },
} as const;
type Detail = keyof typeof DETAIL;
type Dimension = 'height' | 'width' | 'depth';
type Unit = 'mm' | 'in';

interface Built {
  mesh: Mesh; // pixels
  size: { width: number; height: number; depth: number }; // pixels
  volume: number;
  area: number;
  overhang: number;
}

export function renderScan(root: HTMLElement) {
  let requestId = 0;
  const pending = new Map<number, (msg: WorkerResponse) => void>();
  const engine = createEngine((msg) => pending.get(msg.id)?.(msg));
  const send = (msg: WorkerRequest) => engine.send(msg);

  let frames: FrameSet | null = null;
  let viewer: Viewer | null = null;
  let built: Built | null = null;
  let disposed = false;

  const s = {
    floorY: 0,
    sensitivity: 0.5,
    turnFrames: 0,
    direction: 1 as 1 | -1,
    elevationDeg: 0,
    axisOffset: 0,
    tolerance: 3,
    detail: 'standard' as Detail,
    autoAxisX: null as number | null,
    radius: null as number | null,
    touchedTurn: false,
    touchedDirection: false,
    analysis: null as Analysis | null,
  };
  const measure = { dimension: 'height' as Dimension, value: '', unit: 'mm' as Unit, name: 'My scan' };

  const insights = insightsPanel();
  const stepper = h('ol.stepper');
  const body = h('div.scan-body');
  const steps = ['Upload', 'Set up', 'Build', 'Print'];
  const setStep = (n: number) => {
    stepper.replaceChildren(
      ...steps.map((label, i) => h('li', { class: i < n ? 'done' : i === n ? 'current' : '', 'aria-current': i === n ? 'step' : null }, h('b', {}, String(i + 1)), label)),
    );
  };

  root.append(
    h(
      'div.page',
      {},
      topbar(() => insights.refresh()),
      h('main.container', {}, h('div.scan-head', {}, h('a.back', { href: '#/models' }, icon('back', 16), 'My models'), stepper), body),
    ),
  );

  const disposeViewer = () => {
    viewer?.dispose();
    viewer = null;
  };

  // ————— Step 1: upload —————
  function showUpload(message = '') {
    disposeViewer();
    setStep(0);
    const input = h('input', { type: 'file', accept: 'video/*,.mp4,.mov,.webm,.m4v', hidden: true });
    const status = h('p.form-error', { role: 'alert' }, message);
    const progress = h('div.progress', { hidden: true }, h('div.progress-bar'), h('span.progress-label'));
    const setProgress = (label: string, f: number) => {
      progress.hidden = false;
      (progress.firstElementChild as HTMLElement).style.width = `${Math.round(f * 100)}%`;
      (progress.lastElementChild as HTMLElement).textContent = `${label} ${Math.round(f * 100)}%`;
    };
    const drop = h(
      'label.dropzone',
      { tabindex: 0 },
      icon('upload', 36),
      h('b', {}, 'Upload a video of your item'),
      h('span.muted', {}, 'Drop it here or click to choose · MP4, MOV or WebM'),
      input,
    );
    const demo = h('button.ghost', { type: 'button' }, icon('play', 18), 'No video handy? Try the demo');
    const busy = (on: boolean) => {
      drop.classList.toggle('disabled', on);
      demo.disabled = on;
    };

    const load = async (source: () => Promise<FrameSet>) => {
      busy(true);
      status.textContent = '';
      try {
        const set = await source();
        if (disposed) return;
        frames = set;
        measure.name = set.label.replace(/\.[^.]+$/, '').replace(/^Demo: /, '').slice(0, 60) || 'My scan';
        measure.value = set.knownHeightMm ? String(set.knownHeightMm) : '';
        measure.dimension = 'height';
        measure.unit = 'mm';
        send({ type: 'load', frames: set.frames });
        s.floorY = set.floorY ?? guessFloor(set.frames[0]);
        s.touchedTurn = false;
        s.touchedDirection = false;
        s.turnFrames = set.frames.length;
        s.axisOffset = 0;
        showSetup();
      } catch (err) {
        busy(false);
        progress.hidden = true;
        status.textContent = err instanceof Error ? err.message : 'Couldn’t read that video.';
      }
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) load(() => extractFrames(file, FRAME_COUNT, FRAME_SIZE, (f) => setProgress('Reading video…', f)));
    });
    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v)$/i.test(file.name)) {
        status.textContent = 'That doesn’t look like a video file.';
        return;
      }
      load(() => extractFrames(file, FRAME_COUNT, FRAME_SIZE, (f) => setProgress('Reading video…', f)));
    });
    demo.addEventListener('click', () => load(() => makeDemoFrames((f) => setProgress('Rendering demo clip…', f))));

    const tip = (name: string, title: string, text: string) => h('li', {}, h('span.tip-icon', {}, icon(name, 20)), h('div', {}, h('b', {}, title), h('span', {}, text)));
    body.replaceChildren(
      h(
        'div.upload-grid',
        {},
        h('section', {}, h('h1', {}, 'Scan an item'), h('p.muted', {}, 'Your video is processed right here in your browser.'), drop, progress, status, demo),
        h(
          'section.card.tips-card',
          {},
          h('h2', {}, 'How to film it'),
          h(
            'ul.film-tips',
            {},
            tip('turntable', 'Put it on a turntable', 'A cake stand or lazy Susan works. A motorised one is best — the spin needs to be steady.'),
            tip('wall', 'Use a plain background', 'A wall or sheet in a colour that’s different from the item. Keep the item away from the edges of the shot.'),
            tip('camera', 'Keep the phone still and level', 'Prop it at the height of the turntable, a metre or more away, and zoom in so the item fills most of the frame.'),
            tip('sun', 'Light it evenly', 'Soft daylight or two lamps. Avoid strong shadows on the background.'),
            tip('play', 'Film at least one full turn', 'We find the full turn automatically. 10–20 seconds per turn is plenty.'),
          ),
          h('p.fine', {}, 'This method rebuilds the outline of the item from every angle, so it captures outer shape and holes you can see through (like a mug handle). Hollow insides and deep dents facing up come out filled.'),
        ),
      ),
    );
  }

  // ————— Step 2: set up —————
  function showSetup() {
    disposeViewer();
    setStep(1);
    const set = frames!;
    const canvas = h('canvas.preview-canvas', { width: set.width, height: set.height, 'aria-label': 'Video frame with the detected item highlighted' });
    const ctx = canvas.getContext('2d')!;
    const startThumb = h('canvas', { width: set.width, height: set.height });
    const endThumb = h('canvas', { width: set.width, height: set.height });
    let previewIndex = 0;

    const scrub = h('input', { type: 'range', min: 0, max: set.frames.length - 1, value: 0, 'aria-label': 'Preview frame' });
    const scrubLabel = h('span.muted.small');
    const floor = h('input', { type: 'range', min: 1, max: set.height, value: Math.round(s.floorY), 'aria-label': 'Floor line' });
    const sens = h('input', { type: 'range', min: 0, max: 100, value: Math.round(s.sensitivity * 100), 'aria-label': 'Background sensitivity' });
    const turn = h('input', { type: 'range', min: 8, max: set.frames.length, value: s.turnFrames, 'aria-label': 'End of first turn' });
    const turnLabel = h('span.muted.small');
    const turnChip = h('span.chip');
    const dirChip = h('span.chip');
    const dirRight = h('button', { type: 'button' }, 'Front moves right →');
    const dirLeft = h('button', { type: 'button' }, '← Front moves left');
    const axis = h('input', { type: 'range', min: -60, max: 60, value: s.axisOffset, 'aria-label': 'Turntable centre adjustment' });
    const tilt = h('input', { type: 'range', min: 0, max: 30, value: s.elevationDeg, 'aria-label': 'Camera tilt' });
    const tiltLabel = h('span.value');
    const tol = h('input', { type: 'range', min: 1, max: 5, value: s.tolerance, 'aria-label': 'Noise tolerance' });
    const tolLabel = h('span.value');
    const detailWrap = h('div.segmented.full', { role: 'group', 'aria-label': 'Detail' });
    const build = h('button.primary.wide', { type: 'button' }, icon('cube', 18), 'Build 3D model');
    const warn = h('p.warn', { hidden: true });

    const paintThumb = (c: HTMLCanvasElement, f: Frame) => c.getContext('2d')!.putImageData(new ImageData(f.data, f.width, f.height), 0, 0);
    const axisX = () => (s.autoAxisX ?? set.width / 2) + s.axisOffset;

    let raf = 0;
    const redraw = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const f = set.frames[previewIndex];
        const mask = segmentFrame(f, estimateBackground(f, s.floorY), { floorY: s.floorY, sensitivity: s.sensitivity });
        const img = new ImageData(new Uint8ClampedArray(f.data), f.width, f.height);
        const d = img.data;
        for (let i = 0; i < mask.data.length; i++) {
          const o = i * 4;
          if (mask.data[i]) {
            d[o] = d[o] * 0.45 + 255 * 0.55;
            d[o + 1] = d[o + 1] * 0.45 + 106 * 0.55;
            d[o + 2] = d[o + 2] * 0.45 + 61 * 0.55;
          } else if (i >= s.floorY * f.width) {
            d[o] *= 0.35;
            d[o + 1] *= 0.35;
            d[o + 2] *= 0.35;
          }
        }
        ctx.putImageData(img, 0, 0);
        const lw = Math.max(1.5, set.width / 320);
        ctx.lineWidth = lw * 1.5;
        ctx.strokeStyle = '#ff6a3d';
        ctx.beginPath();
        ctx.moveTo(0, s.floorY);
        ctx.lineTo(set.width, s.floorY);
        ctx.stroke();
        ctx.font = `600 ${Math.round(set.width / 34)}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = '#ff6a3d';
        ctx.fillText('Floor — drag to where the item sits', 8, Math.max(16, s.floorY - 8));
        ctx.setLineDash([lw * 4, lw * 4]);
        ctx.lineWidth = lw;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.moveTo(axisX(), 0);
        ctx.lineTo(axisX(), s.floorY);
        ctx.stroke();
        ctx.setLineDash([]);
        scrubLabel.textContent = `Frame ${previewIndex + 1} of ${set.frames.length} · ${f.time.toFixed(1)} s`;
        const b = maskBounds(mask);
        warn.hidden = true;
        if (!b) {
          warn.hidden = false;
          warn.textContent = 'No item found in this frame. Raise the sensitivity, or move the floor line lower.';
        } else if (b.left <= 2 || b.right >= set.width - 2 || b.top <= 2) {
          warn.hidden = false;
          warn.textContent = 'The item touches the edge of the frame here, or the background isn’t plain enough. Parts outside the frame can’t be rebuilt.';
        }
      });
    };

    const syncTurn = () => {
      turn.value = String(s.turnFrames);
      const endIdx = Math.min(set.frames.length - 1, s.turnFrames);
      paintThumb(endThumb, set.frames[endIdx]);
      turnLabel.textContent = `One turn = ${s.turnFrames} frames (${(set.frames[Math.min(set.frames.length - 1, s.turnFrames - 1)].time - set.frames[0].time + set.duration / set.frames.length).toFixed(1)} s)`;
      const a = s.analysis;
      if (s.touchedTurn) chip(turnChip, 'Set by you', 'neutral');
      else if (!a) chip(turnChip, 'Detecting…', 'neutral');
      else if (a.turnConfident) chip(turnChip, 'Auto-detected', 'good');
      else chip(turnChip, 'Not sure — check it', 'warn');
    };
    const syncDirection = () => {
      dirRight.setAttribute('aria-pressed', String(s.direction === 1));
      dirLeft.setAttribute('aria-pressed', String(s.direction === -1));
      const a = s.analysis;
      if (s.touchedDirection) chip(dirChip, 'Set by you', 'neutral');
      else if (!a) chip(dirChip, 'Detecting…', 'neutral');
      else if (a.directionConfident) chip(dirChip, 'Auto-detected', 'good');
      else chip(dirChip, 'Not sure — check it', 'warn');
    };
    const syncDetail = () => {
      detailWrap.replaceChildren(
        ...(Object.keys(DETAIL) as Detail[]).map((k) => {
          const b = h('button', { type: 'button', 'aria-pressed': String(s.detail === k), title: DETAIL[k].hint }, DETAIL[k].label);
          b.addEventListener('click', () => {
            s.detail = k;
            syncDetail();
          });
          return b;
        }),
      );
    };

    let analyzeTimer = 0;
    const analyze = () => {
      clearTimeout(analyzeTimer);
      analyzeTimer = window.setTimeout(() => {
        const id = ++requestId;
        pending.set(id, (msg) => {
          pending.delete(id);
          if (msg.type !== 'analysis' || disposed) return;
          s.analysis = msg.analysis;
          s.autoAxisX = msg.analysis.axisX;
          s.radius = msg.analysis.radius;
          if (!s.touchedTurn) s.turnFrames = msg.analysis.turnFrames;
          if (!s.touchedDirection) s.direction = msg.analysis.direction;
          syncTurn();
          syncDirection();
          redraw();
        });
        send({ type: 'analyze', id, floorY: s.floorY, sensitivity: s.sensitivity });
      }, 350);
    };

    scrub.addEventListener('input', () => {
      previewIndex = Number(scrub.value);
      redraw();
    });
    floor.addEventListener('input', () => {
      s.floorY = Number(floor.value);
      redraw();
      analyze();
    });
    sens.addEventListener('input', () => {
      s.sensitivity = Number(sens.value) / 100;
      redraw();
      analyze();
    });
    turn.addEventListener('input', () => {
      s.turnFrames = Number(turn.value);
      s.touchedTurn = true;
      syncTurn();
    });
    dirRight.addEventListener('click', () => {
      s.direction = 1;
      s.touchedDirection = true;
      syncDirection();
    });
    dirLeft.addEventListener('click', () => {
      s.direction = -1;
      s.touchedDirection = true;
      syncDirection();
    });
    axis.addEventListener('input', () => {
      s.axisOffset = Number(axis.value);
      redraw();
    });
    const syncAdvanced = () => {
      tiltLabel.textContent = `${s.elevationDeg}°`;
      tolLabel.textContent = String(s.tolerance);
    };
    tilt.addEventListener('input', () => {
      s.elevationDeg = Number(tilt.value);
      syncAdvanced();
    });
    tol.addEventListener('input', () => {
      s.tolerance = Number(tol.value);
      syncAdvanced();
    });

    // Drag anywhere on the preview to move the floor line.
    const setFloorFromPointer = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const y = ((e.clientY - r.top) / r.height) * set.height;
      s.floorY = Math.round(Math.max(1, Math.min(set.height, y)));
      floor.value = String(s.floorY);
      redraw();
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      setFloorFromPointer(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (canvas.hasPointerCapture(e.pointerId)) setFloorFromPointer(e);
    });
    canvas.addEventListener('pointerup', () => analyze());

    build.addEventListener('click', () => runBuild());

    const row = (label: string, control: Node, extra?: Node) => h('div.control', {}, h('div.control-label', {}, h('span', {}, label), extra ?? ''), control);
    body.replaceChildren(
      h(
        'div.setup-grid',
        {},
        h(
          'section.preview',
          {},
          h('div.preview-frame', {}, canvas),
          h('div.scrub', {}, scrub, scrubLabel),
          warn,
          h(
            'div.turn-check',
            {},
            h('figure', {}, startThumb, h('figcaption', {}, 'Start')),
            h('figure', {}, endThumb, h('figcaption', {}, 'One turn later')),
            h('p.muted.small', {}, 'These two should show the item from the same side. If not, adjust “End of first turn”.'),
          ),
        ),
        h(
          'section.controls.card',
          {},
          h('h2', {}, 'Check the setup'),
          h('p.muted.small', {}, 'The item is highlighted in orange. Everything below the floor line (the turntable) is ignored.'),
          row('Floor line', floor),
          row('Background sensitivity', sens),
          row('End of first turn', h('div', {}, turn, turnLabel), turnChip),
          row('Spin direction', h('div.segmented.full', {}, dirLeft, dirRight), dirChip),
          row('Detail', detailWrap),
          h(
            'details.advanced',
            {},
            h('summary', {}, 'Advanced'),
            row('Turntable centre', axis),
            row('Camera looking down', tilt, tiltLabel),
            row('Noise tolerance', tol, tolLabel),
            h('p.fine', {}, 'Camera looking down: how far above the turntable the camera was tilted (0° = level). Noise tolerance: how many frames must agree before a bit of the shape is cut away — raise it if the model has holes it shouldn’t.'),
          ),
          build,
        ),
      ),
    );
    paintThumb(startThumb, set.frames[0]);
    syncTurn();
    syncDirection();
    syncDetail();
    syncAdvanced();
    redraw();
    analyze();
  }

  // ————— Step 3: build —————
  function runBuild() {
    setStep(2);
    const bar = h('div.progress-bar');
    const label = h('span.progress-label', {}, 'Starting…');
    const cancel = h('button.ghost', { type: 'button' }, 'Back to setup');
    body.replaceChildren(
      h('section.building.card', {}, icon('cube', 40), h('h2', {}, 'Building your 3D model'), h('div.progress', {}, bar, label), cancel),
    );
    const id = ++requestId;
    cancel.addEventListener('click', () => {
      pending.delete(id);
      showSetup();
    });
    const set = frames!;
    const settings: ReconstructSettings = {
      floorY: s.floorY,
      sensitivity: s.sensitivity,
      turnFrames: Math.min(set.frames.length, s.turnFrames),
      direction: s.direction,
      elevationDeg: s.elevationDeg,
      resolution: DETAIL[s.detail].resolution,
      tolerance: s.tolerance,
      axisX: s.autoAxisX !== null && s.axisOffset !== 0 ? s.autoAxisX + s.axisOffset : undefined,
      smoothing: 6,
      fieldBlur: 1,
    };
    pending.set(id, (msg) => {
      if (disposed) return;
      if (msg.type === 'progress') {
        bar.style.width = `${Math.round(msg.fraction * 100)}%`;
        label.textContent = `${msg.stage}…`;
      } else if (msg.type === 'built') {
        pending.delete(id);
        const mesh = { positions: msg.positions, indices: msg.indices };
        const b = bounds(mesh);
        built = {
          mesh,
          size: { width: b.max[0] - b.min[0], height: b.max[1] - b.min[1], depth: b.max[2] - b.min[2] },
          volume: signedVolume(mesh),
          area: surfaceArea(mesh),
          overhang: overhangArea(mesh),
        };
        showResult();
      } else if (msg.type === 'error') {
        pending.delete(id);
        body.replaceChildren(
          h(
            'section.building.card',
            {},
            h('h2', {}, 'That didn’t work'),
            h('p.form-error', {}, msg.message),
            h('button.primary', { type: 'button', onclick: () => showSetup() }, 'Back to setup'),
          ),
        );
      }
    });
    send({ type: 'build', id, settings });
  }

  // ————— Step 4: result —————
  function showResult() {
    setStep(3);
    disposeViewer();
    const b = built!;
    const stage = h('div.viewer');
    const nameInput = h('input', { value: measure.name, maxlength: 100, 'aria-label': 'Model name' });
    const dimSelect = h(
      'select',
      { 'aria-label': 'Which side you measured' },
      h('option', { value: 'height' }, 'Height'),
      h('option', { value: 'width' }, 'Width'),
      h('option', { value: 'depth' }, 'Depth'),
    );
    dimSelect.value = measure.dimension;
    const valueInput = h('input', { type: 'number', min: 0, step: '0.1', inputmode: 'decimal', placeholder: 'e.g. 120', value: measure.value, 'aria-label': 'Measurement' });
    const unitSelect = h('select', { 'aria-label': 'Unit' }, h('option', { value: 'mm' }, 'mm'), h('option', { value: 'in' }, 'in'));
    unitSelect.value = measure.unit;
    const dims = h('div.dims');
    const download = h('button.primary', { type: 'button' }, icon('download', 18), 'Download STL');
    const save = h('button.secondary', { type: 'button' }, icon('save', 18), 'Save model');
    const saveStatus = h('p.save-status', { role: 'status' });
    const hint = h('p.hint-card', {}, icon('ruler', 18), h('span', {}, 'Measure one side of the real item with a ruler and enter it above. The shape’s proportions come from the video; this one number sets the exact print size.'));

    const scale = (): number | null => {
      const v = Number(measure.value);
      if (!(v > 0)) return null;
      const mm = measure.unit === 'in' ? v * 25.4 : v;
      const px = b.size[measure.dimension];
      return px > 0 ? mm / px : null;
    };

    const sync = () => {
      const k = scale();
      const unit = measure.unit;
      const show = (px: number) => (k ? formatMm(px * k, unit) : '—');
      dims.replaceChildren(
        h('div', {}, h('span', {}, 'Width'), h('b', {}, show(b.size.width))),
        h('div', {}, h('span', {}, 'Depth'), h('b', {}, show(b.size.depth))),
        h('div', {}, h('span', {}, 'Height'), h('b', {}, show(b.size.height))),
      );
      download.disabled = !k;
      save.disabled = !k;
      hint.hidden = !!k;
      insights.el.hidden = !k;
      if (k) {
        insights.update({ volumeMm3: b.volume * k ** 3, areaMm2: b.area * k * k, heightMm: b.size.height * k, overhangMm2: b.overhang * k * k });
        // Show the model at real size so the grid squares are true 10 mm squares.
        viewer?.setScale(k, true);
      }
      saveStatus.textContent = '';
    };

    nameInput.addEventListener('input', () => (measure.name = nameInput.value));
    dimSelect.addEventListener('change', () => ((measure.dimension = dimSelect.value as Dimension), sync()));
    valueInput.addEventListener('input', () => ((measure.value = valueInput.value), sync()));
    unitSelect.addEventListener('change', () => ((measure.unit = unitSelect.value as Unit), sync()));

    const scaledStl = () => {
      const k = scale()!;
      const mesh = scaleMesh(b.mesh, k);
      return { mesh, stl: toBinaryStl(mesh, measure.name || 'model'), k };
    };

    download.addEventListener('click', async () => {
      const { stl } = scaledStl();
      const msg = await saveStl(stl, measure.name || 'model');
      if (msg) saveStatus.textContent = msg;
    });
    save.addEventListener('click', async () => {
      const name = measure.name.trim();
      if (!name) {
        saveStatus.textContent = 'Give your model a name first.';
        nameInput.focus();
        return;
      }
      save.disabled = true;
      saveStatus.textContent = 'Saving…';
      try {
        const { mesh, stl, k } = scaledStl();
        await api.saveModel(
          {
            name,
            widthMm: b.size.width * k,
            heightMm: b.size.height * k,
            depthMm: b.size.depth * k,
            volumeMm3: b.volume * k ** 3,
            triangles: mesh.indices.length / 3,
            thumbnail: viewer?.snapshot() ?? null,
          },
          stl,
        );
        saveStatus.replaceChildren(icon('check', 16), ' Saved. ', h('a.link', { href: '#/models' }, 'See my models'));
      } catch (err) {
        saveStatus.textContent = err instanceof Error ? err.message : 'Couldn’t save.';
      } finally {
        save.disabled = !scale();
      }
    });

    body.replaceChildren(
      h(
        'div.workspace',
        {},
        h('div.viewer-wrap', {}, stage, h('p.viewer-hint', {}, 'Drag to turn · scroll to zoom · grid squares are 10 mm once sized')),
        h(
          'aside.side',
          {},
          h('label.field', {}, h('span', {}, 'Name'), nameInput),
          h(
            'section.card.size-card',
            {},
            h('h3', {}, icon('ruler', 18), 'Make it the exact size'),
            h('div.measure-row', {}, dimSelect, valueInput, unitSelect),
            h('p.fine', {}, 'Width is left-to-right and depth is front-to-back, as the item faced the camera at the start of the video.'),
            dims,
          ),
          hint,
          h('div.actions', {}, download, save),
          inArtifact() ? h('p.fine.tight', {}, 'Here the STL is saved inside a .zip file. Unzip it and open the .stl in your slicer.') : null,
          saveStatus,
          insights.el,
          h(
            'div.actions.subtle',
            {},
            h('button.ghost', { type: 'button', onclick: () => showSetup() }, 'Adjust settings'),
            h('button.ghost', { type: 'button', onclick: () => showUpload() }, 'New scan'),
          ),
        ),
      ),
    );
    viewer = new Viewer(stage);
    viewer.setMesh(b.mesh, scale() ?? 100 / b.size.height);
    sync();
  }

  showUpload();

  return () => {
    disposed = true;
    disposeViewer();
    engine.terminate();
  };
}

function chip(el: HTMLElement, text: string, tone: 'good' | 'warn' | 'neutral') {
  el.textContent = text;
  el.className = `chip ${tone}`;
}

/** First guess at the floor line: the top of the turntable under the item. */
function guessFloor(f: Frame): number {
  const bg = estimateBackground(f, f.height);
  return Math.max(8, guessFloorLine(segmentFrame(f, bg, { floorY: f.height, sensitivity: 0.5 })));
}

