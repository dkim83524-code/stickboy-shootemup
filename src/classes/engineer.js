import * as THREE from 'three';
import { Kit, boxMesh, cylMesh, vmArm } from './kit.js';
import { sfx } from '../core/audio.js';
import { applySpread, DEG, damp } from '../core/utils.js';
import { BUILDS, buildBox, buildModel, Deployable } from '../entities/deployables.js';
import { Drone } from '../entities/drone.js';

const MAG = 6;
const MAX_SCRAP = 250;
const _v = new THREE.Vector3();
const _hits = [];

function shotgunModel(outline, scale = 1) {
  const g = new THREE.Group();
  for (const x of [-0.022, 0.022]) {
    const b = cylMesh(0.02 * scale, 0.5 * scale, 0x3d4250, outline, 8);
    b.position.set(x * scale, 0, -0.3 * scale);
    g.add(b);
  }
  const body = boxMesh(0.07 * scale, 0.07 * scale, 0.18 * scale, 0x6c7384, outline);
  body.position.z = -0.02 * scale;
  g.add(body);
  const stock = boxMesh(0.05 * scale, 0.09 * scale, 0.26 * scale, 0x8f5a2f, outline);
  stock.position.set(0, -0.03 * scale, 0.18 * scale);
  g.add(stock);
  const pump = boxMesh(0.06 * scale, 0.05 * scale, 0.12 * scale, 0xf4a300, outline);
  pump.position.set(0, -0.04 * scale, -0.25 * scale);
  g.add(pump);
  return g;
}

function wrenchModel(outline, scale = 1) {
  const g = new THREE.Group();
  const handle = cylMesh(0.015 * scale, 0.32 * scale, 0x6c7384, outline, 8, 'y');
  g.add(handle);
  const headL = boxMesh(0.03 * scale, 0.1 * scale, 0.03 * scale, 0x9aa3ad, outline);
  headL.position.set(-0.035 * scale, 0.18 * scale, 0);
  const headR = headL.clone();
  headR.position.x = 0.035 * scale;
  const bridge = boxMesh(0.1 * scale, 0.03 * scale, 0.03 * scale, 0x9aa3ad, outline);
  bridge.position.y = 0.14 * scale;
  g.add(headL, headR, bridge);
  return g;
}

export class EngineerKit extends Kit {
  constructor(c) {
    super(c);
    this.dealtCharge = 0.07;
    this.ammo = MAG;
    this.reloading = 0;
    this.scrap = 150;
    this.buildMode = false;
    this.sel = 0;
    this.ghost = null;
    this.ghostKind = null;
    this.placement = null;
    this.builds = { turret: null, wall: null, pad: null };
    this.drone = null;
    this.wrenchT = 9;
  }

  onSpawn() {
    this.ammo = MAG;
    this.reloading = 0;
    this.scrap = Math.max(this.scrap, 125);
    this.setBuildMode(false);
    this.drone = null;
  }

  pose() {
    return this.buildMode || this.drone ? 'build' : 'gun';
  }

  crosshair() {
    return this.buildMode ? 'build' : 'circle';
  }

  hideViewmodel() {
    return !!this.drone;
  }

