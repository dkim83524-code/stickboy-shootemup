import * as THREE from 'three';
import { clamp, rand, DEG, yawTo, pitchTo, angleDiff, forwardFlat, rightFlat, dirFromYawPitch } from '../core/utils.js';

const DIFFICULTY = {
  easy: { react: 0.7, aimErr: 5 * DEG, turn: 4.5, track: 5, headChance: 0.1, jumpy: 0.1, fov: 60 * DEG },
  normal: { react: 0.42, aimErr: 2.6 * DEG, turn: 7.5, track: 8, headChance: 0.22, jumpy: 0.25, fov: 70 * DEG },
  hard: { react: 0.24, aimErr: 1.3 * DEG, turn: 11, track: 13, headChance: 0.4, jumpy: 0.4, fov: 80 * DEG },
};


const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _m = new THREE.Vector3();

/**
 * Bot brain: fills the character's input each frame, exactly like the keyboard/mouse
 * controller does for the player, so bots use the same kits and rules.
 */
export class BotBrain {
  constructor(c, game, difficulty = 'normal') {
    this.c = c;
    this.game = game;
    this.d = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.onSpawn();
  }

  get time() {
    return this.game.time;
  }

  onSpawn() {
    this.target = null;
    this.targetVisible = false;
    this.lastKnown = null;
    this.lastKnownAt = -99;
    this.perceiveAt = 0;
    this.reactUntil = 0;
    this.path = null;
    this.pathIdx = 0;
    this.pathGoal = null;
    this.repathAt = 0;
    this.goal = null;
    this.goalUntil = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeSwitch = 0;
    this.stuckCheck = 0;
    this.stuckT = 0;
    this.lastPos = this.c.pos.clone();
    this.noise = new THREE.Vector3();
    this.noiseAt = 0;
    this.aimHead = false;
    this.campUntil = 0;
    this.scopedAt = 0;
    this.clickAt = 0;
    this.lastHurtAt = -99;
    this.lastHurtBy = null;
    this.wantMove = false;
    this.nade = null;
    this.poisonUntil = 0;
  }

  onDamaged(attacker) {
    this.lastHurtAt = this.time;
    this.lastHurtBy = attacker;
    if (attacker && attacker.isCharacter && attacker.alive && (!this.targetVisible || !this.target)) {
      this.lastKnown = attacker.pos.clone();
      this.lastKnownAt = this.time;
      this.target = attacker;
      this.reactUntil = Math.max(this.reactUntil, this.time + this.d.react * 0.8);
    }
  }

  onKill() {}

  // ------------------------------------------------------------------ main
  update(dt) {
    const c = this.c;
    const inp = c.input;
    inp.mx = inp.mz = 0;
    inp.jump = inp.jumpPressed = false;
    inp.fire = inp.firePressed = false;
    inp.alt = inp.altPressed = false;
    inp.ability = inp.abilityPressed = inp.itemPressed = false;
    inp.superPressed = inp.reloadPressed = inp.descend = false;
    inp.slot = 0;
    inp.wheel = 0;
    this.wantMove = false;

    if (this.time >= this.perceiveAt) this.perceive();

    const kit = c.kit;
    if (kit.drone && kit.drone.alive) {
      this.pilotDrone(dt);
      return;
    }

    const t = this.target && this.target.alive ? this.target : null;
    if (!t) this.target = null;
    const cls = c.classId;
    if (t && this.targetVisible) {
      this.engage(dt, t, cls);
    } else {
      this.roam(dt, cls);
    }
    this.checkStuck(dt);
  }

