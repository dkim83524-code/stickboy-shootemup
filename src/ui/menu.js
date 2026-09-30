import { CLASSES, CLASS_ORDER } from '../classes/defs.js';

/** A class picker: grid of cards + detail panel. */
export class ClassPicker {
  constructor(gridEl, detailEl, onChange) {
    this.grid = gridEl;
    this.detail = detailEl;
    this.onChange = onChange;
    this.selected = CLASS_ORDER[0];
    this.cards = new Map();
    for (const id of CLASS_ORDER) {
      const d = CLASSES[id];
      const b = document.createElement('button');
      b.className = 'class-card';
      b.style.setProperty('--accent', d.accent);
      b.innerHTML = `<div class="rl">${d.role}</div><div class="nm">${d.name}</div>
        <div class="st"><span>♥ ${d.hp}</span><span>${d.weapon}</span></div>`;
      b.addEventListener('click', () => this.select(id));
      this.grid.appendChild(b);
      this.cards.set(id, b);
    }
    this.select(this.selected, true);
  }

  select(id, silent = false) {
    this.selected = id;
    for (const [k, el] of this.cards) el.classList.toggle('sel', k === id);
    const d = CLASSES[id];
    this.detail.innerHTML = `<h3 style="color:${d.accent}">${d.name}</h3>
      <div class="blurb">${d.blurb}</div>
      <div class="stats">
        <b>Health</b><span>${d.hp}</span>
        <b>Speed</b><span>${d.speed.toFixed(1)}</span>
        <b>Weapon</b><span>${d.weapon}</span>
        <b>Ability</b><span>${d.ability}</span>
        <b>Super</b><span>${d.superName}${d.superDuration ? ` (${d.superDuration}s)` : ''}</span>
      </div>
      <ul>${d.details.map((x) => `<li>${x}</li>`).join('')}</ul>`;
    if (!silent && this.onChange) this.onChange(id);
  }
}
