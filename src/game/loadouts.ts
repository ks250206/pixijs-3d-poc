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

const weapons: WeaponId[] = ['arc', 'pile', 'razor'];
const specials: SpecialId[] = ['pulse', 'blink', 'vortex'];
const traits: TraitId[] = ['lightweight', 'heavy-duty', 'overclocked', 'vampiric', 'volatile', 'stable'];
const weaponStats: Record<WeaponId, { power: number; speed: number; weight: number; subtitle: string; color: number }> = {
  arc: { power: 1, speed: 1, weight: 1, subtitle: 'PRECISION DUELIST', color: 0x5df4cf },
  pile: { power: 1.2, speed: 0.9, weight: 1.15, subtitle: 'HEAVY BREAKER', color: 0xffb263 },
  razor: { power: 0.87, speed: 1.15, weight: 0.9, subtitle: 'CLOSE-RANGE ASSASSIN', color: 0xb69aff },
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
  const chosenWeapons = shuffle(weapons, random);
  const chosenSpecials = shuffle(specials, random);
  const chosenTraits = shuffle(traits, random);
  const names = shuffle(['ECHO', 'NOVA', 'AXIOM', 'KIRA', 'VECTOR', 'GHOST'], random);
  return chosenWeapons.map((weapon, index) => {
    const special = chosenSpecials[index]!;
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
    };
  });
}
