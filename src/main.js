// Riftline: game bootstrap, match flow, combat resolution, networking glue and HUD.
import * as THREE from 'three';
import { buildWorld, buildNavGraph, TEAM_COLORS } from './world.js';
import { Physics } from './physics.js';
import { Fighter, HERO } from './fighter.js';
import { ViewModel } from './viewmodel.js';
import { Effects, makeBombMesh } from './fx.js';
import { BotBrain } from './bots.js';
import { Net } from './net.js';
import { makeHeroModel, animateHero } from './models.js';
import { initAudio, play } from './audio.js';
import { $, clamp, lerp, damp, spreadDir, rayAABB, makeCode, store, pick } from './util.js';

const SCORE_TO_WIN = 10;
const RESPAWN = 3;
const SNAP_RATE = 1 / 20;
const INTERP_DELAY = 100; // ms
const BOT_NAMES = ['Kestrel', 'Nimbus', 'Sable', 'Juno', 'Quill'];

// ---------------------------------------------------------------- renderer & scene
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 1200);
camera.rotation.order = 'YXZ';
scene.add(camera);
const world = buildWorld(scene);
const physics = new Physics(world.colliders, world.bounds);
const nav = buildNavGraph(physics);
const fx = new Effects(scene);
const vm = new ViewModel();

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  vm.setAspect(w / h);
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- settings
const settings = { sens: +(store('rl.sens') || 1), invert: store('rl.invert') === '1' };
$('sens').value = settings.sens; $('sensVal').textContent = settings.sens.toFixed(2);
$('invertY').checked = settings.invert;
$('sens').addEventListener('input', (e) => { settings.sens = +e.target.value; $('sensVal').textContent = settings.sens.toFixed(2); store('rl.sens', settings.sens); });
$('invertY').addEventListener('change', (e) => { settings.invert = e.target.checked; store('rl.invert', settings.invert ? '1' : '0'); });

// ---------------------------------------------------------------- game state
const G = {
  mode: 'menu',           // 'menu' | 'practice' | 'online'
  running: false,         // simulation active
  paused: false,
  over: false,
  player: null,
  actors: [],             // everyone who can be shot: player, bots, remote
  bots: [],               // {f, brain}
  remote: null,           // RemoteFighter
  bombs: [],
  time: 0,
  fovKick: 0,
  snapAcc: 0,
  nextBombId: 1,
};
const net = new Net();
const LOCAL_TEST = new URLSearchParams(location.search).has('local');

// ---------------------------------------------------------------- remote opponent (online)
class RemoteFighter {
  constructor(name, team) {
    this.id = 'remote'; this.name = name; this.team = team; this.isRemote = true;
    this.r = HERO.r; this.h = HERO.h; this.H = HERO;
    this.pos = new THREE.Vector3(0, -50, 0); this.yaw = 0; this.pitch = 0;
    this.alive = false; this.hp = HERO.hp; this.rewinding = false; this.onGround = true;
    this.speed = 0; this.kills = 0; this.deaths = 0; this.ult = 0;
    this.buf = [];
    this.bomb = null; // {mesh}
  }
  push(s) {
    this.buf.push({ ...s, at: performance.now() });
    if (this.buf.length > 30) this.buf.shift();
  }
  sample() {
    const t = performance.now() - INTERP_DELAY;
    const b = this.buf;
    if (!b.length) return;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].at > t) i--;
    const s1 = b[i], s0 = b[Math.max(0, i - 1)];
    const k = s1.at === s0.at ? 1 : clamp((t - s0.at) / (s1.at - s0.at), 0, 1);
    const prev = this.pos.clone();
    this.pos.set(lerp(s0.p[0], s1.p[0], k), lerp(s0.p[1], s1.p[1], k), lerp(s0.p[2], s1.p[2], k));
    let dy = s1.y - s0.y;
    if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw = s0.y + dy * k;
    this.pitch = lerp(s0.pi, s1.pi, k);
    this.hp = s1.hp; this.alive = !!s1.a; this.rewinding = !!s1.rw; this.onGround = !!s1.g;
    this.ult = s1.u ?? 0;
    this.speed = Math.hypot(this.pos.x - prev.x, this.pos.z - prev.z) / Math.max(1e-3, G.dt);
    this.bombPos = s1.b || null;
  }
}

