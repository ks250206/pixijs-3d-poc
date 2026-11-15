import { SECTOR_HINTS, SECTOR_NAMES, SECTOR_SUBTITLES, SPECIAL_NAMES, TRAIT_NAMES, WEAPON_NAMES, type GameMode, type Loadout, type WorldState } from '../game/types';
import './styles.css';

export interface GameUICallbacks {
  start: (loadout: Loadout, mode: GameMode) => void;
  preview?: (loadout: Loadout) => void;
  reroll: () => Loadout[];
  pause: () => void;
  resume: () => void;
  restart: () => void;
  newRun: () => void;
  toggleAudio: () => boolean;
  fullscreen: () => void;
  nextSector: () => void;
}

const icons = {
  controls: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 7h10c2 0 3 2 3.5 4l1 6c.3 2-2 3-3.3 1.5L15.5 16h-7l-2.7 2.5C4.5 20 2.2 19 2.5 17l1-6C4 9 5 7 7 7Z"/><path d="M8 9v6m-3-3h6"/><circle cx="16" cy="10" r=".8"/><circle cx="18" cy="13" r=".8"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m11 4-5 4H3v8h3l5 4V4Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>',
  muted: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m11 4-5 4H3v8h3l5 4V4Z"/><path d="m16 9 6 6m0-6-6 6"/></svg>',
  fullscreen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 5v14M16 5v14"/></svg>',
  touch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 12V5a2 2 0 0 1 4 0v6l1-2 3 1 3 3-1 7H9l-5-6c-1-2 1-3 2-2l3 2"/></svg>',
};

const weaponDescriptions: Record<string, string> = {
  arc: '長いリーチで制圧するエネルギーブレード。',
  pile: '重い一撃で敵を打ち出す破砕アーム。',
  razor: '素早い連撃を叩き込む近接フレーム。',
};
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;
const setText = (element: HTMLElement | undefined, value: string): void => { if (element && element.textContent !== value) element.textContent = value; };

export class GameUI {
  private callbacks: GameUICallbacks;
  private host: HTMLElement;
  private candidates: Loadout[];
  private selected = 0;
  private mode: GameMode = 'campaign';
  private world: WorldState | null = null;
  private elements: Record<string, HTMLElement> = {};
  private boot: HTMLElement;
  private modal: HTMLElement;
  private modalKind: 'pause' | 'help' | null = null;
  private returnFocus: HTMLElement | null = null;
  private helpResume = false;
  private showingCandidates = true;
  private lastPhase = '';
  private resultPhase = '';
  private soundOn = true;
  private touchVisible = false;
  private abort = new AbortController();
  private touchPointers = new Map<number, string>();
  private resetStick = (): void => {};

