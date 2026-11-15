import type { Loadout, SpecialId, TraitId, WeaponId } from './types';

/** Stable seeds make a chassis reproducible when sharing a run URL. */
export function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

const weapons: WeaponId[] = ['arc', 'pile', 'razor', 'lance', 'cannon', 'scythe'];
const specials: SpecialId[] = ['pulse', 'blink', 'vortex'];
const traits: TraitId[] = ['lightweight', 'heavy-duty', 'overclocked', 'vampiric', 'volatile', 'stable'];
const weaponStats: Record<WeaponId, { power: number; speed: number; weight: number; subtitle: string; color: number }> = {
  arc: { power: 1, speed: 1, weight: 1, subtitle: 'PRECISION DUELIST', color: 0x5df4cf },
  pile: { power: 1.2, speed: 0.9, weight: 1.15, subtitle: 'HEAVY BREAKER', color: 0xffb263 },
  razor: { power: 0.87, speed: 1.15, weight: 0.9, subtitle: 'CLOSE-RANGE ASSASSIN', color: 0xb69aff },
  lance: { power: 0.95, speed: 1.06, weight: 0.92, subtitle: 'TIP-RANGE SPECIALIST', color: 0x79cfff },
  cannon: { power: 1.08, speed: 0.82, weight: 1.22, subtitle: 'LANE ARTILLERIST', color: 0xff8686 },
  scythe: { power: 0.9, speed: 1, weight: 0.98, subtitle: 'CROWD CONTROLLER', color: 0xd6ed72 },
};

export const WEAPON_GUIDES: Record<WeaponId, { role: string; tip: string; weakness: string }> = {
  arc: { role: '万能剣士', tip: '踏み込みと3段斬り。中距離から単体を追撃。', weakness: '長槍や射撃には接近が必要。' },
  pile: { role: '重量ブレイカー', tip: '重い振り下ろし。溜め攻撃で盾と装甲を崩す。', weakness: '始動と戻りが遅い。' },
  razor: { role: '高速インファイター', tip: '左右の拳で高速連撃。回避から密着して攻める。', weakness: '短い間合いと軽いフレーム。' },
  lance: { role: '長槍の間合い管理', tip: '狭いレーンを長く突く。穂先の命中は威力1.35倍。', weakness: '横に広がる敵や密着戦は不得意。' },
  cannon: { role: '後方砲撃', tip: '通常攻撃も直線射撃。溜め砲撃で遠くから吹き飛ばす。', weakness: '発射後の隙が大きく、弾は遮蔽物に止まる。' },
  scythe: { role: '集団制圧', tip: '大鎌で前後と奥行きを一掃。包囲を回転攻撃で崩す。', weakness: '一撃の吹き飛ばしは控えめ。' },
};
const traitDescription: Record<TraitId, string> = {
  lightweight: '軽量フレーム。移動が速く、吹っ飛ばされやすい。',
  'heavy-duty': '重装フレーム。移動は遅いが、吹っ飛びに耐える。',
  overclocked: '限界駆動。移動速度と攻撃力が上がり、必殺技の再使用が速い。',
  vampiric: '自己修復。敵を撃破すると蓄積ダメージを10%回復。',
  volatile: '不安定な出力。攻撃力が高いが、自身も吹っ飛びやすい。',
  stable: '安定化装甲。攻撃力と吹っ飛び耐性を少し強化。',
};

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

export function createCandidates(seed: number): Loadout[] {
  const random = seededRandom(seed);
  // Preserve the original three seeded chassis while making all six available.
  const chosenWeapons = [...shuffle(weapons.slice(0, 3), random), ...weapons.slice(3)];
  const chosenSpecials = shuffle(specials, random);
  const chosenTraits = shuffle(traits, random);
  const names = shuffle(['ECHO', 'NOVA', 'AXIOM', 'KIRA', 'VECTOR', 'GHOST'], random);
  return chosenWeapons.map((weapon, index) => {
    const special = chosenSpecials[index % chosenSpecials.length]!;
    const trait = chosenTraits[index]!;
    const stats = weaponStats[weapon];
    let { power, speed, weight } = stats;
    if (trait === 'lightweight') { speed *= 1.2; weight *= 0.78; }
    if (trait === 'heavy-duty') { power *= 1.08; speed *= 0.88; weight *= 1.32; }
    if (trait === 'overclocked') { power *= 1.06; speed *= 1.12; }
    if (trait === 'vampiric') power *= 0.96;
    if (trait === 'volatile') { power *= 1.24; weight *= 0.82; }
    if (trait === 'stable') { power *= 1.03; weight *= 1.15; }
    const serial = Math.floor(random() * 89 + 10);
    return {
      id: `${seed >>> 0}-${index}-${weapon}-${special}-${trait}`,
      name: `${names[index]}-${serial}`,
      subtitle: stats.subtitle,
      weapon, special, trait, color: stats.color,
      power, speed, weight,
      description: traitDescription[trait],
      modules: { weapon: random() < 0.5 ? 'quick' : 'breaker', neutral: random() < 0.5 ? 'focused' : 'split', side: random() < 0.5 ? 'cross' : 'push', down: random() < 0.5 ? 'launch' : 'stagger' },
    };
  });
}

export function moduleGuide(loadout: Loadout): { slot: string; name: string; effect: string }[] {
  const split = loadout.modules.neutral === 'split';
  return [
    { slot: 'J', name: loadout.modules.weapon === 'quick' ? 'QUICK' : 'BREAKER', effect: loadout.modules.weapon === 'quick' ? '始動短縮・威力90%' : '始動+2F・威力112%' },
    { slot: 'L', name: loadout.special === 'pulse' ? split ? 'ION SPREAD' : 'ION PIERCE' : loadout.special === 'blink' ? split ? 'PHASE FAN' : 'PHASE SHIFT' : split ? 'GRAVITY FIELD' : 'GRAVITY WELL', effect: loadout.special === 'pulse' ? split ? '3方向弾' : '2体貫通弾' : loadout.special === 'blink' ? split ? '広い回転突進' : '高速直線突進' : split ? '広域吸引・弱打' : '集中吸引・強打' },
    { slot: '横L', name: loadout.modules.side === 'cross' ? 'PHASE CROSS' : 'PHASE PUSH', effect: loadout.modules.side === 'cross' ? '高速突進・長い無敵' : '短い突進・強い押し出し' },
    { slot: '上L', name: 'RISING CIRCUIT', effect: '全機共通・着地まで1回の上昇復帰' },
    { slot: '下L', name: loadout.modules.down === 'launch' ? 'EMP LAUNCH' : 'EMP STAGGER', effect: loadout.modules.down === 'launch' ? '上へ打ち上げ' : '低く短くのけぞらせる' },
  ];
}
