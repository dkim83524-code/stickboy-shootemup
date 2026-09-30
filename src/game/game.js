import * as THREE from 'three';
import { World } from '../world/world.js';
import { NavGrid } from '../world/nav.js';
import { Character } from '../entities/character.js';
import { Effects } from '../entities/effects.js';
import { Projectiles } from '../entities/projectiles.js';
import { Stickman } from '../entities/stickman.js';
import { KITS } from '../classes/index.js';
import { CLASS_ORDER, BOT_NAMES } from '../classes/defs.js';
import { BotBrain } from '../ai/bot.js';
import { sfx } from '../core/audio.js';
import { clamp, shuffle, lerp, damp, rand } from '../core/utils.js';
import { toonMat, addOutline } from '../core/toon.js';

const gearGeo = new THREE.TorusGeometry(0.2, 0.08, 6, 10);
const boltGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);

export const TEAM_SIZE = 5;
export const SCORE_LIMIT = 40;
export const MATCH_TIME = 8 * 60;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();

export class Game {
  constructor({ scene, camera, vmScene, vmCamera, hud }) {
    this.scene = scene;
    this.camera = camera;
    this.vmScene = vmScene;
    this.vmCamera = vmCamera;
    this.hud = hud;
    this.KITS = KITS;
    this.world = new World(scene);
    this.addStatue();
    this.nav = new NavGrid(this.world);
    this.effects = new Effects(scene);
    this.projectiles = new Projectiles(this);
    this.characters = [];
    this.deployables = [];
    this.drones = [];
    this.zones = [];
    this.pickups = [];
    this.time = 0;
    this.state = 'menu';
    this.scores = [0, 0];
    this.timeLeft = MATCH_TIME;
    this.player = null;
    this.viewer = null;
    this.cameraMode = 'menu';
    this.shakeAmt = 0;
    this.viewPunchAmt = 0;
    this.bobPhase = 0;
    this.sway = { x: 0, y: 0 };
    this.vmKit = null;
    this.settings = { difficulty: 'normal', fov: 85, sensitivity: 1, volume: 0.6 };
    this.winner = null;
    this.menuT = 0;
    this.scoreLimit = SCORE_LIMIT;
  }

  addStatue() {
    const s = new Stickman({ color: 0xe9e3d3, hat: 'crown', outline: 0.022 });
    s.root.scale.setScalar(2.3);
    s.root.position.set(0, 1.8, 0);
    s.root.rotation.y = Math.PI / 2;
    s.arms.R.sh.rotation.set(Math.PI * 0.95, 0, -0.25);
    s.arms.L.sh.rotation.set(0.2, 0, 0.5);
    s.arms.L.elbow.rotation.x = 1.4;
    s.legs.L.hip.rotation.x = 0.35;
    s.legs.R.hip.rotation.x = -0.2;
    s.legs.R.knee.rotation.x = -0.4;
    s.root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    this.scene.add(s.root);
    this.world.addStatic({ minX: -0.45, minY: 1.8, minZ: -0.45, maxX: 0.45, maxY: 6.2, maxZ: 0.45 });
  }

  // ---------------------------------------------------------------- match flow
  startMatch({ playerClass, difficulty = 'normal', autoplay = false }) {
    this.clearMatch();
    this.settings.difficulty = difficulty;
    this.time = 0;
    this.scores = [0, 0];
    this.timeLeft = MATCH_TIME;
    this.winner = null;
    const names = shuffle([...BOT_NAMES]);
    const player = new Character(this, { name: 'You', team: 0, classId: playerClass, isPlayer: true });
    if (autoplay) {
      player.brain = new BotBrain(player, this, difficulty);
      player.name = 'You (auto)';
    }
    this.player = player;
    this.viewer = player;
    this.characters.push(player);
    // 5v5: you + 4 bots vs 5 bots, no repeated class within a team
    const blue = shuffle(CLASS_ORDER.filter((c) => c !== playerClass)).slice(0, TEAM_SIZE - 1);
    const red = shuffle([...CLASS_ORDER]).slice(0, TEAM_SIZE);
    for (const [team, list] of [[0, blue], [1, red]]) {
      for (const cls of list) {
        const bot = new Character(this, { name: names.pop(), team, classId: cls });
        bot.brain = new BotBrain(bot, this, difficulty);
        this.characters.push(bot);
      }
    }
    for (const c of this.characters) this.spawnCharacter(c);
    this.state = 'playing';
    this.cameraMode = 'first';
    this.hud.resetMatch(this);
  }

