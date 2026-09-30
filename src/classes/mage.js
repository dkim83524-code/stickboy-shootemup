import * as THREE from 'three';
import { Kit, cylMesh, mesh, vmArm } from './kit.js';
import { sfx } from '../core/audio.js';
import { addOutline, toonMat } from '../core/toon.js';
import { clamp } from '../core/utils.js';

export const SPELLS = [
  { id: 'bolt', name: 'Arcane Bolt', cost: 6, cd: 0.28, color: 0xc77dff },
  { id: 'mend', name: 'Mend', cost: 25, cd: 2.5, color: 0x7cff6b },
  { id: 'ward', name: 'Arcane Ward', cost: 35, cd: 8, color: 0x5ec8ff },
  { id: 'meteor', name: 'Meteor', cost: 100, cd: 0, color: 0xff7b00 },
];
const MAX_MANA = 100;
const CHANNEL_TIME = 3;
const MEND_HEAL = 55;
const WARD_RADIUS = 5.5;
const WARD_TIME = 5;
const WARD_DPS = 24;
const WARD_HPS = 20;
const _v = new THREE.Vector3();

const boltGeo = new THREE.SphereGeometry(0.2, 12, 8);
const rockGeo = new THREE.IcosahedronGeometry(1.3, 0);
const wardGeo = new THREE.SphereGeometry(1, 32, 16);
const wardWire = new THREE.IcosahedronGeometry(1, 2);

export class MageKit extends Kit {
  constructor(c) {
    super(c);
    this.mana = MAX_MANA;
    this.slot = 0;
    this.regenPause = 0;
    this.channel = null;
    this.ward = null;
    this.castT = 9;
  }

  onSpawn() {
    this.mana = MAX_MANA;
    this.slot = 0;
    this.cancelChannel();
    this.endWard();
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
    if (this.ward) this.updateWard(dt);

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
    if (s.id === 'mend' && c.hp >= c.maxHp) return this.deny(pressed, 'ALREADY AT FULL HEALTH');
    if (s.id === 'ward' && this.ward) return this.deny(pressed);
    this.mana -= s.cost;
    this.regenPause = this.time + 0.5;
    this.cooldown('cast', s.id === 'bolt' ? s.cd : 0.35);
    this.cooldown(s.id, s.cd);
    this.castT = 0;
    c.model.triggerAttack('cast');
    this.kick(0.4);
    if (s.id === 'bolt') this.castBolt();
    else if (s.id === 'mend') this.castMend();
    else if (s.id === 'ward') this.castWard();
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

  /** Spell 2: heal yourself. */
  castMend() {
    const c = this.c;
    this.game.heal(c, MEND_HEAL, c);
    this.game.effects.burst(c.chest(), { count: 22, color: [0x7cff6b, 0xffffff], speed: 4, size: 0.1, life: 0.7, gravity: -4 });
    this.game.effects.ring(c.pos, { color: 0x7cff6b, radius: 1.8, life: 0.4 });
    sfx.play('heal', { pos: c.pos, volume: 0.8 });
  }

  /** Spell 3: a force field that follows you, heals allies inside and hurts enemies inside. */
  castWard() {
    const c = this.c;
    const g = this.game;
    const group = new THREE.Group();
    const shellMat = new THREE.MeshBasicMaterial({ color: 0x5ec8ff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
    const wireMat = new THREE.MeshBasicMaterial({ color: 0xbff4ff, transparent: true, opacity: 0.35, wireframe: true, depthWrite: false });
    const shell = new THREE.Mesh(wardGeo, shellMat);
    const wire = new THREE.Mesh(wardWire, wireMat);
    group.add(shell, wire);
    group.scale.setScalar(WARD_RADIUS);
    g.scene.add(group);
    const marker = g.effects.marker(c.pos, WARD_RADIUS, 0x5ec8ff);
    this.ward = { until: this.time + WARD_TIME, tick: 0, group, wire, shellMat, wireMat, marker };
    g.effects.ring(c.pos, { color: 0x5ec8ff, radius: WARD_RADIUS, life: 0.4 });
    sfx.play('cast', { pos: c.pos, volume: 0.7, rate: 1.6 });
  }

  updateWard(dt) {
    const w = this.ward;
    const c = this.c;
    const g = this.game;
    const left = w.until - this.time;
    if (left <= 0 || !c.alive) {
      this.endWard();
      return;
    }
    w.group.position.set(c.pos.x, c.pos.y + 0.8, c.pos.z);
    w.marker.set(c.pos);
    w.wire.rotation.y += dt * 0.8;
    const fade = Math.min(1, left / 0.5) * (this.local && this.game.cameraMode === 'first' ? 0.4 : 1);
    w.shellMat.opacity = 0.1 * fade;
    w.wireMat.opacity = (0.28 + Math.sin(this.time * 8) * 0.07) * fade;
    w.tick -= dt;
    if (w.tick > 0) return;
    w.tick = 0.25;
    for (const o of g.characters) {
      if (!o.alive || o === c) continue;
      const dx = o.pos.x - c.pos.x;
      const dz = o.pos.z - c.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > WARD_RADIUS || Math.abs(o.pos.y - c.pos.y) > 3) continue;
      if (o.team === c.team) {
        if (g.heal(o, WARD_HPS * 0.25, c) > 0) g.effects.burst(o.chest(), { count: 2, color: 0x7cff6b, speed: 2, size: 0.08, life: 0.5, gravity: -3 });
      } else {
        const n = d > 0.01 ? _v.set(dx / d, 0, dz / d) : _v.set(1, 0, 0);
        g.damage(o, WARD_DPS * 0.25, c, { weapon: 'Arcane Ward', dir: n.clone(), knock: n.clone().multiplyScalar(3.5).setY(1.5) });
        g.effects.burst(o.chest(), { count: 3, color: [0x5ec8ff, 0xffffff], speed: 3, size: 0.08, life: 0.3 });
      }
    }
  }

  endWard() {
    const w = this.ward;
    if (!w) return;
    this.ward = null;
    w.group.removeFromParent();
    w.shellMat.dispose();
    w.wireMat.dispose();
    w.marker.remove();
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
    this.endWard();
  }

  dispose() {
    this.cancelChannel();
    this.endWard();
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
        cd: s.id === 'ward' && this.ward ? this.ward.until - this.time : this.cdLeft(s.id),
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
