// The playable hero and its kit. The same simulation drives the local player and bots;
// online opponents are puppets (see RemoteFighter in main.js) driven by network snapshots.
import * as THREE from 'three';
import { dirFromAngles, clamp } from './util.js';

/**
 * Vesper: an agile skirmisher.
 *  - Twin machine pistols: very fast fire, damage falls off with range.
 *  - SKIP (Shift / RMB): short teleport in the direction you are moving. 3 charges.
 *  - REWIND (E): snap back along your path from 3 seconds ago, restoring health and ammo.
 *  - TICK CHARGE (Q, ultimate): throw a sticky charge that detonates after a short fuse.
 */
export const HERO = {
  name: 'Vesper',
  hp: 150, speed: 6.4, r: 0.35, h: 1.75, eye: 1.58, jump: 7.4,
  ammo: 40, fireInterval: 0.05, dmg: 7, headMult: 2, falloffNear: 11, falloffFar: 30, falloffMin: 0.3,
  spread: 0.022, reload: 1.1,
  blink: { charges: 3, recharge: 3, dist: 7.5 },
  rewind: { cd: 12, window: 3, dur: 1.25 },
  bomb: { dmg: 350, radius: 3.2, fuse: 1.0, life: 3.5, speed: 17, ultCost: 650 },
};

const SAMPLE = 0.05;

export class Fighter {
  constructor({ id, name, team, isLocal = false, isBot = false }) {
    Object.assign(this, { id, name, team, isLocal, isBot });
    this.H = HERO;
    this.r = HERO.r; this.h = HERO.h;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.kills = 0; this.deaths = 0;
    this.input = { fx: 0, fz: 0, jump: false, fire: false, blink: false, rewind: false, ult: false, reload: false };
    this.reset();
  }

  reset() {
    this.hp = HERO.hp; this.alive = true; this.onGround = false;
    this.ammo = HERO.ammo; this.reloadT = 0; this.fireCd = 0; this.gunSide = 1;
    this.blinkCharges = HERO.blink.charges; this.blinkRecharge = 0;
    this.rewindCd = 0; this.rewindT = -1; this.rewindPath = null;
    this.history = []; this.histAcc = 0;
    this.ult = this.ult ?? 0;
    this.respawnT = 0; this.vel.set(0, 0, 0);
    this.hurtT = 0; this.blinkFx = 0;
  }

