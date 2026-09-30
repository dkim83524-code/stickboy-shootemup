import * as THREE from 'three';
import { toonMat, addOutline } from '../core/toon.js';
import { TEAM_COLORS } from '../classes/defs.js';
import { sfx } from '../core/audio.js';
import { applySpread, yawTo, pitchTo, angleDiff, DEG, dirFromYawPitch } from '../core/utils.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

function inkMesh(geo, color, outline = 0.03) {
  const m = new THREE.Mesh(geo, toonMat(color));
  m.castShadow = true;
  m.receiveShadow = true;
  if (outline) addOutline(m, outline);
  return m;
}

export const BUILDS = [
  { id: 'turret', name: 'Turret', cost: 125, size: [0.9, 1.3, 0.9] },
  { id: 'wall', name: 'Cover Wall', cost: 60, size: [4, 2.6, 0.5] },
  { id: 'pad', name: 'Jump Pad', cost: 50, size: [1.9, 0.22, 1.9] },
];

/** Footprint box for a build placed at `pos` (feet) facing `yaw`. */
export function buildBox(kind, pos, yaw) {
  const def = BUILDS.find((b) => b.id === kind);
  let [w, h, d] = def.size;
  if (kind === 'wall') {
    const fx = Math.abs(Math.sin(yaw));
    const fz = Math.abs(Math.cos(yaw));
    if (fx > fz) [w, d] = [d, w];
  }
  return { minX: pos.x - w / 2, minY: pos.y, minZ: pos.z - d / 2, maxX: pos.x + w / 2, maxY: pos.y + h, maxZ: pos.z + d / 2 };
}

export function buildModel(kind, team, ghostMat = null) {
  const g = new THREE.Group();
  const tc = TEAM_COLORS[team];
  const mk = (geo, color, outline) => {
    if (ghostMat) return new THREE.Mesh(geo, ghostMat);
    return inkMesh(geo, color, outline);
  };
  if (kind === 'turret') {
    const base = mk(new THREE.CylinderGeometry(0.42, 0.5, 0.35, 12), 0x3d4250, 0.03);
    base.position.y = 0.175;
    g.add(base);
    const post = mk(new THREE.CylinderGeometry(0.1, 0.1, 0.6, 8), 0x6c7384, 0.02);
    post.position.y = 0.6;
    g.add(post);
    const head = new THREE.Group();
    head.position.y = 1.0;
    const shell = mk(new THREE.BoxGeometry(0.55, 0.36, 0.6), tc, 0.03);
    head.add(shell);
    const barrel = mk(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8).rotateX(Math.PI / 2), 0x2b2b2b, 0.02);
    barrel.position.z = -0.5;
    head.add(barrel);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), ghostMat || new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
    eye.position.set(0, 0.06, -0.31);
    head.add(eye);
    g.add(head);
    g.userData.head = head;
  } else if (kind === 'wall') {
    const panel = mk(new THREE.BoxGeometry(4, 2.6, 0.5), 0x9aa3ad, 0.05);
    panel.position.y = 1.3;
    g.add(panel);
    const stripe = mk(new THREE.BoxGeometry(4.02, 0.3, 0.52), tc, 0);
    stripe.position.y = 2.2;
    g.add(stripe);
    const stripe2 = mk(new THREE.BoxGeometry(4.02, 0.12, 0.52), 0xf4b400, 0);
    stripe2.position.y = 0.5;
    g.add(stripe2);
  } else if (kind === 'pad') {
    const disc = mk(new THREE.CylinderGeometry(0.95, 1.0, 0.22, 20), 0x3d4250, 0.03);
    disc.position.y = 0.11;
    g.add(disc);
    const top = mk(new THREE.CylinderGeometry(0.75, 0.75, 0.04, 20), tc, 0);
    top.position.y = 0.23;
    g.add(top);
    const arrow = mk(new THREE.ConeGeometry(0.35, 0.5, 3), 0xf6f1e3, 0.02);
    arrow.position.y = 0.55;
    g.add(arrow);
    g.userData.arrow = arrow;
  }
  return g;
}

export class Deployable {
  constructor(game, owner, kind, pos, yaw) {
    this.game = game;
    this.owner = owner;
    this.team = owner.team;
    this.kind = kind;
    this.isDeployable = true;
    this.name = BUILDS.find((b) => b.id === kind).name;
    this.pos = pos.clone();
    this.yaw = yaw;
    this.alive = true;
    this.maxHp = { turret: 150, wall: 400, pad: 100 }[kind];
    this.hp = this.maxHp;
    this.buildT = 0;
    this.group = buildModel(kind, this.team);
    this.group.position.copy(pos);
    if (kind === 'turret') this.group.rotation.y = 0;
    if (kind === 'wall') {
      const fx = Math.abs(Math.sin(yaw));
      const fz = Math.abs(Math.cos(yaw));
      this.group.rotation.y = fx > fz ? Math.PI / 2 : 0;
    }
    game.scene.add(this.group);
    this.box = buildBox(kind, pos, yaw);
    this.box.owner = this;
    game.world.addDynamic(this.box);
    this.aimYaw = yaw;
    this.aimPitch = 0;
    this.target = null;
    this.nextScan = 0;
    this.nextShot = 0;
    this.padCd = new Map();
  }