  clearMatch() {
    for (const c of this.characters) c.dispose();
    this.characters = [];
    for (const d of this.deployables) d.remove();
    this.deployables = [];
    for (const d of [...this.drones]) d.cleanup();
    this.drones = [];
    for (const z of this.zones) z.marker.remove();
    this.zones = [];
    for (const p of this.pickups) this.scene.remove(p.mesh);
    this.pickups = [];
    this.projectiles.clear();
    this.effects.clear();
    sfx.stopAllLoops();
    if (this.vmKit) this.vmKit.removeViewmodel();
    this.vmKit = null;
    this.player = null;
    this.viewer = null;
  }

  spawnCharacter(c) {
    const pts = this.world.spawns[c.team];
    const free = pts.filter((p) => this.characters.every((o) => o === c || !o.alive || o.pos.distanceTo(p) > 1.5));
    const list = free.length ? free : pts;
    const p = list[Math.floor(Math.random() * list.length)];
    const yaw = c.team === 0 ? -Math.PI / 2 : Math.PI / 2;
    c.spawn(p, yaw + rand(-0.2, 0.2));
    if (c.brain) c.brain.onSpawn();
  }

  endMatch() {
    this.state = 'ended';
    this.winner = this.scores[0] === this.scores[1] ? -1 : this.scores[0] > this.scores[1] ? 0 : 1;
    sfx.stopAllLoops();
  }

  isLocal(c) {
    return !!c && c === this.player;
  }

  enemiesOf(team) {
    return this.characters.filter((c) => c.alive && c.team !== team);
  }

  // ---------------------------------------------------------------- per-frame
  update(dt) {
    if (this.state !== 'playing') {
      this.effects.update(dt);
      return;
    }
    this.time += dt;
    this.timeLeft -= dt;
    this.frameDt = dt;

    for (const c of this.characters) {
      if (!c.alive && this.time >= c.respawnAt) this.spawnCharacter(c);
    }
    for (const c of this.characters) if (c.brain && c.alive) c.brain.update(dt);
    for (const c of this.characters) c.update(dt);
    this.separate();

    for (let i = this.deployables.length - 1; i >= 0; i--) {
      const d = this.deployables[i];
      if (!d.alive) this.deployables.splice(i, 1);
      else d.update(dt);
    }
    this.projectiles.update(dt);
    this.updateZones(dt);
    this.updatePickups(dt);
    this.effects.update(dt);
    for (const c of this.characters) c.syncModel(dt);

    if (this.scores[0] >= SCORE_LIMIT || this.scores[1] >= SCORE_LIMIT || this.timeLeft <= 0) this.endMatch();
  }

