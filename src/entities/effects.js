import * as THREE from 'three';
import { toonMat, addOutline, outlineMat, INK } from '../core/toon.js';
import { rand } from '../core/utils.js';

const MAX_PARTICLES = 700;

/** Pooled visual effects: particles, tracers, flashes, explosions, rings and debris. */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    // Particles: one instanced mesh of little cubes
    const pg = new THREE.BoxGeometry(1, 1, 1);
    this.pMesh = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_PARTICLES);
    this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pMesh.frustumCulled = false;
    this.pMesh.setColorAt(0, new THREE.Color(0xffffff));
    this.pMesh.count = 0;
    scene.add(this.pMesh);
    this.particles = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();

    this.tracers = [];
    this.tracerPool = [];
    this.flashPool = [];
    this.tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    this.tracerGeo.translate(0, 0, -0.5);
    this.flashes = [];
    this.flashGeo = new THREE.SphereGeometry(1, 12, 8);
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.9, 1, 48);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.debris = [];
    this.meshFx = [];
  }

  // ------------------------------------------------------------------ particles
  burst(pos, { count = 10, color = 0xffffff, speed = 6, size = 0.08, life = 0.6, gravity = 18, normal = null, spread = 1, drag = 1.5 } = {}) {
    const colors = Array.isArray(color) ? color : [color];
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const v = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
      if (normal) v.multiplyScalar(spread).add(normal).normalize();
      v.multiplyScalar(speed * rand(0.4, 1));
      this.particles.push({
        pos: pos.clone(),
        vel: v,
        life: life * rand(0.6, 1),
        max: life,
        size: size * rand(0.6, 1.3),
        color: colors[Math.floor(Math.random() * colors.length)],
        gravity,
        drag,
        rot: rand(0, 6),
      });
    }
  }

  // ------------------------------------------------------------------ tracers
  /** Pooled unlit mesh (tracers, flashes) so rapid fire doesn't allocate materials. */
  pooled(pool, geo, color) {
    let m = pool.pop();
    if (!m) m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    m.material.color.setHex(color);
    m.material.opacity = 1;
    m.rotation.set(0, 0, 0);
    this.scene.add(m);
    return m;
  }

  tracer(from, to, { color = 0xfff2a8, width = 0.035, life = 0.08 } = {}) {
    const m = this.pooled(this.tracerPool, this.tracerGeo, color);
    const len = from.distanceTo(to);
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(width, width, len);
    this.scene.add(m);
    this.tracers.push({ mesh: m, life, max: life, width });
  }

  lightning(from, to, { color = 0xa8e8ff, segments = 8, jitter = 0.6, life = 0.18 } = {}) {
    let prev = from.clone();
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const p = from.clone().lerp(to, t);
      if (i < segments) p.add(new THREE.Vector3(rand(-jitter, jitter), rand(-jitter, jitter), rand(-jitter, jitter)));
      this.tracer(prev, p, { color, width: 0.06, life });
      this.tracer(prev, p, { color: 0xffffff, width: 0.025, life });
      prev = p;
    }
  }

  // ------------------------------------------------------------------ flashes / explosions
  flash(pos, { color = 0xfff2a8, size = 0.25, life = 0.06, grow = 1.5 } = {}) {
    const m = this.pooled(this.flashPool, this.flashGeo, color);
    m.position.copy(pos);
    m.scale.setScalar(size);
    this.scene.add(m);
    this.flashes.push({ mesh: m, life, max: life, size, grow });
  }

  explosion(pos, radius = 5, { color = 0xff9f1c, core = 0xfff3b0 } = {}) {
    // Toon fireball with ink outline
    const mat = toonMat(color, { unique: true, transparent: true });
    const m = new THREE.Mesh(this.flashGeo, mat);
    const om = outlineMat({ thickness: 0.06, opacity: 1 });
    om.transparent = true;
    const o = new THREE.Mesh(this.flashGeo, om);
    m.add(o);
    m.position.copy(pos);
    m.scale.setScalar(0.2);
    this.scene.add(m);
    this.meshFx.push({
      mesh: m,
      life: 0.55,
      max: 0.55,
      update: (fx, k) => {
        const s = radius * (0.35 + 0.65 * Math.sqrt(1 - k));
        fx.mesh.scale.setScalar(s * 0.8);
        mat.opacity = Math.min(1, k * 2.2);
        om.uniforms.opacity.value = Math.min(1, k * 2.2);
      },
      dispose: () => {
        mat.dispose();
        om.dispose();
      },
    });
    this.flash(pos, { color: core, size: radius * 0.45, life: 0.12, grow: 1.4 });
    this.ring(pos, { color: 0xffffff, radius: radius * 1.1, life: 0.35 });
    this.burst(pos, { count: 36, color: [0xff9f1c, 0xffd23f, 0x3d3d3d, INK], speed: radius * 3, size: 0.18, life: 0.9, gravity: 10 });
  }

  ring(pos, { color = 0xffffff, radius = 4, life = 0.4, y = 0.08, fill = false } = {}) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(fill ? new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2) : this.ringGeo, mat);
    m.position.set(pos.x, pos.y + y, pos.z);
    m.scale.setScalar(0.1);
    this.scene.add(m);
    this.rings.push({ mesh: m, life, max: life, radius, owned: fill });
  }

  /** Persistent marker the caller controls; returns {mesh, remove()} */
  marker(pos, radius, color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(this.ringGeo, mat);
    ring.scale.setScalar(radius);
    const fillMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 40).rotateX(-Math.PI / 2), fillMat);
    g.add(ring, disc);
    g.position.copy(pos);
    g.position.y += 0.07;
    this.scene.add(g);
    return {
      group: g,
      ring,
      set: (p) => g.position.set(p.x, p.y + 0.07, p.z),
      remove: () => {
        this.scene.remove(g);
        mat.dispose();
        fillMat.dispose();
        disc.geometry.dispose();
      },
    };
  }

  addDebris(list, life = 2.6) {
    for (const d of list) {
      d.life = life + rand(0, 0.6);
      d.max = d.life;
      this.debris.push(d);
    }
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    // particles
    const ps = this.particles;
    let n = 0;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        ps.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.03) {
        p.pos.y = 0.03;
        p.vel.y *= -0.3;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
      }
      p.rot += dt * 8;
    }
    for (let i = 0; i < ps.length && n < MAX_PARTICLES; i++) {
      const p = ps[i];
      const s = p.size * Math.min(1, (p.life / p.max) * 2);
      this._e.set(p.rot, p.rot * 0.7, 0);
      this._q.setFromEuler(this._e);
      this._s.set(s, s, s);
      this._m.compose(p.pos, this._q, this._s);
      this.pMesh.setMatrixAt(n, this._m);
      this.pMesh.setColorAt(n, this._c.setHex(p.color));
      n++;
    }
    this.pMesh.count = n;
    this.pMesh.instanceMatrix.needsUpdate = true;
    if (this.pMesh.instanceColor) this.pMesh.instanceColor.needsUpdate = true;

    // tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      const k = Math.max(0, t.life / t.max);
      t.mesh.material.opacity = k;
      t.mesh.scale.x = t.mesh.scale.y = t.width * (0.4 + 0.6 * k);
      if (t.life <= 0) {
        this.scene.remove(t.mesh);
        this.tracerPool.push(t.mesh);
        this.tracers.splice(i, 1);
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      const k = Math.max(0, f.life / f.max);
      f.mesh.material.opacity = k;
      f.mesh.scale.setScalar(f.size * (1 + (1 - k) * (f.grow - 1)));
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        this.flashPool.push(f.mesh);
        this.flashes.splice(i, 1);
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const k = Math.max(0, r.life / r.max);
      r.mesh.scale.setScalar(Math.max(0.01, r.radius * (1 - k * k)));
      r.mesh.material.opacity = k;
      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        r.mesh.material.dispose();
        if (r.owned) r.mesh.geometry.dispose();
        this.rings.splice(i, 1);
      }
    }

    for (let i = this.meshFx.length - 1; i >= 0; i--) {
      const f = this.meshFx[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        if (f.dispose) f.dispose();
        this.meshFx.splice(i, 1);
        continue;
      }
      f.update(f, f.life / f.max, dt);
    }

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        this.debris.splice(i, 1);
        continue;
      }
      d.vel.y -= 22 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      if (d.mesh.position.y < 0.08) {
        d.mesh.position.y = 0.08;
        d.vel.y = Math.abs(d.vel.y) * 0.35;
        d.vel.x *= 0.6;
        d.vel.z *= 0.6;
        d.spin.multiplyScalar(0.6);
      }
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      if (d.life < 0.5) d.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 5));
    }
  }

  clear() {
    for (const t of this.tracers) {
      this.scene.remove(t.mesh);
      this.tracerPool.push(t.mesh);
    }
    for (const f of this.flashes) {
      this.scene.remove(f.mesh);
      this.flashPool.push(f.mesh);
    }
    for (const r of this.rings) this.scene.remove(r.mesh);
    for (const f of this.meshFx) this.scene.remove(f.mesh);
    for (const d of this.debris) this.scene.remove(d.mesh);
    this.tracers = [];
    this.flashes = [];
    this.rings = [];
    this.meshFx = [];
    this.debris = [];
    this.particles = [];
  }
}

export { addOutline };
