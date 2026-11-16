import type { Loadout, WeaponId } from './types';
import type { MoveDefinition } from './combat/moves';
import { seededRandom } from './loadouts';

export type UpgradeId =
  | 'arc-skyhook' | 'arc-echo' | 'arc-launch'
  | 'pile-quake' | 'pile-link' | 'pile-launch'
  | 'razor-flow' | 'razor-juggle' | 'razor-link'
  | 'lance-capacitor' | 'lance-vault' | 'lance-sweep'
  | 'cannon-split' | 'cannon-bounce' | 'cannon-pierce'
  | 'scythe-chain' | 'scythe-pull' | 'scythe-link'
  | 'weapon-tune' | 'neutral-tune' | 'side-tune';

export interface RunUpgrade { id: UpgradeId; rank: number }
export interface UpgradeDefinition {
  id: UpgradeId;
  weapon: WeaponId | 'all';
  name: string;
  description: string;
  maxRank: number;
}
export interface UpgradeChoice extends UpgradeDefinition {
  rank: number;
  nextRank: number;
}

export const UPGRADE_DEFINITIONS: readonly UpgradeDefinition[] = [
  { id: 'arc-skyhook', weapon: 'arc', name: 'SKY LINK / 空中連結', description: '空中攻撃の命中で再上昇し、空中ジャンプを1回回復。着地まで1回。', maxRank: 2 },
  { id: 'arc-echo', weapon: 'arc', name: 'ARC ECHO / 追撃波', description: '弱攻撃の3段目から短射程の剣波を放つ。', maxRank: 2 },
  { id: 'arc-launch', weapon: 'arc', name: 'RISING EDGE / 打ち上げ連携', description: '上方向の通常技が垂直打ち上げになり、命中直後にジャンプで追撃できる。', maxRank: 2 },
  { id: 'pile-quake', weapon: 'pile', name: 'AFTERSHOCK / 追撃震', description: '地上スマッシュの後に、周囲へ遅れて衝撃波が広がる。', maxRank: 2 },
  { id: 'pile-link', weapon: 'pile', name: 'BREACH LINK / 破砕連携', description: 'スマッシュ命中後の硬直を回避・必殺技でキャンセルできる。', maxRank: 2 },
  { id: 'pile-launch', weapon: 'pile', name: 'FAULT LIFT / 地殻上昇', description: '下スマッシュが周囲を打ち上げる全周攻撃に変わる。', maxRank: 2 },
  { id: 'razor-flow', weapon: 'razor', name: 'COMBO DRIVE / 連撃駆動', description: '通常技を3回命中させると2秒間の移動加速を得る。', maxRank: 2 },
  { id: 'razor-juggle', weapon: 'razor', name: 'SKY COMBO / 浮かせ拳', description: '弱攻撃3段目が打ち上げに変わり、空中追撃へつながる。', maxRank: 2 },
  { id: 'razor-link', weapon: 'razor', name: 'FREE FLOW / 即時連携', description: '通常技の命中後、攻撃・ジャンプ・回避へ早くつなげる。', maxRank: 2 },
  { id: 'lance-capacitor', weapon: 'lance', name: 'TIP CAPACITOR / 穂先充填', description: '穂先命中で必殺技の再使用を短縮。1振りにつき1回。', maxRank: 2 },
  { id: 'lance-vault', weapon: 'lance', name: 'SKY TIP / 穂先打ち上げ', description: '横方向の通常技の穂先が敵を上へ打ち上げ、追撃の起点を作る。', maxRank: 2 },
  { id: 'lance-sweep', weapon: 'lance', name: 'LOW SWEEP / 足払い', description: '下強攻撃が全周の足払いへ変わり、密着と包囲に対処できる。', maxRank: 2 },
  { id: 'cannon-split', weapon: 'cannon', name: 'TRI SALVO / 三叉砲撃', description: 'スマッシュ射撃が3方向へ広がり、複数のレーンを攻撃する。', maxRank: 2 },
  { id: 'cannon-bounce', weapon: 'cannon', name: 'RICOCHET / 連鎖弾', description: '砲弾が命中後、近くの未命中の敵へ向きを変えて連鎖する。', maxRank: 2 },
  { id: 'cannon-pierce', weapon: 'cannon', name: 'RAIL ROUND / 貫通弾', description: '通常・スマッシュ砲撃が追加の敵を貫通する。', maxRank: 2 },
  { id: 'scythe-chain', weapon: 'scythe', name: 'CROWD FINISH / 包囲粉砕', description: '1振りで2体以上に当てると、遅れて周囲を吹き飛ばす追撃波が出る。', maxRank: 2 },
  { id: 'scythe-pull', weapon: 'scythe', name: 'HARVEST / 引き寄せ刃', description: '弱・強攻撃が敵を自分の周囲へ引き寄せ、次の範囲攻撃につなぐ。', maxRank: 2 },
  { id: 'scythe-link', weapon: 'scythe', name: 'ORBIT LINK / 旋回連携', description: 'スマッシュ命中後に必殺技・回避でキャンセルして包囲を抜ける。', maxRank: 2 },
  { id: 'weapon-tune', weapon: 'all', name: 'WEAPON REWIRE / 通常技交換', description: 'QUICKとBREAKERを交換。速度重視と重撃重視を切り替える。', maxRank: 6 },
  { id: 'neutral-tune', weapon: 'all', name: 'SPECIAL REWIRE / 必殺技交換', description: 'ニュートラル必殺技の集中型と広域型を交換する。', maxRank: 6 },
  { id: 'side-tune', weapon: 'all', name: 'PHASE REWIRE / 突進技交換', description: '横必殺技の高速型と押し出し型を交換する。', maxRank: 6 },
];