  perceive() {
    const c = this.c;
    const g = this.game;
    this.perceiveAt = this.time + 0.15 + Math.random() * 0.1;
    const eye = c.eye(_v).clone();
    const fwd = c.aim(_w).clone();
    const knowsAll = c.kit.wallhack();
    const cosFov = Math.cos(this.d.fov);
    let best = null;
    let bestScore = Infinity;
    for (const e of g.enemiesOf(c.team)) {
      const p = e.chest(_f);
      const dist = p.distanceTo(eye);
      if (dist > 80) continue;
      if (e.cloaked && dist > 2.5 && this.time > e.cloakFlashUntil) continue;
      const dot = _r.subVectors(p, eye).divideScalar(dist).dot(fwd);
      const noticed = dot > cosFov || dist < 5 || (e === this.lastHurtBy && this.time - this.lastHurtAt < 2) || e === this.target;
      if (!noticed && !knowsAll) continue;
      if (!g.world.lineOfSight(eye, p)) {
        if (knowsAll && (!best || !this.targetVisible)) {
          const score = dist + 40;
          if (score < bestScore && !this.targetVisible) {
            this.lastKnown = e.pos.clone();
            this.lastKnownAt = this.time;
          }
        }
        continue;
      }
      let score = dist;
      if (e === this.target) score -= 8;
      if (e === this.lastHurtBy) score -= 6;
      score += (e.hp / e.maxHp) * 6;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best) {
      if (best !== this.target || !this.targetVisible) this.reactUntil = this.time + this.d.react * rand(0.7, 1.3);
      this.target = best;
      this.targetVisible = true;
      this.lastKnown = best.pos.clone();
      this.lastKnownAt = this.time;
    } else {
      this.targetVisible = false;
    }
    // enemy drones are fair game
    this.droneTarget = null;
    for (const dr of g.drones) {
      if (dr.team === c.team || !dr.alive) continue;
      const d = dr.pos.distanceTo(eye);
      if (d < 30 && g.world.lineOfSight(eye, dr.pos)) {
        this.droneTarget = dr;
        break;
      }
    }
  }

  // ------------------------------------------------------------------ movement helpers
  setMoveDir(dir, scale = 1) {
    const c = this.c;
    forwardFlat(c.yaw, _f);
    rightFlat(c.yaw, _r);
    c.input.mz = clamp((dir.x * _f.x + dir.z * _f.z) * scale, -1, 1);
    c.input.mx = clamp((dir.x * _r.x + dir.z * _r.z) * scale, -1, 1);
    this.wantMove = true;
  }

  /** Follow a nav path toward `point`. Returns remaining straight distance. */
  moveTo(point, { face = true } = {}) {
    const c = this.c;
    const g = this.game;
    const goalMoved = !this.pathGoal || this.pathGoal.distanceTo(point) > 3;
    if (!this.path || goalMoved || this.time > this.repathAt) {
      this.path = g.nav.findPath(c.pos, point) || [point.clone()];
      this.pathIdx = 0;
      this.pathGoal = point.clone();
      this.repathAt = this.time + 1.5 + Math.random();
    }
    let next = this.path[this.pathIdx];
    while (next && Math.hypot(next.x - c.pos.x, next.z - c.pos.z) < 1.1 && this.pathIdx < this.path.length - 1) {
      this.pathIdx++;
      next = this.path[this.pathIdx];
    }
    if (!next) next = point;
    const dir = _m.set(next.x - c.pos.x, 0, next.z - c.pos.z);
    const dist = dir.length();
    if (dist > 0.05) {
      dir.divideScalar(dist);
      this.setMoveDir(dir);
      if (face) this.lookDir(dir, 0.6);
    }
    return Math.hypot(point.x - c.pos.x, point.z - c.pos.z);
  }

  lookDir(dir, speed = 1) {
    const c = this.c;
    const dy = yawTo(dir.x, dir.z);
    this.turnTo(dy, 0, speed);
  }

  turnTo(yaw, pitch, speed = 1) {
    const c = this.c;
    const dt = this.game.frameDt || 0.016;
    const maxTurn = this.d.turn * speed * dt;
    const k = Math.min(1, this.d.track * speed * dt);
    const ey = angleDiff(c.yaw, yaw);
    c.yaw += clamp(ey * k, -maxTurn, maxTurn);
    const ep = pitch - c.pitch;
    c.pitch += clamp(ep * k, -maxTurn, maxTurn);
    c.pitch = clamp(c.pitch, -1.5, 1.5);
    return Math.abs(ey) + Math.abs(ep);
  }

  /** Aim at a world point; returns the angular error in radians. */
  aimAt(point) {
    const c = this.c;
    const eye = c.eye(_v);
    const dx = point.x - eye.x;
    const dy = point.y - eye.y;
    const dz = point.z - eye.z;
    this.turnTo(yawTo(dx, dz), pitchTo(dx, dy, dz), 1);
    const want = _w.set(dx, dy, dz).normalize();
    const have = c.aim(_f);
    return Math.acos(clamp(want.dot(have), -1, 1));
  }

