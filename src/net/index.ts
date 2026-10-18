/*
 * Online play with friends, by room code. See room.ts for how to use it and
 * DECISIONS.md for why it's built this way.
 */
export { hostRoom, joinRoom, playStream, cleanName, isRoomMessage, JoinError, JOIN_FAILURE_TEXT, ROOM_PROTOCOL, Room } from './room';
export type { Player, RoomMessage, RoomOptions, CloseReason, JoinFailure } from './room';
export { newRoomCode, normalizeRoomCode, roomLink, roomFromUrl, CODE_LENGTH } from './codes';
export { PEERJS_CLOUD, DEFAULT_ICE, type SignalServer } from './signal';
