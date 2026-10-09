import { describe, expect, it } from 'vitest';
import { roomFor } from '../src/audio/room';

describe('venue acoustics', () => {
  it('the basement is tight and dry, the warehouse big, backstage has no room at all', () => {
    const basement = roomFor('basement');
    const warehouse = roomFor('warehouse');
    expect(basement.decay).toBeLessThan(0.5);
    expect(basement.wet).toBeLessThan(0.1);
    expect(warehouse.decay).toBeGreaterThan(2);
    expect(warehouse.wet).toBeGreaterThan(basement.wet);
    expect(roomFor('dressing').wet).toBe(0);
    // an unknown room still sounds like a club
    expect(roomFor('somewhere').wet).toBeGreaterThan(0);
  });
});
