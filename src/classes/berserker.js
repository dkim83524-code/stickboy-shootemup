import * as THREE from 'three';
import { Kit, boxMesh, cylMesh, sphereMesh, vmArm } from './kit.js';
import { TEAM_COLORS } from './defs.js';
import { sfx } from '../core/audio.js';
import { applySpread, forwardFlat, DEG, damp } from '../core/utils.js';

const MAX_AMMO = 200;
const _v = new THREE.Vector3();

function minigunModel(outline = 0.01, scale = 1) {
  const g = new THREE.Group();
  const body = cylMesh(0.07 * scale, 0.32 * scale, 0x3d4250, outline);
  body.position.z = 0.05 * scale;
  g.add(body);
  const barrels = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const b = cylMesh(0.018 * scale, 0.55 * scale, 0x6c7384, outline * 0.6, 8);
    b.position.set(Math.cos(a) * 0.045 * scale, Math.sin(a) * 0.045 * scale, -0.32 * scale);
    barrels.add(b);
  }
  const ring = cylMesh(0.075 * scale, 0.04 * scale, 0xc0392b, outline, 14);
  ring.position.z = -0.5 * scale;
  barrels.add(ring);
  g.add(barrels);
  const handle = boxMesh(0.05 * scale, 0.14 * scale, 0.06 * scale, 0x2b2b2b, outline);
  handle.position.set(0, 0.1 * scale, 0.02 * scale);
  g.add(handle);
  const box = boxMesh(0.1 * scale, 0.12 * scale, 0.14 * scale, 0x556b2f, outline);
  box.position.set(-0.1 * scale, -0.04 * scale, 0.1 * scale);
  g.add(box);
  g.userData.barrels = barrels;
  return g;
}

export class BerserkerKit extends Kit {
  constructor(c) {
    super(c);
    this.passiveCharge = 0.5;
    this.dealtCharge = 0.045;
    this.takenCharge = 0.08;
    this.spin = 0;
    this.ammo = MAX_AMMO;
    this.reloading = 0;
    this.fireAcc = 0;
    this.slamming = false;
    this.punchSide = 1;
    this.punchT = 9;
    this.vmBase.set(0, 0, 0);
  }

  get raging() {
    return this.c.superActive;
  }

  onSpawn() {
    this.spin = 0;
    this.ammo = MAX_AMMO;
    this.reloading = 0;
    this.slamming = false;
    this.setRageVisuals(false);
  }

  speedMul() {
    if (this.raging) return 1.3;
    return 1 - this.spin * 0.45;
  }

  jumpMul() {
    return this.raging ? 1.65 : 1;
  }

  damageTakenMul() {
    return this.raging ? 0.5 : 1;
  }

  onTookDamage(amount) {
    this.c.addSuper(amount * this.takenCharge);
  }

  pose() {
    return this.raging ? 'fists' : 'minigun';
  }

  crosshair() {
    return this.raging ? 'fists' : 'circle';
  }

