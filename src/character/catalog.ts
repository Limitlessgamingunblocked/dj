/*
 * Everything the character creator offers (Section 4), as data:
 *   – sliders: body, face and eyes, named exactly like the Blender shape keys
 *     they'll drive (Section 14.2), so code and art stay in sync
 *   – skin: 24 tones from very light to very deep, undertone, details
 *   – hair (43 styles), brows (15 shapes), facial hair, eyes (incl. fantasy
 *     irises), makeup, face paint, tattoos (54 designs), piercings
 *   – outfit pieces for 11 slots, materials, patterns, the 12 signature sets
 *   – DJ personality: groove, signature drop move, headphone and between-mix habits
 * Each item says how it unlocks (Section 9); `owned()` in look.ts applies it.
 */

export type SliderGroup = 'body' | 'face' | 'eyes' | 'skin' | 'hair';

export interface SliderDef {
  /** the shape-key / parameter name */
  id: string;
  label: string;
  group: SliderGroup;
  /** -1..1 (default 0) or 0..1 for amounts */
  min: -1 | 0;
}

const s = (id: string, label: string, group: SliderGroup, min: -1 | 0 = -1): SliderDef => ({ id, label, group, min });

export const SLIDERS: SliderDef[] = [
  // body (Section 4.2)
  s('height', 'Height', 'body'),
  s('shoulder_width', 'Shoulders', 'body'),
  s('chest', 'Chest', 'body'),
  s('waist', 'Waist', 'body'),
  s('hips', 'Hips', 'body'),
  s('arm_thickness', 'Arms', 'body'),
  s('leg_length', 'Leg length', 'body'),
  s('muscle_definition', 'Muscle', 'body'),
  s('body_weight', 'Weight', 'body'),
  // face (Section 4.3)
  s('forehead_height', 'Forehead', 'face'),
  s('cheekbones', 'Cheekbones', 'face'),
  s('cheek_fullness', 'Cheeks', 'face'),
  s('jaw_width', 'Jaw width', 'face'),
  s('jaw_angle', 'Jaw angle', 'face'),
  s('chin_shape', 'Chin shape', 'face'),
  s('chin_length', 'Chin length', 'face'),
  s('nose_width', 'Nose width', 'face'),
  s('nose_length', 'Nose length', 'face'),
  s('nose_bridge', 'Nose bridge', 'face'),
  s('nose_tip', 'Nose tip', 'face'),
  s('lip_fullness', 'Lip fullness', 'face'),
  s('lip_width', 'Lip width', 'face'),
  s('lip_shape', 'Lip shape', 'face'),
  s('ear_size', 'Ear size', 'face'),
  s('ear_shape', 'Ear shape', 'face'),
  s('brow_thickness', 'Brow thickness', 'face'),
  s('facial_hair_length', 'Facial hair length', 'face', 0),
  // eyes (Section 4.4)
  s('eye_shape', 'Eye shape', 'eyes'),
  s('eye_size', 'Eye size', 'eyes'),
  s('eye_spacing', 'Eye spacing', 'eyes'),
  s('eye_tilt', 'Eye tilt', 'eyes'),
  s('lash_length', 'Lash length', 'eyes', 0),
  s('lash_volume', 'Lash volume', 'eyes', 0),
  s('glitter', 'Glitter', 'eyes', 0),
  // skin (Section 4.2)
  s('undertone', 'Undertone (warm ↔ cool)', 'skin'),
  s('freckles_density', 'Freckles', 'skin', 0),
  s('freckles_spread', 'Freckle spread', 'skin', 0),
  s('beauty_marks', 'Beauty marks', 'skin', 0),
  s('birthmark', 'Birthmark', 'skin', 0),
  s('vitiligo', 'Vitiligo', 'skin', 0),
  s('skin_texture', 'Skin texture', 'skin', 0),
];

export const SLIDER_IDS = new Set(SLIDERS.map((x) => x.id));

/** 24 skin tones across the full range, very light to very deep */
export const SKIN_TONES = [
  '#fbe7da', '#f6dcc9', '#f1d0b8', '#ecc5a7', '#e6ba98', '#dfae89',
  '#d7a27c', '#ce9670', '#c48a64', '#b97e59', '#ad734f', '#a16846',
  '#955e3e', '#895437', '#7d4b31', '#71432b', '#663b26', '#5b3422',
  '#512d1e', '#47271b', '#3e2218', '#351c14', '#2d1711', '#25130e',
];

