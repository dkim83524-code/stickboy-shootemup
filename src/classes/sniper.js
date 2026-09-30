import * as THREE from 'three';
import { Kit, boxMesh, cylMesh, vmArm } from './kit.js';
import { sfx } from '../core/audio.js';
import { applySpread, DEG, damp, lerp } from '../core/utils.js';
import { GRAVITY } from '../entities/character.js';

const MAG = 5;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ropeGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 6).translate(0, 0.5, 0);
const ropeMat = new THREE.MeshBasicMaterial({ color: 0x14121a });
const hookGeo = new THREE.OctahedronGeometry(0.15, 0);
const hookMat = new THREE.MeshBasicMaterial({ color: 0xd0d4db });

function rifleModel(outline, scale = 1) {
  const g = new THREE.Group();
  const barrel = cylMesh(0.016 * scale, 0.6 * scale, 0x2b2d33, outline, 8);
  barrel.position.z = -0.45 * scale;
  g.add(barrel);
  const body = boxMesh(0.05 * scale, 0.08 * scale, 0.36 * scale, 0x4f772d, outline);
  body.position.z = -0.02 * scale;
  g.add(body);
  const stock = boxMesh(0.045 * scale, 0.1 * scale, 0.22 * scale, 0x6b4226, outline);
  stock.position.set(0, -0.02 * scale, 0.26 * scale);
  g.add(stock);
  const scope = cylMesh(0.028 * scale, 0.24 * scale, 0x1d1f24, outline, 10);
  scope.position.set(0, 0.07 * scale, -0.05 * scale);
  g.add(scope);
  const lens = cylMesh(0.022 * scale, 0.01 * scale, 0x7fe3ff, 0, 10);
  lens.position.set(0, 0.07 * scale, -0.175 * scale);
  g.add(lens);
  const grip = boxMesh(0.035 * scale, 0.1 * scale, 0.04 * scale, 0x2b2d33, outline);
  grip.position.set(0, -0.08 * scale, 0.08 * scale);
  g.add(grip);
  return g;
}

export class SniperKit extends Kit {
  constructor(c) {
    super(c);
    this.dealtCharge = 0.05;
    this.passiveCharge = 0.8;
    this.ammo = MAG;
    this.reloading = 0;
    this.scopeT = 0;
    this.grapple = null;
    this.mantle = null;
  }

  onSpawn() {
    this.ammo = MAG;
    this.reloading = 0;
    this.scopeT = 0;
    this.releaseGrapple(true);
  }

  speedMul() {
    return 1 - this.scopeT * 0.5;
  }

  wallhack() {
    return this.c.superActive;
  }

  pose() {
    return 'gun';
  }

  crosshair() {
    return this.scopeT > 0.7 ? 'scope' : 'noscope';
  }

  zoom() {
    return { t: this.scopeT, fov: 22 };
  }

  hideViewmodel() {
    return this.scopeT > 0.7;
  }

