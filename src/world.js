// "Solace Harbor": a sunny seaside plaza arena with bright, stylised art.
// Every solid piece registers an axis-aligned collider; decoration can opt out.
import * as THREE from 'three';
import { mat, glow, rbox, mesh, textures } from './models.js';

export const TEAM_COLORS = [0x3d8bff, 0xff6a3d];
export const TEAM_CSS = ['#5aa2ff', '#ff7a4d'];

const P = {
  plaster: 0xf6efe3, peach: 0xffc9a8, mint: 0xbfe8d2, sky: 0xbfdcf5, cream: 0xfff1c9,
  stone: 0xe6dccb, trim: 0xffffff, navy: 0x2b3a67, wood: 0xb07a4f, teal: 0x2ec4c6,
  gold: 0xffc94a, glass: 0x2a6f8f, leaf: 0x5cc25a, trunk: 0x8a5a3a, rail: 0xdfe9f2,
};

export function buildWorld(scene) {
  const colliders = [];
  const animated = [];
  const root = new THREE.Group();
  scene.add(root);

  /** Box with its bottom at y. Rounded edges, shadows, collider unless solid === false. */
  function box(x, y, z, w, h, d, material, { solid = true, radius = 0.08, shadow = true } = {}) {
    const m = mesh(rbox(w, h, d, radius), typeof material === 'number' ? mat(material) : material, x, y + h / 2, z, shadow);
    root.add(m);
    if (solid) colliders.push({ min: new THREE.Vector3(x - w / 2, y, z - d / 2), max: new THREE.Vector3(x + w / 2, y + h, z + d / 2) });
    return m;
  }
  const collider = (x0, y0, z0, x1, y1, z1) =>
    colliders.push({ min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1) });
  /** Runs fn for the west half and its mirror image on the east half. */
  const sym = (fn) => { fn(1); fn(-1); };

  // ---------- sky, light, distant scenery ----------
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: new THREE.Vector3(0.45, 0.55, 0.7).normalize() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 sunDir; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 zenith = vec3(0.18, 0.50, 0.92), horizon = vec3(0.86, 0.93, 0.98), warm = vec3(1.0, 0.92, 0.78);
        vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.55));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        col = mix(col, warm, pow(s, 6.0) * 0.45);
        col += vec3(1.0, 0.95, 0.85) * pow(s, 400.0) * 2.5;
        if (vDir.y < 0.0) col = mix(horizon, vec3(0.55, 0.78, 0.9), clamp(-vDir.y * 4.0, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat);
  sky.renderOrder = -1;
  scene.add(sky);
  scene.fog = new THREE.Fog(0xd6ecf8, 90, 420);

  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0xf3d8b0, 1.25));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.position.set(36, 60, 50);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 45, bottom: -45, near: 10, far: 180 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  // Ocean to the south, islands and hills on the horizon.
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(1400, 700), mat(0x2aa3d4, { rough: 0.18, metal: 0.15 }));
  ocean.rotation.x = -Math.PI / 2; ocean.position.set(0, -1.6, 380); scene.add(ocean);
  for (const [x, z, r, h] of [[-120, 170, 30, 22], [60, 210, 45, 30], [190, 150, 26, 14], [-230, 230, 50, 26]]) {
    const isl = new THREE.Mesh(new THREE.ConeGeometry(r, h, 9), mat(0x6fc06a, { flat: true }));
    isl.position.set(x, h / 2 - 2, z); scene.add(isl);
    const beach = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.15, 2, 9), mat(0xf3e2b6));
    beach.position.set(x, -1.4, z); scene.add(beach);
  }
  for (const [x, z, s] of [[-140, -140, 70], [-20, -170, 90], [120, -150, 80], [240, -90, 60], [-250, -60, 70]]) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 10), mat(0x7ccc6c, { flat: true }));
    hill.scale.y = 0.45; hill.position.set(x, -s * 0.12, z); scene.add(hill);
  }
  const cloudMat = mat(0xffffff, { emissive: 0xffffff, ei: 0.35, rough: 1 });
  for (let i = 0; i < 14; i++) {
    const c = new THREE.Group();
    const n = 4 + ((i * 7) % 4);
    for (let k = 0; k < n; k++) {
      const s = 8 + ((i * 13 + k * 5) % 9);
      const puff = new THREE.Mesh(new THREE.SphereGeometry(s, 12, 9), cloudMat);
      puff.position.set(k * 9 - n * 4.5, ((k * 3) % 4) - 2, (k % 2) * 6);
      puff.scale.y = 0.65; c.add(puff);
    }
    const a = (i / 14) * Math.PI * 2;
    c.position.set(Math.cos(a) * 300, 75 + (i % 3) * 14, Math.sin(a) * 300);
    c.lookAt(0, c.position.y, 0);
    scene.add(c);
  }

  // ---------- ground ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat(0xffffff, { map: textures.grass(), rough: 0.95 }));
  ground.material.map.repeat.set(60, 60);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(86, 50), mat(0xffffff, { map: textures.paving(), rough: 0.85 }));
  plaza.material.map.repeat.set(22, 13);
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.01; plaza.receiveShadow = true; root.add(plaza);

  // ---------- arena boundary ----------
  const B = { minX: -42, maxX: 42, minZ: -24, maxZ: 24 };
  collider(-60, 0, 24, 60, 30, 30);     // south: sea wall (invisible tall part)
  collider(-60, 0, -40, 60, 30, -24);   // north: town facades
  collider(-50, 0, -30, -42, 30, 30);   // west
  collider(42, 0, -30, 50, 30, 30);     // east

  // Sea wall with rails, looking out over the water.
  box(0, 0, 24.6, 86, 1.0, 1.2, P.stone, { solid: false });
  for (let x = -42; x <= 42; x += 3) box(x, 1.0, 24.4, 0.14, 0.9, 0.14, P.rail, { solid: false, radius: 0.05 });
  box(0, 1.85, 24.4, 86, 0.1, 0.16, P.rail, { solid: false, radius: 0.04 });

  // North town facades: pastel houses with tiled roofs, windows and awnings.
  const facadeColors = [P.peach, P.mint, P.sky, P.cream, P.plaster];
  const roofMat = mat(0xffffff, { map: textures.roof(), rough: 0.8 });
  for (let i = 0, x = -44; x < 44; i++) {
    const w = 8 + (i % 3) * 2, h = 7 + ((i * 5) % 4) * 1.4;
    box(x + w / 2, 0, -27, w, h, 6, facadeColors[i % facadeColors.length], { solid: false });
    const roof = mesh(rbox(w + 0.6, 0.7, 6.8, 0.15), roofMat, x + w / 2, h + 0.35, -27);
    root.add(roof);
    for (let wx = x + 1.8; wx < x + w - 1; wx += 2.6) {
      for (let wy = 1.6; wy < h - 1.5; wy += 2.6) {
        root.add(mesh(rbox(1.1, 1.4, 0.12, 0.04), mat(P.glass, { rough: 0.2, metal: 0.3 }), wx, wy + 0.7, -23.98, false));
        root.add(mesh(rbox(1.4, 0.12, 0.3, 0.04), mat(P.trim), wx, wy - 0.05, -23.9, false));
      }
    }
    if (i % 2 === 0) {
      const aw = mesh(new THREE.BoxGeometry(w - 1.2, 0.08, 1.6), mat(0xffffff, { map: textures.stripes('#ffffff', i % 4 ? '#2ec4c6' : '#ff7a4d') }), x + w / 2, 3.1, -23.2);
      aw.rotation.x = 0.25; root.add(aw);
    }
    x += w;
  }

  // ---------- spawn halls (west = team 0, east = team 1) ----------
  for (const [side, color] of [[-1, TEAM_COLORS[0]], [1, TEAM_COLORS[1]]]) {
    const cx = side * 38;
    const front = side * 34;
    box(cx, 0, -8, 8, 5.4, 0.8, P.plaster);                // side walls
    box(cx, 0, 8, 8, 5.4, 0.8, P.plaster);
    box(front, 0, -5.25, 0.8, 5.4, 5.5, P.plaster);       // front wall with a doorway
    box(front, 0, 5.25, 0.8, 5.4, 5.5, P.plaster);
    box(front, 3.4, 0, 0.8, 2.0, 5.0, P.plaster);         // lintel over the doorway
    box(cx, 5.4, 0, 9, 0.5, 17.6, color);                  // team-coloured roof
    box(front - side * 0.1, 3.0, 0, 1.0, 0.25, 5.2, glow(color, 1.4), { solid: false });
    box(cx + side * 3.6, 0.2, 0, 0.3, 3.5, 10, glow(color, 0.6), { solid: false });
  }

  // ---------- central monument plaza ----------
  box(0, 0, 0, 13, 0.45, 13, P.stone, { radius: 0.2 });
  box(0, 0.45, 0, 3.2, 1.0, 3.2, P.trim, { radius: 0.2 });
  box(0, 1.45, 0, 1.2, 5.5, 1.2, P.plaster, { radius: 0.25 });
  box(0, 6.95, 0, 1.6, 0.4, 1.6, glow(P.teal, 1.8), { solid: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.18, 12, 48), glow(P.gold, 1.4));
  ring.position.set(0, 7.9, 0); ring.castShadow = true; root.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.1, 10, 40), glow(P.teal, 2));
  ring2.position.copy(ring.position); root.add(ring2);
  animated.push((t) => { ring.rotation.set(t * 0.5, t * 0.8, 0); ring2.rotation.set(-t * 0.9, 0, t * 0.6); });
  for (const [x, z] of [[-5.5, -5.5], [5.5, -5.5], [-5.5, 5.5], [5.5, 5.5]]) {
    box(x, 0.45, z, 1.2, 0.9, 1.2, P.wood);                  // planter
    tree(x, 1.35, z, 0.7);
  }

  // ---------- north market hall with walkable roof ----------
  box(0, 0, -17, 20, 4.2, 6, P.cream);
  box(0, 4.2, -17, 20.4, 0.25, 6.4, P.trim);
  box(0, 4.45, -19.9, 20.4, 0.8, 0.3, P.trim);              // rear parapet
  for (let x = -8; x <= 8; x += 4) {
    root.add(mesh(rbox(2.4, 2.8, 0.15, 0.08), mat(P.glass, { rough: 0.2, metal: 0.3 }), x, 1.6, -13.97, false));
  }
  const awning = mesh(new THREE.BoxGeometry(20, 0.08, 2.2), mat(0xffffff, { map: textures.stripes('#ffffff', '#ff7a4d') }), 0, 3.4, -13.1, true);
  awning.material.map.repeat.set(10, 1); awning.rotation.x = 0.22; root.add(awning);
  sym((s) => stairs(s * 10.2, -17, s, 6, 4.2, 10, 3.6, P.stone));

  // ---------- south harbour walkway (elevated) ----------
  box(0, 3.2, 15, 36, 0.4, 4, P.stone);
  box(0, 3.6, 16.85, 36, 1.0, 0.25, mat(0x9fe3ff, { opacity: 0.45, rough: 0.1 }));    // glass rail
  box(0, 4.6, 16.85, 36, 0.12, 0.35, P.trim, { solid: false });
  for (let x = -16; x <= 16; x += 8) box(x, 0, 15, 0.7, 3.2, 0.7, P.trim, { radius: 0.2 });
  sym((s) => stairs(-s * 18, 15, -s, 7.5, 3.6, 9, 4, P.stone));
  box(0, 3.6, 13.25, 6, 0.3, 0.25, glow(P.teal, 1.2), { solid: false });

  // ---------- lane walls with arches ----------
  sym((s) => {
    const x = s * 20;
    box(x, 0, -9, 1, 3.6, 7, P.peach);
    box(x, 0, 7.5, 1, 3.6, 7, P.peach);
    box(x, 3.6, -0.75, 1.2, 0.5, 23, P.trim);                // top cap / arch lintel
    box(x, 0, -3.6, 1.3, 3.6, 0.6, P.trim);                  // arch posts
    box(x, 0, 2.1, 1.3, 3.6, 0.6, P.trim);
    box(x, 3.0, -0.75, 1.0, 0.6, 5.1, P.peach);
  });

  // ---------- cover: crates, barrels, market stalls, trees ----------
  sym((s) => {
    crate(s * 7.5, 0, -9, 1.4); crate(s * 7.5, 1.4, -9, 1.0);
    crate(s * 12.5, 0, 4.5, 1.6);
    crate(s * 26, 0, -6, 1.5); crate(s * 27.3, 0, -4.6, 1.1);
    crate(s * 27, 0, 10.5, 1.6); crate(s * 27, 1.6, 10.5, 1.1);
    crate(s * 15, 0, 20, 1.3);
    barrel(s * 13.6, -10.5); barrel(s * 14.6, -11.2); barrel(s * 24, 17.5);
    stall(s * 29, -16, s);
    box(s * 9, 0, 8.5, 1.4, 1.0, 1.4, P.wood); tree(s * 9, 1.0, 8.5, 0.8);
    box(s * 31, 0, 0, 1.4, 1.0, 1.4, P.wood); tree(s * 31, 1.0, 0, 0.85);
    lamp(s * 16, -13); lamp(s * 4, 20);
  });

  function crate(x, y, z, sz) {
    box(x, y, z, sz, sz, sz, P.wood, { radius: 0.07 });
    box(x, y + sz * 0.42, z, sz + 0.03, sz * 0.14, sz + 0.03, P.teal, { solid: false, radius: 0.03 });
  }
  function barrel(x, z) {
    const b = mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 16), mat(P.navy), x, 0.55, z);
    root.add(b);
    root.add(mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.1, 16), mat(P.gold, { rough: 0.4 }), x, 0.85, z));
    collider(x - 0.45, 0, z - 0.45, x + 0.45, 1.1, z + 0.45);
  }
  function tree(x, y, z, s) {
    root.add(mesh(new THREE.CylinderGeometry(0.12 * s, 0.18 * s, 2.2 * s, 8), mat(P.trunk), x, y + 1.1 * s, z));
    const leaves = mat(P.leaf, { flat: true, rough: 0.9 });
    for (const [dx, dy, dz, r] of [[0, 2.6, 0, 1.0], [0.6, 2.2, 0.2, 0.7], [-0.5, 2.3, -0.3, 0.75], [0.1, 3.2, 0.1, 0.65]]) {
      root.add(mesh(new THREE.IcosahedronGeometry(r * s, 1), leaves, x + dx * s, y + dy * s, z + dz * s));
    }
    collider(x - 0.25, y, z - 0.25, x + 0.25, y + 2.2 * s, z + 0.25);
  }
  function stall(x, z, s) {
    box(x, 0, z, 4, 1.1, 1.6, P.wood);
    box(x - 1.8, 1.1, z - 0.6, 0.15, 1.6, 0.15, P.trim, { solid: false });
    box(x + 1.8, 1.1, z - 0.6, 0.15, 1.6, 0.15, P.trim, { solid: false });
    const can = mesh(new THREE.BoxGeometry(4.6, 0.1, 2.4), mat(0xffffff, { map: textures.stripes('#ffffff', s > 0 ? '#3d8bff' : '#ff7a4d') }), x, 2.75, z - 0.2);
    can.material.map.repeat.set(4, 1); can.rotation.x = -0.2; root.add(can);
    for (let i = -1; i <= 1; i++) root.add(mesh(new THREE.SphereGeometry(0.22, 10, 8), mat([0xff6a3d, 0xffc94a, 0x8fd16a][i + 1]), x + i * 1.1, 1.32, z));
  }
  function lamp(x, z) {
    root.add(mesh(new THREE.CylinderGeometry(0.08, 0.12, 4, 8), mat(P.navy), x, 2, z));
    root.add(mesh(new THREE.SphereGeometry(0.28, 12, 10), glow(0xfff3c4, 1.6), x, 4.1, z, false));
    collider(x - 0.15, 0, z - 0.15, x + 0.15, 4, z + 0.15);
  }
  /**
   * A flight of stairs. (x, z): foot of the top step's far edge side; dir: +1 climbs toward +x.
   * Steps are solid boxes from the ground up, so step-up physics can climb them.
   */
  function stairs(xTop, zc, dir, run, height, steps, width, color) {
    const sd = run / steps;
    for (let i = 0; i < steps; i++) {
      const h = height * (i + 1) / steps;
      const x = xTop + dir * (run - (i + 0.5) * sd);
      box(x, 0, zc, sd + 0.02, h, width, color, { radius: 0.03 });
    }
  }

  // ---------- spawns & bot navigation ----------
  const spawns = [
    [new THREE.Vector3(-38, 0, -3), new THREE.Vector3(-38, 0, 3), new THREE.Vector3(-37, 0, 0)],
    [new THREE.Vector3(38, 0, -3), new THREE.Vector3(38, 0, 3), new THREE.Vector3(37, 0, 0)],
  ];
  const ffaSpawns = [
    new THREE.Vector3(-30, 0, -18), new THREE.Vector3(30, 0, -18), new THREE.Vector3(-30, 0, 18),
    new THREE.Vector3(30, 0, 18), new THREE.Vector3(0, 0.45, 9), new THREE.Vector3(0, 0, -11),
    new THREE.Vector3(-14, 0, 0), new THREE.Vector3(14, 0, 0),
  ];

  return {
    colliders, bounds: B, spawns, ffaSpawns,
    update(t) { for (const f of animated) f(t); },
  };
}