export const getUpgradeDefinition = (id: UpgradeId): UpgradeDefinition => UPGRADE_DEFINITIONS.find((definition) => definition.id === id)!;
export const upgradeRank = (upgrades: readonly RunUpgrade[], id: UpgradeId): number => upgrades.find((upgrade) => upgrade.id === id)?.rank ?? 0;

export function upgradeDescription(id: UpgradeId, rank: number, loadout?: Loadout): string {
  const base = getUpgradeDefinition(id).description;
  if (id === 'weapon-tune' && loadout) return `通常Jを ${loadout.modules.weapon === 'quick' ? 'BREAKER / 始動+2F・威力112%' : 'QUICK / 始動短縮・威力90%'} へ交換。取得済み強化は維持。`;
  if (id === 'neutral-tune' && loadout) return `ニュートラルLを${loadout.modules.neutral === 'focused' ? '広域型（3方向／広い突進／広域吸引）' : '集中型（貫通／直線突進／集中吸引）'}へ交換。系統と上Lの復帰は維持。`;
  if (id === 'side-tune' && loadout) return `横Lを ${loadout.modules.side === 'cross' ? 'PHASE PUSH / 短距離・強い押し出し' : 'PHASE CROSS / 高速突進・長い無敵'} へ交換。上Lの復帰は維持。`;
  const detail: Partial<Record<UpgradeId, string>> = {
    'arc-skyhook': `上昇速度 ${4.5 + rank * 1.5}。`, 'arc-echo': `剣波威力 ${4 + rank * 3}。`,
    'arc-launch': `基礎吹き飛ばし +${rank * 1.5}。`,
    'pile-quake': `半径 ${(2.6 + rank * .5).toFixed(1)} / 威力 ${5 + rank * 3}。`,
    'pile-link': `判定終了の${rank * 2}フレーム前から連携可能。`,
    'pile-launch': `追加の判定半径 +${(rank * .25).toFixed(2)}。`,
    'razor-flow': `移動速度 +${rank * 16}%。`,
    'razor-juggle': `打ち上げの基礎吹き飛ばし ${6 + rank * 1.5}。`,
    'razor-link': `判定開始の${Math.max(0, 2 - rank)}フレーム後から連携可能。`,
    'lance-capacitor': `短縮 ${(rank * .35).toFixed(2)}秒。`,
    'lance-vault': `穂先の基礎吹き飛ばし ${6 + rank * 2}、上方向へ。`,
    'lance-sweep': `足払いの範囲 ${(2.3 + rank * .3).toFixed(1)}。`,
    'cannon-bounce': `最大${rank}回連鎖。`, 'cannon-pierce': `追加${rank}体貫通。`,
    'cannon-split': `各弾の威力 ${rank === 1 ? 60 : 75}%。`,
    'scythe-chain': `追撃威力 ${4 + rank * 3} / 半径 ${(3 + rank * .4).toFixed(1)}。`,
    'scythe-pull': `引き寄せの速度係数 ${2 + rank}。装甲のない相手に有効。`,
    'scythe-link': `判定終了の${rank * 2}フレーム前から連携可能。`,
  };
  return `${base}${detail[id] ?? ''}`;
}