export const FACE_SHAPES = ['oval', 'round', 'square', 'heart', 'long'] as const;
export type FaceShape = (typeof FACE_SHAPES)[number];

/** what each face-shape preset does to the face sliders (added under the player's own settings) */
export const FACE_SHAPE_BASE: Record<FaceShape, Record<string, number>> = {
  oval: {},
  round: { cheek_fullness: 0.5, jaw_width: 0.25, jaw_angle: -0.5, chin_length: -0.3, forehead_height: -0.1 },
  square: { jaw_width: 0.6, jaw_angle: 0.7, chin_shape: 0.6, cheek_fullness: -0.1 },
  heart: { jaw_width: -0.5, chin_shape: -0.6, cheekbones: 0.5, forehead_height: 0.3 },
  long: { forehead_height: 0.4, chin_length: 0.5, cheek_fullness: -0.3, jaw_width: -0.2 },
};

export type Unlock = 'start' | 'basement' | 'rooftop' | 'warehouse' | 'beach' | 'boat' | 'festival' | 'sunrise' | `milestone:${string}` | `rival:${string}` | `set:${number}`;

export interface HairDef {
  id: string;
  label: string;
  category: 'short' | 'medium' | 'long' | 'textured' | 'none';
  unlock: Unlock;
}

const hair = (id: string, label: string, category: HairDef['category'], unlock: Unlock = 'start'): HairDef => ({ id, label, category, unlock });

export const HAIR: HairDef[] = [
  hair('bald', 'Bald', 'none'),
  // short
  hair('buzz', 'Buzz cut', 'short'),
  hair('crew', 'Crew cut', 'short'),
  hair('crop', 'Crop', 'short'),
  hair('textured_fringe', 'Textured fringe', 'short'),
  hair('bleached_crop', 'Bleached crop', 'short', 'basement'),
  hair('fade_lines', 'Fade with lines', 'short'),
  hair('caesar', 'Caesar', 'short'),
  hair('french_crop', 'French crop', 'short'),
  hair('side_part', 'Side part', 'short'),
  hair('spiky', 'Spiky', 'short', 'warehouse'),
  // medium
  hair('curtains', 'Curtains', 'medium'),
  hair('mullet', 'Mullet', 'medium', 'basement'),
  hair('shag', 'Shag', 'medium'),
  hair('curly_top', 'Curly top', 'medium'),
  hair('slick_back', 'Slick back', 'medium', 'rooftop'),
  hair('wolf_cut', 'Wolf cut', 'medium', 'warehouse'),
  hair('bowl', 'Bowl', 'medium'),
  hair('quiff', 'Quiff', 'medium'),
  hair('pompadour', 'Pompadour', 'medium', 'rooftop'),
  hair('undercut', 'Undercut', 'medium'),
  // long
  hair('long_straight', 'Long straight', 'long'),
  hair('long_waves', 'Long waves', 'long'),
  hair('man_bun', 'Man bun', 'long'),
  hair('half_up', 'Half-up', 'long'),
  hair('ponytail', 'Ponytail', 'long'),
  hair('high_ponytail', 'High ponytail', 'long', 'festival'),
  hair('space_buns', 'Space buns', 'long', 'festival'),
  hair('pigtails', 'Pigtails', 'long'),
  hair('long_curls', 'Long curls', 'long'),
  // textured & protective
  hair('afro_small', 'Afro (small)', 'textured'),
  hair('afro_medium', 'Afro (medium)', 'textured'),
  hair('afro_large', 'Afro (large)', 'textured'),
  hair('twists', 'Twists', 'textured'),
  hair('box_braids', 'Box braids', 'textured'),
  hair('box_braids_long', 'Box braids (long)', 'textured'),
  hair('cornrows', 'Cornrows', 'textured'),
  hair('locs', 'Locs', 'textured'),
  hair('locs_long', 'Locs (long)', 'textured'),
  hair('locs_cuffs', 'Locs with cuffs', 'textured', 'beach'),
  hair('high_top', 'High-top', 'textured'),
  hair('bantu_knots', 'Bantu knots', 'textured'),
  hair('puff', 'Puff', 'textured'),
];

export const HAIR_COLOR_MODES = ['solid', 'gradient', 'tips', 'streaks'] as const;
export const HAIR_FINISHES = ['matte', 'glossy', 'wet'] as const;
/** natural hair colours, for randomising */
export const NATURAL_HAIR = ['#0e0b09', '#1d140e', '#2e1f14', '#4a3020', '#6b4528', '#8c5d33', '#b07a45', '#d1a368', '#e8cc94', '#b5401f', '#8a8580', '#d9d6d0'];
export const WILD_HAIR = ['#ff2e88', '#b6ff3b', '#7a3cff', '#3ad7ff', '#ffb547', '#ffffff', '#ff5b2e', '#2effc5'];