/** Grid of walkable ground nodes linked where a body can walk straight between them. */
export function buildNavGraph(physics) {
  const nodes = [];
  const r = 0.45, h = 1.7;
  for (let x = -40; x <= 40; x += 3) {
    for (let z = -22; z <= 22; z += 3) {
      // Find the standing height (ground or a low platform like the plaza).
      let y = 0;
      for (const c of physics.colliders) {
        if (x > c.min.x && x < c.max.x && z > c.min.z && z < c.max.z && c.max.y <= 0.6 && c.min.y <= 0.01) y = Math.max(y, c.max.y);
      }
      const p = new THREE.Vector3(x, y + 0.01, z);
      if (!physics.overlaps(p, r, h)) nodes.push({ p, n: [] });
    }
  }
  const probe = new THREE.Vector3();
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i].p, b = nodes[j].p;
      const d = a.distanceTo(b);
      if (d > 4.3) continue;
      let ok = true;
      for (let k = 1; k < 6 && ok; k++) {
        probe.lerpVectors(a, b, k / 6);
        probe.y = Math.max(a.y, b.y);
        if (physics.overlaps(probe, r, h)) ok = false;
      }
      if (ok) { nodes[i].n.push(j); nodes[j].n.push(i); }
    }
  }
  return nodes;
}
