# Stickboy Shoot-'em-Up: Design Spec (v1)

A first-person, cel-shaded stickman hero shooter that runs in the browser (Three.js).
Single-player: 4v4 team deathmatch against computer-controlled bots.

## Match

| Rule | Value |
| --- | --- |
| Mode | Team deathmatch, Blue (you + 3 bots) vs Red (4 bots) |
| Win | First team to 30 kills, or higher score when the 8:00 timer runs out |
| Respawn | 4 s, at your team's spawn, with 2 s of spawn protection |
| Class change | Any time from the death screen (C) or pause menu; applies on next spawn (instantly if you're standing in your spawn area) |
| Health | Varies by class; regenerates after 5 s without taking damage |
| Headshots | 2× damage on everything with a head hitbox |
| Friendly fire | Off |
| Bot difficulty | Easy / Normal / Hard (reaction time, aim error, turn speed) |

## Look

- Cel shading (3-tone toon ramp) with black outlines drawn by the inverted-hull ("shell") technique.
- Stickmen have thick rounded limbs and a ball head, colored by team. Each class wears a head item:
  Berserker horned helmet, Mage wizard hat, Assassin headband with tails, Sniper beanie,
  Engineer hard hat, Gunslinger baseball cap.
- You see your own stick arms and weapon in first person.
- One city map: rooftops, alleys, a central plaza, stairs up to some roofs. Bright flat colors.
- Deaths make the stickman pop apart into flying limbs.

## Controls

| Key | Action |
| --- | --- |
| WASD / mouse | Move / look |
| Space | Jump (Assassin: double jump) |
| Left click | Primary fire |
| Right click | Alt fire (scope, spin-up, knife, wrench, slam) |
| E | Class ability |
| Q | Super |
| R | Reload |
| 1–4 / scroll | Mage spell select, Engineer build select |
| Shift | Drone descend (Engineer super) |
| Tab | Scoreboard |
| Esc | Pause |

## Supers (general)

Supers charge from damage dealt, a slow passive trickle, and a bonus per kill. The Berserker also
charges from damage taken. Supers last a fixed 10–15 s. The Mage has no super bar (see below).

## Classes

### Berserker (300 HP)
- **Minigun:** spins up for 0.6 s before firing (right click spins without firing). Slows you while spinning.
- **E, Shoulder Charge:** short dash that knocks back and damages the first enemy hit.
- **Super, Rage (12 s):** minigun is put away, fists come out. +30% speed, takes 50% damage,
  higher jumps, heavy knockback punches. Right click in mid-air slams down: area damage, knock-up and a short stun.

### Mage (150 HP)
- **No super bar; a mana bar instead** (regenerates over time).
- **Wand spell slots:** 1 Arcane Bolt (cheap), 2 Frost Shard (slows), 3 Chain Lightning (jumps between enemies),
  4 Meteor (the ultimate).
- **Meteor:** needs full mana and a 3 s channel. Cancelled if the Mage is stunned or killed, and the mana is lost.
  Q is a shortcut for it.
- **E, Blink:** short teleport in the aim direction.

### Assassin (125 HP)
- **Katana only**, no ranged attack.
- **Cloak:** stand still for 1.5 s to turn invisible (looking around is fine). Moving or attacking breaks it.
  Enemies close by see a faint shimmer.
- **Backstab:** while cloaked, always kills. Uncloaked, the first backstab on a target deals 75% of that
  target's max health (any class); further hits on that target are normal slashes.
- **Double jump** and **E, Dash**.
- **Super, Shadow Walk (12 s):** stays invisible while moving and attacking, so cloaked backstabs are on the move.

### Sniper (150 HP)
- **Sniper rifle:** 150 body / 300 head. Kills anyone in 1 headshot or 2 body shots. Right click scopes;
  no-scoping is allowed but inaccurate.
- **E, Grapple (sidearm):** hooks buildings and terrain (never players), straight pull with momentum kept on release.
  Hooking the top of a ledge pulls you up onto it.
- **Super, Wallhack (12 s):** enemy outlines are visible through walls.

### Engineer (175 HP)
- **Scrap shotgun** plus a **wrench** on right click (hits enemies, repairs your builds).
- **Scrap:** earned over time and from kills, spent on builds (one of each at a time):
  Turret, Cover Wall, Jump Pad. E toggles build mode, 1–3 picks, left click places.
- **Super, Drone Strike (12 s):** launch a drone and fly it in first person (your body stays behind, exposed).
  Shoot with its gun, then fly it into enemies to detonate it. Right click boosts it as a kamikaze bomb.
  It also explodes when the timer ends.

### Gunslinger (175 HP)
- **Dual revolvers:** alternate fire. Bullets ricochet once off hard surfaces.
- **Right click, Throwing Knife:** 3 charges, recharge over time.
- **E, Dodge Roll:** brief invulnerability and a partial reload. Dodging a hit during the roll fully reloads.
- **Super, Hair Trigger (10 s):** every shot locks onto the enemy nearest your crosshair, always hits and
  crits for double damage, with no fire-rate cap (as fast as you can click) and no ammo use.

## Audio

All sound effects are synthesized in code with WebAudio (no asset files, no licensing). No music in v1.

## Out of scope for v1

Online multiplayer, progression/unlocks, controller support, multiple maps.
