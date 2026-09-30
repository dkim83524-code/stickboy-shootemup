import * as THREE from 'three';
import { CLASSES, TEAM_COLORS } from '../classes/defs.js';
import { Stickman } from './stickman.js';
import { clamp, dirFromYawPitch, forwardFlat, rightFlat, rayBox, raySphere } from '../core/utils.js';
import { sfx } from '../core/audio.js';

export const GRAVITY = 30;
export const JUMP_SPEED = 10;
const STEP_HEIGHT = 0.55;
const _hits = [];
const _probe = [];
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _box = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

export function makeInput() {
  return {
    mx: 0,
    mz: 0,
    jump: false,
    jumpPressed: false,
    fire: false,
    firePressed: false,
    alt: false,
    altPressed: false,
    ability: false,
    abilityPressed: false,
    itemPressed: false,
    superPressed: false,
    reloadPressed: false,
    slot: 0,
    wheel: 0,
    descend: false,
  };
}

function clearActions(inp) {
  inp.mx = inp.mz = 0;
  inp.jump = inp.jumpPressed = inp.fire = inp.firePressed = inp.alt = inp.altPressed = false;
  inp.ability = inp.abilityPressed = inp.itemPressed = inp.superPressed = inp.reloadPressed = inp.descend = false;
  inp.slot = 0;
  inp.wheel = 0;
}

let NEXT_ID = 1;

export class Character {
  constructor(game, { name, team, classId, isPlayer = false }) {
    this.id = NEXT_ID++;
    this.isCharacter = true;
    this.game = game;
    this.name = name;
    this.team = team;
    this.isPlayer = isPlayer;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.radius = 0.36;
    this.height = 1.85;
    this.eyeHeight = 1.6;
    this.crouched = false;
    this.crouchT = 0; // smoothed 0..1 for camera, hitboxes and the model
    this.grounded = false;
    this.alive = false;
    this.hp = 0;
    this.input = makeInput();
    this.kills = 0;
    this.deaths = 0;
    this.damageDealt = 0;
    this.superCharge = 0;
    this.superActive = false;
    this.superTime = 0;
    this.lastDamageTime = -99;
    this.lastAttacker = null;
    this.slowUntil = 0;
    this.slowAmt = 0;
    this.stunUntil = 0;
    this.protectUntil = 0;
    this.respawnAt = 0;
    this.forced = null;
    this.airJumpsUsed = 0;
    this.cloaked = false;
    this.cloakFlashUntil = 0;
    this.hitFlash = 0;
    this.stepTimer = 0;
    this.pendingClass = null;
    this.brain = null;
    this.model = null;
    this.kit = null;
    this.setClass(classId);
  }

  get def() {
    return CLASSES[this.classId];
  }

  get maxHp() {
    return this.def.hp;
  }

  get time() {
    return this.game.time;
  }

  setClass(id) {
    if (this.model) {
      this.game.scene.remove(this.model.root);
      this.model.dispose();
    }
    if (this.kit) this.kit.dispose();
    this.classId = id;
    this.model = new Stickman({ color: TEAM_COLORS[this.team], hat: this.def.hat });
    this.kit = new this.game.KITS[id](this);
    this.kit.attachWorldWeapon(this.model);
    this.model.root.visible = false;
    this.game.scene.add(this.model.root);
    this.superCharge = 0;
  }

  spawn(pos, yaw) {
    if (this.pendingClass && this.pendingClass !== this.classId) this.setClass(this.pendingClass);
    this.pendingClass = null;
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.hp = this.maxHp;
    this.alive = true;
    this.superActive = false;
    this.superTime = 0;
    this.forced = null;
    this.slowUntil = this.stunUntil = 0;
    this.protectUntil = this.time + 2;
    this.lastDamageTime = -99;
    this.cloaked = false;
    this.crouched = false;
    this.crouchT = 0;
    this.height = 1.85;
    this.eyeHeight = 1.6;
    this.grounded = true;
    this.lastAttacker = null;
    this.kit.cds = {};
    this.kit.onSpawn();
    this.model.setOpacity(1);
    this.model.root.visible = true;
    this.syncModel(0.016);
  }

