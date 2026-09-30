import * as THREE from 'three';
import { Kit, cylMesh, mesh, vmArm } from './kit.js';
import { sfx } from '../core/audio.js';
import { addOutline, toonMat } from '../core/toon.js';
import { clamp, DEG } from '../core/utils.js';

export const SPELLS = [
  { id: 'bolt', name: 'Arcane Bolt', cost: 6, cd: 0.28, color: 0xc77dff },
  { id: 'frost', name: 'Frost Shard', cost: 16, cd: 0.75, color: 0x7fe3ff },
  { id: 'lightning', name: 'Chain Lightning', cost: 28, cd: 1.0, color: 0xfff275 },
  { id: 'meteor', name: 'Meteor', cost: 100, cd: 0, color: 0xff7b00 },
];
const MAX_MANA = 100;
const CHANNEL_TIME = 3;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

const boltGeo = new THREE.SphereGeometry(0.2, 12, 8);
const shardGeo = new THREE.OctahedronGeometry(0.22, 0);
const rockGeo = new THREE.IcosahedronGeometry(1.3, 0);

export class MageKit extends Kit {
  constructor(c) {
    super(c);
    this.mana = MAX_MANA;
    this.slot = 0;
    this.regenPause = 0;
    this.channel = null;
    this.castT = 9;
  }

  onSpawn() {
    this.mana = MAX_MANA;
    this.slot = 0;
    this.cancelChannel();
  }

  get spell() {
    return SPELLS[this.slot];
  }

  speedMul() {
    return this.channel ? 0.3 : 1;
  }

  canJump() {
    return !this.channel;
  }

  pose() {
    return this.channel ? 'channel' : 'wand';
  }

  crosshair() {
    return this.slot === 2 ? 'lightning' : this.slot === 3 ? 'meteor' : 'dot';
  }

  update(dt, inp) {
    const c = this.c;
    if (this.time > this.regenPause && !this.channel) this.mana = Math.min(MAX_MANA, this.mana + 11 * dt);

    if (this.channel) {
      if (c.isStunned()) {
        this.cancelChannel(true);
        return;
      }
      this.updateChannel(dt);
      return;
    }

    if (inp.slot >= 1 && inp.slot <= 4) this.select(inp.slot - 1);
    if (inp.wheel) this.select((this.slot + (inp.wheel > 0 ? 1 : 3)) % 4);
    if (inp.superPressed) {
      this.select(3);
      this.startChannel();
      return;
    }
    if (inp.abilityPressed) this.blink();
    if (inp.fire && this.ready('cast')) this.cast(inp.firePressed);
  }

  select(i) {
    if (i === this.slot) return;
    this.slot = i;
    this.updateWandColor();
  }

  cast(pressed) {
    const s = this.spell;
    if (s.id === 'meteor') {
      if (pressed) this.startChannel();
      return;
    }
    if (this.mana < s.cost) {
      if (pressed && this.local) sfx.play('deny');
      return;
    }
    this.mana -= s.cost;
    this.regenPause = this.time + 0.5;
    this.cooldown('cast', s.cd);
    this.castT = 0;
    this.c.model.triggerAttack('cast');
    this.kick(0.4);
    if (s.id === 'bolt') this.castBolt();
    else if (s.id === 'frost') this.castFrost();
    else if (s.id === 'lightning') this.castLightning();
  }

