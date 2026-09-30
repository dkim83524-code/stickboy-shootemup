import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonGradient, INK } from '../core/toon.js';
import { rayBox, normalFromAxis } from '../core/utils.js';

/*
 * The city map. Everything solid is an axis-aligned box so collision and raycasts stay
 * simple and exact. Static geometry is merged into three meshes (solid, outline hull,
 * detail) to keep draw calls tiny. The layout is point-symmetric around the origin so
 * both teams get the same map.
 */

const PALETTE = {
  ground: 0x8a8f9c,
  sidewalk: 0xd9d4c7,
  plaza: 0xeadfcb,
  line: 0xf6f1e3,
  wall: 0xb3aca0,
  crate: 0xc98c52,
  crateDark: 0x8f5a2f,
  window: 0x3b4a6b,
  windowLit: 0xffe8a3,
  roofTrim: 0xf7f3ea,
  step: 0xc7c1b5,
};

// [cx, cz, w, d, h, color, stairs?] for the negative-x half; mirrored for the other half.
const BUILDINGS = [
  [-40, 14, 12, 14, 7, 0xf2c14e, { face: 'x+', dir: -1 }],
  [-40, -15, 12, 16, 12, 0xe07a5f],
  [-14, -15, 10, 14, 16, 0x81b29a],
  [-14, 16, 10, 12, 5, 0x5b8fd9, { face: 'x-', dir: 1 }],
  [-40, 41, 14, 10, 10, 0x9c89b8],
  [-40, -41, 14, 10, 9, 0xf4a261],
  [-14, 41, 10, 10, 20, 0x6d9dc5],
  [-14, -41, 10, 10, 8, 0xe9c46a],
  [-63, 35, 12, 12, 5, 0xb5838d],
  [-63, -35, 12, 12, 5, 0x90be6d, { face: 'z+', dir: -1 }],
];

// Cover: [cx, cz, w, d, h, color]
const COVER = [
  [-52, 4, 1.6, 1.6, 1.6, PALETTE.crate],
  [-52, -6, 1.6, 1.6, 1.6, PALETTE.crate],
  [-51.2, -6.2, 1.2, 1.2, 1.2, PALETTE.crateDark, 1.6],
  [-28, 2.5, 1.6, 1.6, 1.6, PALETTE.crate],
  [-26, -3.5, 2.4, 1.2, 1.2, PALETTE.crateDark],
  [-30, 28, 1.6, 1.6, 1.6, PALETTE.crate],
  [-28.4, 28, 1.6, 1.6, 1.6, PALETTE.crate],
  [-24, -28.5, 1.6, 1.6, 1.6, PALETTE.crate],
  [-6, 12, 1.6, 1.6, 1.6, PALETTE.crate],
  [-5, -24, 1.6, 1.6, 1.6, PALETTE.crate],
  [-5, -24, 1.2, 1.2, 1.2, PALETTE.crateDark, 1.6],
  [-60, 13, 1.6, 1.6, 1.6, PALETTE.crate],
  [-60, -13, 1.6, 1.6, 1.6, PALETTE.crate],
  [-4, 30, 1.6, 1.6, 1.6, PALETTE.crate],
  [-49, 27, 1.6, 1.6, 1.6, PALETTE.crate],
  [-33, -30, 1.6, 1.6, 1.6, PALETTE.crate],
  [-55.5, 0, 0.8, 6, 1.3, PALETTE.wall],
  [-21, 0, 0.8, 4, 1.3, PALETTE.wall],
  [-36, 28, 5, 0.8, 1.3, PALETTE.wall],
  [-8, -33, 0.8, 5, 1.3, PALETTE.wall],
];

// Rooftop clutter (on top of buildings): [cx, cz, w, d, h, y0, color]
const ROOF_PROPS = [
  [-42, 12, 2.2, 2.2, 1.3, 7, 0xd0d4db],
  [-37, 17, 1.4, 3, 1.1, 7, 0xd0d4db],
  [-16, 14, 2, 2, 1.2, 5, 0xd0d4db],
  [-44, -12, 2.5, 2.5, 1.4, 12, 0xd0d4db],
];

export class World {
  constructor(scene) {
    this.scene = scene;
    this.boxes = []; // static colliders {minX..maxZ}
    this.dynamic = []; // {minX..maxZ, owner}
    this.bounds = { minX: -74, maxX: 74, minZ: -50, maxZ: 50 };
    this.spawns = [[], []];
    this.solidGeos = [];
    this.hullGeos = [];
    this.detailGeos = [];
    this.build();
  }

