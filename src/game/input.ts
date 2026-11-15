import { EMPTY_INPUT, type InputFrame } from './types';

type Action = 'left' | 'right' | 'up' | 'down' | 'attack' | 'smash' | 'special' | 'jump' | 'dodge' | 'grab' | 'dash' | 'pause';

const KEY_ACTIONS: Record<string, Action> = {
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyJ: 'attack', KeyK: 'smash', KeyL: 'special', Space: 'jump',
  ShiftLeft: 'dodge', ShiftRight: 'dodge', KeyI: 'grab', KeyE: 'grab',
  ControlLeft: 'dash', ControlRight: 'dash', Escape: 'pause',
};

const clamp = (n: number) => Math.max(-1, Math.min(1, n));
const deadzone = (n: number) => Math.abs(n) < 0.19 ? 0 : Math.sign(n) * (Math.abs(n) - 0.19) / 0.81;

/** Keyboard, standard gamepads, and multi-touch all produce the same input frame. */
export class GameInput {
  private keys = new Set<string>();
  private touch = new Set<Action>();
  private pressed = new Set<Action>();
  private previousPad = new Set<Action>();
  private previousPadX = 0;
  private previousPadZ = 0;
  private directionTimes = new Map<Action, number>();
  private flickX = 0;
  private flickZ = 0;
  private flickXUntil = 0;
  private flickZUntil = 0;
  private dashDirection = 0;
  private abort = new AbortController();

  constructor(_target?: HTMLElement) {
    const signal = this.abort.signal;
    window.addEventListener('keydown', this.onKeyDown, { signal });
    window.addEventListener('keyup', this.onKeyUp, { signal });
    window.addEventListener('blur', this.releaseAll, { signal });
    document.addEventListener('visibilitychange', this.onVisibility, { signal });
    window.addEventListener('gamepaddisconnected', this.onPadDisconnect, { signal });
    window.addEventListener('game-touch', this.onTouch as EventListener, { signal });
  }

