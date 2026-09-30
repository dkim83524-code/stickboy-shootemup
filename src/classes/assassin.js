import * as THREE from 'three';
import { Kit, boxMesh, cylMesh, vmArm } from './kit.js';
import { sfx } from '../core/audio.js';
import { toonGradient } from '../core/toon.js';
import { forwardFlat, rightFlat } from '../core/utils.js';

const CLOAK_TIME = 1.5;
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

export class AssassinKit extends Kit {
  constructor(c) {
    super(c);
    this.dealtCharge = 0.12;
    this.passiveCharge = 0.9;
    this.stillTime = 0;
    this.lastAttack = -9;
    this.marks = new Map();
    this.swingT = 9;
    this.vmOpacity = 1;
  }

  onSpawn() {
    this.stillTime = 0;
    this.marks.clear();
    this.setCloak(false, true);
  }

  airJumps() {
    return 1;
  }

  speedMul() {
    return this.c.superActive ? 1.15 : 1;
  }

  pose() {
    return 'melee';
  }

  crosshair() {
    return 'melee';
  }

  update(dt, inp) {
    const c = this.c;
    if (inp.abilityPressed && this.ready('dash')) this.dash(inp);
    if (inp.fire && this.ready('slash')) this.slash();

    if (c.superActive) {
      this.setCloak(true);
      return;
    }
    const hs = Math.hypot(c.vel.x, c.vel.z);
    const moving = hs > 0.4 || !c.grounded || !!c.forced || inp.mx !== 0 || inp.mz !== 0;
    if (moving || this.time - this.lastAttack < 0.15) {
      this.stillTime = 0;
      this.setCloak(false);
    } else {
      this.stillTime += dt;
      if (this.stillTime >= CLOAK_TIME) this.setCloak(true);
    }
  }

  setCloak(on, silent = false) {
    const c = this.c;
    if (c.cloaked === on) return;
    c.cloaked = on;
    if (silent) return;
    sfx.play('cloak', { pos: c.pos, volume: this.local ? 0.6 : 0.35, rate: on ? 1 : 1.4 });
    this.game.effects.burst(c.chest(), { count: 12, color: [0x6a5acd, 0x2d2a3e], speed: 3, size: 0.09, life: 0.5, gravity: -2 });
  }

  isBehind(t) {
    const tf = t.forward(_f);
    const dx = this.c.pos.x - t.pos.x;
    const dz = this.c.pos.z - t.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    return (tf.x * dx + tf.z * dz) / len < -0.25;
  }

  slash() {
    const c = this.c;
    const g = this.game;
    const wasCloaked = c.cloaked;
    this.cooldown('slash', 0.5);
    this.lastAttack = this.time;
    this.swingT = 0;
    if (!c.superActive) {
      this.stillTime = 0;
      this.setCloak(false);
    }
    c.model.triggerAttack('swing');
    sfx.play('slash', { pos: c.pos, volume: 0.9 });
    const aim = c.aim(_v).clone();
    const targets = g.meleeSweep(c, 2.9, 70);
    for (const t of targets) {
      if (!t.isCharacter) {
        g.damage(t, 50, c, { weapon: 'Katana', dir: aim });
        continue;
      }
      const behind = this.isBehind(t);
      if (behind && wasCloaked) {
        g.damage(t, t.hp + 9999, c, { weapon: 'Katana', dir: aim, trueDamage: true, backstab: true });
        g.effects.burst(t.chest(), { count: 30, color: [0xc8102e, 0x14121a], speed: 9, size: 0.12, life: 0.7 });
      } else if (behind && !this.isMarked(t)) {
        this.marks.set(t.id, this.time + 6);
        g.damage(t, t.maxHp * 0.75, c, { weapon: 'Katana', dir: aim, trueDamage: true, backstab: true, partial: true });
        g.effects.burst(t.chest(), { count: 18, color: [0xc8102e, 0x14121a], speed: 7, size: 0.1, life: 0.5 });
      } else {
        g.damage(t, 50, c, { weapon: 'Katana', dir: aim });
        g.effects.burst(t.chest(), { count: 8, color: [0xffffff, 0x14121a], speed: 5, size: 0.08, life: 0.35 });
      }
    }
    if (targets.length) sfx.play('punch', { pos: c.pos, volume: 0.6, rate: 1.6 });
  }

  isMarked(t) {
    return (this.marks.get(t.id) || 0) > this.time;
  }

