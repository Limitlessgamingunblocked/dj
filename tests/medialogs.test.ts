import { describe, expect, it } from 'vitest';
import { clipAround, MarkerLog, TracklistLog } from '../src/media/logs';
import { cropRect, layout, DEFAULT_OVERLAYS, mmss } from '../src/media/Compositor';
import { frameSize, mbPerMinute, videoBitrate } from '../src/media/MediaWriter';

const A = { id: 'a', title: 'Low Ceiling Theory', artist: 'Cold Tap' };
const B = { id: 'b', title: 'Third Floor Tape', artist: 'Night Clerk' };

describe('tracklist', () => {
  it('lists a track once it has been the main one for a few seconds, at the time it took over', () => {
    const log = new TracklistLog();
    for (let t = 0; t < 20; t += 0.5) log.update(t, A);
    // a quick listen to B in the middle doesn't count
    for (let t = 20; t < 23; t += 0.5) log.update(t, B);
    for (let t = 23; t < 40; t += 0.5) log.update(t, A);
    for (let t = 40; t < 60; t += 0.5) log.update(t, B);
    expect(log.entries.map((e) => [e.id, e.at])).toEqual([
      ['a', 0],
      ['b', 40],
    ]);
  });

  it('cuts a window with times from its start, carrying in the track already playing', () => {
    const log = new TracklistLog();
    for (let t = 0; t < 30; t += 0.5) log.update(t, A);
    for (let t = 30; t < 90; t += 0.5) log.update(t, B);
    expect(log.window(10, 60)).toEqual([
      { at: 0, title: A.title, artist: A.artist },
      { at: 20, title: B.title, artist: B.artist },
    ]);
    expect(log.window(40, 60)).toEqual([{ at: 0, title: B.title, artist: B.artist }]);
  });
});

describe('smart markers', () => {
  it('drops repeats of the same kind close together and windows the rest', () => {
    const m = new MarkerLog();
    m.add(10, 'drop', 'Drop');
    m.add(12, 'drop', 'Drop');
    m.add(12, 'transition', 'Bass swap');
    m.add(30, 'drop', 'Drop');
    expect(m.items).toHaveLength(3);
    expect(m.window(11, 40)).toEqual([
      { at: 1, kind: 'transition', label: 'Bass swap' },
      { at: 19, kind: 'drop', label: 'Drop' },
    ]);
  });

  it('picks a clip around a marker: the run-up for a drop, inside the audio', () => {
    expect(clipAround({ at: 60, kind: 'drop' }, 300, 2)).toEqual({ from: 44, to: 84 });
    expect(clipAround({ at: 5, kind: 'drop' }, 300, 2)).toEqual({ from: 0, to: 29 });
    expect(clipAround({ at: 295, kind: 'peak' }, 300, 2)).toEqual({ from: 285, to: 300 });
  });
});

describe('recording picture', () => {
  it('crops the stage to the frame, centred', () => {
    expect(cropRect(1600, 900, 1920, 1080)).toEqual({ x: 0, y: 0, w: 1600, h: 900 });
    const v = cropRect(1600, 900, 1080, 1920);
    expect(v.h).toBe(900);
    expect(v.w).toBeCloseTo(506.25);
    expect(v.x).toBeCloseTo((1600 - 506.25) / 2);
    const tall = cropRect(800, 1000, 1920, 1080);
    expect(tall.w).toBe(800);
    expect(tall.h).toBeCloseTo(450);
  });

  it('keeps the overlays out of the watermark’s corner', () => {
    const a = layout({ ...DEFAULT_OVERLAYS, corner: 'bl', tracklist: true, vhs: true });
    expect(a.nowPlaying).toBe('br');
    expect(a.tracklist).toBe('tr');
    // nothing lands on the watermark; with every overlay on, the VHS date has to share a corner
    expect([a.nowPlaying, a.tracklist, a.vhsPlay, a.vhsDate]).not.toContain('bl');
    expect(a.vhsPlay).toBe('tl');
    const b = layout({ ...DEFAULT_OVERLAYS, corner: 'tr', tracklist: true });
    expect(b.tracklist).toBe('tl');
    expect(b.nowPlaying).toBe('bl');
  });

  it('sizes frames per aspect and estimates the file size', () => {
    expect(frameSize('1080p', '16:9')).toEqual({ w: 1920, h: 1080 });
    expect(frameSize('1080p', '9:16')).toEqual({ w: 1080, h: 1920 });
    expect(frameSize('720p', '1:1')).toEqual({ w: 720, h: 720 });
    expect(videoBitrate(1920, 1080, 30)).toBe(6220800);
    expect(videoBitrate(320, 180, 30)).toBe(2e6);
    expect(mbPerMinute(1920, 1080, 30)).toBeCloseTo(48.6, 0);
    expect(mmss(75)).toBe('01:15');
    expect(mmss(3725)).toBe('1:02:05');
  });
});