  aimPoint(t, { lead = 0, forceHead = false, feet = false } = {}) {
    const c = this.c;
    if (this.time >= this.noiseAt) {
      this.noiseAt = this.time + 0.35 + Math.random() * 0.3;
      this.noise.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(Math.random());
      this.aimHead = Math.random() < this.d.headChance * (c.classId === 'sniper' ? 1.6 : 1);
    }
    const p = new THREE.Vector3();
    if (!t.isCharacter) p.copy(t.pos);
    else if (feet) p.copy(t.pos).setY(t.pos.y + 0.2);
    else if (forceHead || this.aimHead) t.headCenter(p);
    else t.chest(p);
    const dist = p.distanceTo(c.eye(_v));
    if (lead > 0 && t.vel) p.addScaledVector(t.vel, dist / lead);
    p.addScaledVector(this.noise, Math.tan(this.d.aimErr) * dist);
    return p;
  }

  /** Fire tolerance: roughly the angular size of the target. */
  canFire(err, dist, scale = 1) {
    return this.time >= this.reactUntil && err < Math.atan2(0.45 * scale, dist) + 1.5 * DEG;
  }

  strafeAround(t, dist, [minR, maxR], moveScale = 1) {
    const c = this.c;
    if (this.time > this.strafeSwitch) {
      this.strafe = Math.random() < 0.5 ? 1 : -1;
      this.strafeSwitch = this.time + rand(0.6, 1.8);
      if (c.grounded && Math.random() < this.d.jumpy * 0.5) c.input.jumpPressed = true;
    }
    const to = _v.set(t.pos.x - c.pos.x, 0, t.pos.z - c.pos.z);
    const len = to.length() || 1;
    to.divideScalar(len);
    const side = _w.set(-to.z, 0, to.x).multiplyScalar(this.strafe);
    if (dist > maxR) {
      this.moveTo(t.pos, { face: false });
      return;
    }
    const dir = side.clone();
    if (dist < minR) dir.addScaledVector(to, -1.2);
    dir.normalize();
    this.setMoveDir(dir, moveScale);
  }

  checkStuck(dt) {
    const c = this.c;
    this.stuckCheck -= dt;
    if (this.stuckCheck > 0) return;
    this.stuckCheck = 0.5;
    const moved = Math.hypot(c.pos.x - this.lastPos.x, c.pos.z - this.lastPos.z);
    this.lastPos.copy(c.pos);
    if (this.wantMove && moved < 0.35) this.stuckT += 0.5;
    else this.stuckT = Math.max(0, this.stuckT - 0.5);
    if (this.stuckT >= 1 && c.grounded) c.input.jumpPressed = true;
    if (this.stuckT >= 2) {
      this.path = null;
      this.strafe *= -1;
    }
    if (this.stuckT >= 3.5) {
      this.goal = null;
      this.stuckT = 0;
    }
  }

  // ------------------------------------------------------------------ roaming
  roam(dt, cls) {
    const c = this.c;
    const g = this.game;
    const inp = c.input;
    const kit = c.kit;

    // shoot enemy drones if any
    if (this.droneTarget && cls !== 'assassin') {
      const p = this.aimPoint(this.droneTarget);
      const err = this.aimAt(p);
      if (err < 6 * DEG) {
        if (cls === 'gunslinger' && c.superActive) {
          if (this.time > this.clickAt) {
            this.clickAt = this.time + 0.14;
            inp.firePressed = inp.fire = true;
          }
        } else inp.fire = true;
      }
      if (cls === 'berserker' && !c.superActive) inp.alt = true;
      return;
    }

    if (cls === 'assassin' && !c.superActive) {
      this.ambush(dt);
      return;
    }
    if (cls === 'mage' && this.mageSupport()) return;
    if (cls === 'engineer' && this.engineerMaintain()) return;

    // chase recent intel
    if (this.lastKnown && this.time - this.lastKnownAt < 6) {
      const d = this.moveTo(this.lastKnown);
      if (d < 2) this.lastKnown = null;
      if (Math.random() < 0.003) inp.reloadPressed = true;
      return;
    }

    if (!this.goal || this.time > this.goalUntil || Math.hypot(this.goal.x - c.pos.x, this.goal.z - c.pos.z) < 2.5) {
      this.pickGoal(cls);
    }
    this.moveTo(this.goal);
    if (Math.random() < 0.01) inp.reloadPressed = true;
    if (c.pitch !== 0) c.pitch *= 0.9;

    // engineer: set up a turret while wandering
    if (cls === 'engineer') this.engineerBuild(false);
    if (cls === 'sniper' && c.superCharge >= 100) inp.superPressed = true;
  }

