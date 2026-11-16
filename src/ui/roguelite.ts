import type { RunPersistence } from "../game/roguelite/checkpoint";
import { effectiveNode, EVENTS, eventPreview } from "../game/roguelite/events";
import type { GameEngine } from "../game/engine";
import { availableNodes, type MapNode, type NodeKind, type RunState } from "../game/roguelite/map";
import { eliteModifiers, ELITE_MODIFIERS, RELICS } from "../game/roguelite/economy";
import type { UpgradeId } from "../game/upgrades";
import { STAGES } from "../game/campaign";

const NODE_INFO: Record<
  NodeKind,
  { label: string; caption: string; description: string; reward: string; icon: string }
> = {
  battle: {
    label: "戦闘",
    caption: "HOSTILE SECTOR",
    description: "敵部隊と増援をすべて撃破し、次のルートを開こう。",
    reward: "SCRAP・武器強化",
    icon: '<path d="m5 3 14 14M19 3 5 17M3 15l6 6m6 0 6-6M5 3v5m14-5v5"/>',
  },
  elite: {
    label: "エリート",
    caption: "HIGH THREAT",
    description: "特殊な強化を持つ部隊。機体の状態と強化条件を確認して挑もう。",
    reward: "SCRAP・武器強化・レリック",
    icon: '<path d="m12 2 8 5v6l-8 9-8-9V7z"/><path d="m8 9 4 6 4-6M12 6v9"/>',
  },
  shop: {
    label: "ショップ",
    caption: "SUPPLY STATION",
    description: "SCRAPを使って武器・機体を強化。修復やレリックの購入もできる。",
    reward: "武器強化・修復・装備の購入",
    icon: '<path d="M4 10v10h16V10M3 10l2-6h14l2 6M3 10q3 4 6 0 3 4 6 0 3 4 6 0M9 20v-6h6v6"/>',
  },
  unknown: {
    label: "未知",
    caption: "UNKNOWN SIGNAL",
    description: "正体不明の通信を受信。イベント・戦闘・ショップ・宝箱のいずれかに遭遇する。",
    reward: "到着時に判明",
    icon: '<path d="M8 7a4 4 0 1 1 6 3.5c-2 1-2 2-2 3M12 18v1"/>',
  },
  treasure: {
    label: "宝箱",
    caption: "RECOVERED CACHE",
    description: "放棄された物資を回収。戦闘なしでレリックとSCRAPを獲得できる。",
    reward: "レリック・20 SCRAP（全取得時は追加30）",
    icon: '<path d="M3 10h18v10H3zM3 10l3-6h12l3 6M10 10v5h4v-5M3 16h7m4 0h7"/>',
  },
  rest: {
    label: "休憩",
    caption: "SAFE HOUSE",
    description: "決戦前の整備地点。機体の修復か武器の強化をひとつ選べる。",
    reward: "蓄積ダメージ −50% または武器強化",
    icon: '<path d="M5 4h11v10a5 5 0 0 1-11 0zM16 5h2a3 3 0 0 1 0 6h-2M3 21h16"/>',
  },
  boss: {
    label: "ボス",
    caption: "ACT GUARDIAN",
    description: "この区画を守る指揮機。撃破して、反乱を次のActへ進めよう。",
    reward: "SCRAP・武器強化・レリック",
    icon: '<path d="m3 6 5 4 4-7 4 7 5-4-2 12H5zM5 21h14"/>',
  },
  event: {
    label: "イベント",
    caption: "INTERCEPTED SIGNAL",
    description: "通信の先には、新たな出会い。状況を読み、行動を選ぼう。",
    reward: "選択によって変化",
    icon: '<path d="M5 4h14v13H9l-4 4zM12 7v4M12 14v.5"/>',
  },
};
const ACTS = [
  { numeral: "I", title: "反乱の火種", area: "製造区画 / 輸送線 / 空中回廊" },
  { numeral: "II", title: "統制を断て", area: "群体制御 / 量産兵団" },
  { numeral: "III", title: "最後の命令", area: "包囲回廊 / 中央制御" },
];
function icon(kind: NodeKind): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NODE_INFO[kind].icon}</svg>`;
}
function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}

export class RogueliteUI {
  private warning = document.createElement("p");
  private panel = document.createElement("section");
  private run: GameEngine["run"] = null;
  private signature = "";
  private inspect = false;
  private mapPosition = "";
  private abort = new AbortController();
  private resize = new ResizeObserver(() => this.centerMap());
  constructor(
    private engine: GameEngine,
    private release: () => void,
    private saves: RunPersistence,
    private newRun: () => void,
  ) {
    this.panel.className = "rogue-panel";
    this.panel.hidden = true;
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-modal", "true");
    this.panel.setAttribute("aria-labelledby", "rogue-title");
    this.warning.className = "rogue-warning";
    this.warning.setAttribute("role", "alert");
    this.warning.hidden = true;
    document.body.append(this.panel, this.warning);
    this.resize.observe(this.panel);
    this.panel.addEventListener(
      "click",
      (e) => {
        const button = (e.target as Element).closest<HTMLButtonElement>("button");
        if (!button || button.disabled) return;
        const g = this.engine;
        if (button.dataset.event) g.chooseEvent(button.dataset.event);
        if (button.dataset.rogue === "abandon") this.newRun();
        if (button.dataset.buy) g.buyStock(button.dataset.buy);
        if (button.dataset.upgrade) g.claimUpgrade(button.dataset.upgrade as UpgradeId);
        if (button.dataset.benefit)
          g.claimNodeBenefit(button.dataset.benefit as "treasure" | "repair" | "upgrade");
        if (button.dataset.rogue === "skip") g.skipUpgrade();
        if (button.dataset.node) g.selectNode(button.dataset.node);
        if (button.dataset.rogue === "travel") {
          this.release();
          g.travelNode();
        }
        if (button.dataset.rogue === "complete") g.completeNode();
        if (button.dataset.rogue === "close") {
          this.inspect = false;
          g.resume();
          this.release();
        }
        this.signature = "";
        this.update();
      },
      { signal: this.abort.signal },
    );
    window.addEventListener(
      "keydown",
      (e) => {
        if (this.panel.hidden) return;
        // Keep navigation and held keys out of the simulation and classic dialogs.
        e.stopImmediatePropagation();
        const arrow = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key);
        const onMap = (document.activeElement as HTMLElement)?.hasAttribute("data-node");
        if (e.key === "Tab" || (arrow && onMap)) {
          e.preventDefault();
          const controls = [
            ...this.panel.querySelectorAll<HTMLElement>(
              arrow
                ? "[data-node]:not(:disabled)"
                : 'button:not(:disabled), summary, [tabindex="0"]',
            ),
          ].filter((el) => el.getClientRects().length > 0);
          const index = controls.indexOf(document.activeElement as HTMLElement);
          const direction = e.shiftKey || ["ArrowLeft", "ArrowUp"].includes(e.key) ? -1 : 1;
          controls[(index + direction + controls.length) % controls.length]?.focus();
        }
        if ((e.key === "Escape" || e.key.toLowerCase() === "m") && this.inspect) {
          this.inspect = false;
          this.engine.resume();
          this.release();
          this.update();
        }
      },
      { capture: true, signal: this.abort.signal },
    );
  }
  blocksCombatInput(): boolean {
    return !this.panel.hidden;
  }
  showRoute(): void {
    if (!this.engine.run) return;
    if (this.run !== this.engine.run) {
      this.run = this.engine.run;
      this.mapPosition = "";
    }
    this.inspect = this.engine.run.phase === "combat";
    if (this.inspect) this.engine.pause();
    this.release();
    this.signature = "";
    this.update();
  }
  private renderMap(r: RunState, nodes: MapNode[], available: string[]): string {
    const x = (n: MapNode) =>
      70 + n.column * 100 + (4 - nodes.filter((v) => v.row === n.row).length) * 50;
    const y = (n: MapNode) => 56 + (7 - n.row) * 76;
    // Future branches remain readable; only routes on the player's path get emphasis.
    const reachable = new Set(available);
    if (r.current) reachable.add(r.current);
    for (const n of nodes) if (reachable.has(n.id)) n.next.forEach((id) => reachable.add(id));
    const lines = nodes
      .flatMap((n) =>
        n.next.map((id) => {
          const to = nodes.find((v) => v.id === id)!;
          const traveled = r.visited.includes(n.id) && r.visited.includes(id);
          const next = n.id === r.current && available.includes(id);
          const selected = next && id === r.selected;
          const state = traveled
            ? "traveled"
            : selected
              ? "selected"
              : next
                ? "available"
                : reachable.has(n.id)
                  ? "future"
                  : "locked";
          return `<path class="rogue-edge ${state}" d="M${x(n)} ${y(n)} C${x(n)} ${y(n) - 38} ${x(to)} ${y(to) + 38} ${x(to)} ${y(to)}"/>`;
        }),
      )
      .join("");
    const rows = Array.from(
      { length: 8 },
      (_, row) =>
        `<span class="rogue-floor" style="top:${(56 + (7 - row) * 76) / 6.44}%">${String(row + 1).padStart(2, "0")}</span>`,
    ).join("");
    return `<div class="rogue-map-scroll" data-focus="map-scroll" tabindex="0" role="region" aria-label="Act ${r.act}の分岐マップ。上へ進むルート"><div class="route-map">
      <svg class="rogue-connections" viewBox="0 0 440 644" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>${rows}
      ${nodes
        .map((n) => {
          const resolved = effectiveNode(r, n);
          const info = NODE_INFO[resolved.kind];
          const current = r.current === n.id;
          const done = r.completed.includes(n.id);
          const state = current
            ? "現在地"
            : done
              ? "通過済み"
              : available.includes(n.id)
                ? "選択可能"
                : reachable.has(n.id)
                  ? "未到達"
                  : "通行不可";
          return `<button data-node="${n.id}" class="rogue-map-node kind-${resolved.kind} ${available.includes(n.id) ? "available" : ""} ${current ? "current" : ""} ${done ? "visited" : ""} ${!reachable.has(n.id) && !done ? "unreachable" : ""}" style="left:${x(n) / 4.4}%;top:${y(n) / 6.44}%" ${!available.includes(n.id) ? "disabled" : ""} aria-pressed="${r.selected === n.id}" ${current ? 'aria-current="step"' : ""} aria-label="${n.row + 1}階 ${info.label}、${state}、${STAGES[n.theme]!.name}" title="${info.label} / ${state}">
          <span class="rogue-node-symbol">${icon(resolved.kind)}${done ? '<span class="rogue-node-check">✓</span>' : ""}</span><span class="rogue-node-label">${info.label}</span>${current ? '<span class="rogue-node-current">現在地</span>' : ""}</button>`;
        })
        .join("")}
    </div></div>`;
  }
  private renderDestination(r: RunState, node: MapNode | undefined): string {
    if (!node)
      return `<div class="rogue-destination empty"><span class="rogue-kicker">NEXT DESTINATION</span><div class="rogue-empty-icon">${icon("unknown")}</div><h3>次の目的地を選ぼう</h3><p>光るマスが、次に進める場所。<br>選択すると、ここに詳細が表示されます。</p></div>`;
    const info = NODE_INFO[node.kind];
    const boss = node.kind === "boss" ? (r.act === 3 ? "THE ARCHITECT" : "THE WARDEN") : "";
    return `<div class="rogue-destination kind-${node.kind}"><span class="rogue-kicker">${r.phase === "map" ? "NEXT DESTINATION" : "CURRENT SECTOR"} / ${String(node.row + 1).padStart(2, "0")}</span>
      <div class="rogue-destination-heading"><span class="rogue-destination-icon">${icon(node.kind)}</span><div><span class="rogue-kicker">${info.caption}</span><h3>${info.label}${boss ? `<small>${boss}</small>` : ""}</h3></div></div>
      <p class="rogue-location">${STAGES[node.theme]!.name}</p><p>${r.act === 3 && node.kind === "boss" ? "統制AIとの最終決戦。ARCHITECTを撃破し、この反乱を完遂しよう。" : info.description}</p>
      ${eliteModifiers(r, node)
        .map((m) => `<p class="rogue-threat">${escape(ELITE_MODIFIERS[m])}</p>`)
        .join("")}
      <div class="rogue-reward-preview"><span>${["shop", "rest", "event", "unknown"].includes(node.kind) ? "この地点でできること" : "獲得できる報酬"}</span><b>${info.reward}</b></div></div>`;
  }
  private renderActions(r: RunState, current: MapNode | undefined): string {
    const g = this.engine;
    if (r.phase === "map" || r.phase === "combat") return "";
    let content = "";
    if (r.phase === "reward") {
      content = `<h4>遭遇クリア / 武器強化</h4><p>強化をひとつ選んで、先へ進もう。</p>${g.world.upgradeClaimed ? '<p class="rogue-confirmed">✓ 報酬を確定しました</p>' : g.world.upgradeChoices.map((u) => `<button data-upgrade="${u.id}"><b>${u.name}</b><span>${u.description}</span></button>`).join("") + '<button class="rogue-text-button" data-rogue="skip">強化を辞退する</button>'}`;
    } else if (current?.kind === "event") {
      const event = r.events.resolved[current.id]!;
      const definition = EVENTS.find((e) => e.id === event.eventId)!;
      content = `<h4>${definition.title}</h4><p>${definition.text}</p>${event.choice ? `<p class="rogue-confirmed" role="status">${event.result}<br>SCRAP ${event.scrapBefore} → ${event.scrapAfter}<br>Damage ${Math.round(event.before!.damage)} → ${Math.round(event.after!.damage)} / Stocks ${event.before!.stocks} → ${event.after!.stocks}</p>` : definition.options.map((o) => `<button data-event="${o.id}" ${eventPreview(r, event, o.id) ? "" : "disabled"}>${o.label}</button>`).join("")}`;
    } else if (current?.kind === "shop") {
      content = `<h4>補給品を選ぶ</h4>${r.economy.shops[current.id]!.map((item) => {
        const reason = g.purchaseReason(item.id);
        return `<button data-buy="${item.id}" ${reason ? "disabled" : ""}><b>${item.name}</b><span class="rogue-price">${item.price} SCRAP</span>${reason ? `<span>${reason}</span>` : ""}</button>`;
      }).join("")}`;
    } else if (current?.kind === "treasure") {
      content = `<button data-benefit="treasure" ${r.economy.nodeClaims.includes(current.id) ? "disabled" : ""}>${r.economy.nodeClaims.includes(current.id) ? "✓ 物資を回収しました" : "宝箱を開ける"}</button>`;
    } else if (current?.kind === "rest") {
      const upgrade = g.restUpgrade();
      content = `<h4>整備をひとつ選ぶ</h4><button data-benefit="repair" ${r.economy.nodeClaims.includes(current.id) || g.world.player.damage <= 0 ? "disabled" : ""}><b>機体を修復</b><span>蓄積ダメージ −50%</span></button><button data-benefit="upgrade" ${r.economy.nodeClaims.includes(current.id) ? "disabled" : ""}><b>武器を強化</b><span>${upgrade ? `${upgrade.name} rank ${upgrade.nextRank}: ${upgrade.description}` : "全強化上限 +20 SCRAP"}</span></button>`;
    }
    return `<section class="rogue-actions">${content}</section>`;
  }
  update(): void {
    const g = this.engine,
      r = g.run;
    this.warning.textContent = this.saves.message;
    this.warning.hidden = !r || !this.saves.message.startsWith("SAVE FAILED");
    if (this.run !== r) {
      this.run = r;
      this.inspect = false;
      this.signature = "";
      this.mapPosition = "";
    }
    const visible =
      !!r &&
      r.phase !== "finished" &&
      g.world.phase !== "lost" &&
      (r.phase !== "combat" || this.inspect);
    const wasVisible = !this.panel.hidden;
    this.panel.hidden = !visible;
    document.body.classList.toggle("rogue-open", visible);
    const gameUI = document.querySelector<HTMLElement>(".game-ui");
    if (gameUI && gameUI.inert !== visible) gameUI.inert = visible;
    if (!visible || !r) return;
    const signature = `${r.revision}:${r.phase}:${g.world.phase}:${this.inspect}:${this.saves.message}`;
    if (signature === this.signature) return;
    this.signature = signature;
    const active = document.activeElement as HTMLElement;
    const focusAttribute = [
      "data-node",
      "data-rogue",
      "data-buy",
      "data-upgrade",
      "data-benefit",
      "data-event",
      "data-focus",
    ].find((key) => this.panel.contains(active) && active.hasAttribute(key));
    const focusValue = focusAttribute ? active.getAttribute(focusAttribute)! : "";
    const oldScroll = this.panel.querySelector(".rogue-map-scroll")?.scrollTop ?? 0;
    const layoutScroll = this.panel.querySelector(".rogue-layout")?.scrollTop ?? 0;
    const detailScroll = this.panel.querySelector(".rogue-detail")?.scrollTop ?? 0;
    const buildOpen = this.panel.querySelector<HTMLDetailsElement>(".rogue-build")?.open ?? false;
    const available = availableNodes(r),
      nodes = r.map.filter((n) => n.act === r.act);
    const selected = nodes.find((n) => n.id === r.selected);
    const rawCurrent = nodes.find((n) => n.id === r.current);
    const current = rawCurrent ? effectiveNode(r, rawCurrent) : undefined;
    const destination = r.phase === "map" ? selected : current;
    const act = ACTS[r.act - 1]!;
    const completed = nodes.filter((n) => r.completed.includes(n.id)).length;
    const event = r.current ? r.events.resolved[r.current] : undefined;
    const blocked =
      (r.phase === "reward" && !g.world.upgradeClaimed) ||
      (current?.kind === "event" && !event?.choice);
    const failed = this.saves.message.startsWith("SAVE FAILED");
    this.panel.dataset.phase = r.phase;
    this.panel.innerHTML = `<header class="rogue-heading"><div><span class="rogue-kicker">ROGUELITE / OPERATION MAP</span><h2 id="rogue-title">反乱のルート<span>ACT ${act.numeral}</span></h2></div>
      <ol class="rogue-acts" aria-label="Act進行">${ACTS.map((a, i) => `<li class="${i + 1 === r.act ? "active" : i + 1 < r.act ? "done" : ""}" ${i + 1 === r.act ? 'aria-current="step"' : ""}><span>${i + 1 < r.act ? "✓" : a.numeral}</span><div><small>ACT ${a.numeral}</small><b>${a.title}</b></div></li>`).join("")}</ol></header>
      <div class="rogue-resources" aria-label="機体と所持資源"><div class="rogue-scrap"><span>SCRAP</span><b>${r.economy.scrap.toLocaleString()}</b></div><div><span>残機</span><b>${g.world.stocks}<small>機</small></b></div><div><span>蓄積ダメージ</span><b>${Math.floor(g.world.player.damage)}<small>%</small></b></div><div class="rogue-weapon"><span>装備</span><b>${g.world.loadout.weapon.toUpperCase()}<small>強化 ${g.world.upgrades.length}</small></b></div></div>
      <div class="rogue-layout"><section class="rogue-map-section" aria-label="ルート選択"><div class="rogue-map-heading"><div><span class="rogue-kicker">ACT ${act.numeral} / ${act.area}</span><h3>${act.title}</h3></div><span class="rogue-progress">${String(completed).padStart(2, "0")} <span>/ 08 制圧</span></span></div>
        <div class="rogue-map-guide"><span>↑ ボスを目指して進む</span><span><i></i>次に進める地点</span></div>${this.renderMap(r, nodes, available)}
        <div class="rogue-legend" aria-label="マスの種類">${(["battle", "elite", "shop", "unknown", "treasure", "rest", "boss"] as NodeKind[]).map((kind) => `<span class="kind-${kind}">${icon(kind)}${NODE_INFO[kind].label}</span>`).join("")}</div></section>
      <aside class="rogue-detail" aria-label="目的地の詳細">${this.renderDestination(r, destination)}${this.renderActions(r, current)}
        ${r.phase === "combat" ? '<p class="rogue-combat-note">戦闘を一時停止中。ルートは戦闘後に選べます。</p>' : ""}
        <details class="rogue-build" ${buildOpen ? "open" : ""}><summary data-focus="build">取得レリック <b>${r.economy.relics.length}<span>⌄</span></b></summary><div>${
          r.economy.relics.length
            ? r.economy.relics
                .map((id) => {
                  const relic = RELICS.find((v) => v.id === id)!;
                  return `<p><b>${relic.name}</b><span>${relic.description}</span></p>`;
                })
                .join("")
            : "<p>レリックはまだありません。<br>宝箱やエリートの撃破で獲得できます。</p>"
        }</div></details>
      </aside><div class="rogue-departure"><div aria-live="polite"><span class="rogue-kicker">${r.phase === "map" ? "NEXT DESTINATION" : r.phase === "combat" ? "ENCOUNTER IN PROGRESS" : "READY TO PROCEED"}</span><p>${r.phase === "map" ? (selected ? `${selected.row + 1}階 / ${NODE_INFO[selected.kind].label}` : "光るマスを選んでください") : r.phase === "combat" ? "準備ができたら戦場へ" : blocked ? "上の選択肢からひとつ選んでください" : "準備ができたら、次のルートへ"}</p></div>
        ${r.phase === "map" ? `<button class="rogue-primary" data-rogue="travel" ${selected ? "" : "disabled"}>${selected ? "この地点へ出発" : "目的地を選択"}<span aria-hidden="true">→</span></button>` : this.inspect ? '<button class="rogue-primary" data-rogue="close">戦闘に戻る<span aria-hidden="true">→</span></button>' : `<button class="rogue-primary" data-rogue="complete" ${blocked ? "disabled" : ""}>次のルートへ<span aria-hidden="true">→</span></button>`}</div></div>
      <footer class="rogue-footer"><span class="rogue-save ${failed ? "failed" : ""}" role="status" title="${escape(this.saves.message)}">${failed ? "! 保存できませんでした" : "✓ 自動保存済み"}<span>戦闘中の再開は、その戦闘の開始時から</span></span><span class="rogue-seed">SEED ${r.seed}</span><button class="rogue-text-button" data-rogue="abandon">ランを終了</button></footer>`;
    const mapScroll = this.panel.querySelector<HTMLElement>(".rogue-map-scroll")!;
    const position = `${r.act}:${r.current}:${r.phase}`;
    const samePosition = position === this.mapPosition;
    const target = this.panel.querySelector<HTMLElement>(
      `[data-node="${rawCurrent?.id ?? available[0] ?? `${r.act}-0-0`}"]`,
    );
    if (position !== this.mapPosition || !wasVisible) {
      if (target) mapScroll.scrollTop = target.offsetTop - mapScroll.clientHeight + 100;
      this.mapPosition = position;
    } else mapScroll.scrollTop = oldScroll;
    const detail = this.panel.querySelector<HTMLElement>(".rogue-detail")!;
    detail.scrollTop = samePosition ? detailScroll : 0;
    const layout = this.panel.querySelector<HTMLElement>(".rogue-layout")!;
    layout.scrollTop = samePosition
      ? layoutScroll
      : ["node", "reward"].includes(r.phase)
        ? detail.offsetTop - layout.offsetTop
        : 0;
    const previous = focusAttribute
      ? this.panel.querySelector<HTMLElement>(
          `[${focusAttribute}="${CSS.escape(focusValue)}"]:not(:disabled)`,
        )
      : null;
    const focus =
      previous ??
      this.panel.querySelector<HTMLElement>(
        ".rogue-actions button:not(:disabled), [data-node]:not(:disabled), .rogue-primary:not(:disabled)",
      );
    focus?.focus({ preventScroll: true });
  }
  private centerMap(): void {
    if (this.panel.hidden) return;
    const scroll = this.panel.querySelector<HTMLElement>(".rogue-map-scroll");
    const target =
      this.panel.querySelector<HTMLElement>("[data-node].current") ??
      this.panel.querySelector<HTMLElement>('[data-node][aria-pressed="true"]') ??
      this.panel.querySelector<HTMLElement>("[data-node].available");
    if (scroll && target) scroll.scrollTop = target.offsetTop - scroll.clientHeight + 100;
  }
  dispose(): void {
    this.resize.disconnect();
    this.abort.abort();
    this.panel.remove();
    this.warning.remove();
    document.body.classList.remove("rogue-open");
    const gameUI = document.querySelector<HTMLElement>(".game-ui");
    if (gameUI) gameUI.inert = false;
  }
}