export const BROWS = [
  'straight', 'soft_arch', 'high_arch', 'angled', 'rounded', 'flat', 'thick_straight', 'thin_arch',
  's_curve', 'feathered', 'bushy', 'short', 'tapered', 'upturned', 'downturned',
] as const;
export const BROW_SLITS = ['none', 'left', 'right', 'both'] as const;

export const FACIAL_HAIR = [
  'clean', 'stubble_light', 'stubble_medium', 'stubble_heavy', 'mustache', 'mustache_horseshoe', 'mustache_handlebar',
  'goatee', 'chin_strap', 'short_beard', 'full_beard', 'sideburns',
] as const;

export interface IrisDef {
  id: string;
  label: string;
  unlock: Unlock;
}
export const IRIS_STYLES: IrisDef[] = [
  { id: 'natural', label: 'Natural', unlock: 'start' },
  { id: 'uv_glow', label: 'UV glow', unlock: 'warehouse' },
  { id: 'mirrored', label: 'Mirrored', unlock: 'festival' },
  { id: 'smiley', label: 'Smiley pupils', unlock: 'milestone:acid' },
  { id: 'star', label: 'Star pupils', unlock: 'rooftop' },
];
export const EYE_COLORS = ['#3b2414', '#5a3a1e', '#7a5230', '#8a6a3a', '#5f6f3c', '#3f6f5a', '#3d6f9f', '#7aa6c9', '#8a8f98', '#2b1d14'];
export const EYELINER = ['none', 'classic', 'wing', 'graphic', 'smudged'] as const;
export const FACE_PAINT = ['none', 'stripes', 'dots', 'uv_stripes', 'uv_dots', 'gems'] as const;

/* ------------------------------------------------------------------ */
/* tattoos (Section 4.6)                                                */
/* ------------------------------------------------------------------ */

export type TattooFamily = 'flash' | 'script' | 'geometric' | 'rave' | 'music';
export interface TattooDef {
  id: string;
  label: string;
  family: TattooFamily;
}
const t = (family: TattooFamily, ids: string[]): TattooDef[] => ids.map((id) => ({ id, family, label: id.replace(/^[a-z]+_/, '').replace(/_/g, ' ') }));
export const TATTOOS: TattooDef[] = [
  ...t('flash', ['flash_heart', 'flash_rose', 'flash_swallow', 'flash_anchor', 'flash_dagger', 'flash_star', 'flash_lightning', 'flash_eye', 'flash_moon', 'flash_sun', 'flash_snake', 'flash_wave']),
  ...t('script', ['script_name', 'script_house', 'script_all_night', 'script_no_sleep', 'script_love', 'script_one_more', 'script_vibes', 'script_date', 'script_bass', 'script_dance']),
  ...t('geometric', ['geo_triangle', 'geo_circle', 'geo_hexagon', 'geo_mandala', 'geo_lines', 'geo_dots', 'geo_cube', 'geo_diamond', 'geo_spiral', 'geo_grid', 'geo_arrows', 'geo_bands']),
  ...t('rave', ['rave_smiley', 'rave_peace', 'rave_yinyang', 'rave_alien', 'rave_bolt', 'rave_flower', 'rave_globe', 'rave_eye_pyramid', 'rave_planet', 'rave_heart_beat']),
  ...t('music', ['music_note', 'music_headphones', 'music_vinyl', 'music_waveform', 'music_eq', 'music_speaker', 'music_cassette', 'music_turntable', 'music_mic', 'music_clef']),
];
export const TATTOO_PLACES = ['forearm_l', 'forearm_r', 'upper_arm_l', 'upper_arm_r', 'chest', 'neck', 'hand_l', 'hand_r', 'calf_l', 'calf_r'] as const;
export type TattooPlace = (typeof TATTOO_PLACES)[number];

export const PIERCINGS = ['ear_lobe_l', 'ear_lobe_r', 'ear_helix_l', 'ear_helix_r', 'nose_stud', 'nose_ring', 'septum', 'brow_l', 'brow_r', 'lip_l', 'lip_r', 'labret'] as const;

/* ------------------------------------------------------------------ */
/* outfit (Section 4.7)                                                 */
/* ------------------------------------------------------------------ */

