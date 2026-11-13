# Riftline (v2)

A browser first-person hero shooter. Play against bots, or duel a friend online, peer to peer.
It has no build step or server, so it runs directly on GitHub Pages.

## Play

- **Practice:** 1 to 3 bots (Easy, Normal or Hard). First to 10 eliminations wins.
- **Online duel:** one player clicks **Host a room** and sends the link or the 5-letter code. The other player opens the link, or types the code and clicks **Join**.

### Hero: Vesper (Skirmisher, 150 HP)

| Key | Ability | What it does |
| --- | --- | --- |
| LMB | Twin Pistols | 40 rounds, very fast fire. Damage falls off from 11 m to 30 m. Headshots deal double damage. |
| Shift / RMB | Skip | Teleport 7.5 m in the direction you're moving. 3 charges, each recharges in 3 s. |
| E | Rewind | Travel back along your path from 3 s ago. You're untouchable while rewinding, and you come back with that health and full ammo. 12 s cooldown. |
| Q | Tick Charge (ultimate) | Throw a sticky charge that detonates 1 s after it lands: 350 damage at the centre. Charges by dealing damage. |

Other keys: WASD to move, Space to jump, R to reload, Esc for the menu.

## Host on GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings → Pages**. Under *Build and deployment*, set **Deploy from a branch**, pick the branch and `/ (root)`, then save.
3. Open `https://<user>.github.io/<repo>/` and share it.

Online play uses WebRTC through [PeerJS](https://peerjs.com/). PeerJS's free public broker only introduces the two browsers to each other. Gameplay traffic then goes directly between the players. Some strict corporate or university networks block peer-to-peer connections. If joining fails there, try another network.

## Run locally

ES modules need a web server, so opening the file directly won't work:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. To test online play on one machine without the broker, open two tabs with `?local` on the URL (`http://localhost:8000/?local`). Host in one tab and join from the other.

## Project layout

```
index.html          menu, HUD markup, import map
css/style.css       menu and HUD styling
src/main.js         game loop, match flow, combat, network sync, HUD updates
src/fighter.js      hero stats and kit (movement, Skip, Rewind, pistols)
src/viewmodel.js    first-person twin-pistol view (bob, sway, recoil, reload spin)
src/world.js        the "Solace Harbor" map, lighting, sky, colliders, bot nav graph
src/models.js       procedural materials, textures, hero and pistol models
src/physics.js      box collision, step-up, raycasts
src/bots.js         practice bot AI
src/net.js          PeerJS / BroadcastChannel transport
src/fx.js           tracers, sparks, blink trails, explosions
src/audio.js        synthesised sound effects (WebAudio)
vendor/             three.js r160, PeerJS 1.5.4 (MIT)
legacy/             the original v1 single-file build
```

### How online sync works

Each client simulates its own hero and sends a snapshot 20 times a second. Remote players are drawn 100 ms in the past and interpolated between snapshots. Hit detection favours the shooter: the shooter checks hits against where it sees the opponent and sends `hit` messages. The victim's client applies the damage, so a Rewind in progress still protects them, and the victim reports its own death. It's a casual peer-to-peer model with no cheat protection.

All art, sounds and characters are original and generated in code.