/** Two relevant weapon mechanics plus a deterministic module exchange, always three usable choices. */
export function createUpgradeChoices(seed: number, sector: number, loadout: Loadout, upgrades: readonly RunUpgrade[]): UpgradeChoice[] {
  const random = seededRandom(seed ^ Math.imul(sector + 1, 0x45d9f3b));
  const available = UPGRADE_DEFINITIONS.filter((d) => (d.weapon === loadout.weapon || d.weapon === 'all') && upgradeRank(upgrades, d.id) < d.maxRank);
  const weapon = available.filter((d) => d.weapon === loadout.weapon);
  const modules = available.filter((d) => d.weapon === 'all');
  for (let i = weapon.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [weapon[i], weapon[j]] = [weapon[j]!, weapon[i]!]; }
  for (let i = modules.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [modules[i], modules[j]] = [modules[j]!, modules[i]!]; }
  return [...weapon.slice(0, 2), ...modules].slice(0, 3).map((d) => {
    const rank = upgradeRank(upgrades, d.id);
    return { ...d, rank, nextRank: rank + 1, description: upgradeDescription(d.id, rank + 1, loadout) };
  });
}

/** Move geometry and cancels remain shared by simulation and rendering. */
export function upgradeMove(move: MoveDefinition, upgrades: readonly RunUpgrade[]): MoveDefinition {
  if (!upgrades.length || ['special', 'enemy', 'throw'].includes(move.kind)) return move;
  const result: MoveDefinition = { ...move, frames: { ...move.frames }, shape: { ...move.shape }, cancels: [...move.cancels] };
  const rank = (id: UpgradeId) => upgradeRank(upgrades, id);
  const link = (r: number, actions: ('attack' | 'special' | 'jump' | 'dodge')[], from = result.frames.startup + Math.max(0, 2 - r)) => {
    if (r) result.cancels.push({ on: 'hit', from, to: result.frames.startup + result.frames.active + result.frames.recovery - 1, actions });
  };
  if (move.pose === 'arc' && rank('arc-launch') && move.direction === 'up') {
    result.angle = 1.5; result.force += rank('arc-launch') * 1.5;
    link(rank('arc-launch'), ['jump'], result.frames.startup);
  }
  if (move.pose === 'pile') {
    if (move.kind === 'smash') link(rank('pile-link'), ['dodge', 'special'], result.frames.startup + result.frames.active - rank('pile-link') * 2);
    if (move.kind === 'smash' && move.direction === 'down' && rank('pile-launch')) {
      result.angle = 1.3; result.shape.trajectory = 'burst'; result.shape.radius += rank('pile-launch') * .25; result.shape.depth = 2.2 + rank('pile-launch') * .3;
    }
  }
  if (move.pose === 'razor') {
    link(rank('razor-link'), ['attack', 'jump', 'dodge']);
    if (move.kind === 'jab' && move.combo === 2 && rank('razor-juggle')) {
      result.angle = 1.4; result.force = 6 + rank('razor-juggle') * 1.5; link(rank('razor-juggle'), ['jump'], result.frames.startup);
    }
  }
  if (move.pose === 'lance' && move.kind === 'tilt' && move.direction === 'down' && rank('lance-sweep')) {
    result.shape.trajectory = 'orbit'; result.shape.reach = 2.3 + rank('lance-sweep') * .3; result.shape.radius = .35; result.shape.depth = 2.3; result.shape.tip = false; result.angle = .2;
  }
  if (move.pose === 'scythe' && move.kind === 'smash') link(rank('scythe-link'), ['special', 'dodge'], result.frames.startup + result.frames.active - rank('scythe-link') * 2);
  return result;
}
