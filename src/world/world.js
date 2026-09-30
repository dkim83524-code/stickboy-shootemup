import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonGradient, INK } from '../core/toon.js';
import { rayBox, normalFromAxis } from '../core/utils.js';

/*
 * The city map. Everything solid is an axis-aligned box so collision and raycasts stay
 * simple and exact (trees and roofs add round shapes for looks, backed by box colliders).
 * Static geometry is merged into a handful of meshes to keep draw calls tiny.
 *
 * The map is point-symmetric around the origin: buildHalf(+1) lays out Blue's half
 * (x < 0) and buildHalf(-1) mirrors it for Red, so both teams get the same districts:
 *   spawn gate · diner · construction yard (containers, scaffold, crane) · hotel with a
 *   skybridge over the avenue · setback tower · apartments · warehouse with a tunnel ·
 *   park (trees, pond, gazebo) · market (stalls with awnings) · arch gates · fountains
 */

const PALETTE = {
  ground: 0x8a8f9c,
  sidewalk: 0xd9d4c7,
  plaza: 0xeadfcb,
  grass: 0x8cc63f,
  grassDark: 0x6aa84f,
  sand: 0xe0c48a,
  tiles: 0xe9d8a6,
  water: 0x5fa8d3,
  line: 0xf6f1e3,
  wall: 0xb3aca0,
  crate: 0xc98c52,
  crateDark: 0x8f5a2f,
  window: 0x3b4a6b,
  windowLit: 0xffe8a3,
  roofTrim: 0xf7f3ea,
  step: 0xc7c1b5,
  metal: 0x6c7384,
  trunk: 0x7a4e2d,
  leaves: [0x5cb85c, 0x4c9a2a, 0x76c043],
  stone: 0xc2bcb0,
  yellow: 0xf4b400,
};