  pickGoal(cls) {
    const c = this.c;
    const g = this.game;
    const side = c.team === 0 ? 1 : -1;
    let filter;
    if (cls === 'sniper') filter = (p) => p.x * side < 5 && p.x * side > -45;
    else filter = (p) => p.x * side > -35;
    this.goal = g.nav.randomPoint(filter);
    this.goalUntil = this.time + 20;
  }

  ambush(dt) {
    const c = this.c;
    const inp = c.input;
    if (this.time < this.campUntil) {
      // crouch in the shadows (looking around is allowed)
      this.setStalk(true);
      c.yaw += Math.sin(this.time * 0.7) * 0.004;
      return;
    }
    this.setStalk(false);
    if (this.lastKnown && this.time - this.lastKnownAt < 8) {
      const d = this.moveTo(this.lastKnown);
      if (d < 6) {
        this.campUntil = this.time + rand(4, 8);
        this.lastKnown = null;
      }
      return;
    }
    if (!this.goal || this.time > this.goalUntil) {
      const side = c.team === 0 ? 1 : -1;
      this.goal = this.game.nav.randomPoint((p) => p.x * side > -20 && p.x * side < 45);
      this.goalUntil = this.time + 25;
    }
    const d = this.moveTo(this.goal);
    if (d < 2.5) {
      this.goal = null;
      this.campUntil = this.time + rand(6, 12);
    }
  }

  // ------------------------------------------------------------------ fighting
  engage(dt, t, cls) {
    const c = this.c;
    const inp = c.input;
    const eye = c.eye(new THREE.Vector3());
    const dist = t.chest(_v).distanceTo(eye);
    switch (cls) {
      case 'berserker':
        return this.fightBerserker(t, dist);
      case 'mage':
        return this.fightMage(t, dist);
      case 'assassin':
        return this.fightAssassin(t, dist);
      case 'sniper':
        return this.fightSniper(t, dist);
      case 'engineer':
        return this.fightEngineer(t, dist);
      case 'gunslinger':
        return this.fightGunslinger(t, dist);
    }
    return undefined;
  }

  fightBerserker(t, dist) {
    const c = this.c;
    const inp = c.input;
    if (c.superCharge >= 100 && dist < 16) inp.superPressed = true;
    if (c.superActive) {
      this.moveTo(t.pos, { face: false });
      const err = this.aimAt(this.aimPoint(t, { forceHead: false }));
      if (dist < 2.8 && err < 25 * DEG) inp.fire = true;
      if (dist < 8 && dist > 3 && c.grounded && Math.random() < 0.04) inp.jumpPressed = true;
      if (!c.grounded && c.vel.y < 2 && Math.hypot(t.pos.x - c.pos.x, t.pos.z - c.pos.z) < 3.5) inp.altPressed = true;
      return;
    }
    this.strafeAround(t, dist, [0, 14]);
    const err = this.aimAt(this.aimPoint(t));
    if (dist < 30) inp.alt = true;
    if (this.canFire(err, dist, 1.4)) inp.fire = true;
    if (dist > 5 && dist < 18 && err < 8 * DEG && c.kit.ready('charge') && Math.random() < 0.04) inp.abilityPressed = true;
  }