export const SLOTS = ['head', 'eyewear', 'headphones', 'neck', 'top', 'outer', 'wrists', 'bottom', 'socks', 'shoes', 'bag'] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_LABEL: Record<Slot, string> = { head: 'Head', eyewear: 'Eyewear', headphones: 'Headphones', neck: 'Neck', top: 'Top', outer: 'Outer layer', wrists: 'Wrists & hands', bottom: 'Bottom', socks: 'Socks', shoes: 'Shoes', bag: 'Bag & extra' };

export const MATERIALS = ['cotton', 'satin', 'mesh', 'denim', 'leather', 'sequin', 'reflective', 'holographic', 'velvet'] as const;
export type Material = (typeof MATERIALS)[number];
export const PATTERNS = ['solid', 'tie_dye', 'checkerboard', 'floral', 'camo', 'smiley', 'stripes', 'flyer'] as const;
export type Pattern = (typeof PATTERNS)[number];

/** what a venue's crowd dresses like (the dress-code bonus, Section 4.9) */
export type Vibe = 'cozy' | 'underground' | 'sporty' | 'smart' | 'glam' | 'dark' | 'techwear' | 'linen' | 'holiday' | 'nautical' | 'bold' | 'future' | 'bright' | 'acid';

export interface ItemDef {
  id: string;
  slot: Slot;
  label: string;
  unlock: Unlock;
  vibes: Vibe[];
  /** default colours of its 3 zones */
  colors: [string, string, string];
  material: Material;
  pattern: Pattern;
}

const it = (id: string, slot: Slot, label: string, unlock: Unlock, vibes: Vibe[], colors: [string, string, string], material: Material = 'cotton', pattern: Pattern = 'solid'): ItemDef => ({ id, slot, label, unlock, vibes, colors, material, pattern });

