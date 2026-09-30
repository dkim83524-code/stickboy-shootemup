import * as THREE from 'three';
import { toonGradient, toonMat, outlineMat, sharedOutline, INK } from '../core/toon.js';
import { clamp, damp } from '../core/utils.js';

/*
 * Procedurally animated stickman: thick capsule limbs, ball head, class hat.
 * Front of the model faces -Z so root.rotation.y = yaw lines up with the camera.
 */

const geoCache = new Map();
function capsule(r, len) {
  const k = `c${r}|${len}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.CapsuleGeometry(r, len, 5, 12));
  return geoCache.get(k);
}
function sphere(r, ws = 16, hs = 12) {
  const k = `s${r}|${ws}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.SphereGeometry(r, ws, hs));
  return geoCache.get(k);
}
function dome(r) {
  const k = `d${r}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2));
  return geoCache.get(k);
}
function cyl(rt, rb, h, seg = 16) {
  const k = `y${rt}|${rb}|${h}|${seg}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.CylinderGeometry(rt, rb, h, seg));
  return geoCache.get(k);
}
function cone(r, h, seg = 12) {
  const k = `n${r}|${h}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.ConeGeometry(r, h, seg));
  return geoCache.get(k);
}
function boxG(w, h, d) {
  const k = `b${w}|${h}|${d}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(k);
}

// Wallhack: red hull + dark fill, drawn on top of everything.
const XRAY_HULL = outlineMat({ thickness: 0.045, color: 0xff2a4a, opacity: 0.95, depthTest: false, fog: false });
const XRAY_FILL = new THREE.MeshBasicMaterial({
  color: 0x1a0008,
  transparent: true,
  opacity: 0.55,
  depthTest: false,
  depthWrite: false,
});

export class Stickman {
  constructor({ color, hat = null, outline = 0.028, eyes = true, material = null } = {}) {
    this.color = color;
    this.mats = [];
    this.bodyMat = material || this.mat(color);
    this.outlineMaterial = outlineMat({ thickness: outline });
    this.parts = [];
    this.xrayMeshes = [];
    this.opacity = 1;
    this.xray = false;
    this.walkPhase = 0;
    this.attack = { t: 99, kind: null, side: 1 };
    this.pose = 'gun';

    const root = (this.root = new THREE.Group());
    const body = (this.body = new THREE.Group());
    root.add(body);
    const hips = (this.hips = new THREE.Group());
    hips.position.y = 0.92;
    body.add(hips);

    const torso = this.part(capsule(0.105, 0.42));
    torso.position.y = 0.25;
    hips.add(torso);

    const chest = (this.chest = new THREE.Group());
    chest.position.y = 0.46;
    hips.add(chest);

    const headG = (this.headG = new THREE.Group());
    headG.position.y = 0.24;
    chest.add(headG);
    const head = this.part(sphere(0.22));
    headG.add(head);
    if (eyes) {
      const eyeMat = this.mat(INK);
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(sphere(0.035, 8, 6), eyeMat);
        e.position.set(0.075 * s, 0.03, -0.195);
        e.scale.set(1, 1.5, 0.6);
        headG.add(e);
      }
    }
    if (hat) this.buildHat(hat);

    this.arms = {};
    for (const side of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(0.17 * side, -0.02, 0);
      chest.add(sh);
      const upper = this.part(capsule(0.066, 0.2));
      upper.position.y = -0.15;
      sh.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      sh.add(elbow);
      const fore = this.part(capsule(0.066, 0.18));
      fore.position.y = -0.14;
      elbow.add(fore);
      const hand = new THREE.Group();
      hand.position.y = -0.3;
      elbow.add(hand);
      const handMesh = this.part(sphere(0.078, 10, 8));
      hand.add(handMesh);
      const mount = new THREE.Group();
      mount.rotation.x = -Math.PI / 2;
      hand.add(mount);
      this.arms[side < 0 ? 'L' : 'R'] = { sh, elbow, hand, mount };
    }