// ---------------------------------------------------------------- character visuals (third person)
function attachModel(a) {
  a.model = makeHeroModel(TEAM_COLORS[a.team]);
  scene.add(a.model);
  a.plate = makeNameplate(a);
  scene.add(a.plate.sprite);
}
function removeModel(a) {
  if (a.model) scene.remove(a.model);
  if (a.plate) { scene.remove(a.plate.sprite); a.plate.tex.dispose(); }
  a.model = a.plate = null;
}
function makeNameplate(a) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1); sprite.renderOrder = 10;
  const plate = { c, tex, sprite, hp: -1 };
  plate.draw = () => {
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 64);
    g.font = 'bold italic 24px Segoe UI, system-ui, sans-serif'; g.textAlign = 'center';
    g.fillStyle = '#000a'; g.fillText(a.name.toUpperCase(), 129, 27);
    g.fillStyle = '#fff'; g.fillText(a.name.toUpperCase(), 128, 26);
    g.fillStyle = '#0009'; g.fillRect(38, 38, 180, 14);
    const f = clamp(a.hp / HERO.hp, 0, 1);
    g.fillStyle = f < 0.35 ? '#ff4d5e' : '#ff7a4d'; g.fillRect(40, 40, 176 * f, 10);
    tex.needsUpdate = true;
  };
  return plate;
}
function updateModel(a, dt) {
  const m = a.model;
  if (!m) return;
  const show = a.alive && !a.rewinding;
  m.visible = show; a.plate.sprite.visible = show;
  if (!show) {
    if (a.alive && a.rewinding && Math.random() < dt * 30) fx.spark(a.pos.clone().add(new THREE.Vector3(0, 1, 0)), 0x6ff3ff, 0.8);
    return;
  }
  m.position.copy(a.pos);
  m.rotation.y = a.yaw;
  const sp = a.isRemote ? a.speed : Math.hypot(a.vel.x, a.vel.z);
  animateHero(m, sp, a.onGround, G.time, a.pitch);
  a.plate.sprite.position.set(a.pos.x, a.pos.y + 2.25, a.pos.z);
  if (Math.round(a.hp) !== a.plate.hp) { a.plate.hp = Math.round(a.hp); a.plate.draw(); }
}

// ---------------------------------------------------------------- combat
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

/** Ray vs a character: chest box and head box. */
function hitActor(o, d, a, maxT) {
  const p = a.pos, r = 0.4, top = a.h;
  const tb = rayAABB(o, d, v1.set(p.x - r, p.y, p.z - r), v2.set(p.x + r, p.y + top - 0.32, p.z + r), maxT);
  const th = rayAABB(o, d, v1.set(p.x - 0.2, p.y + top - 0.34, p.z - 0.2), v2.set(p.x + 0.2, p.y + top + 0.04, p.z + 0.2), maxT);
  if (th < Infinity && th <= tb + 0.05) return { t: th, head: true };
  if (tb < Infinity) return { t: tb, head: false };
  return null;
}

const enemiesOf = (f) => G.actors.filter((a) => a !== f && a.team !== f.team && a.alive && !a.rewinding);

function gunMuzzle(f, side, out) {
  if (f === G.player) return vm.muzzleWorld(side, camera, out);
  const s = Math.sin(f.yaw), c = Math.cos(f.yaw);
  return out.set(f.pos.x - s * 0.55 + c * 0.22 * side, f.pos.y + 1.3, f.pos.z - c * 0.55 - s * 0.22 * side);
}

function falloff(t) {
  if (t <= HERO.falloffNear) return 1;
  if (t >= HERO.falloffFar) return HERO.falloffMin;
  return lerp(1, HERO.falloffMin, (t - HERO.falloffNear) / (HERO.falloffFar - HERO.falloffNear));
}

function fireShot(f, side) {
  const o = f.eyePos(new THREE.Vector3());
  const d = spreadDir(f.aimDir(v3), HERO.spread, new THREE.Vector3());
  let t = physics.ray(o, d, 80);
  let target = null, head = false;
  for (const a of enemiesOf(f)) {
    const h = hitActor(o, d, a, t);
    if (h && h.t < t) { t = h.t; target = a; head = h.head; }
  }
  const end = o.clone().addScaledVector(d, t);
  const from = gunMuzzle(f, side, new THREE.Vector3());
  fx.tracer(from, end, f === G.player ? 0x9ff6ff : 0xffb27a);
  if (t < 80) fx.spark(end, target ? 0xffffff : 0xfff1c4, target ? 0.45 : 0.3);
  if (f === G.player) {
    vm.shot(side); play('shot', 1);
    if (G.mode === 'online') net.send({ t: 'shot', o: from.toArray().map(r2), e: end.toArray().map(r2) });
  } else play('shot', soundVol(f.pos));
  if (target) applyHit(f, target, HERO.dmg * falloff(t) * (head ? HERO.headMult : 1), head);
}
const r2 = (n) => Math.round(n * 100) / 100;

function applyHit(attacker, target, dmg, head) {
  if (attacker === G.player) {
    attacker.addUlt(dmg);
    hitMarker(false);
    play(head ? 'head' : 'hit');
  } else if (attacker.addUlt) attacker.addUlt(dmg);

  if (target.isRemote) { // the opponent's own client applies damage to them
    net.send({ t: 'hit', d: r2(dmg), h: head ? 1 : 0 });
    return;
  }
  const killed = target.takeDamage(dmg);
  if (target === G.player) { hurtFlash(); play('hurt'); }
  if (killed) onKill(attacker, target);
}

