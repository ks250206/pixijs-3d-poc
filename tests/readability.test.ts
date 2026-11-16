import { describe, expect, it } from 'vite-plus/test';
import { overlaps, placeCombatLabels, type LabelAnchor } from '../src/render/readability';

describe('crowded combat labels', () => {
  it('keeps the attacking enemy readable and avoids overlapping labels in a crowd', () => {
    const anchors: LabelAnchor[] = Array.from({ length: 12 }, (_, i) => ({ id: `enemy-${i}`, x: 470 + i, y: 270, width: 48, height: 18, priority: i === 9 ? 100 : 0 }));
    const visible = placeCombatLabels(anchors, 960, 600).filter(label => label.visible);
    expect(visible.some(label => label.id === 'enemy-9')).toBe(true);
    expect(visible.length).toBeLessThan(anchors.length);
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
      const rect = (a: LabelAnchor) => ({ left: a.x - a.width / 2, right: a.x + a.width / 2, top: a.y - a.height, bottom: a.y });
      expect(overlaps(rect(visible[i]!), rect(visible[j]!))).toBe(false);
    }
  });

  it('clamps edge labels and omits text that would occupy the top toolbar', () => {
    const labels = placeCombatLabels([
      { id: 'left', x: -30, y: 180, width: 60, height: 18, priority: 1 },
      { id: 'right', x: 410, y: 180, width: 60, height: 18, priority: 1 },
      { id: 'top', x: 190, y: 10, width: 60, height: 18, priority: 1 },
    ], 390, 600);
    expect(labels.find(label => label.id === 'top')!.visible).toBe(false);
    for (const label of labels.filter(entry => entry.visible)) {
      expect(label.x - label.width / 2).toBeGreaterThanOrEqual(8);
      expect(label.x + label.width / 2).toBeLessThanOrEqual(382);
    }
  });
});
