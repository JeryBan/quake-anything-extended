# Bottom Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Quake Anything's full-width edge slab into a centred, sticky, translucent drawer that slides through its own dock edge.

**Architecture:** Settings move from a fixed GVariant tuple to one JSON object per entry under a new key, migrated once from the old key. Geometry gains a second axis with the pure arithmetic split out from the compositor lookups so it can be unit tested. The window lifecycle gains sticky and opacity traits, and both animation directions suppress the shell's stock minimise effect and drive the motion themselves.

**Tech Stack:** TypeScript 5.9 → GJS (ES2022, NodeNext), GNOME Shell 50 / Meta 18, Adwaita 1 prefs, `bun test`, eslint 9.

**Spec:** `docs/superpowers/specs/2026-10-03-bottom-drawer-design.md`

## Global Constraints

- Target GNOME Shell 50 / mutter 50.5; `metadata.json` `shell-version` stays `["46","47","48","49","50"]`.
- `sizePercent` clamps 10–90. `widthPercent` clamps 10–**100**. `opacity` clamps 10–100.
- Defaults must reproduce current behaviour exactly: `widthPercent` 100, `sticky` false, `opacity` 100.
- `widthPercent` applies to `top` and `bottom` only; `left`/`right` geometry must stay byte-identical to current output.
- eslint `no-unused-vars` is an **error** — an import left behind after a refactor fails `bun run build`.
- `ANIM_MS` stays 180.
- No new runtime dependencies. Tests live in `tests/` so `tsconfig.json` (`include: ["src/**/*"]`) keeps them out of `dist/`.

## Review Focus

1. **Malformed JSON in `app-entries`** (hand-edited dconf, truncated write): one bad string must skip only that entry, never throw and take the whole extension down. — tested in Task 1.
2. **Entry missing the new fields** (written by an older version, or migrated): absent `widthPercent`/`sticky`/`opacity` must fall back to the defaults that reproduce current behaviour, not to `0`/`undefined`. — tested in Task 1.
3. **`widthPercent` at exactly 100**: must produce a rect byte-identical to today's full-width output, or every existing user silently gets a one-pixel-shifted window. — tested in Task 2.
4. **Toggle pressed mid-animation**: the `_animating` guard must leave visible state and the window's minimised state in agreement, with no half-translated window left on screen. — compositor-dependent, no unit harness; manual check in Task 6.
5. **Opacity outliving the extension's ownership**: a window released via `_detachWindow` (app quits, entry deleted, extension disabled) must return to opacity 255 rather than staying translucent for the rest of the session. — compositor-dependent, no unit harness; manual check in Task 6.

---

### Task 1: JSON settings representation and one-time migration

**Files:**
- Modify: `src/types.ts` (full rewrite of the parse/serialise layer)
- Modify: `schemas/org.gnome.shell.extensions.quake-anything.gschema.xml`
- Modify: `src/extension.ts:46` (read new key, run migration)
- Modify: `src/prefs.ts:462-470` (load/save), `src/prefs.ts:1-20` (imports)
- Modify: `package.json` (add `test` script)
- Create: `tests/types.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `QuakeEntry` with fields `{id: string, appId: string, side: QuakeSide, shortcut: string, sizePercent: number, widthPercent: number, sticky: boolean, opacity: number}`; `parseEntries(raw: string[]): QuakeEntry[]`; `entriesToJson(entries: QuakeEntry[]): string[]`; `migrateTuples(raw: QuakeEntryTuple[]): QuakeEntry[]`; `ENTRY_DEFAULTS`. Tasks 2–5 all depend on these field names.

- [ ] **Step 1: Add the test script**

In `package.json` `"scripts"`, add:

```json
"test": "bun test",
```

- [ ] **Step 2: Write the failing tests**

Create `tests/types.test.ts`:

```ts
import {describe, expect, test} from 'bun:test';
import {
    ENTRY_DEFAULTS,
    entriesToJson,
    migrateTuples,
    parseEntries,
    type QuakeEntry,
} from '../src/types.js';

const full: QuakeEntry = {
    id: 'e1',
    appId: 'org.gnome.Nautilus.desktop',
    side: 'bottom',
    shortcut: '<Control><Alt>n',
    sizePercent: 45,
    widthPercent: 50,
    sticky: true,
    opacity: 95,
};