  get rewinding() { return this.rewindT >= 0; }
  eyePos(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + HERO.eye, this.pos.z); }
  aimDir(out = new THREE.Vector3()) { return dirFromAngles(this.yaw, this.pitch, out); }
  /** Horizontal world direction of the current movement input (or facing if idle). */
  moveDir(out = new THREE.Vector3()) {
    const { fx, fz } = this.input;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    out.set(-s * fz + c * fx, 0, -c * fz - s * fx);
    if (out.lengthSq() < 1e-4) out.set(-s, 0, -c);
    return out.normalize();
  }
  addUlt(damage) { this.ult = clamp(this.ult + damage / HERO.bomb.ultCost, 0, 1); }

  /**
   * One simulation step. `game` supplies physics plus the callbacks
   * fireShot(fighter, side) and throwBomb(fighter), and sound(name, fighter).
   */
  update(dt, game) {
    if (!this.alive) return;
    const inp = this.input;
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.blinkFx = Math.max(0, this.blinkFx - dt);

    // --- cooldowns ---
    if (this.blinkCharges < HERO.blink.charges) {
      this.blinkRecharge += dt;
      if (this.blinkRecharge >= HERO.blink.recharge) { this.blinkCharges++; this.blinkRecharge = 0; }
    }
    this.rewindCd = Math.max(0, this.rewindCd - dt);
    this.ult = Math.min(1, this.ult + dt * 0.004);

    // --- rewinding: follow the recorded path backwards, untouchable ---
    if (this.rewinding) {
      this.rewindT += dt;
      const path = this.rewindPath;
      const f = clamp(this.rewindT / HERO.rewind.dur, 0, 1);
      const idx = f * (path.length - 1);
      const i0 = Math.floor(idx), i1 = Math.min(path.length - 1, i0 + 1);
      this.pos.lerpVectors(path[i0].p, path[i1].p, idx - i0);
      this.vel.set(0, 0, 0);
      if (f >= 1) {
        const oldest = path[path.length - 1];
        this.hp = Math.max(this.hp, oldest.hp);
        this.ammo = HERO.ammo; this.reloadT = 0;
        this.rewindT = -1; this.rewindPath = null; this.history = [];
        game.sound('rewindEnd', this);
      }
      inp.blink = inp.rewind = inp.ult = inp.reload = false;
      return;
    }

    // --- movement ---
    const wish = new THREE.Vector3();
    if (inp.fx || inp.fz) wish.copy(this.moveDir());
    const accel = this.onGround ? 60 : 14;
    const target = wish.multiplyScalar(HERO.speed);
    for (const ax of ['x', 'z']) {
      const d = target[ax] - this.vel[ax];
      const step = accel * dt;
      this.vel[ax] += Math.abs(d) < step ? d : Math.sign(d) * step;
    }
    if (inp.jump && this.onGround) { this.vel.y = HERO.jump; this.onGround = false; game.sound('jump', this); }
    game.physics.move(this, dt);

    // --- record history for Rewind ---
    this.histAcc += dt;
    while (this.histAcc >= SAMPLE) {
      this.histAcc -= SAMPLE;
      this.history.push({ p: this.pos.clone(), hp: this.hp });
      if (this.history.length > HERO.rewind.window / SAMPLE) this.history.shift();
    }

    // --- abilities ---
    if (inp.blink) { inp.blink = false; if (this.blinkCharges > 0) this.doBlink(game); }
    if (inp.rewind) { inp.rewind = false; if (this.rewindCd <= 0 && this.history.length > 4) this.doRewind(game); }
    if (inp.ult) { inp.ult = false; if (this.ult >= 1) { this.ult = 0; game.throwBomb(this); } }

    // --- weapon ---
    this.fireCd -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.ammo = HERO.ammo; this.reloadT = 0; }
    } else {
      if ((inp.reload && this.ammo < HERO.ammo) || this.ammo <= 0) { this.reloadT = HERO.reload; game.sound('reload', this); }
      else if (inp.fire && this.fireCd <= 0) {
        this.fireCd = HERO.fireInterval;
        this.ammo--;
        this.gunSide = -this.gunSide;
        game.fireShot(this, this.gunSide);
      }
    }
    inp.reload = false;
    if (this.fireCd < -1) this.fireCd = 0;
  }

  doBlink(game) {
    const dir = this.moveDir();
    const from = this.pos.clone();
    const chest = this.eyePos().addScaledVector(new THREE.Vector3(0, -0.6, 0), 1);
    let dist = Math.min(HERO.blink.dist, game.physics.ray(chest, dir, HERO.blink.dist) - 0.5);
    const test = new THREE.Vector3();
    for (; dist > 0.2; dist -= 0.4) {
      test.copy(from).addScaledVector(dir, dist);
      if (!game.physics.overlaps(test, this.r, this.h)) break;
      test.y += 0.6; // let a blink hop onto a low ledge
      if (!game.physics.overlaps(test, this.r, this.h)) break;
    }
    if (dist <= 0.2) return; // fully blocked: keep the charge
    this.pos.copy(test);
    this.vel.y = Math.max(this.vel.y, 0);
    this.blinkCharges--;
    this.blinkFx = 0.25;
    game.onBlink(this, from, this.pos.clone());
  }

  doRewind(game) {
    this.rewindPath = this.history.slice().reverse();
    this.rewindT = 0;
    this.rewindCd = HERO.rewind.cd;
    this.reloadT = 0;
    game.sound('rewind', this);
    game.onRewind?.(this);
  }

  /** Returns true if this hit killed the fighter. */
  takeDamage(dmg) {
    if (!this.alive || this.rewinding) return false;
    this.hp -= dmg;
    this.hurtT = 0.35;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.rewindT = -1; return true; }
    return false;
  }
}