  update(dt, inp) {
    this.scrap = Math.min(MAX_SCRAP, this.scrap + 6 * dt);

    if (this.drone) {
      this.drone.update(dt, inp);
      // the body stays put while piloting
      inp.mx = inp.mz = 0;
      inp.jumpPressed = false;
      return;
    }

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) this.ammo = MAG;
    } else if ((inp.reloadPressed && this.ammo < MAG) || this.ammo <= 0) this.startReload();

    if (inp.abilityPressed) this.setBuildMode(!this.buildMode);

    if (this.buildMode) {
      if (inp.slot >= 1 && inp.slot <= 3) this.sel = inp.slot - 1;
      if (inp.wheel) this.sel = (this.sel + (inp.wheel > 0 ? 1 : 2)) % 3;
      this.updatePlacement();
      if (inp.firePressed) this.place();
      if (inp.altPressed) this.setBuildMode(false);
      return;
    }

    if (inp.fire && this.ready('shot') && this.ammo > 0 && this.reloading <= 0) this.shoot();
    if (inp.alt && this.ready('wrench')) this.swingWrench();
  }

  startReload() {
    if (this.reloading > 0 || this.ammo >= MAG) return;
    this.reloading = 2.1;
    sfx.play('reload', { pos: this.c.pos, volume: 0.7, rate: 0.9 });
  }

  shoot() {
    const c = this.c;
    this.cooldown('shot', 0.85);
    this.ammo--;
    const eye = c.eye();
    const aim = c.aim(_v).clone();
    const from = this.muzzle();
    for (let i = 0; i < 10; i++) {
      this.game.fireBullet(c, {
        origin: eye,
        dir: applySpread(aim, 5.5 * DEG),
        range: 45,
        damage: 10,
        headMult: 1.5,
        falloff: [10, 32, 0.3],
        tracer: 0xffd8a8,
        tracerWidth: 0.02,
        tracerLife: 0.06,
        from,
        weapon: 'Scrap Shotgun',
        quiet: i > 0,
      });
    }
    sfx.play('shotgun', { pos: c.pos, volume: 1 });
    this.kick(1);
    this.game.effects.flash(from, { color: 0xffd23f, size: 0.2, life: 0.06 });
  }

  swingWrench() {
    const c = this.c;
    const g = this.game;
    this.cooldown('wrench', 0.6);
    this.wrenchT = 0;
    c.model.triggerAttack('swing');
    // repair own builds first
    const eye = c.eye();
    for (const b of Object.values(this.builds)) {
      if (b && b.alive && b.center(_v).distanceTo(eye) < 3) {
        b.repair(60);
        sfx.play('build', { pos: b.pos, volume: 0.8 });
        g.effects.burst(b.center(), { count: 10, color: [0x7cff6b, 0xffffff], speed: 4, size: 0.08, life: 0.4 });
        return;
      }
    }
    const targets = g.meleeSweep(c, 2.7, 60);
    if (targets.length) {
      g.damage(targets[0], 40, c, { weapon: 'Wrench', dir: c.aim(_v).clone() });
      sfx.play('punch', { pos: c.pos, volume: 0.9, rate: 1.3 });
    } else sfx.play('swing', { pos: c.pos, volume: 0.6 });
  }

  // ------------------------------------------------------------------ building
  setBuildMode(on) {
    this.buildMode = on;
    if (!on && this.ghost) {
      this.ghost.removeFromParent();
      this.ghost = null;
      this.ghostKind = null;
    }
  }

  computePlacement(kind) {
    const c = this.c;
    const g = this.game;
    const eye = c.eye();
    const aim = c.aim(_v);
    const hit = g.world.raycast(eye, aim, 7);
    const p = new THREE.Vector3();
    if (hit && hit.normal.y > 0.7) p.copy(hit.point);
    else {
      const dist = hit ? Math.max(1.5, hit.dist - 1) : 5;
      p.copy(eye).addScaledVector(aim, dist);
      p.y = g.world.groundHeight(p.x, p.z, eye.y);
    }
    const box = buildBox(kind, p, c.yaw);
    let ok = g.world.inBounds(p.x, p.z, 1);
    if (ok) {
      g.world.overlapping(box.minX + 0.02, box.minY + 0.02, box.minZ + 0.02, box.maxX - 0.02, box.maxY, box.maxZ - 0.02, _hits);
      if (_hits.length) ok = false;
    }
    if (ok) {
      for (const ch of g.characters) {
        if (!ch.alive) continue;
        if (ch.pos.x + ch.radius > box.minX && ch.pos.x - ch.radius < box.maxX && ch.pos.z + ch.radius > box.minZ && ch.pos.z - ch.radius < box.maxZ && ch.pos.y < box.maxY && ch.pos.y + ch.height > box.minY) {
          ok = kind === 'pad' && ch.pos.y >= box.maxY - 0.3;
          if (!ok) break;
        }
      }
    }
    return { pos: p, ok, afford: this.scrap >= BUILDS.find((b) => b.id === kind).cost };
  }

  updatePlacement() {
    const kind = BUILDS[this.sel].id;
    const pl = (this.placement = this.computePlacement(kind));
    if (!this.local) return;
    if (this.ghostKind !== kind) {
      if (this.ghost) this.ghost.removeFromParent();
      this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x7cff6b, transparent: true, opacity: 0.45, depthWrite: false });
      this.ghost = buildModel(kind, this.c.team, this.ghostMat);
      this.ghostKind = kind;
      this.game.scene.add(this.ghost);
    }
    this.ghost.position.copy(pl.pos);
    const fx = Math.abs(Math.sin(this.c.yaw));
    const fz = Math.abs(Math.cos(this.c.yaw));
    this.ghost.rotation.y = kind === 'wall' && fx > fz ? Math.PI / 2 : 0;
    this.ghostMat.color.setHex(pl.ok && pl.afford ? 0x7cff6b : 0xff4d5e);
  }

  /** Place a build immediately (used by bots) or from the current placement. */
  place(kind = BUILDS[this.sel].id, placement = this.placement) {
    const def = BUILDS.find((b) => b.id === kind);
    if (!placement || !placement.ok || this.scrap < def.cost) {
      if (this.local) sfx.play('deny');
      return false;
    }
    this.scrap -= def.cost;
    if (this.builds[kind] && this.builds[kind].alive) this.builds[kind].destroy();
    const d = new Deployable(this.game, this.c, kind, placement.pos, this.c.yaw);
    this.builds[kind] = d;
    this.game.deployables.push(d);
    sfx.play('build', { pos: placement.pos, volume: 0.9 });
    this.game.effects.burst(placement.pos.clone().setY(placement.pos.y + 0.3), { count: 14, color: [0xf4a300, 0xffffff], speed: 4, size: 0.1, life: 0.5 });
    if (this.local) this.setBuildMode(false);
    return true;
  }

  onBuildGone(d) {
    if (this.builds[d.kind] === d) this.builds[d.kind] = null;
  }

  onKill() {
    super.onKill();
    this.scrap = Math.min(MAX_SCRAP, this.scrap + 40);
  }

  // ------------------------------------------------------------------ drone super
  onSuperStart() {
    const c = this.c;
    this.setBuildMode(false);
    const p = c.eye().addScaledVector(c.aim(_v).setY(0).normalize(), 0.9);
    p.y += 0.3;
    this.drone = new Drone(this.game, c, p);
    this.bodyYaw = c.yaw;
  }

  onSuperEnd() {
    if (this.drone && this.drone.alive) this.drone.explode();
    this.drone = null;
  }

  onDroneGone(dr) {
    if (this.drone === dr) {
      this.drone = null;
      if (this.c.superActive) this.c.endSuper();
    }
  }

  facingYaw() {
    return this.drone ? this.bodyYaw : null;
  }

  onDeath() {
    if (this.drone) this.drone.destroy();
    this.drone = null;
    this.setBuildMode(false);
  }

  dispose() {
    this.setBuildMode(false);
    if (this.drone) this.drone.destroy();
    for (const b of Object.values(this.builds)) if (b && b.alive) b.remove();
    super.dispose();
  }

  hud() {
    return {
      ammo: this.drone ? null : this.reloading > 0 ? 'RELOADING' : `${this.ammo}`,
      ammoMax: MAG,
      scrap: Math.floor(this.scrap),
      builds: BUILDS.map((b, i) => ({
        name: b.name,
        cost: b.cost,
        key: i + 1,
        selected: this.buildMode && i === this.sel,
        ok: this.scrap >= b.cost,
        built: !!(this.builds[b.id] && this.builds[b.id].alive),
      })),
      buildMode: this.buildMode,
      ability: { name: this.buildMode ? 'Exit Build' : 'Build', cd: 0, max: 1 },
      drone: this.drone ? { hp: this.drone.hp / this.drone.maxHp, time: this.c.superTime, boosting: this.drone.boosting } : null,
    };
  }

  // ------------------------------------------------------------------ visuals
  attachWorldWeapon(model) {
    const s = shotgunModel(0.015, 1.6);
    model.arms.R.mount.add(s);
  }

  buildViewmodel() {
    const root = new THREE.Group();
    const team = this.c.team;
    const gun = shotgunModel(0.007, 1.1);
    gun.position.set(0.2, -0.22, -0.42);
    root.add(gun);
    root.add(vmArm(team, new THREE.Vector3(0.21, -0.28, -0.3), 1));
    const left = new THREE.Group();
    left.add(vmArm(team, new THREE.Vector3(0.17, -0.27, -0.66), -1));
    root.add(left);
    const wrench = new THREE.Group();
    const wm = wrenchModel(0.007, 1.2);
    wm.rotation.x = -0.6;
    wrench.add(wm);
    wrench.add(vmArm(team, new THREE.Vector3(0, -0.12, 0), -1));
    wrench.position.set(-0.25, -0.2, -0.45);
    wrench.visible = false;
    root.add(wrench);
    root.userData = { gun, left, wrench };
    return root;
  }

  animateViewmodel(dt) {
    const u = this.vm.userData;
    this.wrenchT += dt;
    const swinging = this.wrenchT < 0.3;
    u.wrench.visible = swinging;
    u.left.visible = !swinging;
    if (swinging) {
      const k = this.wrenchT / 0.3;
      u.wrench.rotation.set(-1.4 * Math.sin(k * Math.PI), 0, 0.6 - k * 1.2);
    }
    const lower = this.reloading > 0 || this.buildMode ? -0.2 : 0;
    u.gun.position.y = damp(u.gun.position.y, -0.22 + lower, 8, dt);
  }
}
