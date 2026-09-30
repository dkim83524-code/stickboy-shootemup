import * as THREE from 'three';
import { Game } from './game/game.js';
import { Hud, boardHTML } from './ui/hud.js';
import { ClassPicker } from './ui/menu.js';
import { Input } from './core/input.js';
import { sfx } from './core/audio.js';
import { CLASSES, CLASS_ORDER, TEAM_COLORS, TEAM_NAMES } from './classes/defs.js';
import { KITS } from './classes/index.js';
import { Stickman } from './entities/stickman.js';
import { toonMat, addOutline } from './core/toon.js';
import { clamp } from './core/utils.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const AUTOPLAY = params.has('autoplay');

// ---------------------------------------------------------------- renderer + scenes
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.autoClear = false;

const SKY = 0x9fc4e8;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 80, 230);

function addLights(target, shadows) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f9c, 1.3);
  target.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
  sun.position.set(45, 80, 30);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -105;
    s.right = 105;
    s.top = 85;
    s.bottom = -85;
    s.near = 10;
    s.far = 260;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
  }
  target.add(sun);
  return sun;
}
addLights(scene, true);

const camera = new THREE.PerspectiveCamera(85, window.innerWidth / window.innerHeight, 0.05, 500);
camera.rotation.order = 'YXZ';

const vmScene = new THREE.Scene();
addLights(vmScene, false);
const vmCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 10);

// class preview (rendered into the menu's preview box with a scissor rect)
const previewScene = new THREE.Scene();
previewScene.background = new THREE.Color(0xe8e0cc);
addLights(previewScene, false);
const previewCam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
previewCam.position.set(0, 1.25, 4.3);
previewCam.lookAt(0, 0.95, 0);
const podium = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.25, 32), toonMat(0xfbf7ee));
podium.position.y = -0.125;
addOutline(podium, 0.03);
previewScene.add(podium);
let previewMan = null;
let previewClass = null;
const POSES = { berserker: 'minigun', mage: 'wand', assassin: 'melee', sniper: 'gun', engineer: 'gun', gunslinger: 'dual' };

function setPreview(id) {
  if (previewClass === id) return;
  previewClass = id;
  if (previewMan) {
    previewScene.remove(previewMan.root);
    previewMan.dispose();
  }
  previewMan = new Stickman({ color: TEAM_COLORS[0], hat: CLASSES[id].hat });
  const fakeChar = { game: { isLocal: () => false, time: 0 }, team: 0 };
  const kit = new KITS[id](fakeChar);
  kit.attachWorldWeapon(previewMan);
  previewMan.pose = POSES[id];
  previewScene.add(previewMan.root);
}

// ---------------------------------------------------------------- game + ui
const hud = new Hud();
const game = new Game({ scene, camera, vmScene, vmCamera, hud });
const input = new Input(canvas);
window.__game = game;
window.__renderer = renderer;
window.__input = input;

let mode = 'menu'; // menu | playing | paused | classpick | ended
let endShown = false;
let difficulty = params.get('difficulty') || 'normal';

const menuPicker = new ClassPicker($('class-grid'), $('class-detail'), (id) => setPreview(id));
const pickPicker = new ClassPicker($('class-grid-2'), $('class-detail-2'), (id) => setPreview(id));
setPreview(menuPicker.selected);

for (const b of $('difficulty').querySelectorAll('button')) {
  b.classList.toggle('on', b.dataset.v === difficulty);
  b.addEventListener('click', () => {
    difficulty = b.dataset.v;
    for (const o of $('difficulty').querySelectorAll('button')) o.classList.toggle('on', o === b);
  });
}

function showScreen(id) {
  for (const s of ['menu', 'classpick', 'pause', 'endscreen']) $(s).classList.toggle('hidden', s !== id);
}

function startGame(classId) {
  endShown = false;
  sfx.init();
  game.startMatch({ playerClass: classId, difficulty, autoplay: AUTOPLAY });
  mode = 'playing';
  showScreen(null);
  hud.show(true);
  if (!AUTOPLAY) input.requestLock();
}

$('play-btn').addEventListener('click', () => startGame(menuPicker.selected));

function pause() {
  if (mode !== 'playing') return;
  mode = 'paused';
  showScreen('pause');
  input.exitLock();
}

function resume() {
  mode = 'playing';
  showScreen(null);
  if (!AUTOPLAY) input.requestLock();
}

$('resume-btn').addEventListener('click', resume);
$('change-class-btn').addEventListener('click', () => openClassPick());
$('quit-btn').addEventListener('click', toMenu);
$('menu-btn').addEventListener('click', toMenu);
$('again-btn').addEventListener('click', () => startGame(game.player ? game.player.pendingClass || game.player.classId : menuPicker.selected));

function toMenu() {
  game.clearMatch();
  game.state = 'menu';
  mode = 'menu';
  hud.show(false);
  showScreen('menu');
  setPreview(menuPicker.selected);
  input.exitLock();
}

function openClassPick() {
  mode = 'classpick';
  const p = game.player;
  pickPicker.select(p.pendingClass || p.classId, true);
  setPreview(pickPicker.selected);
  showScreen('classpick');
  input.exitLock();
}

$('classpick-ok').addEventListener('click', () => {
  const p = game.player;
  const id = pickPicker.selected;
  if (id !== p.classId) {
    p.pendingClass = id;
    // In the spawn room you swap immediately, like a resupply locker.
    const inSpawn = p.alive && (p.team === 0 ? p.pos.x < -64 : p.pos.x > 64);
    if (inSpawn) game.spawnCharacter(p);
    else if (p.alive) hud.notify(`${CLASSES[id].name.toUpperCase()} ON RESPAWN`, 'good');
  } else p.pendingClass = null;
  resume();
});
$('classpick-cancel').addEventListener('click', resume);

