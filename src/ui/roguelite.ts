import { effectiveNode, EVENTS, eventPreview } from '../game/roguelite/events';
import type { GameEngine } from '../game/engine';
import { availableNodes } from '../game/roguelite/map';
import { eliteModifiers, ELITE_MODIFIERS, RELICS } from '../game/roguelite/economy';
import type { UpgradeId } from '../game/upgrades';
import { STAGES } from '../game/campaign';

export class RogueliteUI {
  private panel = document.createElement('section');
  private signature = '';
  private inspect = false;
  private abort = new AbortController();
  constructor(private engine: GameEngine, private release: () => void) {
    this.panel.className = 'rogue-panel'; this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog'); this.panel.setAttribute('aria-label', 'ROGUELITE ルート');
    document.body.append(this.panel);
    this.panel.addEventListener('click', e => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button || button.disabled) return;
      const g = this.engine;
      if (button.dataset.event) g.chooseEvent(button.dataset.event);
      if (button.dataset.buy) g.buyStock(button.dataset.buy);
      if (button.dataset.upgrade) g.claimUpgrade(button.dataset.upgrade as UpgradeId);
      if (button.dataset.benefit) g.claimNodeBenefit(button.dataset.benefit as 'treasure' | 'repair' | 'upgrade');
      if (button.dataset.rogue === 'skip') g.skipUpgrade();
      if (button.dataset.node) g.selectNode(button.dataset.node);
      if (button.dataset.rogue === 'travel') { this.release(); g.travelNode(); }
      if (button.dataset.rogue === 'complete') g.completeNode();
      if (button.dataset.rogue === 'close') { this.inspect = false; g.resume(); this.release(); }
      this.signature = ''; this.update();
    }, { signal: this.abort.signal });
    window.addEventListener('click', e => {
      if (!this.engine.run || !(e.target as HTMLElement).closest('[data-action=map]')) return;
      e.preventDefault(); e.stopImmediatePropagation(); this.inspect = true; this.engine.pause(); this.release(); this.signature = ''; this.update();
    }, { capture: true, signal: this.abort.signal });
    window.addEventListener('keydown', e => {
      if (this.panel.hidden) return;
      // Keep navigation and held keys out of the simulation and classic dialogs.
      e.stopImmediatePropagation();
      if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Tab'].includes(e.key)) {
        e.preventDefault();
        const buttons = [...this.panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const direction = e.shiftKey || ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1;
        buttons[(index + direction + buttons.length) % buttons.length]?.focus();
      }
      if (e.key === 'Escape' && this.inspect) { this.inspect = false; this.engine.resume(); this.release(); this.update(); }
    }, { capture: true, signal: this.abort.signal });
  }
  update(): void {
    const g = this.engine, r = g.run;
    const visible = !!r && r.phase !== 'finished' && g.world.phase !== 'lost' && (r.phase !== 'combat' || this.inspect);
    this.panel.hidden = !visible;
    if (!visible || !r) return;
    const signature = JSON.stringify(r);
    if (signature === this.signature) return;
    this.signature = signature;
    const available = availableNodes(r), nodes = r.map.filter(n => n.act === r.act);
    const selected = nodes.find(n => n.id === r.selected), rawCurrent = nodes.find(n => n.id === r.current), current = rawCurrent ? effectiveNode(r,rawCurrent) : undefined;
    const event = r.current ? r.events.resolved[r.current] : undefined;
    const definition = EVENTS.find(e=>e.id===event?.eventId);
    const x = (column: number, row: number) => 50 + column * 90 + (4 - nodes.filter(n => n.row === row).length) * 45;
    this.panel.innerHTML = `<div class="rogue-heading"><h2>ACT ${r.act} / 3 — ROUTE</h2><span>SCRAP ${r.economy.scrap} · SEED ${r.seed}</span></div>
      <p>● current · ✓ visited · cyan available · dim locked<br>Battle / Elite / Shop / ? / Treasure / Rest / Boss</p>
      <div class="rogue-layout"><div class="route-map"><svg viewBox="0 0 380 580" aria-label="前進ルート接続線">${nodes.flatMap(n => n.next.map(id => { const to = nodes.find(v => v.id === id)!; return `<line x1="${x(n.column,n.row)}" y1="${30+n.row*72}" x2="${x(to.column,to.row)}" y2="${30+to.row*72}"/>`; })).join('')}</svg>
      ${nodes.map(n => `<button data-node="${n.id}" style="left:${x(n.column,n.row)/3.8}%;top:${(30+n.row*72)/5.8}%" class="route-node ${available.includes(n.id) ? 'available' : ''} ${r.current===n.id?'current':''} ${r.visited.includes(n.id)?'visited':''}" ${!available.includes(n.id)?'disabled':''} aria-pressed="${r.selected===n.id}" title="${n.kind} / ${STAGES[n.theme]!.name}">${r.completed.includes(n.id)?'✓ ':r.current===n.id?'● ':''}${n.kind === 'unknown' ? '?' : n.kind.toUpperCase()}</button>`).join('')}</div>
      <div class="rogue-detail"><p>STOCK ${g.world.stocks} / DAMAGE ${Math.floor(g.world.player.damage)}%<br>${g.world.loadout.weapon.toUpperCase()} / ${g.world.upgrades.length} upgrades</p><p>${r.economy.relics.map(id => {const relic=RELICS.find(v=>v.id===id)!;return `${relic.name} — ${relic.description}`;}).join("<br>")}</p>
      ${r.phase==='map'?`<h3>${selected?.kind.toUpperCase() ?? 'SELECT A NODE'}</h3><p>${selected?STAGES[selected.theme]!.name:'ノードを選び、詳細を確認して出発。'}</p><p>${selected ? eliteModifiers(r, selected).map(m=>`<p>${ELITE_MODIFIERS[m]}</p>`).join('') : ''}${selected?.kind==='boss' ? r.act===3?'THE ARCHITECT — 最終決戦':'THE WARDEN — Act守護者':''}</p><button data-rogue="travel" ${selected?'':'disabled'}>TRAVEL / 出発</button>`:r.phase==='combat'?'<p>戦闘中。ルートの変更はできません。</p>':`<h3>${current?.kind.toUpperCase()}</h3><p>${r.phase==='reward'?'遭遇クリア。強化を選択、またはスキップ。':'安全な中継地点。'}</p>${r.phase==='reward' ? (g.world.upgradeClaimed ? '<p>報酬確定 / 上限時はスキップ。</p>' : g.world.upgradeChoices.map(u=>`<button data-upgrade="${u.id}">${u.name} — ${u.description}</button>`).join('')+'<button data-rogue="skip">SKIP UPGRADE / 強化を辞退</button>') : current?.kind==='event' && event ? `<h3>${definition?.title}</h3><p>${definition?.text}</p>${event.choice?`<p role="status">${event.result}<br>SCRAP ${event.scrapBefore} → ${event.scrapAfter}<br>Damage ${Math.round(event.before!.damage)} → ${Math.round(event.after!.damage)} / Stocks ${event.before!.stocks} → ${event.after!.stocks}</p>`:definition!.options.map(o=>`<button data-event="${o.id}" ${eventPreview(r,event,o.id)?'':'disabled'}>${o.label}</button>`).join('')}` : current?.kind==='shop' ? r.economy.shops[current.id]!.map(item=>`<button data-buy="${item.id}" ${item.sold||r.economy.scrap<item.price?'disabled':''}>${item.name} — ${item.sold?'SOLD OUT':item.price+' SCRAP'}</button>`).join('') : current?.kind==='treasure' ? `<button data-benefit="treasure" ${r.economy.nodeClaims.includes(current.id)?'disabled':''}>OPEN / レリック +20 SCRAP (全取得時 +30 SCRAP)</button>` : current?.kind==='rest' ? `<button data-benefit="repair" ${r.economy.nodeClaims.includes(current.id)||g.world.player.damage<=0?'disabled':''}>REPAIR −50%</button><button data-benefit="upgrade" ${r.economy.nodeClaims.includes(current.id)?'disabled':''}>UPGRADE / 上限時 +20 SCRAP</button>` : ''}<button data-rogue="complete" ${r.phase==='reward'&&!g.world.upgradeClaimed||current?.kind==='event'&&!event?.choice?'disabled':''}>CONTINUE / マップへ</button>`}
      ${this.inspect?'<button data-rogue="close">CLOSE / 戻る</button>':''}</div></div>`;
    if (!this.panel.contains(document.activeElement)) this.panel.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }
  dispose(): void { this.abort.abort(); this.panel.remove(); }
}
