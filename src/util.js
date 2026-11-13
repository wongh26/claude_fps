// Small shared helpers: math, randomness and ray/box tests.
import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Unit view direction from yaw/pitch (yaw 0 looks down -Z, like a three.js camera). */
export function dirFromAngles(yaw, pitch, out = new THREE.Vector3()) {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

/**
 * Ray vs axis-aligned box (slab method).
 * Returns the entry distance along the (normalised) ray, or Infinity on a miss.
 */
export function rayAABB(o, d, min, max, maxT = Infinity) {
  let tmin = 0, tmax = maxT;
  for (const ax of ['x', 'y', 'z']) {
    const inv = 1 / d[ax];
    let t1 = (min[ax] - o[ax]) * inv;
    let t2 = (max[ax] - o[ax]) * inv;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/** Random unit vector inside a cone of half-angle `spread` around `dir`. */
export function spreadDir(dir, spread, out = new THREE.Vector3()) {
  out.copy(dir);
  if (spread <= 0) return out;
  const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const r = new THREE.Vector3().crossVectors(dir, up).normalize();
  const u = new THREE.Vector3().crossVectors(r, dir).normalize();
  const a = Math.random() * Math.PI * 2;
  const m = Math.sqrt(Math.random()) * spread;
  return out.addScaledVector(r, Math.cos(a) * m).addScaledVector(u, Math.sin(a) * m).normalize();
}

export function makeCode(n = 5) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}

export const $ = (id) => document.getElementById(id);

export function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* storage blocked: ignore */ }
  return null;
}
