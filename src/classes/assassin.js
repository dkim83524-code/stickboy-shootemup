import * as THREE from 'three';
import { Kit, boxMesh, cylMesh, vmArm } from './kit.js';
import { sfx } from '../core/audio.js';
import { toonGradient } from '../core/toon.js';
import { forwardFlat, yawTo, damp } from '../core/utils.js';

const CLOAK_TIME = 1.5; // standing still this long cloaks you
const STALK_CLOAK_DELAY = 0.5; // crouch-stalking cloaks you after this long
const LUNGE_CD = 3;
const STRIKE_RANGE = 60; // Shadow Strike teleport range
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _hits = [];

/*
 * Assassin
 * - LMB katana slash, RMB dash-slash lunge (both follow the backstab rules)
 * - E toggles Stalk: crouch, move at half speed, and stay cloaked while moving
 * - Standing still for 1.5s also cloaks
 * - Backstab rules: cloaked → always kills; uncloaked → first hit takes 75% of max HP
 * - Super "Shadow Strike": teleport behind the nearest enemy and backstab (kill). Each
 *   kill during the super re-arms the teleport, which fires again at the next nearest
 *   enemy, but those strikes only take 75% because your invisibility is gone.
 */
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
    this.stalking = false;
    this.stalkT = 0;
    this.strikes = 0;
    this.strikeArmed = false;
    this.strikeAt = 0;
    this.dip = 0;
  }

  onSpawn() {
    this.stillTime = 0;
    this.marks.clear();
    this.strikes = 0;
    this.strikeArmed = false;
    this.setStalk(false);
    this.setCloak(false, true);
  }

  /** During the strike chain the Assassin is visible. */
  get revealed() {
    return this.c.superActive && this.strikes > 0;
  }

  airJumps() {
    return this.stalking ? 0 : 1;
  }

  speedMul() {
    return this.stalking ? 0.5 : 1;
  }

  pose() {
    return 'melee';
  }

  crosshair() {
    return 'melee';
  }

  update(dt, inp) {
    const c = this.c;
    if (c.superActive && this.strikeArmed && this.time >= this.strikeAt) this.shadowStrike();

    if (inp.abilityPressed) this.setStalk(!this.stalking);
    if (this.stalking && (inp.jumpPressed || !c.grounded)) this.setStalk(false);

    if (inp.fire && this.ready('slash')) this.slash();
    else if (inp.altPressed && this.ready('lunge')) this.lunge();

    if (this.revealed) {
      this.setCloak(false);
      return;
    }
    if (c.superActive) {
      this.setCloak(true);
      return;
    }
    if (this.stalking) {
      this.stalkT += dt;
      this.stillTime = 0;
      this.setCloak(this.stalkT >= STALK_CLOAK_DELAY);
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

  setStalk(on) {
    const c = this.c;
    if (on === this.stalking) return;
    if (on && (this.revealed || !c.grounded || !c.alive)) return;
    this.stalking = on;
    this.stalkT = 0;
    c.crouched = on;
    if (!on) {
      this.stillTime = 0;
      if (!c.superActive) this.setCloak(false);
    } else if (this.local) sfx.play('cloak', { volume: 0.3, rate: 0.8 });
  }

  isBehind(t) {
    const tf = t.forward(_f);
    const dx = this.c.pos.x - t.pos.x;
    const dz = this.c.pos.z - t.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    return (tf.x * dx + tf.z * dz) / len < -0.25;
  }

  isMarked(t) {
    return (this.marks.get(t.id) || 0) > this.time;
  }

  /** Attacking stands you up and drops the cloak; returns whether you were cloaked. */
  breakStealth() {
    const wasCloaked = this.c.cloaked;
    this.lastAttack = this.time;
    this.setStalk(false);
    this.stillTime = 0;
    this.setCloak(false);
    return wasCloaked;
  }

  /** Katana hit with the backstab rules. */
  hit(t, wasCloaked, base, dir, weapon = 'Katana') {
    const g = this.game;
    if (!t.isCharacter) {
      g.damage(t, base, this.c, { weapon, dir });
      return;
    }
    const behind = this.isBehind(t);
    if (behind && wasCloaked) {
      g.damage(t, t.hp + 9999, this.c, { weapon, dir, trueDamage: true, backstab: true });
      g.effects.burst(t.chest(), { count: 30, color: [0xc8102e, 0x14121a], speed: 9, size: 0.12, life: 0.7 });
    } else if (behind && !this.isMarked(t)) {
      this.marks.set(t.id, this.time + 6);
      g.damage(t, t.maxHp * 0.75, this.c, { weapon, dir, trueDamage: true, backstab: true, partial: true });
      g.effects.burst(t.chest(), { count: 18, color: [0xc8102e, 0x14121a], speed: 7, size: 0.1, life: 0.5 });
    } else {
      g.damage(t, base, this.c, { weapon, dir });
      g.effects.burst(t.chest(), { count: 8, color: [0xffffff, 0x14121a], speed: 5, size: 0.08, life: 0.35 });
    }
  }

  slash() {
    const c = this.c;
    this.cooldown('slash', 0.5);
    const wasCloaked = this.breakStealth();
    this.swingT = 0;
    c.model.triggerAttack('swing');
    sfx.play('slash', { pos: c.pos, volume: 0.9 });
    const aim = c.aim(_v).clone();
    const targets = this.game.meleeSweep(c, 2.9, 70);
    for (const t of targets) this.hit(t, wasCloaked, 50, aim);
    if (targets.length) sfx.play('punch', { pos: c.pos, volume: 0.6, rate: 1.6 });
  }

  /** RMB: dash forward and slash the first thing in the way. */
  lunge() {
    const c = this.c;
    this.cooldown('lunge', LUNGE_CD);
    this.cooldown('slash', 0.3);
    const wasCloaked = this.breakStealth();
    this.swingT = 0;
    c.model.triggerAttack('swing');
    sfx.play('dash', { pos: c.pos, volume: 0.8, rate: 1.2 });
    sfx.play('slash', { pos: c.pos, volume: 0.8, rate: 0.9 });
    const dir = forwardFlat(c.yaw, new THREE.Vector3());
    const struck = new Set();
    c.forced = {
      vel: dir.clone().multiplyScalar(25),
      time: 0.24,
      gravity: false,
      update: (dt, fm) => {
        this.game.effects.burst(c.chest(), { count: 2, color: [0x2d2a3e, 0xc8102e], speed: 1, size: 0.1, life: 0.3, gravity: 0 });
        for (const t of this.game.meleeSweep(c, 2.0, 140)) {
          if (struck.has(t)) continue;
          struck.add(t);
          this.hit(t, wasCloaked, 55, dir, 'Lunge');
          sfx.play('punch', { pos: c.pos, volume: 0.7, rate: 1.5 });
          fm.cancel = true;
        }
      },
      onEnd: () => c.vel.multiplyScalar(0.3),
    };
  }

  // ------------------------------------------------------------------ Shadow Strike
  /** Free spot just behind `t`, or null. */
  behindSpot(t) {
    const g = this.game;
    const c = this.c;
    const f = t.forward(_f);
    const back = Math.atan2(-f.x, -f.z);
    for (const d of [1.2, 0.9, 1.6]) {
      for (const a of [0, 0.6, -0.6, 1.2, -1.2]) {
        const ang = back + a;
        const p = new THREE.Vector3(t.pos.x + Math.sin(ang) * d, t.pos.y, t.pos.z + Math.cos(ang) * d);
        if (!g.world.inBounds(p.x, p.z, 0.6)) continue;
        const r = c.radius;
        g.world.overlapping(p.x - r, p.y + 0.05, p.z - r, p.x + r, p.y + 1.85, p.z + r, _hits);
        if (_hits.length) continue;
        if (g.world.groundHeight(p.x, p.z, p.y + 0.1, r) < p.y - 0.6) continue;
        return p;
      }
    }
    return null;
  }

  findStrikeTarget() {
    const c = this.c;
    const list = this.game
      .enemiesOf(c.team)
      .filter((e) => this.time >= e.protectUntil && e.pos.distanceTo(c.pos) <= STRIKE_RANGE)
      .sort((a, b) => a.pos.distanceTo(c.pos) - b.pos.distanceTo(c.pos));
    for (const t of list) {
      const spot = this.behindSpot(t);
      if (spot) return { t, spot };
    }
    return null;
  }

  canStartSuper() {
    if (this.findStrikeTarget()) return true;
    if (this.local) this.game.hud.notify('NO TARGET IN RANGE', 'warn');
    return false;
  }

  onSuperStart() {
    this.strikes = 0;
    this.setStalk(false);
    this.setCloak(true, true);
    this.strikeArmed = true;
    this.strikeAt = this.time;
    this.shadowStrike();
  }

  shadowStrike() {
    const c = this.c;
    const g = this.game;
    const found = this.findStrikeTarget();
    if (!found) return; // stays armed until someone comes in range
    this.strikeArmed = false;
    const { t, spot } = found;
    g.effects.burst(c.chest(), { count: 24, color: [0x6a5acd, 0x2d2a3e], speed: 5, size: 0.12, life: 0.5, gravity: 0 });
    c.pos.copy(spot);
    c.vel.set(0, 0, 0);
    c.forced = null;
    c.yaw = yawTo(t.pos.x - spot.x, t.pos.z - spot.z);
    c.pitch = -0.12;
    g.effects.burst(c.chest(), { count: 24, color: [0x6a5acd, 0x2d2a3e], speed: 5, size: 0.12, life: 0.5, gravity: 0 });
    sfx.play('blink', { pos: c.pos, volume: 1, rate: 0.7 });
    sfx.play('slash', { pos: c.pos, volume: 1 });
    this.swingT = 0;
    c.model.triggerAttack('swing');
    this.lastAttack = this.time;
    const lethal = this.strikes === 0;
    this.strikes++;
    const dir = forwardFlat(c.yaw, new THREE.Vector3());
    if (lethal) {
      g.damage(t, t.hp + 9999, c, { weapon: 'Shadow Strike', dir, trueDamage: true, backstab: true });
    } else {
      this.marks.set(t.id, this.time + 6);
      g.damage(t, t.maxHp * 0.75, c, { weapon: 'Shadow Strike', dir, trueDamage: true, backstab: true, partial: true });
    }
    g.effects.burst(t.chest(), { count: 30, color: [0xc8102e, 0x14121a], speed: 9, size: 0.12, life: 0.7 });
    this.setCloak(false);
  }

  onKill(victim) {
    super.onKill(victim);
    if (this.c.superActive) {
      // every kill during Shadow Strike re-arms the teleport
      this.strikeArmed = true;
      this.strikeAt = this.time + 0.3;
    }
  }

  onSuperEnd() {
    this.strikeArmed = false;
    this.strikes = 0;
    this.stillTime = 0;
    this.setCloak(false);
  }

  onTookDamage() {
    if (this.c.cloaked) this.c.cloakFlashUntil = this.time + 0.35;
  }

  onDeath() {
    this.strikeArmed = false;
    this.setStalk(false);
    this.setCloak(false, true);
  }

  hud() {
    const c = this.c;
    let note = null;
    if (c.superActive) note = `SHADOW STRIKE ×${this.strikes}: KILL TO CHAIN`;
    else if (c.cloaked) note = this.stalking ? 'STALKING: BACKSTABS KILL' : 'CLOAKED: BACKSTABS KILL';
    else if (this.stalking) note = 'STALKING…';
    return {
      ammo: null,
      ability: { name: this.stalking ? 'Stalking' : 'Stalk', cd: 0, max: 1, active: this.stalking },
      cloak: c.cloaked ? 1 : this.stalking ? Math.min(1, this.stalkT / STALK_CLOAK_DELAY) : Math.min(1, this.stillTime / CLOAK_TIME),
      cloaked: c.cloaked,
      lunge: this.cdLeft('lunge'),
      note,
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
    this.dip = damp(this.dip, this.stalking ? 1 : 0, 10, dt);
    const t = this.swingT;
    const base = _v.set(0.3, -0.3 - this.dip * 0.1, -0.42 + this.dip * 0.04);
    if (t < 0.28) {
      const k = t / 0.28;
      const e = 1 - (1 - k) * (1 - k);
      u.pivot.rotation.set(-0.3 - e * 0.6, 0, 0.9 - e * 2.2);
      u.pivot.position.set(base.x - e * 0.4, base.y + 0.12 - e * 0.1, base.z - 0.1);
    } else {
      // stalking: blade lowered and held forward, out of the crosshair
      u.pivot.rotation.set(-this.dip * 0.55, 0, -this.dip * 0.15);
      u.pivot.position.copy(base);
    }
    u.arm.position.set(u.pivot.position.x - 0.28, u.pivot.position.y + 0.3, u.pivot.position.z + 0.42);
    const target = this.c.cloaked ? 0.3 : 1;
    this.vmOpacity += (target - this.vmOpacity) * Math.min(1, dt * 8);
    for (const m of Object.values(this.vmMats)) m.opacity = this.vmOpacity;
  }
}
