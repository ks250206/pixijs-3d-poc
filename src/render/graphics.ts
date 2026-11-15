export interface GraphicsSettings {
  resolution: '50' | '75' | '100' | 'native';
  shadows: 'off' | 'low' | 'medium' | 'high';
  lighting: boolean;
  effects: 'reduced' | 'full';
  shake: boolean;
}
export interface GraphicsState {
  settings: GraphicsSettings;
  width: number;
  height: number;
  lightingAvailable: boolean;
}
export const GRAPHICS_KEY = 'null-uprising-graphics-v1';
export const GRAPHICS_PRESETS: Record<'low' | 'standard' | 'high', GraphicsSettings> = {
  low: { resolution: '50', shadows: 'off', lighting: false, effects: 'reduced', shake: false },
  standard: { resolution: '75', shadows: 'low', lighting: true, effects: 'full', shake: true },
  high: { resolution: 'native', shadows: 'medium', lighting: true, effects: 'full', shake: true },
};

export function normalizeGraphics(value: unknown): GraphicsSettings {
  const result = { ...GRAPHICS_PRESETS.standard };
  if (!value || typeof value !== 'object') return result;
  const source = value as Record<string, unknown>;
  if (typeof source.resolution === 'string' && ['50', '75', '100', 'native'].includes(source.resolution)) result.resolution = source.resolution as GraphicsSettings['resolution'];
  if (typeof source.shadows === 'string' && ['off', 'low', 'medium', 'high'].includes(source.shadows)) result.shadows = source.shadows as GraphicsSettings['shadows'];
  if (source.effects === 'reduced' || source.effects === 'full') result.effects = source.effects;
  if (typeof source.lighting === 'boolean') result.lighting = source.lighting;
  if (typeof source.shake === 'boolean') result.shake = source.shake;
  return result;
}
export function loadGraphics(storage: Pick<Storage, 'getItem'>, quality: string | null = null): GraphicsSettings {
  // Explicit compatibility/high-quality links override stored preferences for this visit.
  if (quality === 'compat') return { ...GRAPHICS_PRESETS.low };
  if (quality === 'high') return { ...GRAPHICS_PRESETS.high };
  try { return normalizeGraphics(JSON.parse(storage.getItem(GRAPHICS_KEY) ?? 'null')); }
  catch { return { ...GRAPHICS_PRESETS.standard }; }
}
export function saveGraphics(storage: Pick<Storage, 'setItem'>, settings: GraphicsSettings): void {
  try { storage.setItem(GRAPHICS_KEY, JSON.stringify(settings)); } catch { /* In-memory settings still work when storage is unavailable. */ }
}
export function sceneResolution(settings: GraphicsSettings, dpr: number): number {
  return settings.resolution === 'native' ? Math.min(2, Math.max(1, Number.isFinite(dpr) ? dpr : 1)) : Number(settings.resolution) / 100;
}
