# Stickboy Shoot-'em-Up: Design Spec (v1)

A first-person, cel-shaded stickman hero shooter that runs in the browser (Three.js).
Single-player: 5v5 team deathmatch against computer-controlled bots.

## Match

| Rule | Value |
| --- | --- |
| Mode | Team deathmatch, Blue (you + 4 bots) vs Red (5 bots) |
| Win | First team to 40 kills, or higher score when the 8:00 timer runs out |
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
- One city map, point-symmetric so both teams get the same layout, split into districts:
  - spawn courtyard behind a team-colored gate
  - diner
  - construction yard: climbable stacked containers, a scaffold tower with stairs, a crane
  - L-shaped hotel with a skybridge over the main avenue
  - setback tower and apartments
  - warehouse with a walk-through tunnel
  - park: trees, pond, gazebo, hedges
  - market with awning stalls
  - arch gates over the center street, fountains, and the statue plaza
- Bright flat colors.
- Deaths make the stickman pop apart into flying limbs.

## Controls

| Key | Action |
| --- | --- |
| WASD / mouse | Move / look |
| Space | Jump (Assassin: double jump) |
| Left click | Primary fire |
| Right click | Alt fire (scope, spin-up, knife, wrench, slam) |
| E | Class ability |
| F | Assassin: shadow pearl |
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

### Berserker (350 HP)
- Tanky enough to survive one sniper headshot: it takes 2 headshots or 3 body shots.
- **Minigun:** spins up for 0.6 s before firing (right click spins without firing). Slows you while spinning.
- **E, Charge:** a 1.6 s bull rush you steer with the mouse. It plows through enemies (35 damage, knocked aside,
  short stun) and wrecks enemy builds. You take 50% damage while charging, and it ends early if you hit a wall.
  9 s cooldown.
- **Super, Rage (12 s):** minigun is put away, fists come out. +30% speed, takes 50% damage,
  higher jumps, heavy knockback punches. Right click in mid-air slams down: area damage, knock-up and a short stun.

### Mage (150 HP)
- **No super bar; a mana bar instead** (regenerates over time).
- **Wand spell slots:** 1 Arcane Bolt (cheap projectile), 2 Healing Circle, 3 Poison Pool, 4 Meteor (the ultimate).
- **Healing Circle:** heals the Mage and every ally within 7 m for 45.
- **Poison Pool:** area control. Place a 4.5 m toxic circle where you aim (up to 35 m away). It lasts 6 s and deals
  22 damage per second to enemies inside. A green ring previews the spot while the spell is selected.
- **Meteor:** needs full mana and a 3 s channel. Cancelled if the Mage is stunned or killed, and the mana is lost.
  Q is a shortcut for it.
- **E, Blink:** short teleport in the aim direction.

### Assassin (125 HP)
- **Katana only**, no ranged attack. Built to hunt snipers.
- **Cloak:** stand still for 1.5 s to turn invisible (looking around is fine). Moving or attacking breaks it.
  Enemies close by see a faint shimmer.
- **E, Stalk:** crouch and creep at half speed. After 0.5 s you're cloaked, and moving doesn't break it.
  Attacking or jumping stands you up. The crouch also shrinks your hitbox.
- **Right click, Lunge:** a dash-slash that hits the first enemy in the path (1.5 s cooldown). It follows the
  backstab rules, so a cloaked lunge into someone's back kills.
- **F, Shadow Pearl:** throw a pearl in an arc and teleport to wherever it lands (5 s cooldown). Throwing it and
  teleporting never break the cloak. Pearl onto a rooftop to reach a sniper nest.
- **Backstab:** while cloaked, always kills. Uncloaked, the first backstab on a target deals 75% of that
  target's max health (any class); further hits on that target are normal slashes.
- **Double jump.**
- **Super, Shadow Strike (10 s):** teleport behind the nearest enemy (within 60 m) and backstab them: a kill.
  Your invisibility is gone after that first strike. Every kill during the super re-arms the teleport, which fires
  at the next nearest enemy, and those strikes take 75% of max health. Finish them with slashes to keep chaining
  until the timer runs out.

### Sniper (150 HP)
- **Sniper rifle:** 150 body / 300 head. Kills anyone except the Berserker in 1 headshot or 2 body shots. Right click scopes;
  no-scoping is allowed but inaccurate.
- **E, Grapple (sidearm):** hooks buildings and terrain (never players), straight pull with momentum kept on release.
  Hooking the top of a ledge pulls you up onto it.
- **Super, Wallhack (12 s):** enemy outlines are visible through walls.

### Engineer (175 HP)
- **Scrap shotgun** plus a **wrench** on right click.
- **Scrap:** earned over time, from kills, and by picking up the scrap that drops wherever anyone dies or a build breaks.
  It's spent on builds (one of each at a time): Turret, Cover Wall, Jump Pad. E toggles build mode, 1–3 picks,
  left click places.
- **Wrench on your builds:** repairs them when damaged. On a full-health turret, each hit spends 25 scrap for a third of
  a level:
  - LV2: more health, range and damage, faster fire, twin barrels.
  - LV3: rocket pods on top of that.

  Turrets show a health bar and their level; your own also show upgrade progress.
- **Jump Pad:** launches allies high and flings them forward in the direction they face.
- **Super, Drone Strike (12 s):** launch a drone and fly it in first person (your body stays behind, exposed).
  Shoot with its gun, then fly it into enemies to detonate it. Right click boosts it as a kamikaze bomb.
  It also explodes when the timer ends.

### Gunslinger (175 HP)
- **Dual revolvers:** alternate fire at a deliberate pace (0.32 s between shots). Bullets ricochet once off hard surfaces.
- **Right click, Grenade:** hold to cook it while you aim. The longer you hold (up to 1.1 s), the farther the throw and
  the bigger the blast. A dotted arc and blast ring preview the landing. Release to throw.
  2 charges, 6 s recharge each.
- **E, Dodge Roll:** brief invulnerability and a partial reload. Dodging a hit during the roll fully reloads.
- **Super, Hair Trigger (10 s):** every shot locks onto the enemy nearest your crosshair, always hits and
  crits for double damage, with no fire-rate cap (as fast as you can click) and no ammo use.

## Audio

All sound effects are synthesized in code with WebAudio (no asset files, no licensing). No music in v1.

## Out of scope for v1

Online multiplayer, progression/unlocks, controller support, multiple maps.