  // ---------------------------------------------------------------- building helpers
  colored(geo, color) {
    const c = new THREE.Color(color);
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  }

  /** Solid block from its bounds. */
  block(minX, minY, minZ, maxX, maxY, maxZ, color, { collide = true, outline = 0.1, detail = false } = {}) {
    const w = maxX - minX;
    const h = maxY - minY;
    const d = maxZ - minZ;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(cx, cy, cz);
    this.colored(g, color);
    (detail ? this.detailGeos : this.solidGeos).push(g);
    if (outline > 0) {
      const hg = new THREE.BoxGeometry(w + outline * 2, h + outline * 2, d + outline * 2);
      hg.translate(cx, cy, cz);
      this.hullGeos.push(hg);
    }
    if (collide) {
      const box = { minX, minY, minZ, maxX, maxY, maxZ };
      this.boxes.push(box);
      return box;
    }
    return null;
  }

  /** Block from center/footprint. */
  box(cx, cz, w, d, h, color, y0 = 0, opts = {}) {
    return this.block(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, color, opts);
  }

  building(cx, cz, w, d, h, color, stairs) {
    this.box(cx, cz, w, d, h, color, 0, { outline: 0.12 });
    // roof trim
    this.block(cx - w / 2 - 0.08, h - 0.35, cz - d / 2 - 0.08, cx + w / 2 + 0.08, h + 0.05, cz + d / 2 + 0.08, PALETTE.roofTrim, {
      collide: false,
      outline: 0,
      detail: true,
    });
    // sidewalk
    this.block(cx - w / 2 - 1.6, 0, cz - d / 2 - 1.6, cx + w / 2 + 1.6, 0.04, cz + d / 2 + 1.6, PALETTE.sidewalk, {
      collide: false,
      outline: 0,
      detail: true,
    });
    this.windows(cx, cz, w, d, h);
    if (stairs) this.stairs(cx, cz, w, d, h, stairs);
  }

  windows(cx, cz, w, d, h) {
    const rows = [];
    for (let y = 2; y < h - 1.2; y += 3) rows.push(y);
    const faces = [
      { axis: 'z', sign: 1, len: w },
      { axis: 'z', sign: -1, len: w },
      { axis: 'x', sign: 1, len: d },
      { axis: 'x', sign: -1, len: d },
    ];
    for (const f of faces) {
      const cols = Math.max(1, Math.floor((f.len - 1.5) / 2.6));
      const span = (cols - 1) * 2.6;
      for (const y of rows) {
        for (let i = 0; i < cols; i++) {
          const o = -span / 2 + i * 2.6;
          const lit = Math.random() < 0.18;
          const col = lit ? PALETTE.windowLit : PALETTE.window;
          if (f.axis === 'z') {
            const z = cz + f.sign * (d / 2 + 0.03);
            this.block(cx + o - 0.6, y, z - 0.04, cx + o + 0.6, y + 1.4, z + 0.04, col, { collide: false, outline: 0, detail: true });
          } else {
            const x = cx + f.sign * (w / 2 + 0.03);
            this.block(x - 0.04, y, cz + o - 0.6, x + 0.04, y + 1.4, cz + o + 0.6, col, { collide: false, outline: 0, detail: true });
          }
        }
      }
    }
    // a door on the -z / +z faces
    this.block(cx - 0.8, 0, cz + d / 2, cx + 0.8, 2.3, cz + d / 2 + 0.06, 0x3a2e2a, { collide: false, outline: 0, detail: true });
    this.block(cx - 0.8, 0, cz - d / 2 - 0.06, cx + 0.8, 2.3, cz - d / 2, 0x3a2e2a, { collide: false, outline: 0, detail: true });
  }

