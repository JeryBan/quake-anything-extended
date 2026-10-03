# Quake Anything Extended

Drop down (or side-dock) **any** GUI app with a keyboard shortcut — Quake-style,
not just a terminal.

[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-46--50-4A86CF)](https://release.gnome.org/)
[![License: GPL v2+](https://img.shields.io/badge/License-GPLv2%2B-blue.svg)](LICENSE)

A personal fork of [yccoskun/quake-anything](https://github.com/yccoskun/quake-anything),
extended into a proper *drawer*: centred at a configurable width, present on
every workspace, translucent, and sliding through its own edge in both
directions. See [CHANGELOG.md](CHANGELOG.md) for exactly what diverged.

Not published on extensions.gnome.org. Install it from this repository.

<p align="center">
  <img src="docs/screenshot.png" alt="Alacritty docked to the top edge and Firefox docked to the bottom edge, with the settings window in front" width="820">
</p>

Assign a shortcut to any installed application and it drops in from the edge you
picked. Press again to hide it. There is no panel icon — everything lives in the
extension's settings.

## Install

### Prebuilt, no toolchain required

`dist/` is committed, so a clone is already an installable extension. This is
the path for a machine where you don't want Bun or TypeScript:

```bash
git clone https://github.com/JeryBan/quake-anything-extended
cd quake-anything-extended
UUID=quake-anything-extended@jeryban.gr
mkdir -p ~/.local/share/gnome-shell/extensions/$UUID
cp -r dist/. ~/.local/share/gnome-shell/extensions/$UUID/
gnome-extensions enable $UUID
```

Then **log out and back in** — GNOME Shell only scans the extensions directory
at startup, so `gnome-extensions enable` will report that the extension does not
exist until it has.

### From source

```bash
bun install
bun run install-ext
gnome-extensions enable quake-anything-extended@jeryban.gr
```

Also needs a logout.

## Setup

Open **Extension Manager** (or **Extensions**) → Quake Anything Extended →
**Settings**, add an entry, and set:

| Setting | Meaning |
|---|---|
| **Application** | Any installed GUI app |
| **Side** | Top / bottom / left / right |
| **Keyboard shortcut** | Toggle show/hide (Esc cancels, Backspace clears; conflicts are warned) |
| **Default size** | Share of the work area along the dock's axis (10–90%) |
| **Width** / **Height** | Share of the work area *across* that axis, centred (10–100%). Shown as Width on top/bottom, Height on left/right |
| **Sticky** | Keep the drawer on every workspace |
| **Opacity** | 10–100%; 100 is fully opaque |

Press the shortcut to spawn. Press again to hide. Press again to show at the
configured position and size.

A bottom drawer at 45% size and 50% width is half the screen wide, centred, and
flush with the bottom edge. A left drawer at 40% size and 50% height is 40% of
the screen wide, half its height, vertically centred, and flush with the left
edge.

## Features

- Dock any installed GUI app to **top**, **bottom**, **left**, or **right**
- Every dock can take a **centred partial span** across its axis — a width on
  top/bottom, a height on left/right. 100% gives the full-edge slab
- Sizes are **percentages of the work area**, so moving between monitors of
  different resolutions keeps the proportions
- **Sticky** drawers stay available on every workspace
- **Per-entry opacity**, preserved across workspace switches and window effects
- Show and hide both **slide through the dock's own edge**
- **Every toggle resets the geometry.** Move, resize, maximise or fullscreen the
  drawer freely — the next toggle puts it back exactly where settings say
- **Hidden from the overview and Alt-Tab**, so a sticky drawer does not clutter
  every workspace's window list. The shortcut is the only way to summon it
- Only windows **spawned by this extension** are controlled; other windows of
  the same app are left alone
- Windows survive suspend and resume in place

## Notes

- Settings live in `app-entries`, one JSON object per entry. A configuration
  written by upstream (the `entries` tuple key) is migrated automatically the
  first time this version runs, from either the shell or the preferences
  window. Fields absent from an entry take defaults that reproduce upstream
  behaviour, so nothing changes until you opt in.
- The UUID is `quake-anything-extended@jeryban.gr`, deliberately different from
  upstream's so both can live in `~/.local/share/gnome-shell/extensions/`
  without one overwriting the other. It controls only the install directory
  name and the entry in dconf's `enabled-extensions`.
- The settings schema is still upstream's,
  `org.gnome.shell.extensions.quake-anything`, storing config at
  `/org/gnome/shell/extensions/quake-anything/`. That is what owns your
  configuration — changing it, not the UUID, is what would orphan it.
- `src/overview-visibility.ts` shadows `skip_taskbar` on the drawer's window so
  GNOME Shell leaves it out of the overview and Alt-Tab, the way guake does by
  setting `_NET_WM_STATE_SKIP_TASKBAR` on its own X11 window. Because the
  drawer is not in Alt-Tab, its keyboard shortcut is the only way to reach it.
- `src/clone-opacity.ts` patches a GNOME Shell prototype
  (`WorkspaceGroup._createClone`) so workspace-switch clones inherit window
  opacity. It restores the original on disable.
- Both of those reach into shell internals, as do a handful of calls elsewhere.
  See [Surviving a GNOME upgrade](#surviving-a-gnome-upgrade) for what breaks
  first and how to tell which one went.
- Client-side window buttons stay visible for many apps; GNOME does not let
  extensions remove them reliably.
- Some single-instance apps may not open a second window when one is already
  running.

## Surviving a GNOME upgrade

This extension reaches into GNOME Shell internals in a few places. None of them
are public API, so a major shell release can change them without warning. The
list below is ordered by how likely each is to break, and each failure mode is
written so you can tell from the symptom which one went.

Nothing here can break your desktop — the worst case is a behaviour quietly
stopping, or the extension failing to load and being listed as errored.

### 1. Overview and Alt-Tab hiding — `src/overview-visibility.ts`

Depends on GNOME Shell reading `window.skip_taskbar` **from JavaScript** in two
places:

```
ui/workspace.js   _isOverviewWindow(w) { return !w.skip_taskbar; }
ui/altTab.js      .filter(w => !w.skip_taskbar && ...)
```

We shadow that property on our own window. If either moves to the C method
`is_skip_taskbar()`, or the filter is restructured, the shadow stops being
consulted.

**Symptom:** the drawer reappears in the overview and Alt-Tab.
**Check:** extract `workspace.js` (see *Reading the shell's source* below) and
confirm `_isOverviewWindow` still reads the JS property.

### 2. Workspace-switch opacity — `src/clone-opacity.ts`

Patches `WorkspaceAnimation.WorkspaceGroup.prototype._createClone`. Breaks if
the class is renamed, the method disappears, or the animation stops using
`Clutter.Clone`.

**Symptom:** opacity flashes to 100% during a workspace switch (the original
bug), or the extension throws on enable if the prototype is missing.
**Check:** `grep -n "_createClone" workspaceAnimation.js`.

### 3. Window effect suppression — `Main.wm.skipNextEffect()`

Used at `quake-manager.ts:481,551,576` to stop the shell's stock
minimise/unminimise animations flying the window at a dash icon. It is a single
token consumed by whichever effect checks `_shouldAnimateActor` first, which is
why `_show` also flushes transitions before applying traits — see the opacity
bug in [CHANGELOG.md](CHANGELOG.md).

**Symptom:** the drawer flies toward a corner instead of sliding through its
edge, or opacity resets to 100% after a toggle.
**Check:** `grep -n "skipNextEffect\|_shouldAnimateActor" windowManager.js`, and
that `_unminimizeWindowDone` still ends with `set_opacity(255)`.

### 4. Typelib version bump

`metadata.json` claims `shell-version` 46–50, and the build resolves against
`@girs/meta-18` / `@girs/clutter-18` / `@girs/shell-18`. GNOME 51 will ship
Meta-19 and friends.

**Symptom:** the extension is listed as "unsupported" and never loads.
**Fix:** add the new version to `shell-version`, bump `@girs/gnome-shell`, run
`bun install && bun run build`, and read the new typings for anything that
changed shape.

### 5. Shell-monkeypatched JavaScript

`actor.ease()` (`quake-manager.ts:517,560`) and `connectObject()` /
`disconnectObject()` are added to Clutter and GObject by the shell's
`ui/environment.js`, not by Clutter or GObject themselves. They are stable in
practice but are not real platform API.

**Symptom:** `TypeError: actor.ease is not a function` in the journal on enable.

### 6. Narrower version-sensitive calls

| Call | Site | Note |
|---|---|---|
| `win.unmaximize()` with no arguments | `quake-manager.ts:48` | Shell 49+ signature; older shells took flags |
| `win.unmake_fullscreen()` | `quake-manager.ts:46` | Needed because `unmaximize()` alone never clears fullscreen |
| `global.display.grab_accelerator()` | `keybindings.ts:67` | Dynamic shortcut grabs, not schema-backed keybindings |
| `Meta.external_binding_name_for_action()` | `keybindings.ts:75` | Pairs with the grab above |
| `GioUnix.DesktopAppInfo` | `prefs.ts:3` | Split out of `Gio` in GNOME 45; older code used `Gio.DesktopAppInfo` |
| `Adw.SwitchRow`, `Adw.SpinRow`, `Adw.Dialog` | `prefs.ts` | libadwaita 1.4/1.5+; the prefs window fails to open if missing |

### First thing to run after an upgrade

```bash
journalctl --user -b -o cat /usr/bin/gnome-shell | grep -i quake
```

A stack trace there names the broken call directly. If the extension loads but
misbehaves, the `notify::<property>` + `new Error().stack` trick under
*Debugging* is how both opacity bugs in this fork were found.

### Reading the shell's source

The shell's JavaScript is not on disk as files — it is compiled into a
gresource bundle inside the shared library:

```bash
SO=/usr/lib/gnome-shell/libshell-18.so    # name tracks the GNOME version
gresource list $SO | grep "\.js$"
gresource extract $SO /org/gnome/shell/ui/workspace.js > workspace.js
```

That is how every claim in this section was verified; redo it against the new
version rather than trusting the line numbers above, which will drift.

## Development

Requires [Bun](https://bun.sh/). Source under `src/` compiles with `tsc` into
separate modules under `dist/` — not bundled into one file, which the
extensions.gnome.org review process requires.

```bash
bun install
bun run build          # tsc → dist/, lint, compile schemas, sync metadata into dist/
bun run test           # 29 tests over the pure layers
bun run lint           # build, then eslint the emitted JS
bun run install-ext    # stage and install into ~/.local/share/...
bun run pack           # produce the shell-extension zip
```

`bun run build` leaves `dist/` complete and installable — compiled JS plus
`metadata.json` and `schemas/`. **Commit `dist/` along with your source
changes**, or the prebuilt install path above goes stale.

### Testing a change

GNOME Shell 50 dropped mutter's nested backend along with X11 session support,
so `gnome-shell --nested` no longer exists and there is **no way to run a test
shell in a window**. Verifying a change costs either:

- a **logout/login**, or
- a **second VT** — Ctrl+Alt+F3, log in, then
  `dbus-run-session -- gnome-shell --display-server --wayland`, and Ctrl+Alt+F2
  to come back. Never `sudo` it; that strips `WAYLAND_DISPLAY`.

Because iteration is expensive, batch changes and run `bun run build` before
logging out. A `tsc --watch` dies with the session.

Only the pure layers (`src/types.ts`, `src/geometry.ts`) have unit tests.
Everything in `src/quake-manager.ts` needs a live compositor and is verified by
hand.

### Debugging

```bash
journalctl --user -b -o cat /usr/bin/gnome-shell | grep quake-anything
```

For tracing who mutates a window actor, `console.log` with
`new Error().stack` inside a `notify::<property>` handler works well — note that
grepping for your own tag will filter the stack lines out, so use `grep -A`.

### Design notes

`docs/superpowers/` holds the design spec and implementation plan for the
drawer work, including why settings moved to JSON and why the resize-memory
layer was removed. Useful background before changing the geometry or settings
code.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[GPL-2.0-or-later](LICENSE), as upstream. © 2026 Quake Anything contributors

**UUID:** `quake-anything-extended@jeryban.gr`
