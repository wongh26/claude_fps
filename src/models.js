// Stylised meshes: shared materials, procedural textures, the hero model and the twin pistols.
// Everything is built from code. There are no external art assets.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const matCache = new Map();
/** Soft, slightly glossy painted look shared by the whole game. */
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, roughness: opts.rough ?? 0.72, metalness: opts.metal ?? 0.0,
      emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.ei ?? 1,
      map: opts.map ?? null, transparent: !!opts.opacity, opacity: opts.opacity ?? 1,
      flatShading: !!opts.flat,
    }));
  }
  return matCache.get(key);
}
export const glow = (color, intensity = 1.6) => mat(color, { emissive: color, ei: intensity, rough: 0.4 });

const geoCache = new Map();
export function rbox(w, h, d, radius = 0.06, seg = 2) {
  const r = Math.min(radius, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  const key = [w, h, d, r, seg].map((v) => v.toFixed(3)).join();
  if (!geoCache.has(key)) geoCache.set(key, new RoundedBoxGeometry(w, h, d, seg, Math.max(r, 0.002)));
  return geoCache.get(key);
}

export function mesh(geo, material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

// ---------- procedural canvas textures ----------
function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export const textures = {
  paving: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#efe3cc'; g.fillRect(0, 0, s, s);
    const n = 4, w = s / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const off = (y % 2) * w / 2;
      const l = 225 + Math.random() * 20;
      g.fillStyle = `rgb(${l},${l - 14},${l - 34})`;
      g.fillRect(x * w + off + 3, y * w + 3, w - 6, w - 6);
      g.fillRect(x * w + off - s + 3, y * w + 3, w - 6, w - 6);
    }
  }),
  grass: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#8fd16a'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = Math.random() < 0.5 ? '#9edb76' : '#7fc35e';
      g.fillRect(Math.random() * s, Math.random() * s, 3, 3);
    }
  }),
  plaster: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#f6efe3'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 400; i++) {
      const l = 236 + Math.random() * 16;
      g.fillStyle = `rgba(${l},${l - 8},${l - 22},0.5)`;
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
  }),
  stripes: (a, b) => canvasTex(64, (g, s) => {
    for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect((i * s) / 4, 0, s / 4, s); }
  }),
  roof: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#d9734a'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < 8; y++) {
      g.fillStyle = y % 2 ? '#c8643e' : '#e3825a';
      g.fillRect(0, (y * s) / 8, s, 5);
    }
  }),
};

/** Additive radial glow sprite texture (muzzle flashes, sparks, the bomb light). */
let glowTex = null;
export function glowTexture() {
  if (!glowTex) {
    glowTex = canvasTex(64, (g, s) => {
      const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.25, 'rgba(255,255,255,0.8)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, s, s);
    });
    glowTex.wrapS = glowTex.wrapT = THREE.ClampToEdgeWrapping;
  }
  return glowTex;
}

// ---------- weapons ----------
/**
 * A compact machine pistol: ivory shell, graphite grip, glowing energy cell.
 * Built pointing down -Z with its grip at the origin.
 */
export function makePistol(accent = 0x35e0e8) {
  const g = new THREE.Group();
  const shell = mat(0xf2efe8, { rough: 0.35 });
  const dark = mat(0x2d3140, { rough: 0.55 });
  const orange = mat(0xff8a2a, { rough: 0.45 });
  g.add(mesh(rbox(0.075, 0.085, 0.30, 0.028), shell, 0, 0.065, -0.10));         // upper receiver
  g.add(mesh(rbox(0.06, 0.05, 0.22, 0.02), dark, 0, 0.012, -0.11));             // lower frame
  g.add(mesh(rbox(0.082, 0.018, 0.16, 0.008), glow(accent, 2.2), 0, 0.112, -0.10)); // top light strip
  const barrel = mesh(new THREE.CylinderGeometry(0.019, 0.022, 0.12, 12), dark, 0, 0.06, -0.29);
  barrel.rotation.x = Math.PI / 2; g.add(barrel);
  const ring = mesh(new THREE.TorusGeometry(0.024, 0.007, 8, 16), orange, 0, 0.06, -0.33);
  g.add(ring);
  const grip = mesh(rbox(0.055, 0.15, 0.07, 0.02), dark, 0, -0.055, 0.0);
  grip.rotation.x = 0.28; g.add(grip);
  const cell = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.09, 14), glow(accent, 2.6), 0.04, 0.06, -0.06);
  cell.rotation.z = Math.PI / 2; g.add(cell);
  g.add(mesh(rbox(0.05, 0.02, 0.05, 0.008), orange, 0, 0.03, -0.20));          // trigger guard accent
  g.userData.muzzle = new THREE.Vector3(0, 0.06, -0.36);
  return g;
}