  // -------------------------------------------------------------- geometry helpers
  eye(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  aim(out = new THREE.Vector3()) {
    return dirFromYawPitch(this.yaw, this.pitch, out);
  }

  headCenter(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 1.62 - 0.52 * this.crouchT, this.pos.z);
  }

  chest(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 1.15 - 0.38 * this.crouchT, this.pos.z);
  }

  /** Yaw the body faces (differs from the look yaw while piloting a drone). */
  facing() {
    const f = this.kit.facingYaw();
    return f === null ? this.yaw : f;
  }

  forward(out = new THREE.Vector3()) {
    return forwardFlat(this.facing(), out);
  }

  /** Ray test against head sphere + body box. Returns {t, head} or null. */
  rayTest(o, d, maxT, inflate = 0) {
    let best = null;
    const ht = raySphere(o, d, this.headCenter(_v), 0.27 + inflate, maxT);
    if (ht >= 0) best = { t: ht, head: true };
    const r = 0.32 + inflate;
    _box.minX = this.pos.x - r;
    _box.maxX = this.pos.x + r;
    _box.minZ = this.pos.z - r;
    _box.maxZ = this.pos.z + r;
    _box.minY = this.pos.y - inflate;
    _box.maxY = this.pos.y + 1.4 - 0.45 * this.crouchT;
    const bt = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, _box, best ? best.t : maxT);
    if (bt && (!best || bt.t < best.t)) best = { t: bt.t, head: false };
    return best;
  }

  isStunned() {
    return this.time < this.stunUntil;
  }

  // -------------------------------------------------------------- super
  addSuper(x) {
    if (this.superActive || this.def.usesMana || !this.alive || x <= 0) return;
    const before = this.superCharge;
    this.superCharge = Math.min(100, this.superCharge + x);
    if (before < 100 && this.superCharge >= 100 && this.game.isLocal(this)) {
      sfx.play('ready');
      this.game.hud.notify('SUPER READY [Q]', 'ready');
    }
  }

  tryActivateSuper() {
    if (this.def.usesMana || this.superActive || this.superCharge < 100 || !this.kit.canStartSuper()) return false;
    this.superActive = true;
    this.superTime = this.def.superDuration;
    this.superCharge = 0;
    this.kit.onSuperStart();
    sfx.play('super', { pos: this.pos, volume: 1.2 });
    this.game.effects.ring(this.pos, { color: 0xffe066, radius: 3.5, life: 0.5 });
    if (this.game.isLocal(this)) this.game.hud.notify(this.def.superName.toUpperCase() + '!', 'super');
    return true;
  }

  endSuper() {
    if (!this.superActive) return;
    this.superActive = false;
    this.superTime = 0;
    this.kit.onSuperEnd();
  }

  // -------------------------------------------------------------- update
  update(dt) {
    if (!this.alive) return;
    const inp = this.input;
    if (this.isStunned() || this.game.state !== 'playing') clearActions(inp);

    this.kit.update(dt, inp);

    if (inp.superPressed) this.tryActivateSuper();
    if (this.superActive) {
      this.superTime -= dt;
      if (this.superTime <= 0) this.endSuper();
    } else {
      this.addSuper(this.kit.passiveCharge * dt);
    }

    this.crouchT = Math.max(0, Math.min(1, this.crouchT + (this.crouched ? dt : -dt) * 7));
    this.height = this.crouched ? 1.25 : 1.85;
    this.eyeHeight = 1.6 - 0.55 * this.crouchT;
    this.updateMovement(dt, inp);

    if (this.time - this.lastDamageTime > 5 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.12 * dt);
    }
    if (this.hitFlash > 0) this.hitFlash -= dt;
  }

  updateMovement(dt, inp) {
    const kit = this.kit;
    let speed = this.def.speed * kit.speedMul();
    if (this.time < this.slowUntil) speed *= 1 - this.slowAmt;
    forwardFlat(this.yaw, _f);
    rightFlat(this.yaw, _r);
    _w.set(0, 0, 0).addScaledVector(_f, inp.mz).addScaledVector(_r, inp.mx);
    const wl = _w.length();
    if (wl > 1) _w.divideScalar(wl);

    let gravity = true;
    if (this.forced) {
      const fm = this.forced;
      fm.time -= dt;
      if (fm.update) fm.update(dt, fm);
      this.vel.x = fm.vel.x;
      this.vel.z = fm.vel.z;
      if (!fm.gravity) {
        this.vel.y = fm.vel.y;
        gravity = false;
      }
      if (fm.time <= 0 || fm.cancel) {
        this.forced = null;
        if (fm.onEnd) fm.onEnd(fm);
      }
    } else if (this.grounded) {
      const k = 1 - Math.exp(-14 * dt);
      this.vel.x += (_w.x * speed - this.vel.x) * k;
      this.vel.z += (_w.z * speed - this.vel.z) * k;
      if (inp.jumpPressed && kit.canJump()) {
        this.vel.y = JUMP_SPEED * kit.jumpMul();
        this.grounded = false;
        this.airJumpsUsed = 0;
      }
    } else {
      if (wl > 0.01) {
        const cur = this.vel.x * _w.x + this.vel.z * _w.z;
        const add = clamp(speed - cur, 0, 22 * dt);
        this.vel.x += _w.x * add;
        this.vel.z += _w.z * add;
      }
      const drag = Math.max(0, 1 - 0.25 * dt);
      this.vel.x *= drag;
      this.vel.z *= drag;
      if (inp.jumpPressed && this.airJumpsUsed < kit.airJumps() && kit.canJump()) {
        this.airJumpsUsed++;
        this.vel.y = JUMP_SPEED * kit.jumpMul() * 0.95;
        this.game.effects.burst(this.pos, { count: 8, color: 0xffffff, speed: 3, size: 0.1, life: 0.4, gravity: 0 });
        sfx.play('dash', { pos: this.pos, volume: 0.5, rate: 1.4 });
      }
    }
    if (gravity) this.vel.y -= GRAVITY * kit.gravityMul() * dt;
    if (this.vel.y < -60) this.vel.y = -60;

    const vy0 = this.vel.y;
    const wasGrounded = this.grounded;
    const disp = this.vel.length() * dt;
    const steps = Math.min(10, Math.max(1, Math.ceil(disp / 0.3)));
    const sdt = dt / steps;
    this.grounded = false;
    for (let s = 0; s < steps; s++) {
      this.moveAxis(0, this.vel.x * sdt);
      this.moveAxis(2, this.vel.z * sdt);
      this.moveAxis(1, this.vel.y * sdt);
    }
    if (this.grounded && !wasGrounded) {
      this.airJumpsUsed = 0;
      kit.onLand(vy0);
      if (vy0 < -9) sfx.play('land', { pos: this.pos, volume: 0.5 });
    }
    if (this.grounded) {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      this.stepTimer -= hs * dt;
      if (this.stepTimer <= 0 && hs > 1.5) {
        this.stepTimer = 2.4;
        if (!this.cloaked) sfx.play('step', { pos: this.pos, volume: this.game.isLocal(this) ? 0.25 : 0.5 });
      }
    }

    // keep inside the arena
    const b = this.game.world.bounds;
    this.pos.x = clamp(this.pos.x, b.minX + this.radius, b.maxX - this.radius);
    this.pos.z = clamp(this.pos.z, b.minZ + this.radius, b.maxZ - this.radius);
  }

  overlapsBox(b) {
    const p = this.pos;
    const r = this.radius;
    return b.maxX > p.x - r && b.minX < p.x + r && b.maxY > p.y && b.minY < p.y + this.height && b.maxZ > p.z - r && b.minZ < p.z + r;
  }

  moveAxis(axis, delta) {
    if (delta === 0) return;
    const p = this.pos;
    const r = this.radius;
    const H = this.height;
    const world = this.game.world;
    if (axis === 0) p.x += delta;
    else if (axis === 1) p.y += delta;
    else p.z += delta;
    world.overlapping(p.x - r, p.y, p.z - r, p.x + r, p.y + H, p.z + r, _hits);
    for (let i = 0; i < _hits.length; i++) {
      const b = _hits[i];
      if (!this.overlapsBox(b)) continue;
      if (axis === 1) {
        if (delta < 0) {
          p.y = b.maxY;
          this.grounded = true;
          if (this.vel.y < 0) this.vel.y = 0;
        } else {
          p.y = b.minY - H - 1e-4;
          if (this.vel.y > 0) this.vel.y = 0;
        }
        continue;
      }
      // try stepping up onto low obstacles
      const stepH = b.maxY - p.y;
      if (stepH > 0 && stepH <= STEP_HEIGHT && this.vel.y <= 1) {
        world.overlapping(p.x - r, b.maxY + 0.01, p.z - r, p.x + r, b.maxY + H, p.z + r, _probe);
        if (_probe.length === 0) {
          p.y = b.maxY;
          this.grounded = true;
          continue;
        }
      }
      if (axis === 0) {
        p.x = delta > 0 ? b.minX - r - 1e-4 : b.maxX + r + 1e-4;
        this.vel.x = 0;
      } else {
        p.z = delta > 0 ? b.minZ - r - 1e-4 : b.maxZ + r + 1e-4;
        this.vel.z = 0;
      }
      if (this.forced && this.forced.onBlocked) this.forced.onBlocked(this.forced);
    }
    if (axis === 1 && p.y < 0) {
      p.y = 0;
      this.grounded = true;
      if (this.vel.y < 0) this.vel.y = 0;
    }
  }

  /** Push the character (respecting collisions). */
  shove(dx, dz) {
    this.moveAxis(0, dx);
    this.moveAxis(2, dz);
  }

  knock(vec) {
    this.vel.add(vec);
    if (vec.y > 0) this.grounded = false;
  }

  // -------------------------------------------------------------- visuals
  syncModel(dt) {
    const m = this.model;
    if (!this.alive) {
      m.root.visible = false;
      return;
    }
    m.root.position.copy(this.pos);
    const facing = this.facing();
    m.root.rotation.y = facing;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    m.pose = this.kit.pose();
    m.animate(dt, { speed: this.grounded ? hs : 0, grounded: this.grounded, pitch: facing === this.yaw ? this.pitch : 0, pose: m.pose, crouch: this.crouchT });

    const g = this.game;
    const viewer = g.viewer;
    const firstPerson = viewer === this && g.cameraMode === 'first';
    let opacity = 1;
    if (this.cloaked) {
      if (viewer && viewer.team === this.team) opacity = 0.3;
      else if (this.time < this.cloakFlashUntil) opacity = 0.45;
      else if (viewer) {
        const d = viewer.pos.distanceTo(this.pos);
        opacity = d < 9 ? 0.03 + 0.17 * (1 - d / 9) * (0.75 + 0.25 * Math.sin(this.time * 12)) : 0;
      }
    }
    if (this.time < this.protectUntil && Math.floor(this.time * 10) % 2 === 0) opacity = Math.min(opacity, 0.6);
    m.setOpacity(opacity);
    m.root.visible = !firstPerson && opacity > 0.004;
    const flash = this.hitFlash > 0 ? 0.55 : 0;
    m.bodyMat.emissive.setScalar(flash);
    m.setXray(!!(viewer && viewer !== this && viewer.team !== this.team && viewer.alive && viewer.kit.wallhack && viewer.kit.wallhack()));
  }

  die(killer, info = {}) {
    if (!this.alive) return;
    this.alive = false;
    this.deaths++;
    this.respawnAt = this.time + 4;
    if (this.superActive) this.endSuper();
    this.cloaked = false;
    this.forced = null;
    this.kit.onDeath();
    const impulse = new THREE.Vector3();
    if (info.dir) impulse.copy(info.dir).setY(0).normalize().multiplyScalar(info.explosive ? 12 : 7);
    this.model.setOpacity(1);
    const debris = this.model.burst(this.game.scene, impulse);
    this.game.effects.addDebris(debris);
    this.game.effects.burst(this.chest(_v), { count: 24, color: [0x14121a, TEAM_COLORS[this.team]], speed: 7, size: 0.12, life: 0.8 });
    this.model.root.visible = false;
  }

  dispose() {
    this.game.scene.remove(this.model.root);
    this.model.dispose();
    this.kit.dispose();
  }
}