  /** External staircase running along one face up to the roof. */
  stairs(cx, cz, w, d, h, { face, dir }) {
    const steps = Math.round(h / 0.5);
    const width = 2;
    const run = face[0] === 'x' ? d : w;
    const depth = Math.min(1, (run - 0.5) / steps);
    for (let i = 0; i < steps; i++) {
      const top = (i + 1) * 0.5;
      if (face[0] === 'x') {
        const x0 = face[1] === '+' ? cx + w / 2 : cx - w / 2 - width;
        const zStart = dir > 0 ? cz - d / 2 : cz + d / 2;
        const za = zStart + dir * i * depth;
        const zb = zStart + dir * (i + 1) * depth;
        this.block(x0, 0, Math.min(za, zb), x0 + width, top, Math.max(za, zb), PALETTE.step, { outline: 0.05 });
      } else {
        const z0 = face[1] === '+' ? cz + d / 2 : cz - d / 2 - width;
        const xStart = dir > 0 ? cx - w / 2 : cx + w / 2;
        const xa = xStart + dir * i * depth;
        const xb = xStart + dir * (i + 1) * depth;
        this.block(Math.min(xa, xb), 0, z0, Math.max(xa, xb), top, z0 + width, PALETTE.step, { outline: 0.05 });
      }
    }
  }

  // ---------------------------------------------------------------- layout
  build() {
    const mirror = (fn) => {
      fn(1);
      fn(-1);
    };

    // Ground
    const groundGeo = new THREE.PlaneGeometry(600, 600);
    groundGeo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshToonMaterial({ color: PALETTE.ground, gradientMap: toonGradient() }),
    );
    ground.receiveShadow = true;
    this.scene.add(ground);

    for (const [cx, cz, w, d, h, color, stairs] of BUILDINGS) {
      mirror((s) => {
        let st = stairs;
        if (st && s < 0) {
          // mirror the staircase face and direction too
          const flip = { 'x+': 'x-', 'x-': 'x+', 'z+': 'z-', 'z-': 'z+' };
          st = { face: flip[st.face], dir: -st.dir };
        }
        this.building(cx * s, cz * s, w, d, h, color, st);
      });
    }

    for (const [cx, cz, w, d, h, color, y0 = 0] of COVER) {
      mirror((s) => this.box(cx * s, cz * s, w, d, h, color, y0, { outline: 0.05 }));
    }
    for (const [cx, cz, w, d, h, y0, color] of ROOF_PROPS) {
      mirror((s) => this.box(cx * s, cz * s, w, d, h, color, y0, { outline: 0.06 }));
    }

    // Central plaza + statue pedestal
    this.block(-10, 0, -10, 10, 0.05, 10, PALETTE.plaza, { collide: false, outline: 0, detail: true });
    this.box(0, 0, 4, 4, 1.8, 0xd8d2c4, 0, { outline: 0.08 });
    this.box(0, 0, 5, 5, 0.5, 0xc2bcb0, 0, { outline: 0.06 });

    // Road markings along the avenue and the center street
    for (let x = -54; x <= 54; x += 4) {
      if (Math.abs(x) < 11) continue;
      this.block(x - 1, 0, -0.12, x + 1, 0.02, 0.12, PALETTE.line, { collide: false, outline: 0, detail: true });
    }
    for (let z = -46; z <= 46; z += 4) {
      if (Math.abs(z) < 11) continue;
      this.block(-0.12, 0, z - 1, 0.12, 0.02, z + 1, PALETTE.line, { collide: false, outline: 0, detail: true });
    }

    // Spawn pads
    this.block(-73, 0, -14, -58, 0.05, 14, 0xbfd4ff, { collide: false, outline: 0, detail: true });
    this.block(58, 0, -14, 73, 0.05, 14, 0xffc4c9, { collide: false, outline: 0, detail: true });
    for (const z of [-9, -4.5, 0, 4.5, 9]) {
      for (const x of [-68, -63]) {
        this.spawns[0].push(new THREE.Vector3(x, 0, z));
        this.spawns[1].push(new THREE.Vector3(-x, 0, -z));
      }
    }

    // Boundary walls
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const H = 14;
    this.block(minX - 2, 0, minZ - 2, maxX + 2, H, minZ, PALETTE.wall, { outline: 0.12 });
    this.block(minX - 2, 0, maxZ, maxX + 2, H, maxZ + 2, PALETTE.wall, { outline: 0.12 });
    this.block(minX - 2, 0, minZ, minX, H, maxZ, PALETTE.wall, { outline: 0.12 });
    this.block(maxX, 0, minZ, maxX + 2, H, maxZ, PALETTE.wall, { outline: 0.12 });

