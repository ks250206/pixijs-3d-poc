import type { ActionPress, BufferedAction, InputFrame } from './types';

export const ACTION_BUFFER_FRAMES = 5;
export const BUFFERED_ACTIONS: readonly BufferedAction[] = ['dodge', 'jump', 'special', 'grab', 'smash', 'attack'];

export function actionPress(action: BufferedAction, input: Pick<InputFrame, 'moveX' | 'moveZ' | 'aimX' | 'aimZ' | 'dash'>): ActionPress {
  return { action, moveX: input.moveX, moveZ: input.moveZ, aimX: input.aimX ?? input.moveX, aimZ: input.aimZ ?? input.moveZ, dash: input.dash };
}

function presses(input: InputFrame): readonly ActionPress[] {
  return input.presses ?? BUFFERED_ACTIONS.filter(action => input[action]).map(action => actionPress(action, input));
}

/** Preserve edge-time direction while continuous movement/held buttons stay current. */
export function mergeInputFrames(pending: InputFrame, sampled: InputFrame): InputFrame {
  const merged = { ...sampled, presses: [...presses(pending), ...presses(sampled)], pause: pending.pause || sampled.pause,
    flickX: sampled.flickX || pending.flickX, flickZ: sampled.flickZ || pending.flickZ };
  for (const action of BUFFERED_ACTIONS) merged[action] = pending[action] || sampled[action];
  return merged;
}

export function clearInputEdges(input: InputFrame): InputFrame {
  return { ...input, presses: [], attack: false, smash: false, special: false, jump: false,
    dodge: false, grab: false, pause: false, flickX: 0, flickZ: 0 };
}

/** Five simulation frames including the press frame. Hitstop does not advance this clock. */
export class ActionBuffer {
  private pending = new Map<BufferedAction, ActionPress & { frames: number }>();

  capture(input: InputFrame): void {
    for (const press of presses(input)) this.pending.set(press.action, { ...press, frames: ACTION_BUFFER_FRAMES });
  }

  peek(action: BufferedAction): ActionPress | undefined { return this.pending.get(action); }

  consume(action: BufferedAction, current: InputFrame): InputFrame {
    const press = this.pending.get(action)!;
    this.pending.delete(action);
    return { ...clearInputEdges(current), ...press, [action]: true };
  }

  advance(delta: number): void {
    for (const [action, press] of this.pending) {
      press.frames -= delta * 60;
      if (press.frames <= 1e-7) this.pending.delete(action);
    }
  }

  reset(): void { this.pending.clear(); }
}
