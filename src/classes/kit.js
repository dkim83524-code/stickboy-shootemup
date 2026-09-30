import * as THREE from 'three';
import { toonMat, addOutline, INK } from '../core/toon.js';
import { TEAM_COLORS } from './defs.js';
import { damp } from '../core/utils.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _o = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

// ---------------------------------------------------------------- primitive helpers
export function mesh(geo, color, outline = 0.012, { cast = true } = {}) {
  const m = new THREE.Mesh(geo, typeof color === 'number' ? toonMat(color) : color);
  m.castShadow = cast;
  if (outline > 0) addOutline(m, outline);
  return m;
}

export function boxMesh(w, h, d, color, outline = 0.012) {
  return mesh(new THREE.BoxGeometry(w, h, d), color, outline);
}

export function cylMesh(r, len, color, outline = 0.012, seg = 12, axis = 'z') {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  return mesh(g, color, outline);
}

export function sphereMesh(r, color, outline = 0.012) {
  return mesh(new THREE.SphereGeometry(r, 14, 10), color, outline);
}

/** Capsule limb stretched between points a and b. */
export function limb(a, b, r, color, outline = 0.012) {
  const len = a.distanceTo(b);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 10);
  const m = mesh(g, color, outline);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, _v.subVectors(b, a).normalize());
  return m;
}

/** Stick arm reaching from off-screen to a hand point (viewmodel space). */
export function vmArm(team, hand, side = 1) {
  const g = new THREE.Group();
  const color = TEAM_COLORS[team];
  const shoulder = new THREE.Vector3(0.42 * side, -0.62, 0.25);
  const elbow = new THREE.Vector3(0.3 * side, -0.42, -0.1);
  g.add(limb(shoulder, elbow, 0.045, color, 0.008));
  g.add(limb(elbow, hand, 0.042, color, 0.008));
  const h = sphereMesh(0.055, color, 0.008);
  h.position.copy(hand);
  g.add(h);
  return g;
}

// ---------------------------------------------------------------- Kit base
export class Kit {
  constructor(c) {
    this.c = c;
    this.game = c.game;
    this.cds = {};
    this.vm = null;
    this.vmRoot = null;
    this.vmBase = new THREE.Vector3(0, 0, 0);
    this.recoil = 0;
    this.passiveCharge = 0.7;
    this.dealtCharge = 0.08;
    this.killCharge = 8;
  }

  get time() {
    return this.game.time;
  }

  get local() {
    return this.game.isLocal(this.c);
  }

  ready(key) {
    return this.time >= (this.cds[key] || 0);
  }

  cooldown(key, s) {
    this.cds[key] = this.time + s;
  }

  cdLeft(key) {
    return Math.max(0, (this.cds[key] || 0) - this.time);
  }

  // hooks
  onSpawn() {}
  update() {}
  speedMul() {
    return 1;
  }
  jumpMul() {
    return 1;
  }
  gravityMul() {
    return 1;
  }
  airJumps() {
    return 0;
  }
  canJump() {
    return true;
  }
  damageTakenMul() {
    return 1;
  }
  isInvulnerable() {
    return false;
  }
  onDodged() {}
  onLand() {}
  onDealtDamage(amount) {
    this.c.addSuper(amount * this.dealtCharge);
  }
  onTookDamage() {}
  onKill() {
    this.c.addSuper(this.killCharge);
  }
  canStartSuper() {
    return true;
  }
  onSuperStart() {}
  onSuperEnd() {}
  onDeath() {}
  pose() {
    return 'gun';
  }
  crosshair() {
    return 'cross';
  }
  fov() {
    return null;
  }
  hud() {
    return {};
  }
  attachWorldWeapon() {}
  wallhack() {
    return false;
  }
  facingYaw() {
    return null;
  }
  hideViewmodel() {
    return false;
  }

  // ---------------------------------------------------------------- viewmodel
  buildViewmodel() {
    return new THREE.Group();
  }

  /** Called by the game when this kit becomes the local player's view. */
  ensureViewmodel(vmScene) {
    if (this.vmRoot) return this.vmRoot;
    this.vmRoot = new THREE.Group();
    this.vm = this.buildViewmodel();
    this.vmRoot.add(this.vm);
    vmScene.add(this.vmRoot);
    return this.vmRoot;
  }

  removeViewmodel() {
    if (this.vmRoot && this.vmRoot.parent) this.vmRoot.parent.remove(this.vmRoot);
    this.vmRoot = null;
    this.vm = null;
  }

  rebuildViewmodel() {
    if (!this.vmRoot) return;
    const parent = this.vmRoot.parent;
    this.removeViewmodel();
    if (parent) this.ensureViewmodel(parent);
  }

  kick(amount = 1) {
    this.recoil = Math.min(1.5, this.recoil + amount);
  }

  /** Generic bob/sway/recoil; subclasses animate their own parts in animateViewmodel. */
  updateViewmodel(dt, bobX, bobY, swayX, swayY) {
    if (!this.vmRoot) return;
    this.recoil = damp(this.recoil, 0, 12, dt);
    const r = this.vmRoot;
    r.visible = !this.hideViewmodel();
    r.position.set(this.vmBase.x + bobX + swayX, this.vmBase.y + bobY + swayY - this.recoil * 0.02, this.vmBase.z + this.recoil * 0.07);
    r.rotation.set(this.recoil * 0.12, -swayX * 0.8, 0);
    this.animateViewmodel(dt);
  }

  animateViewmodel() {}

  /** World-space point near the muzzle for tracers and projectile spawns. */
  muzzle(out = new THREE.Vector3(), side = 1) {
    const c = this.c;
    if (this.game.isLocal(c) && this.game.cameraMode === 'first') {
      // matches the first-person viewmodel: slightly right/down of the eye
      _q.setFromEuler(_e.set(c.pitch, c.yaw, 0, 'YXZ'));
      return c.eye(out).add(_o.set(0.22 * side, -0.2, -0.6).applyQuaternion(_q));
    }
    const arm = c.model.arms[side > 0 ? 'R' : 'L'];
    arm.hand.getWorldPosition(out);
    c.aim(_v);
    return out.addScaledVector(_v, 0.5);
  }

  /**
   * Direction from `from` (a muzzle) to whatever the crosshair is on, so projectiles
   * that spawn off-center still converge on the aim point.
   */
  convergeDir(from, range = 120, out = new THREE.Vector3()) {
    const c = this.c;
    const eye = c.eye();
    const aim = c.aim();
    const hit = this.game.hitscan(c, eye, aim, range);
    const target = hit ? hit.point : eye.addScaledVector(aim, range);
    out.subVectors(target, from);
    if (out.lengthSq() < 0.25) return out.copy(aim);
    return out.normalize();
  }

  dispose() {
    this.removeViewmodel();
  }
}

export { INK };