    // Skyline beyond the walls (visual only)
    const skyCols = [0x9fb3c8, 0xb8c4d6, 0xa7b7cc, 0xc3cedc];
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2;
      const r = 105 + rnd() * 45;
      const x = Math.cos(a) * r * 1.2;
      const z = Math.sin(a) * r * 0.85;
      const w = 10 + rnd() * 14;
      const h = 18 + rnd() * 45;
      this.box(x, z, w, w, h, skyCols[i % skyCols.length], 0, { collide: false, outline: 0.25 });
    }

    // Merge into meshes
    // Everything solid is a closed box, so casting shadows from back faces removes acne
    // on grazing walls without needing a large bias.
    const solid = new THREE.Mesh(
      mergeGeometries(this.solidGeos),
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient(), shadowSide: THREE.BackSide }),
    );
    solid.castShadow = true;
    solid.receiveShadow = true;
    this.scene.add(solid);

    const detail = new THREE.Mesh(
      mergeGeometries(this.detailGeos),
      new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() }),
    );
    detail.receiveShadow = true;
    this.scene.add(detail);

    const hull = new THREE.Mesh(
      mergeGeometries(this.hullGeos),
      new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }),
    );
    this.scene.add(hull);

    for (const g of [...this.solidGeos, ...this.detailGeos, ...this.hullGeos]) g.dispose();
    this.solidGeos = this.detailGeos = this.hullGeos = null;
  }

  // ---------------------------------------------------------------- queries
  addDynamic(box) {
    this.dynamic.push(box);
  }

  removeDynamic(box) {
    const i = this.dynamic.indexOf(box);
    if (i >= 0) this.dynamic.splice(i, 1);
  }

  /**
   * Raycast against the ground, static boxes and dynamic boxes (engineer walls etc).
   * Returns {dist, point, normal, owner} or null.
   */
  raycast(o, d, maxDist, { dynamic = true, ignore = null } = {}) {
    let bestT = maxDist;
    let best = null;
    let bestAxis = 0;
    let bestSign = 0;
    let owner = null;
    if (d.y < -1e-6) {
      const t = -o.y / d.y;
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = true;
        bestAxis = 1;
        bestSign = 1;
      }
    }
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const r = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, boxes[i], bestT);
      if (r && r.t < bestT) {
        bestT = r.t;
        best = true;
        bestAxis = r.axis;
        bestSign = r.sign;
        owner = null;
      }
    }
    if (dynamic) {
      for (const b of this.dynamic) {
        if (ignore && b.owner === ignore) continue;
        const r = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, b, bestT);
        if (r && r.t < bestT) {
          bestT = r.t;
          best = true;
          bestAxis = r.axis;
          bestSign = r.sign;
          owner = b.owner || null;
        }
      }
    }
    if (!best) return null;
    const point = new THREE.Vector3().copy(o).addScaledVector(d, bestT);
    const normal = bestAxis < 0 ? d.clone().negate() : normalFromAxis(bestAxis, bestSign);
    return { dist: bestT, point, normal, owner };
  }

  /** True if segment a→b is unobstructed. */
  lineOfSight(a, b, dynamic = true) {
    _d.subVectors(b, a);
    const len = _d.length();
    if (len < 1e-4) return true;
    _d.divideScalar(len);
    return !this.raycast(a, _d, len - 0.05, { dynamic });
  }

  /** Collect boxes overlapping the given bounds. */
  overlapping(minX, minY, minZ, maxX, maxY, maxZ, out) {
    out.length = 0;
    const test = (b) => {
      if (b.maxX > minX && b.minX < maxX && b.maxY > minY && b.minY < maxY && b.maxZ > minZ && b.minZ < maxZ) out.push(b);
    };
    for (let i = 0; i < this.boxes.length; i++) test(this.boxes[i]);
    for (let i = 0; i < this.dynamic.length; i++) test(this.dynamic[i]);
    return out;
  }

  /** Highest walkable surface at (x,z) not above `maxY`. */
  groundHeight(x, z, maxY = 1e9, r = 0) {
    let h = 0;
    const scan = (b) => {
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ && b.maxY <= maxY + 0.01 && b.maxY > h) h = b.maxY;
    };
    for (const b of this.boxes) scan(b);
    for (const b of this.dynamic) scan(b);
    return h;
  }

  inBounds(x, z, margin = 0) {
    const b = this.bounds;
    return x > b.minX + margin && x < b.maxX - margin && z > b.minZ + margin && z < b.maxZ - margin;
  }
}

const _d = new THREE.Vector3();