function onKill(killer, victim) {
  victim.deaths++; killer.kills++;
  victim.respawnT = RESPAWN;
  feed(killer, victim);
  fx.spark(victim.pos.clone().add(new THREE.Vector3(0, 1, 0)), 0xffffff, 2);
  if (killer === G.player) { hitMarker(true); play('kill'); callout('ELIMINATED ' + victim.name.toUpperCase(), '#fff'); }
  if (victim === G.player) {
    $('dead').hidden = false; $('deadBy').textContent = 'by ' + killer.name;
    if (G.mode === 'online') net.send({ t: 'died' });
  }
  updateScore();
  checkWin();
}

function checkWin() {
  // Online, the host is the referee so both screens always agree on the result.
  if (G.mode === 'online' && !net.isHost) return;
  const mine = G.player.kills;
  const theirs = G.mode === 'online' ? (G.remote?.kills ?? 0) : G.bots.reduce((s, b) => s + b.f.kills, 0);
  const done = mine >= SCORE_TO_WIN || theirs >= SCORE_TO_WIN;
  if (!done) return;
  if (G.mode === 'online') net.send({ t: 'end', a: mine, b: theirs }); // host's score first
  endMatch(mine >= SCORE_TO_WIN, mine, theirs);
}

// ---------------------------------------------------------------- Tick Charge (ultimate)
function throwBomb(f) {
  const o = f.eyePos(new THREE.Vector3());
  const d = f.aimDir(new THREE.Vector3());
  const b = {
    id: G.nextBombId++, owner: f, pos: o.addScaledVector(d, 0.5),
    vel: d.multiplyScalar(HERO.bomb.speed).add(new THREE.Vector3(0, 2.5, 0)),
    stuck: null, offset: new THREE.Vector3(), fuse: HERO.bomb.fuse, life: HERO.bomb.life, tickAcc: 0,
    mesh: makeBombMesh(),
  };
  b.mesh.position.copy(b.pos);
  scene.add(b.mesh);
  G.bombs.push(b);
  play('throw', f === G.player ? 1 : soundVol(f.pos));
  if (f === G.player) callout('TICK CHARGE OUT', '#6ff3ff');
}

function updateBombs(dt) {
  for (let i = G.bombs.length - 1; i >= 0; i--) {
    const b = G.bombs[i];
    b.life -= dt;
    if (!b.stuck) {
      b.vel.y -= 14 * dt;
      const step = b.vel.length() * dt;
      const dir = v3.copy(b.vel).normalize();
      const tWorld = physics.ray(b.pos, dir, step + 0.12);
      let hitA = null;
      for (const a of enemiesOf(b.owner)) {
        const cx = a.pos.x - b.pos.x, cy = a.pos.y + 1.0 - b.pos.y, cz = a.pos.z - b.pos.z;
        const along = clamp(cx * dir.x + cy * dir.y + cz * dir.z, 0, step);
        const px = cx - dir.x * along, py = cy - dir.y * along, pz = cz - dir.z * along;
        if (Math.abs(py) < 1.0 && Math.hypot(px, pz) < 0.6) { hitA = a; break; }
      }
      if (hitA) {
        b.stuck = hitA; b.offset.set(rnd(-0.15, 0.15), 1.1, rnd(-0.15, 0.15));
        play('stick', 1);
        if (b.owner === G.player) callout('STUCK!', '#ffc94a');
        if (hitA === G.player) callout('YOU HAVE BEEN STUCK!', '#ff4d5e');
        if (hitA.isRemote) net.send({ t: 'stuck' });
      } else if (tWorld < step + 0.12) {
        b.pos.addScaledVector(dir, Math.max(0, tWorld - 0.1));
        b.stuck = 'world'; play('stick', soundVol(b.pos));
      } else b.pos.addScaledVector(dir, step);
    }
    if (b.stuck && b.stuck !== 'world') {
      if (b.stuck.alive) b.pos.copy(b.stuck.pos).add(b.offset);
      else b.stuck = 'world';
    }
    if (b.stuck) {
      b.fuse -= dt;
      b.tickAcc += dt;
      if (b.tickAcc > 0.2) { b.tickAcc = 0; play('tick', soundVol(b.pos)); }
    }
    b.mesh.position.copy(b.pos);
    b.mesh.userData.halo.scale.setScalar(0.6 + Math.abs(Math.sin(G.time * 18)) * 0.6);
    if (b.fuse <= 0 || b.life <= 0) {
      detonate(b);
      scene.remove(b.mesh);
      G.bombs.splice(i, 1);
    }
  }
}
const rnd = (a, b) => a + Math.random() * (b - a);