  fightMage(t, dist) {
    const c = this.c;
    const inp = c.input;
    const kit = c.kit;
    if (kit.channel) {
      this.aimAt(this.aimPoint(t, { feet: true }));
      return;
    }
    if (kit.mana >= 99.9 && dist > 8 && dist < 60 && Math.random() < 0.05) {
      inp.superPressed = true;
      this.aimAt(this.aimPoint(t, { feet: true }));
      return;
    }
    if (c.hp < c.maxHp * 0.4 && this.time - this.lastHurtAt < 0.6 && kit.ready('blink') && kit.mana > 30) {
      // blink away from the threat
      const away = _v.set(c.pos.x - t.pos.x, 0, c.pos.z - t.pos.z).normalize();
      c.yaw = yawTo(away.x, away.z);
      c.pitch = 0.05;
      inp.abilityPressed = true;
      return;
    }
    this.strafeAround(t, dist, [9, 26]);
    if (this.mageSupport()) {
      this.aimAt(this.aimPoint(t, { lead: 70 }));
      return;
    }
    // Poison Pool at the target's feet now and then
    const poisoning = this.poisonUntil > this.time;
    if (poisoning || (kit.mana >= 45 && kit.ready('poison') && dist < 30 && Math.random() < 0.02)) {
      if (!poisoning) this.poisonUntil = this.time + 0.8;
      inp.slot = 3;
      const perr = this.aimAt(this.aimPoint(t, { feet: true }));
      if (kit.slot === 2 && perr < 4 * DEG) {
        inp.fire = inp.firePressed = true;
        this.poisonUntil = 0;
      }
      return;
    }
    inp.slot = 1;
    const err = this.aimAt(this.aimPoint(t, { lead: 70 }));
    if (this.canFire(err, dist, 1.2) && kit.slot === 0) inp.fire = true;
  }

  /** Healing Circle when the Mage or a nearby ally is hurt. Returns true while casting it. */
  mageSupport() {
    const c = this.c;
    const inp = c.input;
    const kit = c.kit;
    if (kit.mana < 30 || !kit.ready('mend')) return false;
    const hurt = this.game.characters.some(
      (o) => o.alive && o.team === c.team && o.hp < o.maxHp * 0.6 && (o === c || o.pos.distanceTo(c.pos) < 7),
    );
    if (!hurt) return false;
    inp.slot = 2;
    if (kit.slot === 1) inp.fire = inp.firePressed = true;
    return true;
  }

  /**
   * Aim a lobbed throw (speed v, gravity g) at `target`: tries the flat arc, then the high
   * lob if the flat one clips a wall. Returns false if neither gets there.
   */
  lobAt(target, v, g) {
    const c = this.c;
    const eye = c.eye(new THREE.Vector3());
    const dx = target.x - eye.x;
    const dz = target.z - eye.z;
    const x = Math.hypot(dx, dz);
    const y = target.y - eye.y;
    const v2 = v * v;
    const disc = v2 * v2 - g * (g * x * x + 2 * y * v2);
    if (disc < 0 || x < 0.5) return false;
    const yaw = yawTo(dx, dz);
    for (const pitch of [Math.atan((v2 - Math.sqrt(disc)) / (g * x)), Math.atan((v2 + Math.sqrt(disc)) / (g * x))]) {
      if (this.arcLands(eye, yaw, pitch, v, g, target)) {
        c.yaw = yaw;
        c.pitch = pitch;
        return true;
      }
    }
    return false;
  }

  arcLands(from, yaw, pitch, v, g, target) {
    const world = this.game.world;
    const p = from.clone();
    const vel = dirFromYawPitch(yaw, pitch, new THREE.Vector3()).multiplyScalar(v);
    const seg = new THREE.Vector3();
    const dir = new THREE.Vector3();
    for (let i = 0; i < 120; i++) {
      const dt = 0.04;
      vel.y -= g * dt;
      seg.copy(vel).multiplyScalar(dt);
      const len = seg.length();
      dir.copy(seg).divideScalar(len);
      const hit = world.raycast(p, dir, len);
      if (hit) return hit.point.distanceTo(target) < 2.2;
      p.add(seg);
      if (p.distanceTo(target) < 1) return true;
    }
    return false;
  }

  /** Stalk is a toggle on E; press it only when the state needs to change. */
  setStalk(on) {
    const kit = this.c.kit;
    if (kit.stalking !== on && this.time > (this.stalkToggleAt || 0)) {
      this.c.input.abilityPressed = true;
      this.stalkToggleAt = this.time + 0.3;
    }
  }