export const ITEMS: ItemDef[] = [
  // head
  it('cap', 'head', 'Cap', 'start', ['sporty'], ['#1b1d22', '#e9e6df', '#ff2e88']),
  it('beanie', 'head', 'Beanie', 'set:20', ['underground', 'cozy'], ['#2a2d33', '#1b1d22', '#ffb547']),
  it('bucket_hat', 'head', 'Bucket hat', 'beach', ['holiday', 'linen'], ['#e9e2cf', '#c9b48a', '#2a2d33']),
  it('bucket_hat_smiley', 'head', 'Smiley bucket hat', 'milestone:acid', ['acid'], ['#ffd400', '#111111', '#ffffff'], 'cotton', 'smiley'),
  it('captain_hat', 'head', "Captain's hat", 'boat', ['nautical'], ['#f4f4f2', '#14213d', '#d4a64a']),
  it('hood_tech', 'head', 'Tech hood', 'warehouse', ['dark', 'techwear'], ['#0e0f12', '#1c1e23', '#3a3d44'], 'satin'),
  // eyewear
  it('shades_oval', 'eyewear', 'Small oval shades', 'start', ['underground', 'smart'], ['#111111', '#2a2018', '#c9a24a']),
  it('shades_tinted', 'eyewear', 'Tinted shades', 'sunrise', ['bright', 'holiday'], ['#ffb38a', '#c9ced6', '#ff7aa8']),
  it('visor_reflective', 'eyewear', 'Reflective visor', 'festival', ['future', 'bold'], ['#c9ced6', '#7a3cff', '#3ad7ff'], 'reflective'),
  it('round_specs', 'eyewear', 'Round specs', 'set:10', ['smart'], ['#c9a24a', '#111111', '#dddddd']),
  it('rave_goggles', 'eyewear', 'Rave goggles', 'warehouse', ['bold', 'acid'], ['#b6ff3b', '#111111', '#ff2e88']),
  it('cat_eye', 'eyewear', 'Cat-eye shades', 'rooftop', ['glam'], ['#111111', '#ff2e88', '#ffffff']),
  // headphones (worn on both ears, one ear or round the neck: an option)
  it('hp_studio', 'headphones', 'Studio closed-back', 'start', ['underground'], ['#141518', '#2a2d33', '#c9ced6']),
  it('hp_dj', 'headphones', 'Classic DJ', 'start', ['underground', 'sporty'], ['#1b1d22', '#c9ced6', '#ff2e88']),
  it('hp_retro', 'headphones', 'Retro foam', 'basement', ['underground'], ['#c9ced6', '#ff5b2e', '#111111']),
  it('hp_wireless', 'headphones', 'Wireless sleek', 'rooftop', ['smart'], ['#e9e6df', '#c9a24a', '#111111']),
  it('hp_neon', 'headphones', 'Oversized neon', 'festival', ['bold'], ['#b6ff3b', '#7a3cff', '#111111']),
  it('hp_gold', 'headphones', 'Gold chrome', 'festival', ['glam', 'bold'], ['#d4a64a', '#111111', '#ffffff'], 'reflective'),
  it('hp_cat_led', 'headphones', 'LED cat ears', 'warehouse', ['bold', 'acid'], ['#ffffff', '#ff2e88', '#3ad7ff']),
  it('hp_battle', 'headphones', 'Battle rugged', 'basement', ['sporty'], ['#2a2d33', '#ffb547', '#111111']),
  it('hp_minimal', 'headphones', 'Minimal white', 'set:12', ['smart'], ['#f4f4f2', '#c9ced6', '#111111']),
  it('hp_bass', 'headphones', 'Big bass', 'warehouse', ['dark'], ['#0e0f12', '#ff2e88', '#3a3d44']),
  it('hp_wood', 'headphones', 'Wood and leather', 'beach', ['linen'], ['#8a5a32', '#2a2018', '#c9a24a'], 'leather'),
  // neck
  it('chain_gold', 'neck', 'Gold chain', 'beach', ['holiday', 'glam'], ['#d4a64a', '#d4a64a', '#d4a64a'], 'reflective'),
  it('chain_silver', 'neck', 'Silver chain', 'set:14', ['underground'], ['#c9ced6', '#c9ced6', '#c9ced6'], 'reflective'),
  it('lanyard', 'neck', 'Festival lanyard', 'festival', ['bold'], ['#ff2e88', '#ffffff', '#111111']),
  it('bandana', 'neck', 'Bandana', 'set:2', ['underground'], ['#b3261e', '#ffffff', '#111111']),
  // tops
  it('tee_vintage', 'top', 'Oversized vintage tee', 'start', ['underground', 'sporty'], ['#d9d4c7', '#2a2d33', '#b3261e']),
  it('tee_band', 'top', 'Faded band-style tee', 'start', ['underground', 'dark'], ['#2a2a2c', '#8a8580', '#c9ced6']),
  it('tee_plain', 'top', 'Plain tee', 'start', ['cozy'], ['#f4f4f2', '#d9d6cf', '#111111']),
  it('tee_smiley', 'top', 'Yellow smiley tee', 'milestone:acid', ['acid', 'bright'], ['#ffd400', '#111111', '#ffffff'], 'cotton', 'smiley'),
  it('shirt_linen', 'top', 'Open linen shirt', 'beach', ['linen', 'holiday'], ['#efe9dc', '#d9cdb4', '#c9a24a']),
  it('shirt_floral', 'top', 'Loud floral shirt', 'sunrise', ['bright', 'holiday'], ['#ff7a3c', '#ffd400', '#2e9e6b'], 'satin', 'floral'),
  it('shirt_white', 'top', 'White shirt', 'boat', ['nautical', 'smart'], ['#f7f7f5', '#14213d', '#d4a64a']),
  it('jersey_football', 'top', 'Vintage football jersey', 'basement', ['sporty', 'underground'], ['#1f4fa8', '#ffffff', '#d33a2c'], 'mesh', 'stripes'),
  it('techwear_top', 'top', 'Techwear top', 'warehouse', ['dark', 'techwear'], ['#0e0f12', '#1c1e23', '#3a3d44'], 'satin'),
  it('hoodie', 'top', 'Hoodie', 'start', ['cozy', 'underground'], ['#4a4f5a', '#2a2d33', '#ffb547']),
  it('tank_mesh', 'top', 'Mesh tank', 'warehouse', ['dark', 'bold'], ['#111111', '#2a2d33', '#b6ff3b'], 'mesh'),
  it('longsleeve', 'top', 'Long-sleeve tee', 'set:18', ['cozy'], ['#2a2d33', '#d9d6cf', '#ff2e88']),
  // the rivals' pieces, for great chemistry in a B2B (Section 6.10)
  it('tee_marlowe', 'top', 'Deep-stripe tee (MARLOWE)', 'rival:marlowe', ['underground', 'smart'], ['#1c2a44', '#e9e6df', '#7fb3ff'], 'cotton', 'stripes'),
  it('tee_volt', 'top', 'Piano-key tee (KIKI VOLT)', 'rival:kiki_volt', ['bold', 'bright'], ['#111111', '#f4f4f2', '#ff4fb0'], 'cotton', 'checkerboard'),
  it('shirt_dutch', 'top', 'Two-tone bowling shirt (DOUBLE DUTCH)', 'rival:double_dutch', ['bold', 'holiday'], ['#ffb547', '#f4efe2', '#2a2d33'], 'satin', 'stripes'),
  it('tee_nox', 'top', 'Black-on-black tee (NOX)', 'rival:nox', ['dark', 'underground'], ['#0b0b0c', '#141416', '#9d8cff']),
  // outer
  it('utility_vest', 'outer', 'Utility vest', 'warehouse', ['dark', 'techwear'], ['#1c1e23', '#0e0f12', '#3a3d44']),
  it('jacket_sequin', 'outer', 'Sequin jacket', 'rooftop', ['glam'], ['#c9a24a', '#7a3cff', '#ffffff'], 'sequin'),
  it('shellsuit_top', 'outer', 'Shell suit jacket', 'basement', ['sporty', 'bold'], ['#7a3cff', '#3ad7ff', '#ff2e88'], 'satin', 'stripes'),
  it('puffer_metallic', 'outer', 'Metallic puffer', 'festival', ['future', 'bold'], ['#c9ced6', '#8c96a6', '#3ad7ff'], 'reflective'),
  it('bomber', 'outer', 'Bomber jacket', 'set:6', ['underground'], ['#2f3a2c', '#d77a2a', '#111111'], 'satin'),
  it('denim_jacket', 'outer', 'Denim jacket', 'set:8', ['cozy'], ['#3a5a86', '#c9a24a', '#e9e6df'], 'denim'),
  it('velvet_blazer', 'outer', 'Velvet blazer', 'rooftop', ['smart', 'glam'], ['#5a1e3a', '#111111', '#c9a24a'], 'velvet'),
  it('overshirt_marlowe', 'outer', 'Navy overshirt (MARLOWE)', 'rival:marlowe', ['smart', 'underground'], ['#1c2a44', '#2a3a5a', '#e9e6df'], 'denim'),
  it('jacket_volt', 'outer', 'Holographic jacket (KIKI VOLT)', 'rival:kiki_volt', ['future', 'bold'], ['#c9ced6', '#ff4fb0', '#3ad7ff'], 'holographic'),
  it('track_dutch', 'outer', 'Bouncy track top (DOUBLE DUTCH)', 'rival:double_dutch', ['sporty', 'bold'], ['#ff5a2a', '#ffb547', '#f4efe2'], 'satin', 'stripes'),
  it('coat_nox', 'outer', 'Black velvet coat (NOX)', 'rival:nox', ['dark'], ['#0b0b0c', '#1a1a1e', '#9d8cff'], 'velvet'),
  // wrists & hands
  it('watch_gold', 'wrists', 'Gold watch', 'beach', ['glam', 'holiday'], ['#d4a64a', '#111111', '#ffffff'], 'reflective'),
  it('watch_digital', 'wrists', 'Digital watch', 'set:4', ['sporty'], ['#111111', '#b6ff3b', '#c9ced6']),
  it('wristbands', 'wrists', 'Festival wristbands', 'festival', ['bold'], ['#ff2e88', '#3ad7ff', '#b6ff3b']),
  it('rings', 'wrists', 'Rings', 'set:3', ['glam'], ['#c9ced6', '#d4a64a', '#c9ced6'], 'reflective'),
  // bottoms
  it('cargos_baggy', 'bottom', 'Baggy cargos', 'start', ['underground', 'sporty'], ['#5a5a4a', '#3a3a30', '#111111']),
  it('cargos_black', 'bottom', 'Black cargos', 'milestone:acid', ['dark', 'acid'], ['#111111', '#2a2d33', '#ffd400']),
  it('cargo_tech', 'bottom', 'Tech cargos', 'warehouse', ['dark', 'techwear'], ['#16171b', '#2a2d33', '#3a3d44'], 'satin'),
  it('shorts_tailored', 'bottom', 'Tailored shorts', 'beach', ['linen', 'holiday'], ['#d9cdb4', '#efe9dc', '#2a2d33']),
  it('shorts_navy', 'bottom', 'Navy shorts', 'boat', ['nautical'], ['#14213d', '#f7f7f5', '#d4a64a']),
  it('track_pants', 'bottom', 'Track pants', 'basement', ['sporty'], ['#111111', '#ffffff', '#1f4fa8'], 'satin', 'stripes'),
  it('trousers_flared', 'bottom', 'Flared trousers', 'rooftop', ['glam'], ['#e9e6df', '#c9a24a', '#111111'], 'satin'),
  it('shellsuit_bottoms', 'bottom', 'Shell suit bottoms', 'basement', ['sporty', 'bold'], ['#7a3cff', '#3ad7ff', '#ff2e88'], 'satin', 'stripes'),
  it('jeans_ripped', 'bottom', 'Ripped jeans', 'start', ['underground'], ['#3a5a86', '#2c4466', '#e9e6df'], 'denim'),
  it('joggers', 'bottom', 'Joggers', 'start', ['cozy'], ['#4a4f5a', '#2a2d33', '#ffffff']),
  it('jeans_straight', 'bottom', 'Straight jeans', 'start', ['smart'], ['#1f2c44', '#2c4466', '#c9a24a'], 'denim'),
  // socks
  it('socks_tennis', 'socks', 'Tennis socks', 'sunrise', ['bright', 'sporty'], ['#ffffff', '#d33a2c', '#1f4fa8']),
  it('socks_black', 'socks', 'Black socks', 'start', ['dark'], ['#111111', '#111111', '#2a2d33']),
  // shoes
  it('trainers_chunky', 'shoes', 'Chunky trainers', 'start', ['sporty', 'underground'], ['#f4f4f2', '#c9ced6', '#ff2e88']),
  it('slides', 'shoes', 'Slides', 'beach', ['holiday', 'linen'], ['#111111', '#e9e6df', '#c9a24a']),
  it('boots_tactical', 'shoes', 'Tactical boots', 'warehouse', ['dark', 'techwear'], ['#16171b', '#2a2d33', '#5a5a4a'], 'leather'),
  it('runners_retro', 'shoes', 'Retro runners', 'basement', ['sporty', 'bright'], ['#e9e6df', '#1f4fa8', '#d33a2c']),
  it('platforms', 'shoes', 'Platform shoes', 'rooftop', ['glam'], ['#c9a24a', '#111111', '#ffffff'], 'satin'),
  it('trainers_silver', 'shoes', 'Silver trainers', 'festival', ['future'], ['#c9ced6', '#8c96a6', '#3ad7ff'], 'reflective'),
  it('deck_shoes', 'shoes', 'Deck shoes', 'boat', ['nautical'], ['#8a5a32', '#f7f7f5', '#14213d'], 'leather'),
  it('sneakers_worn', 'shoes', 'Worn sneakers', 'start', ['underground'], ['#d9d4c7', '#8a8580', '#111111']),
  it('slippers', 'shoes', 'House slippers', 'start', ['cozy'], ['#4a4f5a', '#d9d6cf', '#ffb547'], 'velvet'),
  it('high_tops', 'shoes', 'High-tops', 'set:5', ['sporty'], ['#111111', '#ffffff', '#d33a2c']),
  // bag & extra
  it('record_bag', 'bag', 'Record bag', 'set:16', ['underground'], ['#2a2018', '#8a5a32', '#c9a24a'], 'leather'),
  it('towel', 'bag', 'Towel over the shoulder', 'start', ['underground', 'sporty'], ['#f4f4f2', '#ff2e88', '#d9d6cf']),
];