function detonate(b) {
  const B = HERO.bomb;
  fx.explosion(b.pos, B.radius);
  play('boom', soundVol(b.pos));
  if (b.owner === G.player && G.mode === 'online') net.send({ t: 'boom', p: b.pos.toArray().map(r2) });
  if (b.owner.isRemote) return; // damage from a remote bomb is applied by its owner via 'hit' messages
  for (const a of enemiesOf(b.owner)) {
    const c = v1.set(a.pos.x, a.pos.y + 0.9, a.pos.z);
    const d = c.distanceTo(b.pos);
    let dmg = 0;
    if (a === b.stuck) dmg = B.dmg;
    else if (d < B.radius && physics.lineOfSight(b.pos, c)) dmg = B.dmg * (1 - 0.7 * d / B.radius);
    if (dmg > 0) applyHit(b.owner, a, dmg, false);
  }
}

// Shadow copy of the opponent's bomb, driven by their snapshots.
function updateRemoteBomb() {
  const r = G.remote;
  if (!r) return;
  if (r.bombPos && !r.bomb) { r.bomb = makeBombMesh(); scene.add(r.bomb); }
  if (!r.bombPos && r.bomb) { scene.remove(r.bomb); r.bomb = null; }
  if (r.bomb) {
    r.bomb.position.fromArray(r.bombPos);
    r.bomb.userData.halo.scale.setScalar(0.6 + Math.abs(Math.sin(G.time * 18)) * 0.6);
  }
}

// ---------------------------------------------------------------- game callbacks used by Fighter
const gameApi = {
  physics,
  fireShot,
  throwBomb,
  sound: (name, f) => play(name, f === G.player ? 1 : soundVol(f.pos)),
  onBlink(f, from, to) {
    fx.blink(from, to);
    play('blink', f === G.player ? 1 : soundVol(f.pos));
    if (f === G.player) {
      G.fovKick = 9;
      flash('blinkFlash', 0.25);
      if (G.mode === 'online') net.send({ t: 'blink', a: from.toArray().map(r2), b: to.toArray().map(r2) });
    }
  },
  onRewind(f) {
    if (f === G.player && G.mode === 'online') net.send({ t: 'rewind' });
  },
};
function soundVol(p) { return clamp(1 - camera.position.distanceTo(p) / 45, 0, 1) * 0.8; }

// ---------------------------------------------------------------- spawning
function spawnPoint(f) {
  const foes = G.actors.filter((a) => a !== f && a.team !== f.team && a.alive);
  const pool = [...world.ffaSpawns, ...world.spawns[0], ...world.spawns[1]];
  let best = pool[0], bestD = -1;
  for (const p of pool) {
    let d = Infinity;
    for (const e of foes) d = Math.min(d, e.pos.distanceTo(p));
    d += Math.random() * 6; // a little variety
    if (d > bestD) { bestD = d; best = p; }
  }
  return best;
}
function respawn(f, at) {
  const ult = f.ult;
  f.reset();
  f.ult = ult;
  f.pos.copy(at || spawnPoint(f));
  // Face the middle of the map.
  f.yaw = Math.atan2(f.pos.x, f.pos.z); f.pitch = 0;
  if (f === G.player) $('dead').hidden = true;
}

// ---------------------------------------------------------------- match flow
function clearMatch() {
  for (const a of G.actors) removeModel(a);
  for (const b of G.bombs) scene.remove(b.mesh);
  if (G.remote?.bomb) scene.remove(G.remote.bomb);
  G.actors = []; G.bots = []; G.bombs = []; G.remote = null;
  $('feed').innerHTML = '';
  G.over = false;
}

function startPractice() {
  clearMatch();
  G.mode = 'practice';
  const n = +$('botCount').value, skill = $('botSkill').value;
  G.player = new Fighter({ id: 'you', name: 'You', team: 0, isLocal: true });
  G.actors.push(G.player);
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  for (let i = 0; i < n; i++) {
    const f = new Fighter({ id: 'bot' + i, name: names[i], team: 1, isBot: true });
    attachModel(f);
    G.actors.push(f);
    G.bots.push({ f, brain: new BotBrain(f, skill) });
  }
  respawn(G.player, pick(world.spawns[0]));
  for (const b of G.bots) respawn(b.f, world.spawns[1][G.bots.indexOf(b) % 3]);
  $('nameA').textContent = 'YOU'; $('nameB').textContent = n > 1 ? 'BOTS' : n === 1 ? G.bots[0].f.name.toUpperCase() : '';
  $('netTag').textContent = n ? 'PRACTICE · ' + skill.toUpperCase() : 'FREE ROAM · no bots';
  $('topbar').hidden = n === 0; // nothing to score against
  beginPlay();
}

function startOnline() {
  clearMatch();
  G.mode = 'online';
  const myTeam = net.isHost ? 0 : 1;
  G.player = new Fighter({ id: 'you', name: myName, team: myTeam, isLocal: true });
  G.remote = new RemoteFighter(oppName, 1 - myTeam);
  attachModel(G.remote);
  G.actors.push(G.player, G.remote);
  respawn(G.player, world.spawns[myTeam][0]);
  G.wantRematch = G.remoteRematch = false;
  $('nameA').textContent = myName.toUpperCase(); $('nameB').textContent = oppName.toUpperCase();
  $('topbar').hidden = false;
  G.netTag = 'ONLINE DUEL' + (G.roomCode ? ' · ROOM ' + G.roomCode : '');
  G.away = null;
  $('netTag').textContent = G.netTag;
  beginPlay();
}

