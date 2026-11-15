import { describe, expect, it } from 'vite-plus/test';
import { GRAPHICS_PRESETS, loadGraphics, normalizeGraphics, saveGraphics, sceneResolution } from '../src/render/graphics';

describe('graphics preferences', () => {
  it('rejects malformed stored fields without discarding valid preferences', () => {
    expect(normalizeGraphics({ resolution: 50, shadows: 'ultra', lighting: 'false', effects: 'reduced', shake: false })).toEqual({ ...GRAPHICS_PRESETS.standard, effects: 'reduced', shake: false });
    for (const value of [null, [], 3, 'native']) expect(normalizeGraphics(value)).toEqual(GRAPHICS_PRESETS.standard);
  });
  it('loads saved preferences but honors explicit compatibility links', () => {
    const storage = { getItem: () => JSON.stringify(GRAPHICS_PRESETS.high) };
    expect(loadGraphics(storage)).toEqual(GRAPHICS_PRESETS.high);
    expect(loadGraphics(storage, 'compat')).toEqual(GRAPHICS_PRESETS.low);
  });
  it('keeps graphics usable with corrupt or denied storage', () => {
    expect(loadGraphics({ getItem: () => '{broken' })).toEqual(GRAPHICS_PRESETS.standard);
    expect(loadGraphics({ getItem: () => { throw new Error('denied'); } })).toEqual(GRAPHICS_PRESETS.standard);
    expect(() => saveGraphics({ setItem: () => { throw new Error('denied'); } }, GRAPHICS_PRESETS.low)).not.toThrow();
  });
  it('scales scene pixels independently of display density and bounds native mode', () => {
    expect(sceneResolution(GRAPHICS_PRESETS.low, 3)).toBe(0.5);
    expect(sceneResolution(GRAPHICS_PRESETS.high, 3)).toBe(2);
    expect(sceneResolution(GRAPHICS_PRESETS.high, NaN)).toBe(1);
  });
});
