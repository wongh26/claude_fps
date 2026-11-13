// First-person view: two machine pistols held low in the bottom corners of the screen.
// Drawn in its own scene after the world (depth cleared) so the guns never clip into walls.
import * as THREE from 'three';
import { makePistol, mat, rbox, mesh, glowTexture } from './models.js';
import { clamp, damp } from './util.js';

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xdff0ff, 0xf0d2a8, 1.3));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
    key.position.set(0.6, 1, 0.4); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ff6ff, 0.9);
    rim.position.set(-0.8, 0.3, -1); this.scene.add(rim);
    this.flashLight = new THREE.PointLight(0x9ff6ff, 0, 1.2, 2);
    this.scene.add(this.flashLight);

    this.guns = [this.makeArm(-1), this.makeArm(1)]; // index 0 = left, 1 = right
    this.t = 0; this.phase = 0;
    this.sway = new THREE.Vector2();
    this.visible = true;
  }

  makeArm(side) {
    const base = new THREE.Group();
    base.position.set(0.21 * side, -0.25, -0.5);
    base.scale.setScalar(0.88);
    base.rotation.set(0.02, 0.07 * side, -0.06 * side);
    const pivot = new THREE.Group(); base.add(pivot);   // animated (recoil, reload spin)
    const gun = makePistol(); pivot.add(gun);

    const glove = mat(0x2b2a33, { rough: 0.8 });
    const sleeve = mat(0x2f3a6b, { rough: 0.7 });
    const cuff = mat(0xffc94a, { rough: 0.35 });
    pivot.add(mesh(rbox(0.085, 0.1, 0.1, 0.035), glove, 0, -0.04, 0.01, false));        // fist on grip
    pivot.add(mesh(rbox(0.07, 0.035, 0.06, 0.015), glove, -0.012 * side, 0.0, -0.05, false)); // trigger finger
    const thumb = mesh(rbox(0.03, 0.03, 0.07, 0.012), glove, -0.045 * side, 0.03, -0.02, false);
    thumb.rotation.y = 0.3 * side; pivot.add(thumb);
    const wrist = mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 14), cuff, 0, -0.07, 0.08, false);
    wrist.rotation.x = Math.PI / 2 - 0.5; pivot.add(wrist);
    const arm = mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.6, 14), sleeve, 0.03 * side, -0.2, 0.36, false);
    arm.rotation.x = Math.PI / 2 - 0.5; pivot.add(arm);
    const stripe = mesh(new THREE.CylinderGeometry(0.058, 0.06, 0.03, 14), mat(0x35e0e8, { emissive: 0x35e0e8, ei: 1.5 }), 0.012 * side, -0.115, 0.2, false);
    stripe.rotation.x = Math.PI / 2 - 0.5; pivot.add(stripe);

    const flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xaef8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    flash.position.copy(gun.userData.muzzle).add(new THREE.Vector3(0, 0, -0.03));
    flash.visible = false; pivot.add(flash);

    this.scene.add(base);
    return { base, pivot, gun, flash, side, recoil: 0, flashT: 0, home: base.position.clone() };
  }

  setAspect(a) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  /** side: -1 = left gun, 1 = right gun */
  shot(side) {
    const g = this.guns[side < 0 ? 0 : 1];
    g.recoil = Math.min(1, g.recoil + 0.55);
    g.flashT = 0.04;
    g.flash.material.rotation = Math.random() * Math.PI;
    g.flash.scale.setScalar(0.1 + Math.random() * 0.06);
    this.flashLight.position.set(0.2 * side, -0.12, -0.75);
    this.flashLight.intensity = 3;
  }

  /** Approximate world-space muzzle position of a gun, for drawing tracers. */
  muzzleWorld(side, worldCamera, out = new THREE.Vector3()) {
    const g = this.guns[side < 0 ? 0 : 1];
    g.base.updateMatrixWorld(true);
    out.copy(g.gun.userData.muzzle);
    g.gun.localToWorld(out);   // in view-model camera space (camera sits at the origin)
    out.z *= 1.6; out.x *= 1.25; out.y *= 1.25; // scale out to compensate for the different FOV/near plane
    return worldCamera.localToWorld(out);
  }

  update(dt, s) {
    this.t += dt;
    const k = s.onGround ? clamp(s.speed / 6.4, 0, 1) : 0;
    this.phase += dt * (4 + 7 * k);
    this.sway.x = damp(this.sway.x, clamp(-s.lookDX * 0.0009, -0.05, 0.05), 10, dt);
    this.sway.y = damp(this.sway.y, clamp(s.lookDY * 0.0009, -0.04, 0.04), 10, dt);
    const fall = s.onGround ? 0 : clamp(-s.vy * 0.004, -0.03, 0.03);
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 60);

    for (const g of this.guns) {
      g.base.visible = s.alive;
      const bobX = Math.sin(this.phase) * 0.012 * k * g.side;
      const bobY = -Math.abs(Math.cos(this.phase)) * 0.016 * k + Math.sin(this.t * 1.7) * 0.003;
      g.recoil = Math.max(0, g.recoil - dt * 9);
      g.base.position.set(
        g.home.x + bobX + this.sway.x,
        g.home.y + bobY + this.sway.y + fall - (s.rewinding ? 0.06 : 0),
        g.home.z + g.recoil * 0.05 + (s.blinkFx > 0 ? s.blinkFx * 0.25 : 0),
      );
      // Reload: dip the guns and spin them once.
      let rx = g.recoil * 0.16, ry = 0, rz = 0;
      if (s.reload > 0) {
        const p = s.reload;
        g.base.position.y -= Math.sin(p * Math.PI) * 0.12;
        rx += -p * Math.PI * 2;
        rz = Math.sin(p * Math.PI) * 0.4 * g.side;
      }
      if (s.rewinding) { rz += Math.sin(this.t * 30) * 0.05; ry = 0.25 * g.side; }
      g.pivot.rotation.set(rx, ry, rz);
      g.flashT -= dt;
      g.flash.visible = g.flashT > 0;
    }
  }

  render(renderer) {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