export const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

export interface OutfitSet {
  id: string;
  label: string;
  vibe: string;
  unlock: Unlock;
  pieces: Partial<Record<Slot, string>>;
  /** options that go with it (headphones round the neck…) */
  options?: Record<string, string>;
}

/** the 12 signature outfits (Section 4.7); every piece is also available on its own */
export const OUTFIT_SETS: OutfitSet[] = [
  { id: 'afterhours', label: 'Afterhours Classic', vibe: 'Effortless 5am cool', unlock: 'start', pieces: { top: 'tee_vintage', bottom: 'cargos_baggy', shoes: 'trainers_chunky', eyewear: 'shades_oval' } },
  { id: 'terrace_king', label: 'Terrace King', vibe: 'Ibiza sunset', unlock: 'beach', pieces: { top: 'shirt_linen', neck: 'chain_gold', bottom: 'shorts_tailored', shoes: 'slides', head: 'bucket_hat' } },
  { id: 'warehouse_ghost', label: 'Warehouse Ghost', vibe: 'Anonymous and dark', unlock: 'warehouse', pieces: { top: 'techwear_top', outer: 'utility_vest', head: 'hood_tech', bottom: 'cargo_tech', shoes: 'boots_tactical' } },
  { id: 'sunrise_set', label: 'Sunrise Set', vibe: 'Golden hour joy', unlock: 'sunrise', pieces: { top: 'shirt_floral', eyewear: 'shades_tinted', socks: 'socks_tennis', shoes: 'runners_retro' } },
  { id: 'selector', label: 'Selector', vibe: 'UK rave terrace', unlock: 'basement', pieces: { top: 'jersey_football', bottom: 'track_pants', shoes: 'runners_retro' } },
  { id: 'disco_revival', label: 'Disco Revival', vibe: '70s glitter', unlock: 'rooftop', pieces: { outer: 'jacket_sequin', bottom: 'trousers_flared', shoes: 'platforms' } },
  { id: 'acid_smiley', label: 'Acid Smiley', vibe: 'Classic acid house', unlock: 'milestone:acid', pieces: { top: 'tee_smiley', bottom: 'cargos_black', head: 'bucket_hat_smiley' } },
  { id: 'tracksuit_royalty', label: 'Tracksuit Royalty', vibe: '90s rave', unlock: 'basement', pieces: { outer: 'shellsuit_top', bottom: 'shellsuit_bottoms', shoes: 'runners_retro' } },
  { id: 'chrome_boy', label: 'Chrome Boy', vibe: 'Future rave', unlock: 'festival', pieces: { outer: 'puffer_metallic', eyewear: 'visor_reflective', shoes: 'trainers_silver' } },
  { id: 'boat_captain', label: 'Boat Party Captain', vibe: 'Fun on the water', unlock: 'boat', pieces: { head: 'captain_hat', top: 'shirt_white', bottom: 'shorts_navy', shoes: 'deck_shoes' } },
  { id: 'basement_dweller', label: 'Basement Dweller', vibe: 'Underground lifer', unlock: 'start', pieces: { top: 'tee_band', bottom: 'jeans_ripped', shoes: 'sneakers_worn', bag: 'towel' } },
  { id: 'bedroom_legend', label: 'Bedroom Legend', vibe: 'Where it all began', unlock: 'start', pieces: { top: 'hoodie', bottom: 'joggers', shoes: 'slippers', headphones: 'hp_studio' }, options: { phones_wear: 'neck' } },
];