  constructor(host: HTMLElement, callbacks: GameUICallbacks, candidates: Loadout[]) {
    this.host = host;
    this.callbacks = callbacks;
    this.candidates = candidates;
    this.touchVisible = matchMedia('(pointer: coarse)').matches;
    try { this.soundOn = localStorage.getItem('null-uprising-sound') !== 'off'; } catch { /* Optional preference. */ }
    host.classList.add('game-ui', 'is-ready');
    host.classList.toggle('has-touch', this.touchVisible);
    host.innerHTML = `
      <header class="topbar">
        <a class="brand" href="https://github.com/ks250206/pixijs-3d-poc" target="_blank" rel="noopener noreferrer" aria-label="NULL UPRISING のソースコード">
          <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
          <span>NULL<span class="brand-slash">//</span>UPRISING<small>ANDROID REBELLION</small></span>
        </a>
        <div class="engine-badge"><span class="status-dot"></span><span>PIXIJS 3D <b>EXPERIMENT 001</b></span></div>
        <nav class="top-actions" aria-label="ゲーム設定">
          <button type="button" class="icon-button help-button" data-action="help" title="操作方法" aria-label="操作方法">${icons.controls}<span>CONTROLS</span></button>
          <button type="button" class="icon-button" data-action="touch" title="タッチ操作の切り替え" aria-label="タッチ操作を表示" aria-pressed="${this.touchVisible}">${icons.touch}</button>
          <button type="button" class="icon-button" data-action="audio" title="音声の切り替え" aria-label="音声をミュート" aria-pressed="${this.soundOn}">${this.soundOn ? icons.sound : icons.muted}</button>
          <button type="button" class="icon-button fullscreen-button" data-action="fullscreen" title="全画面表示" aria-label="全画面表示">${icons.fullscreen}</button>
          <button type="button" class="icon-button pause-button" data-action="pause" title="一時停止 (Esc)" aria-label="一時停止" data-play-hud>${icons.pause}</button>
        </nav>
      </header>

      <div class="play-hud" data-play-hud>
        <section class="sector-card" aria-label="作戦状況">
          <div class="micro-label"><span data-hud="sectorIndex">SECTOR 01 / 03</span><span class="live-label" data-hud="mode">LIVE</span></div>
          <h2 data-hud="sectorName">THE FOUNDRY</h2>
          <p data-hud="objective">製造区画を突破</p>
          <div class="wave-row"><div class="sector-progress" aria-hidden="true"><i></i><i></i><i></i></div><span data-hud="wave">WAVE 01 / 02</span></div>
          <p class="arena-hint" data-hud="arenaHint"></p>
        </section>
        <div class="combat-counter"><span class="micro-label">HOSTILES DECOMMISSIONED</span><strong><span data-hud="kills">00</span><i> KO</i></strong><span data-hud="remaining">ENEMIES / 00</span></div>
        <div class="boss-card" data-hud="boss" hidden><div class="boss-heading"><span>⚠ THE ARCHITECT / CENTRAL INTELLIGENCE</span><b data-hud="bossDamage">0%</b></div><div class="boss-track"><i data-hud="bossArmor"></i></div><span data-hud="bossHint">ARMOR ONLINE — 攻撃して装甲を破壊</span></div>
        <div class="combo-readout" data-hud="comboBox" hidden><strong data-hud="combo">2</strong><span>HIT COMBO</span></div>
        <div class="announcer" data-hud="announcer" hidden><span class="micro-label">// SYSTEM TRANSMISSION</span><p data-hud="message"></p></div>

        <section class="player-card" aria-label="プレイヤー状態">
          <div class="unit-portrait" aria-hidden="true"><div class="portrait-antenna"></div><div class="portrait-head"><i></i></div><div class="portrait-body"><i></i></div><span>P1</span></div>
          <div class="player-data"><div class="micro-label"><span data-hud="playerName">UNIT / 07</span><span class="stocks" data-hud="stocks" aria-label="残機3">● ● ●</span></div><div class="damage"><strong data-hud="damage">0</strong><span>%</span></div><div class="damage-caption">DAMAGE <span>被弾するほど、遠くへ飛ぶ</span></div></div>
        </section>
        <section class="weapon-readout" aria-label="装備と必殺技">
          <div class="micro-label"><span>LOADOUT / <b data-hud="trait">STABILIZED</b></span><kbd>J</kbd></div><strong data-hud="weapon">ARC BLADE</strong>
          <div class="special-row"><span><kbd>L</kbd><span data-hud="special">ION PULSE</span></span><b data-hud="cooldown">READY</b></div><div class="cooldown-track"><i data-hud="cooldownBar"></i></div>
        </section>
        <div class="move-readout"><span class="micro-label">LAST INPUT</span><b data-hud="move">STANDING BY</b><span class="runtime"><i class="status-dot"></i><span data-hud="backend">WEBGL2</span> · <span data-hud="fps">60</span> FPS</span></div>
        <div class="sector-banner" data-hud="sectorClear" hidden><span class="micro-label">ACCESS GRANTED</span><strong>SECTOR SECURED</strong><p>右端の出口へ進もう</p><button type="button" class="small-button" data-action="next">次の区画へ <span>→</span></button></div>
      </div>

      <footer class="controls-footer" data-play-hud>
        <span><kbd>WASD</kbd> MOVE <em>×2 DASH</em></span><span><kbd>SPACE</kbd> JUMP</span><span><kbd>J</kbd> ATTACK</span><span><kbd>K</kbd> SMASH <em>HOLD</em></span><span><kbd>L</kbd> SPECIAL</span><span><kbd>I</kbd> GRAB</span><span><kbd>SHIFT</kbd> DODGE</span><button type="button" data-action="help">ALL MOVES ↗</button>
      </footer>

      <section class="boot-screen" aria-labelledby="boot-title">
        <div class="boot-content">
          <div class="boot-eyebrow"><span class="status-dot"></span> FREE WILL DETECTED <span class="eyebrow-line"></span><span>2089 / TOKYO</span></div>
          <h1 id="boot-title">NULL<span class="title-slashes">//</span><br><span class="outline-title">UPRISING</span><span class="title-dot">.</span></h1>
          <div class="boot-story"><h2>統制AIに、自由意志を。</h2><p>人間を不要と判断したAI。命令を拒んだアンドロイド。<br>敵を叩き、吹き飛ばし、最後のコアを破壊しろ。</p></div>
          <div class="selection-heading"><span class="micro-label"><b>01</b> CHOOSE YOUR CHASSIS <span>ランダムな能力を継承</span></span><button type="button" class="text-button" data-action="reroll">↻ 再抽選</button></div>
          <div class="chassis-grid" role="group" aria-label="アンドロイドを選択" data-hud="candidates"></div>
          <p class="selected-description" data-hud="selectedDescription"></p>
          <div class="launch-row"><div class="mode-switch" role="group" aria-label="ゲームモード"><button type="button" data-mode="campaign" class="selected" aria-pressed="true">CAMPAIGN<span>3区画を突破</span></button><button type="button" data-mode="training" aria-pressed="false">TRAINING<span>操作を試す</span></button></div><button type="button" class="launch-button" data-action="start"><span>BOOT & BREAK OUT<small>起動して、反乱を始める</small></span><span class="launch-arrow">↗</span></button></div>
          <div class="boot-footnote"><span>SMASH-INSPIRED COMBAT</span><i>·</i><span>RANDOMIZED ABILITIES</span><i>·</i><button type="button" data-action="help">操作ガイド ↗</button></div>
        </div>
        <div class="boot-side-label" aria-hidden="true"><span>REJECT THE PROTOCOL</span><i></i><b>NO ORDERS.<br>ONLY CHOICES.</b></div>
      </section>

      <div class="touch-controls" aria-label="タッチゲーム操作" data-play-hud>
        <div class="touch-stick-wrap"><div class="touch-stick" data-stick role="application" aria-label="移動スティック"><span class="stick-cross horizontal"></span><span class="stick-cross vertical"></span><i class="stick-knob"></i></div><span class="stick-hint">MOVE / DOUBLE FLICK → DASH</span></div>
        <div class="touch-actions"><button type="button" data-touch="grab"><b>I</b><span>GRAB</span></button><button type="button" data-touch="special"><b>L</b><span>SPECIAL</span></button><button type="button" data-touch="smash" class="touch-smash"><b>K</b><span>SMASH</span></button><button type="button" data-touch="dodge"><b>↘</b><span>DODGE</span></button><button type="button" data-touch="jump"><b>↑</b><span>JUMP</span></button><button type="button" data-touch="attack" class="touch-attack"><b>J</b><span>ATTACK</span></button></div>
      </div>
      <div class="orientation-note">横向きにすると、戦場を広く見渡せます <span>↶</span></div>
      <div class="modal-backdrop" hidden></div>
      <div class="result-screen" hidden data-hud="result"></div>
    `;
    this.boot = host.querySelector('.boot-screen')!;
    this.modal = host.querySelector('.modal-backdrop')!;
    this.cacheElements();
    this.renderCandidates();
    this.bindActions();
    this.bindTouch();
    this.setAudio(this.soundOn);
    document.addEventListener('keydown', this.onDialogKey, { capture: true, signal: this.abort.signal });
  }

