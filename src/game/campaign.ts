import type { ActorKind } from './types';

export const SECTOR_SPAN = 34;
export const ARENA_HALF_WIDTH = 14;

export interface StageDefinition {
  name: string;
  title: string;
  objective: string;
  hint: string;
  theme: 'foundry' | 'transit' | 'skybridge' | 'hive' | 'barracks' | 'gauntlet' | 'core';
  color: number;
  waves: { name: string; enemies: ActorKind[] }[];
}

export const STAGES: StageDefinition[] = [
  { name: 'THE FOUNDRY', title: '01 / 反乱の火種', objective: '製造ラインから脱出', theme: 'foundry', color: 0x37dcd2,
    hint: '跳躍兵は着地後がチャンス。緑の箱から修復を回収。',
    waves: [
      { name: '警備ライン', enemies: ['scout', 'scout', 'gunner', 'minion', 'minion', 'minion'] },
      { name: '跳躍部隊', enemies: ['bruiser', 'leaper', 'scout', 'minion', 'minion', 'minion'] },
      { name: '封鎖工作', enemies: ['sapper', 'scout', 'scout', 'minion', 'minion', 'minion'] },
    ] },
  { name: 'NEURAL TRANSIT', title: '02 / 鋼鉄の騎兵', objective: '輸送線の番人を撃破', theme: 'transit', color: 0x9e93ee,
    hint: '騎乗兵は横へ回避。マウントを壊すと徒歩戦に変わる。',
    waves: [
      { name: '輸送護衛', enemies: ['sentinel', 'charger', 'gunner', 'minion', 'minion', 'minion'] },
      { name: '機械騎兵', enemies: ['rider', 'drone', 'minion', 'minion', 'minion'] },
      { name: '中ボス / THE WARDEN', enemies: ['warden'] },
    ] },
  { name: 'SKYBRIDGE', title: '03 / 頭上の脅威', objective: '空中回廊を突破', theme: 'skybridge', color: 0x6acbff,
    hint: '飛行敵には上攻撃。砲撃の着弾マーカーから離れよう。',
    waves: [
      { name: '空中迎撃', enemies: ['drone', 'leaper', 'gunner', 'minion', 'minion', 'minion'] },
      { name: '後方砲撃', enemies: ['artillery', 'sentinel', 'drone', 'minion', 'minion', 'minion'] },
      { name: '長距離狙撃', enemies: ['sniper', 'leaper', 'drone', 'minion', 'minion', 'minion'] },
    ] },
  { name: 'THE HIVE', title: '04 / 群れの司令塔', objective: '指揮系統を断ち切る', theme: 'hive', color: 0xc9ed6a,
    hint: '指揮官を倒すと子分が混乱。先に司令塔を狙おう。',
    waves: [
      { name: '群体制御', enemies: ['captain', 'sentinel', 'minion', 'minion', 'minion'] },
      { name: '混成機動隊', enemies: ['captain', 'rider', 'leaper', 'minion', 'minion', 'minion'] },
      { name: '中ボス / HIVE WARDEN', enemies: ['warden', 'minion', 'minion', 'minion', 'minion', 'minion'] },
    ] },
  { name: 'IRON LEGION', title: '05 / 雑兵の大軍', objective: '量産兵の四連波を突破', theme: 'barracks', color: 0xffcc65,
    hint: '小型兵の大軍。範囲攻撃と爆発ドラムで包囲を崩そう。',
    waves: [
      { name: '第一陣 / 量産兵', enemies: ['minion', 'minion', 'minion', 'minion', 'minion', 'minion', 'minion', 'minion', 'minion', 'minion', 'minion', 'minion'] },
      { name: '第二陣 / 両翼包囲', enemies: ['minion', 'scout', 'minion', 'minion', 'minion', 'scout', 'minion', 'minion', 'minion', 'minion', 'minion', 'minion', 'minion', 'minion', 'minion'] },
      { name: '第三陣 / 指揮官随伴', enemies: ['captain', 'minion', 'minion', 'minion', 'minion', 'minion', 'minion', 'minion', 'minion', 'sapper', 'minion', 'minion', 'minion', 'minion', 'minion'] },
      { name: '最終陣 / 総攻撃', enemies: ['minion', 'minion', 'minion', 'minion', 'scout', 'minion', 'minion', 'minion', 'minion', 'minion', 'minion', 'scout', 'minion', 'minion', 'minion', 'minion', 'minion', 'minion'] },
    ] },
  { name: 'SIEGE CORRIDOR', title: '06 / 包囲回廊', objective: '最後の防衛線を突破', theme: 'gauntlet', color: 0x77aaff,
    hint: '細い狙撃線は奥行きに避け、地雷の四角から離れよう。',
    waves: [
      { name: '交差射線', enemies: ['sniper', 'sentinel', 'gunner', 'scout', 'minion', 'minion', 'minion'] },
      { name: '地雷封鎖', enemies: ['sapper', 'sapper', 'charger', 'drone', 'minion', 'minion', 'minion'] },
      { name: '機動防衛線', enemies: ['rider', 'sniper', 'leaper', 'bruiser', 'minion', 'minion', 'minion'] },
    ] },
  { name: 'THE MAINFRAME', title: '07 / 最後の命令', objective: '統制AIを停止', theme: 'core', color: 0xff9165,
    hint: 'ボスの床予告を読み、攻撃終了後の隙を狙え。装甲破壊後も重量級。',
    waves: [
      { name: '防衛網', enemies: ['artillery', 'sentinel', 'leaper', 'minion', 'minion', 'minion'] },
      { name: '最後の増援', enemies: ['captain', 'rider', 'drone', 'minion', 'minion', 'minion'] },
      { name: 'コア直衛', enemies: ['sniper', 'sapper', 'sentinel', 'minion', 'minion', 'minion'] },
      { name: '最終決戦 / THE ARCHITECT', enemies: ['boss'] },
    ] },
];

export const TRAINING_WAVES: ActorKind[][] = [
  ['scout', 'bruiser', 'drone'], ['sentinel', 'charger', 'gunner'],
  ['leaper', 'artillery', 'rider'], ['captain', 'warden'],
  ['sniper', 'sapper', 'minion', 'minion'],
];