  update(dt, inp) {
    const c = this.c;
    if (inp.abilityPressed && this.ready('charge') && !this.slamming) this.shoulderCharge();
    if (this.slamming) c.vel.y = Math.min(c.vel.y, -36);

    if (this.raging) {
      if (inp.fire && this.ready('punch')) this.punch();
      if (inp.altPressed && !c.grounded && !this.slamming) this.startSlam();
      return;
    }

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) this.ammo = MAX_AMMO;
    } else if (inp.reloadPressed && this.ammo < MAX_AMMO) this.startReload();

    const wantSpin = (inp.fire || inp.alt) && this.reloading <= 0;
    const prev = this.spin;
    this.spin = wantSpin ? Math.min(1, this.spin + dt / 0.6) : Math.max(0, this.spin - dt / 0.8);
    if (prev === 0 && this.spin > 0) sfx.play('spin', { pos: c.pos, volume: 0.6 });

    if (this.spin >= 1 && inp.fire && this.reloading <= 0) {
      this.fireAcc += dt * 18;
      while (this.fireAcc >= 1) {
        this.fireAcc -= 1;
        if (this.ammo <= 0) {
          this.startReload();
          break;
        }
        this.shoot();
      }
    } else this.fireAcc = Math.min(this.fireAcc, 1);
  }

  startReload() {
    if (this.reloading > 0) return;
    this.reloading = 3;
    this.spin = 0;
    sfx.play('reload', { pos: this.c.pos, volume: 0.7, rate: 0.7 });
  }

  shoot() {
    const c = this.c;
    this.ammo--;
    const dir = applySpread(c.aim(_v), 3.2 * DEG);
    this.game.fireBullet(c, {
      origin: c.eye(),
      dir,
      range: 75,
      damage: 9,
      headMult: 2,
      falloff: [18, 60, 0.45],
      tracer: 0xffe27a,
      tracerWidth: 0.025,
      from: this.muzzle(),
      weapon: 'Minigun',
    });
    sfx.play('minigun', { pos: c.pos, volume: this.local ? 0.35 : 0.55 });
    this.kick(0.12);
    if (Math.random() < 0.5) this.game.effects.flash(this.muzzle(), { color: 0xffd23f, size: 0.12, life: 0.04 });
  }

  shoulderCharge() {
    const c = this.c;
    this.cooldown('charge', 7);
    const f = forwardFlat(c.yaw);
    const hit = new Set();
    sfx.play('dash', { pos: c.pos, volume: 0.9, rate: 0.7 });
    c.forced = {
      vel: f.clone().multiplyScalar(this.raging ? 26 : 21),
      time: 0.38,
      gravity: true,
      update: (dt, fm) => {
        this.game.effects.burst(c.pos, { count: 1, color: 0xdddddd, speed: 1, size: 0.14, life: 0.4, gravity: 0 });
        for (const t of this.game.enemiesOf(c.team)) {
          if (hit.has(t)) continue;
          if (Math.hypot(t.pos.x - c.pos.x, t.pos.z - c.pos.z) < 1.3 && Math.abs(t.pos.y - c.pos.y) < 1.6) {
            hit.add(t);
            this.game.damage(t, 40, c, { weapon: 'Shoulder Charge', dir: f, knock: f.clone().multiplyScalar(15).setY(6) });
            sfx.play('punch', { pos: t.pos, volume: 1.1, rate: 0.8 });
            this.game.shake(c, 0.4);
            fm.cancel = true;
          }
        }
      },
    };
  }

  punch() {
    const c = this.c;
    this.cooldown('punch', 0.3);
    this.punchSide *= -1;
    this.punchT = 0;
    c.model.triggerAttack('punch', this.punchSide);
    const targets = this.game.meleeSweep(c, 2.9, 55);
    const aim = c.aim(_v).clone();
    if (targets.length) {
      const t = targets[0];
      const knock = aim.clone().setY(0).normalize().multiplyScalar(11).setY(5);
      this.game.damage(t, 60, c, { weapon: 'Fists', dir: aim, knock });
      sfx.play('punch', { pos: c.pos, volume: 1 });
      const p = t.isCharacter ? t.chest() : t.center();
      this.game.effects.burst(p, { count: 10, color: [0xffffff, 0xffd23f], speed: 6, size: 0.1, life: 0.35 });
      this.game.shake(c, 0.25);
    } else {
      sfx.play('swing', { pos: c.pos, volume: 0.7, rate: 0.8 });
    }
  }

  startSlam() {
    const c = this.c;
    this.slamming = true;
    c.vel.x *= 0.4;
    c.vel.z *= 0.4;
    c.vel.y = -36;
    c.model.triggerAttack('slam');
    sfx.play('dash', { pos: c.pos, volume: 0.8, rate: 0.5 });
  }

  onLand() {
    if (!this.slamming) return;
    this.slamming = false;
    const c = this.c;
    this.game.explode(c.pos, 6.5, 95, c, {
      minMul: 0.4,
      knockOut: 10,
      knockUp: 11,
      stun: 0.6,
      weapon: 'Slam',
      visual: false,
    });
    const fx = this.game.effects;
    fx.ring(c.pos, { color: 0xffffff, radius: 7, life: 0.45 });
    fx.ring(c.pos, { color: 0xff6b35, radius: 5, life: 0.35 });
    fx.burst(c.pos.clone().setY(c.pos.y + 0.2), { count: 40, color: [0x8a8f9c, 0xd9d4c7, 0x14121a], speed: 11, size: 0.2, life: 0.8, normal: new THREE.Vector3(0, 1, 0), spread: 1.6 });
    sfx.play('slam', { pos: c.pos, volume: 1.3 });
    this.game.shake(c, 1);
  }

  onSuperStart() {
    this.spin = 0;
    this.reloading = 0;
    this.setRageVisuals(true);
  }

  onSuperEnd() {
    this.slamming = false;
    this.setRageVisuals(false);
  }

  onDeath() {
    this.slamming = false;
    this.spin = 0;
  }

  setRageVisuals(on) {
    if (this.worldGun) this.worldGun.visible = !on;
    if (this.vm) {
      this.vm.userData.gun.visible = !on;
      this.vm.userData.fists.visible = on;
    }
  }

  hud() {
    return {
      ammo: this.raging ? null : this.reloading > 0 ? 'RELOADING' : `${this.ammo}`,
      ammoMax: this.raging ? null : MAX_AMMO,
      ability: { name: 'Charge', cd: this.cdLeft('charge'), max: 7 },
      spin: this.spin,
      note: this.raging ? (this.c.grounded ? 'JUMP + RMB: SLAM' : 'RMB: SLAM!') : null,
    };
  }

  attachWorldWeapon(model) {
    const gun = minigunModel(0.02, 1.6);
    gun.position.set(0.05, 0.05, -0.1);
    model.arms.R.mount.add(gun);
    this.worldGun = gun;
  }

  buildViewmodel() {
    const root = new THREE.Group();
    const team = this.c.team;
    // minigun
    const gun = new THREE.Group();
    const mg = minigunModel(0.008, 1.05);
    mg.position.set(0.26, -0.32, -0.55);
    gun.add(mg);
    gun.add(vmArm(team, new THREE.Vector3(0.27, -0.24, -0.53), 1));
    gun.add(vmArm(team, new THREE.Vector3(0.18, -0.38, -0.8), -1));
    root.add(gun);
    // fists
    const fists = new THREE.Group();
    const color = TEAM_COLORS[team];
    const L = new THREE.Group();
    const R = new THREE.Group();
    L.add(vmArm(team, new THREE.Vector3(-0.22, -0.24, -0.45), -1));
    R.add(vmArm(team, new THREE.Vector3(0.22, -0.24, -0.45), 1));
    for (const [grp, x] of [[L, -0.22], [R, 0.22]]) {
      const fist = sphereMesh(0.085, color, 0.01);
      fist.position.set(x, -0.24, -0.47);
      fist.scale.set(1, 0.9, 1.1);
      grp.add(fist);
    }
    fists.add(L, R);
    fists.visible = false;
    root.add(fists);
    root.userData = { gun, fists, barrels: mg.userData.barrels, L, R };
    this.barrelAngle = 0;
    this.vm = root;
    this.setRageVisuals(this.raging);
    return root;
  }

  animateViewmodel(dt) {
    const u = this.vm.userData;
    this.barrelAngle += this.spin * dt * 45;
    u.barrels.rotation.z = this.barrelAngle;
    u.gun.position.x = (Math.random() - 0.5) * 0.006 * (this.spin >= 1 ? 1 : 0);
    if (this.worldGun) this.worldGun.userData.barrels.rotation.z = this.barrelAngle;
    this.punchT += dt;
    const k = this.punchT < 0.16 ? Math.sin((this.punchT / 0.16) * Math.PI) : 0;
    u.R.position.z = this.punchSide > 0 ? -k * 0.28 : 0;
    u.L.position.z = this.punchSide < 0 ? -k * 0.28 : 0;
    u.R.position.x = this.punchSide > 0 ? -k * 0.12 : 0;
    u.L.position.x = this.punchSide < 0 ? k * 0.12 : 0;
    const slamLift = this.slamming ? 0.15 : 0;
    u.fists.position.y = damp(u.fists.position.y, slamLift, 10, dt);
    if (this.reloading > 0) u.gun.position.y = damp(u.gun.position.y, -0.25, 8, dt);
    else u.gun.position.y = damp(u.gun.position.y, 0, 8, dt);
  }
}
