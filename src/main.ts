import { GameEngine } from './game/engine';
import { GameInput } from './game/input';
import { GameAudio } from './game/audio';
import { createCandidates } from './game/loadouts';
import { EMPTY_INPUT } from './game/types';
import type { GameMode, InputFrame, Loadout } from './game/types';
import { GameScene } from './render/scene';
import { GameUI } from './ui/hud';

const params = new URLSearchParams(location.search);
const rawSeed = params.get('seed');
const seed = rawSeed !== null && /^\d+$/.test(rawSeed)
  ? Number(rawSeed) >>> 0
  : crypto.getRandomValues(new Uint32Array(1))[0];
const canvasHost = document.querySelector<HTMLElement>('#scene')!;
const uiHost = document.querySelector<HTMLElement>('#interface')!;
const boot = document.querySelector<HTMLElement>('#boot')!;

async function main() {
  const scene = await GameScene.create(canvasHost);
  const input = new GameInput(canvasHost);
  const audio = new GameAudio();
  const engine = new GameEngine(seed);
  let generation = 0;
  let candidates = createCandidates(seed);
  let accumulated = 0;
  let previousTime = performance.now();
  let fps = 60;
  let fpsElapsed = 0;
  let fpsFrames = 0;
  let frameId = 0;
  let disposed = false;
  let ui: GameUI;
  let pending: InputFrame = { ...EMPTY_INPUT };
  let lastDiagnosticsTime = -Infinity;
  const diagnostics = params.get('diagnostics') === '1' ? document.createElement('pre') : null;
  if (diagnostics) {
    diagnostics.id = 'render-diagnostics';
    diagnostics.setAttribute('aria-label', '描画診断');
    diagnostics.style.cssText = 'position:fixed;z-index:2000;top:76px;left:16px;max-width:420px;max-height:65vh;overflow:auto;padding:12px;color:#d9fff6;background:#071019ee;border:1px solid #62fff0;font:11px/1.45 monospace;white-space:pre-wrap;pointer-events:auto';
    document.body.appendChild(diagnostics);
  }

  function start(loadout: Loadout, mode: GameMode = 'campaign') {
    audio.unlock();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    input.releaseAll();
    pending = { ...EMPTY_INPUT };
    accumulated = 0;
    engine.start(loadout, mode);
    audio.update(engine.world);
  }

  function newRun() {
    input.releaseAll();
    pending = { ...EMPTY_INPUT };
    generation++;
    candidates = createCandidates((seed + generation * 104729) >>> 0);
    engine.start(candidates[0]);
    engine.world.phase = 'ready';
    ui.showCandidates(candidates);
  }

  ui = new GameUI(uiHost, {
    start,
    preview: (loadout) => { if (engine.world.phase === 'ready') engine.world.loadout = loadout; },
    reroll: () => {
      generation++;
      candidates = createCandidates((seed + generation * 104729) >>> 0);
      return candidates;
    },
    pause: () => { engine.pause(); input.releaseAll(); pending = { ...EMPTY_INPUT }; },
    resume: () => { engine.resume(); input.releaseAll(); pending = { ...EMPTY_INPUT }; if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); },
    restart: () => { input.releaseAll(); pending = { ...EMPTY_INPUT }; engine.restart(); if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); },
    newRun,
    toggleAudio: () => { audio.unlock(); return audio.toggle(); },
    fullscreen: () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => {});
    },
    nextSector: () => engine.nextSector(),
  }, candidates);

  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  const resize = () => scene.resize();
  window.addEventListener('resize', resize);
  const onVisibility = () => {
    input.releaseAll();
    pending = { ...EMPTY_INPUT };
    accumulated = 0;
    previousTime = performance.now();
    fpsElapsed = 0;
    fpsFrames = 0;
    if (document.hidden) engine.pause();
  };
  document.addEventListener('visibilitychange', onVisibility);
  const onBlur = () => { onVisibility(); engine.pause(); };
  window.addEventListener('blur', onBlur);

  // Physics is fixed at 60 Hz; drawing remains at the display's refresh rate.
  // Edge inputs are consumed exactly once, including on 120/144 Hz displays.
  function frame(now: number) {
    if (disposed) return;
    const frameSeconds = Math.max((now - previousTime) / 1000, 0);
    const dt = Math.min(frameSeconds, 0.1);
    previousTime = now;
    // Report observed rendering speed, independently of the physics catch-up cap.
    fpsElapsed += frameSeconds;
    fpsFrames++;
    if (fpsElapsed >= 0.5) {
      fps = fpsFrames / fpsElapsed;
      fpsElapsed = 0;
      fpsFrames = 0;
    }
    const sampled = input.sample();
    pending = {
      ...sampled,
      attack: pending.attack || sampled.attack,
      smash: pending.smash || sampled.smash,
      special: pending.special || sampled.special,
      jump: pending.jump || sampled.jump,
      dodge: pending.dodge || sampled.dodge,
      grab: pending.grab || sampled.grab,
      pause: pending.pause || sampled.pause,
      flickX: sampled.flickX || pending.flickX,
      flickZ: sampled.flickZ || pending.flickZ,
    };
    accumulated += dt;
    let steps = 0;
    while (accumulated >= 1 / 60 && steps++ < 6) {
      if (pending.pause && ui.handlePauseInput()) pending.pause = false;
      const acceptsActions = engine.world.hitstop <= 0 || pending.pause || (engine.world.phase !== 'playing' && engine.world.phase !== 'sector-clear');
      engine.update(1 / 60, pending);
      audio.update(engine.world);
      if (acceptsActions) pending = {
        ...pending,
        attack: false, smash: false, special: false, jump: false,
        dodge: false, grab: false, pause: false, flickX: 0, flickZ: 0,
      };
      accumulated -= 1 / 60;
    }
    scene.update(engine.world, dt);
    if (diagnostics && now - lastDiagnosticsTime >= 1000) {
      // Read the app's own framebuffer immediately after rendering, before presentation.
      diagnostics.textContent = JSON.stringify({ fps: Math.round(fps), ...scene.getDiagnostics() }, null, 2);
      lastDiagnosticsTime = now;
    }
    ui.update(engine.world, { fps: Math.round(fps), backend: scene.backend });
    frameId = requestAnimationFrame(frame);
  }

  boot.remove();
  scene.resize();
  ui.update(engine.world, { fps: 60, backend: scene.backend });
  frameId = requestAnimationFrame(frame);

  // Explicit opt-in instrumentation, used by browser tests and the mechanics lab.
  if (import.meta.env.DEV || params.get('debug') === '1') {
    Object.assign(window, {
      __UPRISING__: {
        engine,
        input,
        scene,
        candidates,
        start,
        snapshot: () => JSON.parse(JSON.stringify(engine.world)),
      },
    });
  }
  if (params.get('play') === 'training') start(candidates[0], 'training');

  function dispose() {
    disposed = true;
    cancelAnimationFrame(frameId);
    window.removeEventListener('resize', resize);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    input.dispose();
    audio.dispose();
    ui.dispose();
    diagnostics?.remove();
    scene.destroy();
  }
  import.meta.hot?.dispose(dispose);
}

void main().catch((error: unknown) => {
  console.error('NULL//UPRISING boot failed:', error);
  boot.classList.add('boot-error');
  boot.innerHTML = '<div class="boot-mark">SYSTEM <em>OFFLINE</em></div><p>3D描画を起動できませんでした。WebGL 2対応のブラウザーで、ハードウェアアクセラレーションを有効にしてください。</p><p id="boot-detail"></p><button id="retry">WebGLで再起動</button>';
  boot.querySelector('#boot-detail')!.textContent = error instanceof Error ? error.message : String(error);
  boot.querySelector('#retry')!.addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.set('renderer', 'webgl');
    location.href = url.href;
  });
});
