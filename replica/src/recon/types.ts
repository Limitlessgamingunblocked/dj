/** An RGBA video frame (same layout as ImageData). */
export interface Frame {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
  /** Seconds from the start of the video. */
  time: number;
}

/** A binary silhouette: 1 = object, 0 = background. */
export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface SegmentOptions {
  /** 0..1 — higher picks up fainter differences from the background. */
  sensitivity: number;
  /** Image row where the item sits on the turntable. Everything below is ignored. */
  floorY: number;
}

/** Where the turntable axis is and how big the item is, in pixels. */
export interface TurntableGeometry {
  axisX: number;
  floorY: number;
  /** Largest distance of any silhouette pixel from the axis. */
  radius: number;
  /** Height of the item above the floor line. */
  height: number;
}

export interface CarveParams extends TurntableGeometry {
  /** Camera tilt looking down at the item, in degrees (0 = camera level with the turntable). */
  elevationDeg: number;
  /** Voxels along the longest side of the grid. */
  resolution: number;
  /** A voxel is removed once this many frames see background through it. */
  tolerance: number;
}

export interface VoxelGrid {
  nx: number;
  ny: number;
  nz: number;
  /** Edge length of one voxel, in image pixels. */
  voxelSize: number;
  /** Object-space coordinates (pixels) of voxel (0,0,0)'s centre. */
  origin: [number, number, number];
  /** 1 = solid. */
  data: Uint8Array;
  /** Soft occupancy 0..1 (0.5 = on the surface), for sub-voxel accurate surfaces. */
  field: Float32Array;
}

export interface Mesh {
  /** xyz triples. */
  positions: Float32Array;
  /** Triangle vertex indices, counter-clockwise seen from outside. */
  indices: Uint32Array;
}
