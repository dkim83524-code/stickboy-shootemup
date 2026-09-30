import * as THREE from 'three';
import { CLASSES, TEAM_NAMES } from '../classes/defs.js';
import { formatTime, angleDiff, yawTo } from '../core/utils.js';

const $ = (id) => document.getElementById(id);
const _p = new THREE.Vector3();

export function boardHTML(game) {
  const cols = [0, 1].map((team) => {
    const rows = game.characters
      .filter((c) => c.team === team)
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
      .map((c) => {
        const cls = [c === game.player ? 'me' : '', c.alive ? '' : 'dead'].join(' ');
        return `<tr class="${cls}"><td>${esc(c.name)}</td><td>${CLASSES[c.classId].name}</td><td class="num">${c.kills}</td><td class="num">${c.deaths}</td><td class="num">${Math.round(c.damageDealt)}</td></tr>`;
      })
      .join('');
    return `<div class="team t${team}"><h3><span>${TEAM_NAMES[team]}</span><span>${game.scores[team]}</span></h3>
      <table><tr><th>Name</th><th>Class</th><th class="num">K</th><th class="num">D</th><th class="num">DMG</th></tr>${rows}</table></div>`;
  });
  return `<div class="board">${cols.join('')}</div>`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {};
    for (const id of [
      'score-blue', 'score-red', 'timer', 'goal', 'killfeed', 'crosshair', 'hitmarker', 'lockmarker', 'dmgdir', 'note', 'notify',
      'hud-class', 'hud-name', 'hp-num', 'hp-fill', 'hp-ghost', 'slots', 'super', 'super-name', 'super-pct', 'super-fill',
      'extra', 'ability', 'ability-cd', 'ability-name', 'ammo', 'ammo-max', 'death', 'death-by', 'death-timer', 'scoreboard',
      'ov-damage', 'ov-cloak', 'ov-rage', 'ov-trigger', 'ov-wallhack', 'ov-drone', 'ov-scope', 'drone-time', 'drone-hp-fill',
      'tags', 'spinbar', 'spinbar-fill', 'ov-heal',
    ]) this.el[id] = $(id);
    this.cache = new Map();
    this.hitT = 0;
    this.dmgT = 0;
    this.arcs = [];
    this.tags = new Map();
  }

  set(id, prop, value) {
    const key = id + '|' + prop;
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    const el = this.el[id];
    if (prop === 'text') el.textContent = value;
    else if (prop === 'html') el.innerHTML = value;
    else if (prop === 'class') el.className = value;
    else if (prop === 'show') el.classList.toggle('hidden', !value);
    else el.style[prop] = value;
  }

  show(on) {
    this.root.classList.toggle('hidden', !on);
  }

  resetMatch(game) {
    this.el.killfeed.innerHTML = '';
    this.el.notify.innerHTML = '';
    this.el.dmgdir.innerHTML = '';
    this.arcs = [];
    this.cache.clear();
    for (const t of this.tags.values()) t.el.remove();
    this.tags.clear();
    this.el.goal.textContent = `FIRST TO ${game.scoreLimit || 30}`;
  }

  hitmarker(crit, kill) {
    this.hitT = kill ? 0.45 : 0.25;
    this.el.hitmarker.className = kill ? 'kill' : crit ? 'crit' : '';
  }

  damaged(srcPos, amount) {
    this.dmgT = Math.min(1, this.dmgT + 0.25 + amount / 150);
    if (!srcPos) return;
    const el = document.createElement('div');
    el.className = 'dmg-arc';
    this.el.dmgdir.appendChild(el);
    this.arcs.push({ el, x: srcPos.x, z: srcPos.z, t: 1.2 });
    if (this.arcs.length > 5) this.arcs.shift().el.remove();
  }

  healed(amount) {
    this.healT = Math.min(1, (this.healT || 0) + 0.2 + amount / 80);
  }

  notify(text, kind = '') {
    const box = this.el.notify;
    const el = document.createElement('div');
    el.className = `nt ${kind}`;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => el.remove(), kind === 'super' ? 1400 : 1900);
  }

  killfeed({ killer, victim, weapon, headshot, backstab }) {
    const el = document.createElement('div');
    const mine = (killer && killer.isPlayer) || victim.isPlayer;
    el.className = 'kf' + (mine ? ' me' : '');
    const tag = backstab ? '<span class="tag">BACKSTAB</span>' : headshot ? '<span class="tag">HEADSHOT</span>' : '';
    const k = killer ? `<span class="t${killer.team}">${esc(killer.name)}</span>` : '';
    el.innerHTML = `${tag}${k}<span class="w">${esc(weapon)}</span><span class="t${victim.team}">${esc(victim.name)}</span>`;
    const feed = this.el.killfeed;
    feed.appendChild(el);
    while (feed.children.length > 6) feed.firstChild.remove();
    setTimeout(() => el.remove(), 7000);
  }

  update(game, dt, { scoreboard = false } = {}) {
    const p = game.player;
    if (!p) return;
    const def = CLASSES[p.classId];
    const kit = p.kit;
    const info = kit.hud();

    this.set('score-blue', 'text', String(game.scores[0]));
    this.set('score-red', 'text', String(game.scores[1]));
    this.set('timer', 'text', formatTime(game.timeLeft));

    this.set('hud-class', 'text', def.name.toUpperCase());
    this.set('hud-name', 'text', p.name);
    const hp = Math.max(0, Math.ceil(p.hp));
    const hpPct = Math.max(0, p.hp / p.maxHp) * 100;
    this.set('hp-num', 'text', String(hp));
    this.set('hp-fill', 'width', hpPct.toFixed(1) + '%');
    this.set('hp-ghost', 'width', hpPct.toFixed(1) + '%');
    this.set('hp-fill', 'class', hpPct < 35 ? 'low' : '');

    // super / mana
    let superCls = '';
    if (def.usesMana) {
      const mana = info.mana;
      if (info.channel !== null) {
        this.set('super-name', 'text', 'CHANNELING METEOR…');
        this.set('super-fill', 'width', (info.channel * 100).toFixed(1) + '%');
        this.set('super-pct', 'text', '');
        superCls = 'active';
      } else {
        this.set('super-name', 'text', mana >= 99.9 ? 'METEOR READY' : 'MANA');
        this.set('super-fill', 'width', mana.toFixed(1) + '%');
        this.set('super-pct', 'text', `${Math.floor(mana)}`);
        superCls = 'mana' + (mana >= 99.9 ? ' ready' : '');
      }
    } else if (p.superActive) {
      this.set('super-name', 'text', def.superName.toUpperCase());
      this.set('super-pct', 'text', p.superTime.toFixed(1) + 's');
      this.set('super-fill', 'width', ((p.superTime / def.superDuration) * 100).toFixed(1) + '%');
      superCls = 'active';
    } else {
      const ready = p.superCharge >= 100;
      this.set('super-name', 'text', def.superName.toUpperCase() + (ready ? ' READY' : ''));
      this.set('super-pct', 'text', `${Math.floor(p.superCharge)}%`);
      this.set('super-fill', 'width', p.superCharge.toFixed(1) + '%');
      superCls = ready ? 'ready' : '';
    }
    this.set('super', 'class', 'panel ' + superCls);

    // slots
    const slots = info.spells || (info.buildMode || p.classId === 'engineer' ? info.builds : null);
    if (slots) {
      const html = slots
        .map((s) => {
          const sub = s.cd > 0.05 ? `${s.cd.toFixed(1)}s` : `${s.cost}${info.spells ? ' mana' : ' scrap'}`;
          return `<div class="slot${s.selected ? ' sel' : ''}${s.ok ? '' : ' no'}${s.built ? ' built' : ''}"><div class="n">${s.key} ${s.name}</div><div class="c">${sub}</div></div>`;
        })
        .join('');
      this.set('slots', 'html', html);
      this.set('slots', 'show', info.spells || info.buildMode ? true : false);
    } else this.set('slots', 'show', false);

    // ammo + ability + extra
    this.set('ammo', 'text', info.ammo ?? (def.usesMana ? `${Math.floor(info.mana)}` : '—'));
    this.set('ammo-max', 'text', info.ammo && info.ammo !== 'RELOADING' && info.ammo !== '∞' && info.ammoMax ? `/${info.ammoMax}` : '');
    if (info.ability) {
      const a = info.ability;
      this.set('ability-name', 'text', a.cost ? `${a.name} (${a.cost})` : a.name);
      this.set('ability-cd', 'height', a.cd > 0 ? ((a.cd / a.max) * 100).toFixed(0) + '%' : '0%');
      this.set('ability', 'class', 'ability' + (a.active ? ' active' : ''));
    }
    let extra = '';
    if (info.scrap !== undefined) extra = `SCRAP ${info.scrap}${info.buildMode ? ' · 1-3 pick · LMB place · RMB cancel' : ''}`;
    if (info.grenades !== undefined) extra = `RMB GRENADES ${'<span class="pip on nade"></span>'.repeat(info.grenades)}${'<span class="pip nade"></span>'.repeat(2 - info.grenades)}`;
    if (info.cloak !== undefined) {
      const cd = (t) => (t > 0 ? `${t.toFixed(1)}s` : '✓');
      extra = `LUNGE ${cd(info.lunge)} · F PEARL ${cd(info.pearl)} · ${info.cloaked ? 'CLOAKED' : 'CLOAK'} <span class="cloakbar"><i style="width:${(info.cloak * 100).toFixed(0)}%"></i></span>`;
    }
    this.set('extra', 'html', extra);

    // crosshair & overlays
    const first = game.cameraMode === 'first' && p.alive;
    const ch = kit.crosshair();
    this.set('crosshair', 'class', ch);
    this.set('crosshair', 'show', first);
    this.set('ov-scope', 'opacity', first && ch === 'scope' ? '1' : '0');
    this.set('ov-cloak', 'opacity', p.alive && p.cloaked ? '1' : '0');
    this.set('ov-rage', 'opacity', p.alive && p.superActive && p.classId === 'berserker' ? '1' : '0');
    this.set('ov-trigger', 'opacity', p.alive && p.superActive && p.classId === 'gunslinger' ? '1' : '0');
    this.set('ov-wallhack', 'opacity', p.alive && kit.wallhack() ? '1' : '0');
    const drone = info.drone && game.cameraMode === 'drone';
    this.set('ov-drone', 'opacity', drone ? '1' : '0');
    if (drone) {
      this.set('drone-time', 'text', info.drone.time.toFixed(1));
      this.set('drone-hp-fill', 'width', (info.drone.hp * 100).toFixed(0) + '%');
    }
    this.set('note', 'text', p.alive ? info.note || '' : '');
    this.set('spinbar', 'show', first && info.spin !== undefined && info.spin > 0 && info.spin < 1);
    if (info.spin !== undefined) this.set('spinbar-fill', 'width', (info.spin * 100).toFixed(0) + '%');

    // hitmarker & damage
    this.hitT = Math.max(0, this.hitT - dt);
    this.set('hitmarker', 'opacity', (this.hitT > 0 ? Math.min(1, this.hitT / 0.15) : 0).toFixed(2));
    this.dmgT = Math.max(0, this.dmgT - dt * 1.5);
    this.healT = Math.max(0, (this.healT || 0) - dt * 1.5);
    this.set('ov-heal', 'opacity', this.healT.toFixed(2));
    this.set('ov-damage', 'opacity', (this.dmgT + (p.alive && p.hp < p.maxHp * 0.3 ? 0.35 : 0)).toFixed(2));
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.t -= dt;
      if (a.t <= 0 || !p.alive) {
        a.el.remove();
        this.arcs.splice(i, 1);
        continue;
      }
      const rel = angleDiff(p.yaw, yawTo(a.x - p.pos.x, a.z - p.pos.z));
      a.el.style.transform = `rotate(${-rel}rad)`;
      a.el.style.opacity = Math.min(1, a.t).toFixed(2);
    }

    // lock-on marker (Hair Trigger)
    const lm = this.el.lockmarker;
    if (info.lock && first) {
      const s = this.project(game, info.lock.headCenter(_p));
      if (s) {
        lm.style.display = 'block';
        lm.style.left = s.x + 'px';
        lm.style.top = s.y + 'px';
      } else lm.style.display = 'none';
    } else lm.style.display = 'none';

    // death screen
    this.set('death', 'show', !p.alive && game.state === 'playing');
    if (!p.alive) {
      const k = p.killedBy;
      this.set('death-by', 'text', k && k !== p ? `by ${k.name} (${CLASSES[k.classId].name})` : '');
      const next = p.pendingClass ? ` as ${CLASSES[p.pendingClass].name}` : '';
      this.set('death-timer', 'text', `Respawning${next} in ${Math.max(0, p.respawnAt - game.time).toFixed(1)}s`);
    }

    this.set('scoreboard', 'show', scoreboard);
    if (scoreboard) this.set('scoreboard', 'html', boardHTML(game));

    this.updateTags(game);
  }

  project(game, v) {
    _p.copy(v).project(game.camera);
    if (_p.z > 1 || _p.z < -1) return null;
    const w = window.innerWidth;
    const h = window.innerHeight;
    return { x: ((_p.x + 1) / 2) * w, y: ((1 - _p.y) / 2) * h };
  }

  updateTags(game) {
    const p = game.player;
    const seen = new Set();
    for (const c of game.characters) {
      if (c === p || !c.alive) continue;
      const ally = c.team === p.team;
      const recentlyHit = c.lastHitByPlayer && game.time - c.lastHitByPlayer < 3;
      if (!ally && (!recentlyHit || c.cloaked)) continue;
      const d = c.pos.distanceTo(game.camera.position);
      if (d > 70) continue;
      if (!ally && !game.world.lineOfSight(game.camera.position, c.headCenter(_p))) continue;
      const s = this.project(game, _p.set(c.pos.x, c.pos.y + 2.25, c.pos.z));
      if (!s) continue;
      seen.add(c.id);
      let t = this.tags.get(c.id);
      if (!t) {
        const el = document.createElement('div');
        el.innerHTML = `<div class="nm"></div><div class="hb"><i></i></div>`;
        this.el.tags.appendChild(el);
        t = { el, nm: el.firstChild, bar: el.querySelector('i'), last: '' };
        this.tags.set(c.id, t);
      }
      t.el.className = 'nametag ' + (ally ? 'ally' : 'enemy');
      const label = ally ? c.name : '';
      if (t.last !== label) {
        t.nm.textContent = label;
        t.last = label;
      }
      t.bar.style.width = Math.max(0, (c.hp / c.maxHp) * 100).toFixed(0) + '%';
      t.el.style.left = s.x.toFixed(0) + 'px';
      t.el.style.top = s.y.toFixed(0) + 'px';
      t.el.style.opacity = d > 45 ? '0.6' : '1';
    }
    // turret health bars (own team always, enemy turrets when in sight)
    for (const d of game.deployables) {
      if (!d.alive || d.kind !== 'turret') continue;
      const ally = d.team === p.team;
      const dist = d.pos.distanceTo(game.camera.position);
      if (dist > 55) continue;
      const top = _p.set(d.pos.x, d.pos.y + 1.75, d.pos.z);
      if (!ally && !game.world.lineOfSight(game.camera.position, top, false)) continue;
      const s = this.project(game, top);
      if (!s) continue;
      const key = 'd' + d.id;
      seen.add(key);
      let t = this.tags.get(key);
      if (!t) {
        const el = document.createElement('div');
        el.innerHTML = `<div class="nm"></div><div class="hb"><i></i></div><div class="ub"><i></i></div>`;
        this.el.tags.appendChild(el);
        t = { el, nm: el.firstChild, bar: el.querySelector('.hb i'), ub: el.querySelector('.ub'), ubar: el.querySelector('.ub i'), last: '' };
        this.tags.set(key, t);
      }
      t.el.className = 'nametag turret ' + (ally ? 'ally' : 'enemy');
      const label = `TURRET LV${d.level}`;
      if (t.last !== label) {
        t.nm.textContent = label;
        t.last = label;
      }
      t.bar.style.width = Math.max(0, (d.hp / d.maxHp) * 100).toFixed(0) + '%';
      const showUpgrade = ally && d.owner === p && d.level < 3;
      t.ub.style.display = showUpgrade ? '' : 'none';
      if (showUpgrade) t.ubar.style.width = d.upgrade.toFixed(0) + '%';
      t.el.style.left = s.x.toFixed(0) + 'px';
      t.el.style.top = s.y.toFixed(0) + 'px';
      t.el.style.opacity = dist > 40 ? '0.6' : '1';
    }
    for (const [id, t] of this.tags) {
      if (!seen.has(id)) {
        t.el.remove();
        this.tags.delete(id);
      }
    }
  }
}
