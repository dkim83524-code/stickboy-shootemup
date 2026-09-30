import * as THREE from 'three';
import { Kit, boxMesh, cylMesh, vmArm } from './kit.js';
import { sfx } from '../core/audio.js';
import { applySpread, DEG, forwardFlat, rightFlat, clamp, damp } from '../core/utils.js';
import { addOutline, toonMat } from '../core/toon.js';

const MAG = 12;
const MAX_KNIVES = 3;
const LOCK_CONE = 40 * DEG;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

function revolverModel(outline, scale = 1) {
  const g = new THREE.Group();
  const barrel = cylMesh(0.016 * scale, 0.2 * scale, 0x3d4250, outline, 8);
  barrel.position.z = -0.16 * scale;
  g.add(barrel);
  const drum = cylMesh(0.035 * scale, 0.06 * scale, 0x6c7384, outline, 8);
  drum.position.z = -0.04 * scale;
  g.add(drum);
  const frame = boxMesh(0.03 * scale, 0.05 * scale, 0.1 * scale, 0x2b2d33, outline);
  frame.position.set(0, 0.01 * scale, -0.03 * scale);
  g.add(frame);
  const grip = boxMesh(0.03 * scale, 0.1 * scale, 0.045 * scale, 0x8f5a2f, outline);
  grip.position.set(0, -0.06 * scale, 0.03 * scale);
  grip.rotation.x = 0.35;
  g.add(grip);
  return g;
}

const knifeGeo = new THREE.BoxGeometry(0.03, 0.06, 0.4);
const knifeHandleGeo = new THREE.BoxGeometry(0.04, 0.05, 0.14);

export class GunslingerKit extends Kit {
  constructor(c) {
    super(c);
    this.dealtCharge = 0.055;
    this.passiveCharge = 0.55;
    this.ammo = MAG;
    this.reloading = 0;
    this.side = 1;
    this.knives = MAX_KNIVES;
    this.knifeT = 0;
    this.bloom = 0;
    this.roll = null;
    this.lockTarget = null;
    this.recoilL = 0;
    this.recoilR = 0;
  }

  onSpawn() {
    this.ammo = MAG;
    this.reloading = 0;
    this.knives = MAX_KNIVES;
    this.roll = null;
    this.lockTarget = null;
  }

  pose() {
    return 'dual';
  }

  crosshair() {
    return this.c.superActive ? 'lock' : 'cross';
  }

  isInvulnerable() {
    return !!this.roll;
  }

  onDodged() {
    if (this.roll) this.roll.dodged = true;
  }

