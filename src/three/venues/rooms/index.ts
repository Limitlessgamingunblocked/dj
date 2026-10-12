/* The crazy rooms (rooms/kit.ts): secret venues where the room itself is the light show. */
import type { VenueDef } from '../base';
import { fogRoom } from './fog';
import { glitchRoom } from './glitch';
import { hologramRoom } from './hologram';
import { kaleidoDome } from './kaleido';
import { laserGrid } from './lasergrid';
import { ledCube } from './ledcube';
import { mirrorRoom } from './mirror';
import { neonMaze } from './neonmaze';
import { soundWave } from './soundwave';
import { upsideDown } from './upsidedown';
import { uvRoom } from './uv';
import { waterRoom } from './water';
import { zeroGravity } from './zerog';
import { aquarium } from './aquarium';
import { insideSpeaker } from './speaker';
import { vinylFloor } from './vinyl';
import { lavaLamp } from './lava';
import { arcadeRoom } from './arcade';
import { cloudRoom } from './cloud';

/** in the order their challenges usually come (game/rooms.ts) */
export const CRAZY_ROOMS: VenueDef[] = [uvRoom, kaleidoDome, glitchRoom, laserGrid, ledCube, neonMaze, waterRoom, fogRoom, mirrorRoom, soundWave, upsideDown, hologramRoom, lavaLamp, arcadeRoom, vinylFloor, aquarium, insideSpeaker, zeroGravity, cloudRoom];