  fightAssassin(t, dist) {
    const c = this.c;
    const inp = c.input;
    const kit = c.kit;
    if (c.superCharge >= 100 && !c.superActive && Math.random() < 0.1) inp.superPressed = true;
    // pearl up to rooftop targets (and snipers anywhere) instead of walking the long way
    const horiz = Math.hypot(t.pos.x - c.pos.x, t.pos.z - c.pos.z);
    if (!c.superActive && kit.ready('pearl') && horiz > 10 && horiz < 40 && (t.classId === 'sniper' || t.pos.y > c.pos.y + 2.5) && Math.random() < 0.05) {
      const behindT = t.forward(new THREE.Vector3()).multiplyScalar(-1.5).add(t.pos);
      if (this.lobAt(behindT.setY(t.pos.y + 0.3), 30, 18)) {
        inp.itemPressed = true;
        return;
      }
    }
    const err = this.aimAt(this.aimPoint(t));
    const behind = kit.isBehind(t);
    const spotted = this.time - this.lastHurtAt < 1.5;
    if (c.superActive || spotted || dist < 2) {
      // brawl: stand up, close in, slash, lunge
      this.setStalk(false);
      if (dist > 2.3) this.moveTo(t.pos, { face: false });
      else this.strafeAround(t, dist, [1.2, 2.4], 0.6);
      if (dist > 3 && dist < 7 && kit.ready('lunge') && err < 12 * DEG) inp.altPressed = true;
      if (dist < 2.8 && err < 30 * DEG && this.time >= this.reactUntil) inp.fire = true;
      return;
    }
    // stalk: crouch, cloak, and creep around to their back
    this.setStalk(true);
    const back = t.forward(new THREE.Vector3()).multiplyScalar(-1.5).add(t.pos);
    this.moveTo(behind ? t.pos : back, { face: false });
    if (behind && c.cloaked && this.time >= this.reactUntil) {
      if (dist < 2.7 && err < 30 * DEG) inp.fire = true;
      else if (dist < 6.5 && kit.ready('lunge') && err < 10 * DEG) inp.altPressed = true;
    }
  }

  fightSniper(t, dist) {
    const c = this.c;
    const inp = c.input;
    const kit = c.kit;
    if (c.superCharge >= 100) inp.superPressed = true;
    if (dist < 10) {
      // too close: back off and no-scope
      this.strafeAround(t, dist, [14, 40]);
      const err = this.aimAt(this.aimPoint(t));
      if (this.canFire(err, dist, 1.2)) inp.fire = true;
      return;
    }
    if (dist > 70) {
      this.moveTo(t.pos, { face: false });
    } else if (this.time > this.strafeSwitch) {
      this.strafe = Math.random() < 0.4 ? 0 : Math.random() < 0.5 ? 1 : -1;
      this.strafeSwitch = this.time + rand(0.8, 2);
    }
    if (this.strafe) {
      const to = _v.set(t.pos.x - c.pos.x, 0, t.pos.z - c.pos.z).normalize();
      this.setMoveDir(_w.set(-to.z * this.strafe, 0, to.x * this.strafe), 0.5);
    }
    inp.alt = true;
    if (kit.scopeT < 0.9) this.scopedAt = this.time;
    const err = this.aimAt(this.aimPoint(t));
    const settle = this.time - this.scopedAt > 0.35 + this.d.react;
    if (settle && this.canFire(err, dist, 0.8)) inp.fire = true;
  }

  fightEngineer(t, dist) {
    const c = this.c;
    const inp = c.input;
    const kit = c.kit;
    if (c.superCharge >= 100 && dist > 14) {
      inp.superPressed = true;
      return;
    }
    if (this.engineerBuild(true, t)) return;
    this.strafeAround(t, dist, [3, 11]);
    const err = this.aimAt(this.aimPoint(t));
    if (dist < 25 && this.canFire(err, dist, 2)) inp.fire = true;
    if (dist < 2.4 && kit.ammo === 0) inp.alt = true;
  }

  /** Bot building: turret when it has scrap, a wall when under fire. Returns true if it acted. */
  engineerBuild(inCombat, t = null) {
    const c = this.c;
    const kit = c.kit;
    if (kit.drone) return false;
    const wantTurret = !kit.builds.turret && kit.scrap >= 125;
    const wantWall = inCombat && !kit.builds.wall && kit.scrap >= 60 && this.time - this.lastHurtAt < 0.5 && c.hp < c.maxHp * 0.6;
    if (!wantTurret && !wantWall) return false;
    if (!inCombat && Math.random() > 0.01) return false;
    const kind = wantWall ? 'wall' : 'turret';
    const savedPitch = c.pitch;
    const savedYaw = c.yaw;
    if (t) c.yaw = yawTo(t.pos.x - c.pos.x, t.pos.z - c.pos.z);
    c.pitch = -0.55;
    const pl = kit.computePlacement(kind);
    const ok = pl.ok && kit.place(kind, pl);
    c.pitch = savedPitch;
    if (!t) c.yaw = savedYaw;
    return ok;
  }