  update(dt, inp) {
    const c = this.c;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) this.ammo = MAG;
    } else if ((inp.reloadPressed && this.ammo < MAG) || (this.ammo <= 0 && this.ready('shot'))) this.startReload();

    const wantScope = inp.alt && this.reloading <= 0 && !this.grapple;
    this.scopeT = Math.max(0, Math.min(1, this.scopeT + (wantScope ? dt / 0.18 : -dt / 0.12)));

    if (inp.fire && this.ready('shot') && this.ammo > 0 && this.reloading <= 0) this.shoot();

    if (inp.abilityPressed) {
      if (this.grapple) this.releaseGrapple();
      else if (this.ready('grapple')) this.fireGrapple();
    }
    if (this.mantle) {
      if (this.time > this.mantle.until || (c.grounded && c.vel.y <= 0)) this.mantle = null;
      else {
        c.vel.x = this.mantle.x;
        c.vel.z = this.mantle.z;
      }
    }
    if (this.grapple) {
      if (inp.jumpPressed) {
        this.releaseGrapple();
        c.vel.y += 6;
      } else this.updateRope();
    }
  }

  startReload() {
    if (this.reloading > 0 || this.ammo >= MAG) return;
    this.reloading = 2.6;
    sfx.play('reload', { pos: this.c.pos, volume: 0.7 });
  }

  shoot() {
    const c = this.c;
    this.cooldown('shot', 1.35);
    this.ammo--;
    const spread = this.scopeT > 0.95 ? 0 : lerp(5.5, 0.4, this.scopeT) * DEG;
    const dir = applySpread(c.aim(_v), spread);
    this.game.fireBullet(c, {
      origin: c.eye(),
      dir,
      range: 320,
      damage: 150,
      headMult: 2,
      tracer: 0xfff9c4,
      tracerWidth: 0.07,
      tracerLife: 0.35,
      from: this.muzzle(),
      weapon: 'Sniper Rifle',
      impactScale: 2,
    });
    sfx.play('rifle', { pos: c.pos, volume: 1.2 });
    this.kick(1.2);
    this.game.effects.flash(this.muzzle(), { color: 0xfff2a8, size: 0.25, life: 0.06 });
    if (this.local) this.game.punchView(0.035);
  }

  fireGrapple() {
    const c = this.c;
    const g = this.game;
    const eye = c.eye();
    const aim = c.aim(_v).clone();
    const hit = g.world.raycast(eye, aim, 50, { dynamic: false });
    if (!hit || hit.point.y < 0.4) {
      this.cooldown('grapple', 0.5);
      if (this.local) sfx.play('deny');
      return;
    }
    sfx.play('grapple', { pos: c.pos, volume: 0.9 });
    const rope = new THREE.Mesh(ropeGeo, ropeMat);
    const hook = new THREE.Mesh(hookGeo, hookMat);
    hook.position.copy(hit.point);
    g.scene.add(rope, hook);
    // If we hooked a wall near the top of a building, aim to mantle onto the roof.
    let ledge = null;
    if (hit.normal.y > 0.5) ledge = hit.point.y;
    else {
      const top = g.world.groundHeight(hit.point.x - hit.normal.x * 0.3, hit.point.z - hit.normal.z * 0.3, 999);
      if (top - hit.point.y < 2.5) ledge = top;
    }
    this.grapple = { point: hit.point.clone(), normal: hit.normal.clone(), rope, hook, ledge, best: 1e9, stuck: 0 };
    g.effects.burst(hit.point, { count: 6, color: 0xd0d4db, speed: 3, size: 0.08, life: 0.3, normal: hit.normal });
    c.grounded = false;
    const gr = this.grapple;
    c.forced = {
      vel: new THREE.Vector3(),
      time: 2.2,
      gravity: false,
      update: (dt, fm) => {
        const to = _w.subVectors(gr.point, c.chest());
        const d = to.length();
        if (d < 1.4) {
          fm.cancel = true;
          return;
        }
        if (d < gr.best - 0.05) {
          gr.best = d;
          gr.stuck = 0;
        } else if ((gr.stuck += dt) > 0.3) {
          fm.cancel = true;
          return;
        }
        to.divideScalar(d);
        const speed = Math.min(32, fm.vel.length() + 90 * dt);
        fm.vel.copy(to).multiplyScalar(Math.max(speed, 12));
      },
      onEnd: () => this.releaseGrapple(),
    };
  }

  updateRope() {
    const gr = this.grapple;
    const from = this.muzzle(_v, -1);
    const to = gr.point;
    const d = from.distanceTo(to);
    gr.rope.position.copy(from);
    gr.rope.scale.set(1, d, 1);
    gr.rope.quaternion.setFromUnitVectors(UP, _w.subVectors(to, from).normalize());
  }

  releaseGrapple(silent = false) {
    const gr = this.grapple;
    if (!gr) return;
    this.grapple = null;
    const c = this.c;
    gr.rope.removeFromParent();
    gr.hook.removeFromParent();
    if (c.forced) c.forced = null;
    if (silent) return;
    this.cooldown('grapple', 4.5);
    if (gr.ledge !== null) {
      const rise = gr.ledge - c.pos.y + 0.5;
      if (rise > 0 && rise < 6) {
        c.vel.y = Math.max(c.vel.y, Math.sqrt(2 * GRAVITY * rise));
        const push = _v.set(gr.point.x - c.pos.x, 0, gr.point.z - c.pos.z);
        if (push.lengthSq() > 0.001) push.normalize();
        else push.copy(gr.normal).negate().setY(0);
        this.mantle = { x: push.x * 6, z: push.z * 6, until: this.time + 0.7 };
      }
    }
  }

  onDeath() {
    this.releaseGrapple(true);
    this.scopeT = 0;
  }

  dispose() {
    this.releaseGrapple(true);
    super.dispose();
  }

  hud() {
    return {
      ammo: this.reloading > 0 ? 'RELOADING' : `${this.ammo}`,
      ammoMax: MAG,
      ability: { name: 'Grapple', cd: this.grapple ? 0 : this.cdLeft('grapple'), max: 4.5, active: !!this.grapple },
      note: this.c.superActive ? 'WALLHACK ACTIVE' : null,
    };
  }

  attachWorldWeapon(model) {
    const r = rifleModel(0.015, 1.6);
    model.arms.R.mount.add(r);
  }

  buildViewmodel() {
    const root = new THREE.Group();
    const team = this.c.team;
    const rifle = rifleModel(0.006, 0.85);
    rifle.position.set(0.23, -0.25, -0.44);
    root.add(rifle);
    root.add(vmArm(team, new THREE.Vector3(0.235, -0.31, -0.39), 1));
    root.add(vmArm(team, new THREE.Vector3(0.2, -0.29, -0.7), -1));
    root.userData = { rifle };
    return root;
  }

  animateViewmodel(dt) {
    const u = this.vm.userData;
    const target = this.reloading > 0 ? -0.18 : 0;
    u.rifle.position.y = damp(u.rifle.position.y, -0.25 + target, 8, dt);
    u.rifle.rotation.z = damp(u.rifle.rotation.z, this.reloading > 0 ? 0.5 : 0, 8, dt);
  }
}