function beginPlay() {
  $('menu').hidden = true; $('over').hidden = true; $('pause').hidden = true;
  $('hud').hidden = false;
  $('goalN').textContent = SCORE_TO_WIN;
  G.running = true; G.paused = false;
  G.startedAt = performance.now();
  updateScore();
  lockPointer();
  callout(G.mode === 'practice' && !G.bots.length ? 'FREE ROAM' : 'FIGHT!', '#ffc94a');
  // An online match can start from a network event, where the browser refuses mouse capture.
  // Ask for a click instead.
  setTimeout(() => {
    if (G.running && !locked() && !G.over) {
      G.paused = G.mode === 'practice';
      $('pauseNote').textContent = G.mode === 'online' ? 'Match started! Click to take control.' : '';
      $('btnResume').textContent = 'CLICK TO PLAY';
      $('pause').hidden = false;
    }
  }, 400);
}

function endMatch(win, a, b) {
  if (G.over) return;
  G.over = true;
  G.running = G.mode === 'online'; // keep receiving snapshots online
  document.exitPointerLock?.();
  $('overTitle').textContent = win ? 'VICTORY' : 'DEFEAT';
  $('overTitle').style.color = win ? 'var(--gold)' : 'var(--danger)';
  $('overScore').textContent = `${a} - ${b}`;
  $('overMsg').textContent = '';
  $('btnAgain').textContent = G.mode === 'online' ? 'REMATCH' : 'PLAY AGAIN';
  $('btnAgain').disabled = false;
  $('over').hidden = false;
}

function toMenu(msg = '') {
  G.running = false; G.mode = 'menu'; G.over = false;
  clearMatch();
  G.player = null;
  net.close();
  document.exitPointerLock?.();
  $('hud').hidden = true; $('over').hidden = true; $('pause').hidden = true;
  $('menu').hidden = false; $('lobby').hidden = true;
  setModeButtons(true);
  $('menuMsg').textContent = msg;
}

// ---------------------------------------------------------------- online lobby
let myName = 'Player', oppName = 'Rival';
function setModeButtons(on) { for (const id of ['btnPractice', 'btnHost', 'btnJoin']) $(id).disabled = !on; }

async function hostRoom() {
  initAudio();
  setModeButtons(false);
  $('menuMsg').textContent = 'Opening a room…';
  const code = makeCode();
  try {
    await net.host(code, LOCAL_TEST);
  } catch (e) { setModeButtons(true); $('menuMsg').textContent = e.message; net.close(); return; }
  G.roomCode = code;
  myName = 'Host'; oppName = 'Challenger';
  $('roomCode').textContent = code;
  const url = new URL(location.href);
  url.search = (LOCAL_TEST ? '?local&' : '?') + 'join=' + code;
  $('shareLink').value = url.toString();
  $('lobby').hidden = false; $('menuMsg').textContent = '';
  $('lobbyMsg').textContent = 'Waiting for your opponent to join…';
}

async function joinRoom(code) {
  initAudio();
  code = (code || '').trim().toUpperCase();
  if (code.length < 4) { $('menuMsg').textContent = 'Enter the room code your friend sent you.'; return; }
  setModeButtons(false);
  $('menuMsg').textContent = 'Connecting to room ' + code + '…';
  try {
    await net.join(code, LOCAL_TEST);
  } catch (e) { setModeButtons(true); $('menuMsg').textContent = e.message; net.close(); return; }
  G.roomCode = code;
  myName = 'Challenger'; oppName = 'Host';
  $('menuMsg').textContent = 'Connected! Waiting for the host…';
  net.send({ t: 'hello', v: 2 });
}

