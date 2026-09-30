import * as THREE from 'three';

/*
 * Ground-level navigation grid for bots. Cells blocked by anything taller than a step
 * are unwalkable. A* over 8-connected cells, then string-pulled with grid line checks.
 */
export class NavGrid {
  constructor(world, cell = 1.5) {
    this.world = world;
    this.cell = cell;
    const b = world.bounds;
    this.ox = b.minX;
    this.oz = b.minZ;
    this.w = Math.ceil((b.maxX - b.minX) / cell);
    this.h = Math.ceil((b.maxZ - b.minZ) / cell);
    this.blocked = new Uint8Array(this.w * this.h);
    const pad = 0.45;
    for (const box of world.boxes) {
      if (box.maxY <= 0.55 || box.minY > 1.9) continue;
      const i0 = Math.floor((box.minX - pad - this.ox) / cell);
      const i1 = Math.floor((box.maxX + pad - this.ox) / cell);
      const j0 = Math.floor((box.minZ - pad - this.oz) / cell);
      const j1 = Math.floor((box.maxZ + pad - this.oz) / cell);
      for (let i = Math.max(0, i0); i <= Math.min(this.w - 1, i1); i++) {
        for (let j = Math.max(0, j0); j <= Math.min(this.h - 1, j1); j++) this.blocked[j * this.w + i] = 1;
      }
    }
    // Map edges
    for (let i = 0; i < this.w; i++) {
      this.blocked[i] = 1;
      this.blocked[(this.h - 1) * this.w + i] = 1;
    }
    for (let j = 0; j < this.h; j++) {
      this.blocked[j * this.w] = 1;
      this.blocked[j * this.w + this.w - 1] = 1;
    }
    this.walkableCells = [];
    for (let k = 0; k < this.blocked.length; k++) if (!this.blocked[k]) this.walkableCells.push(k);
  }

  ci(x) {
    return Math.floor((x - this.ox) / this.cell);
  }

  cj(z) {
    return Math.floor((z - this.oz) / this.cell);
  }

  walkable(i, j) {
    return i >= 0 && j >= 0 && i < this.w && j < this.h && !this.blocked[j * this.w + i];
  }

  center(k, out = new THREE.Vector3()) {
    const i = k % this.w;
    const j = Math.floor(k / this.w);
    return out.set(this.ox + (i + 0.5) * this.cell, 0, this.oz + (j + 0.5) * this.cell);
  }

  nearestWalkable(x, z) {
    let i = this.ci(x);
    let j = this.cj(z);
    if (this.walkable(i, j)) return j * this.w + i;
    for (let r = 1; r < 12; r++) {
      for (let di = -r; di <= r; di++) {
        for (let dj = -r; dj <= r; dj++) {
          if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
          if (this.walkable(i + di, j + dj)) return (j + dj) * this.w + (i + di);
        }
      }
    }
    return -1;
  }

  randomPoint(filter = null, tries = 30) {
    for (let t = 0; t < tries; t++) {
      const k = this.walkableCells[Math.floor(Math.random() * this.walkableCells.length)];
      const p = this.center(k);
      if (!filter || filter(p)) return p;
    }
    return this.center(this.walkableCells[Math.floor(Math.random() * this.walkableCells.length)]);
  }

  /** Straight-line walkability check on the grid (supercover sampling). */
  lineWalkable(ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / (this.cell * 0.35));
    for (let s = 0; s <= steps; s++) {
      const t = s / Math.max(1, steps);
      if (!this.walkable(this.ci(ax + dx * t), this.cj(az + dz * t))) return false;
    }
    return true;
  }

  findPath(from, to) {
    const start = this.nearestWalkable(from.x, from.z);
    const goal = this.nearestWalkable(to.x, to.z);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [to.clone()];
    const W = this.w;
    const n = this.blocked.length;
    const g = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const gx = goal % W;
    const gz = Math.floor(goal / W);
    const hfn = (k) => {
      const dx = Math.abs((k % W) - gx);
      const dz = Math.abs(Math.floor(k / W) - gz);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    g[start] = 0;
    heap.push(start, hfn(start));
    let found = false;
    let iter = 0;
    while (heap.size && iter++ < 12000) {
      const k = heap.pop();
      if (k === goal) {
        found = true;
        break;
      }
      if (closed[k]) continue;
      closed[k] = 1;
      const i = k % W;
      const j = Math.floor(k / W);
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue;
          const ni = i + di;
          const nj = j + dj;
          if (!this.walkable(ni, nj)) continue;
          if (di && dj && (!this.walkable(i + di, j) || !this.walkable(i, j + dj))) continue;
          const nk = nj * W + ni;
          if (closed[nk]) continue;
          const cost = g[k] + (di && dj ? 1.414 : 1);
          if (cost < g[nk]) {
            g[nk] = cost;
            came[nk] = k;
            heap.push(nk, cost + hfn(nk));
          }
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = goal; k !== -1; k = came[k]) cells.push(k);
    cells.reverse();
    // string pulling
    const pts = cells.map((k) => this.center(k));
    const out = [];
    let anchor = new THREE.Vector3(from.x, 0, from.z);
    let idx = 0;
    while (idx < pts.length - 1) {
      let far = idx + 1;
      for (let t = pts.length - 1; t > idx + 1; t--) {
        if (this.lineWalkable(anchor.x, anchor.z, pts[t].x, pts[t].z)) {
          far = t;
          break;
        }
      }
      out.push(pts[far]);
      anchor = pts[far];
      idx = far;
    }
    if (out.length) out[out.length - 1] = new THREE.Vector3(to.x, 0, to.z);
    if (!this.walkable(this.ci(to.x), this.cj(to.z)) && out.length) out[out.length - 1] = pts[pts.length - 1];
    return out;
  }
}

class MinHeap {
  constructor() {
    this.items = [];
    this.prios = [];
  }

  get size() {
    return this.items.length;
  }

  push(item, prio) {
    const it = this.items;
    const pr = this.prios;
    it.push(item);
    pr.push(prio);
    let i = it.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (pr[p] <= pr[i]) break;
      [it[p], it[i]] = [it[i], it[p]];
      [pr[p], pr[i]] = [pr[i], pr[p]];
      i = p;
    }
  }

  pop() {
    const it = this.items;
    const pr = this.prios;
    const top = it[0];
    const lastI = it.pop();
    const lastP = pr.pop();
    if (it.length) {
      it[0] = lastI;
      pr[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < it.length && pr[l] < pr[m]) m = l;
        if (r < it.length && pr[r] < pr[m]) m = r;
        if (m === i) break;
        [it[m], it[i]] = [it[i], it[m]];
        [pr[m], pr[i]] = [pr[i], pr[m]];
        i = m;
      }
    }
    return top;
  }
}