  dash(inp) {
    const c = this.c;
    this.cooldown('dash', 3.5);
    const dir = new THREE.Vector3();
    dir.addScaledVector(forwardFlat(c.yaw, _f), inp.mz).addScaledVector(rightFlat(c.yaw, _v), inp.mx);
    if (dir.lengthSq() < 0.01) forwardFlat(c.yaw, dir);
    dir.normalize();
    sfx.play('dash', { pos: c.pos, volume: 0.8 });
    c.forced = {
      vel: dir.multiplyScalar(26).setY(0),
      time: 0.19,
      gravity: false,
      update: () => this.game.effects.burst(c.chest(), { count: 2, color: [0x2d2a3e, 0x6a5acd], speed: 1, size: 0.1, life: 0.35, gravity: 0 }),
      onEnd: () => {
        c.vel.multiplyScalar(0.45);
      },
    };
  }

  onTookDamage() {
    if (this.c.cloaked) this.c.cloakFlashUntil = this.time + 0.35;
  }

  onSuperStart() {
    this.setCloak(true);
  }

  onSuperEnd() {
    this.stillTime = 0;
    this.setCloak(false);
  }

  onDeath() {
    this.setCloak(false, true);
  }

  hud() {
    const c = this.c;
    return {
      ammo: null,
      ability: { name: 'Dash', cd: this.cdLeft('dash'), max: 3.5 },
      cloak: c.cloaked ? 1 : Math.min(1, this.stillTime / CLOAK_TIME),
      cloaked: c.cloaked,
      note: c.superActive ? 'SHADOW WALK: BACKSTABS KILL' : c.cloaked ? 'CLOAKED: BACKSTABS KILL' : null,
    };
  }

  // ------------------------------------------------------------------ visuals
  katanaModel(outline, scale = 1, mats = null) {
    const g = new THREE.Group();
    const blade = boxMesh(0.018 * scale, 0.05 * scale, 0.62 * scale, mats ? mats.blade : 0xe3e9f0, outline);
    blade.position.z = -0.36 * scale;
    g.add(blade);
    const edge = boxMesh(0.02 * scale, 0.012 * scale, 0.6 * scale, mats ? mats.edge : 0xffffff, 0);
    edge.position.set(0, -0.025 * scale, -0.36 * scale);
    g.add(edge);
    const guard = cylMesh(0.05 * scale, 0.015 * scale, mats ? mats.guard : 0xd4a017, outline, 10);
    guard.position.z = -0.05 * scale;
    g.add(guard);
    const grip = cylMesh(0.02 * scale, 0.2 * scale, mats ? mats.grip : 0x2d2a3e, outline, 8);
    grip.position.z = 0.05 * scale;
    g.add(grip);
    return g;
  }

  attachWorldWeapon(model) {
    const k = this.katanaModel(0.015, 1.6);
    k.rotation.x = 0.3;
    model.arms.R.mount.add(k);
  }

  buildViewmodel() {
    const root = new THREE.Group();
    const team = this.c.team;
    // private materials so the blade can fade while cloaked
    const mk = (color) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), transparent: true });
    this.vmMats = { blade: mk(0xe3e9f0), edge: mk(0xffffff), guard: mk(0xd4a017), grip: mk(0x2d2a3e) };
    const pivot = new THREE.Group();
    pivot.position.set(0.28, -0.3, -0.42);
    const kat = this.katanaModel(0.007, 1, this.vmMats);
    kat.rotation.set(0.9, 0.15, -0.35);
    pivot.add(kat);
    root.add(pivot);
    const arm = vmArm(team, new THREE.Vector3(0.28, -0.3, -0.42), 1);
    root.add(arm);
    root.userData = { pivot, kat, arm };
    return root;
  }

  animateViewmodel(dt) {
    const u = this.vm.userData;
    this.swingT += dt;
    const t = this.swingT;
    if (t < 0.28) {
      const k = t / 0.28;
      const e = 1 - (1 - k) * (1 - k);
      u.pivot.rotation.set(-0.3 - e * 0.6, 0, 0.9 - e * 2.2);
      u.pivot.position.set(0.28 - e * 0.4, -0.3 + 0.12 - e * 0.1, -0.42 - 0.1);
    } else {
      u.pivot.rotation.set(0, 0, 0);
      u.pivot.position.set(0.28, -0.3, -0.42);
    }
    u.arm.position.copy(u.pivot.position).sub(new THREE.Vector3(0.28, -0.3, -0.42));
    const target = this.c.cloaked ? 0.3 : 1;
    this.vmOpacity += (target - this.vmOpacity) * Math.min(1, dt * 8);
    for (const m of Object.values(this.vmMats)) m.opacity = this.vmOpacity;
  }
}
