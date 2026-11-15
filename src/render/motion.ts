import type { AttackVisual, WeaponId } from '../game/types';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const t = clamp01(value); return t * t * (3 - 2 * t); };

/** Pose and VFX share the simulation's windup / active / recovery boundaries. */
export function attackMotion(attack: AttackVisual, weapon: WeaponId) {
  const time = attack.elapsed;
  const windup = smooth(time / Math.max(0.001, attack.activeStart));
  const swing = smooth((time - attack.activeStart) / Math.max(0.001, attack.activeEnd - attack.activeStart));
  const recovery = smooth((time - attack.activeEnd) / Math.max(0.001, attack.duration - attack.activeEnd));
  const weight = (time < attack.activeStart ? windup : 1) * (1 - recovery);
  const power = attack.kind === 'smash' ? 1.2 + attack.charge * 0.25 : 1;
  const pose = {
    weight, swing, trail: time >= attack.activeStart && time <= attack.activeEnd,
    bodyX: 0.12, bodyY: -0.8 + swing * 1.65, crouch: -0.07,
    rightArmX: -1.55, rightArmY: -1.2 + swing * 2.5, rightArmZ: -0.4,
    leftArmX: -0.65, leftArmY: 0.2, leftArmZ: 0.15,
    leftLegX: -0.3, rightLegX: 0.3,
    slashX: 0.15, slashZ: 1.3 - swing * 2.7, slashY: 0,
  };
  if (weapon === 'pile') {
    pose.bodyX = -0.2 + swing * 0.75;
    pose.bodyY = -0.25 + swing * 0.5;
    pose.crouch = -0.15;
    pose.rightArmX = -2.9 + swing * 3.5;
    pose.rightArmY = -0.2;
    pose.leftArmX = -2.1 + swing * 2.5;
    pose.slashX = 0;
    pose.slashZ = 1.6 - swing * 2.7;
  } else if (weapon === 'razor') {
    const alternate = attack.combo % 2 === 1;
    pose.bodyY = (alternate ? 1 : -1) * (0.6 - swing * 1.2);
    pose.rightArmX = alternate ? -0.9 : -0.5 - Math.sin(swing * Math.PI * 0.8) * 1.2;
    pose.leftArmX = alternate ? -0.5 - Math.sin(swing * Math.PI * 0.8) * 1.2 : -0.9;
    pose.rightArmY = alternate ? -0.4 : 0.25;
    pose.leftArmY = alternate ? -0.25 : 0.4;
    pose.crouch = -0.12;
  }
  if (weapon === 'arc' && attack.kind === 'jab') {
    if (attack.combo === 1) {
      pose.bodyY *= -1;
      pose.rightArmY *= -1;
      pose.slashZ = -1.3 + swing * 2.7;
    } else if (attack.combo === 2) {
      pose.rightArmX = -2.7 + swing * 3;
      pose.bodyX = -0.1 + swing * 0.5;
      pose.bodyY *= 0.4;
      pose.rightArmY = 0.1;
      pose.slashZ = 1.8 - swing * 3;
    }
  }
  if (attack.direction === 'up') {
    pose.rightArmX = -0.3 - swing * 2.8;
    pose.bodyX = 0.2 - swing * 0.45;
    pose.slashZ = -1.1 + swing * 2.6;
  } else if (attack.direction === 'down') {
    pose.crouch = -0.3;
    pose.rightArmX = -2.5 + swing * 3.2;
    pose.bodyX = 0.35;
    pose.slashX = attack.kind === 'aerial' ? 0 : Math.PI / 2;
  } else if (attack.direction === 'back') {
    pose.bodyY += Math.PI * 0.8;
    pose.rightLegX = -1.3;
    pose.slashY = Math.PI;
  } else if (attack.kind === 'aerial' && attack.direction === 'neutral') {
    pose.bodyY = swing * Math.PI * 2;
    pose.leftArmZ = 1.2; pose.rightArmZ = -1.2;
    pose.slashX = Math.PI / 2;
  }
  if (attack.kind === 'dash' || attack.name === 'RAIL CHARGE') {
    pose.bodyX = 0.7; pose.rightArmX = -1.4; pose.crouch = -0.2;
  }
  if (attack.name.includes('SHOT') || attack.name.includes('LASER') || attack.name === 'ION PULSE') {
    pose.bodyY = -0.2; pose.rightArmX = -1.5 + swing * 0.25; pose.rightArmY = 0;
    pose.leftArmX = -1.2; pose.trail = false;
  }
  pose.bodyX *= power;
  return pose;
}