describe('parseEntries', () => {
    test('round-trips a complete entry', () => {
        expect(parseEntries(entriesToJson([full]))).toEqual([full]);
    });

    test('skips malformed JSON but keeps good neighbours', () => {
        const raw = ['{not json', ...entriesToJson([full]), '{"id":'];
        expect(parseEntries(raw)).toEqual([full]);
    });

    test('applies defaults when new fields are absent', () => {
        const raw = [JSON.stringify({
            id: 'e2',
            appId: 'foo.desktop',
            side: 'top',
            shortcut: '',
            sizePercent: 40,
        })];
        const [entry] = parseEntries(raw);
        expect(entry.widthPercent).toBe(ENTRY_DEFAULTS.widthPercent);
        expect(entry.widthPercent).toBe(100);
        expect(entry.sticky).toBe(false);
        expect(entry.opacity).toBe(100);
    });

    test('drops entries with a missing id, appId or bad side', () => {
        const raw = [
            JSON.stringify({appId: 'a.desktop', side: 'top'}),
            JSON.stringify({id: 'x', side: 'top'}),
            JSON.stringify({id: 'y', appId: 'a.desktop', side: 'diagonal'}),
        ];
        expect(parseEntries(raw)).toEqual([]);
    });

    test('clamps each percentage to its own range', () => {
        const raw = [JSON.stringify({
            ...full, sizePercent: 999, widthPercent: 999, opacity: 999,
        })];
        const [entry] = parseEntries(raw);
        expect(entry.sizePercent).toBe(90);
        expect(entry.widthPercent).toBe(100);
        expect(entry.opacity).toBe(100);
    });

    test('rejects a non-object payload without throwing', () => {
        expect(parseEntries(['42', '"a string"', 'null'])).toEqual([]);
    });
});

