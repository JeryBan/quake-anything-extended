# Bottom drawer — design

Date: 2026-10-03
Fork: `quake-anything-extended` (upstream `yccoskun/quake-anything` v1.0.1)
Target: GNOME Shell 50.5 / mutter 50.5, Wayland, single monitor (DP-1, 2560x1440)

## Intent

Make Quake Anything produce a Guake-style *drawer* for Nautilus at the bottom
of the screen: a centred, partial-width panel that slides straight down out of
view, stays available on every workspace, and is slightly translucent.

Upstream treats every dock as a full-width edge slab that vanishes via the
shell's stock minimise effect. That reads correctly for a top-edge terminal and
incorrectly for everything else.

## Requirements

1. **Centred partial width.** Top and bottom docks take a width percentage of
   the work area and are centred horizontally. Height percentage keeps its
   current meaning.
2. **Sticky.** A drawer is present on all workspaces rather than being dragged
   to the active one.
3. **Directional animation.** Show and hide both slide through the dock's own
   edge. No flight toward the corner, in either direction.
4. **Opacity.** Per-entry translucency.

Confirmed during design: the work area's bottom edge already coincides with the
monitor's, so no gap exists to remove. Work-area anchoring is *retained*
deliberately — if a dash is later moved to the bottom, the drawer should sit
above it rather than underneath.

## Non-goals

- Alignment other than centred (no left/right alignment setting).
- Arbitrary x/y offsets.
- Changes to left/right dock geometry.
- Animating opacity as part of the slide.

## Decision: settings representation

Upstream stores everything in one key, `entries`, of GVariant type
`a(ssssi)`. GVariant tuple types are not extensible, so each new per-entry
field is a breaking type change. This work adds three fields at once and more
are expected.

**Chosen:** a new key `app-entries` of type `as`, holding one JSON object per
entry. Adding a field later is a parser default, not a migration.

```
app-entries = ['{"id":"entry-musp","appId":"org.gnome.Nautilus.desktop",
                "side":"bottom","shortcut":"<Control><Alt>n",
                "sizePercent":45,"widthPercent":50,
                "sticky":true,"opacity":95}']
```

Rejected: extending the tuple to `a(ssssiibi)` (same problem again at the next
field); `aa{sv}` (extensible, but verbose to read and write from GJS for no
gain here).

**Migration.** The legacy `entries` key stays declared in the schema with its
original `a(ssssi)` type. On `enable()`, if `app-entries` is empty and
`entries` is not, each tuple is converted to JSON, written to `app-entries`,
and `entries` is reset. Declaring both keys is what makes the old value
readable at all — changing a key's type in place makes GSettings fall back to
the schema default and the user's configuration disappears silently.

`parseEntries` applies defaults for absent fields, so entries written by older
versions stay valid.

### Defaults

| Field | Type | Range | Default |
|---|---|---|---|
| `sizePercent` | int | 10–90 | 40 |
| `widthPercent` | int | 10–100 | 100 |
| `sticky` | bool | — | false |
| `opacity` | int | 10–100 | 100 |

Defaults reproduce current behaviour exactly, so a migrated entry looks and
behaves as it did before the user opts in.

## Geometry (`src/geometry.ts`)

`computeQuakeRect(side, sizePercent, widthPercent, monitorIndex)`.

Top and bottom gain a centred width; the cross-axis anchor is unchanged:

```
width  = round(work.width * wp)
x      = work.x + round((work.width - width) / 2)
height = round(work.height * sp)          // unchanged
y      = work.y                            // top
y      = work.y + work.height - height     // bottom
```

Left and right are untouched: `widthPercent` is ignored for them.

`percentFromRect` returns `{sizePercent, widthPercent}` instead of a single
number. This is load-bearing: it is how a manual resize is remembered, and if
it keeps reporting only the height axis, any width the user drags will be
silently discarded on the next toggle.