  projectileMesh(geo, color) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
    addOutline(m, 0.04);
    return m;
  }

  castBolt() {
    const c = this.c;
    const from = this.muzzle();
    const dir = this.convergeDir(from);
    this.game.projectiles.spawn({
      owner: c,
      pos: from,
      vel: dir.multiplyScalar(70),
      radius: 0.22,
      damage: 28,
      headMult: 2,
      weapon: 'Arcane Bolt',
      mesh: this.projectileMesh(boltGeo, 0xc77dff),
      trail: 0xc77dff,
      impactColor: 0xc77dff,
    });
    sfx.play('bolt', { pos: c.pos, volume: 0.7 });
  }

  castFrost() {
    const c = this.c;
    const from = this.muzzle();
    const dir = this.convergeDir(from);
    this.game.projectiles.spawn({
      owner: c,
      pos: from,
      vel: dir.multiplyScalar(55),
      radius: 0.24,
      damage: 40,
      headMult: 2,
      weapon: 'Frost Shard',
      slow: { amount: 0.45, time: 2.5 },
      mesh: this.projectileMesh(shardGeo, 0x7fe3ff),
      spin: 12,
      trail: 0xbff4ff,
      impactColor: 0x7fe3ff,
    });
    sfx.play('frost', { pos: c.pos, volume: 0.8 });
  }

  castLightning() {
    const c = this.c;
    const g = this.game;
    const eye = c.eye();
    const aim = c.aim(_v).clone();
    const from = this.muzzle();
    // auto-target the enemy closest to the crosshair inside a small cone
    let best = null;
    let bestAng = 9 * DEG;
    for (const e of g.enemiesOf(c.team)) {
      if (e.cloaked) continue;
      const p = e.chest();
      const to = _w.subVectors(p, eye);
      const d = to.length();
      if (d > 38) continue;
      const ang = Math.acos(clamp(to.dot(aim) / d, -1, 1));
      if (ang < bestAng && g.world.lineOfSight(eye, p)) {
        bestAng = ang;
        best = e;
      }
    }
    sfx.play('lightning', { pos: c.pos, volume: 0.9 });
    if (!best) {
      const hit = g.world.raycast(eye, aim, 38);
      const end = hit ? hit.point : eye.clone().addScaledVector(aim, 38);
      g.effects.lightning(from, end);
      return;
    }
    const chain = [best];
    const dmg = [45, 32, 22];
    let prevPoint = from;
    for (let i = 0; i < 3 && i < chain.length; i++) {
      const t = chain[i];
      const p = t.chest();
      g.effects.lightning(prevPoint, p);
      g.effects.burst(p, { count: 8, color: [0xfff275, 0xffffff], speed: 5, size: 0.08, life: 0.3 });
      g.damage(t, dmg[i], c, { weapon: 'Chain Lightning', dir: aim });
      prevPoint = p;
      if (i < 2) {
        let next = null;
        let nd = 9;
        for (const e of g.enemiesOf(c.team)) {
          if (chain.includes(e) || !e.alive) continue;
          const d = e.pos.distanceTo(t.pos);
          if (d < nd && g.world.lineOfSight(p, e.chest())) {
            nd = d;
            next = e;
          }
        }
        if (next) chain.push(next);
      }
    }
  }

  blink() {
    const c = this.c;
    const g = this.game;
    if (!this.ready('blink')) return;
    if (this.mana < 22) {
      if (this.local) sfx.play('deny');
      return;
    }
    const dir = c.aim(_v).clone();
    dir.y = clamp(dir.y, -0.25, 0.45);
    dir.normalize();
    const start = c.pos.clone();
    const chest = c.chest();
    const hit = g.world.raycast(chest, dir, 11.5);
    let dist = hit ? Math.max(0, hit.dist - 0.8) : 11;
    const target = new THREE.Vector3();
    const hits = [];
    for (; dist > 0.2; dist -= 0.5) {
      target.copy(start).addScaledVector(dir, dist);
      target.y = Math.max(0, target.y);
      const r = c.radius;
      g.world.overlapping(target.x - r, target.y, target.z - r, target.x + r, target.y + c.height, target.z + r, hits);
      if (!hits.length && g.world.inBounds(target.x, target.z, 1)) break;
    }
    if (dist <= 0.2) {
      if (this.local) sfx.play('deny');
      return;
    }
    this.mana -= 22;
    this.regenPause = this.time + 0.5;
    this.cooldown('blink', 1.2);
    g.effects.burst(c.chest(), { count: 20, color: [0xc77dff, 0xffffff], speed: 5, size: 0.1, life: 0.5, gravity: 0 });
    c.pos.copy(target);
    c.vel.y = Math.max(0, c.vel.y);
    g.effects.burst(c.chest(), { count: 20, color: [0xc77dff, 0xffffff], speed: 5, size: 0.1, life: 0.5, gravity: 0 });
    sfx.play('blink', { pos: c.pos, volume: 0.8 });
  }

  // ------------------------------------------------------------------ meteor
  meteorTarget(out) {
    const c = this.c;
    const eye = c.eye();
    const aim = c.aim(_v);
    const hit = this.game.world.raycast(eye, aim, 80);
    if (hit) return out.copy(hit.point);
    out.copy(eye).addScaledVector(aim, 80);
    out.y = this.game.world.groundHeight(out.x, out.z, out.y);
    return out;
  }

  startChannel() {
    if (this.channel) return;
    if (this.mana < MAX_MANA - 0.01) {
      if (this.local) {
        sfx.play('deny');
        this.game.hud.notify('METEOR NEEDS FULL MANA', 'warn');
      }
      return;
    }
    this.mana = 0;
    const target = this.meteorTarget(new THREE.Vector3());
    this.channel = { t: 0, target, marker: this.game.effects.marker(target, 8, 0xff5a1f) };
    sfx.play('cast', { pos: this.c.pos, volume: 1 });
  }

  updateChannel(dt) {
    const ch = this.channel;
    ch.t += dt;
    this.meteorTarget(ch.target);
    ch.marker.set(ch.target);
    ch.marker.ring.rotation.y += dt * 2;
    const k = ch.t / CHANNEL_TIME;
    ch.marker.group.scale.setScalar(0.6 + 0.4 * k);
    if (Math.random() < 0.6) {
      const p = this.c.chest();
      p.y += 0.8;
      this.game.effects.burst(p, { count: 1, color: [0xff7b00, 0xffd23f], speed: 2, size: 0.1, life: 0.5, gravity: -3 });
    }
    if (ch.t >= CHANNEL_TIME) this.launchMeteor();
  }

  cancelChannel(interrupted = false) {
    if (!this.channel) return;
    this.channel.marker.remove();
    this.channel = null;
    this.regenPause = this.time + 1;
    if (interrupted && this.local) this.game.hud.notify('METEOR INTERRUPTED', 'warn');
  }

  launchMeteor() {
    const c = this.c;
    const g = this.game;
    const target = this.channel.target.clone();
    const marker = this.channel.marker;
    marker.ring.material.color.setHex(0xff2020);
    this.channel = null;
    this.regenPause = this.time + 1;
    const back = new THREE.Vector3(target.x - c.pos.x, 0, target.z - c.pos.z);
    if (back.lengthSq() < 0.01) back.set(0, 0, 1);
    back.normalize();
    const start = target.clone().addScaledVector(back, -14);
    start.y += 48;
    const vel = target.clone().sub(start).normalize().multiplyScalar(52);
    const rock = new THREE.Mesh(rockGeo, toonMat(0x7a3b1d));
    addOutline(rock, 0.08);
    const glow = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), new THREE.MeshBasicMaterial({ color: 0xff7b00, transparent: true, opacity: 0.45 }));
    rock.add(glow);
    g.projectiles.spawn({
      owner: c,
      pos: start,
      vel,
      radius: 1.2,
      damage: 0,
      life: 4,
      mesh: rock,
      spin: 3,
      trail: [0xff7b00, 0xffd23f, 0x3d3d3d],
      trailCount: 4,
      weapon: 'Meteor',
      onHit: (p) => {
        marker.remove();
        g.explode(p, 8, 230, c, { minMul: 0.35, knockOut: 13, knockUp: 10, weapon: 'Meteor', color: 0xff5a1f });
        g.addZone({ pos: p.clone(), radius: 6, dps: 22, time: 4, owner: c, weapon: 'Meteor Fire' });
        g.shakeAll(p, 1.2);
      },
    });
    sfx.play('explosion', { pos: target, volume: 0.6, rate: 0.6 });
  }

  onDeath() {
    this.cancelChannel(true);
  }

  dispose() {
    this.cancelChannel();
    super.dispose();
  }

  hud() {
    return {
      mana: this.mana,
      manaMax: MAX_MANA,
      spells: SPELLS.map((s, i) => ({ name: s.name, cost: s.cost, key: i + 1, selected: i === this.slot, ok: this.mana >= s.cost - 0.01 })),
      ability: { name: 'Blink', cd: this.cdLeft('blink'), max: 1.2, cost: 22 },
      channel: this.channel ? this.channel.t / CHANNEL_TIME : null,
    };
  }

  // ------------------------------------------------------------------ visuals
  wandModel(outline, scale = 1) {
    const g = new THREE.Group();
    const stick = cylMesh(0.012 * scale, 0.42 * scale, 0x6b3e1f, outline, 8);
    stick.position.z = -0.12 * scale;
    g.add(stick);
    const tipMat = new THREE.MeshBasicMaterial({ color: this.spell.color });
    const tip = mesh(new THREE.SphereGeometry(0.035 * scale, 12, 8), tipMat, outline);
    tip.position.z = -0.34 * scale;
    g.add(tip);
    g.userData.tipMat = tipMat;
    g.userData.tip = tip;
    return g;
  }

  updateWandColor() {
    const col = this.spell.color;
    if (this.vm) this.vm.userData.wand.userData.tipMat.color.setHex(col);
    if (this.worldWand) this.worldWand.userData.tipMat.color.setHex(col);
  }

  attachWorldWeapon(model) {
    const w = this.wandModel(0.015, 1.7);
    model.arms.R.mount.add(w);
    this.worldWand = w;
  }

  buildViewmodel() {
    const root = new THREE.Group();
    const team = this.c.team;
    const wand = this.wandModel(0.006, 0.8);
    wand.position.set(0.24, -0.23, -0.46);
    wand.rotation.set(0.2, 0.06, 0);
    root.add(wand);
    root.add(vmArm(team, new THREE.Vector3(0.24, -0.24, -0.43), 1));
    const left = vmArm(team, new THREE.Vector3(-0.3, -0.35, -0.5), -1);
    root.add(left);
    root.userData = { wand, left };
    return root;
  }

  animateViewmodel(dt) {
    const u = this.vm.userData;
    this.castT += dt;
    const jab = this.castT < 0.18 ? Math.sin((this.castT / 0.18) * Math.PI) : 0;
    u.wand.position.z = -0.45 - jab * 0.08;
    const ch = this.channel ? 1 : 0;
    u.left.position.y = ch * 0.18;
    u.left.position.x = ch * 0.1;
    u.wand.userData.tip.scale.setScalar(1 + jab * 0.5 + ch * (0.35 + Math.sin(this.time * 20) * 0.15));
  }
}