net.on('connected', () => {
  if (net.isHost) {
    $('lobbyMsg').textContent = 'Opponent connected. Starting…';
    net.send({ t: 'start' });
    setTimeout(startOnline, 150);
  }
});
net.on('joining', () => { if (!$('lobby').hidden) $('lobbyMsg').textContent = 'A player is connecting…'; });
net.on('joinFailed', (msg) => { if (net.isHost && !$('lobby').hidden) $('lobbyMsg').textContent = 'A player tried to join but it failed. Still waiting… (' + msg + ')'; });
net.on('lobbyError', (msg) => { if (!$('lobby').hidden) $('lobbyMsg').textContent = msg; });
net.on('disconnected', (reason) => {
  if (G.mode === 'online' || !$('lobby').hidden || net.isHost === false) toMenu(reason || 'Connection lost.');
});
net.on('msg', (m) => {
  const r = G.remote;
  switch (m.t) {
    case 'full': toMenu('That room already has two players.'); break;
    case 'start': startOnline(); break;
    case 's': if (r) r.push(m); break;
    case 'shot':
      if (!r) break;
      fx.tracer(new THREE.Vector3().fromArray(m.o), new THREE.Vector3().fromArray(m.e), 0xffb27a);
      fx.spark(new THREE.Vector3().fromArray(m.e), 0xfff1c4, 0.3);
      play('shot', soundVol(r.pos));
      break;
    case 'hit': {
      const p = G.player;
      if (!p || !p.alive || G.over) break;
      const dmg = clamp(+m.d || 0, 0, HERO.bomb.dmg);
      const killed = p.takeDamage(dmg);
      if (p.hp < HERO.hp) { hurtFlash(); play('hurt'); }
      if (killed) onKill(r, p);
      break;
    }
    case 'died':
      if (!r || G.over) break;
      r.deaths++; G.player.kills++;
      feed(G.player, r);
      hitMarker(true); play('kill'); callout('ELIMINATED ' + r.name.toUpperCase(), '#fff');
      updateScore(); checkWin();
      break;
    case 'blink': fx.blink(new THREE.Vector3().fromArray(m.a), new THREE.Vector3().fromArray(m.b)); play('blink', r ? soundVol(r.pos) : 0.5); break;
    case 'rewind': play('rewind'); break;
    case 'stuck': callout('YOU HAVE BEEN STUCK!', '#ff4d5e'); play('stick'); break;
    case 'boom': { const p = new THREE.Vector3().fromArray(m.p); fx.explosion(p, HERO.bomb.radius); play('boom', soundVol(p)); break; }
    case 'end': // from the host: its kills are `a`, ours are `b`
      if (!net.isHost && !G.over) {
        G.player.kills = +m.b || 0; if (r) r.kills = +m.a || 0;
        updateScore();
        endMatch(G.player.kills > (r?.kills ?? 0), G.player.kills, r?.kills ?? 0);
      }
      break;
    case 'rematch':
      G.remoteRematch = true;
      $('overMsg').textContent = oppName + ' wants a rematch!';
      if (net.isHost && G.wantRematch) { net.send({ t: 'start' }); startOnline(); }
      break;
  }
});

function sendSnapshot() {
  const p = G.player;
  const myBomb = G.bombs.find((b) => b.owner === p);
  net.send({
    t: 's', p: p.pos.toArray().map(r2), y: r2(p.yaw), pi: r2(p.pitch), hp: Math.round(p.hp),
    a: p.alive ? 1 : 0, rw: p.rewinding ? 1 : 0, g: p.onGround ? 1 : 0, u: r2(p.ult),
    b: myBomb ? myBomb.pos.toArray().map(r2) : null,
  });
}

// ---------------------------------------------------------------- input
const keys = new Set();
const look = { dx: 0, dy: 0 };
let mouseDown = false;
const locked = () => document.pointerLockElement === canvas;

function lockPointer() {
  const plain = () => { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* not allowed here */ } };
  try {
    const p = canvas.requestPointerLock?.({ unadjustedMovement: true });
    if (p?.catch) p.catch((e) => { if (e?.name === 'NotSupportedError') plain(); });
  } catch { plain(); }
}

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') { if (e.code === 'Enter' && e.target.id === 'joinCode') joinRoom(e.target.value); return; }
  keys.add(e.code);
  const p = G.player;
  if (!p || !G.running || G.paused || !p.alive || !locked()) return;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') p.input.blink = true;
  if (e.code === 'KeyE') p.input.rewind = true;
  if (e.code === 'KeyQ') p.input.ult = true;
  if (e.code === 'KeyR') p.input.reload = true;
  if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouseDown = false; });