const GRID_CELL = 8;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.boxes = []; // static colliders {minX..maxZ}
    this.dynamic = []; // {minX..maxZ, owner}
    this.bounds = { minX: -80, maxX: 80, minZ: -54, maxZ: 54 };
    this.spawns = [[], []];
    this.geos = { solid: [], solidRound: [], hull: [], hullRound: [], detail: [], detailUpright: [], detailRound: [] };
    this.stamp = 0;
    this.build();
    this.buildGrid();
  }

  // ---------------------------------------------------------------- geometry helpers
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
    // flat details (sidewalks, grass, road paint) receive shadows; upright ones don't
    (detail ? (h < 0.1 ? this.geos.detail : this.geos.detailUpright) : this.geos.solid).push(g);
    if (outline > 0) {
      const hg = new THREE.BoxGeometry(w + outline * 2, h + outline * 2, d + outline * 2);
      hg.translate(cx, cy, cz);
      this.geos.hull.push(hg);
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

  /** Non-box decorative shape (sphere, cone...) with an enlarged back-face hull. */
  shape(geo, color, pos, { hullScale = 1.08, detail = false } = {}) {
    const g = geo.clone();
    g.translate(pos.x, pos.y, pos.z);
    this.colored(g, color);
    const indexed = !!g.index;
    const key = detail ? (indexed ? 'detail' : 'detailRound') : indexed ? 'solid' : 'solidRound';
    this.geos[key].push(g);
    if (hullScale > 1) {
      const h = geo.clone();
      h.scale(hullScale, hullScale, hullScale);
      h.translate(pos.x, pos.y, pos.z);
      for (const name of Object.keys(h.attributes)) if (name !== 'position') h.deleteAttribute(name);
      (indexed ? this.geos.hull : this.geos.hullRound).push(h);
    }
  }

  // ---------------------------------------------------------------- mirrored helpers
  // In buildHalf(s) every coordinate is given for Blue's half and multiplied by s.
  sblock(s, x0, y0, z0, x1, y1, z1, color, opts) {
    return this.block(Math.min(x0 * s, x1 * s), y0, Math.min(z0 * s, z1 * s), Math.max(x0 * s, x1 * s), y1, Math.max(z0 * s, z1 * s), color, opts);
  }

  sbox(s, cx, cz, w, d, h, color, y0 = 0, opts = {}) {
    return this.sblock(s, cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, color, opts);
  }

  swindows(s, x0, z0, x1, z1, h, y0 = 0) {
    this.windows(Math.min(x0 * s, x1 * s), Math.min(z0 * s, z1 * s), Math.max(x0 * s, x1 * s), Math.max(z0 * s, z1 * s), h, y0);
  }

  building(s, x0, z0, x1, z1, h, color, { windows = true, sidewalk = true, trim = true, outline = 0.12 } = {}) {
    this.sblock(s, x0, 0, z0, x1, h, z1, color, { outline });
    const [ax, bx] = [Math.min(x0 * s, x1 * s), Math.max(x0 * s, x1 * s)];
    const [az, bz] = [Math.min(z0 * s, z1 * s), Math.max(z0 * s, z1 * s)];
    if (trim) this.block(ax - 0.08, h - 0.35, az - 0.08, bx + 0.08, h + 0.05, bz + 0.08, PALETTE.roofTrim, { collide: false, outline: 0, detail: true });
    if (sidewalk) this.block(ax - 1.6, 0, az - 1.6, bx + 1.6, 0.04, bz + 1.6, PALETTE.sidewalk, { collide: false, outline: 0, detail: true });
    if (windows) this.windows(ax, az, bx, bz, h);
  }

  windows(ax, az, bx, bz, h, y0 = 0) {
    const w = bx - ax;
    const d = bz - az;
    const cx = (ax + bx) / 2;
    const cz = (az + bz) / 2;
    const rows = [];
    for (let y = y0 + 2; y < h - 1.2; y += 3) rows.push(y);
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
          const col = Math.random() < 0.18 ? PALETTE.windowLit : PALETTE.window;
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
    if (y0 === 0) {
      this.block(cx - 0.8, 0, bz, cx + 0.8, 2.3, bz + 0.06, 0x3a2e2a, { collide: false, outline: 0, detail: true });
      this.block(cx - 0.8, 0, az - 0.06, cx + 0.8, 2.3, az, 0x3a2e2a, { collide: false, outline: 0, detail: true });
    }
  }

  /** Straight staircase: steps along `axis` starting at `start` going `dir`, spanning [o0, o0+width] on the other axis. */
  stairRun(s, { axis, start, dir, o0, width = 2, height, depth = 1, color = PALETTE.step }) {
    const steps = Math.round(height / 0.5);
    for (let i = 0; i < steps; i++) {
      const top = (i + 1) * 0.5;
      const a = start + dir * i * depth;
      const b = start + dir * (i + 1) * depth;
      if (axis === 'x') this.sblock(s, Math.min(a, b), 0, o0, Math.max(a, b), top, o0 + width, color, { outline: 0.05 });
      else this.sblock(s, o0, 0, Math.min(a, b), o0 + width, top, Math.max(a, b), color, { outline: 0.05 });
    }
  }

  tree(s, x, z, scale = 1) {
    const px = x * s;
    const pz = z * s;
    this.box(px, pz, 0.5 * scale, 0.5 * scale, 2.6 * scale, PALETTE.trunk, 0, { outline: 0.05 });
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const blobs = [
      [0, 3.4, 0, 1.5],
      [0.7, 2.9, 0.4, 1.05],
      [-0.6, 3.0, -0.5, 1.1],
      [0.1, 4.3, -0.1, 1.0],
    ];
    blobs.forEach(([bx, by, bz, r], i) => {
      const g = ico.clone().scale(r * scale, r * scale, r * scale);
      g.rotateY(i * 1.3 + x);
      this.shape(g, PALETTE.leaves[i % 3], new THREE.Vector3(px + bx * scale, by * scale, pz + bz * scale), { hullScale: 1.07 });
    });
    // leaves stop bullets (and let snipers grapple into trees)
    this.boxes.push({ minX: px - 1.2 * scale, minY: 2.4 * scale, minZ: pz - 1.2 * scale, maxX: px + 1.2 * scale, maxY: 4.6 * scale, maxZ: pz + 1.2 * scale });
  }

  /** Shipping container with corrugation ridges. alongX: long axis is x. */
  container(s, x0, z0, alongX, y0, color) {
    const L = 6;
    const W = 2.5;
    const H = 2.6;
    const x1 = alongX ? x0 + L : x0 + W;
    const z1 = alongX ? z0 + W : z0 + L;
    this.sblock(s, x0, y0, z0, x1, y0 + H, z1, color, { outline: 0.06 });
    const dark = new THREE.Color(color).multiplyScalar(0.72).getHex();
    for (let i = 1; i < 10; i++) {
      const t = i / 10;
      if (alongX) {
        const x = x0 + L * t;
        this.sblock(s, x - 0.08, y0 + 0.15, z0 - 0.05, x + 0.08, y0 + H - 0.15, z1 + 0.05, dark, { collide: false, outline: 0, detail: true });
      } else {
        const z = z0 + L * t;
        this.sblock(s, x0 - 0.05, y0 + 0.15, z - 0.08, x1 + 0.05, y0 + H - 0.15, z + 0.08, dark, { collide: false, outline: 0, detail: true });
      }
    }
  }

  lamp(s, x, z) {
    this.sbox(s, x, z, 0.22, 0.22, 4.4, 0x3d4250, 0, { outline: 0.04 });
    this.sbox(s, x, z, 0.7, 0.7, 0.3, 0x3d4250, 4.4, { outline: 0.04, collide: false });
    this.sbox(s, x, z, 0.5, 0.5, 0.12, 0xfff3b0, 4.3, { outline: 0, collide: false, detail: true });
  }

  stall(s, x, z, color) {
    // counter + awning on posts; awning stops bullets from above but you can walk under it
    this.sbox(s, x, z, 2.6, 1.0, 1.1, 0xa1683a, 0, { outline: 0.05 });
    this.sbox(s, x, z, 2.7, 1.1, 0.12, 0xf6f1e3, 1.1, { outline: 0.03, collide: false });
    for (const dx of [-1.35, 1.35]) this.sbox(s, x + dx, z - 0.9, 0.12, 0.12, 2.4, 0x6b4226, 0, { outline: 0.03, collide: false });
    this.sbox(s, x, z - 0.6, 3.2, 2.4, 0.16, color, 2.4, { outline: 0.05 });
    for (let i = 0; i < 4; i++) {
      this.sbox(s, x - 1.2 + i * 0.8, z - 0.6, 0.35, 2.42, 0.18, 0xffffff, 2.39, { outline: 0, collide: false, detail: true });
    }
    // produce
    const fruit = [0xe63946, 0xf4a261, 0x8cc63f];
    for (let i = 0; i < 5; i++) this.sbox(s, x - 1 + i * 0.5, z + 0.1, 0.35, 0.35, 0.25, fruit[i % 3], 1.1, { outline: 0.02, collide: false });
  }

  fountain(s, x, z) {
    const w = 6;
    const t = 0.4;
    const h = 0.5;
    this.sbox(s, x, z - w / 2 + t / 2, w, t, h, PALETTE.stone, 0, { outline: 0.05 });
    this.sbox(s, x, z + w / 2 - t / 2, w, t, h, PALETTE.stone, 0, { outline: 0.05 });
    this.sbox(s, x - w / 2 + t / 2, z, t, w - 2 * t, h, PALETTE.stone, 0, { outline: 0.05 });
    this.sbox(s, x + w / 2 - t / 2, z, t, w - 2 * t, h, PALETTE.stone, 0, { outline: 0.05 });
    this.sbox(s, x, z, w - 2 * t, w - 2 * t, 0.3, PALETTE.water, 0, { outline: 0, collide: false, detail: true });
    this.sbox(s, x, z, 0.9, 0.9, 1.6, PALETTE.stone, 0, { outline: 0.05 });
    this.shape(new THREE.SphereGeometry(0.7, 12, 8), PALETTE.water, new THREE.Vector3(x * s, 2.0, z * s), { hullScale: 1.08 });
  }

  // ---------------------------------------------------------------- layout
  build() {
    const groundGeo = new THREE.PlaneGeometry(700, 700);
    groundGeo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(groundGeo, new THREE.MeshToonMaterial({ color: PALETTE.ground, gradientMap: toonGradient() }));
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.buildHalf(1);
    this.buildHalf(-1);
    this.buildShared();
    this.buildMeshes();
  }

  /** One team's half of the map. s = +1 → Blue (x < 0), s = -1 → Red (mirrored). */
  buildHalf(s) {
    const team = s === 1 ? 0 : 1;
    const flat = { collide: false, outline: 0, detail: true };

    // ---- spawn courtyard + gate
    this.sblock(s, -79, 0, -14, -66, 0.05, 14, team === 0 ? 0xbfd4ff : 0xffc4c9, flat);
    for (const z of [-10, -5, 0, 5, 10]) {
      for (const x of [-76, -71]) this.spawns[team].push(new THREE.Vector3(x * s, 0, z * s));
    }
    const gateCol = team === 0 ? 0x3a86ff : 0xff4d5e;
    this.sblock(s, -65.25, 0, 5.75, -63.75, 5, 7.25, PALETTE.stone, { outline: 0.06 });
    this.sblock(s, -65.25, 0, -7.25, -63.75, 5, -5.75, PALETTE.stone, { outline: 0.06 });
    this.sblock(s, -65.4, 4, -7.4, -63.6, 5.2, 7.4, gateCol, { outline: 0.06 });
    this.sblock(s, -65, 0, 7.25, -64, 3, 16, PALETTE.wall, { outline: 0.06 });
    this.sblock(s, -65, 0, -16, -64, 3, -7.25, PALETTE.wall, { outline: 0.06 });
    this.sbox(s, -69, 12.5, 1.6, 1.6, 1.6, PALETTE.crate, 0, { outline: 0.05 });
    this.sbox(s, -69, -12.5, 1.6, 1.6, 1.6, PALETTE.crate, 0, { outline: 0.05 });

    // spawn flank buildings (south one has stairs to its roof)
    this.building(s, -79, 28, -65, 40, 6, 0xb5838d);
    this.building(s, -79, -40, -65, -28, 6, 0x90be6d);
    this.stairRun(s, { axis: 'x', start: -65, dir: -1, o0: -28, width: 2, height: 6 });

    // ---- diner (north of the avenue, near spawn)
    this.building(s, -60, 12, -48, 20, 5, 0xe63946);
    this.sblock(s, -60.1, 3.6, 11.8, -47.9, 4.2, 12, 0xffffff, { collide: false, outline: 0, detail: true });
    this.sbox(s, -54, 16, 5, 0.3, 1.6, 0xffd23f, 5, { outline: 0.05, collide: false });

    // ---- construction yard
    this.sblock(s, -63, 0, 22, -41, 0.04, 53, PALETTE.sand, flat);
    this.container(s, -60, 28, true, 0, 0xe76f51);
    this.container(s, -62, 28, true, 2.6, 0x2a9d8f);
    this.sbox(s, -52.9, 29.25, 1.4, 1.4, 1.3, PALETTE.crate, 0, { outline: 0.05 });
    this.sbox(s, -55, 29.25, 1.3, 1.3, 1.3, PALETTE.crateDark, 2.6, { outline: 0.05 });
    this.container(s, -50, 34, false, 0, 0xc1121f);
    this.container(s, -60, 44, true, 0, 0xe9c46a);
    this.container(s, -60, 44, true, 2.6, 0x6d597a);
    this.container(s, -47, 48, true, 0, 0x457b9d);
    // scaffold tower: four posts + deck at 5.6, stairs up the south side
    for (const [px, pz] of [[-52, 42], [-48.3, 42], [-52, 45.7], [-48.3, 45.7]]) {
      this.sblock(s, px, 0, pz, px + 0.3, 5.3, pz + 0.3, PALETTE.yellow, { outline: 0.04 });
    }
    this.sblock(s, -52.2, 5.3, 41.8, -47.8, 5.6, 46.2, 0x8d99a6, { outline: 0.05 });
    this.sblock(s, -52.2, 5.6, 46.0, -47.8, 6.5, 46.2, PALETTE.yellow, { outline: 0.03 });
    this.stairRun(s, { axis: 'x', start: -41, dir: -1, o0: 40, width: 2, height: 5.5, color: 0x8d99a6 });
    // crane: collidable mast, decorative jib
    this.sblock(s, -45.6, 0, 29.4, -44.4, 22, 30.6, PALETTE.yellow, { outline: 0.06 });
    this.sblock(s, -62, 21, 29.5, -32, 22, 30.5, PALETTE.yellow, { collide: false, outline: 0.06 });
    this.sblock(s, -44, 19.2, 29.2, -40, 21, 30.8, 0x3d4250, { collide: false, outline: 0.06 });
    this.sblock(s, -56.08, 12, 29.92, -55.92, 21, 30.08, INK, { collide: false, outline: 0 });
    this.sblock(s, -56.5, 11.2, 29.5, -55.5, 12, 30.5, 0x3d4250, { collide: false, outline: 0.04 });

    // ---- hotel (L-shape) with free-standing stairs and a skybridge over the avenue
    this.building(s, -40, 11, -26, 19, 8, 0xf2c14e);
    this.building(s, -40, 19, -34, 27, 8, 0xf2c14e, { sidewalk: false });
    this.stairRun(s, { axis: 'z', start: 27, dir: -1, o0: -26, width: 2, height: 8 });
    this.building(s, -40, -19, -26, -11, 8, 0xe07a5f);
    this.sblock(s, -34.5, 7.6, -11, -31.5, 8, 11, 0x9aa3ad, { outline: 0.05 });
    this.sblock(s, -34.5, 8, -11, -34.3, 8.9, 11, 0x6c7384, { outline: 0.03 });
    this.sblock(s, -31.7, 8, -11, -31.5, 8.9, 11, 0x6c7384, { outline: 0.03 });
    this.sbox(s, -36.5, 14, 2.2, 2.2, 1.3, 0xd0d4db, 8, { outline: 0.06 });

    // ---- setback tower
    this.building(s, -19, 17, -9, 27, 12, 0x6d9dc5);
    this.sbox(s, -14, 22, 7, 7, 8, 0x5d8bb5, 12, { outline: 0.1 });
    this.swindows(s, -17.5, 18.5, -10.5, 25.5, 20, 12);
    this.sbox(s, -14, 22, 4, 4, 6, 0x4f79a0, 20, { outline: 0.08 });
    this.sbox(s, -14, 22, 0.3, 0.3, 6, 0xd0d4db, 26, { outline: 0.03, collide: false });

    // ---- apartments + corner shop (north)
    this.building(s, -34, 34, -22, 48, 14, 0x81b29a);
    this.building(s, -19, 34, -12, 48, 7, 0x9c89b8);

    // ---- market (south of the avenue)
    this.sblock(s, -24, 0, -24, -11, 0.05, -9.5, PALETTE.tiles, flat);
    this.stall(s, -21, -13, 0xe63946);
    this.stall(s, -14.5, -13, 0x2a9d8f);
    this.stall(s, -21, -20.5, 0xf4a261);
    this.stall(s, -14.5, -20.5, 0x457b9d);

    // ---- warehouse with an east-west tunnel through it
    this.building(s, -38, -40, -24, -36.5, 7, 0x7d8491, { windows: false });
    this.building(s, -38, -33.5, -24, -30, 7, 0x7d8491, { windows: false, sidewalk: false });
    this.sblock(s, -38, 3.8, -36.5, -24, 7, -33.5, 0x7d8491, { outline: 0.1 });
    for (const x of [-35, -30]) this.sblock(s, x, 0.3, -30, x + 3, 3.1, -29.94, 0xe76f51, { collide: false, outline: 0, detail: true });
    this.sblock(s, -38, 6.65, -40.08, -24, 7.05, -29.92, PALETTE.roofTrim, { collide: false, outline: 0, detail: true });

    // ---- south block building
    this.building(s, -19, -38, -10, -28, 9, 0xf4a261);

    // ---- park
    this.sblock(s, -64, 0, -53, -41, 0.05, -23, PALETTE.grass, flat);
    this.sblock(s, -57, 0, -44, -50, 0.08, -38, PALETTE.water, flat);
    for (const [x, z] of [[-57.5, -44.5], [-49.5, -44.5], [-57.5, -37.5], [-49.5, -37.5]]) this.sblock(s, x, 0, z, x + 0.5, 0.35, z + 0.5, PALETTE.stone, { outline: 0.03, collide: false });
    for (const [x, z, sc] of [[-60, -28, 1], [-52, -27, 1.15], [-46, -31, 0.9], [-60, -38, 1.1], [-43, -46, 1], [-60, -49, 1.2], [-53, -50, 0.95], [-44, -51, 1.05]]) {
      this.tree(s, x, z, sc);
    }
    // gazebo: posts + walkable roof slab
    for (const [px, pz] of [[-48.4, -42.4], [-43.9, -42.4], [-48.4, -37.9], [-43.9, -37.9]]) this.sblock(s, px, 0, pz, px + 0.3, 3, pz + 0.3, 0xf6f1e3, { outline: 0.03 });
    this.sblock(s, -48.8, 3, -42.8, -43.5, 3.25, -37.5, 0xbc4749, { outline: 0.05 });
    const roof = new THREE.ConeGeometry(3.8, 1.6, 4);
    roof.rotateY(Math.PI / 4);
    this.shape(roof, 0xbc4749, new THREE.Vector3(-46.15 * s, 4.05, -40.15 * s), { hullScale: 1.05 });
    this.sbox(s, -55, -33, 6, 1, 1.1, PALETTE.grassDark, 0, { outline: 0.05 });
    this.sbox(s, -62, -44, 1, 6, 1.1, PALETTE.grassDark, 0, { outline: 0.05 });
    this.sbox(s, -54, -36, 2, 0.6, 0.5, 0x8f5a2f, 0, { outline: 0.04 });
    this.sbox(s, -50, -47.5, 0.6, 2, 0.5, 0x8f5a2f, 0, { outline: 0.04 });

    // ---- arch gate across the centre street (tunnel under the middle)
    this.building(s, -9, 38, -2.5, 46, 10, 0x8ecae6, { windows: false });
    this.building(s, 2.5, 38, 9, 46, 10, 0x8ecae6, { windows: false, sidewalk: false });
    this.sblock(s, -2.5, 3.8, 38, 2.5, 10, 46, 0x8ecae6, { outline: 0.12 });
    this.sblock(s, -9.1, 9.65, 37.9, 9.1, 10.05, 46.1, PALETTE.roofTrim, { collide: false, outline: 0, detail: true });
    this.swindows(s, -9, 38, 9, 46, 10, 4);

    // ---- fountain on the centre street
    this.fountain(s, 0, 16);

    // ---- street furniture & cover
    for (const x of [-58, -46, -22, -12]) {
      this.lamp(s, x, 7.8);
      this.lamp(s, x + 6, -7.8);
    }
    for (const [x, z, sc] of [[-52, 9.2, 0.8], [-18, 9.5, 0.75], [-44, -9.2, 0.8]]) this.tree(s, x, z, sc);
    const cover = [
      [-58, 2, 1.6, 1.6, 1.6, PALETTE.crate],
      [-50, -3, 0.8, 4, 1.3, PALETTE.wall],
      [-42, 3.5, 1.6, 1.6, 1.6, PALETTE.crate],
      [-40.4, 3.5, 1.6, 1.6, 1.6, PALETTE.crateDark],
      [-26, -3, 2.4, 1.2, 1.2, PALETTE.crateDark],
      [-20, 2, 0.8, 4, 1.3, PALETTE.wall],
      [-6, 26, 1.6, 1.6, 1.6, PALETTE.crate],
      [-5, -30, 1.6, 1.6, 1.6, PALETTE.crate],
      [-4, 32, 0.8, 4, 1.3, PALETTE.wall],
      [-22, 29, 1.6, 1.6, 1.6, PALETTE.crate],
      [-38, 30, 1.6, 1.6, 1.6, PALETTE.crate],
      [-45, -20, 1.6, 1.6, 1.6, PALETTE.crate],
      [-8, -18, 1.6, 1.6, 1.6, PALETTE.crate],
    ];
    for (const [x, z, w, d, h, c] of cover) this.sbox(s, x, z, w, d, h, c, 0, { outline: 0.05 });

    // road markings on this half
    for (let x = -60; x <= -12; x += 4) this.sblock(s, x - 1, 0, -0.12, x + 1, 0.02, 0.12, PALETTE.line, flat);
    for (let z = 12; z <= 50; z += 4) {
      if (z > 36 && z < 48) continue;
      this.sblock(s, -0.12, 0, z - 1, 0.12, 0.02, z + 1, PALETTE.line, flat);
    }
    // crosswalks at the plaza
    for (let z = -6; z <= 6; z += 1.5) this.sblock(s, -12.5, 0, z - 0.4, -10.5, 0.02, z + 0.4, PALETTE.line, flat);
  }

  buildShared() {
    // Central plaza + statue pedestal (the statue itself is added by the game)
    this.block(-10, 0, -10, 10, 0.05, 10, PALETTE.plaza, { collide: false, outline: 0, detail: true });
    this.box(0, 0, 4, 4, 1.8, 0xd8d2c4, 0, { outline: 0.08 });
    this.box(0, 0, 5, 5, 0.5, 0xc2bcb0, 0, { outline: 0.06 });

    // Boundary walls
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const H = 16;
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
    for (let i = 0; i < 80; i++) {
      const a = (i / 80) * Math.PI * 2;
      const r = 115 + rnd() * 45;
      const x = Math.cos(a) * r * 1.2;
      const z = Math.sin(a) * r * 0.85;
      const w = 10 + rnd() * 14;
      const h = 18 + rnd() * 50;
      this.box(x, z, w, w, h, skyCols[i % skyCols.length], 0, { collide: false, outline: 0.25 });
    }
  }

  buildMeshes() {
    const toon = (extra = {}) => new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient(), ...extra });
    const add = (list, mat, { cast = false, receive = true } = {}) => {
      if (!list.length) return;
      const m = new THREE.Mesh(mergeGeometries(list), mat);
      m.castShadow = cast;
      m.receiveShadow = receive;
      this.scene.add(m);
      for (const g of list) g.dispose();
    };
    // Walls cast shadows onto the ground and characters but don't receive them: the toon
    // ramp already shades each face, and self-shadowing walls at grazing angles only
    // produces acne stripes.
    add(this.geos.solid, toon(), { cast: true, receive: false });
    add(this.geos.solidRound, toon(), { cast: true, receive: false });
    add(this.geos.detail, toon());
    add(this.geos.detailUpright, toon(), { receive: false });
    add(this.geos.detailRound, toon(), { receive: false });
    // hulls only need positions; strip the rest so boxes and cones merge together
    for (const g of [...this.geos.hull, ...this.geos.hullRound]) {
      for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    }
    const ink = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
    add(this.geos.hull, ink, { receive: false });
    add(this.geos.hullRound, ink, { receive: false });
    this.geos = null;
  }

  // ---------------------------------------------------------------- broadphase
  buildGrid() {
    const b = this.bounds;
    this.gx0 = b.minX - 4;
    this.gz0 = b.minZ - 4;
    this.gw = Math.ceil((b.maxX - b.minX + 8) / GRID_CELL);
    this.gh = Math.ceil((b.maxZ - b.minZ + 8) / GRID_CELL);
    this.grid = Array.from({ length: this.gw * this.gh }, () => []);
    for (const box of this.boxes) this.insertGrid(box);
  }

  insertGrid(box) {
    box.stamp = 0;
    const i0 = Math.max(0, Math.floor((box.minX - this.gx0) / GRID_CELL));
    const i1 = Math.min(this.gw - 1, Math.floor((box.maxX - this.gx0) / GRID_CELL));
    const j0 = Math.max(0, Math.floor((box.minZ - this.gz0) / GRID_CELL));
    const j1 = Math.min(this.gh - 1, Math.floor((box.maxZ - this.gz0) / GRID_CELL));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) this.grid[j * this.gw + i].push(box);
  }

  /** Add a static collider after construction (e.g. the statue). */
  addStatic(box) {
    this.boxes.push(box);
    this.insertGrid(box);
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

  /** Collect boxes overlapping the given bounds (grid broadphase for static boxes). */
  overlapping(minX, minY, minZ, maxX, maxY, maxZ, out) {
    out.length = 0;
    const stamp = ++this.stamp;
    const i0 = Math.max(0, Math.floor((minX - this.gx0) / GRID_CELL));
    const i1 = Math.min(this.gw - 1, Math.floor((maxX - this.gx0) / GRID_CELL));
    const j0 = Math.max(0, Math.floor((minZ - this.gz0) / GRID_CELL));
    const j1 = Math.min(this.gh - 1, Math.floor((maxZ - this.gz0) / GRID_CELL));
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const cell = this.grid[j * this.gw + i];
        for (let k = 0; k < cell.length; k++) {
          const b = cell[k];
          if (b.stamp === stamp) continue;
          b.stamp = stamp;
          if (b.maxX > minX && b.minX < maxX && b.maxY > minY && b.minY < maxY && b.maxZ > minZ && b.minZ < maxZ) out.push(b);
        }
      }
    }
    for (let i = 0; i < this.dynamic.length; i++) {
      const b = this.dynamic[i];
      if (b.maxX > minX && b.minX < maxX && b.maxY > minY && b.minY < maxY && b.maxZ > minZ && b.minZ < maxZ) out.push(b);
    }
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
