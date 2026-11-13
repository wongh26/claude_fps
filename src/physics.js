// Character movement against the map's axis-aligned box colliders, plus world raycasts.
import * as THREE from 'three';
import { rayAABB } from './util.js';

export const GRAVITY = 21;
export const STEP_UP = 0.55;

export class Physics {
  constructor(colliders, bounds) {
    this.colliders = colliders; // [{min: Vector3, max: Vector3}]
    this.bounds = bounds;       // {minX, maxX, minZ, maxZ}
  }

  /** True if a body (feet at p, radius r, height h) overlaps any collider. */
  overlaps(p, r, h, ignoreBelow = -Infinity) {
    for (const c of this.colliders) {
      if (c.max.y <= ignoreBelow) continue;
      if (p.x + r > c.min.x && p.x - r < c.max.x &&
          p.z + r > c.min.z && p.z - r < c.max.z &&
          p.y + h > c.min.y && p.y < c.max.y) return c;
    }
    return null;
  }

  /** Moves a body one step, resolving collisions axis by axis with step-up onto low ledges. */
  move(body, dt) {
    const { pos, vel, r, h } = body;
    body.vel.y -= GRAVITY * dt * (body.gravityScale ?? 1);

    for (const ax of ['x', 'z']) {
      const amount = vel[ax] * dt;
      if (!amount) continue;
      pos[ax] += amount;
      for (let guard = 0; guard < 6; guard++) {
        const c = this.overlaps(pos, r, h);
        if (!c) break;
        const rise = c.max.y - pos.y;
        if (rise > 0 && rise <= STEP_UP) {
          const old = pos.y;
          pos.y = c.max.y + 0.001;
          if (!this.overlaps(pos, r, h)) { body.onGround = true; vel.y = Math.max(vel.y, 0); continue; }
          pos.y = old;
        }
        pos[ax] = amount > 0 ? c.min[ax] - r - 0.001 : c.max[ax] + r + 0.001;
        vel[ax] = 0;
      }
    }

    // Keep inside the arena.
    const b = this.bounds;
    pos.x = Math.min(b.maxX - r, Math.max(b.minX + r, pos.x));
    pos.z = Math.min(b.maxZ - r, Math.max(b.minZ + r, pos.z));

    body.onGround = false;
    pos.y += vel.y * dt;
    const c = this.overlaps(pos, r, h);
    if (c) {
      if (vel.y <= 0) { pos.y = c.max.y + 0.001; body.onGround = true; }
      else pos.y = c.min.y - h - 0.001;
      vel.y = 0;
    }
    if (pos.y <= 0) { pos.y = 0; vel.y = Math.max(0, vel.y); body.onGround = true; }
  }

  /** Distance to the first collider along a ray (or maxT). */
  ray(o, d, maxT = 200) {
    let best = maxT;
    for (const c of this.colliders) {
      const t = rayAABB(o, d, c.min, c.max, best);
      if (t < best) best = t;
    }
    if (d.y < 0) { // the ground plane
      const tg = -o.y / d.y;
      if (tg >= 0 && tg < best) best = tg;
    }
    return best;
  }

  lineOfSight(a, b) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return true;
    d.divideScalar(len);
    return this.ray(a, d, len) >= len - 0.05;
  }
}