canvas.addEventListener('mousedown', (e) => {
  if (!G.running || G.over) return;
  if (!locked()) { lockPointer(); return; }
  if (e.button === 0) mouseDown = true;
  if (e.button === 2 && G.player?.alive) G.player.input.blink = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
let lockedAt = 0;
addEventListener('mousemove', (e) => {
  if (!locked()) return;
  // Some browsers report one huge jump right after the pointer is captured: skip it.
  if (performance.now() - lockedAt < 120 || Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
  look.dx += e.movementX; look.dy += e.movementY;
});
document.addEventListener('pointerlockchange', () => {
  if (locked()) { lockedAt = performance.now(); $('pause').hidden = true; G.paused = false; $('nolock').hidden = true; return; }
  mouseDown = false;
  if (G.running && !G.over && G.mode !== 'menu') {
    G.paused = G.mode === 'practice';
    $('pauseNote').textContent = G.mode === 'online' ? 'The match keeps running while you are in this menu.' : '';
    $('btnResume').textContent = 'RESUME';
    $('pause').hidden = false;
  }
});
document.addEventListener('pointerlockerror', () => {
  if (window.top !== window) { $('nolock').hidden = false; return; }
  // Browsers refuse to re-capture the mouse for about a second after Esc.
  $('pauseNote').textContent = 'Click again to resume.';
});

function readInput(dt) {
  const p = G.player;
  if (!p) return;
  const inp = p.input;
  const canAct = locked() && !G.over;
  inp.fz = canAct ? (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) : 0;
  inp.fx = canAct ? (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) : 0;
  inp.jump = canAct && keys.has('Space');
  inp.fire = canAct && mouseDown;
  if (!p.rewinding) {
    const k = 0.004 * settings.sens; // radians per mouse count at sensitivity 1
    p.yaw -= look.dx * k;
    p.pitch = clamp(p.pitch - look.dy * k * (settings.invert ? -1 : 1), -1.5, 1.5);
  }
}

// ---------------------------------------------------------------- HUD
const hpBar = $('hpBar');
const HP_SEG = 25;
for (let i = 0; i < HERO.hp / HP_SEG; i++) hpBar.appendChild(document.createElement('i'));
const pips = [...$('pips').children];
let lastHud = '';

function updateHud() {
  const p = G.player;
  if (!p) return;
  const hp = Math.ceil(p.hp);
  const ammoTxt = p.reloadT > 0 ? '…' : p.ammo;
  const blinkCd = p.blinkCharges < HERO.blink.charges ? Math.ceil(HERO.blink.recharge - p.blinkRecharge) : 0;
  const key = [hp, ammoTxt, p.blinkCharges, blinkCd, Math.ceil(p.rewindCd), Math.floor(p.ult * 100)].join();
  if (key === lastHud) return;
  lastHud = key;
  $('hpNum').textContent = hp;
  [...hpBar.children].forEach((el, i) => el.style.setProperty('--f', clamp((hp - i * HP_SEG) / HP_SEG, 0, 1) * 100 + '%'));
  hpBar.classList.toggle('low', hp <= 50);
  $('ammoNum').textContent = ammoTxt;
  $('ammo').classList.toggle('low', p.ammo <= 8 && p.reloadT <= 0);
  pips.forEach((el, i) => el.classList.toggle('on', i < p.blinkCharges));
  const ab = $('abBlink');
  ab.classList.toggle('cool', p.blinkCharges === 0);
  ab.querySelector('.cd').textContent = p.blinkCharges === 0 ? blinkCd : '';
  ab.querySelector('.charges').textContent = p.blinkCharges;
  const rw = $('abRewind');
  rw.classList.toggle('cool', p.rewindCd > 0);
  rw.querySelector('.cd').textContent = p.rewindCd > 0 ? Math.ceil(p.rewindCd) : '';
  const pct = Math.floor(p.ult * 100);
  $('ultPct').textContent = pct + '%';
  $('ultArc').style.strokeDashoffset = 276.5 * (1 - p.ult);
  const ready = p.ult >= 1;
  if (ready && !$('ult').classList.contains('ready')) { play('ready'); callout('TICK CHARGE READY', '#ffc94a'); }
  $('ult').classList.toggle('ready', ready);
}

function updateScore() {
  if (!G.player) return;
  $('scoreA').textContent = G.player.kills;
  $('scoreB').textContent = G.mode === 'online' ? (G.remote?.kills ?? 0) : G.bots.reduce((s, b) => s + b.f.kills, 0);
}

function feed(killer, victim) {
  const el = document.createElement('div');
  const col = (a) => (a.team === G.player.team ? 'var(--you)' : 'var(--them)');
  el.innerHTML = `<span style="color:${col(killer)}">${esc(killer.name)}</span> ▸ <span style="color:${col(victim)}">${esc(victim.name)}</span>`;
  $('feed').prepend(el);
  while ($('feed').children.length > 5) $('feed').lastChild.remove();
  setTimeout(() => el.remove(), 6000);
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let calloutTimer = 0;
function callout(text, color) {
  const el = $('callout');
  el.textContent = text; el.style.color = color; el.style.opacity = 1;
  clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => (el.style.opacity = 0), 1300);
}
function flash(id, dur) {
  const el = $(id);
  el.style.transition = 'none'; el.style.opacity = 1;
  requestAnimationFrame(() => { el.style.transition = `opacity ${dur}s`; el.style.opacity = 0; });
}
function hurtFlash() { flash('hurt', 0.5); }
let hmTimer = 0;
function hitMarker(kill) {
  const el = $('hitmark');
  el.classList.toggle('kill', kill);
  el.style.transition = 'none'; el.style.opacity = 1;
  clearTimeout(hmTimer);
  hmTimer = setTimeout(() => { el.style.transition = 'opacity 0.15s'; el.style.opacity = 0; }, kill ? 260 : 90);
}

// ---------------------------------------------------------------- main loop
function simulate(dt) {
  const p = G.player;
  readInput(dt);
  look.dx = look.dy = 0;

  // Free roam (no bots): charge the ultimate quickly so it can be practised.
  if (G.mode === 'practice' && !G.bots.length) p.ult = Math.min(1, p.ult + dt / 15);
  if (p.alive) p.update(dt, gameApi);
  else if (!G.over) {
    p.respawnT -= dt;
    $('deadT').textContent = 'Respawning in ' + Math.max(0, p.respawnT).toFixed(1);
    if (p.respawnT <= 0) respawn(p);
  }

  for (const { f, brain } of G.bots) {
    if (!f.alive) { f.respawnT -= dt; if (f.respawnT <= 0 && !G.over) respawn(f); continue; }
    brain.update(dt, { physics, nav }, p);
    f.update(dt, gameApi);
  }
  if (G.remote) {
    G.remote.sample();
    // A background tab stops sending snapshots: say so instead of showing a frozen or missing rival.
    const lastSnap = G.remote.buf.length ? G.remote.buf[G.remote.buf.length - 1].at : G.startedAt;
    const away = performance.now() - lastSnap > 2000;
    if (away !== G.away) {
      G.away = away;
      $('netTag').textContent = G.netTag + (away ? ' · waiting for ' + oppName + ' (their game tab is in the background)' : '');
    }
  }
  updateBombs(dt);
  updateRemoteBomb();

  if (G.mode === 'online') {
    G.snapAcc += dt;
    if (G.snapAcc >= SNAP_RATE) { G.snapAcc = 0; sendSnapshot(); }
  }
}

function updateCamera(dt) {
  const p = G.player;
  if (!p) return;
  if (p.alive) {
    camera.position.set(p.pos.x, p.pos.y + HERO.eye, p.pos.z);
  } else {
    camera.position.y = damp(camera.position.y, p.pos.y + 4, 2, dt);
  }
  camera.rotation.set(p.pitch, p.yaw, 0);
  G.fovKick = damp(G.fovKick, 0, 6, dt);
  const fov = 72 + G.fovKick + (p.rewinding ? 6 : 0);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  $('fxTint').style.opacity = p.rewinding ? 1 : 0;
  canvas.style.filter = p.rewinding ? 'saturate(0.45) hue-rotate(-12deg) brightness(1.08)' : '';
  vm.update(dt, {
    alive: p.alive, speed: Math.hypot(p.vel.x, p.vel.z), onGround: p.onGround, vy: p.vel.y,
    lookDX: G.lastLook.dx, lookDY: G.lastLook.dy, reload: p.reloadT > 0 ? 1 - p.reloadT / HERO.reload : 0,
    rewinding: p.rewinding, blinkFx: p.blinkFx,
  });
}

let last = performance.now();
G.lastLook = { dx: 0, dy: 0 };
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  G.dt = dt; G.time += dt;
  world.update(G.time);

  if (G.running && G.player && !G.paused) {
    G.lastLook = { dx: look.dx, dy: look.dy };
    simulate(dt);
  } else { look.dx = look.dy = 0; G.lastLook = { dx: 0, dy: 0 }; }

  for (const a of G.actors) if (a !== G.player) updateModel(a, dt);
  fx.update(dt);

  if (G.player) {
    updateCamera(dt);
    updateHud();
  } else {
    // Attract mode: slow orbit over the plaza.
    const t = G.time * 0.06;
    camera.position.set(Math.cos(t) * 30, 13, Math.sin(t) * 22);
    camera.lookAt(0, 3, 0);
  }

  renderer.clear();
  renderer.render(scene, camera);
  if (G.player && G.running) vm.render(renderer);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- menu wiring
$('btnPractice').addEventListener('click', () => { initAudio(); startPractice(); });
$('btnHost').addEventListener('click', hostRoom);
$('btnJoin').addEventListener('click', () => joinRoom($('joinCode').value));
$('btnCancel').addEventListener('click', () => toMenu(''));
$('btnCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('shareLink').value); $('lobbyMsg').textContent = 'Link copied. Send it to your opponent.'; }
  catch { $('shareLink').select(); $('lobbyMsg').textContent = 'Press Ctrl+C to copy the link.'; }
});
$('btnResume').addEventListener('click', () => lockPointer());
$('btnQuit').addEventListener('click', () => toMenu(''));
$('btnMenu').addEventListener('click', () => toMenu(''));
$('btnAgain').addEventListener('click', () => {
  if (G.mode === 'practice') { startPractice(); return; }
  G.wantRematch = true;
  $('btnAgain').disabled = true;
  if (net.isHost && G.remoteRematch) { net.send({ t: 'start' }); startOnline(); }
  else { net.send({ t: 'rematch' }); $('overMsg').textContent = 'Waiting for ' + oppName + '…'; }
});
$('joinCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

if (!matchMedia('(pointer:fine)').matches) $('touchNote').hidden = false;
const qJoin = new URLSearchParams(location.search).get('join');
if (qJoin) { $('joinCode').value = qJoin.toUpperCase(); $('menuMsg').textContent = 'You were invited to room ' + qJoin.toUpperCase() + '. Press JOIN.'; }

// Test hook (used by automated checks; harmless in play).
window.__rl = { G, physics, nav, world, startPractice, net, updateBombs, enemiesOf, throwBomb, fireShot };
