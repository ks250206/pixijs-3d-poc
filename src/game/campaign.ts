import type { ActorKind } from './types';

export interface StageDefinition {
  name: string;
  title: string;
  objective: string;
  hint: string;
  theme: 'foundry' | 'transit' | 'skybridge' | 'hive' | 'core';
  color: number;
  waves: { name: string; enemies: ActorKind[] }[];
}

export const STAGES: StageDefinition[] = [
  { name: 'THE FOUNDRY', title: '01 / 反乱の火種', objective: '製造ラインから脱出', theme: 'foundry', color: 0x37dcd2,
    hint: '跳躍兵は着地後がチャンス。緑の箱から修復を回収。',
    waves: [
      { name: '警備ライン', enemies: ['scout', 'scout', 'gunner'] },
      { name: '跳躍部隊', enemies: ['bruiser', 'leaper', 'scout'] },
    ] },
  { name: 'NEURAL TRANSIT', title: '02 / 鋼鉄の騎兵', objective: '輸送線の番人を撃破', theme: 'transit', color: 0x9e93ee,
    hint: '騎乗兵は横へ回避。マウントを壊すと徒歩戦に変わる。',
    waves: [
      { name: '輸送護衛', enemies: ['sentinel', 'charger', 'gunner'] },
      { name: '機械騎兵', enemies: ['rider', 'drone'] },
      { name: '中ボス / THE WARDEN', enemies: ['warden'] },
    ] },
  { name: 'SKYBRIDGE', title: '03 / 頭上の脅威', objective: '空中回廊を突破', theme: 'skybridge', color: 0x6acbff,
    hint: '飛行敵には上攻撃。砲撃の着弾マーカーから離れよう。',
    waves: [
      { name: '空中迎撃', enemies: ['drone', 'leaper', 'gunner'] },
      { name: '後方砲撃', enemies: ['artillery', 'sentinel', 'drone'] },
    ] },
  { name: 'THE HIVE', title: '04 / 群れの司令塔', objective: '指揮系統を断ち切る', theme: 'hive', color: 0xc9ed6a,
    hint: '指揮官を倒すと子分が混乱。先に司令塔を狙おう。',
    waves: [
      { name: '群体制御', enemies: ['captain', 'sentinel'] },
      { name: '混成機動隊', enemies: ['captain', 'rider', 'leaper'] },
      { name: '中ボス / HIVE WARDEN', enemies: ['warden', 'minion', 'minion'] },
    ] },
  { name: 'THE MAINFRAME', title: '05 / 最後の命令', objective: '統制AIを停止', theme: 'core', color: 0xff9165,
    hint: '盾兵・砲撃・騎兵の連携を崩し、最後のコアへ。',
    waves: [
      { name: '防衛網', enemies: ['artillery', 'sentinel', 'leaper'] },
      { name: '最後の増援', enemies: ['captain', 'rider', 'drone'] },
      { name: '最終決戦 / THE ARCHITECT', enemies: ['boss'] },
    ] },
];

export const TRAINING_WAVES: ActorKind[][] = [
  ['scout', 'bruiser', 'drone'], ['sentinel', 'charger', 'gunner'],
  ['leaper', 'artillery', 'rider'], ['captain', 'warden'],
];