describe('migrateTuples', () => {
    test('converts a legacy tuple and fills new fields with defaults', () => {
        const [entry] = migrateTuples([
            ['entry-musp', 'org.gnome.Nautilus.desktop', 'bottom', '<Control><Alt>n', 45],
        ]);
        expect(entry).toEqual({
            id: 'entry-musp',
            appId: 'org.gnome.Nautilus.desktop',
            side: 'bottom',
            shortcut: '<Control><Alt>n',
            sizePercent: 45,
            widthPercent: 100,
            sticky: false,
            opacity: 100,
        });
    });

    test('skips short or malformed tuples', () => {
        expect(migrateTuples([['a', 'b'] as never])).toEqual([]);
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/types.test.ts`
Expected: FAIL — `entriesToJson`, `migrateTuples` and `ENTRY_DEFAULTS` are not exported from `src/types.ts`.

- [ ] **Step 4: Rewrite the parse layer**

Replace the body of `src/types.ts` from `export interface QuakeEntry` through `entriesToTuples` with:

```ts
export interface QuakeEntry {
    id: string;
    appId: string;
    side: QuakeSide;
    shortcut: string;
    sizePercent: number;
    widthPercent: number;
    sticky: boolean;
    opacity: number;
}

/** Legacy GVariant shape for the pre-migration `entries` key: a(ssssi) */
export type QuakeEntryTuple = [string, string, string, string, number];

/** Defaults chosen so a migrated entry behaves exactly as it did before. */
export const ENTRY_DEFAULTS = {
    sizePercent: 40,
    widthPercent: 100,
    sticky: false,
    opacity: 100,
} as const;

export function isQuakeSide(value: string): value is QuakeSide {
    return value === 'top' || value === 'bottom' || value === 'left' || value === 'right';
}

function clampInt(value: unknown, lo: number, hi: number, fallback: number): number {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(hi, Math.max(lo, n));
}

export function parseEntries(raw: string[]): QuakeEntry[] {
    const entries: QuakeEntry[] = [];
    for (const text of raw) {
        let obj: Record<string, unknown>;
        try {
            const parsed: unknown = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                continue;
            obj = parsed as Record<string, unknown>;
        } catch {
            continue;
        }

        const id = typeof obj.id === 'string' ? obj.id : '';
        const appId = typeof obj.appId === 'string' ? obj.appId : '';
        const side = typeof obj.side === 'string' ? obj.side : '';
        if (!id || !appId || !isQuakeSide(side))
            continue;

        entries.push({
            id,
            appId,
            side,
            shortcut: typeof obj.shortcut === 'string' ? obj.shortcut : '',
            sizePercent: clampInt(obj.sizePercent, 10, 90, ENTRY_DEFAULTS.sizePercent),
            widthPercent: clampInt(obj.widthPercent, 10, 100, ENTRY_DEFAULTS.widthPercent),
            sticky: obj.sticky === true,
            opacity: clampInt(obj.opacity, 10, 100, ENTRY_DEFAULTS.opacity),
        });
    }
    return entries;
}

export function entriesToJson(entries: QuakeEntry[]): string[] {
    return entries.map(entry => JSON.stringify(entry));
}

/** One-time conversion of the legacy `entries` tuples into QuakeEntry objects. */
export function migrateTuples(raw: QuakeEntryTuple[]): QuakeEntry[] {
    const entries: QuakeEntry[] = [];
    for (const tuple of raw) {
        if (!Array.isArray(tuple) || tuple.length < 5)
            continue;
        const [id, appId, side, shortcut, sizePercent] = tuple;
        if (!id || !appId || typeof side !== 'string' || !isQuakeSide(side))
            continue;
        entries.push({
            id,
            appId,
            side,
            shortcut: shortcut ?? '',
            sizePercent: clampInt(sizePercent, 10, 90, ENTRY_DEFAULTS.sizePercent),
            widthPercent: ENTRY_DEFAULTS.widthPercent,
            sticky: ENTRY_DEFAULTS.sticky,
            opacity: ENTRY_DEFAULTS.opacity,
        });
    }
    return entries;
}
```

Keep `createEntryId` and `formatMessage` exactly as they are. Delete `entriesToTuples` — Step 7 removes its only caller.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/types.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Declare both schema keys**

In `schemas/org.gnome.shell.extensions.quake-anything.gschema.xml`, replace the single `entries` key with:

```xml
    <key name="app-entries" type="as">
      <default>[]</default>
      <summary>Quake application entries</summary>
      <description>
        Configured Quake-mode applications, one JSON object per entry with
        keys: id, appId, side, shortcut, sizePercent, widthPercent, sticky,
        opacity. Unknown keys are ignored and absent keys take their default.
      </description>
    </key>

    <!--
      Legacy key, retained only so the one-time migration can read a
      configuration written before app-entries existed. Changing a key's
      type in place makes GSettings fall back to the default and the user's
      configuration disappears silently, so this declaration must stay.
    -->
    <key name="entries" type="a(ssssi)">
      <default>[]</default>
      <summary>Legacy entries (migrated to app-entries)</summary>
      <description>Superseded by app-entries. Reset after migration.</description>
    </key>
```

- [ ] **Step 7: Point prefs at the new key**

In `src/prefs.ts`, replace both methods at lines 462-470:

```ts
    private _loadEntries(settings: Gio.Settings): QuakeEntry[] {
        return parseEntries(settings.get_strv('app-entries'));
    }

    private _saveEntries(settings: Gio.Settings, entries: QuakeEntry[]): void {
        settings.set_strv('app-entries', entriesToJson(entries));
    }
```

In the import block at the top of `src/prefs.ts`, swap `entriesToTuples` for `entriesToJson` and delete `type QuakeEntryTuple`. Then delete the line `import GLib from 'gi://GLib';` — line 469 was its only use, and `no-unused-vars` is an error.

- [ ] **Step 8: Migrate on enable**

In `src/extension.ts`, change the import on line 7 to:

```ts
import {
    entriesToJson,
    formatMessage,
    migrateTuples,
    parseEntries,
    type QuakeEntry,
    type QuakeEntryTuple,
} from './types.js';
```

Replace line 46 inside `_reload()`:

```ts
        const entries = parseEntries(this._settings.get_strv('app-entries'));
```

(delete the `raw`/`deep_unpack` line and the now-duplicated `parseEntries(raw)` call).

Add this method to the class:

```ts
    /**
     * One-time move from the legacy `entries` tuple key to `app-entries`.
     * Guarded on the target being empty, so re-running is harmless.
     */
    private _migrateLegacyEntries(): void {
        const settings = this._settings;
        if (!settings)
            return;
        if (settings.get_strv('app-entries').length > 0)
            return;

        const legacy = settings.get_value('entries').deep_unpack() as QuakeEntryTuple[];
        if (legacy.length === 0)
            return;

        settings.set_strv('app-entries', entriesToJson(migrateTuples(legacy)));
        settings.reset('entries');
        console.log(`[quake-anything] migrated ${legacy.length} entries to app-entries`);
    }
```

In `enable()`, call it immediately after `this._settings = this.getSettings();` and before `this._reload();`. Change the signal connection to watch the new key:

```ts
        this._settings.connectObject('changed::app-entries', () => this._reload(), this);
```

- [ ] **Step 9: Verify the build is clean**

Run: `bun run build && bun run schemas`
Expected: no TypeScript errors and no eslint errors. If eslint reports an unused `GLib`, `QuakeEntryTuple` or `entriesToTuples`, remove it — see Step 7.

- [ ] **Step 10: Commit**

```bash
git add src/types.ts src/extension.ts src/prefs.ts schemas package.json tests/types.test.ts
git commit -m "feat: store entries as JSON with one-time migration from tuple key"
```

---

### Task 2: Centred width geometry

**Files:**
- Modify: `src/geometry.ts:62-129`
- Create: `tests/geometry.test.ts`

**Interfaces:**
- Consumes: `QuakeSide` from Task 1.
- Produces: `computeRectInArea(side: QuakeSide, sizePercent: number, widthPercent: number, work: Rect): Rect`; `computeQuakeRect(side, sizePercent, widthPercent, monitorIndex): Rect`; `percentsInArea(side, rect: Rect, work: Rect): {sizePercent: number; widthPercent?: number}`; `percentFromRect(side, rect, monitorIndex)` with the same return type. Task 3 and Task 4 call `computeQuakeRect` and `percentFromRect` with the new signatures.

The pure arithmetic is split from the compositor lookups so it can be tested without stubbing `global`.

- [ ] **Step 1: Write the failing tests**

Create `tests/geometry.test.ts`:

```ts
import {describe, expect, test} from 'bun:test';
import {computeRectInArea, percentsInArea} from '../src/geometry.js';

// A 2560x1440 monitor with a 37px top bar reserved.
const work = {x: 0, y: 37, width: 2560, height: 1403};

describe('computeRectInArea: bottom', () => {
    test('centres a partial width against the work area', () => {
        const r = computeRectInArea('bottom', 45, 50, work);
        expect(r.width).toBe(1280);
        expect(r.x).toBe(640);
        expect(r.height).toBe(631);
        expect(r.y).toBe(work.y + work.height - 631);
    });

    test('sits flush with the work area bottom edge', () => {
        const r = computeRectInArea('bottom', 45, 50, work);
        expect(r.y + r.height).toBe(work.y + work.height);
    });

    test('width 100 reproduces full-width output exactly', () => {
        const r = computeRectInArea('bottom', 45, 100, work);
        expect(r.x).toBe(work.x);
        expect(r.width).toBe(work.width);
    });
});

describe('computeRectInArea: top', () => {
    test('centres and sits flush with the work area top edge', () => {
        const r = computeRectInArea('top', 40, 60, work);
        expect(r.y).toBe(work.y);
        expect(r.width).toBe(1536);
        expect(r.x).toBe(512);
    });
});

describe('computeRectInArea: left and right ignore widthPercent', () => {
    test('left is unchanged by widthPercent', () => {
        const a = computeRectInArea('left', 40, 100, work);
        const b = computeRectInArea('left', 40, 25, work);
        expect(a).toEqual(b);
        expect(a).toEqual({x: 0, y: 37, width: 1024, height: 1403});
    });

    test('right is unchanged by widthPercent and stays flush right', () => {
        const a = computeRectInArea('right', 40, 100, work);
        const b = computeRectInArea('right', 40, 25, work);
        expect(a).toEqual(b);
        expect(a.x + a.width).toBe(work.x + work.width);
    });
});

describe('computeRectInArea: clamping', () => {
    test('sizePercent clamps to 10-90', () => {
        expect(computeRectInArea('bottom', 999, 100, work).height)
            .toBe(computeRectInArea('bottom', 90, 100, work).height);
        expect(computeRectInArea('bottom', 0, 100, work).height)
            .toBe(computeRectInArea('bottom', 10, 100, work).height);
    });

    test('widthPercent clamps to 10-100', () => {
        expect(computeRectInArea('bottom', 45, 999, work).width).toBe(work.width);
        expect(computeRectInArea('bottom', 45, 0, work).width)
            .toBe(computeRectInArea('bottom', 45, 10, work).width);
    });

    test('never extends past the work area horizontally', () => {
        for (const wp of [10, 33, 50, 77, 100]) {
            const r = computeRectInArea('bottom', 45, wp, work);
            expect(r.x).toBeGreaterThanOrEqual(work.x);
            expect(r.x + r.width).toBeLessThanOrEqual(work.x + work.width);
        }
    });
});

describe('percentsInArea', () => {
    test('round-trips both axes for bottom', () => {
        const rect = computeRectInArea('bottom', 45, 50, work);
        expect(percentsInArea('bottom', rect, work)).toEqual({
            sizePercent: 45,
            widthPercent: 50,
        });
    });

    test('reports no width axis for left and right', () => {
        const rect = computeRectInArea('left', 40, 100, work);
        const p = percentsInArea('left', rect, work);
        expect(p.sizePercent).toBe(40);
        expect(p.widthPercent).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/geometry.test.ts`
Expected: FAIL — `computeRectInArea` and `percentsInArea` are not exported.

- [ ] **Step 3: Replace the geometry functions**

In `src/geometry.ts`, replace `computeQuakeRect` and `percentFromRect` with:

```ts
/** Pure placement maths. `work` is the target work area in absolute coords. */
export function computeRectInArea(
    side: QuakeSide,
    sizePercent: number,
    widthPercent: number,
    work: Rect,
): Rect {
    const sp = Math.min(90, Math.max(10, sizePercent)) / 100;
    const wp = Math.min(100, Math.max(10, widthPercent)) / 100;

    switch (side) {
    case 'top':
    case 'bottom': {
        const height = Math.round(work.height * sp);
        const width = Math.round(work.width * wp);
        const x = work.x + Math.round((work.width - width) / 2);
        const y = side === 'top'
            ? work.y
            : work.y + work.height - height;
        return {x, y, width, height};
    }
    case 'left':
        return {
            x: work.x,
            y: work.y,
            width: Math.round(work.width * sp),
            height: work.height,
        };
    case 'right': {
        const width = Math.round(work.width * sp);
        return {
            x: work.x + work.width - width,
            y: work.y,
            width,
            height: work.height,
        };
    }
    }
}

export function computeQuakeRect(
    side: QuakeSide,
    sizePercent: number,
    widthPercent: number,
    monitorIndex: number,
): Rect {
    return computeRectInArea(
        side,
        sizePercent,
        widthPercent,
        getWorkAreaForMonitor(monitorIndex),
    );
}

/**
 * Derive stored percentages from an actual frame, so a manual resize is
 * remembered. `widthPercent` is absent for left/right, whose width is driven
 * by `sizePercent`; callers must leave the stored value alone in that case.
 */
export function percentsInArea(
    side: QuakeSide,
    rect: Rect,
    work: Rect,
): {sizePercent: number; widthPercent?: number} {
    if (side === 'top' || side === 'bottom') {
        const sizeRatio = work.height > 0 ? rect.height / work.height : 0.4;
        const widthRatio = work.width > 0 ? rect.width / work.width : 1;
        return {
            sizePercent: Math.min(90, Math.max(10, Math.round(sizeRatio * 100))),
            widthPercent: Math.min(100, Math.max(10, Math.round(widthRatio * 100))),
        };
    }

    const sizeRatio = work.width > 0 ? rect.width / work.width : 0.4;
    return {
        sizePercent: Math.min(90, Math.max(10, Math.round(sizeRatio * 100))),
    };
}

export function percentFromRect(
    side: QuakeSide,
    rect: Rect,
    monitorIndex: number,
): {sizePercent: number; widthPercent?: number} {
    return percentsInArea(side, rect, getWorkAreaForMonitor(monitorIndex));
}
```

Leave `sanitizeMonitorIndex`, `isValidRect`, `getPointerMonitorIndex`, `getWorkAreaForMonitor` and `slideOffsetForSide` untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/geometry.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/geometry.ts tests/geometry.test.ts
git commit -m "feat: centre top/bottom docks at a configurable width"
```

---

### Task 3: Sticky and opacity window traits

**Files:**
- Modify: `src/quake-manager.ts` — module state (lines 20-23), `_claimWindow`, `_detachWindow`, `_effectivePercent`, `_rememberQuakePercent`, `_applyQuakeGeometry`

**Interfaces:**
- Consumes: `QuakeEntry` (Task 1), `computeQuakeRect` / `percentFromRect` new signatures (Task 2).
- Produces: `_applyWindowTraits(win: Meta.Window, entry: QuakeEntry): void`; `_effectiveGeom(entryId: string, entry: QuakeEntry): {sizePercent: number; widthPercent: number}`. Task 4 calls both.

This task has no unit tests — every function here needs a live compositor. Its behaviour is verified in Task 6.

- [ ] **Step 1: Widen the remembered-geometry state**

At the top of `src/quake-manager.ts`, replace `PERSISTENT_PERCENT`:

```ts
interface LiveGeom {
    sizePercent: number;
    widthPercent: number;
}

const PERSISTENT_WINDOWS = new Map<number, string>();
const PERSISTENT_GEOM = new Map<string, LiveGeom>();
const PERSISTENT_MONITOR = new Map<string, number>();
```

In the class, replace the `_livePercent` field:

```ts
    private _liveGeom = new Map<string, LiveGeom>();
```

Replace every `this._livePercent` with `this._liveGeom` and every `PERSISTENT_PERCENT` with `PERSISTENT_GEOM` throughout the file (occurrences in `disable`, `setEntries`, `_claimWindow`, `_detachWindow`, `_rememberQuakePercent`, `_applyQuakeGeometry`).

- [ ] **Step 2: Replace `_effectivePercent` with `_effectiveGeom`**

```ts
    private _effectiveGeom(entryId: string, entry: QuakeEntry): LiveGeom {
        const live = this._liveGeom.get(entryId);
        return {
            sizePercent: live?.sizePercent ?? entry.sizePercent,
            widthPercent: live?.widthPercent ?? entry.widthPercent,
        };
    }
```

- [ ] **Step 3: Record both axes on resize**

Replace the body of `_rememberQuakePercent`:

```ts
    private _rememberQuakePercent(entryId: string, win: Meta.Window, entry: QuakeEntry): void {
        if (!this._isWindowAlive(win))
            return;

        const frame = win.get_frame_rect();
        const monitor = sanitizeMonitorIndex(win.get_monitor());
        const percents = percentFromRect(
            entry.side,
            {x: frame.x, y: frame.y, width: frame.width, height: frame.height},
            monitor,
        );

        const previous = this._effectiveGeom(entryId, entry);
        const next: LiveGeom = {
            sizePercent: percents.sizePercent,
            // Absent for left/right — keep whatever width was stored.
            widthPercent: percents.widthPercent ?? previous.widthPercent,
        };

        this._liveGeom.set(entryId, next);
        this._lastMonitor.set(entryId, monitor);
        PERSISTENT_GEOM.set(entryId, next);
        PERSISTENT_MONITOR.set(entryId, monitor);
    }
```

- [ ] **Step 4: Add the traits helper**

Add to the class:

```ts
    /** Apply the per-entry traits that are independent of geometry. */
    private _applyWindowTraits(win: Meta.Window, entry: QuakeEntry): void {
        if (!this._isWindowAlive(win))
            return;

        if (entry.sticky)
            win.stick();
        else
            win.unstick();

        const actor = win.get_compositor_private() as Clutter.Actor | null;
        if (actor) {
            const pct = Math.min(100, Math.max(10, entry.opacity));
            actor.opacity = Math.round(255 * pct / 100);
        }
    }
```

- [ ] **Step 5: Call it on claim, and restore on detach**

In `_claimWindow`, immediately after `PERSISTENT_WINDOWS.set(win.get_id(), entryId);`:

```ts
        this._applyWindowTraits(win, entry);
```

In `_claimWindow`'s `isRestore` branch, replace the percent restore:

```ts
            const geom = PERSISTENT_GEOM.get(entryId);
            if (geom !== undefined)
                this._liveGeom.set(entryId, geom);
```

In `_detachWindow`, replace the existing `if (win && this._isWindowAlive(win))` block in full. A window the extension no longer owns must not stay translucent or stuck:

```ts
        if (win && this._isWindowAlive(win)) {
            const actor = win.get_compositor_private() as Clutter.Actor | null;
            if (actor) {
                actor.remove_all_transitions();
                actor.set_translation(0, 0, 0);
                actor.opacity = 255;
            }
            win.unstick();
        }
```

- [ ] **Step 6: Make the workspace pull conditional**

In `_applyQuakeGeometry`, replace the unconditional workspace block (currently `src/quake-manager.ts:437-440`):

```ts
            // A sticky window is already on every workspace; pulling it would
            // fight the stick. Only non-sticky drawers follow the user.
            if (!entry.sticky) {
                const workspace = global.workspace_manager.get_active_workspace();
                if (!win.located_on_workspace(workspace))
                    win.change_workspace(workspace);
            }
```

Also update the `computeQuakeRect` call in the same method:

```ts
        const geom = this._effectiveGeom(entryId, entry);
        const rawMonitor = usePointerMonitor
            ? getPointerMonitorIndex()
            : win.get_monitor();
        const monitor = sanitizeMonitorIndex(rawMonitor);
        const rect = computeQuakeRect(entry.side, geom.sizePercent, geom.widthPercent, monitor);
```

and the persistence tail of that method:

```ts
            if (!this._liveGeom.has(entryId)) {
                this._liveGeom.set(entryId, geom);
                PERSISTENT_GEOM.set(entryId, geom);
            }
```

- [ ] **Step 7: Verify the build is clean**

Run: `bun run build`
Expected: no TypeScript errors, no eslint errors. Any remaining reference to `_livePercent`, `PERSISTENT_PERCENT` or `_effectivePercent` is a compile error and must be converted.

- [ ] **Step 8: Commit**

```bash
git add src/quake-manager.ts
git commit -m "feat: per-entry sticky and opacity traits"
```

---

### Task 4: Symmetric slide animation

**Files:**
- Modify: `src/quake-manager.ts` — `_show` (`:466`), `_hide` (`:513`), imports

**Interfaces:**
- Consumes: `_applyWindowTraits`, `_effectiveGeom` (Task 3); `computeQuakeRect` (Task 2).
- Produces: no new exports.

The stock minimise effect flies the window toward its dash icon — with no dash visible that is the top-left corner, regardless of dock side. `Main.wm.skipNextEffect(actor)` suppresses it so the extension's own easing is the only motion. `Main` is already imported at `src/quake-manager.ts:7`.

- [ ] **Step 1: Rewrite `_show`**

```ts
    private _show(entryId: string, win: Meta.Window, entry: QuakeEntry): void {
        if (this._animating.has(entryId))
            return;
        if (!this._isWindowAlive(win)) {
            this._detachWindow(entryId, true);
            return;
        }

        const actor = win.get_compositor_private() as Clutter.Actor | null;

        if (win.minimized) {
            // Suppress the stock unminimise effect, which flies in from the
            // dash icon rather than from this drawer's own edge.
            if (actor)
                Main.wm.skipNextEffect(actor);
            win.unminimize();
        }

        this._applyQuakeGeometry(entryId, win, entry, false);

        if (!this._isWindowAlive(win)) {
            this._detachWindow(entryId, true);
            return;
        }

        this._applyWindowTraits(win, entry);
        win.activate(global.get_current_time());

        if (!actor)
            return;

        const geom = this._effectiveGeom(entryId, entry);
        const rect = computeQuakeRect(
            entry.side,
            geom.sizePercent,
            geom.widthPercent,
            sanitizeMonitorIndex(win.get_monitor()),
        );
        if (!isValidRect(rect))
            return;

        const offset = slideOffsetForSide(entry.side, rect);
        actor.remove_all_transitions();
        actor.set_translation(offset.x, offset.y, 0);
        this._animating.add(entryId);
        actor.ease({
            translationX: 0,
            translationY: 0,
            duration: ANIM_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onStopped: () => {
                this._animating.delete(entryId);
            },
        });
    }
```

- [ ] **Step 2: Rewrite `_hide`**

```ts
    private _hide(entryId: string, win: Meta.Window, entry: QuakeEntry): void {
        if (this._animating.has(entryId))
            return;
        if (!this._isWindowAlive(win)) {
            this._detachWindow(entryId, true);
            return;
        }

        this._rememberQuakePercent(entryId, win, entry);

        const actor = win.get_compositor_private() as Clutter.Actor | null;
        if (!actor) {
            win.minimize();
            return;
        }

        const geom = this._effectiveGeom(entryId, entry);
        const rect = computeQuakeRect(
            entry.side,
            geom.sizePercent,
            geom.widthPercent,
            sanitizeMonitorIndex(win.get_monitor()),
        );
        if (!isValidRect(rect)) {
            Main.wm.skipNextEffect(actor);
            win.minimize();
            return;
        }

        const offset = slideOffsetForSide(entry.side, rect);
        actor.remove_all_transitions();
        actor.set_translation(0, 0, 0);
        this._animating.add(entryId);
        actor.ease({
            translationX: offset.x,
            translationY: offset.y,
            duration: ANIM_MS,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onStopped: () => {
                this._animating.delete(entryId);
                if (!this._isWindowAlive(win))
                    return;
                // Minimise only once the drawer is offscreen, with the stock
                // effect suppressed so nothing flies to the corner.
                Main.wm.skipNextEffect(actor);
                win.minimize();
                // A window left translated while minimised restores offset.
                actor.set_translation(0, 0, 0);
            },
        });
    }
```

- [ ] **Step 3: Verify the build is clean**

Run: `bun run build && bun test`
Expected: no TypeScript errors, no eslint errors, all Task 1 and Task 2 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/quake-manager.ts
git commit -m "feat: slide drawers through their own edge in both directions"
```

---

### Task 5: Preferences for width, sticky and opacity

**Files:**
- Modify: `src/prefs.ts:136-139` (list row subtitle), `src/prefs.ts:200-300` (editor dialog), `src/prefs.ts:318-331` (save)

**Interfaces:**
- Consumes: `QuakeEntry` and `ENTRY_DEFAULTS` (Task 1).
- Produces: no new exports.

- [ ] **Step 1: Import the defaults**

Add `ENTRY_DEFAULTS` to the existing import from `./types.js` in `src/prefs.ts`.

- [ ] **Step 2: Seed the new locals**

In `_openEditor`, after `let sizePercent = existing?.sizePercent ?? 40;`:

```ts
        let widthPercent = existing?.widthPercent ?? ENTRY_DEFAULTS.widthPercent;
        let sticky = existing?.sticky ?? ENTRY_DEFAULTS.sticky;
        let opacity = existing?.opacity ?? ENTRY_DEFAULTS.opacity;
```

- [ ] **Step 3: Add the three rows**

After `group.add(sizeRow);`:

```ts
        const widthRow = new Adw.SpinRow({
            title: _('Width'),
            subtitle: _('Percentage of the work area width, centred'),
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 100,
                step_increment: 1,
                page_increment: 5,
                value: widthPercent,
            }),
        });
        widthRow.connect('notify::value', () => {
            widthPercent = Math.round(widthRow.value);
        });
        group.add(widthRow);

        // Width only means anything for a horizontal edge.
        const syncWidthVisible = () => {
            widthRow.visible = side === 'top' || side === 'bottom';
        };
        syncWidthVisible();

        const stickyRow = new Adw.SwitchRow({
            title: _('Sticky'),
            subtitle: _('Show on every workspace'),
            active: sticky,
        });
        stickyRow.connect('notify::active', () => {
            sticky = stickyRow.active;
        });
        group.add(stickyRow);

        const opacityRow = new Adw.SpinRow({
            title: _('Opacity'),
            subtitle: _('100% is fully opaque'),
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 100,
                step_increment: 1,
                page_increment: 5,
                value: opacity,
            }),
        });
        opacityRow.connect('notify::value', () => {
            opacity = Math.round(opacityRow.value);
        });
        group.add(opacityRow);
```

- [ ] **Step 4: Hide width when the side is vertical**

Inside the existing `sideRow.connect('notify::selected', ...)` handler, as the last statement of the `if` block:

```ts
                syncWidthVisible();
```

- [ ] **Step 5: Persist the new fields**

In the save handler, replace the `next` object:

```ts
            const next: QuakeEntry = {
                id: existing?.id ?? createEntryId(),
                appId,
                side,
                shortcut,
                sizePercent: Math.min(90, Math.max(10, sizePercent)),
                widthPercent: Math.min(100, Math.max(10, widthPercent)),
                sticky,
                opacity: Math.min(100, Math.max(10, opacity)),
            };
```

- [ ] **Step 6: Show the settings in the list row**

Replace the `subtitle` expression at `src/prefs.ts:138`:

```ts
        const parts = [sideInfo?.title ?? entry.side];
        parts.push(entry.side === 'top' || entry.side === 'bottom'
            ? `${entry.sizePercent}% × ${entry.widthPercent}%`
            : `${entry.sizePercent}%`);
        if (entry.sticky)
            parts.push(_('sticky'));
        if (entry.opacity < 100)
            parts.push(`${entry.opacity}%`);
        parts.push(shortcut);

        const row = new Adw.ActionRow({
            title,
            subtitle: parts.join(' · '),
            activatable: true,
        });
```

- [ ] **Step 7: Verify the build is clean**

Run: `bun run build && bun test`
Expected: no TypeScript errors, no eslint errors, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/prefs.ts
git commit -m "feat: expose width, sticky and opacity in preferences"
```

---

### Task 6: Install, migrate and verify in a real session

**Files:** none modified — this task is verification.

**Interfaces:**
- Consumes: everything from Tasks 1–5.

- [ ] **Step 1: Full build and test**

```bash
cd /home/jeryban/Projects/gnome/quake-anything-extended
bun run build && bun run schemas && bun test
```

Expected: no errors; 19 tests pass (8 in types.test.ts, 11 in geometry.test.ts).

- [ ] **Step 2: Confirm the live config is still the old shape**

```bash
gsettings --schemadir schemas get org.gnome.shell.extensions.quake-anything entries
gsettings --schemadir schemas get org.gnome.shell.extensions.quake-anything app-entries
```

Expected: `entries` holds the single Nautilus tuple; `app-entries` is `[]`. The migration runs on the next `enable()` — do not hand-edit either key.

- [ ] **Step 3: Restart the session**

Log out and back in. GNOME Shell 50 has no nested backend (mutter dropped it with X11 session support), so this is the only way to load changed extension code. Reattach with `claude --resume`.

- [ ] **Step 4: Confirm the migration ran**

```bash
gsettings --schemadir ~/Projects/gnome/quake-anything-extended/schemas \
  get org.gnome.shell.extensions.quake-anything app-entries
journalctl --user -b -o cat /usr/bin/gnome-shell | grep quake-anything
```

Expected: `app-entries` holds one JSON string with `widthPercent: 100`, `sticky: false`, `opacity: 100`; `entries` is back to `[]`; the log shows `migrated 1 entries to app-entries`. The drawer must behave exactly as before at this point — defaults reproduce old behaviour.

- [ ] **Step 5: Set the drawer up and check each behaviour**

Open the extension's settings, set the Nautilus entry to width 50%, size 45%, sticky on, opacity 95%. Then verify:

- Ctrl+Alt+N opens a half-width Nautilus centred at the bottom, flush with the screen edge.
- Pressing it again slides the window **straight down** out of the bottom edge — not toward the top-left corner.
- Pressing it again slides it back **up** from the bottom edge, with no corner flyout.
- **Review Focus 4:** press Ctrl+Alt+N rapidly several times. The drawer must end either fully shown or fully hidden, never stranded part-way, and never minimised while still visible.
- With the drawer open, switch workspaces. It stays visible on each one.
- The window is visibly translucent.
- **Review Focus 5:** close Nautilus with the drawer open, then re-summon it. The fresh window must be translucent too and the old one must not have left anything behind. Then open an ordinary Nautilus window from the dash — it must be fully opaque and unaffected.
- Set side to Left in settings: the Width row disappears, and the left dock looks exactly as it did before this work.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found in session verification"
```