  private isEditable(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]');
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const action = KEY_ACTIONS[event.code];
    if (!action || this.isEditable(event.target) || event.metaKey || event.altKey) return;
    // Space must still activate focused menu buttons with normal keyboard semantics.
    if (event.code === 'Space' && event.target instanceof HTMLElement && event.target.closest('button')) return;
    event.preventDefault();
    if (event.repeat || this.keys.has(event.code)) return;
    const alreadyHeld = this.held(action);
    this.keys.add(event.code);
    if (!alreadyHeld) this.press(action);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (KEY_ACTIONS[event.code]) {
      this.keys.delete(event.code);
      if (!this.isEditable(event.target)) event.preventDefault();
    }
  };

  private onVisibility = (): void => {
    if (document.hidden) this.releaseAll();
  };

  private onPadDisconnect = (): void => {
    this.previousPad.clear();
    this.previousPadX = this.previousPadZ = 0;
    this.dashDirection = 0;
  };

  private onTouch = (event: CustomEvent<{ action: string; held: boolean }>): void => {
    this.touchSet(event.detail.action, event.detail.held);
  };

  touchSet(action: string, held: boolean): void {
    if (!['left', 'right', 'up', 'down', 'attack', 'smash', 'special', 'jump', 'dodge', 'grab', 'dash', 'pause'].includes(action)) return;
    const typed = action as Action;
    if (held) {
      if (!this.touch.has(typed)) this.press(typed);
      this.touch.add(typed);
    } else {
      this.touch.delete(typed);
    }
  }

  private held(action: Action): boolean {
    return this.touch.has(action) || [...this.keys].some((code) => KEY_ACTIONS[code] === action);
  }

  private press(action: Action): void {
    this.pressed.add(action);
    const now = performance.now();
    if (action === 'left' || action === 'right') {
      const sign = action === 'left' ? -1 : 1;
      if (now - (this.directionTimes.get(action) ?? -1000) < 260) this.dashDirection = sign;
      this.flickX = sign;
      this.flickXUntil = now + 100;
      this.directionTimes.set(action, now);
    }
    if (action === 'up' || action === 'down') {
      this.flickZ = action === 'up' ? -1 : 1;
      this.flickZUntil = now + 100;
      this.directionTimes.set(action, now);
    }
  }

  sample(): InputFrame {
    if (document.hidden) return { ...EMPTY_INPUT };
    const now = performance.now();
    const padActions = new Set<Action>();
    let padX = 0;
    let padZ = 0;
    let smashX = 0;
    let smashZ = 0;
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((entry) => entry?.connected);
    if (pad) {
      padX = deadzone(pad.axes[0] ?? 0);
      padZ = deadzone(pad.axes[1] ?? 0);
      const buttons: [Action, number[]][] = [
        ['jump', [0]], ['special', [1]], ['attack', [2]], ['grab', [3]],
        ['dodge', [4, 5, 6, 7]], ['pause', [9]],
      ];
      for (const [action, indices] of buttons) {
        if (indices.some((index) => (pad.buttons[index]?.value ?? 0) > 0.35)) padActions.add(action);
      }
      if (pad.buttons[14]?.pressed) padX = -1;
      if (pad.buttons[15]?.pressed) padX = 1;
      if (pad.buttons[12]?.pressed) padZ = -1;
      if (pad.buttons[13]?.pressed) padZ = 1;
      smashX = deadzone(pad.axes[2] ?? 0);
      smashZ = deadzone(pad.axes[3] ?? 0);
      if (Math.hypot(smashX, smashZ) > 0.5) padActions.add('smash');
      if (Math.abs(padX) > 0.65 && (Math.abs(this.previousPadX) < 0.3 || Math.sign(padX) !== Math.sign(this.previousPadX))) {
        this.press(padX < 0 ? 'left' : 'right');
      }
      if (Math.abs(padZ) > 0.65 && (Math.abs(this.previousPadZ) < 0.3 || Math.sign(padZ) !== Math.sign(this.previousPadZ))) {
        this.press(padZ < 0 ? 'up' : 'down');
      }
    }
    this.previousPadX = padX;
    this.previousPadZ = padZ;
    for (const action of padActions) {
      if (!this.previousPad.has(action)) this.pressed.add(action);
    }
    this.previousPad = padActions;
    const isHeld = (action: Action) => this.held(action) || padActions.has(action);
    let moveX = clamp(Number(this.held('right')) - Number(this.held('left')) + padX);
    let moveZ = clamp(Number(this.held('down')) - Number(this.held('up')) + padZ);
    if (padActions.has('smash')) {
      moveX = smashX;
      moveZ = smashZ;
    }
    const length = Math.hypot(moveX, moveZ);
    if (length > 1) { moveX /= length; moveZ /= length; }
    if (Math.abs(moveX) < 0.2 || Math.sign(moveX) !== this.dashDirection) this.dashDirection = 0;
    const frame: InputFrame = {
      moveX, moveZ,
      attack: this.pressed.has('attack'), attackHeld: isHeld('attack'),
      smash: this.pressed.has('smash'), smashHeld: isHeld('smash'),
      special: this.pressed.has('special'), jump: this.pressed.has('jump'), jumpHeld: isHeld('jump'),
      dodge: this.pressed.has('dodge'), dodgeHeld: isHeld('dodge'),
      grab: this.pressed.has('grab'), dash: isHeld('dash') || this.dashDirection !== 0,
      pause: this.pressed.has('pause'),
      flickX: now < this.flickXUntil ? this.flickX : 0,
      flickZ: now < this.flickZUntil ? this.flickZ : 0,
    };
    this.pressed.clear();
    return frame;
  }

  releaseAll = (): void => {
    this.keys.clear();
    this.touch.clear();
    this.pressed.clear();
    this.previousPad.clear();
    this.previousPadX = this.previousPadZ = 0;
    this.flickXUntil = this.flickZUntil = 0;
    this.dashDirection = 0;
  };

  dispose(): void {
    this.abort.abort();
    this.releaseAll();
  }
}