  separate() {
    const cs = this.characters;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j];
        if (!b.alive) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 1.7) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = a.radius + b.radius;
        if (d < min && d > 1e-4) {
          const push = (min - d) / 2;
          a.shove((-dx / d) * push, (-dz / d) * push);
          b.shove((dx / d) * push, (dz / d) * push);
        }
      }
    }
  }

  // ---------------------------------------------------------------- combat queries
  hitscan(shooter, origin, dir, range, { ignore = null } = {}) {
    const w = this.world.raycast(origin, dir, range, { ignore });
    let best = null;
    let bestT = range;
    if (w) {
      bestT = w.dist;
      const o = w.owner;
      best = { dist: w.dist, point: w.point, normal: w.normal, target: o && o.alive && o.team !== shooter.team ? o : null };
    }
    for (const c of this.characters) {
      if (!c.alive || c.team === shooter.team) continue;
      const r = c.rayTest(origin, dir, bestT);
      if (r && r.t < bestT) {
        bestT = r.t;
        best = { dist: r.t, point: origin.clone().addScaledVector(dir, r.t), normal: dir.clone().negate(), target: c, head: r.head };
      }
    }
    for (const d of this.drones) {
      if (!d.alive || d.team === shooter.team) continue;
      const r = d.rayTest(origin, dir, bestT);
      if (r && r.t < bestT) {
        bestT = r.t;
        best = { dist: r.t, point: origin.clone().addScaledVector(dir, r.t), normal: dir.clone().negate(), target: d };
      }
    }
    return best;
  }

  /** Swept sphere test for projectiles. */
  sweep(owner, pos, dir, len, radius) {
    const w = this.world.raycast(pos, dir, len);
    let best = null;
    let bestT = len;
    if (w) {
      bestT = w.dist;
      const o = w.owner;
      best = { dist: w.dist, point: w.point, normal: w.normal, target: o && o.alive && o.team !== owner.team ? o : null };
    }
    for (const c of this.characters) {
      if (!c.alive || c.team === owner.team) continue;
      const r = c.rayTest(pos, dir, bestT, radius);
      if (r && r.t < bestT) {
        bestT = r.t;
        best = { dist: r.t, point: pos.clone().addScaledVector(dir, r.t), normal: dir.clone().negate(), target: c, head: r.head };
      }
    }
    for (const d of this.drones) {
      if (!d.alive || d.team === owner.team) continue;
      const r = d.rayTest(pos, dir, bestT, radius);
      if (r && r.t < bestT) {
        bestT = r.t;
        best = { dist: r.t, point: pos.clone().addScaledVector(dir, r.t), normal: dir.clone().negate(), target: d };
      }
    }
    return best;
  }

  fireBullet(shooter, o) {
    const hit = this.hitscan(shooter, o.origin, o.dir, o.range, { ignore: o.ignore });
    const end = hit ? hit.point : o.origin.clone().addScaledVector(o.dir, o.range);
    if (o.from) this.effects.tracer(o.from, end, { color: o.tracer ?? 0xfff2a8, width: o.tracerWidth ?? 0.03, life: o.tracerLife ?? 0.07 });
    if (!hit) return null;
    if (hit.target) {
      let dmg = o.damage;
      if (o.falloff) {
        const [s, e, m] = o.falloff;
        if (hit.dist > s) dmg *= lerp(1, m, clamp((hit.dist - s) / (e - s), 0, 1));
      }
      if (hit.head) dmg *= o.headMult ?? 2;
      this.damage(hit.target, dmg, shooter, { weapon: o.weapon, headshot: !!hit.head, dir: o.dir, point: hit.point, crit: o.crit, source: o.source });
      this.effects.burst(hit.point, { count: 5, color: [0x14121a, 0xffffff], speed: 4, size: 0.07, life: 0.3 });
    } else {
      const k = o.impactScale || 1;
      this.effects.burst(hit.point, { count: Math.round(3 * k), color: [0xffffff, 0x14121a], speed: 3 * k, size: 0.05 * k, life: 0.3, normal: hit.normal });
      if (o.ricochet > 0 && hit.normal) {
        const r = o.dir.clone().reflect(hit.normal);
        this.fireBullet(shooter, {
          ...o,
          origin: hit.point.clone().addScaledVector(hit.normal, 0.03),
          dir: r,
          range: Math.min(40, o.range - hit.dist),
          damage: o.damage * 0.8,
          ricochet: o.ricochet - 1,
          from: hit.point.clone(),
          falloff: null,
        });
        sfx.play('ricochet', { pos: hit.point, volume: 0.5 });
      }
    }
    return hit;
  }

  /** Enemies (characters, builds, drones) in a melee cone in front of `c`, nearest first. */
  meleeSweep(c, range, coneDeg) {
    const eye = c.eye(_a);
    const aim = c.aim(_v);
    const fx = aim.x;
    const fz = aim.z;
    const fl = Math.hypot(fx, fz) || 1;
    const cosHalf = Math.cos((coneDeg / 2) * (Math.PI / 180));
    const out = [];
    const consider = (t, p, vertical) => {
      const dx = p.x - eye.x;
      const dz = p.z - eye.z;
      const dh = Math.hypot(dx, dz);
      const d = Math.hypot(dh, p.y - eye.y);
      if (d > range + 0.35) return;
      if (Math.abs(p.y - eye.y) > vertical) return;
      if (dh > 0.7 && (dx * fx + dz * fz) / (dh * fl) < cosHalf) return;
      if (!this.world.lineOfSight(eye, p)) return;
      out.push({ t, d });
    };
    for (const e of this.characters) {
      if (!e.alive || e.team === c.team) continue;
      consider(e, e.chest(_w).clone(), 2.0);
    }
    for (const d of this.deployables) {
      if (!d.alive || d.team === c.team) continue;
      consider(d, d.center(), 2.5);
    }
    for (const d of this.drones) {
      if (!d.alive || d.team === c.team) continue;
      consider(d, d.pos.clone(), 2.5);
    }
    out.sort((a, b) => a.d - b.d);
    return out.map((o) => o.t);
  }

  damage(target, amount, attacker, info = {}) {
    if (!target || !target.alive || amount <= 0) return 0;
    if (attacker && target.team === attacker.team && target !== attacker) return 0;
    const byPlayer = attacker === this.player;

    if (!target.isCharacter) {
      target.hp -= amount;
      if (attacker && attacker.kit) attacker.kit.onDealtDamage(amount * 0.5, target, info);
      if (byPlayer) this.hud.hitmarker(false, target.hp <= 0);
      if (target.hp <= 0) target.destroy(attacker);
      return amount;
    }

    if (this.time < target.protectUntil) return 0;
    if (target.kit.isInvulnerable(info)) {
      target.kit.onDodged(attacker);
      return 0;
    }
    if (!info.trueDamage) amount *= target.kit.damageTakenMul(info);
    const dealt = Math.min(amount, target.hp);
    target.hp -= amount;
    target.lastDamageTime = this.time;
    target.hitFlash = 0.1;
    if (attacker && attacker !== target) target.lastAttacker = attacker;
    target.kit.onTookDamage(dealt, attacker, info);
    if (info.knock) target.knock(info.knock);
    if (info.stun) target.stunUntil = Math.max(target.stunUntil, this.time + info.stun);
    if (info.slow) {
      target.slowUntil = this.time + info.slow.time;
      target.slowAmt = info.slow.amount;
    }
    if (attacker && attacker !== target && attacker.kit) {
      attacker.kit.onDealtDamage(dealt, target, info);
      attacker.damageDealt += dealt;
    }
    if (target.brain) target.brain.onDamaged(attacker);
    const killed = target.hp <= 0;
    if (byPlayer) {
      target.lastHitByPlayer = this.time;
      this.hud.hitmarker(info.headshot || info.crit || info.backstab, killed);
      sfx.play(info.headshot || info.crit ? 'headshot' : 'hit', { volume: 0.8 });
    }
    if (target === this.player) {
      const src = attacker && attacker.pos ? attacker.pos : info.point || null;
      this.hud.damaged(src, dealt);
      sfx.play('hurt', { volume: 0.6 });
      this.shakeAmt = Math.max(this.shakeAmt, Math.min(0.5, dealt / 120));
    }
    if (killed) this.kill(target, attacker, info);
    return dealt;
  }

  // ---------------------------------------------------------------- scrap pickups
  /** Scrap drops where anyone dies or a build breaks; Engineers walk over it to collect. */
  dropScrap(pos, amount) {
    const mesh = new THREE.Group();
    const gear = new THREE.Mesh(gearGeo, toonMat(0x9aa3ad));
    addOutline(gear, 0.025);
    const bolt = new THREE.Mesh(boltGeo, toonMat(0xf4a300));
    addOutline(bolt, 0.02);
    bolt.position.set(0.18, 0.1, 0);
    mesh.add(gear, bolt);
    const ground = this.world.groundHeight(pos.x, pos.z, pos.y + 0.5);
    mesh.position.set(pos.x, ground + 0.4, pos.z);
    this.scene.add(mesh);
    this.pickups.push({ mesh, amount, life: 25, y: ground + 0.4 });
  }

  updatePickups(dt) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.life -= dt;
      p.mesh.rotation.y += dt * 2.5;
      p.mesh.position.y = p.y + Math.sin(this.time * 3 + i) * 0.08;
      let taken = p.life <= 0;
      if (!taken) {
        for (const c of this.characters) {
          if (!c.alive || c.classId !== 'engineer') continue;
          if (Math.hypot(c.pos.x - p.mesh.position.x, c.pos.z - p.mesh.position.z) > 1.4 || Math.abs(c.pos.y - p.y) > 2) continue;
          if (!c.kit.collectScrap(p.amount)) continue;
          taken = true;
          sfx.play('build', { pos: c.pos, volume: 0.6, rate: 1.6 });
          if (this.isLocal(c)) this.hud.notify(`+${p.amount} SCRAP`, 'good');
          break;
        }
      }
      if (taken) {
        this.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
      }
    }
  }

  /** Restore health (capped). Returns the amount actually healed. */
  heal(target, amount, healer = null) {
    if (!target || !target.alive || !target.isCharacter) return 0;
    const healed = Math.min(amount, target.maxHp - target.hp);
    if (healed <= 0) return 0;
    target.hp += healed;
    if (healer) healer.healingDone = (healer.healingDone || 0) + healed;
    if (target === this.player && healer !== target) this.hud.healed(healed);
    return healed;
  }

  kill(victim, killer, info) {
    victim.die(killer, info);
    this.dropScrap(victim.pos, 30);
    victim.killedBy = killer;
    const credited = killer && killer !== victim && killer.team !== victim.team;
    if (credited) {
      killer.kills++;
      this.scores[killer.team]++;
      killer.kit.onKill(victim);
      if (killer.brain) killer.brain.onKill(victim);
    }
    this.hud.killfeed({ killer: credited ? killer : null, victim, weapon: info.weapon || '', headshot: !!info.headshot, backstab: !!info.backstab && !info.partial });
    if (killer === this.player && credited) {
      sfx.play('kill', { volume: 0.8 });
      const tag = info.backstab ? 'BACKSTAB! ' : info.headshot ? 'HEADSHOT! ' : '';
      this.hud.notify(`${tag}ELIMINATED ${victim.name.toUpperCase()}`, info.backstab || info.headshot ? 'big' : 'kill');
    }
  }

  explode(pos, radius, damage, attacker, { minMul = 0.3, knockOut = 8, knockUp = 6, stun = 0, weapon = 'Explosion', visual = true, color = 0xff9f1c } = {}) {
    if (visual) {
      this.effects.explosion(pos, radius * 0.75, { color });
      sfx.play('explosion', { pos, volume: 1.2 });
    }
    const origin = _a.copy(pos);
    origin.y += 0.4;
    const hitOne = (t, p) => {
      const d = p.distanceTo(pos);
      if (d > radius) return;
      if (!this.world.lineOfSight(origin, p)) return;
      const mul = lerp(1, minMul, d / radius);
      const dir = new THREE.Vector3(p.x - pos.x, 0, p.z - pos.z);
      if (dir.lengthSq() < 1e-4) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      dir.normalize();
      const knock = t.isCharacter ? dir.clone().multiplyScalar(knockOut * mul).setY(knockUp * mul) : null;
      this.damage(t, damage * mul, attacker, { weapon, knock, stun, explosive: true, dir });
    };
    for (const c of this.characters) {
      if (!c.alive || c.team === attacker.team) continue;
      hitOne(c, c.chest(_w).clone());
    }
    for (const d of this.deployables) {
      if (!d.alive || d.team === attacker.team) continue;
      hitOne(d, d.center());
    }
    for (const d of [...this.drones]) {
      if (!d.alive || d.team === attacker.team) continue;
      hitOne(d, d.pos.clone());
    }
  }

  /** Damage-over-time area (meteor fire, poison pools). */
  addZone({ pos, radius, dps, time, owner, weapon, color = 0xff5a1f, particles = [0xff5a1f, 0xffd23f, 0xff9f1c] }) {
    const marker = this.effects.marker(pos, radius, color);
    this.zones.push({ pos, radius, dps, time, owner, weapon, particles, tick: 0, marker });
  }

  updateZones(dt) {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.time -= dt;
      z.tick -= dt;
      if (Math.random() < 0.8) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * z.radius;
        const p = _v.set(z.pos.x + Math.cos(a) * r, z.pos.y + 0.1, z.pos.z + Math.sin(a) * r);
        this.effects.burst(p, { count: 1, color: z.particles, speed: 1, size: 0.18, life: 0.6, gravity: -6 });
      }
      if (z.tick <= 0) {
        z.tick = 0.25;
        for (const c of this.characters) {
          if (!c.alive || c.team === z.owner.team) continue;
          if (Math.hypot(c.pos.x - z.pos.x, c.pos.z - z.pos.z) < z.radius && Math.abs(c.pos.y - z.pos.y) < 2) {
            this.damage(c, z.dps * 0.25, z.owner, { weapon: z.weapon });
          }
        }
      }
      z.marker.group.children[0].material.opacity = Math.min(0.8, z.time);
      if (z.time <= 0) {
        z.marker.remove();
        this.zones.splice(i, 1);
      }
    }
  }

  shake(c, amt) {
    if (this.isLocal(c)) this.shakeAmt = Math.max(this.shakeAmt, amt);
  }

  shakeAll(pos, amt) {
    const p = this.player;
    if (!p) return;
    const d = p.pos.distanceTo(pos);
    const k = clamp(1 - d / 40, 0, 1);
    this.shakeAmt = Math.max(this.shakeAmt, amt * k);
  }

  punchView(a) {
    this.viewPunchAmt += a;
  }

  // ---------------------------------------------------------------- camera + viewmodel
  updateCamera(dt) {
    const cam = this.camera;
    const p = this.player;
    this.shakeAmt = damp(this.shakeAmt, 0, 6, dt);
    this.viewPunchAmt = damp(this.viewPunchAmt, 0, 10, dt);
    if (this.state === 'menu' || !p) {
      this.menuT += dt;
      const a = this.menuT * 0.05;
      cam.position.set(Math.cos(a) * 55, 26, Math.sin(a) * 40);
      cam.lookAt(0, 3, 0);
      this.setFov(70, dt);
      this.cameraMode = 'menu';
      if (this.vmKit) {
        this.vmKit.removeViewmodel();
        this.vmKit = null;
      }
      return;
    }

    if (this.vmKit !== p.kit) {
      if (this.vmKit) this.vmKit.removeViewmodel();
      p.kit.ensureViewmodel(this.vmScene);
      this.vmKit = p.kit;
    }

    const drone = p.alive && p.kit.drone && p.kit.drone.alive ? p.kit.drone : null;
    let fov = this.settings.fov;
    for (const d of this.drones) d.group.visible = d !== drone;
    if (drone) {
      this.cameraMode = 'drone';
      cam.position.copy(drone.pos);
      cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
    } else if (p.alive) {
      this.cameraMode = 'first';
      p.eye(cam.position);
      const hs = Math.hypot(p.vel.x, p.vel.z);
      const amt = p.grounded ? clamp(hs / 7, 0, 1) : 0;
      this.bobPhase += dt * hs * 1.3;
      cam.position.y += Math.abs(Math.sin(this.bobPhase)) * 0.04 * amt;
      cam.rotation.set(p.pitch + this.viewPunchAmt, p.yaw, Math.sin(this.bobPhase) * 0.004 * amt, 'YXZ');
      const z = p.kit.zoom ? p.kit.zoom() : null;
      if (z && z.t > 0) fov = lerp(fov, z.fov, z.t);
      fov += p.kit.fovBoost();
    } else {
      this.cameraMode = 'death';
      const k = p.killedBy && p.killedBy.alive ? p.killedBy : null;
      const target = k ? k.chest(_w) : _w.copy(p.pos).setY(p.pos.y + 1);
      const want = _v.copy(p.pos).add(_a.set(0, 5, 0));
      cam.position.lerp(want, 1 - Math.exp(-3 * dt));
      const m = new THREE.Matrix4().lookAt(cam.position, target, cam.up);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      cam.quaternion.slerp(q, 1 - Math.exp(-4 * dt));
    }
    if (this.shakeAmt > 0.01 && this.cameraMode !== 'death') {
      const s = this.shakeAmt * 0.12;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }
    this.setFov(fov, dt);
    sfx.setListener(cam.position, p.yaw);

    // viewmodel
    const kit = p.kit;
    if (kit.vmRoot) {
      kit.vmRoot.visible = this.cameraMode === 'first';
      const hs = Math.hypot(p.vel.x, p.vel.z);
      const amt = p.grounded ? clamp(hs / 7, 0, 1) : 0.2;
      const bobX = Math.sin(this.bobPhase) * 0.012 * amt;
      const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.012 * amt + (p.grounded ? 0 : 0.01);
      this.sway.x = damp(this.sway.x, 0, 8, dt);
      this.sway.y = damp(this.sway.y, 0, 8, dt);
      if (this.cameraMode === 'first') kit.updateViewmodel(dt, bobX, bobY, this.sway.x, this.sway.y);
    }
  }

  addSway(dx, dy) {
    this.sway.x = clamp(this.sway.x - dx * 0.00012, -0.03, 0.03);
    this.sway.y = clamp(this.sway.y + dy * 0.00012, -0.03, 0.03);
  }

  setFov(target, dt) {
    const cam = this.camera;
    const f = damp(cam.fov, target, 18, dt);
    if (Math.abs(f - cam.fov) > 0.01) {
      cam.fov = f;
      cam.updateProjectionMatrix();
    }
  }
}