  /** Engineer upkeep between fights: grab scrap, repair and level up the turret. */
  engineerMaintain() {
    const c = this.c;
    const g = this.game;
    const kit = c.kit;
    if (kit.drone) return false;
    if (kit.scrap < 240) {
      let best = null;
      let bd = 18;
      for (const p of g.pickups) {
        const d = Math.hypot(p.mesh.position.x - c.pos.x, p.mesh.position.z - c.pos.z);
        if (d < bd && Math.abs(p.y - c.pos.y) < 2) {
          bd = d;
          best = p;
        }
      }
      if (best) {
        this.moveTo(best.mesh.position);
        return true;
      }
    }
    const tur = kit.builds.turret;
    if (!tur || !tur.alive) return false;
    if (!(tur.hp < tur.maxHp || (tur.level < 3 && kit.scrap >= 25))) return false;
    const d = Math.hypot(tur.pos.x - c.pos.x, tur.pos.z - c.pos.z);
    if (d > 25) return false;
    if (d > 2) {
      this.moveTo(tur.pos);
      return true;
    }
    this.aimAt(tur.center());
    if (kit.ready('wrench')) c.input.alt = true;
    return true;
  }

  fightGunslinger(t, dist) {
    const c = this.c;
    const inp = c.input;
    const kit = c.kit;
    if (c.superCharge >= 100 && dist < 45) inp.superPressed = true;
    if (c.superActive) {
      this.strafeAround(t, dist, [6, 25]);
      this.aimAt(this.aimPoint(t));
      if (this.time > this.clickAt && this.time >= this.reactUntil) {
        this.clickAt = this.time + rand(0.14, 0.22);
        inp.firePressed = inp.fire = true;
      }
      return;
    }
    this.strafeAround(t, dist, [7, 20]);
    // cook a grenade just long enough to reach the target, then release
    if (!this.nade && kit.grenades > 0 && kit.ready('grenade') && dist > 7 && dist < 30 && Math.random() < 0.012) {
      const horiz = Math.hypot(t.pos.x - c.pos.x, t.pos.z - c.pos.z);
      const v = clamp(Math.sqrt(20 * horiz * 1.15), 12, 32);
      const power = (v - 12) / 20;
      this.nade = { until: this.time + power * 1.1 + 0.05, v };
    }
    if (this.nade) {
      if (!this.lobAt(t.pos.clone().setY(t.pos.y + 0.3), this.nade.v, 20)) this.aimAt(this.aimPoint(t));
      if (this.time < this.nade.until) inp.alt = true;
      else this.nade = null;
      return;
    }
    const err = this.aimAt(this.aimPoint(t));
    if (this.canFire(err, dist)) inp.fire = true;
    if (this.time - this.lastHurtAt < 0.3 && kit.ready('roll') && Math.random() < 0.25) inp.abilityPressed = true;
  }

  // ------------------------------------------------------------------ drone piloting
  pilotDrone() {
    const c = this.c;
    const g = this.game;
    const inp = c.input;
    const drone = c.kit.drone;
    let best = null;
    let bd = Infinity;
    for (const e of g.enemiesOf(c.team)) {
      if (e.cloaked) continue;
      const d = e.pos.distanceTo(drone.pos);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (!best) {
      inp.mz = 1;
      return;
    }
    const p = best.chest(_v);
    const horiz = Math.hypot(p.x - drone.pos.x, p.z - drone.pos.z);
    const los = g.world.lineOfSight(drone.pos, p);
    let aimY = p.y;
    if (!los && horiz > 6) aimY = Math.max(drone.pos.y, 10);
    const dx = p.x - drone.pos.x;
    const dz = p.z - drone.pos.z;
    const dy = aimY - drone.pos.y;
    this.turnTo(yawTo(dx, dz), pitchTo(dx, dy, dz), 1.5);
    inp.mz = 1;
    if (!los && drone.pos.y < 9) inp.jump = true;
    const flying = c.superTime < c.def.superDuration - 1.5;
    if (los && bd < 12 && flying) inp.altPressed = true;
    else if (los && bd < 35) inp.fire = true;
  }
}