  update(dt, inp) {
    const c = this.c;
    if (this.knives < MAX_KNIVES) {
      this.knifeT += dt;
      if (this.knifeT >= 4) {
        this.knifeT = 0;
        this.knives++;
      }
    }
    this.bloom = Math.max(0, this.bloom - dt * 5 * DEG);

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) this.ammo = MAG;
    } else if ((inp.reloadPressed && this.ammo < MAG) || (this.ammo <= 0 && !c.superActive)) this.startReload();

    if (inp.abilityPressed && this.ready('roll') && !this.roll) this.dodgeRoll(inp);

    if (c.superActive) {
      this.lockTarget = this.findLock();
      if (inp.firePressed) this.hairTriggerShot();
    } else {
      this.lockTarget = null;
      if (inp.fire && this.ready('shot') && this.ammo > 0 && this.reloading <= 0) this.shoot();
    }
    if (inp.altPressed && this.knives > 0 && this.ready('knife')) this.throwKnife();
  }

  startReload() {
    if (this.reloading > 0 || this.ammo >= MAG) return;
    this.reloading = 1.5;
    sfx.play('reload', { pos: this.c.pos, volume: 0.7, rate: 1.2 });
  }

  shoot() {
    const c = this.c;
    this.cooldown('shot', 0.2);
    this.ammo--;
    this.side = -this.side;
    const dir = applySpread(c.aim(_v), 0.35 * DEG + this.bloom);
    this.bloom = Math.min(3 * DEG, this.bloom + 0.8 * DEG);
    const from = this.muzzle(new THREE.Vector3(), this.side);
    this.game.fireBullet(c, {
      origin: c.eye(),
      dir,
      range: 90,
      damage: 34,
      headMult: 2,
      falloff: [25, 70, 0.6],
      ricochet: 1,
      tracer: 0xffd166,
      tracerWidth: 0.03,
      from,
      weapon: 'Revolvers',
    });
    sfx.play('revolver', { pos: c.pos, volume: 0.9 });
    c.model.triggerAttack('shoot', this.side);
    if (this.side > 0) this.recoilR = 1;
    else this.recoilL = 1;
    this.game.effects.flash(from, { color: 0xffd23f, size: 0.12, life: 0.05 });
  }

  /** Enemy nearest the crosshair that can be locked (visible, in cone, in range). */
  findLock() {
    const c = this.c;
    const g = this.game;
    const eye = c.eye();
    const aim = c.aim(_v).clone();
    let best = null;
    let bestAng = LOCK_CONE;
    for (const e of g.enemiesOf(c.team)) {
      if (e.cloaked) continue;
      const p = e.headCenter(_w);
      const to = p.clone().sub(eye);
      const d = to.length();
      if (d > 110) continue;
      const ang = Math.acos(clamp(to.dot(aim) / d, -1, 1));
      if (ang < bestAng && g.world.lineOfSight(eye, p)) {
        bestAng = ang;
        best = e;
      }
    }
    return best;
  }

  hairTriggerShot() {
    const c = this.c;
    const g = this.game;
    this.side = -this.side;
    const from = this.muzzle(new THREE.Vector3(), this.side);
    const t = this.lockTarget;
    if (t && t.alive) {
      const p = t.headCenter();
      g.effects.tracer(from, p, { color: 0xffe066, width: 0.05, life: 0.12 });
      g.effects.burst(p, { count: 10, color: [0xffe066, 0xffffff], speed: 6, size: 0.08, life: 0.3 });
      g.damage(t, 68, c, { weapon: 'Hair Trigger', dir: p.clone().sub(c.eye()).normalize(), crit: true });
    } else {
      g.fireBullet(c, {
        origin: c.eye(),
        dir: c.aim(_v).clone(),
        range: 110,
        damage: 68,
        headMult: 1,
        tracer: 0xffe066,
        tracerWidth: 0.05,
        from,
        weapon: 'Hair Trigger',
        crit: true,
      });
    }
    sfx.play('revolver', { pos: c.pos, volume: 1, rate: 1.25 });
    c.model.triggerAttack('shoot', this.side);
    if (this.side > 0) this.recoilR = 1;
    else this.recoilL = 1;
    g.effects.flash(from, { color: 0xffe066, size: 0.16, life: 0.05 });
  }

  throwKnife() {
    const c = this.c;
    this.cooldown('knife', 0.35);
    this.knives--;
    const from = c.eye().addScaledVector(rightFlat(c.yaw, _w), 0.15).addScaledVector(c.aim(_v), 0.4);
    const aim = this.convergeDir(from);
    const m = new THREE.Group();
    const blade = new THREE.Mesh(knifeGeo, toonMat(0xe3e9f0));
    addOutline(blade, 0.015);
    blade.position.z = -0.12;
    const handle = new THREE.Mesh(knifeHandleGeo, toonMat(0x2d2a3e));
    addOutline(handle, 0.015);
    handle.position.z = 0.14;
    m.add(blade, handle);
    this.game.projectiles.spawn({
      owner: c,
      pos: from,
      vel: aim.multiplyScalar(48).add(new THREE.Vector3(0, 1.5, 0)),
      gravity: 9,
      radius: 0.14,
      damage: 60,
      headMult: 2,
      weapon: 'Throwing Knife',
      mesh: m,
      orient: true,
      impactColor: 0xe3e9f0,
    });
    sfx.play('knife', { pos: c.pos, volume: 0.8 });
    c.model.triggerAttack('shoot', -1);
  }

  dodgeRoll(inp) {
    const c = this.c;
    this.cooldown('roll', 4);
    const dir = new THREE.Vector3().addScaledVector(forwardFlat(c.yaw, _v), inp.mz).addScaledVector(rightFlat(c.yaw, _w), inp.mx);
    if (dir.lengthSq() < 0.01) forwardFlat(c.yaw, dir);
    dir.normalize();
    this.roll = { t: 0, dodged: false };
    sfx.play('dash', { pos: c.pos, volume: 0.7, rate: 1.2 });
    c.forced = {
      vel: dir.multiplyScalar(16),
      time: 0.34,
      gravity: true,
      update: (dt) => {
        if (this.roll) this.roll.t += dt;
      },
      onEnd: () => this.endRoll(),
    };
  }

  endRoll() {
    const r = this.roll;
    if (!r) return;
    this.roll = null;
    this.reloading = 0;
    if (r.dodged) {
      this.ammo = MAG;
      this.c.addSuper(5);
      if (this.local) this.game.hud.notify('PERFECT DODGE! FULL RELOAD', 'good');
      sfx.play('reload', { pos: this.c.pos, volume: 0.8, rate: 1.5 });
    } else {
      this.ammo = Math.min(MAG, this.ammo + 6);
    }
  }

  onDeath() {
    this.roll = null;
    this.lockTarget = null;
  }

  hud() {
    return {
      ammo: this.c.superActive ? '∞' : this.reloading > 0 ? 'RELOADING' : `${this.ammo}`,
      ammoMax: MAG,
      knives: this.knives,
      ability: { name: 'Roll', cd: this.cdLeft('roll'), max: 4 },
      lock: this.lockTarget,
      note: this.c.superActive ? 'CLICK AS FAST AS YOU CAN!' : null,
    };
  }

  // ------------------------------------------------------------------ visuals
  attachWorldWeapon(model) {
    model.arms.R.mount.add(revolverModel(0.015, 1.7));
    model.arms.L.mount.add(revolverModel(0.015, 1.7));
  }

  buildViewmodel() {
    const root = new THREE.Group();
    const team = this.c.team;
    const R = new THREE.Group();
    const L = new THREE.Group();
    const gr = revolverModel(0.006, 1.0);
    gr.position.set(0.25, -0.23, -0.47);
    R.add(gr, vmArm(team, new THREE.Vector3(0.25, -0.29, -0.44), 1));
    const gl = revolverModel(0.006, 1.0);
    gl.position.set(-0.25, -0.23, -0.47);
    L.add(gl, vmArm(team, new THREE.Vector3(-0.25, -0.29, -0.44), -1));
    root.add(R, L);
    root.userData = { R, L };
    return root;
  }

  animateViewmodel(dt) {
    const u = this.vm.userData;
    this.recoilL = damp(this.recoilL, 0, 14, dt);
    this.recoilR = damp(this.recoilR, 0, 14, dt);
    u.R.position.z = this.recoilR * 0.06;
    u.R.rotation.x = this.recoilR * 0.25;
    u.L.position.z = this.recoilL * 0.06;
    u.L.rotation.x = this.recoilL * 0.25;
    const reloadDip = this.reloading > 0 ? -0.2 : 0;
    const rollDip = this.roll ? -0.3 : 0;
    const y = reloadDip + rollDip;
    u.R.position.y = damp(u.R.position.y, y, 10, dt);
    u.L.position.y = damp(u.L.position.y, y, 10, dt);
    u.R.rotation.z = damp(u.R.rotation.z, this.reloading > 0 ? -0.8 : 0, 10, dt);
    u.L.rotation.z = damp(u.L.rotation.z, this.reloading > 0 ? 0.8 : 0, 10, dt);
  }
}