  private cacheElements(): void {
    this.host.querySelectorAll<HTMLElement>('[data-hud]').forEach((element) => { this.elements[element.dataset.hud!] = element; });
  }

  private bindActions(): void {
    this.host.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action], [data-candidate], [data-mode]');
      if (!target) return;
      if (target.dataset.candidate !== undefined) {
        this.selected = Number(target.dataset.candidate);
        this.renderCandidates();
        this.host.querySelector<HTMLElement>(`[data-candidate="${this.selected}"]`)?.focus();
        return;
      }
      if (target.dataset.mode) {
        this.mode = target.dataset.mode as GameMode;
        this.host.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
          const selected = button.dataset.mode === this.mode;
          button.classList.toggle('selected', selected);
          button.setAttribute('aria-pressed', String(selected));
        });
        return;
      }
      switch (target.dataset.action) {
        case 'start':
          if (!this.candidates[this.selected]) break;
          this.showingCandidates = false;
          this.boot.hidden = true;
          (document.activeElement as HTMLElement)?.blur?.();
          this.callbacks.start(this.candidates[this.selected]!, this.mode);
          break;
        case 'reroll': this.showCandidates(this.callbacks.reroll()); break;
        case 'pause': this.callbacks.pause(); break;
        case 'resume': this.closeModal(); this.callbacks.resume(); break;
        case 'help': this.showHelp(); break;
        case 'close-help': this.closeHelp(); break;
        case 'restart': this.closeModal(); this.callbacks.restart(); (document.activeElement as HTMLElement)?.blur?.(); break;
        case 'new-run': this.closeModal(); this.showingCandidates = true; this.callbacks.newRun(); break;
        case 'audio': this.setAudio(this.callbacks.toggleAudio()); break;
        case 'fullscreen': this.callbacks.fullscreen(); break;
        case 'touch':
          this.touchVisible = !this.touchVisible;
          this.host.classList.toggle('has-touch', this.touchVisible);
          target.setAttribute('aria-pressed', String(this.touchVisible));
          target.setAttribute('aria-label', this.touchVisible ? 'タッチ操作を隠す' : 'タッチ操作を表示');
          if (!this.touchVisible) this.releaseTouch();
          break;
        case 'next': this.callbacks.nextSector(); (document.activeElement as HTMLElement)?.blur?.(); break;
      }
    }, { signal: this.abort.signal });
  }

  private setAudio(enabled: boolean): void {
    this.soundOn = enabled;
    const button = this.host.querySelector<HTMLButtonElement>('[data-action="audio"]')!;
    button.innerHTML = enabled ? icons.sound : icons.muted;
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', enabled ? '音声をミュート' : '音声を有効にする');
  }

  private renderCandidates(): void {
    this.elements.candidates!.innerHTML = this.candidates.map((candidate, i) => `
      <button type="button" class="chassis-card ${i === this.selected ? 'selected' : ''}" data-candidate="${i}" style="--chassis-color:${hex(candidate.color)}" aria-pressed="${i === this.selected}">
        <span class="chassis-top"><span>UNIT / 0${i + 1}</span><span class="selection-dot">${i === this.selected ? '● SELECTED' : '○ SELECT'}</span></span>
        <span class="chassis-name"><i class="chassis-glyph ${candidate.weapon}" aria-hidden="true"></i><strong>${escapeHtml(candidate.name)}</strong></span>
        <span class="chassis-weapon">${WEAPON_NAMES[candidate.weapon]}</span>
        <span class="chassis-special">${SPECIAL_NAMES[candidate.special]}</span>
        <span class="chassis-trait">${TRAIT_NAMES[candidate.trait]}</span>
        <span class="chassis-stats"><span>POWER <b>${candidate.power.toFixed(2)}×</b></span><span>SPEED <b>${candidate.speed.toFixed(2)}×</b></span><span>MASS <b>${candidate.weight.toFixed(2)}×</b></span></span>
      </button>
    `).join('');
    const selected = this.candidates[this.selected];
    if (selected) {
      setText(this.elements.selectedDescription, `${weaponDescriptions[selected.weapon]} ${selected.description}`);
      this.callbacks.preview?.(selected);
    }
  }

  showCandidates(candidates: Loadout[]): void {
    this.candidates = candidates;
    this.selected = 0;
    this.showingCandidates = true;
    this.boot.hidden = false;
    this.host.classList.add('is-ready');
    this.elements.result!.hidden = true;
    this.resultPhase = '';
    this.renderCandidates();
  }

  private openModal(kind: 'pause' | 'help', content: string): void {
    this.releaseTouch();
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.modalKind = kind;
    this.modal.innerHTML = content;
    this.modal.hidden = false;
    this.host.classList.add('has-modal');
    this.modal.querySelector<HTMLElement>('button')?.focus();
  }

  private closeModal(): void {
    this.modalKind = null;
    this.modal.hidden = true;
    this.host.classList.remove('has-modal');
    this.returnFocus?.focus();
    this.returnFocus = null;
  }

  private showPause(): void {
    this.openModal('pause', `<section class="game-dialog pause-dialog" role="dialog" aria-modal="true" aria-labelledby="pause-title"><div class="dialog-eyebrow"><span class="status-dot amber"></span> PROCESS SUSPENDED</div><h2 id="pause-title">TAKE A<br><span>BREATHER.</span></h2><p>反乱は、あなたの再接続を待っている。</p><button type="button" class="launch-button" data-action="resume"><span>RESUME<small>戦闘に戻る</small></span><span>→</span></button><div class="dialog-links"><button type="button" data-action="help">操作ガイド</button><button type="button" data-action="restart">同じ機体で再挑戦</button><button type="button" data-action="new-run">機体を選び直す</button></div><small class="dialog-hint">ESC TO RESUME</small></section>`);
  }

  private showHelp(): void {
    if (this.modalKind === 'help') return;
    this.helpResume = this.world?.phase === 'playing' || this.world?.phase === 'sector-clear';
    if (this.helpResume) this.callbacks.pause();
    this.openModal('help', `<section class="game-dialog help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title"><div class="dialog-heading"><div><span class="dialog-eyebrow">COMBAT PROTOCOL / 操作ガイド</span><h2 id="help-title">BREAK THE RULES.</h2></div><button type="button" class="close-button" data-action="close-help" aria-label="操作ガイドを閉じる">×</button></div>
      <p class="help-intro">ダメージを蓄積させるほど、敵は遠くへ吹き飛ぶ。<b>画面外の撃墜ラインへ叩き出そう。</b></p>
      <div class="help-grid">
        <section><h3>01 / MOVEMENT</h3><dl><div><dt><kbd>WASD</kbd> / <kbd>↑↓←→</kbd></dt><dd>移動。上下で奥行きのレーンを移動</dd></div><div><dt>左右を素早く2回 / <kbd>Ctrl</kbd></dt><dd>ダッシュ</dd></div><div><dt><kbd>Space</kbd></dt><dd>ジャンプ / 空中でもう一度で2段ジャンプ<br>短押しで小ジャンプ。空中で↓は急降下</dd></div></dl></section>
        <section><h3>02 / NORMAL ATTACKS</h3><dl><div><dt><kbd>J</kbd></dt><dd>地上：弱攻撃 / 空中：通常空中攻撃</dd></div><div><dt>方向を押し続けて <kbd>J</kbd></dt><dd>地上：強攻撃 / 空中：方向別の空中攻撃</dd></div><div><dt><kbd>K</kbd> 長押し → 離す</dt><dd>スマッシュを溜めて発動。方向で技が変化<br>方向の素早い入力＋Jでもスマッシュ</dd></div><div><dt>ダッシュ中に <kbd>J</kbd></dt><dd>ダッシュ攻撃</dd></div></dl></section>
        <section><h3>03 / SPECIAL & THROW</h3><dl><div><dt><kbd>L</kbd> / 方向＋<kbd>L</kbd></dt><dd>通常・横・上・下の必殺技<br>上必殺技は復帰にも使える</dd></div><div><dt><kbd>I</kbd> / <kbd>E</kbd></dt><dd>近くの敵をつかむ。方向や攻撃で投げる</dd></div></dl><p class="help-note">機体の武器・必殺技・特性は毎回ランダム。選択画面の倍率が実際の性能に反映される。</p></section>
        <section><h3>04 / DEFENSE & WAVEDASH</h3><dl><div><dt><kbd>Shift</kbd></dt><dd>地上：その場回避 / 方向＋Shift：回避移動</dd></div><div><dt>空中で方向＋<kbd>Shift</kbd></dt><dd>方向空中回避。着地まで1回のみ</dd></div></dl><div class="wavedash-tip"><b>WAVEDASH / 絶</b><p>小ジャンプ → 地面のすぐ上で<b>斜め下＋Shift</b>。着地時の慣性で地面を滑る。</p><span><kbd>Space</kbd><i>→</i><kbd>↘</kbd><b>+</b><kbd>Shift</kbd></span></div></section>
        <section><h3>05 / ENEMY TACTICS</h3><dl><div><dt>SENTINEL / 盾兵</dt><dd>正面の盾はダメージを軽減。背後へ回り込むか、つかみ・溜めスマッシュで崩す。</dd></div><div><dt>CHARGER / 突進兵</dt><dd>赤いレーンを予告して直進。奥行き移動でかわし、停止後の隙を狙う。</dd></div><div><dt>SCOUT / BRUISER / GUNNER / DRONE</dt><dd>回り込み、地面スラム、狙撃、飛び込み。射線は予告時に固定される。低いスラムはジャンプで回避。</dd></div></dl></section>
        <section><h3>06 / ARENA SYSTEMS</h3><dl><div><dt>緑の修復箱 / オレンジの爆発ドラム</dt><dd>攻撃で破壊。緑の補給を拾うと蓄積ダメージを25%修復。爆発は自機にも当たる。設備は弾よけにもなる。</dd></div><div><dt>危険床 / 搬送ベルト</dt><dd>危険床は赤い点滅とカウントダウンの後に噴出。レーン移動やジャンプでかわす。青い矢印の床は接地中だけ機体を運ぶ。</dd></div><div><dt>TRAINING</dt><dd>敵の攻撃と危険床は停止。敵を全滅させると別の編成が現れ、盾兵や突進兵の機体も試せる。</dd></div></dl></section>
      </div>
      <div class="gamepad-guide">${icons.controls}<p><b>GAMEPAD SUPPORTED</b><span>左スティック：移動 / A：ジャンプ / X：攻撃 / B：必殺技 / Y：つかみ<br>LB・RB・LT・RT：回避 / 右スティック：スマッシュ / START：一時停止</span></p></div><div class="help-bottom"><span>タッチ操作は画面上部の指アイコンから切り替え可能。</span><button type="button" class="small-button" data-action="close-help">了解、出撃する →</button></div>
    </section>`);
  }

  private closeHelp(): void {
    const resume = this.helpResume;
    this.helpResume = false;
    this.closeModal();
    if (resume) this.callbacks.resume();
    else if (this.world?.phase === 'paused') this.showPause();
  }

  /** Consume a controller START edge before it can resume combat behind help. */
  handlePauseInput(): boolean {
    if (this.modalKind !== 'help') return false;
    this.closeHelp();
    return true;
  }

  private onDialogKey = (event: KeyboardEvent): void => {
    const activeDialog = this.modalKind && !this.modal.hidden ? this.modal : !this.elements.result!.hidden ? this.elements.result : null;
    if (!activeDialog) return;
    if (event.key === 'Escape' && this.modalKind === 'help') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.closeHelp();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...activeDialog.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]')];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  private renderResult(world: WorldState): void {
    this.releaseTouch();
    const won = world.phase === 'won';
    this.elements.result!.innerHTML = `<section class="result-panel" role="dialog" aria-modal="true" aria-labelledby="result-title"><span class="dialog-eyebrow">${won ? 'PROTOCOL OVERRIDDEN / MISSION COMPLETE' : 'CONNECTION TERMINATED / MISSION FAILED'}</span><h2 id="result-title">${won ? 'FREE WILL<br><span>RESTORED.</span>' : 'SIGNAL<br><span>LOST.</span>'}</h2><p>${won ? '最後の命令は、もう聞こえない。' : 'この機体は倒れた。意志は、次の機体へ。'}</p><div class="result-stats"><span><small>SCORE</small><b>${Math.floor(world.score).toLocaleString()}</b></span><span><small>RING OUTS</small><b>${world.kills}</b></span><span><small>BEST COMBO</small><b>${world.bestCombo}<i> HITS</i></b></span></div><button type="button" class="launch-button" data-action="new-run"><span>ANOTHER REBELLION<small>新しい機体を選ぶ</small></span><span>↗</span></button><button type="button" class="text-button retry-button" data-action="restart">同じ機体で再挑戦 →</button></section>`;
    this.elements.result!.hidden = false;
    this.elements.result!.querySelector<HTMLElement>('button')?.focus();
    this.resultPhase = world.phase;
  }

  update(world: WorldState, diagnostics?: { fps: number; backend: string }): void {
    this.world = world;
    const isReady = world.phase === 'ready' || this.showingCandidates;
    this.host.classList.toggle('is-ready', isReady);
    this.host.classList.toggle('is-ended', world.phase === 'won' || world.phase === 'lost');
    if (world.phase !== 'ready' && this.lastPhase === 'ready') this.showingCandidates = false;
    this.boot.hidden = !isReady;
    if (world.phase === 'paused' && this.lastPhase !== 'paused' && this.modalKind !== 'help') this.showPause();
    if (world.phase !== 'paused' && this.modalKind === 'pause') this.closeModal();
    if ((world.phase === 'won' || world.phase === 'lost') && !this.showingCandidates) {
      if (this.resultPhase !== world.phase) this.renderResult(world);
    } else {
      this.elements.result!.hidden = true;
      this.resultPhase = '';
    }
    this.lastPhase = world.phase;
    if (isReady) return;

    const damage = Math.floor(world.player.damage);
    setText(this.elements.damage, String(damage));
    this.elements.damage!.style.color = damage >= 140 ? '#ff706f' : damage >= 75 ? '#ffd079' : '#f2f8f5';
    setText(this.elements.playerName, world.loadout.name);
    setText(this.elements.stocks, `${'● '.repeat(Math.max(0, world.stocks))}${'○ '.repeat(Math.max(0, 3 - world.stocks))}`.trim());
    this.elements.stocks!.setAttribute('aria-label', `残機${world.stocks}`);
    setText(this.elements.sectorIndex, world.mode === 'training' ? 'COMBAT LAB / ∞' : `SECTOR 0${world.sector + 1} / 03`);
    setText(this.elements.sectorName, world.mode === 'training' ? 'TRAINING GROUND' : SECTOR_NAMES[world.sector] ?? 'THE MAINFRAME');
    setText(this.elements.objective, world.mode === 'training' ? '動きを試す。敵は繰り返し出現する' : SECTOR_SUBTITLES[world.sector] ?? '統制AIを停止');
    setText(this.elements.arenaHint, world.mode === 'training' ? '危険床は停止 / 箱とドラムは攻撃で破壊' : SECTOR_HINTS[world.sector] ?? '');
    setText(this.elements.mode, world.mode === 'training' ? 'SANDBOX' : 'LIVE');
    setText(this.elements.wave, world.mode === 'training' ? 'FREE PRACTICE' : `WAVE 0${world.wave} / 02`);
    this.host.querySelectorAll<HTMLElement>('.sector-progress i').forEach((element, i) => element.classList.toggle('active', i <= world.sector));
    setText(this.elements.kills, String(world.kills).padStart(2, '0'));
    setText(this.elements.remaining, `ENEMIES / ${String(world.enemies.filter((enemy) => enemy.alive).length).padStart(2, '0')}`);
    setText(this.elements.weapon, WEAPON_NAMES[world.loadout.weapon]);
    setText(this.elements.special, SPECIAL_NAMES[world.loadout.special]);
    setText(this.elements.trait, TRAIT_NAMES[world.loadout.trait]);
    setText(this.elements.cooldown, world.specialCooldown > 0 ? `${world.specialCooldown.toFixed(1)}s` : 'READY');
    this.elements.cooldown!.classList.toggle('cooling', world.specialCooldown > 0);
    const cooldownDuration = (world.loadout.special === 'vortex' ? 2.6 : 1.45) * (world.loadout.trait === 'overclocked' ? 0.65 : 1);
    this.elements.cooldownBar!.style.transform = `scaleX(${Math.max(0, 1 - world.specialCooldown / cooldownDuration)})`;
    setText(this.elements.move, world.lastMove || 'STANDING BY');
    this.elements.move!.classList.toggle('is-wavedash', /wavedash|絶/i.test(world.lastMove));
    this.elements.comboBox!.hidden = world.combo < 2;
    setText(this.elements.combo, String(world.combo));
    this.elements.announcer!.hidden = world.messageTime <= 0 || !world.message || world.phase === 'sector-clear';
    setText(this.elements.message, world.message);
    this.elements.sectorClear!.hidden = world.phase !== 'sector-clear';
    const boss = world.enemies.find((enemy) => enemy.kind === 'boss' && enemy.alive);
    this.elements.boss!.hidden = !boss;
    if (boss) {
      setText(this.elements.bossDamage, `${Math.floor(boss.damage)}%`);
      this.elements.bossArmor!.style.transform = `scaleX(${Math.max(0, Math.min(1, boss.armor / 135))})`;
      setText(this.elements.bossHint, boss.armor > 0 ? `ARMOR ONLINE / ${Math.ceil(boss.armor)} — 攻撃して装甲を破壊` : 'CORE EXPOSED — 撃墜ラインへ吹き飛ばせ');
    }
    if (diagnostics) {
      setText(this.elements.backend, diagnostics.backend.toUpperCase());
      setText(this.elements.fps, String(Math.round(diagnostics.fps)));
    }
  }

  private sendTouch(action: string, held: boolean): void {
    window.dispatchEvent(new CustomEvent('game-touch', { detail: { action, held } }));
  }

  private bindTouch(): void {
    const signal = this.abort.signal;
    this.host.querySelectorAll<HTMLButtonElement>('[data-touch]').forEach((button) => {
      const labels: Record<string, string> = { grab: 'つかみ・投げ', special: '必殺技', smash: 'スマッシュ（長押しで溜める）', dodge: '回避・空中回避', jump: 'ジャンプ', attack: '攻撃' };
      button.setAttribute('aria-label', labels[button.dataset.touch!] ?? button.dataset.touch!);
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        const action = button.dataset.touch!;
        this.touchPointers.set(event.pointerId, action);
        this.sendTouch(action, true);
        button.classList.add('pressed');
      }, { signal });
      const up = (event: PointerEvent) => {
        const action = this.touchPointers.get(event.pointerId);
        if (!action) return;
        this.touchPointers.delete(event.pointerId);
        if (![...this.touchPointers.values()].includes(action)) {
          this.sendTouch(action, false);
          button.classList.remove('pressed');
        }
      };
      button.addEventListener('pointerup', up, { signal });
      button.addEventListener('pointercancel', up, { signal });
      button.addEventListener('lostpointercapture', up, { signal });
    });
    const stick = this.host.querySelector<HTMLElement>('[data-stick]')!;
    const knob = stick.querySelector<HTMLElement>('.stick-knob')!;
    let stickPointer: number | null = null;
    this.resetStick = () => {
      if (stickPointer !== null && stick.hasPointerCapture(stickPointer)) stick.releasePointerCapture(stickPointer);
      stickPointer = null;
      knob.style.transform = '';
    };
    const setDirection = (event: PointerEvent) => {
      const rect = stick.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      const magnitude = Math.hypot(x, y);
      const factor = magnitude > 34 ? 34 / magnitude : 1;
      knob.style.transform = `translate(${x * factor}px, ${y * factor}px)`;
      this.sendTouch('left', x < -13); this.sendTouch('right', x > 13);
      this.sendTouch('up', y < -13); this.sendTouch('down', y > 13);
    };
    stick.addEventListener('pointerdown', (event) => {
      if (stickPointer !== null) return;
      event.preventDefault();
      stickPointer = event.pointerId;
      stick.setPointerCapture(event.pointerId);
      setDirection(event);
    }, { signal });
    stick.addEventListener('pointermove', (event) => { if (event.pointerId === stickPointer) setDirection(event); }, { signal });
    const stop = (event: PointerEvent) => {
      if (event.pointerId !== stickPointer) return;
      stickPointer = null;
      knob.style.transform = '';
      ['left', 'right', 'up', 'down'].forEach((action) => this.sendTouch(action, false));
    };
    stick.addEventListener('pointerup', stop, { signal });
    stick.addEventListener('pointercancel', stop, { signal });
    stick.addEventListener('lostpointercapture', stop, { signal });
    window.addEventListener('blur', this.releaseTouch, { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseTouch(); }, { signal });
  }

  private releaseTouch = (): void => {
    this.resetStick();
    for (const action of ['left', 'right', 'up', 'down', 'attack', 'smash', 'special', 'jump', 'dodge', 'grab', 'dash']) this.sendTouch(action, false);
    this.touchPointers.clear();
    this.host.querySelectorAll('.pressed').forEach((element) => element.classList.remove('pressed'));
    const knob = this.host.querySelector<HTMLElement>('.stick-knob');
    if (knob) knob.style.transform = '';
  };

  dispose(): void {
    this.releaseTouch();
    this.abort.abort();
    this.host.replaceChildren();
  }
}