/* ------------------------------------------------------------------ */
/* options and personality (Section 4.8)                                */
/* ------------------------------------------------------------------ */

/** enumerated choices a look stores, with their allowed values (first = default) */
export const OPTIONS = {
  face_shape: FACE_SHAPES,
  brows: BROWS,
  brow_slit: BROW_SLITS,
  facial_hair: FACIAL_HAIR,
  iris_style: IRIS_STYLES.map((i) => i.id),
  eyeliner: EYELINER,
  face_paint: FACE_PAINT,
  hair_color_mode: HAIR_COLOR_MODES,
  hair_finish: HAIR_FINISHES,
  phones_wear: ['both', 'one_ear', 'neck'],
  cap_wear: ['forward', 'backward'],
  groove: ['head_nod', 'shoulder_bounce', 'two_step', 'full_body', 'still'],
  drop_move: ['point', 'hands_up', 'headphones_up', 'jump', 'fist_pump'],
  between_habit: ['sip', 'wipe', 'wave'],
} as const satisfies Record<string, readonly string[]>;
export type OptionKey = keyof typeof OPTIONS;

export const OPTION_LABEL: Record<string, string> = {
  head_nod: 'Head nod', shoulder_bounce: 'Shoulder bounce', two_step: 'Two-step', full_body: 'Full-body dancer', still: 'Stone-cold still',
  point: 'Point at the crowd', hands_up: 'Both hands up', headphones_up: 'Headphones off, held up', jump: 'Jump', fist_pump: 'Fist pump',
  both: 'Both ears', one_ear: 'One ear', neck: 'Round the neck', forward: 'Forward', backward: 'Backward',
  sip: 'Sip from a bottle', wipe: 'Wipe brow with towel', wave: 'Wave at the crowd',
};

/** each venue's dress code (Section 4.9) */
export const VENUE_VIBES: Record<string, Vibe[]> = {
  bedroom: ['cozy'],
  basement: ['underground', 'sporty'],
  rooftop: ['smart', 'glam'],
  warehouse: ['dark', 'techwear'],
  beach: ['linen', 'holiday'],
  boat: ['nautical', 'holiday'],
  festival: ['bold', 'future'],
  sunrise: ['bright', 'holiday'],
  // the real rooms
  dc10: ['underground', 'holiday'],
  boilerroom: ['underground', 'sporty'],
  berghain: ['dark', 'techwear'],
  printworks: ['underground', 'dark'],
  allypally: ['bold', 'future'],
  'allypally-round': ['bold', 'future'],
};
