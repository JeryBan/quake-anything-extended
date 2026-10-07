# Changelog

All notable changes to Quake Anything Extended are documented here.

This is a personal fork of
[yccoskun/quake-anything](https://github.com/yccoskun/quake-anything). The 1.0.x entries below are
upstream's. Nothing in this fork is tagged or released; the entry below exists
to record what diverged and why.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] - fork divergence (2026-10-03)

Turns an edge-anchored slab into a proper drawer. Defaults are chosen so a
migrated configuration behaves exactly as it did before; every new behaviour is
opt-in from Preferences.

### Added

- **Span** (10–100%) across the dock's axis, centred — a width on top/bottom, a
  height on left/right. 100% reproduces the old full-edge behaviour
  byte-for-byte on both axes. Stored as `spanPercent`; the earlier
  `widthPercent` key is still read as a fallback.
- **Sticky** — keep a drawer on every workspace via `Meta.Window.stick()`,
  instead of dragging it to the active one on each toggle.
- **Opacity** (10–100%) per entry.
- Drawers are hidden from the overview's window list and from Alt-Tab.
  `Meta.Window.skip_taskbar` is read-only and mutter derives it from hints a
  Wayland client we did not write will never set, so an own property shadows
  the GObject getter on our window alone — both shell readers
  (`ui/workspace.js`, `ui/altTab.js`) access it from JavaScript. Restored on
  detach, uncovering the window's real value rather than forcing `false`.
  Consequence: the keyboard shortcut is the only way to summon a drawer.
- Drawers are **kept above** other windows (`Meta.Window.make_above()`), and
  demoted on detach only if the extension was the one that raised them. Guake
  (WM class `guake`) shares that layer, so whenever a drawer takes focus any
  visible Guake window is raised back over it.

### Changed

- **Settings are now JSON.** The `entries` key (`a(ssssi)`) is superseded by
  `app-entries` (`as`), one JSON object per entry. GVariant tuple types are not
  extensible, so every new field used to be a breaking type change; absent keys
  now simply take their default. The legacy key stays declared in the schema so
  a one-time migration can read it — it runs from both `enable()` and the
  preferences process, and is idempotent.
- **Hiding animates.** Both directions now slide through the dock's own edge.
  Previously `_hide` just called `minimize()` and let the shell's stock effect
  fly the window at its dash icon — the wrong direction for any edge but the
  top. Both paths suppress the stock effect with `Main.wm.skipNextEffect()`.
- **Showing always resets geometry.** A drawer that was resized, maximised or
  fullscreened returns to its configured size on the next toggle. The
  live-geometry layer that remembered manual resizes is gone, and fullscreen is
  now undone as well as maximised — `unmaximize()` alone never cleared it.

### Fixed

- Preferences listened on the renamed-away `entries` key, so the list never
  refreshed after a write and a deleted entry could be written back.
- JSON `null`, `false` or `[]` in a numeric field coerced to `0` and clamped to
  the *minimum* rather than falling back to the default.
- A cancelled hide slide no longer minimises a window the extension is
  releasing (`onStopped` now honours `isFinished`).
- Per-entry opacity survives window effects. `_show` cancelled the shell's
  in-flight unminimise transition *after* applying opacity, and the resulting
  `_unminimizeWindowDone` forced it back to 255.
- Opacity no longer flashes to 100% during a workspace switch. The shell paints
  a `Clutter.Clone` of each window using the clone's own opacity;
  `clone-opacity.ts` copies the source's across.
- `stick()`/`unstick()` skip override-redirect windows, which tripped a
  `meta_window_stick` assertion.

### Development

- `bun test` suite (29 tests) over the pure settings-parsing, geometry and
  overview-visibility layers.
- `dist/` is committed, so the extension can be installed without a toolchain.
- Own UUID, `quake-anything-extended@jeryban.gr`, so this fork and upstream can
  be installed side by side. `settings-schema` is deliberately left at
  upstream's value — it, not the UUID, owns the dconf path.


## [1.0.1] - 2026-08-25

### Fixed

- Spawned windows are no longer lost when the session is suspended. Window IDs,
  live size percentages, and monitor placements now persist across the
  disable/enable cycle that suspend triggers.
- Windows are reclaimed on enable without replaying the show animation, so a
  resumed session comes back to the layout it had.
- Stale window IDs and unmanaged windows are cleaned out of the persistent state
  instead of leaking.

### Added

- `version-name` in `metadata.json`, so extensions.gnome.org shows a semantic
  version rather than only the review sequence number.

## [1.0.0] - 2026-08-02

Initial release on [extensions.gnome.org](https://extensions.gnome.org/extension/10596/quake-anything/).

### Added

- Dock any installed GUI app to the **top**, **bottom**, **left**, or **right**
  edge of the screen, Quake-style.
- Multiple entries, each with its own application, edge, keyboard shortcut, and
  size.
- Default size expressed as a **percentage** of the monitor work area (10–90%),
  so the layout survives moving between monitors of different resolutions.
- First spawn lands on the monitor under the mouse pointer; later toggles
  restore the docked position and size.
- Free movement while visible — move, resize, minimize, or maximize the window;
  the next shortcut press snaps it back to its Quake position.
- Only windows spawned by the extension are controlled. Other windows of the
  same application are left alone.
- Preferences dialog with shortcut capture (Esc cancels, Backspace clears) and
  conflict warnings against existing GNOME shortcuts.
- GNOME Shell 46–50 support.

[1.0.1]: https://github.com/yccoskun/quake-anything/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/yccoskun/quake-anything/releases/tag/v1.0.0