// settings
function bindSlider(id, fmt, apply) {
  const el = $(id);
  const out = $(id + '-v');
  const update = () => {
    const v = parseFloat(el.value);
    out.textContent = fmt(v);
    apply(v);
  };
  el.addEventListener('input', update);
  update();
}
bindSlider('sens', (v) => v.toFixed(2), (v) => (game.settings.sensitivity = v));
bindSlider('fov', (v) => String(v), (v) => (game.settings.fov = v));
bindSlider('vol', (v) => `${Math.round(v * 100)}%`, (v) => sfx.setVolume(v));

input.onLockChange = (locked) => {
  if (!locked && mode === 'playing' && !AUTOPLAY) pause();
};
input.onKey = (code) => {
  if (code === 'KeyC' && mode === 'playing' && game.player && !game.player.alive) openClassPick();
};
$('clicktoplay').addEventListener('click', () => input.requestLock());
canvas.addEventListener('click', () => {
  if (mode === 'playing' && !input.locked && !AUTOPLAY) input.requestLock();
});

// ---------------------------------------------------------------- player input
function applyPlayerInput() {
  const p = game.player;
  if (!p || p.brain) return;
  const inp = p.input;
  const { dx, dy } = input.takeMouse();
  if (!input.locked) {
    inp.mx = inp.mz = 0;
    inp.fire = inp.alt = inp.jump = inp.ability = false;
    inp.firePressed = inp.altPressed = inp.jumpPressed = inp.abilityPressed = inp.superPressed = inp.reloadPressed = false;
    return;
  }
  if (p.alive) {
    let sens = 0.0022 * game.settings.sensitivity;
    sens *= camera.fov / game.settings.fov;
    p.yaw -= dx * sens;
    p.pitch = clamp(p.pitch - dy * sens, -1.54, 1.54);
    game.addSway(dx, dy);
  }
  const k = (c) => input.down(c);
  inp.mz = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
  inp.mx = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
  inp.jump = k('Space');
  inp.jumpPressed = input.pressed('Space');
  inp.fire = input.buttons[0];
  inp.firePressed = input.pressedButtons[0];
  inp.alt = input.buttons[2];
  inp.altPressed = input.pressedButtons[2];
  inp.ability = k('KeyE');
  inp.abilityPressed = input.pressed('KeyE');
  inp.itemPressed = input.pressed('KeyF');
  inp.superPressed = input.pressed('KeyQ');
  inp.reloadPressed = input.pressed('KeyR');
  inp.descend = k('ShiftLeft') || k('ShiftRight') || k('ControlLeft');
  inp.slot = 0;
  for (let i = 1; i <= 4; i++) if (input.pressed('Digit' + i)) inp.slot = i;
  inp.wheel = input.wheel;
}

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
timer.connect(document);

function renderPreview(boxId) {
  const box = $(boxId);
  const r = box.getBoundingClientRect();
  if (r.width < 2 || r.height < 2 || !previewMan) return;
  const h = window.innerHeight;
  renderer.setScissorTest(true);
  renderer.setScissor(r.left, h - r.bottom, r.width, r.height);
  renderer.setViewport(r.left, h - r.bottom, r.width, r.height);
  previewCam.aspect = r.width / r.height;
  previewCam.updateProjectionMatrix();
  renderer.render(previewScene, previewCam);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
}

function frame(now) {
  requestAnimationFrame(frame);
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.05);

  // Without pointer lock the player can't aim, so hold the match until they click back in.
  const waitingForLock = mode === 'playing' && !input.locked && !AUTOPLAY;
  $('clicktoplay').classList.toggle('hidden', !waitingForLock);
  if (mode === 'playing' && !waitingForLock) {
    applyPlayerInput();
    game.update(dt);
    if (game.state === 'ended' && !endShown) showEnd();
  } else if (mode === 'menu') {
    game.update(dt);
  } else {
    input.takeMouse();
  }
  game.updateCamera(dt);

  renderer.clear();
  renderer.render(scene, camera);
  if (game.cameraMode === 'first' && game.player && game.player.alive) {
    renderer.clearDepth();
    renderer.render(vmScene, vmCamera);
  }
  if (mode === 'menu' || mode === 'classpick') {
    if (previewMan) {
      previewMan.root.rotation.y = Math.PI + 0.5 + Math.sin(performance.now() / 1600) * 0.7;
      previewMan.animate(dt, { speed: 0, grounded: true, pitch: 0, pose: previewMan.pose });
    }
    renderPreview(mode === 'menu' ? 'preview-box' : 'preview-box-2');
  }

  if (mode !== 'menu' && game.player) hud.update(game, dt, { scoreboard: mode === 'playing' && input.down('Tab') });
  input.endFrame();
}

function showEnd() {
  endShown = true;
  mode = 'ended';
  input.exitLock();
  const w = game.winner;
  const title = w === -1 ? 'DRAW' : w === game.player.team ? 'VICTORY!' : 'DEFEAT';
  $('end-title').textContent = title;
  $('end-title').style.color = w === -1 ? '' : w === 0 ? 'var(--blue)' : 'var(--red)';
  $('end-score').innerHTML = `<span style="color:var(--blue)">${TEAM_NAMES[0]} ${game.scores[0]}</span> — <span style="color:var(--red)">${game.scores[1]} ${TEAM_NAMES[1]}</span>`;
  $('end-board').innerHTML = boardHTML(game);
  showScreen('endscreen');
}

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  vmCamera.aspect = w / h;
  vmCamera.updateProjectionMatrix();
});

showScreen('menu');
frame();

if (AUTOPLAY) {
  const cls = params.get('class');
  startGame(CLASS_ORDER.includes(cls) ? cls : menuPicker.selected);
}
