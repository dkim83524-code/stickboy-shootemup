import * as THREE from 'three';
import { toonMat, addOutline } from '../core/toon.js';
import { TEAM_COLORS } from '../classes/defs.js';
import { sfx } from '../core/audio.js';
import { applySpread, dirFromYawPitch, rightFlat, raySphere, DEG, clamp } from '../core/utils.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _hits = [];
const R = 0.45;

function ink(geo, color, t = 0.02) {
  const m = new THREE.Mesh(geo, toonMat(color));
  m.castShadow = true;
  addOutline(m, t);
  return m;
}

/** Engineer super: a first-person kamikaze drone. */
export class Drone {
  constructor(game, owner, pos) {
    this.game = game;
    this.owner = owner;
    this.team = owner.team;
    this.isDrone = true;
    this.name = 'Drone';
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.hp = 90;
    this.maxHp = 90;
    this.alive = true;
    this.boosting = false;
    this.nextShot = 0;
    this.loopKey = `drone${owner.id}`;

    const g = (this.group = new THREE.Group());
    const body = ink(new THREE.BoxGeometry(0.5, 0.18, 0.62), TEAM_COLORS[this.team]);
    g.add(body);
    const dome = ink(new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0x3d4250);
    dome.position.y = 0.08;
    g.add(dome);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: 0x7cff6b }));
    eye.position.set(0, -0.02, -0.32);
    g.add(eye);
    const gun = ink(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8).rotateX(Math.PI / 2), 0x2b2b2b, 0.012);
    gun.position.set(0, -0.12, -0.25);
    g.add(gun);
    this.rotors = [];
    for (const [x, z] of [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]]) {
      const arm = ink(new THREE.BoxGeometry(0.06, 0.05, 0.36), 0x6c7384, 0.012);
      arm.position.set(x / 2, 0, z / 2);
      arm.rotation.y = Math.atan2(x, z);
      g.add(arm);
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 12), new THREE.MeshBasicMaterial({ color: 0xd0d4db, transparent: true, opacity: 0.55 }));
      rotor.position.set(x, 0.06, z);
      g.add(rotor);
      this.rotors.push(rotor);
    }
    g.position.copy(this.pos);
    game.scene.add(g);
    game.drones.push(this);
  }

  get time() {
    return this.game.time;
  }

  center(out = new THREE.Vector3()) {
    return out.copy(this.pos);
  }

  rayTest(o, d, maxT, inflate = 0) {
    const t = raySphere(o, d, this.pos, R + 0.1 + inflate, maxT);
    return t >= 0 ? { t, head: false } : null;
  }

  collides(p) {
    this.game.world.overlapping(p.x - R, p.y - R, p.z - R, p.x + R, p.y + R, p.z + R, _hits);
    return _hits.length > 0 || p.y < R;
  }

  /** Driven by the owner's input and look direction. */
  update(dt, inp) {
    if (!this.alive) return;
    const c = this.owner;
    const g = this.game;
    const aim = dirFromYawPitch(c.yaw, c.pitch, _v);

    if (inp.altPressed && !this.boosting) {
      this.boosting = true;
      sfx.play('dash', { pos: this.pos, volume: 1, rate: 0.6 });
    }
    if (this.boosting) {
      this.vel.copy(aim).multiplyScalar(32);
      g.effects.burst(this.pos, { count: 2, color: [0xff9f1c, 0xffd23f], speed: 2, size: 0.12, life: 0.3, gravity: 0 });
    } else {
      const right = rightFlat(c.yaw, _w);
      const wish = new THREE.Vector3().addScaledVector(aim, inp.mz).addScaledVector(right, inp.mx);
      if (inp.jump) wish.y += 1;
      if (inp.descend) wish.y -= 1;
      if (wish.lengthSq() > 1) wish.normalize();
      const k = 1 - Math.exp(-5 * dt);
      this.vel.lerp(wish.multiplyScalar(14), k);
    }

    // move with axis-separated collision; any contact while boosting detonates
    for (const axis of ['x', 'y', 'z']) {
      const prev = this.pos[axis];
      this.pos[axis] += this.vel[axis] * dt;
      if (this.collides(this.pos)) {
        if (this.boosting) {
          this.explode();
          return;
        }
        this.pos[axis] = prev;
        this.vel[axis] = 0;
      }
    }
    const b = g.world.bounds;
    this.pos.x = clamp(this.pos.x, b.minX + 1, b.maxX - 1);
    this.pos.z = clamp(this.pos.z, b.minZ + 1, b.maxZ - 1);
    this.pos.y = Math.min(this.pos.y, 40);

    // ram enemies
    for (const e of g.enemiesOf(this.team)) {
      if (e.chest(_w).distanceTo(this.pos) < 1.3) {
        this.explode();
        return;
      }
    }
    for (const d of g.deployables) {
      if (d.alive && d.team !== this.team && d.center(_w).distanceTo(this.pos) < 1.4) {
        this.explode();
        return;
      }
    }

    if (inp.fire && this.time >= this.nextShot && !this.boosting) {
      this.nextShot = this.time + 0.11;
      const dir = applySpread(aim, 1.6 * DEG);
      const muzzle = this.pos.clone().addScaledVector(aim, 0.6).add(new THREE.Vector3(0, -0.15, 0));
      g.fireBullet(c, {
        origin: this.pos.clone(),
        dir,
        range: 60,
        damage: 11,
        headMult: 1.5,
        tracer: 0x7cff6b,
        tracerWidth: 0.025,
        from: muzzle,
        weapon: 'Drone',
      });
      sfx.play('dronegun', { pos: this.pos, volume: 0.6 });
    }

    this.group.position.copy(this.pos);
    this.group.rotation.set(0, c.yaw, 0);
    this.group.rotation.x = clamp(-this.vel.dot(dirFromYawPitch(c.yaw, 0, _w)) * 0.03, -0.4, 0.4);
    for (const r of this.rotors) r.rotation.y += dt * 60;
    sfx.loop(this.loopKey, 'drone', { pos: this.pos, volume: 0.5, rate: this.boosting ? 1.6 : 1 + this.vel.length() * 0.02 });
  }

  explode() {
    if (!this.alive) return;
    this.alive = false;
    this.cleanup();
    this.game.explode(this.pos.clone(), 6, 180, this.owner, { minMul: 0.35, knockOut: 11, knockUp: 7, weapon: 'Drone Strike', color: 0xff9f1c });
    this.game.shakeAll(this.pos, 0.9);
    this.owner.kit.onDroneGone(this);
  }

  /** Shot down by enemies. */
  destroy() {
    if (!this.alive) return;
    this.alive = false;
    this.cleanup();
    this.game.effects.explosion(this.pos, 1.8, { color: 0xffa94d });
    sfx.play('explosion', { pos: this.pos, volume: 0.6, rate: 1.5 });
    this.owner.kit.onDroneGone(this);
  }

  cleanup() {
    this.game.scene.remove(this.group);
    sfx.stopLoop(this.loopKey);
    const i = this.game.drones.indexOf(this);
    if (i >= 0) this.game.drones.splice(i, 1);
  }
}
