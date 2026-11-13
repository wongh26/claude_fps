// Practice bots: path along the nav graph toward the player, strafe and shoot when they can see you,
// blink when hurt and rewind when low. They run the same hero simulation as the player.
import * as THREE from 'three';
import { rand, angleDiff, clamp } from './util.js';

export const DIFFICULTY = {
  easy:   { aimErr: 0.11, react: 0.55, turn: 4,  blinkChance: 0.2 },
  normal: { aimErr: 0.06, react: 0.35, turn: 7,  blinkChance: 0.45 },
  hard:   { aimErr: 0.035, react: 0.2, turn: 11, blinkChance: 0.7 },
};

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

function nearestNode(nav, p) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < nav.length; i++) {
    const d = nav[i].p.distanceToSquared(p);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function findPath(nav, from, to) {
  const a = nearestNode(nav, from), b = nearestNode(nav, to);
  if (a < 0 || b < 0) return [];
  const prev = new Map([[a, -1]]);
  const q = [a];
  while (q.length) {
    const i = q.shift();
    if (i === b) break;
    for (const j of nav[i].n) if (!prev.has(j)) { prev.set(j, i); q.push(j); }
  }
  if (!prev.has(b)) return [];
  const path = [];
  for (let i = b; i !== -1; i = prev.get(i)) path.unshift(nav[i].p);
  return path;
}

export class BotBrain {
  constructor(fighter, diff) {
    this.f = fighter;
    this.d = DIFFICULTY[diff] || DIFFICULTY.normal;
    this.path = []; this.repath = 0;
    this.strafe = 1; this.strafeT = 0;
    this.seeT = 0; this.lastHp = fighter.H.hp;
    this.jitter = new THREE.Vector2();
  }

  update(dt, game, target) {
    const f = this.f, inp = f.input;
    inp.fire = false; inp.fx = 0; inp.fz = 0; inp.jump = false;
    if (!f.alive || !target || !target.alive) { this.seeT = 0; return; }

    const eye = f.eyePos(tmp);
    const aimAt = tmp2.set(target.pos.x, target.pos.y + 1.15, target.pos.z);
    const sees = !target.rewinding && game.physics.lineOfSight(eye, aimAt);
    this.seeT = sees ? this.seeT + dt : 0;
    const dist = f.pos.distanceTo(target.pos);

    // React to damage.
    if (f.hp < this.lastHp) {
      if (f.hp < 55 && f.rewindCd <= 0 && Math.random() < 0.6) inp.rewind = true;
      else if (Math.random() < this.d.blinkChance * 0.35) inp.blink = true;
    }
    this.lastHp = f.hp;

    let moveTo = null;
    if (sees) {
      // Turn toward the target with some sway.
      this.jitter.x += (rand(-1, 1) * this.d.aimErr - this.jitter.x) * dt * 4;
      this.jitter.y += (rand(-1, 1) * this.d.aimErr - this.jitter.y) * dt * 4;
      const dx = aimAt.x - eye.x, dy = aimAt.y - eye.y, dz = aimAt.z - eye.z;
      const yaw = Math.atan2(-dx, -dz) + this.jitter.x;
      const pitch = Math.atan2(dy, Math.hypot(dx, dz)) + this.jitter.y;
      f.yaw += clamp(angleDiff(f.yaw, yaw), -this.d.turn * dt, this.d.turn * dt);
      f.pitch += clamp(pitch - f.pitch, -this.d.turn * dt, this.d.turn * dt);
      if (this.seeT > this.d.react && dist < 32 && Math.abs(angleDiff(f.yaw, yaw)) < 0.25) inp.fire = true;

      // Duel movement: strafe, keep a mid-close range.
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafe = -this.strafe; this.strafeT = rand(0.4, 1.3); }
      inp.fx = this.strafe;
      inp.fz = dist > 11 ? 1 : dist < 5 ? -1 : 0;
      if (Math.random() < dt * 0.4) inp.jump = true;
      if (dist > 14 && Math.random() < dt * this.d.blinkChance) inp.blink = true;
      if (f.ult >= 1 && dist < 12 && Math.random() < dt * 0.8) inp.ult = true;
      this.path = [];
    } else {
      this.repath -= dt;
      if (this.repath <= 0 || !this.path.length) { this.path = findPath(game.nav, f.pos, target.pos); this.repath = 1.2; }
      while (this.path.length && Math.hypot(this.path[0].x - f.pos.x, this.path[0].z - f.pos.z) < 1.2) this.path.shift();
      moveTo = this.path[0] || target.pos;
      const yaw = Math.atan2(-(moveTo.x - f.pos.x), -(moveTo.z - f.pos.z));
      f.yaw += clamp(angleDiff(f.yaw, yaw), -this.d.turn * dt, this.d.turn * dt);
      f.pitch *= 0.9;
      inp.fz = 1;
      if (f.ammo < f.H.ammo * 0.5) inp.reload = true;
      // Unstick: hop if barely moving.
      if (Math.hypot(f.vel.x, f.vel.z) < 1 && f.onGround && Math.random() < dt * 3) inp.jump = true;
    }
  }
}