`sizePercent` clamps to 10–90 as today. `widthPercent` clamps to
10–**100**: 100 means full width, which is what reproduces current behaviour,
so the existing upper bound cannot be reused here.

## Window lifecycle (`src/quake-manager.ts`)

**Sticky.** On claim, `win.stick()` when `entry.sticky`, `win.unstick()`
otherwise. The existing `change_workspace()` call in `_applyQuakeGeometry`
(line 440) becomes conditional — it is the non-sticky fallback, and running
both is contradictory.

**Opacity.** On claim and on show, `actor.opacity = round(255 * opacity / 100)`.
Restored to `255` in `_detachWindow`, so a window released by the extension
does not stay translucent.

**Animation.** Both directions suppress the stock effect via
`Main.wm.skipNextEffect(actor)` (verified present at
`@girs/gnome-shell/src/ui/windowManager.d.ts:55`) and drive the motion with the
existing `slideOffsetForSide()` helper.

- `_show`: `skipNextEffect` → `unminimize()` → apply geometry → set translation
  to the slide offset → `activate()` → ease translation to 0.
- `_hide`: ease translation from 0 to the slide offset → on completion
  `skipNextEffect` → `minimize()` → reset translation to 0.

Resetting the translation after minimising matters: a window left translated
while minimised restores in the wrong place.

The existing `_animating` guard covers both paths and already prevents a toggle
landing mid-animation.

`ANIM_MS` stays 180ms.

## Preferences (`src/prefs.ts`)

Added to the entry dialog:

- **Width** spin row, 10–100, shown only when side is top or bottom; hidden and
  ignored for left/right.
- **Sticky** switch row.
- **Opacity** spin row, 10–100.

The list row subtitle becomes `Bottom · 45% x 50% · sticky · <Control><Alt>n`,
omitting segments that are at their default.

## Testing

`geometry.ts` is pure and holds the riskiest arithmetic, so it gets a
`bun test` suite — the repo has none today; this adds one file and a `test`
script.

Cases: centred x at several widths; width 100 reproduces current full-width
output exactly; bottom edge flush with work-area bottom; top edge flush with
work-area top; clamping at 10/90 and out-of-range input; left/right geometry
byte-identical to current behaviour; `percentFromRect` round-trips both axes
for top/bottom.

Manual verification needs a logout/login (GNOME 50 removed mutter's nested
backend along with X11 session support, so there is no in-window test shell):
toggle on and off at the bottom edge, confirm the slide direction in both
directions, switch workspaces while visible, confirm translucency.

## Risks

- **Opacity includes decorations.** `actor.opacity` covers the whole actor,
  shadows included. With blur-my-shell currently disabled the desktop shows
  through directly, which tends to look muddy; window blur is what makes
  translucency read as frosted.
- **Sticky plus minimise.** A stuck, minimised window is an unusual combination;
  worth confirming it does not reappear on the wrong workspace after a switch.
- **Migration runs once.** If it is interrupted between writing `app-entries`
  and resetting `entries`, re-running is harmless — the guard is "app-entries
  empty", so a populated target is never overwritten.

---

## Amendment — 2026-10-03: drawers always reset to configured geometry

Supersedes the `percentFromRect` two-axis requirement in the Geometry section.

A drawer that was maximised, fullscreened or drag-resized kept those
dimensions across a toggle, because `_hide` measured the live frame and wrote
it back as the entry's percentages. Fullscreen was never undone at all:
`unmaximizeWindow` checked only `get_maximize_flags()`.

**Now:** every show places the drawer at exactly the width and height in
settings. The live-geometry layer (`_liveGeom`, `PERSISTENT_GEOM`,
`_rememberQuakePercent`, `percentFromRect`, `percentsInArea`) is removed, and
`restoreWindowState` undoes fullscreen as well as maximised before placing.
Drag-resizing is now temporary, lasting until the next toggle.

This also dissolves review finding 3 (a settings change could not reach an
already-open drawer, because the live value always won) rather than patching
it: with no live value there is nothing to invalidate.