  center(out = new THREE.Vector3()) {
    return out.set(this.pos.x, (this.box.minY + this.box.maxY) / 2, this.pos.z);
  }

  get time() {
    return this.game.time;
  }

  update(dt) {
    if (!this.alive) return;
    if (this.buildT < 1) {
      this.buildT = Math.min(1, this.buildT + dt / 0.7);
      const s = 0.2 + 0.8 * this.buildT;
      this.group.scale.set(1, s, 1);
      return;
    }
    if (this.kind === 'turret') this.updateTurret(dt);
    else if (this.kind === 'pad') this.updatePad(dt);
  }

  updateTurret(dt) {
    const g = this.game;
    const head = this.group.userData.head;
    const eye = _v.set(this.pos.x, this.pos.y + 1.05, this.pos.z);
    if (this.time >= this.nextScan) {
      this.nextScan = this.time + 0.25;
      this.target = null;
      let best = 30;
      for (const e of g.enemiesOf(this.team)) {
        if (e.cloaked && e.pos.distanceTo(this.pos) > 2.5) continue;
        const p = e.chest(_w);
        const d = p.distanceTo(eye);
        if (d < best && g.world.lineOfSight(eye, p, false)) {
          best = d;
          this.target = e;
        }
      }
      for (const dr of g.drones) {
        if (!dr.alive || dr.team === this.team) continue;
        const d = dr.pos.distanceTo(eye);
        if (d < best && g.world.lineOfSight(eye, dr.pos, false)) {
          best = d;
          this.target = dr;
        }
      }
    }
    const t = this.target;
    if (t && t.alive) {
      const p = t.isCharacter ? t.chest(_w) : _w.copy(t.pos);
      const dy = yawTo(p.x - eye.x, p.z - eye.z);
      const dp = pitchTo(p.x - eye.x, p.y - eye.y, p.z - eye.z);
      const turn = 5 * dt;
      const ey = angleDiff(this.aimYaw, dy);
      this.aimYaw += Math.max(-turn, Math.min(turn, ey));
      this.aimPitch += Math.max(-turn, Math.min(turn, dp - this.aimPitch));
      if (Math.abs(ey) < 8 * DEG && this.time >= this.nextShot) {
        this.nextShot = this.time + 0.16;
        const dir = applySpread(dirFromYawPitch(this.aimYaw, this.aimPitch), 2.2 * DEG);
        const muzzle = eye.clone().addScaledVector(dir, 0.75);
        g.fireBullet(this.owner, {
          origin: muzzle,
          dir,
          range: 34,
          damage: 10,
          headMult: 1.5,
          tracer: 0xffa94d,
          tracerWidth: 0.03,
          from: muzzle,
          weapon: 'Turret',
          ignore: this,
          source: this,
        });
        sfx.play('turret', { pos: this.pos, volume: 0.5 });
        g.effects.flash(muzzle, { color: 0xffd23f, size: 0.1, life: 0.04 });
      }
    } else {
      this.aimYaw += dt * 0.6;
    }
    head.rotation.set(this.aimPitch, this.aimYaw, 0, 'YXZ');
  }

  updatePad(dt) {
    const arrow = this.group.userData.arrow;
    arrow.position.y = 0.55 + Math.sin(this.time * 4) * 0.08;
    arrow.rotation.y += dt * 2;
    const top = this.box.maxY;
    for (const c of this.game.characters) {
      if (!c.alive || c.team !== this.team) continue;
      if (Math.hypot(c.pos.x - this.pos.x, c.pos.z - this.pos.z) > 1.05) continue;
      if (Math.abs(c.pos.y - top) > 0.35) continue;
      if ((this.padCd.get(c.id) || 0) > this.time) continue;
      this.padCd.set(c.id, this.time + 0.6);
      c.vel.y = 22;
      c.vel.x *= 1.3;
      c.vel.z *= 1.3;
      c.grounded = false;
      c.forced = null;
      sfx.play('pad', { pos: this.pos, volume: 0.9 });
      this.game.effects.ring(this.pos, { color: TEAM_COLORS[this.team], radius: 2.2, life: 0.4 });
    }
  }

  repair(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  destroy() {
    if (!this.alive) return;
    this.remove();
    this.game.effects.explosion(this.center(), 2.2, { color: 0xffa94d });
    sfx.play('explosion', { pos: this.pos, volume: 0.6, rate: 1.4 });
  }

  remove() {
    if (!this.alive) return;
    this.alive = false;
    this.game.scene.remove(this.group);
    this.game.world.removeDynamic(this.box);
    if (this.owner.kit.onBuildGone) this.owner.kit.onBuildGone(this);
  }
}
