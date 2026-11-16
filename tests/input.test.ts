import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { GameInput } from '../src/game/input';

let input: GameInput;
let pad: { connected: boolean; axes: number[]; buttons: { pressed: boolean; value: number }[] } | null;
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('navigator', { getGamepads: () => pad ? [pad] : [] });
  pad = null;
  input = new GameInput();
});
afterEach(() => { input.dispose(); vi.unstubAllGlobals(); });

function key(type: 'keydown' | 'keyup', code: string) {
  const event = Object.assign(new Event(type, { cancelable: true }), { code, repeat: false, metaKey: false, altKey: false });
  window.dispatchEvent(event);
}

describe('input edge direction and separate aiming', () => {
  it('captures keyboard direction before release and never repeats a held attack', () => {
    key('keydown', 'KeyW');
    key('keydown', 'KeyJ');
    key('keyup', 'KeyW');
    const first = input.sample();
    expect(first.moveZ).toBe(0);
    expect(first.presses).toEqual([expect.objectContaining({ action: 'attack', aimZ: -1 })]);
    expect(first.attack).toBe(true);
    const held = input.sample();
    expect(held.attack).toBe(false);
    expect(held.attackHeld).toBe(true);
    expect(held.presses).toEqual([]);
    key('keyup', 'KeyJ');
    key('keydown', 'KeyJ');
    expect(input.sample().attack).toBe(true);
  });

  it('keeps left-stick movement independent of right-stick smash aim and charge holding', () => {
    pad = { connected: true, axes: [-1, 0, 1, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    const pressed = input.sample();
    expect(pressed.moveX).toBe(-1);
    expect(pressed.aimX).toBe(1);
    expect(pressed.smash).toBe(true);
    expect(pressed.presses).toContainEqual(expect.objectContaining({ action: 'smash', moveX: -1, aimX: 1 }));
    pad.axes[0] = 0;
    const held = input.sample();
    expect(held.moveX).toBe(0);
    expect(held.smash).toBe(false);
    expect(held.smashHeld).toBe(true);
    expect(held.presses).toEqual([]);
  });

  it('clears captured presses and held states before a resumed menu', () => {
    input.touchSet('right', true);
    input.touchSet('dodge', true);
    input.releaseAll();
    const resumed = input.sample();
    expect(resumed.presses).toEqual([]);
    expect(resumed.dodge).toBe(false);
    expect(resumed.moveX).toBe(0);
  });

  it.each(['jump', 'pause', 'smash'] as const)('requires a held gamepad %s to release before generating a post-menu edge', action => {
    pad = { connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    const hold = (held: boolean) => {
      if (action === 'smash') pad!.axes[2] = Number(held);
      else pad!.buttons[action === 'jump' ? 0 : 9] = { pressed: held, value: Number(held) };
    };
    hold(true);
    // The reset must also catch a physical press not yet seen by sample().
    input.releaseAll();
    expect(input.sample()[action]).toBe(false);
    const stillHeld = input.sample();
    expect(stillHeld[action]).toBe(false);
    expect(stillHeld.presses).toEqual([]);
    hold(false);
    expect(input.sample()[action]).toBe(false);
    hold(true);
    expect(input.sample()[action]).toBe(true);
  });

  it('accepts the first gamepad press at startup and a new press immediately after a menu reset', () => {
    pad = { connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    pad.buttons[0] = { pressed: true, value: 1 };
    expect(input.sample().jump).toBe(true);
    pad.buttons[0] = { pressed: false, value: 0 };
    input.releaseAll();
    pad.buttons[0] = { pressed: true, value: 1 };
    expect(input.sample().jump).toBe(true);
    expect(input.sample().jump).toBe(false);
  });

  it('accepts fresh keyboard and touch presses while the same gamepad action stays suppressed', () => {
    pad = { connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    pad.buttons[2] = { pressed: true, value: 1 };
    input.releaseAll();
    key('keydown', 'KeyJ');
    expect(input.sample().attack).toBe(true);
    expect(input.sample().attack).toBe(false);
    key('keyup', 'KeyJ');
    input.touchSet('attack', true);
    expect(input.sample().attack).toBe(true);
    expect(input.sample().attack).toBe(false);
  });
});
