# Stickboy Shoot-'em-Up

A first-person, cel-shaded stickman hero shooter that runs in the browser (Three.js).
5v5 team deathmatch against bots on a multi-district city map, with six classes, each with its own weapons, ability and super.

See [DESIGN.md](DESIGN.md) for the full design spec.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ (relative paths, host anywhere)
```

Click **PLAY** to lock the mouse. Press **Esc** to pause.

## Controls

| Key | Action |
| --- | --- |
| WASD / mouse | Move / look |
| Space | Jump (Assassin: double jump; Drone: fly up) |
| Left click | Primary fire |
| Right click | Alt fire (scope, spin-up, lunge, grenade, wrench, slam, drone boost) |
| E | Class ability |
| F | Assassin: shadow pearl |
| Q | Super |
| R | Reload |
| 1–4 / scroll | Mage spell select, Engineer build select |
| Shift | Drone descend |
| Tab | Scoreboard |
| C (while dead) | Change class |
| Esc | Pause (settings, class change) |

## Classes

| Class | HP | Weapon | E ability | Super |
| --- | --- | --- | --- | --- |
| Berserker | 350 | Minigun (spin-up) | Charge: 1.6 s steerable bull rush, half damage taken | **Rage:** fists only, faster, half damage taken, big jumps, mid-air ground slam. Charges from damage dealt *and* taken |
| Mage | 150 | Wand: Arcane Bolt / Healing Circle (self + allies) / Poison Pool (placed damage-over-time area) / Meteor | Blink | No super bar. **Meteor** is spell 4: full mana plus a 3 s channel, cancelled by stuns |
| Assassin | 125 | Katana + RMB dash-slash Lunge + F shadow pearl (teleport, keeps cloak) | Stalk: crouch-walk while cloaked (+ double jump) | **Shadow Strike:** teleport behind the nearest enemy and kill; each kill chains another teleport (75% max-HP strikes). Cloaked backstabs always kill; uncloaked ones do 75% max HP |
| Sniper | 150 | Sniper rifle (150 body / 300 head; Berserker takes 2 head / 3 body) | Grapple hook (mantles onto roofs) | **Wallhack:** enemy outlines through walls |
| Engineer | 175 | Scrap shotgun + wrench (repairs, levels turrets to LV3 with rockets) | Build: turret, cover wall, jump pad | **Drone Strike:** fly a drone in first person, shoot, then ram enemies to detonate |
| Gunslinger | 175 | Dual revolvers (ricochet) + hold-to-cook grenades | Dodge roll (dodging a hit = full reload) | **Hair Trigger:** auto-lock, always-hit, double-damage crits, no fire-rate cap |

## How it's built

- **Cel shading + ink outlines:** `MeshToonMaterial` with a 3-step ramp. Outlines use the
  inverted-hull ("shell") technique: a back-face copy of each mesh pushed out along its normals
  (`src/core/toon.js`). Boxes get an enlarged back-face box instead, because split normals would tear the hull.
- **World:** every solid is an axis-aligned box, which keeps collision and raycasts exact and cheap.
  Static geometry is merged into three meshes, and bots walk a nav grid with A* (`src/world/`).
- **Bots and the player share one code path:** every character has an `input` struct. The keyboard/mouse
  controller fills it for you and `BotBrain` fills it for bots (`src/ai/bot.js`), so both use the same
  class kits (`src/classes/*.js`).
- **Audio:** all sound effects are synthesized with WebAudio at startup (`src/core/audio.js`), so there are no asset files.

```
src/
  main.js            renderer, scenes, input mapping, menus, game loop
  game/game.js       match flow, hitscan, damage, explosions, camera
  entities/          character physics, stickman rig, projectiles, effects, builds, drone
  classes/           class definitions + one kit per class
  ai/bot.js          bot perception, pathing, per-class tactics
  world/             map, colliders, nav grid
  ui/                HUD and class picker
```

## Debugging

`?autoplay&class=sniper&difficulty=hard` starts a match immediately, with your character driven by the
bot AI. It's handy for watching a match or smoke-testing changes. `window.__game` exposes the game
instance in the console.
