import * as THREE from 'three';

const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, -1);

/**
 * Simple swept projectiles (spells, knives, the meteor). Each step casts a segment
 * against the world, enemy characters (inflated by the projectile radius) and drones.
 */
export class Projectiles {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  spawn(opts) {
    const p = {
      owner: opts.owner,
      team: opts.owner.team,
      pos: opts.pos.clone(),
      vel: opts.vel.clone(),
      radius: opts.radius ?? 0.2,
      gravity: opts.gravity ?? 0,
      life: opts.life ?? 3,
      damage: opts.damage ?? 0,
      headMult: opts.headMult ?? 1,
      weapon: opts.weapon || 'Projectile',
      slow: opts.slow || null,
      mesh: opts.mesh || null,
      spin: opts.spin || 0,
      orient: !!opts.orient,
      trail: opts.trail ?? null,
      trailCount: opts.trailCount ?? 1,
      impactColor: opts.impactColor ?? 0xffffff,
      onHit: opts.onHit || null,
    };
    if (p.mesh) {
      p.mesh.position.copy(p.pos);
      this.game.scene.add(p.mesh);
    }
    this.list.push(p);
    return p;
  }

  update(dt) {
    const g = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      p.vel.y -= p.gravity * dt;
      const step = p.vel.length() * dt;
      _d.copy(p.vel).normalize();
      const hit = step > 0 ? g.sweep(p.owner, p.pos, _d, step, p.radius) : null;
      if (hit) {
        this.impact(p, hit);
        this.remove(i);
        continue;
      }
      p.pos.addScaledVector(p.vel, dt);
      if (p.life <= 0) {
        if (p.onHit) p.onHit(p.pos.clone(), null);
        this.remove(i);
        continue;
      }
      if (p.mesh) {
        p.mesh.position.copy(p.pos);
        if (p.orient) p.mesh.quaternion.setFromUnitVectors(Z, _d);
        if (p.spin) {
          p.mesh.rotation.x += p.spin * dt;
          p.mesh.rotation.y += p.spin * dt * 0.7;
        }
      }
      if (p.trail !== null) {
        g.effects.burst(p.pos, { count: p.trailCount, color: p.trail, speed: 0.6, size: p.radius * 0.6, life: 0.35, gravity: 0 });
      }
    }
  }

  impact(p, hit) {
    const g = this.game;
    _p.copy(hit.point);
    if (p.onHit) {
      p.onHit(_p.clone(), hit);
      return;
    }
    if (hit.target) {
      const dmg = p.damage * (hit.head ? p.headMult : 1);
      g.damage(hit.target, dmg, p.owner, { weapon: p.weapon, headshot: !!hit.head, dir: _d.clone(), slow: p.slow });
    }
    g.effects.burst(_p, { count: 12, color: [p.impactColor, 0xffffff], speed: 5, size: 0.09, life: 0.4, normal: hit.normal || null });
    g.effects.flash(_p, { color: p.impactColor, size: 0.3, life: 0.08 });
  }

  remove(i) {
    const p = this.list[i];
    if (p.mesh) this.game.scene.remove(p.mesh);
    this.list.splice(i, 1);
  }

  clear() {
    for (let i = this.list.length - 1; i >= 0; i--) this.remove(i);
  }
}
