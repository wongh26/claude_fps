// Pooled visual effects: bullet tracers, impact sparks, blink trails and explosions.
import * as THREE from 'three';
import { glowTexture } from './models.js';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.tracerGeo = new THREE.BoxGeometry(0.025, 0.025, 1);
    this.tracerGeo.translate(0, 0, -0.5);
    // One persistent light for explosions: adding/removing lights would force shader recompiles.
    this.boomLight = new THREE.PointLight(0x9ff6ff, 0, 16, 2);
    scene.add(this.boomLight);
    this.boomT = 0;
  }

  _add(obj, life, tick) {
    this.scene.add(obj);
    this.items.push({ obj, life, max: life, tick });
  }

  tracer(from, to, color = 0x9ff6ff) {
    const m = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({
      color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(1, 1, from.distanceTo(to));
    this._add(m, 0.07, (it, f) => { m.material.opacity = f; });
  }

  spark(at, color = 0xffffff, size = 0.35) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    s.position.copy(at);
    s.scale.setScalar(size);
    this._add(s, 0.12, (it, f) => { s.material.opacity = f; s.scale.setScalar(size * (1.5 - f * 0.5)); });
  }

  /** Ghostly streak along a blink path plus a flash at each end. */
  blink(from, to, color = 0x6ff3ff) {
    const a = from.clone(), b = to.clone();
    a.y += 1; b.y += 1;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1, 10, 1, true), new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    m.position.lerpVectors(a, b, 0.5);
    m.scale.set(1, a.distanceTo(b), 1);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this._add(m, 0.3, (it, f) => { m.material.opacity = 0.5 * f; m.scale.x = m.scale.z = f; });
    this.spark(a, color, 1.6);
    this.spark(b, color, 1.6);
  }

  explosion(at, radius) {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({
      color: 0x9ff6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sphere.position.copy(at);
    this._add(sphere, 0.45, (it, f) => { sphere.scale.setScalar(radius * (1.15 - f * 0.9)); sphere.material.opacity = f; });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 8, 40), new THREE.MeshBasicMaterial({
      color: 0xffc94a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    ring.position.copy(at); ring.rotation.x = Math.PI / 2;
    this._add(ring, 0.5, (it, f) => { ring.scale.setScalar(radius * 1.4 * (1 - f) + 0.2); ring.material.opacity = f; });
    this.boomLight.position.copy(at);
    this.boomT = 0.35;
  }

  update(dt) {
    this.boomT = Math.max(0, this.boomT - dt);
    this.boomLight.intensity = 40 * (this.boomT / 0.35);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      if (it.life <= 0) {
        this.scene.remove(it.obj);
        it.obj.material?.dispose?.();
        if (it.obj.geometry && it.obj.geometry !== this.tracerGeo) it.obj.geometry.dispose();
        this.items.splice(i, 1);
      } else it.tick(it, it.life / it.max);
    }
  }
}

/** Visual for a Tick Charge: glowing core with a blinking light. */
export function makeBombMesh() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.3 })));
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), new THREE.MeshBasicMaterial({ color: 0x6ff3ff }));
  core.position.z = -0.08; g.add(core);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x6ff3ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  halo.scale.setScalar(0.9); g.add(halo);
  g.userData.halo = halo;
  return g;
}