// ---------- hero model (third person) ----------
/**
 * The hero "Vesper": a lean courier in a short jacket and an open helmet with a
 * glowing visor. Team colour tints the jacket, helmet trim and visor.
 */
export function makeHeroModel(teamColor) {
  const root = new THREE.Group();
  const jacket = mat(teamColor, { rough: 0.6 });
  const navy = mat(0x2a3150, { rough: 0.7 });
  const ivory = mat(0xf2efe8, { rough: 0.4 });
  const skin = mat(0xe9b48f, { rough: 0.8 });
  const boot = mat(0x3b2f2a, { rough: 0.8 });

  const hips = new THREE.Group(); hips.position.y = 0.92; root.add(hips);
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(0.11 * s, 0, 0);
    leg.add(mesh(rbox(0.15, 0.48, 0.17, 0.06), navy, 0, -0.24, 0));
    leg.add(mesh(rbox(0.13, 0.42, 0.15, 0.05), navy, 0, -0.64, 0));
    leg.add(mesh(rbox(0.15, 0.12, 0.26, 0.05), boot, 0, -0.86, -0.04));
    leg.add(mesh(rbox(0.16, 0.04, 0.18, 0.015), glow(0x35e0e8, 1.6), 0, -0.4, 0)); // knee light
    hips.add(leg); legs.push(leg);
  }
  const torso = new THREE.Group(); torso.position.y = 0.0; hips.add(torso);
  torso.add(mesh(rbox(0.38, 0.5, 0.24, 0.1), jacket, 0, 0.28, 0));
  torso.add(mesh(rbox(0.40, 0.08, 0.26, 0.03), ivory, 0, 0.05, 0));             // belt
  torso.add(mesh(rbox(0.12, 0.05, 0.03, 0.015), glow(0xffc94a, 2), 0, 0.05, -0.13)); // buckle light
  torso.add(mesh(rbox(0.30, 0.10, 0.06, 0.03), ivory, 0, 0.42, -0.12));         // chest plate
  for (const s of [-1, 1]) torso.add(mesh(rbox(0.16, 0.1, 0.22, 0.05), ivory, 0.24 * s, 0.5, 0)); // shoulder pads

  const head = new THREE.Group(); head.position.set(0, 0.62, 0); torso.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.135, 18, 14), skin, 0, 0.1, 0));
  const helm = mesh(new THREE.SphereGeometry(0.15, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(teamColor, { rough: 0.45 }), 0, 0.12, 0.01);
  head.add(helm);
  head.add(mesh(rbox(0.27, 0.06, 0.1, 0.03), glow(0x9ff6ff, 2.4), 0, 0.12, -0.1)); // visor band
  head.add(mesh(rbox(0.05, 0.12, 0.06, 0.02), ivory, 0.15, 0.08, 0));          // ear piece
  head.add(mesh(rbox(0.05, 0.12, 0.06, 0.02), ivory, -0.15, 0.08, 0));

  const arms = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(0.25 * s, 0.46, 0);
    arm.add(mesh(rbox(0.11, 0.3, 0.12, 0.045), jacket, 0, -0.14, 0));
    const fore = new THREE.Group(); fore.position.set(0, -0.28, 0); arm.add(fore);
    fore.add(mesh(rbox(0.1, 0.26, 0.11, 0.04), navy, 0, -0.12, 0));
    const gun = makePistol(); gun.scale.setScalar(0.9); gun.position.set(0, -0.26, -0.02);
    gun.rotation.x = -Math.PI / 2; fore.add(gun);
    arm.rotation.x = 1.3; fore.rotation.x = 0.2;
    torso.add(arm); arms.push(arm);
  }

  root.userData = { hips, legs, arms, torso, head };
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return root;
}

/** Simple procedural run cycle. */
export function animateHero(model, speed, onGround, t, pitch) {
  const { legs, arms, hips, torso, head } = model.userData;
  const k = Math.min(1, speed / 6);
  const sw = Math.sin(t * 13) * 0.9 * k;
  if (onGround) {
    legs[0].rotation.x = sw; legs[1].rotation.x = -sw;
    hips.position.y = 0.92 + Math.abs(Math.cos(t * 13)) * 0.05 * k;
  } else {
    legs[0].rotation.x = -0.6; legs[1].rotation.x = 0.3;
  }
  torso.rotation.x = -0.12 * k;
  const aim = 1.3 + pitch * 0.9;
  arms[0].rotation.x = aim; arms[1].rotation.x = aim;
  head.rotation.x = pitch * 0.5;
}
