# Chalet

A pixel-art ski village where every house is a coding agent in one of your folders, built entirely on the Rex CLI.

You walk an avatar around a small snowy valley. There's a slope with three pistes, a chairlift and a snowcat, and open snow at the bottom where you build a town. Each house you put down is tied to one folder on your machine and runs Claude Code in it. Walk up to a house, press Space, and you're talking to the session working in that folder. The name tag over the roof shows what it's doing: working, waiting for you, or done with a new answer.

The scene is rendered with Three.js on a strict pixel grid. It draws at "art" resolution and scales up by a whole number of device pixels, so no pixel comes out wider than its neighbour, even while the camera scrolls.

## Requirements

- macOS on Apple silicon (the packaged app targets `arm64`)
- A recent Node.js (developed on Node 24)
- For houses to run Claude Code (desktop app only):
  - [Claude Code](https://claude.com/claude-code): the `claude` CLI on your `PATH`
  - Rex: the `rex` CLI, with its server running

The app finds `rex` and `claude` through your login shell's `PATH`, so it also works when you open it from Finder or the Dock.

## Getting started

```sh
npm install
npm run app        # Vite dev server + Electron window, with hot reload
```

To run it in the browser instead:

```sh
npm run dev
```

The browser preview has no Electron main process. Builds are saved to `localStorage`, the folder picker gets its list from the Vite dev server, and houses can't run Claude Code.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server, for the browser preview |
| `npm run app` | Dev server opened in Electron (`tools/electron-dev.mjs`) |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serves the built `dist/` |
| `npm run app:dist` | Builds and packages `release/Chalet.dmg` (arm64, ad-hoc signed, LZMA-compressed) |
| `npm run icon` | Redraws the app icon, favicons and DMG background (`tools/make-icon.mjs`) |

`node tools/gridcheck.mjs shot.png [x0 y0 x1 y1]` checks a screenshot for pixel-grid errors: it finds the real block size and reports pixel runs that got doubled or dropped.

## Controls

| Key | Action |
| --- | --- |
| Arrow keys | Walk; on the board, steer toward where you want to go |
| E | Join the lift queue at the station |
| Space | By a house: open its prompt. Otherwise: jump (spin with ← → in the air) |
| Shift | Tuck for more speed |
| R | Respawn |
| Drag | Pan the view |
| F | Return the camera to the avatar |
| Esc | Close panels and dialogs |

You get off the lift automatically at the top. Your bindings strap in there too, and come off when you stop at the bottom.

While you're placing a build: R rotates it, C cycles its colour, Esc (or right-click) cancels.

Keys go by physical position (`e.code`), so shortcuts still work with a non-Latin input source like Korean or Russian.

Use the dock's zoom buttons to step between fixed zoom levels, out to the whole map. Each level is a scale where texture texels land on whole art pixels. The sky panel sets the time of day and the weather. A full day lasts 24 minutes, and the lift runs only during set hours.

## How houses work

Each house is one Claude Code session in one folder, and a folder can belong to only one house. The session runs as the interactive `claude` program inside a Rex session of its own, so:

- the work carries on after you quit Chalet (the Rex server is a separate process)
- you can open the same session in the Rex app and work there

`electron/rex.js` talks to Rex only through the `rex` CLI:

- `rex new LABEL -c DIR -- claude --session-id ID` starts a house's session
- prompts are pasted in, then submitted with `rex send-key enter`
- `rex events --all --json` streams status (idle, working, blocked, done), which Claude Code reports itself over OSC 7501
- `rex send-key escape` stops a turn, and `rex kill` closes a house

A house's chat is read from Claude Code's transcript (`~/.claude/projects/<folder>/<session-id>.jsonl`), so prompts typed in the Rex app show up there too. Each house has a permission mode you can change from its chat: **Auto**, **Accept edits** or **Default**.

The village is saved to `<userData>/village.json`. Decorations like trees, benches, lamps and fountains are builds with no folder and no session.

## Project layout

```
electron/          main process
  main.js            window, and the IPC bridge (window.native.send / on)
  preload.cjs        exposes window.native to the page
  rex.js             village store and the houses' Claude Code sessions, over the rex CLI
  folders.js         folder-picker channels
  listFolder.js      folder listing, shared with the Vite dev server
src/
  main.js            renderer, camera, zoom levels, input
  core/              clock, seeded random numbers, noise
  render/            pixel style pass, rider layer, integer-scale presenter
  world/             terrain, pistes, lift, water, environment and sky, props
  agents/            player, player model, snowcat
  village/           buildable catalog, placement, house chat UI, dialogs, main-process API
  ui/                dock, panels, hints
tools/             dev launcher, icon generator, grid checker, electron-builder hooks
build/             app icon and DMG background
public/            favicons
```
