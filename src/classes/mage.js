import * as THREE from 'three';
import { Kit, cylMesh, mesh, vmArm } from './kit.js';
import { sfx } from '../core/audio.js';
import { addOutline, toonMat } from '../core/toon.js';
import { clamp } from '../core/utils.js';

export const SPELLS = [
  { id: 'bolt', name: 'Arcane Bolt', cost: 6, cd: 0.28, color: 0xc77dff },
  { id: 'mend', name: 'Healing Circle', cost: 30, cd: 4, color: 0x7cff6b },
  { id: 'poison', name: 'Poison Pool', cost: 35, cd: 8, color: 0x9bff3b },
  { id: 'meteor', name: 'Meteor', cost: 100, cd: 0, color: 0xff7b00 },
];
const MAX_MANA = 100;
const CHANNEL_TIME = 3;
const HEAL_AMOUNT = 45;
const HEAL_RADIUS = 7;
const POISON_RADIUS = 4.5;
const POISON_TIME = 6;
const POISON_DPS = 22;
const POISON_RANGE = 35;
const _v = new THREE.Vector3();

const boltGeo = new THREE.SphereGeometry(0.2, 12, 8);
const rockGeo = new THREE.IcosahedronGeometry(1.3, 0);

export class MageKit extends Kit {
  constructor(c) {
    super(c);
    this.mana = MAX_MANA;
    this.slot = 0;
    this.regenPause = 0;
    this.channel = null;
    this.aimMarker = null;
    this.castT = 9;
  }

  onSpawn() {
    this.mana = MAX_MANA;
    this.slot = 0;
    this.cancelChannel();
    this.updateWandColor();
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
    return this.slot === 3 ? 'meteor' : this.slot === 0 ? 'dot' : 'circle';
  }

  update(dt, inp) {
    const c = this.c;
    if (this.time > this.regenPause && !this.channel) this.mana = Math.min(MAX_MANA, this.mana + 11 * dt);
    this.updateAimMarker();

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

  deny(pressed, msg = null) {
    if (!pressed || !this.local) return;
    sfx.play('deny');
    if (msg) this.game.hud.notify(msg, 'warn');
  }

  cast(pressed) {
    const s = this.spell;
    const c = this.c;
    if (s.id === 'meteor') {
      if (pressed) this.startChannel();
      return;
    }
    if (!this.ready(s.id)) return this.deny(pressed);
    if (this.mana < s.cost) return this.deny(pressed);
    if (s.id === 'mend' && !this.healTargets().some((o) => o.hp < o.maxHp)) return this.deny(pressed, 'NOBODY NEEDS HEALING');
    this.mana -= s.cost;
    this.regenPause = this.time + 0.5;
    this.cooldown('cast', s.id === 'bolt' ? s.cd : 0.35);
    this.cooldown(s.id, s.cd);
    this.castT = 0;
    c.model.triggerAttack('cast');
    this.kick(0.4);
    if (s.id === 'bolt') this.castBolt();
    else if (s.id === 'mend') this.castMend();
    else if (s.id === 'poison') this.castPoison();
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

  /** You plus every living ally inside the healing circle. */
  healTargets() {
    const c = this.c;
    return this.game.characters.filter(
      (o) => o.alive && o.team === c.team && (o === c || (o.pos.distanceTo(c.pos) <= HEAL_RADIUS && Math.abs(o.pos.y - c.pos.y) < 3)),
    );
  }

  /** Spell 2: a pulse that heals you and every ally in a circle around you. */
  castMend() {
    const c = this.c;
    const g = this.game;
    for (const o of this.healTargets()) {
      if (g.heal(o, HEAL_AMOUNT, c) > 0) g.effects.burst(o.chest(), { count: 14, color: [0x7cff6b, 0xffffff], speed: 3, size: 0.1, life: 0.7, gravity: -4 });
    }
    g.effects.ring(c.pos, { color: 0x7cff6b, radius: HEAL_RADIUS, life: 0.55 });
    g.effects.ring(c.pos, { color: 0xffffff, radius: HEAL_RADIUS * 0.6, life: 0.4 });
    sfx.play('heal', { pos: c.pos, volume: 0.8 });
  }

  /** Where Poison Pool would land: the surface the crosshair is on, within range. */
  poisonTarget(out = new THREE.Vector3()) {
    const c = this.c;
    const eye = c.eye();
    const aim = c.aim(_v);
    const hit = this.game.world.raycast(eye, aim, POISON_RANGE);
    if (hit && hit.normal.y > 0.5) return out.copy(hit.point);
    const p = hit ? hit.point.clone().addScaledVector(hit.normal, 0.5) : eye.clone().addScaledVector(aim, POISON_RANGE);
    return out.set(p.x, this.game.world.groundHeight(p.x, p.z, p.y), p.z);
  }

  /** Spell 3: area control. A poison pool that damages enemies standing in it. */
  castPoison() {
    const c = this.c;
    const g = this.game;
    const p = this.poisonTarget();
    g.addZone({
      pos: p,
      radius: POISON_RADIUS,
      dps: POISON_DPS,
      time: POISON_TIME,
      owner: c,
      weapon: 'Poison Pool',
      color: 0x7bd12f,
      particles: [0x9bff3b, 0x5a8f1f, 0xd4ff8a],
    });
    g.effects.burst(p.clone().setY(p.y + 0.3), { count: 26, color: [0x9bff3b, 0x5a8f1f], speed: 5, size: 0.14, life: 0.6, gravity: 4 });
    g.effects.ring(p, { color: 0x9bff3b, radius: POISON_RADIUS, life: 0.4 });
    sfx.play('frost', { pos: p, volume: 0.8, rate: 0.6 });
  }

  /** Local player with Poison Pool selected sees where it will land. */
  updateAimMarker() {
    const show = this.local && this.c.alive && this.slot === 2 && !this.channel;
    if (!show) {
      if (this.aimMarker) {
        this.aimMarker.remove();
        this.aimMarker = null;
      }
      return;
    }
    if (!this.aimMarker) this.aimMarker = this.game.effects.marker(this.c.pos, POISON_RADIUS, 0x9bff3b);
    this.aimMarker.set(this.poisonTarget());
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
    this.updateAimMarker();
  }

  dispose() {
    this.cancelChannel();
    if (this.aimMarker) this.aimMarker.remove();
    this.aimMarker = null;
    super.dispose();
  }

  hud() {
    return {
      mana: this.mana,
      manaMax: MAX_MANA,
      spells: SPELLS.map((s, i) => ({
        name: s.name,
        cost: s.cost,
        key: i + 1,
        selected: i === this.slot,
        cd: this.cdLeft(s.id),
        ok: this.mana >= s.cost - 0.01 && (s.id === 'meteor' || this.ready(s.id)),
      })),
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