    this.legs = {};
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.1 * side, 0, 0);
      hips.add(hip);
      const thigh = this.part(capsule(0.075, 0.3));
      thigh.position.y = -0.22;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.44;
      hip.add(knee);
      const shin = this.part(capsule(0.075, 0.3));
      shin.position.y = -0.22;
      knee.add(shin);
      const foot = this.part(sphere(0.075, 10, 8));
      foot.position.set(0, -0.44, -0.04);
      foot.scale.set(1, 0.6, 1.5);
      knee.add(foot);
      this.legs[side < 0 ? 'L' : 'R'] = { hip, knee };
    }
  }

  mat(color) {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
    this.mats.push(m);
    return m;
  }

  part(geo, mat = this.bodyMat, { outline = true, xray = true } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.userData.baseColor = mat.color ? mat.color.getHex() : 0xffffff;
    if (outline) {
      const o = new THREE.Mesh(geo, this.outlineMaterial);
      o.userData.isOutline = true;
      m.add(o);
    }
    if (xray) {
      const xh = new THREE.Mesh(geo, XRAY_HULL);
      xh.renderOrder = 998;
      xh.visible = false;
      const xf = new THREE.Mesh(geo, XRAY_FILL);
      xf.renderOrder = 999;
      xf.visible = false;
      m.add(xh, xf);
      this.xrayMeshes.push(xh, xf);
    }
    this.parts.push(m);
    return m;
  }

  buildHat(kind) {
    const g = new THREE.Group();
    const h = this.headG;
    if (kind === 'horns') {
      const helm = this.part(dome(0.235), this.mat(0x8d99a6));
      helm.position.y = 0.02;
      g.add(helm);
      const band = this.part(cyl(0.24, 0.24, 0.05, 18), this.mat(0x6b7682));
      band.position.y = 0.03;
      g.add(band);
      const hornMat = this.mat(0xf3e9d2);
      for (const s of [-1, 1]) {
        const horn = this.part(cone(0.055, 0.3, 10), hornMat);
        horn.position.set(0.24 * s, 0.14, 0);
        horn.rotation.z = -s * 0.75;
        g.add(horn);
      }
    } else if (kind === 'wizard') {
      const hatMat = this.mat(0x5b3fd1);
      const brim = this.part(cyl(0.36, 0.36, 0.03, 20), hatMat);
      brim.position.y = 0.13;
      g.add(brim);
      const top = this.part(cone(0.2, 0.56, 14), hatMat);
      top.position.set(0, 0.42, 0.04);
      top.rotation.x = 0.18;
      g.add(top);
      const band = this.part(cyl(0.205, 0.205, 0.06, 18), this.mat(0xffd23f), { outline: false });
      band.position.y = 0.17;
      g.add(band);
    } else if (kind === 'headband') {
      const clothMat = this.mat(0xc8102e);
      const band = this.part(new THREE.TorusGeometry(0.222, 0.035, 8, 24), clothMat);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.06;
      g.add(band);
      for (const s of [-1, 1]) {
        const tail = this.part(boxG(0.05, 0.26, 0.02), clothMat);
        tail.position.set(0.05 * s, -0.04, 0.26);
        tail.rotation.set(0.5, 0, s * 0.35);
        g.add(tail);
      }
      // ninja mask over the lower face
      const mask = this.part(new THREE.SphereGeometry(0.228, 16, 8, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.55, Math.PI * 0.3), this.mat(0x2d2a3e));
      mask.rotation.y = Math.PI;
      g.add(mask);
    } else if (kind === 'beanie') {
      const knit = this.mat(0x4f772d);
      const cap = this.part(dome(0.232), knit);
      cap.position.y = 0.03;
      cap.scale.set(1, 1.15, 1);
      g.add(cap);
      const fold = this.part(cyl(0.238, 0.238, 0.08, 18), this.mat(0x3b5a21));
      fold.position.y = 0.05;
      g.add(fold);
      const pom = this.part(sphere(0.07, 10, 8), this.mat(0xf0ead6));
      pom.position.y = 0.3;
      g.add(pom);
    } else if (kind === 'hardhat') {
      const yellow = this.mat(0xf4b400);
      const shell = this.part(dome(0.245), yellow);
      shell.position.y = 0.04;
      g.add(shell);
      const brim = this.part(cyl(0.31, 0.31, 0.03, 20), yellow);
      brim.position.set(0, 0.05, -0.03);
      brim.scale.set(1, 1, 1.12);
      g.add(brim);
      const ridge = this.part(boxG(0.06, 0.05, 0.4), yellow);
      ridge.position.y = 0.27;
      g.add(ridge);
    } else if (kind === 'cap') {
      const capMat = this.mat(0xd35400);
      const crown = this.part(dome(0.235), capMat);
      crown.position.y = 0.04;
      g.add(crown);
      const visor = this.part(cyl(0.2, 0.2, 0.025, 16), this.mat(0x7a2f00));
      visor.position.set(0, 0.06, -0.24);
      visor.scale.set(1, 1, 0.8);
      g.add(visor);
      const button = this.part(sphere(0.03, 8, 6), capMat, { xray: false });
      button.position.y = 0.27;
      g.add(button);
    } else if (kind === 'crown') {
      const gold = this.mat(0xffc93c);
      const ring = this.part(cyl(0.24, 0.22, 0.14, 12), gold);
      ring.position.y = 0.18;
      g.add(ring);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const spike = this.part(cone(0.05, 0.14, 6), gold);
        spike.position.set(Math.cos(a) * 0.22, 0.32, Math.sin(a) * 0.22);
        g.add(spike);
      }
    }
    h.add(g);
    this.hat = g;
  }

  triggerAttack(kind = 'swing', side = 1) {
    this.attack.t = 0;
    this.attack.kind = kind;
    this.attack.side = side;
  }

  /**
   * s = { speed, grounded, pitch, pose, dt, moveAngle }
   */
  animate(dt, s) {
    const amt = clamp(s.speed / 6, 0, 1.2);
    this.walkPhase += dt * (4 + s.speed * 1.35) * (amt > 0.05 ? 1 : 0);
    const ph = this.walkPhase;
    const L = this.legs.L;
    const R = this.legs.R;
    const k = 14;
    // crouch: lower hips, bend knees, lean forward (stride shrinks)
    const cr = s.crouch || 0;
    this.hips.position.y = 0.92 - 0.37 * cr;
    const hip0 = 1.35 * cr; // includes 0.25 to undo the hip lean below
    const knee0 = -1.9 * cr;
    const stride = 1 - 0.55 * cr;
    if (s.grounded) {
      L.hip.rotation.x = damp(L.hip.rotation.x, hip0 + Math.sin(ph) * 0.75 * amt * stride, k, dt);
      R.hip.rotation.x = damp(R.hip.rotation.x, hip0 - Math.sin(ph) * 0.75 * amt * stride, k, dt);
      L.knee.rotation.x = damp(L.knee.rotation.x, knee0 - Math.max(0, Math.sin(ph + 1.4)) * 1.0 * amt * stride, k, dt);
      R.knee.rotation.x = damp(R.knee.rotation.x, knee0 - Math.max(0, -Math.sin(ph + 1.4)) * 1.0 * amt * stride, k, dt);
      this.body.position.y = Math.abs(Math.sin(ph)) * 0.05 * amt * stride;
    } else {
      L.hip.rotation.x = damp(L.hip.rotation.x, 0.7, 10, dt);
      R.hip.rotation.x = damp(R.hip.rotation.x, 0.2, 10, dt);
      L.knee.rotation.x = damp(L.knee.rotation.x, -1.2, 10, dt);
      R.knee.rotation.x = damp(R.knee.rotation.x, -0.5, 10, dt);
      this.body.position.y = 0;
    }

    const p = s.pitch || 0;
    const lean = s.pose === 'charge' ? -0.6 : 0;
    this.chest.rotation.x = damp(this.chest.rotation.x, p * 0.3 - cr * 0.25 + lean, 12, dt);
    this.hips.rotation.x = -cr * 0.25;
    this.headG.rotation.x = damp(this.headG.rotation.x, p * 0.45, 12, dt);
    const aimX = Math.PI / 2 + p * 0.7;
    const A = this.arms;
    const swing = Math.sin(ph) * 0.6 * amt;
    const at = this.attack.t;
    this.attack.t += dt;

    const set = (arm, rx, rz, erx, ry = 0) => {
      arm.sh.rotation.x = damp(arm.sh.rotation.x, rx, 18, dt);
      arm.sh.rotation.z = damp(arm.sh.rotation.z, rz, 18, dt);
      arm.sh.rotation.y = damp(arm.sh.rotation.y, ry, 18, dt);
      arm.elbow.rotation.x = damp(arm.elbow.rotation.x, erx, 18, dt);
    };
    const snap = (arm, rx, rz, erx) => {
      arm.sh.rotation.x = rx;
      arm.sh.rotation.z = rz;
      arm.elbow.rotation.x = erx;
    };

    switch (s.pose) {
      case 'gun':
        set(A.R, aimX, -0.1, 0);
        set(A.L, aimX - 0.05, 0.75, 0.35);
        break;
      case 'minigun':
        set(A.R, 1.0 + p * 0.6, -0.15, 0.55);
        set(A.L, 1.0 + p * 0.6, 0.55, 0.55);
        break;
      case 'dual': {
        const kick = at < 0.12 ? (1 - at / 0.12) * 0.4 : 0;
        set(A.R, aimX + (this.attack.side > 0 ? kick : 0), -0.12, 0);
        set(A.L, aimX + (this.attack.side < 0 ? kick : 0), 0.12, 0);
        break;
      }
      case 'wand': {
        const jab = at < 0.2 ? Math.sin((at / 0.2) * Math.PI) * 0.5 : 0;
        set(A.R, aimX + jab, -0.1, 0.1);
        set(A.L, swing * 0.8, 0.12, 0.2);
        break;
      }
      case 'channel':
        set(A.R, Math.PI * 0.92, -0.35, 0.1);
        set(A.L, Math.PI * 0.92, 0.35, 0.1);
        break;
      case 'melee': {
        if (at < 0.28) {
          const t = at / 0.28;
          snap(A.R, 2.7 - t * 2.5, -0.7 + t * 1.3, 0.2);
        } else set(A.R, 1.3 + p * 0.5, -0.25, 0.5);
        set(A.L, -swing * 0.8, 0.15, 0.3);
        break;
      }
      case 'fists': {
        const punching = at < 0.18;
        const pr = punching && this.attack.side > 0;
        const pl = punching && this.attack.side < 0;
        if (this.attack.kind === 'slam' && at < 0.5) {
          set(A.R, Math.PI * 0.95, -0.3, 0.2);
          set(A.L, Math.PI * 0.95, 0.3, 0.2);
        } else {
          set(A.R, pr ? aimX : 1.15, pr ? -0.05 : -0.35, pr ? 0 : 1.7);
          set(A.L, pl ? aimX : 1.15, pl ? 0.05 : 0.35, pl ? 0 : 1.7);
        }
        break;
      }
      case 'charge':
        set(A.R, 0.5, -0.5, 1.2);
        set(A.L, 0.5, 0.5, 1.2);
        break;
      case 'build':
        set(A.R, 0.9, -0.2, 0.9);
        set(A.L, 0.9, 0.2, 0.9);
        break;
      default:
        set(A.R, -swing * 0.8, -0.12, 0.25);
        set(A.L, swing * 0.8, 0.12, 0.25);
    }
  }

  setOpacity(a) {
    if (Math.abs(a - this.opacity) < 0.002) return;
    const wasOpaque = this.opacity >= 1;
    const isOpaque = a >= 1;
    this.opacity = a;
    this.root.visible = a > 0.004;
    for (const m of this.mats) {
      m.opacity = a;
      if (wasOpaque !== isOpaque) {
        m.transparent = !isOpaque;
        m.depthWrite = isOpaque;
        m.needsUpdate = true;
      }
    }
    const om = this.outlineMaterial;
    om.uniforms.opacity.value = isOpaque ? 1 : a * 0.6;
    if (wasOpaque !== isOpaque) {
      om.transparent = !isOpaque;
      om.depthWrite = isOpaque;
      for (const p of this.parts) p.castShadow = isOpaque;
    }
  }

  setXray(on) {
    if (on === this.xray) return;
    this.xray = on;
    for (const m of this.xrayMeshes) m.visible = on;
  }

  /** Spawn loose limb debris into the scene; returns [{mesh, vel, spin}] for the effects system. */
  burst(scene, impulse) {
    this.root.updateMatrixWorld(true);
    const out = [];
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    for (const p of this.parts) {
      const m = new THREE.Mesh(p.geometry, toonMat(p.userData.baseColor));
      m.castShadow = true;
      const o = new THREE.Mesh(p.geometry, sharedOutline(0.028));
      m.add(o);
      p.matrixWorld.decompose(pos, q, scl);
      m.position.copy(pos);
      m.quaternion.copy(q);
      m.scale.copy(scl);
      scene.add(m);
      const vel = impulse.clone().multiplyScalar(0.6 + Math.random() * 0.8);
      vel.x += (Math.random() - 0.5) * 6;
      vel.y += 3 + Math.random() * 5;
      vel.z += (Math.random() - 0.5) * 6;
      const spin = new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16);
      out.push({ mesh: m, vel, spin });
    }
    return out;
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    this.outlineMaterial.dispose();
  }
}
